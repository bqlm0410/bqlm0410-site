/**
 * 全站配置中心
 *
 * 想改站点名字、标语、导航、联系方式，都改这个文件就够了，
 * 不用去每个页面里翻。
 */

export const SITE = {
  /** 站点名，显示在浏览器标签页和页头 */
  title: '青苺ちゃん的小窝',
  /** 一句话标语 */
  tagline: '写点东西，收点东西',
  /** 站点描述，用于 SEO 和首页副标题 */
  description:
    '青苺ちゃん的个人小窝：博客、项目、相册、在线小工具，以及每天自动更新的 GitHub 热门项目与 AI 资讯。',
  /** 正式域名，影响 sitemap / RSS / canonical 链接 */
  url: 'https://bqlm0410.top',
  author: 'Bqlm0410',
  lang: 'zh-CN',
  /** 建站年份，用于页脚版权区间 */
  since: 2026,
  /** 头像图片，放到 public/ 目录下即可 */
  avatar: '/avatar.png',
} as const;

/** 主导航 */
export const NAV = [
  { text: '首页', href: '/' },
  { text: '博客', href: '/blog' },
  { text: '项目', href: '/projects' },
  { text: '相册', href: '/photos' },
  { text: '工具', href: '/tools' },
  { text: '今日热门', href: '/trending' },
  { text: 'AI 资讯', href: '/news' },
  { text: '归档', href: '/archive' },
  { text: '关于', href: '/about' },
] as const;

/** 页脚外链 */
export const SOCIAL = [
  { text: 'GitHub', href: 'https://github.com/bqlm0410' },
  { text: '邮箱', href: 'mailto:h2977494904@outlook.com' },
  { text: 'RSS', href: '/rss.xml' },
] as const;

/** Giscus 评论配置：去 https://giscus.app 生成后填到这里 */
export const GISCUS = {
  enabled: false,
  repo: 'bqlm0410/bqlm0410-site',
  repoId: '',
  category: 'Announcements',
  categoryId: '',
  mapping: 'pathname',
  lang: 'zh-CN',
} as const;
