# Loom DevTool — 分层供给方案

> **状态**：Design Doc / RFC
> **前置文档**：[`loom-observability.md`](./loom-observability.md)（Trace 协议）、[`loom-devtools.md`](./loom-devtools.md)（UX 哲学：投影虚拟树）
> **关联 ADR**：ADR-002（mutation-only trace）、ADR-005（Pass 工厂化）、ADR-007（移除 barrier）
> **适用范围**：v0.1 ~ v1.0

---

## 0. 这份文档解决什么问题

`loom-devtools.md` 回答了 **"DevTool 看起来应该是什么样"**（投影虚拟树、级联剪枝、Mutation Observer）。
`loom-observability.md` 回答了 **"DevTool 消费什么数据"**（Trace 协议）。

这份文档回答一个更实际的问题：

> **DevTool 该如何被分发，才能同时服务"只用 `@loom/core` 写测试的库作者"和"在 Studio 里跑 Workbench 的高阶用户"？**

更尖锐地说：DevTool 不能只为 Studio 用户服务。一旦它假设了 Studio 的存在，纯 Core 用户（生态最早期、最关键的种子用户）就被排除在外。

---

## 1. 五种用户场景

DevTool 的真实使用方不是"开发者"这个抽象集合，而是五种具体形态：

| # | 场景 | 运行时 | 最低需要 | 容忍依赖 |
|---|---|---|---|---|
| 1 | 写 Pass 单测的库作者 | Node test runner | 文本断言 / 简洁日志 | 只 `@loom/core` |
| 2 | CLI 跑 Pipeline 的脚本作者 | Node 脚本 | 终端美化输出、单步 | 可装一个 CLI 包 |
| 3 | 写 Pass 时调试的 Pass 作者 | Node + 编辑器 | 弹个 HTML 看 trace | 临时引入工具包 |
| 4 | CI / 错误归档 | 任意 | 把 trace 存下来事后看 | 必须能离线自包含 |
| 5 | Studio / Extension 用户 | 浏览器 + Studio | 完整 UI、回放、Workbench | Studio 全家桶 |

> **关键观察：1 和 5 是两个极端，但他们消费的应该是同一份数据。** 如果做不到这点，就是在做两个 DevTool。

---

## 2. 三层洋葱模型

DevTool 不是一个产品，是**一组分层供给**。外层依赖内层，每层独立可用：

```
┌──────────────────────────────────────────────────┐
│  Layer 3: Studio Extension (loom-studio-devtool) │  ← 完整 UI、Workbench、Live Debug
│           需要 Studio Kernel                       │
├──────────────────────────────────────────────────┤
│  Layer 2: Standalone DevTool (@loom/devtool)     │  ← Web UI、CLI、HTML 报告
│           需要 Node 或浏览器                        │
├──────────────────────────────────────────────────┤
│  Layer 1: Core Tracing Primitives                │  ← TraceSink / MemorySink /
│           内置在 @loom/core                         │     toJSON / formatTrace
└──────────────────────────────────────────────────┘
```

每一层独立交付给那一层的用户：

| 场景 | 需要的层 | 用法示例 |
|---|---|---|
| 1 纯 Core 库作者 | L1 | `import { MemorySink } from '@loom/core'`，断言 `sink.trace.passes[3].mutations` |
| 2 CLI 用户 | L1 + L2 | `npx @loom/devtool pretty trace.json` |
| 3 Pass 调试 | L1 + L2 | `npx @loom/devtool report trace.json --open` |
| 4 CI 归档 | L1 trace 数据 + L2 写盘 / HTML | `loom.run(.., { sink: memorySink })` + `@loom/devtool` FileSink / report post-step |
| 5 Studio 用户 | L1 + L2 + L3 | Studio Extension 自动接入 |

> **关键约束：Layer 1 是唯一进入 `@loom/core` 的部分，且必须极小。** 否则纯 Core 用户就要为他们不需要的 UI 代码买单。

---

## 3. Layer 1 边界 — 什么进 Core，什么不进

这是分层模型的核心问题，直接关系到 `@loom/core` 能不能保持"小巧"。

### 3.1 必须进 Layer 1

| 项 | 理由 |
|---|---|
| `TraceSink` 接口 | 协议入口，所有 Sink 必须实现它 |
| `NullSink` | `trace: false` 的零成本默认 |
| `MemorySink` | **测试场景必需**——库作者要在测试里断言 trace |
| 数据类型定义 | `Trace`, `PassExecution`, `Mutation`, `Diagnostic` |
| `Trace.toJSON()` / `Trace.fromJSON()` | 序列化能力，跨层流通的前提 |
| `formatTrace(trace)` 极简文本函数 | 给 `console.log` 用，不超过 ~200 行，无颜色无 ANSI |

