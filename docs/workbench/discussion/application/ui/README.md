# Studio Application UI 文档区

> **状态**: Open Design / Discussion Capture
> **Purpose**: 收纳 Studio Application 第一方 AIRP UI 的基础设计讨论，尤其是布局、滚动容器、状态呈现、I18N、无障碍和交互基础问题。
> **当前事实**: 已落地的 Workspace Shell、视觉语言、CSS / Theme、I18N 与基础无障碍约定以 [`../../../../architecture/ui/`](../../../../architecture/ui/) 为准。本目录只保留尚未完成的 Application UI 设计。

---

## 1. 定位

本目录讨论的是 **Studio Application UI**，也就是默认 AIRP 体验如何在 Studio Shell 中组织界面、信息结构和交互基础。

它不替代：

- [`../../ui/widget-workspace-and-motion-v0.md`](../../ui/widget-workspace-and-motion-v0.md)：尚未实现的一维横向窗口、插件窗口与 Motion Contract。
- [`../frontend-projection-v0.md`](../frontend-projection-v0.md)：早期 AIRP UI integration 入口和候选 frontend projection 问题。
- [`../runtime-turn-flow-v0.md`](../runtime-turn-flow-v0.md)：玩家回合从输入到落盘的业务 flow。
- [`docs/architecture/extensions/`](../../../../architecture/extensions/)：当前 Extension Package / Module / Instance 与 Client Host 边界。

当前边界：

```text
07-client:
  Shell 提供哪些容器、几何和通用原语。

08-ApplicationLayer/ui:
  默认 AIRP UI 如何使用这些容器和原语，如何处理复杂应用 UI 的基础问题。

apps/studio-client + docs/architecture/ui:
  当前实现事实与正式 UI contract。
```

---

## 2. 文档索引

| 文件 | 状态 | 主题 |
|---|---|---|
| [`ui-foundation-v0.md`](ui-foundation-v0.md) | Partially Promoted / Open Design | 已实现基础见 Architecture；继续讨论 Application RPC、领域状态和桌面优先边界 |
| [`default-airp-layout-v0.md`](default-airp-layout-v0.md) | Partially Promoted / Open Design | Base Canvas 与浮动 Workspace 已实现；继续讨论输入舱和渲染扩展 |
| [`ui-preflight-decisions-v0.md`](ui-preflight-decisions-v0.md) | Open Design / Initial Decisions | UI 动工前的 I18N、滚动、焦点、渲染安全和插件 slot 基础决策 |
| [`css-architecture-and-customization-v0.md`](css-architecture-and-customization-v0.md) | Partially Promoted / Open Design | 当前 CSS / Theme 已晋升；继续讨论插件样式、iframe 和版本边界 |
| [`agent-panel-rendering-v0.md`](agent-panel-rendering-v0.md) | Open Design | Agent 面板内文本、Artifact、ToolCall 和交互卡片的渲染边界 |
| [`narrative-inline-rendering-and-render-mount-v0.md`](narrative-inline-rendering-and-render-mount-v0.md) | Accepted Direction / Implementation Pending | 消息内 DisplayPart、Node Binding、动态 Render Mount、Streaming 与文生图示例 |
| [`custom-renderer-poc-plan-v0.md`](custom-renderer-poc-plan-v0.md) | PoC Plan | 多标签页 Custom Renderer 的隔离、状态同步、轻量 SDK、CSS/A11Y/I18N smoke |
| [`layout-and-scroll-containers-v0.md`](layout-and-scroll-containers-v0.md) | Open Design | Shell 内的 Application 布局、滚动所有权、虚拟列表、滚动恢复 |
| [`interaction-states-v0.md`](interaction-states-v0.md) | Open Design | empty / loading / error / pending / dirty / optimistic / degraded 等状态 |
| [`i18n-and-accessibility-v0.md`](i18n-and-accessibility-v0.md) | Partially Promoted / Open Design | 当前 typed I18N 与基础 ARIA 已晋升；继续讨论插件 locale 和完整焦点模型 |
| [`frontend-interface-language-v0.md`](frontend-interface-language-v0.md) | Open Design / Naming Baseline | Window、Panel、Pane、Surface、Entry、Message 等界面对象及其中文、代码、文件、状态与动作命名 |
| [`frontend-naming-audit-v0.md`](frontend-naming-audit-v0.md) | Migration Complete / Deferred Items Recorded | 当前组件、文件、状态、动作、CSS Hook、Token 与 I18N 命名迁移结果及架构延期项 |

---

## 3. 需要从旧文档归类进来的讨论

这些讨论暂不移动原文，只在本目录建立引用关系：

1. 当前 Shell 与 Theme 事实：见 [`../../../../architecture/ui/`](../../../../architecture/ui/)；尚未实现的窗口工作区见 [`../../ui/widget-workspace-and-motion-v0.md`](../../ui/widget-workspace-and-motion-v0.md)。
2. AIRP UI 需要支持的界面能力：card list / detail、session list、chat timeline、setting layer editor、opening editor、composition preview、trace viewer：见 [`../frontend-projection-v0.md`](../frontend-projection-v0.md)。
3. 玩家回合 UI 事件：输入、运行状态、确认、中止、重试、stream deltas、tool status、diagnostics：见 [`../runtime-turn-flow-v0.md`](../runtime-turn-flow-v0.md)。
4. Trace 可解释性 UI：slot / source / activation / ordering / trimming / redaction：见 [`../trace-explainability-v0.md`](../trace-explainability-v0.md)。
5. Client Extension panel、command、keybinding、context-aware action：当前平台边界见 [`docs/architecture/extensions/`](../../../../architecture/extensions/)，未实现部分继续在 Extension Host Discussion 收敛。

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

本目录剩余讨论不重新定义已晋升的视觉语言和 CSS contract，也不定义：

- React component API；
- CSS framework 选型；
- Extension sandbox 具体实现；
- 完整桌面打包方案；
- 移动端官方 Shell。

这些问题可以在本文档稳定后再拆分专题。
