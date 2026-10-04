/**
 * DeepSeek 中文摘要模块
 *
 * 两个省钱设计：
 *  1. 结果缓存到 src/data/.summary-cache.json，同一个仓库/文章永远只调用一次
 *  2. 批量提交（一次请求处理多条），减少请求数和 token 开销
 *
 * 没配 DEEPSEEK_API_KEY 时自动降级：不报错、不中断，只是不生成中文摘要。
 */
import { fetchWithRetry, readJsonCache, writeJsonCache, log, sleep } from './common.mjs';

const API_KEY = process.env.DEEPSEEK_API_KEY ?? '';
const BASE_URL = (process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com').replace(/\/+$/, '');
const MODEL = process.env.DEEPSEEK_MODEL ?? 'deepseek-chat';
const CACHE_NAME = '.summary-cache.json';

export const llmEnabled = () => API_KEY.trim().length > 0;

let cache = null;

async function loadCache() {
  if (cache === null) cache = await readJsonCache(CACHE_NAME, {});
  return cache;
}

export async function saveSummaryCache() {
  if (cache !== null) await writeJsonCache(CACHE_NAME, cache);
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** 从模型回复里抠出 JSON（容忍 ```json 包裹和前后废话） */
function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : text).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

const SYSTEM_PROMPTS = {
  repo: '你是技术编辑，为中文开发者社区撰写 GitHub 项目卡片文案。语言简洁、客观、不吹捧，不用"这个项目"开头。',
  news: '你是科技新闻编辑，为中文读者编写 AI 领域资讯标题与摘要。客观中立，不加评论，不臆测。',
};

function buildUserPrompt(kind, batch) {
  const list = batch.map((item) => ({
    id: item.id,
    名称: item.title,
    原始描述: (item.description ?? '').slice(0, 400),
    附加信息: item.extra ?? '',
  }));

  const task =
    kind === 'repo'
      ? '为下面每个开源项目写：①一个不超过 20 字的中文标题（项目名 + 一句话定位）②一段 40~70 字的中文简介，说明它解决什么问题、有什么特点。'
      : '为下面每条资讯写：①一个不超过 25 字的中文标题 ②一段 40~70 字的中文摘要，说清发生了什么、为什么值得关注。';

  return `${task}

严格要求：
- 只输出 JSON，格式为 {"items":[{"id":"原始id","titleZh":"...","summaryZh":"..."}]}
- id 必须原样回填，不要改动、不要遗漏、不要新增
- 不要输出 markdown 代码块标记
- 如果某条信息不足以判断，summaryZh 写「信息有限，详见原文」

待处理列表：
${JSON.stringify(list, null, 2)}`;
}

/** 单次调用模型 */
async function callLLM(kind, batch) {
  const res = await fetchWithRetry(
    `${BASE_URL}/chat/completions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPTS[kind] ?? SYSTEM_PROMPTS.news },
          { role: 'user', content: buildUserPrompt(kind, batch) },
        ],
        temperature: 0.3,
        max_tokens: 2000,
        response_format: { type: 'json_object' },
      }),
    },
    { retries: 2, timeout: 90000, label: `DeepSeek(${kind})` },
  );

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content ?? '';
  const parsed = extractJson(text);
  return Array.isArray(parsed?.items) ? parsed.items : [];
}

/**
 * 批量为条目生成中文标题与摘要
 * @param {{id:string,title:string,description?:string,extra?:string}[]} items
 * @param {{kind:'repo'|'news', batchSize?:number}} opts
 * @returns {Promise<Map<string,{titleZh:string,summaryZh:string}>>}
 */
export async function summarizeItems(items, { kind = 'news', batchSize = 8 } = {}) {
  const result = new Map();
  if (!items.length) return result;

  if (!llmEnabled()) {
    log.warn('未配置 DEEPSEEK_API_KEY，跳过中文摘要（其余功能不受影响）');
    return result;
  }

  const store = await loadCache();
  const pending = [];

  for (const item of items) {
    const hit = store[item.id];
    if (hit?.summaryZh) result.set(item.id, hit);
    else pending.push(item);
  }

  if (!pending.length) {
    log.info(`中文摘要全部命中缓存（${result.size} 条），0 次 API 调用`);
    return result;
  }

  log.info(`需要新生成摘要：${pending.length} 条（缓存命中 ${result.size} 条）`);
  const batches = chunk(pending, batchSize);

  for (const [index, batch] of batches.entries()) {
    try {
      const got = await callLLM(kind, batch);
      const byId = new Map(got.map((g) => [String(g.id), g]));
      for (const item of batch) {
        const g = byId.get(String(item.id));
        if (g?.summaryZh) {
          const value = {
            titleZh: String(g.titleZh ?? '').trim(),
            summaryZh: String(g.summaryZh ?? '').trim(),
          };
          store[item.id] = value;
          result.set(item.id, value);
        }
      }
      log.ok(`第 ${index + 1}/${batches.length} 批完成（${got.length} 条）`);
    } catch (err) {
      // 单批失败不影响整体：这些条目下次跑还会重试
      log.warn(`第 ${index + 1}/${batches.length} 批失败：${err.message}`);
    }
    if (index < batches.length - 1) await sleep(800);
  }

  await saveSummaryCache();
  return result;
}
