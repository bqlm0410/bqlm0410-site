/**
 * 每日抓取 AI 资讯
 *
 *  ① Hacker News 热榜（官方 Firebase API，按关键词筛出 AI 相关的帖子）
 *  ② arXiv 最新论文（官方 Atom API，cs.AI / cs.CL / cs.LG）
 *  ③ 五个官方 RSS / Atom 源（OpenAI、DeepMind、TechCrunch、The Verge、VentureBeat）
 *
 * 输出：src/data/ai-news/YYYY-MM-DD.json
 * 同一天重复运行会覆盖当天文件，方便手动重跑；旧日期的文件永远不动。
 * 每个源各自 try/catch：单个源挂掉只会记进 degraded，绝不影响整体出数据。
 */
import {
  todayInBeijing,
  fetchJson,
  fetchText,
  writeSnapshot,
  readSnapshot,
  parseFeed,
  stripTags,
  sleep,
  log,
} from './lib/common.mjs';
import { summarizeItems, saveSummaryCache, llmEnabled } from './lib/summarize.mjs';

const KIND = 'ai-news';

/* ------------------------------------------------------------------ */
/* 可调参数                                                            */
/* ------------------------------------------------------------------ */

const MAX_ITEMS = 60; // 快照里最多保留多少条
const HN_TOP_LIMIT = 60; // 热榜只取前 60 个 id
const HN_BATCH_SIZE = 10; // 每批并发 10 个详情请求
const HN_BATCH_SLEEP = 400; // 批与批之间歇一下，别把人家 API 打挂
const ARXIV_LIMIT = 30; // arXiv 最多取 30 篇
const ARXIV_DELAY = 3000; // arXiv 官方要求请求间隔 ≥ 3 秒
const FEED_LIMIT = 15; // 每个 RSS 源最多取 15 条

/* ------------------------------------------------------------------ */
/* 数据源定义                                                          */
/* ------------------------------------------------------------------ */

const HN_SOURCE = { id: 'hackernews', name: 'Hacker News' };
const ARXIV_SOURCE = { id: 'arxiv', name: 'arXiv' };

/** RSS / Atom 源清单：以后增删源只改这个数组 */
const RSS_SOURCES = [
  { id: 'openai', name: 'OpenAI', url: 'https://openai.com/news/rss.xml' },
  { id: 'deepmind', name: 'Google DeepMind', url: 'https://deepmind.google/blog/rss.xml' },
  {
    id: 'techcrunch',
    name: 'TechCrunch AI',
    url: 'https://techcrunch.com/category/artificial-intelligence/feed/',
  },
  {
    id: 'theverge',
    name: 'The Verge AI',
    url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml',
  },
  { id: 'venturebeat', name: 'VentureBeat AI', url: 'https://venturebeat.com/category/ai/feed/' },
];

/** sources 数组的输出顺序（也是抓取结果的合并顺序，靠前的源优先保留） */
const SOURCE_ORDER = [HN_SOURCE, ARXIV_SOURCE, ...RSS_SOURCES.map(({ id, name }) => ({ id, name }))];

const ARXIV_API =
  'http://export.arxiv.org/api/query' +
  '?search_query=cat:cs.AI+OR+cat:cs.CL+OR+cat:cs.LG' +
  '&sortBy=submittedDate&sortOrder=descending' +
  `&max_results=${ARXIV_LIMIT}`;

/* ------------------------------------------------------------------ */
/* 关键词与标签（纯启发式，判断错了也不会让脚本失败）                    */
/* ------------------------------------------------------------------ */

/** 命中任意一个即认为这条 HN 帖子与 AI 相关 */
const AI_KEYWORDS = [
  'ai', 'a.i.', 'agi', 'llm', 'llms', 'gpt', 'chatgpt', 'openai', 'anthropic',
  'claude', 'gemini', 'deepmind', 'llama', 'mistral', 'qwen', 'deepseek',
  'grok', 'copilot', 'midjourney', 'sora', 'diffusion', 'transformer',
  'transformers', 'embedding', 'embeddings', 'inference', 'fine-tuning',
  'finetuning', 'multimodal', 'agent', 'agents', 'agentic', 'rag', 'chatbot',
  'prompt engineering', 'machine learning', 'deep learning', 'neural',
  'artificial intelligence', 'generative', 'model', 'models', 'dataset',
  'hugging face', 'huggingface', 'langchain', 'pytorch', 'tensorflow',
  'text-to-image', 'text-to-speech', 'speech recognition', 'computer vision',
  'nvidia', 'gpu', 'tpu',
];

