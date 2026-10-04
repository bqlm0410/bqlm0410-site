# 青苺ちゃん的小窝

个人网站，部署在 [bqlm0410.top](https://bqlm0410.top)。

## 这个站有什么

| 板块 | 路径 | 说明 |
|---|---|---|
| 首页 | `/` | 自我介绍 + 各板块入口 |
| 博客 | `/blog` | Markdown 写作，支持标签、上下篇、RSS |
| 项目 | `/projects` | 作品展示，带详情页 |
| 相册 | `/photos` | 照片墙 + 点击放大的灯箱 |
| 小工具 | `/tools` | 在线小工具，纯浏览器本地计算 |
| 今日热门 | `/trending` | GitHub Trending + Star 总榜 Top 100 |
| AI 资讯 | `/news` | 每天自动抓取的 AI 领域资讯 |
| 归档 | `/archive` | 按月份翻看所有历史抓取记录 |
| 搜索 | `/search` | Pagefind 全文搜索 |

## 常用命令

```bash
npm run dev            # 本地开发，http://localhost:4321
npm run build          # 构建 + 生成搜索索引
npm run preview        # 预览构建结果
npm run fetch:all      # 手动跑一次每日抓取
```

## 怎么写一篇文章

在 `src/content/blog/` 下新建一个 `.md` 文件，例如 `my-post.md`：

```markdown
---
title: 文章标题
description: 一句话摘要，会显示在列表页和搜索结果里
pubDate: 2026-10-04
tags: ['随笔']
draft: false
---

正文从这里开始，正常写 Markdown 就行。
```

文件名（去掉 `.md`）就是网址：`my-post.md` → `/blog/my-post/`。
`draft: true` 的文章不会出现在网站上。

## 怎么加一个新页面

在 `src/pages/` 下新建一个 `.astro` 文件就是一个新网址：

- `src/pages/books.astro` → `/books`
- `src/pages/books/index.astro` → `/books`

页面的基本骨架：

```astro
---
import BaseLayout from '../layouts/BaseLayout.astro';
import PageHeader from '../components/PageHeader.astro';
---

<BaseLayout title="页面标题" description="页面描述">
  <PageHeader title="页面标题" description="副标题" />
  <!-- 你的内容 -->
</BaseLayout>
```

想加进顶部导航，改 `src/consts.ts` 里的 `NAV` 数组。

## 每日抓取是怎么工作的

```
每天北京时间 6:00
      ↓
GitHub Actions 定时任务（.github/workflows/daily-fetch.yml）
      ↓
scripts/fetch-github.mjs  →  src/data/github-trending/YYYY-MM-DD.json
scripts/fetch-news.mjs    →  src/data/ai-news/YYYY-MM-DD.json
      ↓
（可选）调用 DeepSeek 生成中文摘要，结果缓存在 src/data/.summary-cache.json
      ↓
自动 git commit + push
      ↓
Cloudflare Pages 检测到更新 → 自动重新构建部署
```

**为什么历史记录不会丢？**
因为每天是**新增一个以日期命名的文件**，而不是覆盖旧文件。
想看哪天就翻哪天，Git 里也留着完整的每一次提交。

某个源抓取失败时，脚本会用上一次的数据顶上并在页面上标出来，
绝对不会出现「页面空白」或者「历史被清空」的情况。

## 环境变量

见 `.env.example`。两个可选项：

- `PUBLIC_CF_BEACON_TOKEN` —— Cloudflare 访问统计，不填就不加载
- `DEEPSEEK_API_KEY` —— 中文摘要，不填就显示英文原文

线上定时抓取用的 `DEEPSEEK_API_KEY` 要配在
GitHub 仓库的 `Settings → Secrets and variables → Actions` 里。

## 需要手动配置的东西

- [ ] **Giscus 评论**：去 https://giscus.app 生成 `repoId` / `categoryId`，
      填进 `src/consts.ts` 的 `GISCUS`，并把 `enabled` 改成 `true`
      （前提：仓库是公开的，且已在 Settings 里打开 Discussions）
- [ ] **访问统计**：Cloudflare Web Analytics 拿 token，配到环境变量
- [ ] **头像**：把你的头像图片放到 `public/avatar.png`，首页会自动用它

## 技术栈

- **Astro** —— 静态站点框架，输出纯 HTML
- **Cloudflare Pages** —— 免费托管 + 全球 CDN + 自动 HTTPS
- **GitHub Actions** —— 每日定时抓取
- **Pagefind** —— 纯静态全文搜索
- **Giscus** —— 基于 GitHub Discussions 的评论

## 已知的坑（给未来的自己）

1. **不要用 `astro/loaders` 的 `glob()`**。
   它顶层 `import picomatch`，而 picomatch 是 CommonJS 包，
   在 Vite 的模块运行器里会抛 `require is not defined`，把构建整个打挂。
   本项目改用自研的 `src/loaders/markdown.ts`，只依赖 node 内置模块。
2. **`package-lock.json` 里的下载地址指向 npm 官方源**，
   不要改成国内镜像 —— Cloudflare Pages 在境外构建，锁国内源会超时。
   国内本地开发觉得慢的话，在自己机器上执行一次
   `npm config set registry https://registry.npmmirror.com` 即可（用户级配置，不影响 CI）。
3. **构建必须让 esbuild 起子进程**，在某些受限沙箱里会因为
   无法使用命名管道而报 `spawn EPERM`，正常机器上没这个问题。
