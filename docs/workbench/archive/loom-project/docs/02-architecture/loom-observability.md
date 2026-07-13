# Loom Observability — 可观测性与工具协议

> 状态：Draft / RFC
> 前置文档：`loom-whitepaper.md`, `loom-devtools.md`
> 适用范围：v0.1 ~ v0.3

---

## 0. 这份文档解决什么问题

白皮书回答了 "Loom 是什么"，DevTools 文档回答了 "用户看到的结构是什么"。
这份文档回答一个更底层、更工程化的问题：

> **Core 运行时如何把"发生了什么"这件事，以一种稳定、可被多种工具消费的方式暴露出来？**

具体涵盖五个子问题：

1. Pass 之间冲突、互相覆盖的问题如何暴露（而非"解决"）
2. Loom 的 DevTool 以什么形态存在、按什么节奏推进
3. 编译期的 warning / error 如何建模（Diagnostic 系统）
4. DevTool 的数据从哪来、怎么流动
5. 缓存命中状态如何在不污染 Core 的前提下暴露给工具

这份文档的定位类似 **Chrome DevTools Protocol 之于 Chromium**、**LSP 之于 IDE**：
**协议稳定比任何一个具体 UI 重要十倍。**

---

## 1. 设计原则

在进入细节前，先锁死五条原则。后续所有设计决策都必须符合这五条。

### P1. Core 永远不知道 DevTool 的存在

Core 只产出结构化数据（Trace）。它不知道谁在消费，也不关心。
所有 DevTool（CLI、HTML report、VS Code 扩展、Web UI）都只消费 Trace。
这是 **一对多** 关系，不是 **一对一**。

### P2. 协议先于 UI

v0.1 的核心交付物是 **Trace 协议的 JSON Schema**，不是界面。
只要协议稳定，UI 可以被任何社区成员替换、重写、多套并存。

### P3. 暴露，而不是隐藏

Pass 冲突、越权写入、缓存未命中 —— Loom 的态度是 **让它可见**，不是 **帮用户消除**。
一旦 Core 开始"处理"这些问题（事务、回滚、合并），它就会从 60 行膨胀到 6000 行。

### P4. 零成本默认

`trace: false` 时，所有观测代码应当是 **no-op 或接近 no-op**。
生产环境不能因为 DevTool 的存在而付出任何性能代价。

### P5. 预留优于破坏

对于 v0.1 暂不实现的能力（缓存、分布式、采样），协议必须 **预留字段**。
v0.2 加入实现时，不允许破坏性升级。

---

## 2. 核心数据模型

### 2.1 四种基本事件

整个可观测性系统只有四种事件类型，按层级排列：

```
Trace                       一次完整的 pipeline.run()
├── PassExecution[]         每个 Pass 的一次执行
│   ├── Snapshot (before)   执行前的 fragments 视图
│   ├── Snapshot (after)    执行后的 fragments 视图
│   ├── Mutation[]          before→after 的 diff
│   └── Diagnostic[]        这个 Pass 产生的诊断
└── metadata                pipeline 元信息（id、时间、版本）
```

### 2.2 Snapshot

**定义**：某一时刻 `fragments[]` 的**引用快照**。

```ts
interface Snapshot {
  timestamp: number         // 相对 run 开始的毫秒数
  fragments: Fragment[]     // 注意：引用保存，不 deep clone
  hash?: string             // 可选，用于 dedup
}
```

**关键实现约定**：
- 因为 Fragment 在 Loom 中约定为 **不可变**，快照可以直接保存引用
- 如果 Pass 返回了未修改的同一个 Fragment，两个 Snapshot 指向同一对象，内存成本为零
- 只有 Pass 实际创建了新 Fragment 时，才会产生新对象 —— 这本就是 Loom 的语义

### 2.3 Mutation

**定义**：相邻两个 Snapshot 之间的结构化 diff。

```ts
type Mutation =
  | { op: 'add';    fragment: Fragment;                   index: number }
  | { op: 'remove'; fragmentId: string;                   index: number }
  | { op: 'update'; fragmentId: string; before: Fragment; after: Fragment }
  | { op: 'move';   fragmentId: string; fromIndex: number; toIndex: number }
```

**为什么不存 JSON Patch**：
- fragmentId 让 DevTool 能把 mutation 关联到节点（画红波浪线、闪烁等）
- `before/after` 保留完整对象，让 DevTool 可以做字段级 diff，但也可以只看 id
- `move` 单列一种 op，因为"顺序调整"在 Loom 里语义重要（Priority Pass 的主要作用就是这个）

