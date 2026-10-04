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

  vite: {
    ssr: {
      /**
       * picomatch 是 CommonJS 包（main: index.js，没有 type: module）。
       * astro/loaders 的 glob 加载器依赖它，但 Vite 的模块运行器会把它当 ESM 求值，
       * 导致 "require is not defined" 而中断内容集合同步。
       * 把它标记为 external，交给 Node 原生 require 处理即可绕开。
       */
      external: ['picomatch'],
    },
  },
});
