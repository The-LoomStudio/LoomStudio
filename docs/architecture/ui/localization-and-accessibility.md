# Localization and Accessibility

## 1. 当前 I18N 实现

Studio 当前使用项目内 TypeScript 字典，不依赖 i18next 或 JSON locale 文件。

```text
Locales:
  zh-CN
  en-US
  ja-JP
  ko-KR

Source:
  apps/studio-client/src/shared/i18n/zh-cn.ts
  apps/studio-client/src/shared/i18n/en-us.ts
  apps/studio-client/src/shared/i18n/ja-jp.ts
  apps/studio-client/src/shared/i18n/ko-kr.ts
```

`zh-CN` 字典定义 `MessageKey`，英语、日语和韩语字典必须覆盖相同 key；统一资源表通过类型约束检查。`createTranslator(locale)` 负责查找文案，缺失时回退中文，并支持 `{{name}}` 命名插值。

组件通过 `Translator` 或 `t` 获取 UI 文案，不在组件内维护第二套可见字符串。

## 2. 翻译边界

应翻译：

- 按钮、菜单、Header 和导航标题；
- accessible name、状态反馈和错误说明；
- 空状态、占位提示和确认文案；
- Host 提供的命令与工具说明。

默认不翻译：

- 用户正文和提示词资产内容；
- 资源 ID、Extension ID、Provider ID、Model ID；
- 日志原文和协议字段；
- 贡献方未声明为 localized label 的领域数据。

不得通过字符串拼接组织句子。插值使用命名参数，避免翻译后词序无法调整。

日期、时间与数字通过 `shared/i18n/format.ts` 的 `formatDateTime`、`formatDate`、`formatTime` 和 `formatNumber` 统一格式化，由 `shared/i18n/index.ts` 导出。它们使用显式 locale 或当前文档语言，并调用平台的 Intl / locale 格式化能力。完整复数规则与相对时间 formatter 尚未实现；出现需求时应先扩展统一 i18n 层，不在组件中各自实现。

## 3. 语义与 accessible name

优先使用原生语义元素；只有原生语义不足时才补 ARIA。当前共享 UI 的基础约定包括：

- 图标按钮提供本地化 `aria-label`；
- 装饰图标使用 `aria-hidden="true"`；
- 开合与模式按钮同步 `aria-expanded`、`aria-pressed` 和 `aria-controls`；
- 导航使用 `<nav>`；
- 文件树使用 `tree` / `treeitem` 语义；
- 状态和复制反馈使用克制的 `aria-live="polite"`；
- resize handle 提供可理解的 accessible name。
- 模态确认使用原生 `<dialog>`，标题与描述通过 `aria-labelledby` / `aria-describedby` 关联，关闭后恢复触发点焦点。

ARIA 不替代键盘行为。自定义 Tree、Menu、Toggle 和 Resize 组件必须同时实现对应的焦点、激活和关闭逻辑。

## 4. 键盘与焦点

核心工作流不能只依赖鼠标 Hover、右键或拖拽：

- Menu、导航、Header 操作和编辑器工具栏可通过键盘到达；
- 右键菜单中的关键动作还需有工具栏、命令或键盘入口；
- `Escape` 用于关闭当前临时层或返回上一级状态；
- 打开临时菜单或面板后，关闭时应恢复到合理触发点；
- 拖拽 resize 不能成为改变布局的唯一方法，Header 中应保留视图快捷动作。

当前项目尚未完成所有复合组件的 roving tabindex、Modal focus trap 和跨窗口焦点恢复审计。这些属于后续实现约束，不应被描述为已完成能力。

## 5. 动画、对比度与状态

- 新增动画必须尊重 `prefers-reduced-motion: reduce`；
- 焦点不能只依赖颜色变化，必须保持可见轮廓或等价指示；
- 状态不能只靠红绿或亮暗区分，应配合图标、文字或位置语义；
- Hover 不能是发现功能的唯一方式；
- 弱化文字和禁用状态仍需保持可读；
- 编辑器选区沿用平台可识别的 selection，不用编辑痕迹覆盖选区语义。

## 6. 插件与 iframe 边界

Extension Renderer 的 iframe 已通过版本化 `ClientThemeSnapshot` 接收公共主题 Token 白名单，其中包括颜色、排版、圆角与动画时长 / easing。首次连接传递完整快照，主题变化继续推送；作者可调用 `applyClientThemeSnapshot()` 应用到文档根。该桥不传递任意 Custom CSS 或全部内部变量，详见[Renderer 主题桥接](css-and-theming.md#7-extension-renderer-主题桥接)。

插件 locale resource、Host locale 注入及完整无障碍验收合同尚未建立。后续接入仍需明确：

- locale 与 fallback 的传递方式；
- Host Frame 与插件内容之间的 accessible name 所有权；
- 焦点进入、退出和快捷键冲突；
- reduced-motion 偏好与插件自身动效行为的协调；已有动画 Token 传播不等于完整减少动效验收；
- 插件不可访问时 Host 提供的退出路径。

历史候选保留在 [`I18N 与无障碍旧稿`](../../archive/discussion/ui/i18n-and-accessibility-v0.md)，需要继续推进的范围由 [Plan](../../workbench/plans/README.md) 确认。