Mutation 由 **引擎在 Pass 执行后自动计算**，Pass 作者无感。

### 2.4 Diagnostic

**定义**：结构化的编译期信息，对标 TypeScript Compiler 的 `Diagnostic`、ESLint 的 `Message`。

```ts
interface Diagnostic {
  severity: 'error' | 'warning' | 'info' | 'hint'
  code: string                      // 稳定标识符，例如 'loom/duplicate-id'
  message: string                   // 人类可读
  pass: string                      // 哪个 Pass 产生的
  fragmentId?: string               // 关联到哪个 fragment（关键）
  at?: number                       // 相对 run 的毫秒时间戳
  meta?: Record<string, unknown>    // 机器可读附加信息
  relatedFragmentIds?: string[]     // 相关的其他 fragment（用于"级联失效"这类场景）
}
```

**命名约定**：
- 引擎内建 code：`loom/<kebab-case>`（例：`loom/duplicate-id`, `loom/undeclared-write`）
- 用户 Pass 的 code：`<namespace>/<kebab-case>`（例：`myapp/budget-exceeded`）
- 禁止无 namespace 的裸 code，为将来扩展留空间

**严重等级的语义**：
| 级别 | 引擎行为 | DevTool 展示 |
|---|---|---|
| `error` | 默认收集，`strict: true` 时中断 | 红色，阻断视觉 |
| `warning` | 只收集，永不中断 | 黄色 |
| `info` | 收集 | 蓝色，默认折叠 |
| `hint` | 收集 | 灰色，默认隐藏 |

**关键规则**：`error` 级 Diagnostic **默认不中断 pipeline**。中断是 `throw` 的事，不是 Diagnostic 的事。
这是一个刻意的设计选择——让 Pass 可以报告"这里很严重但我还能往下跑"，和 ESLint 的 `--max-warnings 0` 理念一致。

### 2.5 PassExecution

> **2026-05-14 收口说明**：Trace v0.1 默认是 mutation-only；snapshot 默认关闭且只在显式 opt-in 时出现。下面类型以 Core v0.1 为准，不再要求 `snapshotBefore` / `snapshotAfter` 必填。

```ts
interface PassExecution {
  pass: string                      // Pass 的 name
  passVersion?: string              // 可选，Pass 作者声明的版本
  startedAt: number
  durationMs: number
  snapshotBefore?: Snapshot          // 仅 snapshot opt-in 时存在
  snapshotAfter?: Snapshot           // 仅 snapshot opt-in 时存在
  mutations: Mutation[]
  diagnostics: Diagnostic[]
  cache?: CacheStatus               // v0.1 永远为 { status: 'disabled' }
  error?: { message: string; stack?: string }  // Pass throw 时填
}
```

### 2.6 Trace（顶层）

```ts
interface Trace {
  version: '1'                      // 协议版本，破坏性升级时递增
  traceId: string
  pipelineId: string
  pipelineVersion?: string
  startedAt: number                 // 绝对时间戳（unix ms）
  durationMs: number
  initialFragments: Fragment[]       // replay 起点
  passConfigs?: PassConfig[]         // 配置化 pipeline 的声明，若通过 registry 运行则存在
  executions: PassExecution[]
  finalFragments: Fragment[]        // 最终输出
  diagnostics: Diagnostic[]         // 引擎级（非任何 Pass 归属）的诊断
  env?: {
    loomVersion: string
    nodeVersion?: string
    platform?: string
  }
}
```

---

## 3. Pass 冲突：声明式暴露

> **2026-05-14 收口说明**：`reads` / `writes` / `requires` / `provides` 是声明与 lint 输入，不是 Core 强校验契约。Core v0.1 不做 capability validation，不因 `requires` 缺失而构造失败；相关检查属于 `@loom/stdlib` 的 `validatePipeline`、DevTool 或 CI。

### 3.1 Pass 接口扩展

```ts
interface Pass<In = Fragment, Out = Fragment> {
  name: string
  version?: string

  // 可选的能力声明 —— 不声明则视为 '*'
  reads?:    FieldPath[]            // 读取哪些字段
  writes?:   FieldPath[]            // 写入哪些字段
  requires?: Capability[]           // 执行前需要哪些 capability
  provides?: Capability[]           // 执行后提供哪些 capability

  run(fragments: In[], ctx: PassContext): Out[]
}

type FieldPath = string             // 例如 'content', 'meta.priority'
type Capability = string            // 例如 'resolved', 'sorted', 'deduped'
```

