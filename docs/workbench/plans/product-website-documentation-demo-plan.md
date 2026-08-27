# 产品官网、公开文档与交互演示站计划

> **状态**：延期规划 / 讨论草案
>
> **日期**：2026-08-27
>
> **触发条件**：准备对外发布 Loom Studio、建立公开文档入口或提供可交互的产品展示。
>
> **事实边界**：本文只记录当前讨论方向，不是实施授权；尚未选定站点框架、域名、部署账户或公开文档范围。

## 1. 决策摘要

发布首页、公开文档、下载页与 Changelog 应作为同一个静态网站，但与 Loom Studio 产品使用不同的 Git Repository、工作目录、Lockfile、PR 和发布流程。建议职责分配如下：

```text
LoomStudio Repository
  -> 产品源码、内部文档、SDK 与 GitHub Releases

LoomStudio-website Repository
  -> 官网、公开文档、下载页、交互演示与站点资产

Cloudflare Pages
  -> 部署静态网站

GitHub Releases
  -> 托管桌面应用安装包与版本 Artifact
```

Cloudflare Pages 是当前首选部署目标；GitHub Pages 可作为最简静态备选，Vercel 仅在未来明确采用其服务端框架能力时重新评估。安装包不应直接塞进 Pages 构建产物，继续交由产品仓库的 GitHub Releases 或独立 Artifact 存储负责。

## 2. 建议工程位置

两个仓库在本地也使用不同目录，不采用嵌套 Git Repository、Git Submodule、Git Subtree 或由父仓库 `.gitignore` 隐藏子仓库的方案：

```text
LoomStudio/
  .git/
  apps/
  packages/
  docs/
    guide/
    architecture/
    workbench/
    archive/

LoomStudio-website/
  .git/
  package.json
  pnpm-lock.yaml
  src/
    pages/
    layouts/
    components/
    styles/
    content/
      docs/
  public/
    images/
    videos/
```

网站仓库拥有独立的依赖、CI、Branch Protection 与 Cloudflare Pages 集成，不加入产品仓库的 pnpm Workspace。产品仓库中的 `docs/workbench`、`docs/archive` 和工程 Architecture 不自动同步到网站；公开用户文档与公开开发者文档由网站仓库单独维护，避免把内部讨论稿误当作产品承诺。

## 3. 技术方向

站点应优先采用静态生成。Astro 是当前候选，因为它同时适合产品首页、Markdown / MDX 文档、下载页和少量 React 交互 Island，但在正式实施前仍需用最小 Spike 验证：

- 网站仓库自己的 pnpm、Node 与 Vite 工具链兼容性；
- 网站仓库公开文档内容集合的构建方式；
- Cloudflare Pages 的静态构建与预览部署；
- 中英文路由、SEO metadata 与站内搜索的最小能力；
- 不引入不必要的服务端 Runtime。

不建议为了官网默认引入 Next.js 或公开 Studio Server。若纯静态 Astro 已满足需求，不再增加新的运行时层。

## 4. 视觉复用边界

官网需要与 Studio Client 保持同一设计语言，但不直接 import 产品仓库的 `apps/studio-client/src/styles/global.css`，也不通过本地相对路径、Workspace Link 或 Git Submodule 共享源码。两个仓库的独立发布节奏优先于实时资产同步。

资产按使用方拥有：

- 产品内使用的图片、图标与运行时资源留在产品仓库；
- 官网截图、视频、Hero 图与文档插图留在网站仓库；
- Logo、品牌色板等少量品牌资产允许在两个仓库中显式复制，并记录来源版本；
- 不为少量图片建立自动双向同步、第三个资产仓库或 Git 子模块。

真正可能在未来版本化共享的内容仅包括：

- 颜色与表面层级；
- 字体、字号与行高；
- 圆角、边界和状态色；
- 动效时长与缓动；
- 最小的按钮、链接与 Markdown 排版基础。

首版由网站仓库保存自己的视觉 Token 快照，按需人工同步。只有长期漂移已经产生真实维护成本后，才考虑由产品仓库发布独立版本的 `@loom-studio/ui-theme`；网站主动升级版本，而不是随产品提交自动变化。不提前抽取 Studio Widget 或建立完整 React Design System。

## 5. 产品展示策略

首页产品展示采用渐进增强，而不是直接嵌入完整 Studio：

```text
静态截图 Poster
  -> 可选 WebM 短演示
  -> 滚动到可见区域或用户点击后加载 React Product Demo
```

React Product Demo 使用固定 Fixture 和本地 UI 状态，只实现发布页需要展示的少数交互，例如：

- 切换侧边栏与工作面板；
- 展开 Agent 对话；
- 展开 Prompt Resource Block；
- 模拟发送消息；
- 展示 Window Resize 与角色切换。

该 Demo 不连接真实 Studio Server，不读取本地文件，不调用 Provider，不保存用户数据，也不承担完整产品功能。移动端或低性能环境可以保留截图 / 视频，不强制加载交互版本。

## 6. iframe 的使用边界

当前阶段不使用 iframe 嵌入真实应用。现有 Studio Client 依赖 Studio Server、RPC、Session 与本地资源，公开部署会额外引入临时账户、数据隔离、Provider 成本与安全边界。

只有未来存在正式公开 Web Demo 时，才考虑：

```text
loomstudio.example       -> 官网与文档
demo.loomstudio.example  -> 独立、可重置的沙盒应用
```

官网可以通过严格 `sandbox`、独立 Origin、独立 Cookie / Storage 与最小权限 iframe 嵌入该 Demo。iframe 不能与真实用户工作区或官网身份共享隐式权限。

## 7. 明确非目标

当前草案不包含：

- 立即创建或初始化 `LoomStudio-website` Repository；
- 立即提取共享 UI Package；
- 建立跨仓库图片同步、Git Submodule 或第三个资产仓库；
- 部署公开 Studio Server；
- 在线运行真实 Agent 或消耗 Provider 凭证；
- 自动公开全部仓库文档；
- 自建桌面安装包 CDN；
- 为未来需求提前实现账号、分析平台或 CMS。

## 8. 实施前开放问题

正式启动前需要确认：

1. 公开站点的域名与中英文 URL 策略；
2. 网站仓库的正式名称、可见性、权限与 Branch Protection；
3. 哪些文档属于用户文档、开发者文档和内部文档；
4. Logo 等品牌资产的权威来源与人工同步标记；
5. Astro 最小 Spike 是否通过，是否需要现成文档主题；
6. 下载页如何读取 GitHub Release metadata，采用构建期快照还是运行时请求；
7. 交互 Demo 首版必须展示的三个核心操作；
8. 是否需要隐私友好的访问统计，以及是否值得承担相应 Cookie / 合规成本。

## 9. 建议实施顺序

```text
Phase 0: 内容范围、域名与框架 Spike
  -> Phase 1: 静态首页、文档与下载页
  -> Phase 2: 网站独立视觉 Token 与品牌资产基线
  -> Phase 3: 截图 / WebM 与轻量 React Product Demo
  -> Phase 4: 只有产生真实维护成本后再评估版本化 Theme Package
  -> Phase 5: 只有真实需求出现后再评估公开 Web Demo / iframe
```

每个 Phase 都应能独立交付；不能因为未来可能存在 Web Demo，就阻塞首个纯静态发布页。
