/**
 * 每日抓取 GitHub 数据
 *
 *  ① 今日 Trending 榜（GitHub 官方没有 API，只能解析页面 HTML）
 *  ② Star 总数 Top 100（用官方 Search API）
 *
 * 输出：src/data/github-trending/YYYY-MM-DD.json
 * 同一天重复运行会覆盖当天文件，方便手动重跑；旧日期的文件永远不动。
 */
import {
  todayInBeijing,
  fetchJson,
  fetchText,
  writeSnapshot,
  readSnapshot,
  stripTags,
  decodeEntities,
  log,
} from './lib/common.mjs';
import { summarizeItems, saveSummaryCache, llmEnabled } from './lib/summarize.mjs';

const KIND = 'github-trending';

const authHeaders = process.env.GITHUB_TOKEN
  ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
  : {};

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
};

/* ------------------------------------------------------------------ */
/* ① Trending 页面解析                                                 */
/* ------------------------------------------------------------------ */

function parseTrending(html) {
  // 每个仓库被包在 <article class="Box-row"> 里
  const blocks = html.split(/<article class="Box-row">/).slice(1);
  const repos = [];

  for (const block of blocks) {
    const nameMatch = block.match(/<h2[^>]*>[\s\S]*?<a[^>]*href="\/([^"?#]+)"/);
    if (!nameMatch) continue;
    const fullName = decodeEntities(nameMatch[1]).replace(/\s+/g, '');
    if (!/^[^/]+\/[^/]+$/.test(fullName)) continue;

    const descMatch = block.match(
      /<p class="[^"]*color-fg-muted[^"]*"[^>]*>([\s\S]*?)<\/p>/,
    );
    const langMatch = block.match(/itemprop="programmingLanguage">([^<]+)</);
    const langColorMatch = block.match(
      /repo-language-color[^>]*style="background-color:\s*([^";]+)/,
    );
    const starsMatch = block.match(
      /href="\/[^"]+\/stargazers"[^>]*>[\s\S]*?([\d,]+)\s*<\/a>/,
    );
    const forksMatch = block.match(/href="\/[^"]+\/forks"[^>]*>[\s\S]*?([\d,]+)\s*<\/a>/);
    const todayMatch = block.match(/([\d,]+)\s+stars?\s+today/i);
    const contribMatch = block.match(
      /href="\/([^"]+)"[^>]*>\s*<img[^>]*class="avatar"[^>]*alt="@/,
    );

    repos.push({
      fullName,
      owner: fullName.split('/')[0],
      name: fullName.split('/')[1],
      url: `https://github.com/${fullName}`,
      description: descMatch ? stripTags(descMatch[1]) : '',
      language: langMatch ? decodeEntities(langMatch[1]).trim() : '',
      languageColor: langColorMatch ? langColorMatch[1].trim() : '',
      stars: starsMatch ? Number(starsMatch[1].replace(/,/g, '')) : null,
      forks: forksMatch ? Number(forksMatch[1].replace(/,/g, '')) : null,
      starsToday: todayMatch ? Number(todayMatch[1].replace(/,/g, '')) : null,
      builtBy: contribMatch ? contribMatch[1] : '',
    });
  }

  return repos;
}