### 3.2 不应进 Layer 1

| 项 | 该去哪 | 理由 |
|---|---|---|
| ANSI 彩色 / 终端 pretty-print | Layer 2 | 涉及终端能力检测、第三方库 |
| HTML 报告模板 | Layer 2 | DOM 渲染依赖 |
| `FileSink` | **Layer 2** | 依赖 Node `fs`，浏览器场景会爆 |
| WebSocket / OTel 桥 | Layer 2+ | 依赖运行时环境 |

> **重要修订（与 `loom-observability.md §5.2` 不一致处）**：原文档把 `FileSink` 列为 v0.1 内置 Sink。本设计将其移到 Layer 2，因为：
> 1. 它依赖 Node `fs`，破坏了 Layer 1 的运行时中立
> 2. 纯 Core 用户在浏览器或 Edge Runtime 跑测试会因此被迫 polyfill
> 3. 写盘是"工具行为"，不是"协议本身"
>
> 这个调整在 ADR-002 的 Implementation Notes 中已同步记录。

---

## 4. 一个隐藏的对称性 — Layer 1 的极简成就了 L2/L3 的丰富

如果 Layer 1 做对了，Layer 2 / Layer 3 几乎是**装饰器模式**：

```
Layer 1 输出: trace JSON
   ↓
Layer 2 装饰: pretty-print, HTML render, time-travel UI
   ↓
Layer 3 装饰: Workbench, Live Debug, Studio 集成
```

**没有任何一层"重新发明" trace。** 它只是不断在同一份数据上叠加交互。这意味着：

- 升级 Layer 1 的 trace 格式，三层一起受益
- 第三方完全可以做自己的 Layer 2'（Vim 风格的 TUI 调试器、专用的 CI 报告、SaaS 控制台），只要消费 Layer 1 JSON 即可
- DevTool 生态可以百花齐放，官方实现不享有"走后门"特权

> 这与 Studio Tenet II（Transport API is the Contract）同构：**Trace 是 DevTool 的 Transport**。

---

## 5. 包结构

```
packages/
├── core/                          @loom/core           ← Layer 1
│   └── src/trace/
│       ├── types.ts               (Trace, Mutation, Diagnostic, ...)
│       ├── sinks/
│       │   ├── null.ts
│       │   └── memory.ts          (NO file.ts here)
│       ├── format.ts              (极简 formatTrace 文本输出)
│       └── serialize.ts           (toJSON / fromJSON)
│
├── devtool/                       @loom/devtool        ← Layer 2
│   └── src/
│       ├── sinks/
│       │   └── file.ts            (FileSink, 依赖 fs)
│       ├── cli/                   (loom-trace 命令)
│       ├── pretty/                (终端彩色输出)
│       ├── report/                (静态 HTML 生成器)
│       └── source/
│           └── trace-source.ts    (统一抽象, 给 L3 复用)
│
└── studio-poc/                    
    └── extensions/
        └── devtool/               loom-studio-devtool  ← Layer 3
            └── 复用 @loom/devtool 的渲染组件 + Studio 特有能力
```

**重点性质**：
- `@loom/devtool` 是独立包，**可以单装**（`npm i -D @loom/devtool` 就能用 CLI / 生成 HTML）
- 它**不依赖** Studio
- Studio 的 DevTool Extension **依赖** `@loom/devtool`，复用其渲染组件

---

## 6. 四种使用姿态

DevTool 在用户面前不是一种东西，是四种由浅入深的**姿态**。它们共用同一份底层数据，区别只在交互能力：

| 姿态 | 含义 | 何时可用 | 工程难度 |
|---|---|---|---|
| **A. Inspector** | "我已经跑过一次，让我看看发生了什么" | L2 起 | 易 |
| **B. Replayer** | "拿这次 trace，让我从第 N 个 Pass 开始重跑，看不同输出" | L3 | 中（IR 不可变红利） |
| **C. Workbench** | "给我一个白板手搓一个 Pipeline，喂数据看效果" | L3 | 较大 |
| **D. Live Debugger** | "在线上 Pipeline 里设断点、单步、改变量" | L3 + Pipeline 协议扩展 | 大 |

### 6.1 为什么 B/C/D 是 Loom 独有的红利