### 3.2 Linter / DevTool 在四个时机可做检查

| 时机 | 检查项 | 违反时 |
|---|---|---|
| pipeline lint 时 | `requires` 能否被前序 Pass 的 `provides` 满足 | **Stdlib / DevTool diagnostic，不影响 Core run** |
| Pass 执行前 | 输入 fragments 是否满足 `requires` 的 runtime 形态 | **可选 lint diagnostic** |
| Pass 执行后 | 实际 mutation 涉及的字段是否在 `writes` 声明内 | **Diagnostic warning（`loom/undeclared-write`）** |
| Pass 执行后 | 声明的 `provides` 是否真的提供了 | **可选 lint diagnostic** |

**注意第三条**：引擎通过 Mutation 反向推断实际写入的字段，和 `writes` 声明比对。越权写不会被阻止，只会被标记。这保留了 "我就是要暗中做点什么" 的自由，同时让 DevTool 能把它渲染出来。

### 3.3 拓扑排序 / Capability validation

如果 pipeline 中某个 Pass 声明了 `requires: ['sorted']`，`@loom/stdlib` 的 `validatePipeline()` 或 DevTool 可以检查：
- 它之前是否存在一个 Pass `provides: ['sorted']`
- 如果不存在，生成 lint diagnostic，提示调用方调整 PassConfig 顺序

Core v0.1 不做拓扑排序，也不因 capability 缺失阻止 `Pipeline.run()`。顺序的唯一真相仍是调用方给出的 PassConfig / Pass 数组顺序。

### 3.4 不做的事

- **不**引入事务 / 回滚 / 隔离副本
- **不**自动合并冲突的 Pass 输出
- **不**强制所有 Pass 必须声明 `reads/writes`（声明是可选的，未声明视为 `*`）
- **不**把"互相撤销"的 Pass（Pass A 加了 X，Pass B 静默删除 X）判定为错误 —— 这种情况由 DevTool 的 Mutation 时间轴暴露，靠人眼发现

---

## 4. Diagnostic 系统

### 4.1 产出方式

Pass 作者通过 `ctx` 产出 Diagnostic：

```ts
run(fragments, ctx) {
  for (const f of fragments) {
    if (f.meta.tokens > 8000) {
      ctx.warn({
        code: 'myapp/fragment-too-large',
        message: `Fragment ${f.id} exceeds 8k tokens`,
        fragmentId: f.id,
        meta: { tokens: f.meta.tokens },
      })
    }
  }
  return fragments
}
```

`ctx` 上的快捷方法：
- `ctx.error(d)` / `ctx.warn(d)` / `ctx.info(d)` / `ctx.hint(d)`
- 自动填充 `pass`、`at` 字段

### 4.2 引擎内建的 Diagnostic Code（v0.1）

| Code | 级别 | 含义 |
|---|---|---|
| `loom/duplicate-id` | error | 同一 run 中出现相同 fragment id |
| `loom/circular-parent-id` | error | `meta.parentId` 形成环 |
| `loom/dangling-parent-id` | warning | `meta.parentId` 指向不存在的 fragment |
| `loom/undeclared-write` | warning | Pass 写入了 `writes` 未声明的字段 |
| `loom-stdlib/missing-capability` | error | Stdlib / DevTool lint 发现 `requires` 的 capability 未被前序 Pass 提供 |
| `loom/pass-timeout` | error | Pass 执行超时（需用户配置阈值） |
| `loom/pass-threw` | error | Pass 抛出异常（引擎捕获后转 Diagnostic） |
| `loom/empty-pipeline` | info | pipeline 为空 |

**v0.1 不追求大而全**，以上 8 条足够覆盖最常见的错误路径。

### 4.3 Diagnostic 与 fragment 的关联

**这是 Diagnostic 区别于 `console.log` 的本质**：它能被 DevTool 渲染到具体 fragment 节点的侧边，像 VS Code 里的红波浪线。

DevTool 实现建议：
- 每个 fragment 节点右上角一个徽章，显示它收到的 Diagnostic 数量
- 点击徽章展开诊断列表
- 按 severity 颜色分类
- 支持在 "Filter → Show only fragments with warnings" 等过滤器

---

## 5. TraceSink：数据通道

### 5.1 接口

