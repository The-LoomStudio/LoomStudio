# Visual Language v0

> **状态**: Archived / Superseded by Architecture
> **主题**: Studio Application 默认 AIRP UI 的视觉语言：平面编辑式工作台。
> **归档日期**: 2026-08-05
> **归档原因**: 已实现的视觉约定已整理至 [`../../../architecture/ui/visual-language.md`](../../architecture/ui/visual-language.md) 与 [`../../../architecture/ui/css-and-theming.md`](../../architecture/ui/css-and-theming.md)。本文仅保留早期推导，不再承载开放决策。

---

## 1. 定位

当前 `apps/studio-client` 仍然是 POC。它验证了 RPC、Renderer PoC、Custom CSS 和 Rendering Lab，但视觉语言偏“调试控制台”，存在明显的盒子堆叠、卡片化和阴影装饰感。

正式 UI 不应沿着 POC 的视觉惯性继续生长。

本文定义默认 AIRP UI 的视觉方向：

```text
Flat Editorial Workbench

VS Code 式信息架构
+ 日本平面设计式留白、字重、细线和排版秩序
+ AIRP 长文本阅读与创作控制需求
```

中文可称：

```text
平面编辑式工作台
```

一句话：

```text
Loom Studio 的默认 UI 不用卡片和装饰证明自己是界面，而用排版、留白、细线和稳定结构承载复杂工作流。
```

---

## 2. 为什么采用这个方向

AIRP Studio 是长期创作工具，不是营销页面、游戏首页或仪表盘模板。

它需要同时承载：

- 长时间阅读 Narrative Timeline；
- 高频输入与运行控制；
- Agent 工作面板；
- Prompt / Trace / Diagnostics；
- 插件面板和自定义渲染；
- Custom CSS 与主题生态。

如果默认 UI 本身装饰过多，后续会出现几个问题：

```text
1. 主题作者需要先清理官方风格。
2. 插件 slot 每加一个入口都更吵。
3. 长文本阅读被卡片、阴影和边框切碎。
4. CSS 变复杂，难以维护 token 和 hooks。
5. POC 调试信息密度被误认为正式产品气质。
```

克制的平面编辑式设计更适合：

- 长时间使用；
- 高信息密度；
- 低视觉噪音；
- 后续插件扩展；
- 用户主题覆盖；
- 多 surface 渲染并存。

---

## 3. 核心原则

### 3.1 网页设计等于平面设计

默认 UI 首先通过排版建立秩序，而不是通过容器装饰建立秩序。

优先使用：

```text
字体
字重
字号
行高
留白
细线
浅色 metadata
对齐关系
```

少用：

```text
卡片套卡片
大面积阴影
强装饰渐变
厚重边框
高饱和背景
过多圆角
```

### 3.2 少即是多的留白

留白不是空，它是结构。

规则：

- 中央 Narrative 阅读轴应有稳定、安静的留白；
- 左右工具区可以信息密，但不应挤压正文阅读；
- 分区之间优先用间距和细线区分；
- 不用多层 background / card / wrapper 反复强调层级；
- 空状态不做大面积插画或宣传文案。

### 3.3 远离盒子套盒子

默认反模式：

```text
section
  card
    card header
      toolbar card
    card body
      inner card
```

推荐结构：

```text
region
  heading / metadata
  hairline rule
  content
```

约束：

- 嵌套层级尽量不超过三层；
- 容器可以和背景融为一体；
- 区块边界优先通过细线、留白、标题和文字深浅表达；
- 真正需要 framed surface 时才使用完整边框。

### 3.4 细线替代卡片

默认使用单边细线，而不是完整卡片边框。

候选：

```css
border-top: 1px solid var(--airp-line-subtle);
border-left: 1px solid var(--airp-line-subtle);
```

少用：

```css
border: 1px solid ...;
box-shadow: ...;
```

完整边框只留给：

- 输入框；
- 表单控件；
- 可交互小浮层；
- iframe / artifact frame；
- 明确的错误或警告块；
- 被选中或临时聚焦的对象。

### 3.5 阴影不是默认层级语言

默认 layout 不使用 shadow。

阴影只用于：

- modal；
- popover；
- 临时浮层；
- 拖拽对象；
- 需要从背景上短暂浮起的交互状态。

永久面板、资源列表、Agent 面板和 Inspector 不应依赖阴影表达层级。

### 3.6 圆角克制

圆角不是默认装饰。

建议：

```text
Layout region:
  0px

Input / Select / Button:
  4px - 6px

Artifact / iframe / Popover:
  4px - 8px

Narrative message:
  0px - 8px，根据最终阅读风格决定
```

避免大圆角让工作台变成 SaaS dashboard 风格。

---

## 4. 信息架构气质

视觉结构可以借鉴 VS Code：

```text
Activity / Resource:
  快速切换、列表、资源定位。

Canvas:
  当前主工作对象。

Panel / Drawer / Inspector:
  上下文辅助、Trace、Prompt、Agent 工作流。

Status / Input:
  当前运行状态和高频操作。
```

但气质不应完全复制 VS Code 的工程感。

AIRP UI 需要额外强调：

- Narrative 正文的阅读宽度；
- 文本排版的呼吸感；
- Agent 面板的工作日志与行动卡区分；
- Prompt / Trace 的可解释性；
- 插件和自定义渲染的边界感。

---

## 5. Typography

字体层级应承担主要结构表达。

候选 token：

```text
--airp-font-ui:
  system sans, 用于 chrome、panel、button、metadata。

--airp-font-narrative:
  可配置正文阅读字体，可为 serif / system serif / user theme。

--airp-font-mono:
  code、prompt、trace、id、debug。
```

字重建议：