/**
 * 用前后边界匹配，避免误伤：
 * "chair" 里的 ai、"email" 里的 ai 都不算，而 "GPT-4" "LLM:" "OpenAI" 能命中。
 */
const AI_PATTERN = new RegExp(
  `(?<![a-z0-9])(?:${AI_KEYWORDS.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![a-z0-9])`,
  'i',
);

const isAIRelated = (title) => AI_PATTERN.test(String(title ?? ''));

/** 标题关键词 → 中文标签，按顺序最多取 3 个 */
const TAG_RULES = [
  {
    tag: '模型',
    pattern: /\b(llms?|gpts?|chatgpt|claude|gemini|llama|mistral|qwen|deepseek|grok|models?|multimodal|diffusion)\b/i,
  },
  { tag: '开源', pattern: /\b(open[- ]?sourc\w*|github|hugging ?face|weights?)\b/i },
  { tag: 'Agent', pattern: /\b(agents?|agentic|mcp|copilot|tool[- ]use)\b/i },
  {
    tag: '研究',
    pattern: /\b(papers?|research\w*|stud(y|ies)|benchmarks?|datasets?|training|scaling)\b/i,
  },
  {
    tag: '产品',
    pattern: /\b(launch\w*|release[sd]?|unveil\w*|announc\w*|rolls? out|update[sd]?|beta|preview|api)\b/i,
  },
  {
    tag: '融资',
    pattern: /\b(raise[sd]?|raising|funding|fund|valuation|ipo|acqui\w+|series [a-e]|investment)\b/i,
  },
  {
    tag: '硬件',
    pattern: /\b(gpus?|tpus?|chips?|nvidia|datacenters?|data cent(?:er|re)|supercomputers?)\b/i,
  },
  {
    tag: '安全',
    pattern: /\b(safety|security|risks?|regulat\w+|polic\w+|lawsuit|copyright|privacy|deepfakes?|misinformation)\b/i,
  },
  {
    tag: '商业',
    pattern: /\b(partnerships?|partners?|deals?|contracts?|enterprise|revenue|customers?|hires?|layoffs?)\b/i,
  },
];

function buildTags(title) {
  const text = String(title ?? '');
  const tags = [];
  for (const { tag, pattern } of TAG_RULES) {
    if (tags.length >= 3) break;
    if (pattern.test(text)) tags.push(tag);
  }
  return tags;
}

/** arXiv 分类 → 中文标签，没收录的分类就原样用 term */
const ARXIV_CATEGORY_TAGS = {
  'cs.AI': 'AI',
  'cs.CL': 'NLP',
  'cs.LG': '机器学习',
  'cs.CV': '计算机视觉',
  'cs.NE': '神经网络',
  'cs.RO': '机器人',
  'cs.IR': '信息检索',
  'cs.SD': '语音',
  'cs.MA': '多智能体',
  'cs.HC': '人机交互',
  'cs.CR': '安全',
  'stat.ML': '统计学习',
};

function buildArxivTags(title, categories) {
  const tags = [];
  for (const term of categories) {
    const tag = ARXIV_CATEGORY_TAGS[term] ?? term;
    if (!tags.includes(tag)) tags.push(tag);
    if (tags.length >= 2) break;
  }
  for (const tag of buildTags(title)) {
    if (!tags.includes(tag)) tags.push(tag);
    if (tags.length >= 4) break;
  }
  if (!tags.length) tags.push('论文');
  return tags;
}

/* ------------------------------------------------------------------ */
/* 通用小工具                                                          */
/* ------------------------------------------------------------------ */

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** 把 unix 秒转成 ISO 8601，拿不到就返回空字符串（前端不接受 null） */
function fromUnixSeconds(value) {
  if (!Number.isFinite(value) || value <= 0) return '';
  try {
    return new Date(value * 1000).toISOString();
  } catch {
    return '';
  }
}

