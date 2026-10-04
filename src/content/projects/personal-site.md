---
title: 青苺ちゃん的小窝（本站）
description: 用 Astro 从零手写的个人网站：博客、项目、相册、在线小工具，还有每天自动更新的数据看板。
pubDate: 2026-08-16
tags: ['Astro', 'TypeScript', 'CSS', '静态站点']
repo: 'https://github.com/bqlm0410/bqlm0410-site'
demo: 'https://bqlm0410.top'
cover: '/photos/sample-1.svg'
status: '进行中'
featured: true
order: 1
---

这个小站既是我的自留地，也是我练手的地方：写点东西、收点东西，顺便把折腾过的技术都塞进来试一试。

## 为什么自己写

以前用现成的博客模板，想改个样式要翻遍别人写的组件，加个小功能得先理解一整套抽象。后来索性自己从零搭：一个静态站点生成器、一套 CSS 变量、一点点原生 JavaScript，剩下的全按自己的习惯来。

## 技术选型

- **Astro**：默认零客户端 JavaScript，输出纯静态 HTML，内容站再合适不过
- **CSS 变量做设计系统**：深色模式只换一组变量，全站跟着变，不引入任何 UI 框架
- **内容集合（Content Layer API）**：博客、项目、相册分别建集合，frontmatter 用 zod 校验，字段写错在构建阶段就会报错
- **GitHub Actions**：负责构建部署，顺便每天定时抓取外部数据

## 目录结构

```text
src/
├── components/     # 可复用组件：卡片、页头、页脚……
├── content/        # 博客 / 项目 / 相册的 Markdown
├── layouts/        # 全站基础布局
├── pages/          # 路由即文件
└── styles/         # 设计令牌与全局样式
```

## 接下来想做的

- [ ] 给相册换上真实照片，并自动生成多尺寸缩略图
- [ ] 文章页增加阅读时长与右侧目录
- [ ] 把整站构建时间压到 30 秒以内
