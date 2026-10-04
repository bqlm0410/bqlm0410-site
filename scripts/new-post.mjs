/**
 * 快速新建一篇博客文章
 *
 * 用法：
 *   npm run new:post -- "我的第一篇随笔"
 *   npm run new:post -- "我的第一篇随笔" my-first-post
 *
 * 会在 src/content/blog/ 下生成一个带好 frontmatter 的 .md 文件，
 * 直接打开写正文就行，不用记 frontmatter 有哪些字段。
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BLOG_DIR = path.join(ROOT, 'src', 'content', 'blog');

const [title, slugArg] = process.argv.slice(2);

if (!title) {
  console.error('用法：npm run new:post -- "文章标题" [自定义slug]');
  process.exit(1);
}

/** 北京时间 */
function beijingToday() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

/** 标题 → 文件名。中文标题没法自动转拼音，就退化成日期命名 */
function toSlug(input) {
  const ascii = input
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
  return ascii || `post-${beijingToday()}`;
}

const slug = slugArg ? toSlug(slugArg) : toSlug(title);
const file = path.join(BLOG_DIR, `${slug}.md`);

try {
  await fs.access(file);
  console.error(`❌ 文件已存在，换个 slug 吧：${path.relative(ROOT, file)}`);
  process.exit(1);
} catch {
  // 不存在才继续
}

const template = `---
title: ${title}
description: 一句话说清这篇写了什么，会显示在列表页和搜索结果里。
pubDate: ${beijingToday()}
tags: ['随笔']
draft: true        # 写完了改成 false（或者删掉这行）才会发布
---

正文从这里开始。

## 一个小标题

正常写 Markdown 就行：

- 列表项
- 列表项

\`\`\`js
console.log('代码块也有高亮');
\`\`\`

> 引用块长这样。
`;

await fs.mkdir(BLOG_DIR, { recursive: true });
await fs.writeFile(file, template, 'utf8');

console.log('✅ 已创建文章：');
console.log(`   ${path.relative(ROOT, file)}`);
console.log(`   网址将是：/blog/${slug}/`);
console.log('');
console.log('   ⚠️  默认 draft: true（草稿状态，不会发布）');
console.log('       写完后把 draft 改成 false 再提交。');