/** 极简 FNV-1a，用来给没有 slug 的链接生成短 id（不引第三方库） */
function hashLink(link) {
  let hash = 0x811c9dc5;
  const text = String(link ?? '');
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/** 从链接尾部取一个可读 slug，取不到就用哈希兜底 */
function slugFromLink(link) {
  try {
    const last = new URL(link).pathname.split('/').filter(Boolean).pop() ?? '';
    const slug = last
      .replace(/\.(html?|php|aspx?|xml)$/i, '')
      .replace(/[^a-z0-9-]/gi, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase();
    if (slug.length >= 4) return slug.slice(0, 60);
  } catch {
    /* 链接解析不了，走哈希兜底 */
  }
  return hashLink(link);
}

function isTrackingParam(key) {
  return /^utm_/i.test(key) || ['fbclid', 'gclid', 'mc_cid', 'mc_eid'].includes(key.toLowerCase());
}

/** 去重用的链接指纹：去掉 utm 之类的跟踪参数，并忽略协议 / www / 末尾斜杠的差异 */
function dedupeKey(raw) {
  const text = String(raw ?? '').trim();
  try {
    const url = new URL(text);
    for (const key of [...url.searchParams.keys()]) {
      if (isTrackingParam(key)) url.searchParams.delete(key);
    }
    url.hash = '';
    const host = url.hostname.replace(/^www\./i, '').toLowerCase();
    const pathname = url.pathname.replace(/\/+$/, '');
    const query = url.searchParams.toString();
    return `${host}${pathname}${query ? `?${query}` : ''}`;
  } catch {
    return text; // 解析不了的链接原样参与去重
  }
}

function timeValue(iso) {
  const t = Date.parse(String(iso ?? ''));
  return Number.isNaN(t) ? 0 : t;
}

/** 统一补齐字段，保证写出去的每条都符合前端约定的结构 */
function normalizeItem(raw) {
  return {
    id: String(raw.id ?? ''),
    title: String(raw.title ?? '').trim(),
    titleZh: typeof raw.titleZh === 'string' ? raw.titleZh : '',
    summaryZh: typeof raw.summaryZh === 'string' ? raw.summaryZh : '',
    link: String(raw.link ?? '').trim(),
    source: String(raw.source ?? ''),
    sourceName: String(raw.sourceName ?? ''),
    publishedAt: typeof raw.publishedAt === 'string' ? raw.publishedAt : '',
    score: Number.isFinite(raw.score) ? raw.score : null,
    comments: Number.isFinite(raw.comments) ? raw.comments : null,
    tags: Array.isArray(raw.tags) ? raw.tags.filter((t) => typeof t === 'string') : [],
    // description 只给大模型用，写快照前会被 toPublicItem 去掉
    description: typeof raw.description === 'string' ? raw.description.slice(0, 400) : '',
  };
}

/** 落盘用的最终结构，字段与顺序都按前端约定来 */
function toPublicItem(item) {
  return {
    id: item.id,
    title: item.title,
    titleZh: item.titleZh,
    summaryZh: item.summaryZh,
    link: item.link,
    source: item.source,
    sourceName: item.sourceName,
    publishedAt: item.publishedAt,
    score: item.score,
    comments: item.comments,
    tags: item.tags,
  };
}

/** 给大模型的补充信息，例如「来源：Hacker News，321 分，145 条评论」 */
function buildExtra(item) {
  const parts = [`来源：${item.sourceName}`];
  if (item.score !== null) parts.push(`${item.score} 分`);
  if (item.comments !== null) parts.push(`${item.comments} 条评论`);
  if (item.tags.length) parts.push(`标签：${item.tags.join('/')}`);
  return parts.join('，');
}

/** 按 link 去重（保留靠前的源），再按发布时间倒序，空时间排最后 */
function dedupeAndSort(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const key = dedupeKey(item.link) || item.id;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out.sort((a, b) => timeValue(b.publishedAt) - timeValue(a.publishedAt));
}

/* ------------------------------------------------------------------ */
/* ① Hacker News（官方 Firebase API）                                   */
/* ------------------------------------------------------------------ */

function mapHnStory(story) {
  // 外链帖用原文链接，Ask HN / Show HN 这类没有 url 的退回讨论页
  const link = story.url || `https://news.ycombinator.com/item?id=${story.id}`;
  const text = story.text ? stripTags(story.text).slice(0, 400) : '';
  return normalizeItem({
    id: `hn-${story.id}`,
    title: story.title,
    link,
    source: HN_SOURCE.id,
    sourceName: HN_SOURCE.name,
    publishedAt: fromUnixSeconds(story.time),
    score: Number.isFinite(story.score) ? story.score : null,
    comments: Number.isFinite(story.descendants) ? story.descendants : null,
    tags: buildTags(story.title),
    description:
      text || `${HN_SOURCE.name} 热榜讨论帖（${story.score ?? 0} 分，${story.descendants ?? 0} 条评论）`,
  });
}

async function fetchHackerNews() {
  log.step(`抓取 ${HN_SOURCE.name} 热榜（官方 Firebase API）`);

  try {
    const ids = await fetchJson(
      'https://hacker-news.firebaseio.com/v0/topstories.json',
      {},
      { retries: 3, timeout: 20000, label: 'HN topstories' },
    );
    const top = (Array.isArray(ids) ? ids : []).slice(0, HN_TOP_LIMIT);
    if (!top.length) {
      log.warn('热榜返回空列表，本次跳过');
      return { source: HN_SOURCE, items: [] };
    }

    const batches = chunk(top, HN_BATCH_SIZE);
    const items = [];
    let emptyBatches = 0;

    for (const [index, batch] of batches.entries()) {
      // 单条失败不影响整批：catch 掉变 null，最后统一过滤
      const got = await Promise.all(
        batch.map((id) =>
          fetchJson(
            `https://hacker-news.firebaseio.com/v0/item/${id}.json`,
            {},
            { retries: 2, timeout: 12000, label: `HN item ${id}` },
          ).catch(() => null),
        ),
      );

      const stories = got.filter((s) => s && s.type === 'story' && s.title);
      if (!stories.length) {
        emptyBatches += 1;
        // 连续两批全空通常说明网络或 API 出问题了，及时收手，别把时间耗在重试上
        if (emptyBatches >= 2) {
          log.warn(`连续 ${emptyBatches} 批详情请求全部失败，放弃剩余批次`);
          break;
        }
      } else {
        emptyBatches = 0;
      }

      for (const story of stories) {
        if (!isAIRelated(story.title)) continue;
        items.push(mapHnStory(story));
      }

      if (index < batches.length - 1) await sleep(HN_BATCH_SLEEP);
    }

    log.ok(`热榜前 ${top.length} 条里筛出 AI 相关 ${items.length} 条`);
    return { source: HN_SOURCE, items };
  } catch (err) {
    log.fail(`${HN_SOURCE.name} 抓取失败：${err.message}`);
    return { source: HN_SOURCE, items: [] };
  }
}

/* ------------------------------------------------------------------ */
/* ② arXiv（官方 Atom API）                                             */
/* ------------------------------------------------------------------ */

/** 顺手把每个条目的分类抠出来做标签（parseFeed 不返回分类） */
function extractArxivCategories(xml) {
  const map = new Map();
  for (const chunk of String(xml).split(/<entry[\s>]/i).slice(1)) {
    const block = chunk.split('</entry>')[0];
    const link = block.match(/<link[^>]*href=["']([^"']+)["']/i)?.[1];
    if (!link) continue;
    const terms = [...block.matchAll(/<category[^>]*term=["']([^"']+)["']/gi)].map((m) => m[1]);
    map.set(link, terms);
  }
  return map;
}

function arxivIdFromLink(link) {
  const matched = String(link).match(/\/(?:abs|pdf)\/([^/?#]+)/i);
  const id = (matched ? matched[1] : String(link)).replace(/v\d+$/i, '').replace(/\.pdf$/i, '');
  return id || hashLink(link);
}

async function fetchArxiv() {
  log.step(`抓取 ${ARXIV_SOURCE.name} 最新论文（官方 Atom API）`);

  try {
    // arXiv 官方要求请求间隔 ≥ 3 秒，本脚本每次只发一个请求，这里仍然留出间隔
    await sleep(ARXIV_DELAY);

    const xml = await fetchText(ARXIV_API, {}, { retries: 2, timeout: 25000, label: 'arXiv API' });
    const entries = parseFeed(xml, { limit: ARXIV_LIMIT });
    if (!entries.length) {
      log.warn('arXiv 返回 0 条，接口格式可能变了，本次跳过');
      return { source: ARXIV_SOURCE, items: [] };
    }

    const categories = extractArxivCategories(xml);
    const items = entries.map((entry) =>
      normalizeItem({
        id: `arxiv-${arxivIdFromLink(entry.link)}`,
        title: entry.title,
        link: entry.link,
        source: ARXIV_SOURCE.id,
        sourceName: ARXIV_SOURCE.name,
        publishedAt: entry.publishedAt,
        tags: buildArxivTags(entry.title, categories.get(entry.link) ?? []),
        description: entry.summary,
      }),
    );

    log.ok(`arXiv 抓到 ${items.length} 篇`);
    return { source: ARXIV_SOURCE, items };
  } catch (err) {
    log.fail(`${ARXIV_SOURCE.name} 抓取失败：${err.message}`);
    return { source: ARXIV_SOURCE, items: [] };
  }
}

/* ------------------------------------------------------------------ */
/* ③ RSS / Atom 源                                                     */
/* ------------------------------------------------------------------ */

async function fetchRssSource(source) {
  try {
    const xml = await fetchText(source.url, {}, { retries: 2, timeout: 20000, label: source.name });
    const entries = parseFeed(xml, { limit: FEED_LIMIT });
    if (!entries.length) {
      log.warn(`${source.name} 解析出 0 条（可能改版或返回了空 feed）`);
      return { source, items: [] };
    }

    const items = entries.map((entry) =>
      normalizeItem({
        id: `${source.id}-${slugFromLink(entry.link)}`,
        title: entry.title,
        link: entry.link,
        source: source.id,
        sourceName: source.name,
        publishedAt: entry.publishedAt,
        tags: buildTags(entry.title),
        description: entry.summary,
      }),
    );

    log.ok(`${source.name} 抓到 ${items.length} 条`);
    return { source, items };
  } catch (err) {
    log.fail(`${source.name} 抓取失败：${err.message}`);
    return { source, items: [] };
  }
}

/** 各 RSS 源互相独立、失败互不影响，直接并发 */
async function fetchRssSources() {
  log.step(`抓取 ${RSS_SOURCES.length} 个 RSS 源（${RSS_SOURCES.map((s) => s.name).join(' / ')}）`);
  return Promise.all(RSS_SOURCES.map((source) => fetchRssSource(source)));
}

/* ------------------------------------------------------------------ */
/* 降级：源挂了就沿用上一次快照里同源的数据                             */
/* ------------------------------------------------------------------ */

function pickFallback(previous, sourceId) {
  return (previous?.items ?? [])
    .filter((item) => item?.source === sourceId && item?.title)
    .map((item) => normalizeItem(item));
}

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */

async function main() {
  const date = todayInBeijing();
  log.info(`日期（北京时间）：${date}`);
  if (llmEnabled()) log.info('检测到 DEEPSEEK_API_KEY，将生成中文摘要');
  else log.info('未检测到 DEEPSEEK_API_KEY，中文标题与摘要留空');

  const previous = await readSnapshot(KIND);

  // 三块并行抓，各自内部已经 catch，任何一块挂掉都能照常出数据
  const [hnResult, arxivResult, rssResults] = await Promise.all([
    fetchHackerNews(),
    fetchArxiv(),
    fetchRssSources(),
  ]);
  const results = [hnResult, arxivResult, ...rssResults];

  const degraded = [];
  const merged = [];

  for (const { source, items } of results) {
    let list = items;
    if (!list.length) {
      degraded.push(source.id);
      const fallback = pickFallback(previous, source.id);
      if (fallback.length) {
        list = fallback;
        log.warn(`${source.name} 本次没有数据，暂用上一次快照的 ${fallback.length} 条顶上`);
      } else {
        log.warn(`${source.name} 本次没有数据，也没有历史快照可顶上`);
      }
    }
    merged.push(...list);
  }

  if (!merged.length) {
    log.fail('所有数据源都拿不到数据，不写快照，直接退出（网站会继续展示旧数据）');
    process.exit(1);
  }

  const items = dedupeAndSort(merged).slice(0, MAX_ITEMS);

  // 只给还没有中文标题的条目调用大模型，控制成本
  log.step('生成中文摘要');
  const pending = items
    .filter((item) => !item.titleZh && item.title)
    .map((item) => ({
      id: item.id,
      title: item.title,
      description: item.description,
      extra: buildExtra(item),
    }));

  if (pending.length) {
    // 没配 key 时 summarizeItems 会自动降级返回空 Map，这里不用做特殊处理
    const summaries = await summarizeItems(pending, { kind: 'news', batchSize: 10 });
    let filled = 0;
    for (const item of items) {
      const got = summaries.get(item.id);
      if (!got) continue;
      item.titleZh = String(got.titleZh ?? '');
      item.summaryZh = String(got.summaryZh ?? '');
      if (item.titleZh || item.summaryZh) filled += 1;
    }
    log.info(`中文摘要回填 ${filled}/${pending.length} 条`);
  } else {
    log.info('没有需要生成中文摘要的条目（全部命中历史快照）');
  }
  // 没启用大模型时是空操作，写一次以保持与 GitHub 脚本一致
  await saveSummaryCache();

  const sources = SOURCE_ORDER.map(({ id, name }) => ({
    id,
    name,
    count: items.filter((item) => item.source === id).length,
  })).filter((s) => s.count > 0);

  const file = await writeSnapshot(KIND, date, {
    source: 'news',
    degraded,
    sources,
    totalCount: items.length,
    items: items.map(toPublicItem),
  });

  log.ok(`快照已写入：${file}`);
  log.info(`共 ${items.length} 条 —— ${sources.map((s) => `${s.name} ${s.count}`).join(' / ')}`);
  if (degraded.length) log.warn(`本次降级的数据源：${degraded.join('、')}`);
}

main().catch((err) => {
  console.error('\n❌ 抓取流程异常终止：', err);
  process.exit(1);
});
