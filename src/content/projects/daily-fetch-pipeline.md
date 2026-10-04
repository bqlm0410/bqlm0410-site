---
title: 每日抓取管道：GitHub 热门 + AI 资讯
description: 用 Node 脚本配合 GitHub Actions，每天北京时间 6 点抓取 GitHub Trending 与 AI 新闻，清洗后生成站内 JSON 快照。
pubDate: 2026-09-02
tags: ['Node.js', 'GitHub Actions', '数据抓取', '自动化']
repo: 'https://github.com/bqlm0410/bqlm0410-site/tree/main/scripts'
cover: '/photos/sample-3.svg'
status: '维护中'
featured: true
order: 2
---

## 想解决什么问题

每天刷 GitHub Trending 和几个 AI 资讯站挺费时间，信息还散在不同页面里。于是写了一条管道：定时把数据抓下来、去重、压成一句中文摘要，最后以 JSON 快照的形式提交进仓库——站点构建时直接读文件，完全不依赖运行时接口。

## 执行流程

1. **抓取**：请求 GitHub Trending 列表页与若干 AI 资讯源的 RSS
2. **清洗**：剔除重复仓库，按当日新增 star 排序，过滤广告与低质量条目
3. **摘要**：把英文标题和简介压缩成一句中文，控制在前 60 字内
4. **落盘**：写入 `src/data/` 下以日期命名的 JSON，由机器人自动提交

## 定时任务

```yaml
on:
  schedule:
    # 北京时间 6:00 == UTC 22:00
    - cron: '0 22 * * *'
  workflow_dispatch:
```

## 踩过的坑

- 未认证的 GitHub 接口每小时只有 60 次配额，脚本必须带上 Token，并且对失败请求做重试
- 快照文件名用 UTC 日期，展示给读者时再换算成本地日期，否则会出现「今天的数据标着昨天」
- 摘要这一步偶尔会失败，所以整条管道设计成「摘要可缺省」：拿不到就退回原文，不让任务整体挂掉

## 后续计划

- [ ] 把摘要结果缓存起来，同一仓库不重复调用模型
- [ ] 增加历史趋势图，看看哪些项目连续多日上榜