```text
400:
  正文、普通控件。

500:
  关键 label、按钮文字、当前选中项。

600:
  section heading、面板标题。

italic:
  narrative accent、aside note、低频提示。
```

字号建议：

```text
11-12px:
  metadata、id、状态补充。

13px:
  密集列表、工具面板正文。

14px:
  默认 UI body。

16-18px:
  Narrative 正文或当前 Canvas 标题。

20px+:
  谨慎使用，只用于真正的当前对象标题。
```

原则：

- 不用 viewport width 缩放字体；
- 不使用负 letter spacing；
- 长翻译文本必须能换行；
- metadata 浅一些，但对比度不能失效；
- 标题不靠巨大字号，而靠位置、留白和字重。

---

## 6. Color

默认配色应安静、低饱和、可长时间使用。

原则：

- 背景接近纸面或编辑器 surface；
- 文本对比明确；
- accent 少量使用，只标记当前动作和状态；
- 不让 UI 被单一色系完全支配；
- 不用大面积渐变、bokeh、orb 或装饰背景；
- danger / warning / success 只用于状态，不做装饰色。

推荐 token 分类：

```text
--airp-bg
--airp-surface
--airp-surface-muted
--airp-line-subtle
--airp-line-strong
--airp-text
--airp-text-muted
--airp-text-faint
--airp-accent
--airp-danger
--airp-warning
--airp-success
```

与 Custom CSS 的关系：

```text
默认 UI 越克制，主题作者越容易覆盖。
```

---

## 7. Layout

正式 UI 应优先使用平面分区。

推荐：

```text
Left resource region:
  细线分隔，列表靠字重和浅色 metadata 组织。

Center narrative canvas:
  大留白，稳定阅读宽度，消息不必全部卡片化。

Right agent / inspector region:
  细线、标题、紧凑列表、可折叠内容。

Input dashboard:
  与正文阅读轴对齐，靠 top rule 和控件状态表达边界。
```

避免：

- 每个 section 都是一张 card；
- panel 内再套 card；
- tool row 被按钮和 badge 塞满；
- 为了表达分组而创建多层背景。

---

## 8. Message / Narrative

Narrative 是默认 AIRP UI 的视觉核心。

方向：

- 阅读轴稳定；
- 正文排版优先；
- 消息可以弱框架化；
- role、id、branch、run 等 metadata 应降低视觉权重；
- hover action 不应常驻打扰阅读；
- artifact 可以 framed，但不把每条普通消息都变成 card。

候选：

```text
assistant narrative:
  更接近文本段落 / 稿纸行文。

user input:
  可用轻微缩进、字重、细线或较浅背景区分。

system / tool:
  更像日志 / annotation，不抢正文权重。
```

---

## 9. Agent Panel

Agent Panel 是工作流面板，不是第二个花哨聊天区。

方向：

- 紧凑；
- 可扫描；
- 状态清楚；
- ToolCall / ToolResult / Action Card 有明确语义；
- 行为型卡片可以 framed，但普通日志不需要卡片化；
- iframe card 需要明确边界和 fallback。

推荐区分：

```text
Agent text:
  普通排版。

Tool status:
  单行 / 多行日志，使用 monospace 或 metadata。

Action Card:
  细边框 + 明确按钮，不使用重阴影。

Error:
  细线 + danger text + next action。
```

---

## 10. Plugin / Custom UI

默认 UI 应给插件留空间，而不是替插件装饰。

规则：

- 插件入口默认低调；
- 插件 slot 通过位置、细线和 label 表达；
- 插件自己的复杂视觉应放在自己的 panel / iframe / renderer 内；
- Host 不应为每个插件自动生成厚重卡片；
- public hooks 保持稳定，内部 class 不作为主题 API。

---

## 11. CSS Implications

这种视觉语言要求 CSS 更少、更平。

CSS 应主要分为：

```text
tokens:
  color / typography / spacing / line / z-index

layout:
  shell region / canvas / panel / scroll container

typography:
  heading / label / metadata / narrative / code

states:
  selected / hover / focus / disabled / error / pending

public hooks:
  data-airp-* / --airp-*
```

避免：

- 为每个 section 写一套 card 样式；
- 大量 shadow / gradient / nested wrapper；
- 通过 CSS 选择器修补结构混乱；
- 把 POC 调试面板样式扩散到正式 UI。

---

## 12. 重构含义

正式 UI 重构不应只是把现有 `main.tsx` 拆组件。

更合适的顺序：

```text
1. 先建立视觉语法。
2. 再建立 FSD / widget / feature 分层。
3. 再迁移 PoC 能力。
4. 最后逐步替换后端投影和正式交互。
```

现有 PoC 能力的归位建议：

```text
Renderer PoC:
  Dev / Rendering diagnostics，不占默认核心视觉。

Rendering Lab:
  Dev panel / Inspector 中的实验工具。

Prompt Build Flow:
  Prompt Inspector / Trace view。

Card JSON editor:
  Dev / import debug，不作为默认 Card 创建体验。
```

---

## 13. 非目标

本文不定义：

- 最终主题；
- 具体色值；
- 组件 API；
- CSS Modules 文件结构；
- 完整 FSD 目录；
- 动效规范；
- Logo / brand identity。

这些应在正式 UI 重构开始后按页面和组件逐步收束。

---

## 14. 待决问题

1. Narrative 正文默认使用 sans 还是 serif？
2. 默认浅色主题和深色主题是否都采用平面编辑式语言？
3. 消息是否完全去卡片化，还是保留非常轻的 message boundary？
4. Agent Action Card 的 framed 程度如何控制？
5. Plugin slot 的默认视觉是否需要单独 reference？
6. 是否需要定义一套 typography scale token 作为第一批实现约束？