async function fetchTrending() {
  log.step('抓取 GitHub Trending（今日）');
  try {
    const html = await fetchText('https://github.com/trending?since=daily', {
      headers: BROWSER_HEADERS,
    });
    const repos = parseTrending(html);
    if (!repos.length) {
      log.warn('Trending 页面解析出 0 条，GitHub 可能改版了，本次跳过该部分');
      return [];
    }
    log.ok(`Trending 抓到 ${repos.length} 个项目`);
    return repos;
  } catch (err) {
    log.fail(`Trending 抓取失败：${err.message}`);
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* ② Star Top 100（官方 Search API）                                    */
/* ------------------------------------------------------------------ */

function mapApiRepo(item) {
  return {
    fullName: item.full_name,
    owner: item.owner?.login ?? '',
    name: item.name,
    url: item.html_url,
    description: item.description ?? '',
    language: item.language ?? '',
    languageColor: '',
    stars: item.stargazers_count,
    forks: item.forks_count,
    openIssues: item.open_issues_count,
    topics: Array.isArray(item.topics) ? item.topics.slice(0, 6) : [],
    homepage: item.homepage ?? '',
    createdAt: item.created_at,
    pushedAt: item.pushed_at,
    ownerAvatar: item.owner?.avatar_url ?? '',
  };
}

async function fetchTop100() {
  log.step('抓取 Star 总数 Top 100（官方 API）');
  const url =
    'https://api.github.com/search/repositories' +
    '?q=' + encodeURIComponent('stars:>1') +
    '&sort=stars&order=desc&per_page=100';

  try {
    const data = await fetchJson(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'bqlm0410-site-bot',
        ...authHeaders,
      },
    });
    const repos = (data.items ?? []).map(mapApiRepo);
    log.ok(`Top 100 抓到 ${repos.length} 个项目`);
    return repos;
  } catch (err) {
    log.fail(`Top 100 抓取失败：${err.message}`);
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* ③ 与上一次快照做对比，算出新上榜 / 掉榜 / 涨星                        */
/* ------------------------------------------------------------------ */

function diffAgainstPrevious(current, previous, key = 'fullName') {
  const prevMap = new Map((previous ?? []).map((r) => [r[key], r]));
  return current.map((repo, index) => {
    const prev = prevMap.get(repo[key]);
    const prevIndex = previous ? previous.findIndex((r) => r[key] === repo[key]) : -1;
    return {
      ...repo,
      rank: index + 1,
      previousRank: prevIndex >= 0 ? prevIndex + 1 : null,
      rankChange: prevIndex >= 0 ? prevIndex - index : null,
      starsGained:
        prev && typeof prev.stars === 'number' && typeof repo.stars === 'number'
          ? repo.stars - prev.stars
          : null,
      isNew: !prev,
    };
  });
}

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */

async function main() {
  const date = todayInBeijing();
  log.info(`日期（北京时间）：${date}`);
  if (llmEnabled()) log.info('检测到 DEEPSEEK_API_KEY，将生成中文摘要');

  const previous = await readSnapshot(KIND);

  const [trendingRaw, topRaw] = await Promise.all([fetchTrending(), fetchTop100()]);

  // 某个源挂了就沿用上一次的数据，避免页面上出现空白
  let trending = trendingRaw;
  let top = topRaw;
  const degraded = [];

  if (!trending.length) {
    degraded.push('trending');
    if (previous?.trending?.length) {
      trending = previous.trending;
      log.warn('本次 Trending 抓取为空，暂用上一次的数据顶上');
    }
  }
  if (!top.length) {
    degraded.push('top');
    if (previous?.top?.length) {
      top = previous.top;
      log.warn('本次 Top100 抓取为空，暂用上一次的数据顶上');
    }
  }

  if (!trending.length && !top.length) {
    log.fail('两个源都拿不到数据，不写快照，直接退出（网站会继续展示旧数据）');
    process.exit(1);
  }

  // 与上一次快照对比，算出排名变化、涨星数与是否新上榜
  const trendingList = diffAgainstPrevious(trending, previous?.trending);
  const topList = diffAgainstPrevious(top, previous?.top);

  // 只对新出现的项目调用大模型，控制成本
  if (llmEnabled()) {
    log.step('生成中文摘要（仅新条目）');
    const all = [...trendingList, ...topList].map((r) => ({
      id: r.fullName,
      title: r.fullName,
      description: r.description,
      extra: [r.language && `语言：${r.language}`, r.stars && `Stars：${r.stars}`]
        .filter(Boolean)
        .join('，'),
    }));
    const uniq = [...new Map(all.map((i) => [i.id, i])).values()];
    const summaries = await summarizeItems(uniq, { kind: 'repo', batchSize: 10 });
    for (const repo of [...trendingList, ...topList]) {
      const s = summaries.get(repo.fullName);
      if (s) {
        repo.titleZh = s.titleZh;
        repo.summaryZh = s.summaryZh;
      }
    }
    await saveSummaryCache();
  }

  const file = await writeSnapshot(KIND, date, {
    source: 'github',
    degraded,
    trendingSince: 'daily',
    trendingCount: trendingList.length,
    topCount: topList.length,
    trending: trendingList,
    top: topList,
  });

  log.ok(`快照已写入：${file}`);
  log.info(`Trending ${trending.length} 条 / Top100 ${top.length} 条`);
}

main().catch((err) => {
  console.error('\n❌ 抓取流程异常终止：', err);
  process.exit(1);
});
