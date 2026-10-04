/**
 * RSS 订阅源：/rss.xml
 *
 * 规则：
 *   - 只收录非草稿文章（draft: true 的直接跳过）
 *   - 按发布时间倒序，最多取最近 20 篇
 *   - 中文站点，channel 里补上 <language>zh-CN</language>
 *
 * 站点地址取自 astro.config.mjs 的 site 字段，所以这里不用硬写域名。
 */
import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import { SITE } from '../consts';

export async function GET(context) {
  const posts = (await getCollection('blog'))
    .filter((post) => !post.data.draft)
    .sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf())
    .slice(0, 20);

  return rss({
    title: SITE.title,
    description: SITE.description,
    site: context.site ?? SITE.url,

    // channel 级别的补充信息：语言、版权、生成器
    customData: [
      '<language>zh-CN</language>',
      `<copyright>© ${SITE.since} ${SITE.author}</copyright>`,
      '<generator>Astro</generator>',
    ].join(''),

    items: posts.map((post) => ({
      title: post.data.title,
      // 摘要用 frontmatter 里的 description，够短也够清楚
      description: post.data.description,
      pubDate: post.data.pubDate,
      link: `/blog/${post.id}/`,
      categories: post.data.tags,
      author: SITE.author,
    })),
  });
}
