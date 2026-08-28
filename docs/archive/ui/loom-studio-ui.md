# Loom Studio UI — Shell 形态草稿

> **状态**：Archived / Superseded Shell Draft
> **归档日期**：2026-08-05
> **归档原因**：当前实现事实已进入 [`docs/architecture/ui/`](../../architecture/ui/)，尚未实现的一维横向窗口与 Motion 设计由 [`widget-workspace-and-motion-v0.md`](../../workbench/discussion/ui/widget-workspace-and-motion-v0.md) 继续承接。

> **本文档定位**：勾勒 Studio Shell 在用户面前的“骨架形状”——哪些是 Shell 提供的容器与原语、哪些由 Studio AIRP UI 或 extension 填充。本文档不讨论 Studio Kernel 的服务边界，也不讨论 [DevTool UX](../loom-project/docs/02-architecture/loom-devtools.md)。
>
> 本文是 v0.1 之前的历史草稿，不再锁定当前 API 或施工方向。
>
> 作者：shiyue / 白
> 日期：2026-04-29

---

## 1. 核心立场

> **Studio Shell 只做容器；Studio AIRP UI 或 extension 才知道业务是什么。**

参照对象是 **VSCode**：
- VSCode Shell 不知道"Python"是什么——Python 扩展知道。
- Loom Studio Shell 不知道"角色卡 / 世界书 / 聊天"是什么——Studio AIRP UI 或第三方上层体验知道。

但 Shell **不能完全空白**。如果 Shell 不提供通用 UI 原语，每个上层体验都要自己造轮子，体验割裂、门槛过高。

因此 Shell 的承担边界是：
- ✓ 提供**容器与几何**（哪里是侧边栏、哪里是画布、哪里是抽屉）
- ✓ 提供**通用 UI 原语**（树视图、列表、表单、Diff、Pipeline 可视化）
- ✓ 提供**全局功能**（命令面板、通知、Preferences、主题 token）
- ✗ 不提供任何业务概念（chat / character / worldbook / preset）
- ✗ 不规定业务视觉风格（消息气泡长什么样由 Studio AIRP UI 或对应 extension 决定）

---

## 2. UI 责任的三层结构

Studio UI 不是单层结构。它有三层，每层的责任和作者不同。

| 层 | 谁负责 | 决定什么 |
|---|---|---|
| **Shell** | Studio Kernel + 官方 Shell | 窗口骨架、UI 原语、全局功能 |
| **Studio AIRP UI / 上层体验** | Studio 第一方 AIRP UI 或第三方体验 | 在 Shell 上摆什么槽位、画布上放什么类型的视图 |
| **Inhabitant** | 普通 Extension | 在上层体验提供的视图里塞具体内容 |

VSCode 的真实结构其实就是这样——它的上层领域体验是内置且不可替换的（编程概念）。Loom Studio 的默认 AIRP 体验也倾向内置于 Studio client，但第三方完整体验的替代与隔离方式仍需后续讨论。

---

## 3. Shell 的几何形态

学习 VSCode + macOS，但要抽出可移植的部分。

```
┌──────────────────────────────────────────────────────────────┐
│  Title Bar / Menu                  (AIRP UI / Extension 菜单项) │
├──┬───────────────────┬───────────────────────────────────────┤
│A │                   │                                       │
│c │   Side Panel      │                                       │
│t │   (Tree / List)   │           Canvas                      │
│i │                   │           (Tab / Notebook /           │
│v │                   │            Chat / Dashboard / ...)    │
│i │                   │                                       │
│t │                   │                                       │
│y │                   │                                       │
│  ├───────────────────┴───────────────────────────────────────┤
│B │  Drawer                                                   │
│a │  (Trace / Console / Diagnostics)                          │
│r │                                                           │
├──┴───────────────────────────────────────────────────────────┤
│  Status Bar      (AIRP UI / Extension 注册指示器)              │
└──────────────────────────────────────────────────────────────┘
```

| 区域 | 角色 | 类比 |
|---|---|---|
| **Activity Bar** | 切换主功能区（AIRP UI / Extension 入口） | VSCode 左侧图标条 |
| **Side Panel** | 树 / 列表 / 大纲视图 | VSCode Side Bar |
| **Canvas** | 中间主工作区（多形态，见 §4） | VSCode Editor Group 的泛化 |
| **Drawer** | 底部可隐藏面板（Trace / Console / Diagnostics） | VSCode Panel |
| **Status Bar** | 全局信息、快捷开关 | VSCode Status Bar |
| **Title Bar / Menu** | 顶部菜单 | macOS Menu Bar |

