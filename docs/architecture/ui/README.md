# Studio UI Architecture

本目录记录 `apps/studio-client` 已经实现并可作为后续开发基线的领域无关 UI 架构。

```text
Architecture / UI:
  Shell、主题、CSS 公共边界、国际化与无障碍基础约定。

Architecture / Application / UI:
  Card、Chat、Prompt、Agent 等第一方领域体验。
```

## 前端源码路线

从 [Client README](../../../apps/studio-client/README.md#源码导航与-fsd-架构规范)进入本项目 FSD 分层、状态归属与依赖用法，再按其中的模块导航阅读 App、Feature 或共享 API 的局部说明。分层规约维护在 Client README；本目录维护跨模块宿主合同，不复制第二份 FSD 规则。

需要先了解前后端怎样协作时，读取[系统总览](../system-overview.md)。第一方业务的草稿、提交与正文渲染边界仍在 [Application UI](../application/ui/README.md)。

## 当前文档

- [`workspace-shell.md`](workspace-shell.md)：Base Canvas、浮动 Dock / Workspace、窗口模式和布局状态。
- [`window-layout.md`](window-layout.md)：Window 内的 Column Layout、Column Splitter 与 Overlay 空间合同。
- [`navigation-and-routing.md`](navigation-and-routing.md)：URL、History、Router 与 Zustand 的状态边界。
- [`visual-language.md`](visual-language.md)：默认暗色视觉语言、层级、排版与交互反馈。
- [`css-and-theming.md`](css-and-theming.md)：SCSS Modules、`--loom-*` token、自定义 CSS 公共边界。
- [`extension-themes.md`](extension-themes.md)：Extension 主题与样式增强、外观参数、授权及面板动画接管。
- [`localization-and-accessibility.md`](localization-and-accessibility.md)：当前 I18N 实现与基础无障碍 contract。
- [`iframe-runtime.md`](iframe-runtime.md)：消息 HTML、Loom Script 与 Extension iframe 的共享基建、受控 ctx 和通知授权边界。

## 边界

本目录描述当前实现事实；尚未实现的架构决定留在 Workbench，不能作为已完成证明。下列方向尚未成为当前实现合同：

- 一维横向多窗口与插件窗口贡献；
- 完整 Motion Contract；
- 插件 locale resources；
- 完整复数与相对时间格式化（日期、时间和数字已有统一 Intl 封装）；
- 跨窗口焦点模型；
- 提示词资源 Diff 与 Tokenizer 协议。

当前路线从 [UI Plan 索引](../../workbench/plans/ui/README.md) 进入。以下材料分别保留历史依据和当前计划，归档候选不自动成为待办：

- [Workspace 与 Motion 历史设计](../../archive/discussion/ui/widget-workspace-and-motion-v0.md)
- [提示词资源 Diff 历史草稿](../../workbench/drafts/prompt-resource-diff-mode-v0.md)
- [第一方 UI 历史设计](../../archive/discussion/application/ui/README.md)
