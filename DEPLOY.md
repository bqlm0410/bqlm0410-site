# 上线检查清单

站点代码已经全部就绪并验证完毕，剩下的都是**在浏览器里点几下**的事。
按顺序做完下面这些，`https://bqlm0410.top` 就正式上线了。

---

## 🔴 第 1 步：给域名续费（最紧急）

`bqlm0410.top` 的注册商是 **NameSilo**，到期日 **2026-11-15**。

1. 登录 https://www.namesilo.com → **Domain Manager**
2. 找到 `bqlm0410.top`，确认状态是 **Active**
3. **打开 Auto-Renew（自动续费）** ← 这一步最重要，开了就一劳永逸
4. 顺便确认 `Account Settings` 里的注册邮箱是你常用的那个
   （以后续费提醒、找回密码都靠它）

> ⚠️ 域名过期后有 30 天宽限期，之后进入赎回期（费用是续费的十倍以上），
> 再之后就会被释放给别人注册。**这是整个项目里唯一不可逆的损失。**

---

## 🔴 第 2 步：部署到 Cloudflare Pages

1. 打开 https://dash.cloudflare.com
2. 左侧 **Workers 和 Pages** → **创建** → 选 **Pages** 标签 → **连接到 Git**
3. 首次会让你授权 GitHub，选中仓库 **`bqlm0410-site`** → **开始设置**
4. 按下表填构建配置：

   | 字段 | 填什么 |
   |---|---|
   | 项目名称 | `bqlm0410-site` |
   | 生产分支 | `main` |
   | 框架预设 | **Astro** |
   | 构建命令 | `npm run build` |
   | 构建输出目录 | `dist` |
   | 环境变量 | `NODE_VERSION` = `22` |

5. 点 **保存并部署**，等 1~2 分钟

**构建成功的标志**（日志里能看到）：

```
[build] 23 page(s) built in ~1s
[build] Complete!
Running Pagefind v1.5.2
Indexed 23 pages
```

这时 `bqlm0410-site.pages.dev` 已经可以访问了。

---

## 🔴 第 3 步：绑定自定义域名

在 Pages 项目里 → **自定义域** 标签：

1. **设置自定义域** → 输入 `bqlm0410.top` → 保存
   （因为你的 DNS 已经在 Cloudflare，它会**自动加好解析记录**）
2. 重复一次，添加 `www.bqlm0410.top`
   （仓库里的 `public/_redirects` 会让 www 自动 301 跳到主域名）

**HTTPS 证书由 Cloudflare 自动签发和续期，不需要任何操作。**
`bqlm0410.top` 是海外域名 + 海外托管，**完全不需要备案**。

---

## 🔴 第 4 步：打开 Actions 写权限

每日抓取任务需要把数据提交回仓库，所以必须有写权限：

GitHub 仓库 → **Settings** → **Actions** → **General** → 拉到底部
→ **Workflow permissions** → 选 **Read and write permissions** → 保存

> 不做这一步，每天 6:00 的抓取会成功但**提交失败**，数据进不了仓库。

---

## 🟡 第 5 步：配置 DeepSeek 中文摘要（可选）

不配也能跑，只是抓来的内容没有中文摘要，页面上显示英文原文。

GitHub 仓库 → **Settings** → **Secrets and variables** → **Actions**
→ **New repository secret**

- Name: `DEEPSEEK_API_KEY`
- Secret: 你的 Key

配好之后，下次抓取会自动为**新出现的**条目生成中文标题与摘要
（结果缓存在 `src/data/.summary-cache.json`，同一条内容永远只调用一次，很省钱）。

---

## 🟡 第 6 步：开启评论（可选）

Giscus 靠 GitHub Discussions 存评论，所以：

1. **仓库必须是公开的**（已经是了 ✅）
2. 仓库 → **Settings** → **General** → **Features** → 勾选 **Discussions**
3. 安装 Giscus App：https://github.com/apps/giscus ，授权给这个仓库
4. 打开 https://giscus.app ，填入仓库名，页面会生成两个 ID：
   - `data-repo-id` → 填进 `src/consts.ts` 的 `GISCUS.repoId`
   - `data-category-id` → 填进 `src/consts.ts` 的 `GISCUS.categoryId`
5. 把 `src/consts.ts` 里的 `GISCUS.enabled` 改成 `true`，提交推送

> 没配置时评论区**完全静默**：不渲染任何元素、不报错、不加载外部脚本。

---

## 🟡 第 7 步：开启访问统计（可选）

1. Cloudflare 控制台 → **Analytics & Logs** → **Web Analytics** → **Add a site**
2. 填 `bqlm0410.top`（纯前端 JS 统计，不需要改 DNS）
3. 创建后会给你一段带 token 的脚本，把 **token** 的值抄下来
4. Pages 项目 → **Settings** → **Environment variables** 加一条：
   - `PUBLIC_CF_BEACON_TOKEN` = 你的 token
   - （Production 和 Preview 都加）
5. 重新部署一次

> 不配置时统计脚本**完全不加载**，不会产生无效请求，也不会污染别人账号的数据。

---

## 🟢 第 8 步：换成你自己的内容

| 想改什么 | 改哪里 |
|---|---|
| 站点名、标语、导航、社交链接 | `src/consts.ts` |
| 头像 | 把图片放到 `public/avatar.png`（首页会自动用它，没有则显示渐变占位圆） |
| 写新文章 | `npm run new:post -- "文章标题"`，然后编辑生成的 md |
| 项目 / 相册 | `src/content/projects/`、`src/content/photos/` 下加 md |
| 关于我 | `src/pages/about.astro` |
| 配色 | `src/styles/global.css` 顶部的 CSS 变量 |
| 相册换真图 | 图片放 `public/photos/`，改 md 里的 `src` 字段（或直接同名替换占位图） |

---

## 上线后怎么更新

**改内容**：本地改 → `git push` → Cloudflare 自动重新构建部署。

**每日数据**：完全自动。GitHub Actions 每天北京时间 6:00 抓取并提交，
Cloudflare 检测到提交后自动重建。你什么都不用做。

**想手动跑一次抓取**：仓库 → **Actions** → **每日数据抓取** → **Run workflow**。

---

## 出问题了怎么办

| 现象 | 大概率原因 |
|---|---|
| 构建失败，提示 `npm ci` 相关 | 检查 `.npmrc` 有没有被人改回国内镜像（Cloudflare 在境外，连国内源会超时） |
| 构建失败，提示 Node 版本 | 确认建了 `NODE_VERSION=22` 环境变量 |
| 页面能开但样式全无 | 构建输出目录填错了，必须是 `dist` |
| 每天数据不更新 | 第 4 步的 Workflow permissions 没开 |
| 评论区空白 | `GISCUS.enabled` 没改成 true，或 repoId/categoryId 没填 |
| 搜索页提示"索引尚未生成" | 构建命令必须是 `npm run build`（它包含 Pagefind 建索引那一步），不能用 `astro build` |