**借鉴 VSCode 的 ~90%，借鉴 macOS 的 ~10%**（顶部菜单概念）。**不借鉴 macOS Dock**——Studio 不是任务管理器。

---

## 4. Canvas 是 Editor Group 的泛化

VSCode 的 Editor Group 假设"中间画布编辑文档"。Loom Studio 不能这么假设——典型场景一半不是"编辑文档"：

| 场景 | 真的像"编辑文档"吗 |
|---|---|
| 调试一个 Pipeline | 不像，更像 Notebook |
| 维护角色卡 | 像 |
| 跟角色对话 | 完全不像，是聊天窗口 |
| 设计一个 Pipeline | 像 Workflow Builder |
| 看 Trace 报告 | 像 Chrome DevTools |

因此中间区域命名为 **Canvas**，并支持多种 Canvas 类型：

```
Canvas Types
├─ Tab Editor    (VSCode 风格，多 tab 文档)
├─ Notebook      (Pipeline 调试，多 cell)
├─ Chat          (聊天窗口，单页面无 tab)
├─ Dashboard     (全屏数据面板)
└─ Diff          (分屏对比)
```

**Studio AIRP UI 或 Extension 通过 Contribution API 注册 Canvas 类型**。Shell 不知道"Chat Canvas"是什么，只知道它是一种 Canvas。

> Canvas 类型谱系是开放枚举，但每加一种都要慎重——它会成为 Shell 必须长期支持的形态。

---

## 5. Shell 必须提供的通用 UI 原语

Shell 不知道"角色"是什么，但 Shell 必须知道"列表怎么渲染"。下面这些是 Shell 应该内置的"和数据形状无关的"UI 词汇：

| 原语 | 用途 |
|---|---|
| **Tree View** | 任何层级数据 |
| **List View**（带虚拟滚动） | 任何长列表 |
| **Form View**（基于 schema 渲染） | Pass 配置、Document 编辑 |
| **Diff View** | 内容对比，DevTool 也用 |
| **Markdown / Code Renderer** | 几乎每个上层体验都需要 |
| **Pipeline Visualizer** | Loom 特有，Shell 必须提供 |

**判断标准**：是否"数据形状无关"。`Tree<T>` 不知道 `T` 是什么，只知道怎么渲染层级——这种就该是原语。`<CharacterCard>` 知道角色是什么——这种是 Studio AIRP UI 或上层体验的事。

---

## 6. UI 责任的三种细分

> **2026-05-20 方向修正**：本文早期把默认上层体验描述为 `Concept Stack 提供 UI`。最新方向是：默认完整 AIRP 主体验倾向直接内置于 Studio client，并由 Studio AIRP Layer / package layer 支撑；ordinary extension 仍可贡献 UI，但不再承担默认 AIRP 主体验的基础注册职责。

我们经常把"上层体验提供 UI"当成一件事，实际上它是三件事：

| 责任 | 说明 | 谁负责 |
|---|---|---|
| **A. Layout 槽位声明** | "我在 Side Panel 注册一个面板""我注册一种新的 Canvas 类型" | Studio AIRP UI 或 extension 通过 Contribution API |
| **B. Domain Component 实现** | 槽位里展示什么 UI（用 Shell 原语拼） | Studio AIRP UI 或 extension 自行实现 |
| **C. 视觉风格 / CSS** | 消息气泡长啥样、颜色风格 | 各自视图边界内自由 |

> Shell 提供 A 的 API、提供 B 用得上的原语、提供 C 用得上的设计 token。**Shell 不实现任何具体 B**，也不限制 C 的表达自由（在 token 范围内）。

---

## 7. 全局功能（Shell 必备）

不属于任何 AIRP domain 或 extension，Shell 必须自带：

- **Command Palette**（Cmd+K / Ctrl+P）—— 全局命令检索
- **Quick Pick** —— 快速选择器
- **Notifications** —— 右下角通知队列
- **Preferences** —— 应用设置 / 用户偏好入口
- **Theme Tokens** —— 颜色 / 间距 / 字体规模的统一来源

