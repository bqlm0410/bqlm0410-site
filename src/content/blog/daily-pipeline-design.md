---
title: 用 Git 当数据库：我的每日抓取管道设计
description: 不买服务器、不装数据库，靠 GitHub Actions 每天定时抓取，把结果提交回仓库。聊聊这套「土办法」为什么够用。
pubDate: 2026-10-02
tags: ['GitHub Actions', '自动化', '架构']
draft: false
---

站里「今日热门」和「AI 资讯」两个板块的数据，不是我手动整理的。每天凌晨六点，一串没人看着的脚本会自己跑完，然后页面就悄悄变了。

## 整条链路

流程短得有点朴素：

1. GitHub Actions 定时触发（cron 写的是 UTC 时间，换算一下正好是北京时间早上六点）；
2. Node 脚本去抓 GitHub Trending 和几个 RSS 源，顺手做去重、排序、中文摘要；
3. 结果写成一个 JSON 快照，文件名就是当天日期，例如 `2026-10-04.json`；
4. 机器人把文件提交回仓库；
5. 这次提交触发重新构建，新数据就这么上线了。

```yaml
name: 每日抓取

on:
  schedule:
    - cron: '0 22 * * *' # UTC 22:00 = 北京时间次日 6:00
  workflow_dispatch: # 留个手动补跑的开关

jobs:
  fetch:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
      - run: node scripts/fetch-daily.mjs
      - run: |
          git config user.name "github-actions[bot]"
          git add src/data
          git commit -m "chore: 抓取快照 $(date +%F)" || echo "今天没有变化"
          git push
```

## 为什么不用数据库

被问得最多的就是这个。理由其实挺实际：

- **免费**。私有仓库自带的 Actions 额度对我完全够用，也不用养一台 24 小时开机的机器；
- **可追溯**。哪天的数据长什么样，`git log` 一翻就清楚，想回滚就是一次 revert；
- **可复现**。快照是纯文本，`git diff` 一眼就能看出今天多了哪几个项目、谁涨了多少星。

> Git 本来就是一个只追加的日志，我只是把它当成了一张带版本号的表来用。

## 踩过的坑

**抓取失败也得留下记录**。有一次上游改版，脚本连着三天抛异常，而 workflow 因为非零退出码直接中断，那三天连「失败」这件事都没记下来。现在的做法是无论成败都写一份快照，失败时把 `error` 字段填上，页面读到就显示占位文案。

**别让仓库无限膨胀**。一天一个文件看着不多，一年就是 365 个。所以我把 90 天之前的快照按月合并成一份，历史还在，只是换了种存法。

**时区要对齐**。cron 用 UTC，文件名我坚持用北京时间的日期，转换只写在脚本里一处，改的时候不会漏掉别的分支。

## 还差什么

目前没有告警。抓取连续失败其实只能靠我自己发现，后面想加个最简检测：连续三天带 `error` 就给自己发封邮件。

这套东西谈不上优雅，但它零成本、不会宕机、坏了我自己能看懂。对我来说，这就是当下最合适的架构。
