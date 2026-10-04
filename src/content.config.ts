import { defineCollection, z } from 'astro:content';
import { markdownLoader } from './loaders/markdown';

/**
 * 内容集合定义
 *
 * ⚠️ 这里刻意**没有**使用官方的 `astro/loaders` 的 glob()。
 * 原因见 src/loaders/markdown.ts 顶部注释：
 * 官方 glob 加载器顶层 import 了 CommonJS 的 picomatch，
 * 在 Vite 模块运行器里会抛 "require is not defined" 把构建整个打挂。
 *
 * 以后想加一类新内容（比如「书单」），照下面的写法加一个集合，
 * 再在 src/content/ 下建同名目录即可。
 */

/** 博客文章：src/content/blog/xxx.md */
const blog = defineCollection({
  loader: markdownLoader({ base: 'src/content/blog' }),
  schema: z.object({
    title: z.string(),
    description: z.string().default(''),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    tags: z.array(z.string()).default([]),
    cover: z.string().optional(),
    /** 草稿不会出现在列表和构建产物里 */
    draft: z.boolean().default(false),
  }),
});

/** 项目 / 作品：src/content/projects/xxx.md */
const projects = defineCollection({
  loader: markdownLoader({ base: 'src/content/projects' }),
  schema: z.object({
    title: z.string(),
    description: z.string().default(''),
    pubDate: z.coerce.date(),
    tags: z.array(z.string()).default([]),
    /** 源码地址 */
    repo: z.string().optional(),
    /** 在线演示地址 */
    demo: z.string().optional(),
    cover: z.string().optional(),
    status: z.enum(['进行中', '已完成', '维护中', '已归档']).default('已完成'),
    /** 是否在首页重点展示 */
    featured: z.boolean().default(false),
    /** 排序权重，越小越靠前 */
    order: z.number().default(100),
  }),
});

/** 相册：src/content/photos/xxx.md */
const photos = defineCollection({
  loader: markdownLoader({ base: 'src/content/photos' }),
  schema: z.object({
    title: z.string().default(''),
    /** 图片地址，放在 public/photos/ 下就写 /photos/xxx.jpg */
    src: z.string(),
    alt: z.string().default(''),
    caption: z.string().default(''),
    date: z.coerce.date(),
    location: z.string().default(''),
    tags: z.array(z.string()).default([]),
  }),
});

export const collections = { blog, projects, photos };
