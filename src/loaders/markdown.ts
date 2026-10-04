/**
 * 自研 Markdown 内容加载器
 *
 * ── 为什么不用官方的 `astro/loaders` 的 glob() ──
 *
 * 1. 官方 glob.js 第 6 行有 `import picomatch from "picomatch"`，
 *    而 picomatch 是 CommonJS 包（main: index.js，没有 type: module）。
 *    Vite 的模块运行器把它当 ESM 求值时，`require` 不存在，直接抛
 *    "require is not defined"，导致 astro sync / astro build 整个崩掉。
 *
 * 2. 更讽刺的是：picomatch 在 glob.js 里**只被 dev 模式的文件监听器用到**
 *    （第 251 行的 matchesGlob，位于 `if (!watcher) return` 之后），
 *    构建期压根不需要它 —— 却因为顶层 import 把构建一起拖死了。
 *
 * 3. 这个坑在 CI（Cloudflare Pages 全新安装依赖）上会原样复现，
 *    所以不能靠改 node_modules 或改本地配置绕过，必须换掉加载器。
 *
 * ── 本加载器的原则 ──
 *
 * 只依赖 node: 内置模块（fs / path / url），不 import 任何第三方包，
 * 因此永远不可能重蹈覆辙。frontmatter 用一个覆盖站点实际用法的轻量解析器，
 * 渲染交给官方 LoaderContext 提供的 renderMarkdown()。
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/* ------------------------------------------------------------------ */
/* 类型（本地声明，避免 import 'astro/loaders' 而把 picomatch 拉进来）  */
/* ------------------------------------------------------------------ */

interface LoaderStore {
  set(entry: Record<string, unknown>): void;
  keys(): Iterable<string>;
  delete(id: string): void;
}

interface LoaderContextLike {
  store: LoaderStore;
  config: { root: URL };
  logger: {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
  };
  parseData(props: {
    id: string;
    data: Record<string, unknown>;
    filePath?: string;
  }): Promise<Record<string, unknown>>;
  generateDigest(data: Record<string, unknown> | string): string;
  renderMarkdown(
    content: string,
    options?: { fileURL?: URL },
  ): Promise<{ metadata?: { imagePaths?: string[] } } | undefined>;
}

export interface MarkdownLoaderOptions {
  /** 相对项目根目录的内容目录，例如 'src/content/blog' */
  base: string;
  /** 找不到目录时是否只警告不报错，默认 true */
  soft?: boolean;
}

/* ------------------------------------------------------------------ */
/* 轻量 YAML frontmatter 解析器                                        */
/* ------------------------------------------------------------------ */

/** 解析单个标量值：引号字符串 / 布尔 / 数字 / null / 内联数组 / 普通字符串 */
function parseScalar(raw: string): unknown {
  const value = raw.trim();

  if (value === '' || value === '~' || value === 'null') return '';

  // 引号包裹的字符串：原样取内部内容，不处理行尾注释
  if (value.startsWith('"') || value.startsWith("'")) {
    const quote = value[0];
    const end = value.lastIndexOf(quote);
    if (end > 0) return value.slice(1, end);
    return value.slice(1);
  }

  // 内联数组 [a, b, c]
  if (value.startsWith('[') && value.endsWith(']')) {
    return value
      .slice(1, -1)
      .split(',')
      .map((item) => parseScalar(item))
      .filter((item) => item !== '');
  }

  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+$/.test(value)) return Number(value);
  if (/^-?\d*\.\d+$/.test(value)) return Number(value);

  // 普通字符串：去掉行尾注释
  return value.replace(/\s+#.*$/, '').trim();
}

/** 解析站点内容用到的 YAML 子集（键值对 / 内联数组 / 块状列表 / 块标量） */
export function parseFrontmatter(source: string): {
  data: Record<string, unknown>;
  body: string;
} {
  const match = source.match(/^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!match) return { data: {}, body: source };

  const rawFrontmatter = match[1];
  const body = source.slice(match[0].length);
  const data: Record<string, unknown> = {};
  const lines = rawFrontmatter.split(/\r?\n/);

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    i += 1;

    if (!line.trim() || /^\s*#/.test(line)) continue;

    const kv = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!kv) continue;

    const key = kv[1];
    const rest = kv[2].trim();

    // 值在同一行 → 直接解析
    if (rest !== '' && rest !== '|' && rest !== '>') {
      data[key] = parseScalar(rest);
      continue;
    }

    // 值在后续缩进行里 → 收集
    const collected: string[] = [];
    while (i < lines.length && lines[i].trim() !== '' && /^\s/.test(lines[i])) {
      collected.push(lines[i]);
      i += 1;
    }

    if (collected.length === 0) {
      data[key] = '';
      continue;
    }

    // 块状列表
    if (collected.every((l) => /^\s*-\s/.test(l))) {
      data[key] = collected.map((l) => parseScalar(l.replace(/^\s*-\s*/, '')));
      continue;
    }

    // 块标量：按最小缩进还原多行文本
    const indents = collected
      .filter((l) => l.trim() !== '')
      .map((l) => (l.match(/^\s*/)?.[0] ?? '').length);
    const indent = indents.length ? Math.min(...indents) : 0;
    data[key] = collected
      .map((l) => l.slice(indent))
      .join('\n')
      .trim();
  }

  return { data, body };
}

/* ------------------------------------------------------------------ */
/* 加载器本体                                                          */
/* ------------------------------------------------------------------ */

/** 递归找出目录下所有 .md / .mdx 文件 */
async function walk(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const found: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await walk(full)));
    } else if (/\.mdx?$/i.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

export function markdownLoader({ base, soft = true }: MarkdownLoaderOptions) {
  return {
    name: 'local-markdown-loader',
    load: async (context: LoaderContextLike) => {
      const { store, config, logger, parseData, generateDigest, renderMarkdown } = context;

      const baseDir = new URL(base.endsWith('/') ? base : `${base}/`, config.root);
      const basePath = fileURLToPath(baseDir);
      const rootPath = fileURLToPath(config.root);

      const files = (await walk(basePath)).sort();

      if (files.length === 0) {
        if (soft) {
          logger.warn(`内容目录 ${base} 下没有 Markdown 文件（这是允许的，集合将为空）`);
        } else {
          logger.error(`内容目录 ${base} 不存在或为空`);
        }
        return;
      }

      const seen = new Set<string>();

      for (const filePath of files) {
        const contents = await fs.readFile(filePath, 'utf-8');
        const { data, body } = parseFrontmatter(contents);

        const relative = path.relative(basePath, filePath).split(path.sep).join('/');
        const id = relative.replace(/\.mdx?$/i, '');
        const filePathFromRoot = path
          .relative(rootPath, filePath)
          .split(path.sep)
          .join('/');

        const digest = generateDigest(contents);
        const parsedData = await parseData({ id, data, filePath: filePathFromRoot });

        let rendered;
        try {
          rendered = await renderMarkdown(body, { fileURL: pathToFileURL(filePath) });
        } catch (error) {
          logger.error(`渲染 ${relative} 失败：${(error as Error).message}`);
        }

        store.set({
          id,
          data: parsedData,
          body,
          filePath: filePathFromRoot,
          digest,
          rendered,
          assetImports: rendered?.metadata?.imagePaths,
        });

        seen.add(id);
      }

      // 清掉已经不存在于磁盘上的旧条目（比如删掉的文章）
      for (const id of store.keys()) {
        if (!seen.has(id)) store.delete(id);
      }

      logger.info(`已从 ${base} 载入 ${seen.size} 条内容`);
    },
  };
}
