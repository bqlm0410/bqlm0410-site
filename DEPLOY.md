# 部署与运维手册

> 最后更新：2026-10-04 · 站点已上线

## 当前状态

| 项目 | 状态 |
|---|---|
| 站点地址 | **https://bqlm0410.top** ✅ 已上线 |
| HTTPS | ✅ Google Trust Services 证书，有效期至 2027-01-02，自动续期 |
| www 跳转 | ✅ `www.bqlm0410.top` 301 → `bqlm0410.top`（Cloudflare Page Rule） |
| 托管 | Cloudflare Pages，项目名 `bqlm0410-site` |
| 备用地址 | https://bqlm0410-site.pages.dev |
| 代码仓库 | https://github.com/bqlm0410/bqlm0410-site |
| 自动部署 | ✅ 推送 `main` 触发 `.github/workflows/deploy.yml` |
| 每日抓取 | ✅ 每天北京时间 6:00 抓取 → 提交 → 触发部署 |
| **域名续费** | ❌ **未完成**，到期日 2026-11-15 |

---

## 部署是怎么工作的

本站**没有走 Cloudflare 控制台的 Git 集成**（那一步必须网页 OAuth 授权），
而是用 Cloudflare Pages 的「直接上传」+ 自己的 GitHub Actions 工作流：

```
你修改内容 → git push
                ↓
     .github/workflows/deploy.yml 触发
                ↓
   npm ci → npm run build（含 Pagefind 建索引）
                ↓
   wrangler pages deploy dist → Cloudflare Pages
                ↓
           https://bqlm0410.top 更新
```

每日抓取产生的数据提交，同样会触发这条链路，所以**网站是自动更新的**。

### 依赖的仓库 Secrets

| Secret | 用途 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | 部署用的 Cloudflare Token（权限：Cloudflare Pages 编辑） |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 账号 ID |

> Token 只授予了 Pages 权限，是**最小权限**配置。
> 如果要换 Token，记得同时更新这个 Secret。

---

## 你还需要做的事

### 🔴 给域名续费（唯一紧急项）

`bqlm0410.top` 注册商是 **NameSilo**，到期日 **2026-11-15**。

1. 登录 https://www.namesilo.com → **Domain Manager**
2. 找到 `bqlm0410.top`，确认状态 **Active**
3. **打开 Auto-Renew（自动续费）** ← 最重要
4. 确认账号邮箱是你常用的那个

> 域名过期后有 30 天宽限期，之后进入赎回期（费用是续费的十倍以上），
> 再之后会被释放给别人注册。**这是整个项目唯一不可逆的损失。**

### 🟡 可选配置

| 功能 | 怎么配 | 不配的后果 |
|---|---|---|
| **DeepSeek 中文摘要** | 仓库 Settings → Secrets and variables → Actions → 新建 `DEEPSEEK_API_KEY` | 抓来的内容显示英文原文 |
| **Giscus 评论** | 仓库 Settings → Features 勾选 Discussions；去 https://giscus.app 拿两个 ID 填进 `src/consts.ts` 的 `GISCUS`，并把 `enabled` 改成 `true` | 评论区静默不显示 |
| **访问统计** | Cloudflare 控制台 → Analytics & Logs → Web Analytics 拿 token；加到 Pages 项目环境变量 `PUBLIC_CF_BEACON_TOKEN` | 不加载统计脚本 |
| **头像** | 图片命名为 `avatar.png` 放进 `public/` | 首页显示渐变占位圆 |

---

## 日常怎么改内容

| 想改什么 | 改哪里 |
|---|---|
| 站点名、标语、导航、社交链接 | `src/consts.ts` |
| 写新文章 | `npm run new:post -- "文章标题"`，然后编辑生成的 md |
| 项目 / 相册 | `src/content/projects/`、`src/content/photos/` 下加 md |
| 关于我 | `src/pages/about.astro` |
| 配色 | `src/styles/global.css` 顶部的 CSS 变量 |
| 相册换真图 | 图片放 `public/photos/`，改 md 里的 `src` 字段 |

改完 `git push` 就会自动部署，不需要任何手动操作。

**本地预览**：`npm run build` 之后，可以起一个本地服务器看效果：

```bash
node ../_preview-server.mjs      # http://127.0.0.1:4321
```

---

## 每日抓取管道

```
每天北京时间 6:00
      ↓
.github/workflows/daily-fetch.yml
      ↓
scripts/fetch-github.mjs  →  src/data/github-trending/YYYY-MM-DD.json
scripts/fetch-news.mjs    →  src/data/ai-news/YYYY-MM-DD.json
      ↓
（可选）调用 DeepSeek 生成中文摘要，缓存于 src/data/.summary-cache.json
      ↓
自动 git commit + push  →  触发 deploy.yml  →  网站更新
```

**为什么历史记录不会丢？** 每天是**新增一个以日期命名的文件**，不是覆盖旧文件。
Git 里保留着每一次提交，页面上也能翻看任意一天。

某个源抓取失败时，脚本会沿用上一次的数据并在页面标注，不会出现空白页。

**手动跑一次**：仓库 → Actions → 每日数据抓取 → Run workflow。

---

## 出问题时怎么排查

| 现象 | 大概率原因 |
|---|---|
| 推送后网站没更新 | 去 Actions 看 `部署到 Cloudflare Pages` 是否失败；检查两个 Cloudflare Secrets 是否还在 |
| 构建失败提示 `npm ci` | `.npmrc` 有没有被人改回国内镜像（Cloudflare 和 GitHub 都在境外，连国内源会超时） |
| 构建失败提示 Node 版本 | 检查 `.nvmrc` / `.node-version` / `NODE_VERSION` 环境变量都没被改动 |
| 页面能开但样式全无 | 构建输出目录必须是 `dist` |
| 每天数据不更新 | 仓库 Settings → Actions → General → Workflow permissions 要选 **Read and write** |
| 搜索页提示"索引尚未生成" | 构建命令必须是 `npm run build`（它包含 Pagefind 建索引），不能用 `astro build` |
| `www` 不跳转 | Cloudflare 控制台 → 规则 → Page Rules，确认那条 301 规则还在 |

---

## 技术上的几个坑（给未来的自己）

1. **不要用 `astro/loaders` 的 `glob()`**。
   它顶层 `import picomatch`，而 picomatch 是 CommonJS 包，
   在 Vite 的模块运行器里会抛 `require is not defined`，把构建整个打挂。
   本项目改用自研的 `src/loaders/markdown.ts`，只依赖 node 内置模块。

2. **`pagefind` 必须在 `dependencies` 里，不能放 `devDependencies`**。
   Cloudflare 构建时会设 `NODE_ENV=production`，`npm ci` 在该变量下会跳过
   devDependencies，导致 `pagefind --site dist` 找不到命令。

3. **Cloudflare Pages 的 `_redirects` 不能跨自定义域做跳转**。
   `https://www.bqlm0410.top/* https://bqlm0410.top/:splat 301` 实测不生效，
   已改用 Zone 级 Page Rule 实现。

4. **`package-lock.json` 的 `resolved` 地址要指向 npm 官方源**。
   国内镜像会让境外构建机拉包超时。已抽样 12 个包重算 sha512 验证过，
   镜像记录的 integrity 与官方源逐字节一致。

5. **Astro 模板里的 `<!-- -->` 会被原样输出到页面源码**。
   开发笔记请用 `{/* */}`，否则访客查看源代码就能看到。
