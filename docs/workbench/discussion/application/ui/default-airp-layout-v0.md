# Default AIRP Layout v0

> **状态**: Open Design
> **主题**: 默认 AIRP 第一方 UI 的布局骨架，服务稳定阅读、低重排和高频运行控制。

---

## 1. 问题

默认 AIRP UI 同时面对两类需求：

```text
沉浸阅读:
  Chat / Narrative Timeline 需要稳定视觉锚点、低重排、可长时间阅读。

创作控制:
  用户需要随时查看模型、token、设定、记忆、trace、Agent 状态和运行控制。
```

如果所有工具面板都用传统 sidebar / drawer 推挤主内容，Chat 阅读流会频繁移动，用户的阅读锚点会丢失。

本文先定义默认官方 UI 的骨架，不讨论完整视觉风格，也不深入 custom renderer / SDK 等高级渲染机制。

---

## 2. 核心布局

默认 AIRP UI 采用三层骨架：

```text
Base Chat Canvas
  稳定阅读主轴。

Overlay Utility Layer
  浮在阅读主轴两侧或上方的工具面板。

Integrated Input Dashboard
  输入、运行状态和高频控制的聚合区。
```

这三层都位于 Studio Shell 提供的 Canvas / Drawer / Side Panel 等容器内，不改变 Shell 几何。

---

## 3. Base Chat Canvas

Base Chat Canvas 是默认 AIRP UI 的视觉核心。

目标：

- 保持 Chat / Narrative Timeline 的主阅读列稳定；
- 减少侧边工具开合时对阅读内容的 reflow；
- 为长文本、streaming 输出和分支切换提供稳定滚动基础；
- 让用户能长时间阅读，而不是在控制面板之间追踪内容位置。

候选形态：

```text
viewport
  center column:
    chat reading axis, about 700px preferred width

  side whitespace:
    overlay panels may occupy this area when available
```

说明：

- `700px` 是候选阅读宽度，不是硬编码常量；
- 主阅读列应有 `min / preferred / max` 约束；
- Shell 面板开合不应直接改变当前 message 的垂直位置；
- Chat timeline 的滚动规则详见 [`layout-and-scroll-containers-v0.md`](layout-and-scroll-containers-v0.md)。

---

## 4. Overlay Utility Layer

Overlay Utility Layer 承载与当前 Session / Run / Prompt 相关的工具面板。

候选内容：

- model / provider controls；
- token / context budget summary；
- Setting Layer / World entries quick view；
- Agent memory / dynamic context mount；
- Prompt preview summary；
- Trace / diagnostics summary；
- branch / reroll / run inspector summary。

原则：

- Overlay 默认不推动 Base Chat Canvas；
- Overlay 优先使用阅读主轴两侧留白；
- Overlay 可以临时遮挡非核心区域，但不应遮挡当前输入和关键消息；
- Overlay 需要明确打开、关闭、返回焦点和键盘导航规则；
- 长内容 Overlay 内部自己滚动，不把 body 或 Chat Canvas 变成滚动容器。

与 Drawer 的关系：

```text
Overlay:
  高频、轻量、上下文相关的即时工具。

Drawer:
  低频、较重、需要横向空间或深度检查的面板，例如完整 Trace / Diagnostics。
```

---

## 5. Integrated Input Dashboard

Integrated Input Dashboard 是默认 AIRP UI 的高频操作区。

它不只是文本输入框，还聚合当前回合最常用的控制信息：

- user input；
- send / stop / retry；
- current model / model profile；
- temperature / preset summary；
- token / context budget indicator；
- run status；
- quick command / slash command；
- pending confirmation；
- provider error / degraded hint。

目标：

- 缩短输入、状态和控制之间的视线移动；
- 避免顶部状态栏、底部状态栏、右侧参数区分散同一组高频信息；
- 在 streaming / pending / failed 状态下保持用户知道当前系统正在做什么；
- 让回合级操作优先出现在输入舱附近。

待决：

- 输入舱是否固定在 Canvas 底部，还是作为 Chat Canvas 的 sticky footer；
- token / model / run status 的信息密度；
- slash command 与 Command Palette 的关系；
- Send / Stop / Retry 的键盘规则。

---

## 6. 与 Shell 布局的关系

`07-client` 中的 Shell 几何仍然成立：

```text
Activity Bar
Side Panel
Canvas
Drawer
Status Bar
Title Bar / Menu
```

默认 AIRP Layout 是 Canvas 内的 Application 组织方式，不替代 Shell。

候选映射：

| Shell 区域 | 默认 AIRP 用法 |
|---|---|
| Activity Bar | 切换 AIRP / DevTool / Extension 入口 |
| Side Panel | Card / Session / Source tree / Search |
| Canvas | Base Chat Canvas + Overlay Utility Layer + Input Dashboard |
| Drawer | Trace / Diagnostics / Prompt details / Provider calls |
| Status Bar | 低频全局状态，不承载回合级高频控制 |

---

## 7. 渲染扩展需求占位

默认 AIRP Layout 不解决所有创作者渲染需求。后续至少需要记录两类扩展方向。

### 7.1 Lightweight Render Customization

轻量渲染定制仍运行在官方 UI 管控范围内。

候选范围：

- message decoration；
- 受控 CSS token / style preset；
- 正则或 Transform Rule 驱动的文本替换；
- 局部头像、气泡、背景、标签渲染；
- 可追踪、可禁用的 render decoration。

该方向应和 [`../transform-rule-system-v0.md`](../transform-rule-system-v0.md) 以及未来 render decoration 文档关联。

### 7.2 Full Custom Renderer

重型自定义界面需要独立隔离边界。

候选范围：

- Live2D；
- 小游戏；
- 完整自定义聊天界面；
- 第三方大型 JS / CSS；
- 创作者接管整个 narrative renderer。

当前只记录需求，不展开实现。未来可以另开 renderer architecture 文档，讨论 iframe / new tab / renderer session / SDK / asset URL / event stream 等问题。

---

## 8. 非目标

本文不定义：

- 最终视觉风格；
- React component API；
- CSS framework；
- Web Component 实现；
- custom renderer 鉴权；
- SDK API；
- Extension sandbox 细节；
- 移动端布局。

---

## 9. 待决问题

1. Base Chat Canvas 的 preferred width 是否以 700px 为设计起点？
2. Overlay 是否允许同时打开多个，还是保持单 active panel？
3. Overlay 与 Drawer 的切换规则如何设计？
4. Input Dashboard 中哪些信息常驻，哪些折叠？
5. Status Bar 是否只保留全局状态，把回合级状态全部移入 Input Dashboard？
6. Lightweight Render Customization 是否先独立成 render decoration 文档？
7. Full Custom Renderer 是否进入 UI 文档区，还是进入 Extension / Platform Layer 文档区？