```ts
interface TraceSink {
  onTraceStart?(trace: Pick<Trace, 'traceId' | 'pipelineId' | 'startedAt' | 'input'>): void
  onPassExecution?(execution: PassExecution): void
  onDiagnostic?(diagnostic: Diagnostic): void
  onTraceEnd?(trace: Trace): void
}
```

**为什么是流式接口而非一次性返回 Trace**：
- 长 pipeline（数十个 Pass）可以边跑边写盘，不占内存
- WebSocketSink 可以实时推送到远程 DevTool
- 一次性获取 Trace 只是 `MemorySink` 的一个特例

### 5.2 内建的 Sink（按分层归属）

> **修订（2026-04-29）**：原文档把 `FileSink` 列为 Core 内置 Sink。经 [`loom-devtool-layered.md`](./loom-devtool-layered.md) 设计讨论，FileSink 因依赖 Node `fs`、破坏 Layer 1 的运行时中立性，已从 Core 移到 `@loom/devtool` 包（Layer 2）。
> 同步参见 ADR-002 Implementation Notes。

| Sink | 用途 | 归属 | 优先级 |
|---|---|---|---|
| `NullSink` | `trace: false` 时使用，所有方法为 no-op | **Layer 1**（`@loom/core`） | 必做 |
| `MemorySink` | 跑完后一次性返回 Trace 对象，测试和 REPL 首选 | **Layer 1**（`@loom/core`） | 必做 |
| `ConsoleSink` | 直接打印到 stdout，文本格式（无 ANSI 颜色） | **Layer 1**（`@loom/core`） | 建议做 |
| `FileSink` | 流式写到 `./trace.json` 或 `.loom-trace/<traceId>.json` | **Layer 2**（`@loom/devtool`） | 必做 |
| Pretty CLI Printer | 终端彩色输出、树形结构 | **Layer 2**（`@loom/devtool`） | 必做 |

**Layer 1 的判断标准**：运行时中立（不依赖 fs / 终端能力 / DOM），代码量小（不引入第三方依赖）。
**暂不做**：WebSocketSink、OTelSink、HttpSink —— 推到 v0.2+，且都属于 Layer 2 或上层 Sink。

### 5.3 使用形态

```ts
const pipeline = new Pipeline([...])

// 不开启观测
await pipeline.run(input)

// 开启观测
const { fragments, trace } = await pipeline.run(input, {
  trace: true,                                   // 等价于 sink: new MemorySink()
})

// 或者指定 sink
await pipeline.run(input, {
  sink: new FileSink('./trace.json'),
})

// 或者多个 sink
await pipeline.run(input, {
  sink: [new ConsoleSink(), new FileSink('./trace.json')],
})
```

### 5.4 零成本保证

当 `trace: false` 且未指定 sink：
- Core 不构造任何 Snapshot
- Core 不计算任何 Mutation
- `ctx.warn` 等方法直接 return
- 唯一开销是一个 if 判断

性能测试基准（v0.1 目标）：10k fragments + 50 Pass，`trace: false` 相比 `trace: true` 有 **至少 50x** 速度差异。

---

## 6. 缓存可见性（协议预留）

### 6.1 v0.1 不实现，但必须预留

```ts
interface CacheStatus {
  status: 'hit' | 'miss' | 'disabled' | 'bypassed'
  layer?: 'pass' | 'fragment-resolve' | 'sub-pipeline'
  key?: string
  reason?: string                    // miss 的原因
  savedMs?: number                   // hit 时节省的时间估计
}
```

v0.1 所有 `PassExecution.cache` 都填 `{ status: 'disabled' }`。
DevTool 可以忽略这个字段，但 UI 组件应当 **为它保留位置**（例如每个 Pass 节点左上角的小角标）。

### 6.2 计划中的缓存层（v0.2+）

| 层 | 对象 | 缓存 Key | 引入版本 |
|---|---|---|---|
| L1 | 单个 Pass 的整批输出 | `hash(passId + passVersion + inputHash + params)` | v0.2 |
| L2 | 单个 fragment 的 resolve 结果 | `hash(fragmentId + cacheKey)` | **v0.2（最先做）** |
| L3 | Sub-pipeline 整体结果 | `hash(subPipelineId + inputHash)` | v0.3+ |
| L4 | LLM 响应 | 不做 —— 这是应用层的事 | 永不 |

**L2 最先做的理由**：RAG / 向量检索这类 resolve 单次数百毫秒，同一 run 内命中收益巨大，且语义最简单（异步 memoization）。

### 6.3 缓存的 DevTool 呈现（v0.2 规划）