**Command Palette 是 Shell 最大的杠杆**。它让任何上层体验或 extension 都能"零 UI"暴露功能（注册命令即可），是生态作者的低门槛入口。

---

## 8. 视觉风格的隔离边界

Shell 提供 token，上层体验可以覆盖。但能覆盖到什么程度？

| 行为 | 是否允许 |
|---|---|
| 在自己视图内改 token（颜色、字体规模） | ✓ |
| 完全自定义自己 Canvas 内的 CSS | ✓ |
| 改 Shell 提供的原语样式（按钮、列表行） | ✗ 危险，会影响其他体验 |
| 修改 Activity Bar / Side Panel / Drawer 的几何 | ✗ Shell 独占 |

> **倾向：上层体验在自己的视图边界内自由，跨边界保守。** 这是"主题"vs"魔改"的分界。

---

## 9. 零 AIRP 内容时的默认形态

Shell 装好但还没有 AIRP 内容或项目时，应该不是空白。建议：

> **Shell 自带一个最小的 Studio Welcome 体验**，提供 Pipeline Workbench / Document Browser / Preferences / DevTool Inspector。

这相当于"Shell 自身的开发者面板"，让：
- 不进入 AIRP 主体验的开发者也能用 Studio 调 Loom Pipeline
- "我只是想试试 Loom"的人有零门槛入口
- DevTool 的 Layer 3 形态自然嵌进这里（历史背景见 [`loom-devtool-layered.md`](../loom-project/docs/02-architecture/loom-devtool-layered.md)）

---

## 10. 第三方上层体验并存

Studio 可能同时存在默认 AIRP 体验和第三方上层体验。两种处理方式：

| 模式 | 含义 |
|---|---|
| **正交并存**（倾向） | 多个体验的 Activity Bar 图标共存，用户随时切换工具集 |
| **模式切换** | 用户选择一个体验进入，整个 UI 切换 |

**倾向"正交并存"**，但第三方完整替代体验是否需要独立进程 / 数据根 / namespace 隔离仍待后续 ADR 讨论。

---

## 11. Form Factor — 桌面优先，不为移动端让步

Studio Shell 是**桌面优先**的形态。Shell 设计**不为移动端让步**：
- 复杂多面板布局、Command Palette、多 Canvas 并排——这些是桌面工作台特征
- VSCode 移动端化失败的核心教训：**不要把桌面 Shell 缩小到 6 寸屏**

移动端的解决路径**不是**"让 Shell 适配小屏"，而是：

> **通过 Studio Transport 让生态自由开发独立移动客户端**。

具体讲：
- Studio Transport 必须 **web-native**（HTTP / WebSocket / SSE），不依赖纯 Node IPC——这是给移动端和第三方客户端铺的硬约束（候选 ADR）
- 官方 v1 不做 Studio Mobile Shell
- 第三方体验作者若需移动端，自带客户端通过 Transport 接入；这是 **Tenet II（Transport API is the Contract）** 的天然结论
- 桌面 Shell 因此可以放手设计成 VSCode 风格的复杂工作台，专心做好桌面工作台

> **Studio 桌面端是"工作台"，移动端（如果有）是"消费端"。两种气质，不强行统一。**

---

## 12. 与其他文档的关系

当前 Shell 事实以 [`docs/architecture/ui/`](../../architecture/ui/) 为准；历史 Core 与 DevTool 文档保留在 [`../loom-project/`](../loom-project/) 中。

本文档**不**回答的问题：
- Studio AIRP UI / Extension Contribution API 的具体 shape（待 v0.1 设计）
- Pass 配置 schema 内省机制（候选 ADR，会被 Workbench Canvas 直接消费）
- Document Schema 自描述程度（与 Side Panel / Form View 渲染相关）
- Shell 本身能否被替换为某个 Extension（激进路线，暂不考虑）

---

## 13. 下一步

- [ ] 起草 Studio AIRP UI / Extension Contribution API 草案
- [ ] 穷举 Canvas 类型谱系（Tab / Notebook / Chat / Dashboard / Diff 之外是否还需要）
- [ ] 提出 "Studio Transport 必须 web-native" 候选 ADR
- [ ] Pass 配置 schema 内省（候选 ADR）—— 给 Workbench Canvas 用
- [ ] Preferences / Config schema 设计 —— 用 Form View 原语统一渲染
