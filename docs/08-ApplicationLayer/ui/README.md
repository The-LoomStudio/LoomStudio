# Studio Application UI 文档区

> **状态**: Open Design / Discussion Capture
> **Purpose**: 收纳 Studio Application 第一方 AIRP UI 的基础设计讨论，尤其是布局、滚动容器、状态呈现、I18N、无障碍和交互基础问题。

---

## 1. 定位

本目录讨论的是 **Studio Application UI**，也就是默认 AIRP 体验如何在 Studio Shell 中组织界面、信息结构和交互基础。

它不替代：

- [`../../07-client/loom-studio-ui.md`](../../07-client/loom-studio-ui.md)：Shell 几何、容器、通用 UI 原语、全局功能。
- [`../frontend-projection-v0.md`](../frontend-projection-v0.md)：早期 AIRP UI integration 入口和候选 frontend projection 问题。
- [`../runtime-turn-flow-v0.md`](../runtime-turn-flow-v0.md)：玩家回合从输入到落盘的业务 flow。
- [`../../05-extensions/studio-extension-manifest-architecture.md`](../../05-extensions/studio-extension-manifest-architecture.md)：Client Extension panel / command / sandbox contribution。

当前边界：

```text
07-client:
  Shell 提供哪些容器、几何和通用原语。

08-ApplicationLayer/ui:
  默认 AIRP UI 如何使用这些容器和原语，如何处理复杂应用 UI 的基础问题。

apps/studio-client:
  当前实现与 POC，不作为本文档的最终依据。
```

---

## 2. 文档索引

| 文件 | 状态 | 主题 |
|---|---|---|
| [`ui-foundation-v0.md`](ui-foundation-v0.md) | Open Design | UI 基础原则、桌面优先、信息密度、设计 token、文案与状态原则 |
| [`visual-language-v0.md`](visual-language-v0.md) | Open Design / Design Direction | 平面编辑式工作台：留白、字重、细线、低装饰的正式 UI 视觉语言 |
| [`default-airp-layout-v0.md`](default-airp-layout-v0.md) | Open Design | 默认 AIRP 布局骨架：稳定阅读主轴、悬浮工具层、输入舱 |
| [`ui-preflight-decisions-v0.md`](ui-preflight-decisions-v0.md) | Open Design / Initial Decisions | UI 动工前的 I18N、滚动、焦点、渲染安全和插件 slot 基础决策 |
| [`css-architecture-and-customization-v0.md`](css-architecture-and-customization-v0.md) | Open Design | CSS Modules、Design Tokens、Custom CSS、插件样式边界 |
| [`agent-panel-rendering-v0.md`](agent-panel-rendering-v0.md) | Open Design | Agent 面板内文本、Artifact、ToolCall 和交互卡片的渲染边界 |
| [`custom-renderer-poc-plan-v0.md`](custom-renderer-poc-plan-v0.md) | PoC Plan | 多标签页 Custom Renderer 的隔离、状态同步、轻量 SDK、CSS/A11Y/I18N smoke |
| [`layout-and-scroll-containers-v0.md`](layout-and-scroll-containers-v0.md) | Open Design | Shell 内的 Application 布局、滚动所有权、虚拟列表、滚动恢复 |
| [`interaction-states-v0.md`](interaction-states-v0.md) | Open Design | empty / loading / error / pending / dirty / optimistic / degraded 等状态 |
| [`i18n-and-accessibility-v0.md`](i18n-and-accessibility-v0.md) | Open Design | I18N、键盘导航、焦点管理、ARIA、可缩放文本、对比度 |

---

## 3. 需要从旧文档归类进来的讨论

这些讨论暂不移动原文，只在本目录建立引用关系：

1. Shell 几何、Canvas 类型、Command Palette、Preferences、Theme Tokens：见 [`../../07-client/loom-studio-ui.md`](../../07-client/loom-studio-ui.md)。
2. AIRP UI 需要支持的界面能力：card list / detail、session list、chat timeline、setting layer editor、opening editor、composition preview、trace viewer：见 [`../frontend-projection-v0.md`](../frontend-projection-v0.md)。
3. 玩家回合 UI 事件：输入、运行状态、确认、中止、重试、stream deltas、tool status、diagnostics：见 [`../runtime-turn-flow-v0.md`](../runtime-turn-flow-v0.md)。
4. Trace 可解释性 UI：slot / source / activation / ordering / trimming / redaction：见 [`../trace-explainability-v0.md`](../trace-explainability-v0.md)。
5. Client Extension panel、command、keybinding、context-aware action：见 [`../../05-extensions/studio-extension-manifest-architecture.md`](../../05-extensions/studio-extension-manifest-architecture.md)。

---

## 4. 当前讨论顺序建议

建议先按下面顺序收束，不急着进入视觉稿：

```text
1. UI foundation
   先确认默认 AIRP UI 的密度、桌面优先、状态语言和 token 边界。

2. Visual language
   先确认正式 UI 的平面编辑式工作台气质，避免 POC 盒子化视觉继续扩散。

3. Default AIRP layout
   先确认默认官方 AIRP UI 的阅读主轴、悬浮工具层和输入舱。

4. UI preflight decisions
   先冻结动工前必须遵守的 I18N、滚动、焦点、渲染安全和插件 slot 基础约束。

5. CSS architecture / customization
   决定内部样式、主题 token、Custom CSS hooks 和插件样式边界。

6. Rendering surfaces / Agent panel
   明确 Narrative 正文、Agent 面板、ToolResult 和 Custom Renderer 如何共享 display pipeline 但区分语义。

7. Custom renderer PoC
   用最小多标签页实验验证重型自定义渲染的隔离和状态同步。

8. Layout / scroll
   先解决最容易污染代码的滚动所有权和多面板布局问题。

9. Interaction states
   明确数据加载、运行中、错误、降级、脏状态和乐观更新的呈现规则。

10. I18N / accessibility
   在正式组件沉淀前定义键盘、焦点、文本和翻译边界。

11. Domain screens
   再进入 Card、Session、Timeline、Setting Layer、Prompt Preview、Trace Inspector 等具体界面。
```

---

## 5. 非目标

本目录当前不定义：

- 最终视觉风格；
- React component API；
- CSS framework 选型；
- Extension sandbox 具体实现；
- 完整桌面打包方案；
- 移动端官方 Shell。

这些问题可以在本文档稳定后再拆分专题。
