// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  // 站点正式地址：决定 sitemap、RSS、canonical 链接里用的域名
  site: 'https://bqlm0410.top',

  integrations: [
    // MDX：博客文章里可以直接写组件，比纯 Markdown 更灵活
    mdx(),
    // 自动生成 sitemap.xml，方便搜索引擎收录
    sitemap(),
  ],

  markdown: {
    shikiConfig: {
      // 代码块高亮主题
      theme: 'github-dark',
      wrap: true,
    },
  },

  // 说明：这里曾经有过一段 `vite.ssr.external: ['picomatch']`，
  // 当时的想法是绕过 astro/loaders 的 glob() 因 picomatch 是 CommonJS
  // 而抛 "require is not defined" 的问题。
  // 但实测【无效】——加了它 astro sync 照样崩，因为 Astro 给内容集合
  // 加载器设了自己的 Vite 配置，会覆盖这里的设置。
  // 真正的解法是换掉加载器（见 src/loaders/markdown.ts），
  // 所以这段配置已删除，避免留下「以为修好了其实没有」的假象。
});
