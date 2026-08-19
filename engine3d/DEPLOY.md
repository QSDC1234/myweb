# 部署指南

本项目是一个**纯静态、零后端、零构建**的前端 3D 应用。**只需要把 `public/` 目录上传到任意静态托管平台即可**，不需要服务器、不需要 Node.js 运行时、不需要数据库。

## 关键结论

- ✅ 可直接静态部署
- ✅ 无后端功能（`server.js` 仅用于本地开发预览，部署时不需要）
- ✅ 无外部资源（没有 Three.js / 模型文件 / 纹理 / 字体 / CDN）
- ✅ 全部使用相对路径（`css/style.css`、`js/app.js`、`./xxx.js`），无 `localhost`、无本机绝对路径
- ✅ 子路径可用（可部署在 `https://example.com/repo/` 这类非根路径下）
- ⚠️ 必须通过 **HTTP** 访问（ES Modules 不能用 `file://` 双击打开）

## 目录结构

```
engine3d/
├── public/            ← ★ 要部署的网站根目录（只部署这个文件夹！）
│   ├── index.html
│   ├── css/style.css
│   └── js/*.js
├── server.js          ← 仅本地开发用（可忽略）
├── test/              ← 仅开发自检用（可忽略）
├── package.json       ← 仅 Node 测试用（可忽略）
├── netlify.toml       ← Netlify 配置
├── vercel.json        ← Vercel 配置
└── .github/workflows/deploy-pages.yml  ← GitHub Pages 自动部署
```

## 为什么 `localhost:8090` 不是公开网站

`localhost` 只在你自己的电脑上有效。要让别人通过互联网访问，必须把 `public/` 里的文件上传到一个公网静态托管平台。

## 部署方式（任选其一，推荐 Netlify / Vercel，最省事）

### 方案 A：Netlify（推荐，拖拽即可）

1. 打开 https://app.netlify.com 并注册/登录。
2. **把 `public/` 文件夹整体拖入** Netlify 的部署面板（或关联 Git 仓库，配置会自动读取 `netlify.toml`）。
3. 部署完成后得到一个 `https://xxx.netlify.app` 网址，直接访问即可。

### 方案 B：Vercel（推荐）

1. 打开 https://vercel.com 并登录。
2. 关联 Git 仓库，导入本项目（`vercel.json` 已指定输出目录为 `public`）。
3. 或用命令行：`npm i -g vercel` 后，在项目根目录执行 `vercel deploy public`。
4. 得到一个 `https://xxx.vercel.app` 网址。

### 方案 C：GitHub Pages（免费，自动部署）

1. 把本项目推送到 GitHub 仓库（注意仓库里已包含 `.github/workflows/deploy-pages.yml`）。
2. 进入仓库 → Settings → Pages → Source 选择 **GitHub Actions**。
3. 每次 `git push` 到 `main` 分支，GitHub Actions 会自动把 `public/` 部署到 Pages。
4. 访问 `https://你的用户名.github.io/仓库名/`。

> 说明：工作流用官方 `upload-pages-artifact` 直接上传 `public/`，无需改名为 `docs`，也不需要 Jekyll。

### 方案 D：Cloudflare Pages

1. 打开 https://pages.cloudflare.com 并登录。
2. 新建项目 → 关联仓库；构建命令留空，输出目录填 **`public`**。
3. 部署后得到 `https://xxx.pages.dev`。

### 方案 E：任意静态托管 / 对象存储 / 自建服务器

- **阿里云 OSS / 腾讯云 COS / AWS S3**：开启「静态网站托管」，把 `public/` 里所有文件设为网站根目录。
- **Nginx**：把 `public/` 作为 `root`，并确保 `.js` 以 `text/javascript`（或 `application/javascript`）返回（Nginx 默认即可）。
- **宝塔面板**：新建纯静态站点，把 `public/` 内容上传到站点根目录。

## 部署后的自检

1. 打开公网网址，能看到发动机并旋转 —— 说明资源加载正常。
2. 按 F5 / Ctrl+R 刷新，模型重新出现 —— 说明相对路径正常。
3. 用**另一台设备**（手机流量 / 别的电脑）打开同一网址 —— 说明不依赖本机文件。
4. 点「逐层拆解」，确认各总成分离且仍在运动 —— 说明核心功能完好。

## 常见问题

- **刷新后 404 / 白屏？** 检查是不是把整个 `engine3d/` 根目录当成了网站根目录。必须让 `index.html` 位于网站根目录（即部署 `public/` 的内容）。
- **双击 index.html 打不开 / 空白？** 正常现象：浏览器禁止 `file://` 下加载 ES Modules，必须通过 HTTP 访问。
- **改了代码不生效？** 静态托管一般会缓存，可先强刷（Ctrl+F5）；长期可给 `.js/.css` 加版本号或清理平台缓存。
