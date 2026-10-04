/**
 * 抓取脚本公用工具库
 *
 * 设计原则：
 *  1. 零第三方依赖（Node 18+ 自带 fetch），以后不会被某个库升级搞坏
 *  2. 快照文件只新增、不覆盖，保证历史永远可回溯
 *  3. 所有抓取都带超时和重试，单个源挂掉不影响整体
 */
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DATA_DIR = path.join(ROOT, 'src', 'data');

/** 取北京时间的 YYYY-MM-DD（Actions 跑在 UTC，必须手动 +8） */
export function todayInBeijing() {
  const beijing = new Date(Date.now() + 8 * 3600 * 1000);
  return beijing.toISOString().slice(0, 10);
}

/** 北京时间的可读时间戳，用于写进快照 */
export function beijingNow() {
  const beijing = new Date(Date.now() + 8 * 3600 * 1000);
  return beijing.toISOString().replace('Z', '+08:00');
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 带超时与重试的 fetch，失败时抛错、由调用方决定是否降级 */
export async function fetchWithRetry(
  url,
  options = {},
  { retries = 3, timeout = 25000, label = url } = {},
) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return res;
    } catch (err) {
      lastError = err;
      console.warn(`  ⚠️ [${label}] 第 ${attempt}/${retries} 次失败: ${err.message}`);
      if (attempt < retries) await sleep(attempt * 1500);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`抓取失败 [${label}]：${lastError?.message}`);
}

/** 抓 JSON */
export async function fetchJson(url, options = {}, retryOpts = {}) {
  const res = await fetchWithRetry(url, {
    ...options,
    headers: { Accept: 'application/json', 'User-Agent': 'bqlm0410-site-bot', ...options.headers },
  }, retryOpts);
  return res.json();
}

/** 抓文本（HTML / XML） */
export async function fetchText(url, options = {}, retryOpts = {}) {
  const res = await fetchWithRetry(url, {
    ...options,
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'User-Agent':
        'Mozilla/5.0 (compatible; bqlm0410-site-bot/1.0; +https://bqlm0410.top)',
      ...options.headers,
    },
  }, retryOpts);
  return res.text();
}

/** 写入当天快照，返回文件路径。同一天重复跑会覆盖当天文件（方便手动重跑） */
export async function writeSnapshot(kind, date, payload) {
  const dir = path.join(DATA_DIR, kind);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${date}.json`);
  const body = { date, generatedAt: beijingNow(), ...payload };
  await writeFile(file, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
  return file;
}

/** 列出某类快照已有的日期，倒序（最新在前） */
export async function listSnapshotDates(kind) {
  const dir = path.join(DATA_DIR, kind);
  try {
    const files = await readdir(dir);
    return files
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .map((f) => f.replace(/\.json$/, ''))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

/** 读取指定日期或最近一份快照（用于做增量对比） */
export async function readSnapshot(kind, date = null) {
  const target = date ?? (await listSnapshotDates(kind))[0];
  if (!target) return null;
  try {
    const raw = await readFile(path.join(DATA_DIR, kind, `${target}.json`), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** 读写「已处理过的条目」缓存，用于只对新出现的条目调用大模型，省钱 */
export async function readJsonCache(name, fallback = {}) {
  try {
    return JSON.parse(await readFile(path.join(DATA_DIR, name), 'utf8'));
  } catch {
    return fallback;
  }
}

export async function writeJsonCache(name, value) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(
    path.join(DATA_DIR, name),
    `${JSON.stringify(value, null, 2)}\n`,
    'utf8',
  );
}

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  hellip: '…', mdash: '—', ndash: '–', middot: '·',
  rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”',
  copy: '©', reg: '®', trade: '™', deg: '°',
};

/** 解码 HTML 实体 */
export function decodeEntities(input = '') {
  return String(input)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => {
      try { return String.fromCodePoint(parseInt(h, 16)); } catch { return ''; }
    })
    .replace(/&#(\d+);/g, (_, d) => {
      try { return String.fromCodePoint(Number(d)); } catch { return ''; }
    })
    .replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (m, name) => NAMED_ENTITIES[name] ?? m);
}

/** 去标签 + 解实体 + 压缩空白 */
export function stripTags(input = '') {
  return decodeEntities(String(input).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** 处理 CDATA 包裹 */
function unwrapCdata(raw = '') {
  return String(raw).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

/** 从一段 XML 里取某个标签的内容 */
function pickTag(block, ...tags) {
  for (const tag of tags) {
    const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
    if (m && m[1].trim()) return m[1];
  }
  return '';
}

/** 从条目里取链接，优先 rel="alternate" 的 Atom 写法 */
function pickLink(block) {
  const atomAlt =
    block.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i) ??
    block.match(/<link[^>]*href=["']([^"']+)["'][^>]*rel=["']alternate["']/i);
  if (atomAlt) return atomAlt[1];
  const atomAny = block.match(/<link[^>]*href=["']([^"']+)["']/i);
  if (atomAny) return atomAny[1];
  const rss = block.match(/<link>([\s\S]*?)<\/link>/i);
  return rss ? stripTags(unwrapCdata(rss[1])) : '';
}

/**
 * 解析 RSS 2.0 / Atom，返回统一结构
 * @returns {{title:string,link:string,publishedAt:string,summary:string}[]}
 */
export function parseFeed(xml, { limit = 20 } = {}) {
  const isAtom = /<entry[\s>]/i.test(xml);
  const splitter = isAtom ? /<entry[\s>]/i : /<item[\s>]/i;
  const closer = isAtom ? '</entry>' : '</item>';
  const blocks = String(xml).split(splitter).slice(1);

  const items = [];
  for (const chunk of blocks) {
    const block = chunk.split(closer)[0];
    const title = stripTags(unwrapCdata(pickTag(block, 'title')));
    const link = pickLink(block);
    const rawDate = stripTags(
      unwrapCdata(pickTag(block, 'pubDate', 'published', 'updated', 'dc:date')),
    );
    const summaryRaw = pickTag(block, 'description', 'summary', 'content:encoded', 'content');
    const summary = stripTags(unwrapCdata(summaryRaw)).slice(0, 400);

    if (!title || !link) continue;
    const parsed = rawDate ? new Date(rawDate) : null;
    items.push({
      title,
      link,
      publishedAt: parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : '',
      summary,
    });
    if (items.length >= limit) break;
  }
  return items;
}

/** 统一格式的日志输出 */
export const log = {
  step: (msg) => console.log(`\n▶ ${msg}`),
  ok: (msg) => console.log(`  ✅ ${msg}`),
  info: (msg) => console.log(`  ·  ${msg}`),
  warn: (msg) => console.warn(`  ⚠️  ${msg}`),
  fail: (msg) => console.error(`  ❌ ${msg}`),
};
