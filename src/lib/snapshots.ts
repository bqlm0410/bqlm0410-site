/**
 * 每日快照读取工具
 *
 * 抓取脚本每天往 src/data/ 下写一个「当天日期命名的 JSON 文件」，
 * 旧文件永远不动 —— 所以历史记录是天然存在的，这里负责把它们读出来。
 *
 * 用 Vite 的 import.meta.glob 在**构建时**把 JSON 内联进来：
 * 抓取任务提交新文件 → Cloudflare Pages 重新构建 → 数据自动出现在页面上。
 *
 * ⚠️ 所有函数在「还没有任何数据」时都必须安全返回空值，绝不能抛错。
 */

/* ------------------------------------------------------------------ */
/* 类型定义                                                            */
/* ------------------------------------------------------------------ */

export interface RepoSnapshot {
  fullName: string;
  owner: string;
  name: string;
  url: string;
  description: string;
  language: string;
  languageColor: string;
  stars: number | null;
  forks: number | null;
  /** 只有 trending 榜单有 */
  starsToday: number | null;
  builtBy: string;
  openIssues?: number;
  topics?: string[];
  homepage?: string;
  createdAt?: string;
  pushedAt?: string;
  ownerAvatar?: string;
  /** 排名，从 1 开始 */
  rank: number;
  /** 上一次榜单里的名次，新上榜为 null */
  previousRank: number | null;
  /** 正数=上升了几名 */
  rankChange: number | null;
  /** 相比上一次涨了多少星 */
  starsGained: number | null;
  isNew: boolean;
  /** 大模型生成的中文标题 */
  titleZh?: string;
  /** 大模型生成的中文摘要 */
  summaryZh?: string;
}

export interface GithubSnapshot {
  date: string;
  generatedAt: string;
  source: 'github';
  degraded: string[];
  trendingSince: string;
  trendingCount: number;
  topCount: number;
  trending: RepoSnapshot[];
  top: RepoSnapshot[];
}

export interface NewsItem {
  id: string;
  title: string;
  titleZh: string;
  summaryZh: string;
  link: string;
  source: string;
  sourceName: string;
  publishedAt: string;
  score: number | null;
  comments: number | null;
  tags: string[];
}

export interface NewsSourceStat {
  id: string;
  name: string;
  count: number;
}

export interface NewsSnapshot {
  date: string;
  generatedAt: string;
  source: 'news';
  degraded: string[];
  sources: NewsSourceStat[];
  totalCount: number;
  items: NewsItem[];
}

/* ------------------------------------------------------------------ */
/* 构建时载入                                                          */
/* ------------------------------------------------------------------ */

const githubModules = import.meta.glob('../data/github-trending/*.json', { eager: true });
const newsModules = import.meta.glob('../data/ai-news/*.json', { eager: true });

const DATE_RE = /(\d{4}-\d{2}-\d{2})\.json$/;

function buildMap<T>(modules: Record<string, unknown>): Map<string, T> {
  const map = new Map<string, T>();
  for (const [filePath, module] of Object.entries(modules)) {
    const date = filePath.match(DATE_RE)?.[1];
    if (!date) continue;
    const payload = (module as { default?: unknown })?.default ?? module;
    if (payload && typeof payload === 'object') map.set(date, payload as T);
  }
  return map;
}

const githubByDate = buildMap<GithubSnapshot>(githubModules);
const newsByDate = buildMap<NewsSnapshot>(newsModules);

/** 日期倒序 */
function sortedDates<T>(map: Map<string, T>): string[] {
  return [...map.keys()].sort().reverse();
}

/* ------------------------------------------------------------------ */
/* 对外接口                                                            */
/* ------------------------------------------------------------------ */

/** 所有有快照的日期，倒序（最新在前） */
export function listGithubDates(): string[] {
  return sortedDates(githubByDate);
}

/** 所有有快照的日期，倒序（最新在前） */
export function listNewsDates(): string[] {
  return sortedDates(newsByDate);
}

/** GitHub 和资讯日期的并集，倒序 */
export function listAllDates(): string[] {
  return [...new Set([...githubByDate.keys(), ...newsByDate.keys()])].sort().reverse();
}

export function getGithubSnapshot(date: string): GithubSnapshot | null {
  return githubByDate.get(date) ?? null;
}

export function getNewsSnapshot(date: string): NewsSnapshot | null {
  return newsByDate.get(date) ?? null;
}

export function getLatestGithub(): GithubSnapshot | null {
  const dates = listGithubDates();
  return dates.length ? (githubByDate.get(dates[0]) ?? null) : null;
}

export function getLatestNews(): NewsSnapshot | null {
  const dates = listNewsDates();
  return dates.length ? (newsByDate.get(dates[0]) ?? null) : null;
}

/** 指定日期的前一天 / 后一天（用于日期导航），没有就返回 null */
export function getAdjacentGithubDates(date: string): {
  prev: string | null;
  next: string | null;
} {
  return adjacent(listGithubDates(), date);
}

export function getAdjacentNewsDates(date: string): {
  prev: string | null;
  next: string | null;
} {
  return adjacent(listNewsDates(), date);
}

/** dates 是倒序数组：prev = 更早一天，next = 更晚一天 */
function adjacent(dates: string[], date: string) {
  const index = dates.indexOf(date);
  if (index === -1) return { prev: null, next: null };
  return {
    prev: index + 1 < dates.length ? dates[index + 1] : null,
    next: index - 1 >= 0 ? dates[index - 1] : null,
  };
}