- 每个 Pass 节点的小角标：**绿** = hit、**灰** = miss、**空** = disabled
- Trace 顶部一个全局统计条：总命中率、节省毫秒数
- "因果失效"可视化：hover 一个被修改的 fragment，高亮所有因此失效的 Pass 和 fragment
- 直接沿用 **Next.js build output 的静态/动态色标** 和 **Turborepo 的 cache hit 标识**，复用用户既有心智模型

---

## 7. DevTool 实施路线图

> **本节范围已收窄**：DevTool 的完整分发模型（三层洋葱、四种姿态、五种用户场景）已迁移至 [`loom-devtool-layered.md`](./loom-devtool-layered.md)。本节只保留 v0.1/v0.1.x 的具体产出形态，作为分层方案的"Layer 2 首发部分"细化。

**核心决策：不在 v0.1 做任何带 server 的交互式 UI。** 所有 v0.1 产物都是 Layer 2（`@loom/devtool`）的 CLI / 静态 HTML 形态，不涉及 Layer 3（Studio Extension）。

### 7.1 阶段一 —— v0.1：CLI Pretty-Printer

**产物**：`loom trace <file>` 或 `pipeline.run({ sink: new ConsoleSink() })`

**形态**：
```
pipeline: rag-qa (traceId: abc123) — 842ms

├─ ResolvePass                           127ms  [■■] 2 warnings
│  ├─ + frag:q1 (resolved)
│  └─ + frag:ctx-1..ctx-5 (resolved)
├─ DedupById                              3ms
│  └─ - frag:ctx-3 (duplicate of ctx-1)
├─ OrderByPriority                        2ms  [move x4]
├─ BudgetTrim (maxTokens: 4000)          15ms
│  ├─ - frag:ctx-4 (grayed: over budget)
│  └─ - frag:ctx-5 (grayed: over budget)
└─ StringifyPass                          4ms

diagnostics:
  warning [myapp/fragment-too-large]  frag:ctx-2   12k tokens
  warning [loom/undeclared-write]     BudgetTrim   wrote meta.trimmedAt
```

**技术选型**：`picocolors` + 手写树形打印，约 300 行。
**价值**：让用户第一天就能看到"投影虚���树"的雏形，不用等 v0.2。

### 7.2 阶段二 —— v0.1.x：静态 HTML Report

**产物**：`loom report trace.json -o out.html`

**形态**：
- **单文件 HTML**，内嵌所有数据和 JS，可离线打开
- 折叠 / 展开 Pass 节点
- 时间轴滑块（拖到任意时刻看当时 fragments 状态）
- Diagnostic 面板
- 全文搜索

**技术选型**：
- Preact 或���框架纯 DOM（避免拖一整个 React 生态进来）
- 最终产物单文件 < 500KB
- 不需要构建步骤，用户拿到 HTML 双击即可

**价值**：这是 **工件（artifact）**，不是 **产品**。可以随 PR 提交、粘到 issue、CI 里生成归档。这是 sourcemap / Lighthouse report / `tsc --listFiles` 的定位。

### 7.3 阶段三及之后 —— v0.2+：交互式 DevTool

v0.2+ 起进入 Layer 3 形态（Studio Extension），具体路线图（Inspector / Replayer / Workbench / Live Debugger 四种姿态的演进）由 [`loom-devtool-layered.md §10`](./loom-devtool-layered.md) 统一管理，本文档不再重复。

**关键约束**：v0.2+ 的 Layer 3 必须复用 v0.1 的 Layer 1/2 数据格式，不允许在 Layer 3 引入"Studio 内部专用"的 trace 形态。

**不推荐的方向**：
- 浏览器扩展（React DevTools 路线）—— Loom 主要跑在 Node 后端
- 实时 WebSocket Web UI —— 协议未稳定前白做

### 7.4 阶段总览

| 阶段 | 版本 | Layer | 产物 | 代码量 |
|---|---|---|---|---|
| 一 | v0.1 | L2 | CLI pretty-printer | ~300 行 |
| 二 | v0.1.x | L2 | 静态 HTML report | ~1500 行 |
| 三 | v0.2+ | L3 | Studio Extension（详见分层文档） | 视情况 |

---

## 8. 非目标（v0.1 刻意不做）

明确列出来，避免 scope creep：