传统调试器要做"时间旅行"必须存全量状态。Loom 因为：

- **IR 不可变（白皮书 §2）** → 任何 snapshot 都能当输入
- **Pipeline 纯函数（ADR-007）** → 可重入、可 fork
- **mutation-only trace（ADR-002）** → 数据量小，可全程在线分析

——所以 B/C/D 几乎免费成立。**这是 Loom 在 DevTool 维度上对传统 LLM 框架的代差。**

### 6.2 dry run 的真实形态

用户直觉上的 "dry run" 其实是姿态 B 和 C 的组合：

- **B 路线（基于历史）**：拿一份生产 trace，replay，改参数 fork，对比两份输出
- **C 路线（凭空）**：手搓 Pipeline 配置 + 喂手写 fragments，跑出 trace 看效果

**两种 dry run 都不写盘、不调用真实 LLM、不影响生产。** Workbench 是它们的 UI 容器。

---

## 7. 三种部署形态 — 用 TraceSource 统一

DevTool 同一前端代码可以跑在三种宿主里：

| 形态 | 数据来源 | 用途 |
|---|---|---|
| 静态 HTML 报告 | 内嵌 JSON 文件 | 邮件分享、CI artifact、永久存档 |
| Studio Extension | 本地 Studio Kernel SDK | 日常开发 |
| 独立 Web App | 远程 Studio Transport | 远程调试、SaaS 形态 |

**统一关键**：前端永远通过 `TraceSource` 抽象消费数据：

```ts
interface TraceSource {
  // 列出可用的 trace
  listTraces(): Promise<TraceMeta[]>
  
  // 读取单个 trace（含 mutation 流）
  loadTrace(id: string): Promise<Trace>
  
  // 订阅实时 trace（仅 Studio / 远程支持）
  subscribe?(handler: (event: TraceEvent) => void): Unsubscribe
  
  // 在该 source 上启动一次新的 dry run（仅 Studio 支持）
  run?(passes: PassConfig[], fragments: Fragment[]): Promise<Trace>
}
```

三种形态各自实现这个接口：
- 静态 HTML：`StaticJsonSource`，`run` 不实现
- Studio Extension：`KernelSource`，全实现
- 独立 Web App：`TransportSource`，走 Studio Transport 远程

> 这个契约让 DevTool 前端代码 **100% 复用**，三种形态共享同一份 UI 实现。

---

## 8. DevTool 与 Studio 的关系

> DevTool 不是和 Studio 平级的"另一个产品"。**它是 Loom 的"自我诊断面"**。

```
                  ┌──────────────────────┐
                  │   Loom Core / Stdlib │
                  └──────────┬───────────┘
                             │ trace + mutation
            ┌────────────────┼────────────────┐
            ▼                ▼                ▼
      Studio (PoC)      loom-st         自家集成
            ▲                ▲                ▲
            └────────────────┼────────────────┘
                             │ TraceSource
                  ┌──────────┴───────────┐
                  │       DevTool        │
                  └──────────────────────┘
```

DevTool **横跨所有上层应用**：
- 单跑 Core 的人用 Layer 1
- 跑 ST 参考应用的人用 Layer 2
- 做 SaaS 集成的人也消费 Layer 1/2
- Studio 用户用 Layer 3

这个站位有两个重要后果：

1. **DevTool 不能假设 Studio 存在**——Layer 1 / Layer 2 必须独立可用
2. **Trace 文件格式必须升格为公开契约**——见 §9

---

## 9. 反向追加的契约

DevTool 分层方案让以下"原本是实现细节"的东西**升格为公开契约**：

| 项 | 原状态 | 升格后 |
|---|---|---|
| Trace JSON 格式 | 内部数据结构 | **公开 schema，需要版本号** |
| Pass 可重入性 | 文档建议 | **必须保证**（姿态 B 要 fork 重跑） |
| Pipeline 可部分执行 | 没提过 | **必须支持**（姿态 B 从中间开始） |
| Pass 配置 schema 内省 | ADR-005 提了 payload | **必须可枚举**（姿态 C 需要表单） |
| Snapshot 可序列化 | 内存里 | **必须可跨会话**（B/C 持久化重放） |

后两条是**新出现的工程需求**，目前 ADR 序列还没覆盖：

- **9.1 Pass 配置 schema 内省**：Workbench 要给用户表单填 Pass 配置，Pass 必须能"自描述"。可能是 zod schema、JSON schema 或 manifest。**这是 ADR-005 的延伸 follow-up。**

