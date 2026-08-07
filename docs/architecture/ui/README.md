# Studio UI Architecture

本目录记录 `apps/studio-client` 已经实现并可作为后续开发基线的领域无关 UI 架构。

```text
Architecture / UI:
  Shell、主题、CSS 公共边界、国际化与无障碍基础约定。

Architecture / Application / UI:
  Card、Chat、Prompt、Agent 等第一方领域体验。
```

## 当前文档

- [`workspace-shell.md`](workspace-shell.md)：Base Canvas、浮动 Dock / Workspace、窗口模式和布局状态。
- [`navigation-and-routing.md`](navigation-and-routing.md)：URL、History、Router 与 Zustand 的状态边界。
- [`visual-language.md`](visual-language.md)：默认暗色视觉语言、层级、排版与交互反馈。
- [`css-and-theming.md`](css-and-theming.md)：SCSS Modules、`--loom-*` token、自定义 CSS 公共边界。
- [`localization-and-accessibility.md`](localization-and-accessibility.md)：当前 I18N 实现与基础无障碍 contract。

## 边界

本目录只描述当前实现事实。下列方向尚未成为 Architecture contract：

- 一维横向多窗口与插件窗口贡献；
- 完整 Motion Contract；
- 插件 locale resources；
- 完整复数、日期和数字格式化；
- 跨窗口焦点模型；
- 提示词资源 Diff 与 Tokenizer 协议。

这些设计继续保留在：

- [`../../workbench/discussion/ui/widget-workspace-and-motion-v0.md`](../../workbench/discussion/ui/widget-workspace-and-motion-v0.md)
- [`../../workbench/plans/ui/prompt-resource-diff-mode-v0.md`](../../workbench/plans/ui/prompt-resource-diff-mode-v0.md)
- [`../../workbench/discussion/application/ui/`](../../workbench/discussion/application/ui/)