- 分布式 Trace（跨进程、跨服务关联）
- 采样（生产环境降采样）
- 远程 Sink（Sentry / Datadog / OTel 导出）
- 实时 WebSocket 推送
- 任何形式的缓存实现
- Pass 的事务 / 回滚 / 自动合并
- 自动化的 Pass 顺序修复（只做检查，不做修复）
- Trace 的持久化索引 / 查询语言
- 多次 run 之间的对比视图（这是 v0.2 HTML report 的功能）

以上每一项单独都可以做，但 **任何一项进入 v0.1 都会拖垮节奏**。

---

## 9. 与白皮书、DevTools 文档的关系

- **白皮书（whitepaper）**定义了 Fragment、Pass、Pipeline 的不可变语义。本文档的所有数据模型都建立在那之上。
- **DevTools 文档（loom-devtools）**定义了"平铺底座投影为虚拟树"的 UI 抽象。本文档的 Trace 协议是那个 UI 的数据源。
- **DevTool 分层方案（loom-devtool-layered）**定义了 DevTool 如何被打包交付到 Layer 1/2/3 三种用户群。本文档的 Trace 协议是这个分发模型的"基础数据契约"。
- **Core v0.1** 的 `Pass.run` 签名以 [`../04-next-steps/loom-core-v0.1-engineering.md`](../04-next-steps/loom-core-v0.1-engineering.md) 为准，保持同步返回；`reads/writes/requires/provides` 只是声明字段与 lint 输入。

四份文档构成 v0.1 的完整设计闭环：

```
whitepaper.md              —  语义层（Fragment / Pass / Pipeline 是什么）
observability.md           —  协议层（运行时如何被观察，本文档）
devtools.md                —  呈现层（投影虚拟树的 UX 哲学）
devtool-layered.md         —  分发层（三层洋葱、L1/L2/L3 包结构）
```

---

## 10. 待决议问题（Open Questions）

以下几点 **v0.1 实现前必须拍板**，文档目前持保留态度：

1. **Snapshot 的存储粒度**：每个 Pass 前后各一个，还是每个 Mutation 之间都存？
   倾向：**只存 Pass 前后**，Mutation 足以重建中间状态。

2. **Pass 内部的子 Pipeline 如何进入 Trace**：作为嵌套的 PassExecution？
   倾向：**作为嵌套的 Trace**（每个 sub-pipeline 一个完整的 Trace，父 Trace 通过 `childTraceIds` 引用）。

3. **`ctx.warn` 是否允许在 Pass 返回后追加**：
   倾向：**否**。Diagnostic 的归属时机必须严格。

4. **Trace 协议的版本演进策略**：
   倾向：`version: '1'` 字段，破坏性升级时递增，CLI / HTML report 同时支持最近 2 个 major 版本。

5. **是否需要 `traceId` 之外的"run 相关性" ID**（例如对应上游用户请求）：
   倾向：**仅保留 `meta: Record<string, unknown>` 自由字段**，不引入一级字段。

这五个问题应当在 v0.1 动工前，以 ADR（Architecture Decision Record）形式单独回答。

---

## 附录 A：最小可行 v0.1 核对清单

如果要在最短时间内落地本文档描述的全部协议，精确的工作清单如下：

- [ ] 定义 `Trace` / `PassExecution` / `Snapshot` / `Mutation` / `Diagnostic` 的 TS 类型
- [ ] 定义 Trace 的 JSON Schema（用于跨语言/跨版本校验）
- [ ] 实现 `TraceSink` 接口和 Core 内建 Sink：`NullSink` / `MemorySink`；`FileSink` 属于 `@loom/devtool`
- [ ] 在 Core 的 `pipeline.run` 中注入 trace 钩子，确保 `trace: false` 时零成本
- [ ] 在 `@loom/stdlib` / DevTool 中实现 Pass 的 `reads/writes/requires/provides` 声明 lint；Core 不强制 capability validation
- [ ] 实现引擎内建的 8 个 Diagnostic code
- [ ] 实现 Mutation 自动推断
- [ ] 实现 CLI pretty-printer（阶段一 DevTool）
- [ ] 性能基准测试：`trace: false` 相对无 trace 代码的额外开销 < 2%
- [ ] 性能基准测试：10k fragments + 50 Pass 跑出 Trace 后 `MemorySink` 的峰值内存

以上十项全部完成，即可声明 Loom v0.1 达到 **可观测性基线**。

---

_本文档为 RFC，欢迎在 v0.1 动工前挑战任何决策。任何在实现中发现的与本文档冲突之处，以实现为准，并提交文档 PR 修正。_