- **9.2 Snapshot 序列化的 Thunk 问题（已收口）**：早期白皮书曾允许 `fragment.content` 是 `(ctx) => string` 的 thunk。ADR-007 与 Core v0.1 已移除 Core thunk / Scope / Resolve Barrier，因此这不再是 Core Trace Schema 问题。若领域层保留 thunk，应在进入 Core 前 resolve 为 `content: string`，或由领域包自行定义序列化策略。

- **9.3 Trace JSON Schema 升格**：从内部数据格式升为对外契约，需要：
  - 显式 `version` 字段（已在 observability §10 待决议清单中）
  - 公开的 `schemas/trace.schema.json`（用于跨语言验证）
  - 兼容性策略（旧版工具读新版 trace 的降级行为）
  
  **这是候选 ADR 题。**

---

## 10. 实施路线图

| 阶段 | 版本 | Layer | 产物 | 姿态 |
|---|---|---|---|---|
| 0 | v0.1 | L1 | TraceSink + MemorySink + toJSON + formatTrace | A（仅文本） |
| 1 | v0.1 | L2 | CLI pretty-printer (`loom-trace pretty`) | A |
| 2 | v0.1.x | L2 | 静态 HTML 报告 (`loom-trace report`) | A |
| 3 | v0.2 | L3 | Studio Extension：Inspector + Replayer | A + B |
| 4 | v0.3 | L3 | Workbench | C |
| 5 | v1.0 | L3 + 协议扩展 | Live Debugger | D |

> **战略建议**：v0.3 的 Workbench demo 视频比白皮书 100 页更能说明 Loom 是什么。
> 哪怕只是 mock 演示——"拖一个 Pass 进来，看 fragment 怎么变化，回退三步、改一个配置、再跑一次"——这个 demo 是 Loom 在 LLM 框架红海里**唯一可拉开代差的那张牌**。

---

## 11. 与现有文档的关系

```
loom-whitepaper.md         —  语义层（Fragment / Pass / Pipeline 是什么）
loom-observability.md      —  协议层（运行时如何被观察）
loom-devtools.md           —  呈现层（投影虚拟树的 UX 哲学）
loom-devtool-layered.md    —  分发层（本文档：DevTool 如何被打包交付）
```

四份文档构成一个完整闭环。本文档是"分发层"——它不重新定义协议（observability 已经做了），不重新定义 UX（devtools 已经做了），它只回答 **"上面那些怎么打包交付到不同用户手里"**。

---

## 12. 非目标（明确不做）

避免 scope creep：

- **不做"统一 DevTool 二进制"**：分层就是分层，强行打包成一个东西会让纯 Core 用户付不必要的成本
- **不做付费版 / 高级版 DevTool**：Layer 1 与 Layer 2 都开源、免费、纯协议
- **不做协议鉴权 / 加密**：trace 是开发态产物，加密是 Sink 的事不是协议的事
- **不内置任何 LLM provider 的成本可视化**：那是 Metering 的事（参见多用户讨论），不混进 Trace
- **不做"自动诊断 / 智能建议"**：Diagnostic 系统已经够，AI 改进 prompt 是上层应用的事

---

## 13. Open Questions

需要在 v0.1 实现前拍板：

1. **Layer 1 是否需要 `ConsoleSink`？** 它依赖 `console.log` / 终端检测，介于 NullSink（无依赖）和 FileSink（fs 依赖）之间。倾向：**保留在 L1 但不带颜色**，颜色由 L2 的 pretty-printer 接管。

2. **MemorySink 默认无界还是 ring buffer？** ADR-002 决定 mutation-only 默认开，但默认开的 sink 必须有内存上限。倾向：**默认 ring buffer 1000 个 PassExecution**，可配置。

3. **Trace JSON Schema 是否独立仓库 / 包发布？** 影响第三方做 Layer 2' 的难度。倾向：**作为 `@loom/core` 子路径导出**（`@loom/core/trace-schema.json`），不另起包。

4. **`@loom/devtool` 是否提供 Web Component 形式的可嵌入组件？** 让用户可以把 trace 渲染嵌进自家管理后台。倾向：**v0.2 再说**，先把 CLI / HTML / Studio Extension 三种主流形态做稳。

---

_本文档为 RFC，欢迎在 v0.1 实施前挑战分层划分。FileSink 的归属调整已在 ADR-002 同步；Pass 配置内省（§9.1）、Thunk 序列化（§9.2）、Trace Schema 公开化（§9.3）三项作为后续 ADR 候选挂起。_
