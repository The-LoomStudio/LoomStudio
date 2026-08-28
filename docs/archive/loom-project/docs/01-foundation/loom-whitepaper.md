# Loom 白皮书

> 一台织机。你提供丝线与编织的规则，它保证每一次编织的结果都是确定的、可追溯的、可复现的。

**版本**: 0.2-draft
**状态**: 设计阶段，尚未进入实现

> **2026-05-14 收口说明**：本文是早期白皮书，保留项目愿景与三层架构背景；其中涉及 `Promise<string>` content、content thunk、Resolve Barrier、`ResolutionPass`、Core Scope、snapshot-first Trace 默认值的内容已被 [`../04-next-steps/loom-core-v0.1-engineering.md`](../04-next-steps/loom-core-v0.1-engineering.md) 与 [`../04-next-steps/adr/`](../04-next-steps/adr/) 覆盖。
>
> 正式 v0.1 施工以 Core v0.1 工程蓝图和 ADR-001~007 为准：`Fragment.content` 只接受 `string`；`Pass.run()` / `Pipeline.run()` 均为同步；Core 不提供 Resolve Barrier、Thunk content 或 Scope；Capability validation 属于 Stdlib / DevTool lint；Trace 默认 mutation-only，snapshot 默认关闭。

---

## 目录

0. [命名与意象](#0-命名与意象)
1. [项目定位](#1-项目定位)
2. [设计原则](#2-设计原则)
3. [三层架构](#3-三层架构)
4. [核心抽象](#4-核心抽象)
5. [执行模型](#5-执行模型)
6. [IR 语义与不可变性](#6-ir-语义与不可变性)
7. [插值与模板](#7-插值与模板)
8. [可观测性](#8-可观测性)
9. [错误模型](#9-错误模型)
10. [Core 不做什么](#10-core-不做什么)
11. [Stdlib](#11-stdlib)
12. [DevTools](#12-devtools)
13. [参考类型草案](#13-参考类型草案)
14. [与相邻系统的关系](#14-与相邻系统的关系)
15. [开放问题](#15-开放问题)
16. [路线图](#16-路线图)
17. [附录 A：完整使用示例](#附录-a一个完整的使用示例伪代码)

---

## 0. 命名与意象

**Loom**，织机。

选择这个名字的原因：

- **织机是纯机械的**。它不决定图案，不挑选丝线的颜色，不定义这匹布最终被用作衣服还是地毯。它只保证：给定经线、纬线与规则，产出是确定的、可复现的。
- **多股汇聚**。Loom 的工作本质是把来自不同方向、不同属性、不同生命周期的"丝线"（数据碎片）汇聚为一匹连续的结构。
- **中立**。同一台织机可以织锦缎也可以织麻布——图案由织工决定，不由织机决定。

Loom 不是一个"提示词框架"，也不是一个"Prompt 编译器"。它是一条中立的、可编程的、可观测的数据管线，恰好非常适合用来组织复杂的 LLM 上下文，但它的职责边界停留在更抽象的层面：**有序地、确定地、可追溯地处理一组数据碎片**。

---

## 1. 项目定位

### 1.1 一句话定位

> Loom 是一个通用的、Headless 的数据碎片编排引擎，作为 LLM 应用（以及任何需要复杂文本/结构组装的系统）的底层基础设施存在。

Loom 由三层组成：**Core**（引擎）、**Stdlib**（推荐词汇与参考 Pass）、**DevTools**（可观测性客户端）。三层各自有独立的节奏、独立的稳定性承诺、独立的生态位置。详见 §3。

### 1.2 它解决的问题

复杂的 LLM 应用（Agent、角色扮演、复合 RAG、多文档推理、带长期记忆的对话系统等）面临一个共同困难：

**最终喂给模型的上下文，是由许多来源、许多生命周期、许多优先级的数据碎片拼接而成的**。这些碎片之间存在关系、冲突、预算约束和顺序依赖。而现有的抽象——字符串模板、链式 chain、单纯的 messages 数组——都不足以描述这种复杂性，也不足以让开发者**看见**组装过程。

Loom 的假设是：这件事本质上是一个**编译问题**——在高层语义（一堆碎片加一堆关系）和低层产物（一段可被消费的文本或结构）之间，需要一个中间表示（IR）和一条可编程的优化管线。

### 1.3 它不打算成为的东西

Loom **不是** LangChain、LlamaIndex、AutoGen 的替代品。这些系统是**编排层**（orchestration）——它们决定"下一步调什么模型、什么工具、如何处理返回"。Loom 是它们下一层的**组装层**（composition）——当编排层决定"现在需要构造一个 prompt"时，它调用 Loom。

一个合理的技术栈可能是：

```
你的应用
  └─ LangChain / 自研编排
       └─ Loom（负责构造每一次 LLM 调用的输入）
            └─ 模型 SDK
```

Loom 也**不是**一个针对特定领域（如 roleplay、tavern、code assistant）的解决方案。它是这些领域的**公共底座**，具体领域的约定通过**场景预设**（如 `@loom-tavern/stdlib`）在 Loom 之上构建。Loom 团队不维护这些场景预设——它们由最了解该场景的社区成员维护。

### 1.4 用户画像

Loom 服务一类用户：**他们的提示词复杂到让字符串模板和简单 messages 数组都显得力不从心**。

具体表现为至少满足以下一项：

- 上下文由多个独立来源组装（系统规则 + 人设 + 世界观 + 对话历史 + RAG + 工具返回 + ...）
- 不同来源的生命周期不同（永久、会话、单轮、临时）
- 存在预算压力，需要在超长上下文和模型窗口限制之间做取舍
- 存在冲突与覆盖（玩家的临时指令覆盖默认人设、红线规则压制 RAG 噪音等）
- 需要调试与回放能力，能够解释"为什么这次的 prompt 长这样"

对这些用户来说，Loom 提供的是**一个让组装过程变成一等公民的地方**。对于不需要这种复杂性的用户，Loom 是过度设计——这没关系，他们不是我们的用户。

Loom 的生态里还存在另外几类用户，他们对三层架构各有不同的依赖关系。完整的角色图谱见 §3.3。

---

## 2. 设计原则

Loom 的全部设计决策都可以由以下原则推导出来。每当遇到分歧，以原则为准。

### 2.1 The Engine Does Less Principle（引擎少做一点）

每当遇到"我们要不要管 X"的问题，默认答案是**不管**。只有当 X 是：

1. 纯机械的（不需要领域知识就能做对），
2. 与领域无关的（对所有用户都是同一种做法），
3. 不做会让核心语义不完整（缺了它管线就跑不起来）

三个条件**同时满足**时，Loom Core 才把 X 纳入核心。

这条原则的直接推论是，Core 的核心职责只有三件：

1. **执行 Pass 管线**——按用户给定的顺序跑一串变换
2. **维护 IR 的不可变性**——每一步的输入输出都是冻结的
3. **提供可观测性**——每一步发生了什么，用户都能看见

除此之外的一切——排序策略、聚合策略、冲突解决、预算剪枝、文本清洗、最终输出格式、数据源接入——都不是 Core 的职责。其中一部分会由 **Stdlib**（§11）提供参考实现，另一部分则完全交给生态。

### 2.2 Determinism over Smartness（确定性优先于聪明）

Loom 永远选择**可预测**而不是**聪明**。

- 不做任何"智能默认"——所有行为都来自用户显式注册的 Pass
- 不做任何"隐式清洗"——输入什么字符，输出就有什么字符
- 不做任何"猜测性修复"——遇到非预期输入就报错，不尝试挽救
- 不做任何"自动降级"——预算超限了就由 Pass 决定怎么处理，引擎不代做决定

聪明的系统难以调试，可预测的系统才能成为基础设施。

### 2.3 Structure over Semantics（结构优于语义）

Loom 的 IR 本身**不携带任何语义**。

- `DataFragment` 有 `id`、`content`、`meta`——`id` 和 `content` 是结构，`meta` 是开放给用户/Pass 自己定义的语义载荷
- 没有 `priority`、`volatility`、`group`、`target`、`role`、`channel`——这些都是某个 Stdlib 或某个 Pass 关心的概念，不是引擎关心的概念
- 没有任何字段需要 Pass 作者"理解并保持兼容"

这一条是生态能否健康生长的关键。Core schema 的每一个字段都是对生态的路径依赖锁。越少越好。

### 2.4 Neutral Boundaries（中立的边界）

Loom 的输入和输出都是 IR（一组 `DataFragment`）。

- **入口**：用户提交一组 `DataFragment` 和一串 `Pass`
- **出口**：产出一组处理后的 `DataFragment`

Loom **不承担"拍扁成字符串"或"转成 messages 数组"或"按某个模型 API 的 schema 序列化"的工作**。这些都是由用户编写的、管线中最后一个 Pass 完成的。这条边界让 Loom 可以服务于：

- 要单条字符串的场景
- 要 OpenAI messages 数组的场景
- 要 Anthropic system + messages 分离结构的场景
- 要 Gemini contents + systemInstruction 结构的场景
- 要某种未来新模型 API 的场景
- 要"构造一段文档/报告/消息正文"等根本不是 prompt 的场景
- 要"把处理结果作为另一个 Pipeline 的输入"的场景

**任何对最终形态的预设，都是对生态未来形态的限制。**

### 2.5 Restraint Enables Abundance（克制成就丰富）

Core 的克制是 Stdlib 和 DevTools 丰富度的前提。

- Core 保证 IR 不可变，DevTools 才能做时间线与 diff
- Core 保证不插手 meta，Stdlib 才有定义公共词汇的空间
- Core 保证不预设最终形态，生态才能为不同模型 API 各自编写 Pass

这不是一个"为了极简而极简"的学术洁癖。**每一条 Core 的克制，都对应着上面某一层的一块氧气供应。** 当你觉得 Core 小到怀疑它能不能构成一个产品时，请记得产品力不在 Core 里，而在它允许的那些层。

---

## 3. 三层架构

Loom 作为产品，不是一个单一的包，而是一个由三层构成的协议栈：

```
┌─────────────────────────────────────────────────────┐
│  Layer 3: DevTools                                  │
│  snapshot 浏览、diff 可视化、时光倒流、贡献归因     │
│  生态可以在此之上建立 lint、test、replay 等元工具   │
├─────────────────────────────────────────────────────┤
│  Layer 2: Stdlib                                    │
│  推荐的 meta schema + 一小组参考 Pass               │
│  让陌生插件之间拥有共同词汇，但完全可选、可替换     │
├─────────────────────────────────────────────────────┤
│  Layer 1: Core                                      │
│  IR 结构 + Pipeline 执行 + 不可变性 + 可观测性      │
│  极窄、几乎不可变更，是整个生态的底座               │
└─────────────────────────────────────────────────────┘
```

### 3.1 三层的气质与承诺

|          | Core                         | Stdlib                     | DevTools              |
|----------|------------------------------|----------------------------|-----------------------|
| 气质     | 极窄、不可变、不打补丁       | 约定、推荐、可替换         | 丰富、可玩、可视      |
| 稳定性   | 近似冻结；破坏性更新极罕见   | 谨慎迭代；允许破坏性更新   | 随意迭代              |
| 对生态意义 | 共享**底座**                | 共享**词汇**               | 共享**视角**          |
| 类比     | ISO 集装箱标准（尺寸/吊点） | Incoterms（FOB/CIF/DDP）   | 港口龙门吊调度系统    |

### 3.2 为什么需要 Stdlib

Core 如此克制，必然带来一个问题：**陌生插件之间如何协作？**

想象两个独立作者：一位写"角色变量"插件，产出人物人设的 fragment；另一位写"RAG 记忆"插件，产出检索结果的 fragment。如果 Core 不规定任何公共字段，两人会各自发明字段名——一位写 `who`，另一位写 `about`，一位写 `plugin`，另一位写 `source`。最终用户拿到这两个插件后，必须自己写适配代码才能把"同一个角色的所有东西"聚到一起。**生态立刻碎片化。**

Stdlib 的存在，就是为这种跨插件协作**提供一个公共词汇表**。它不强制任何插件采纳，但采纳了就能立刻与遵守同一份词汇的其他插件互操作。这和 HTTP status code、CSS 属性名、Incoterms 术语是同一类东西——**弱共识协议**。

### 3.3 生态里的四类用户

三层架构不是技术分层，而是对应着四种真实存在的用户关系：

- **应用作者**（消费者）。他们用 Core 搭骨架，用 Stdlib 省力气，享受 DevTools 带来的调试幸福。他们对三层都直接依赖。
- **插件作者**（生产者）。他们通常不直接写 Pipeline，而是产出 fragment。他们对 Stdlib 的依赖最重——因为 Stdlib 的 meta schema 决定了他们的插件能否与别人的插件协作。
- **领域架构师**（替代者）。他们在自己的场景（企业 Agent、特定领域工具）里，可能发现 Stdlib 的词汇不合适。他们会**跳过 Stdlib**，只用 Core，并自建自己的 meta 规范（甚至发布自己的 stdlib 变体）。Core 必须对这种用法保持友好。
- **元工具作者**（平台作者）。他们不关心业务场景，他们做 DevTools、lint、test、replay 等工具。他们对 Core 的约束（不可变、纯函数、可序列化）有刚需——这些约束是他们的元工具能成立的地基。

**Loom 的设计必须同时让这四种人觉得"我在这里是合理的"。** 这是三层架构的最终 KPI。

### 3.4 命名空间

```
loom                          Layer 1：核心（Pipeline、DataFragment、Pass 类型、快照）
@loom/stdlib                  Layer 2：推荐 meta schema + 参考 Pass（故意很小）
@loom/devtools                Layer 3：DevTools 协议与客户端（v0.2+）

@loom/template                独立 utility：最小插值
@loom/tokenizer-tiktoken      独立 utility：tokenizer 实现
@loom/tokenizer-claude        独立 utility：tokenizer 实现
```

以及**鼓励但不由 Loom 团队维护**的场景 stdlib：

```
@loom-tavern/stdlib           roleplay/tavern 场景的词汇与 Pass
@loom-agent/stdlib            通用 agent 场景的词汇与 Pass
@your-org/stdlib              任何组织可自建内部 stdlib
```

场景 stdlib 与 `@loom/stdlib` 是**平等关系**，不是父子关系。Loom 团队不试图"一统江湖"——相反，Loom 明确鼓励社区发布**竞争性的** stdlib，并在文档中列出它们。

---

## 4. 核心抽象

Loom Core 由三个一等抽象构成：`DataFragment`、`Pass`、`Pipeline`。

### 4.1 DataFragment

一个 `DataFragment` 是管线中流动的最小单位。它是一个**纯粹的结构容器**，极简到无法再简：

```ts
interface DataFragment<M = Record<string, unknown>> {
  readonly id: string
  readonly content: Content
  readonly meta: M
}

type Content = string | Promise<string> | (() => Promise<string>)
```

说明：

- **`id`**：唯一标识。由谁生成、怎么生成，Loom 不规定——可以是 UUID、内容哈希、业务主键，甚至人类可读字符串。Loom 只要求在同一次管线执行中 id 唯一。
- **`content`**：实际内容。支持三种形态：
  - `string`——已就绪的文本
  - `Promise<string>`——正在加载的文本
  - `() => Promise<string>`——延迟加载的文本（只有真正被消费时才触发）
- **`meta`**：完全开放的元数据袋。Core **不读取也不写入** meta 中的任何字段。它纯粹为 Pass 作者和用户服务——无论是 `priority`、`volatility`、`group`、`target`、`role`、`channel`、`source`，还是你发明的任何字段，都放这里。

**为什么 meta 完全开放？** 因为"什么是重要的元数据"是一个领域问题。Roleplay 场景在乎 `subject` 和 `volatility`；通用 Agent 在乎 `role` 和 `toolCallId`；代码助手在乎 `language` 和 `filePath`。Core 不裁决哪种是对的。**裁决这些的，是 Stdlib 的工作，而且是可选的。**

**类型安全怎么保证？** 通过泛型。应用在自己的代码里定义 `MyMetaSchema`，把 `DataFragment<MyMetaSchema>` 作为自己管线的类型参数，整个项目里就有完整的类型检查。Core 保持 `Record<string, unknown>` 的开放性，Stdlib 和应用层再做收窄。

### 4.2 Pass

`Pass` 是管线中的一个步骤——一个从 fragments 到 fragments 的变换。

```ts
interface Pass<M = Record<string, unknown>> {
  readonly name: string
  run(
    fragments: readonly DataFragment<M>[],
    ctx: PassContext<M>
  ): DataFragment<M>[] | Promise<DataFragment<M>[]>
}
```

设计要点：

- **输入是只读数组**。Pass 不能修改传入的 fragments 数组或里面的 fragment 对象——必须返回新的数组。
- **允许同步或异步**。同步 Pass 直接返回数组，异步 Pass 返回 Promise。引擎统一用 `await Promise.resolve(...)` 处理，对纯同步 Pass 开销接近零。
- **name 用于可观测性**。快照、错误定位、trace 日志都以 name 为标识。允许重名但不推荐。
- **`ctx` 提供执行上下文**——日志、信号（取消）、当前 pass 索引等。见 §5.3。

**Pass 的契约**：

1. **纯函数倾向**——相同输入应尽量产生相同输出。Loom 不强制，但强烈建议。
2. **不修改入参**——必须返回新数组。对 fragment 的"修改"实际上是产出一个新的、修改过的 fragment 对象。
3. **可以增删**——Pass 可以删除 fragment、新增 fragment、替换 fragment，数量不需要守恒。
4. **id 需保持稳定**——修改 fragment 时应尽量保留原 id，便于下游追踪溯源。这是约定，不是强制。

**Pass 允许异步的原因**：

强制同步会把一整类合法用例挡在门外——embedding 去重、LLM 打分、翻译、动态 RAG 扩展都需要异步能力。若强制同步，这些 Pass 作者只能在进入管线前就准备好一切，或者绕过 Loom 自己搞一套管线；任何一种都会损害生态。可重放性应由 Pass 作者自律保证，而非由引擎通过同步签名强制——一个同步 Pass 只要读了 `Date.now()` 就不可重放，同步性并不买到真正的确定性。

### 4.3 Pipeline

`Pipeline` 是一组按顺序执行的 Pass。

```ts
interface Pipeline<M = Record<string, unknown>> {
  readonly passes: readonly Pass<M>[]
  run(
    initial: readonly DataFragment<M>[],
    options?: RunOptions
  ): Promise<RunResult<M>>
}
```

Pipeline 的职责：

- 按 `passes` 顺序执行每一个 Pass
- 在每个 Pass 前后（可选）生成快照
- 统一错误处理：任何 Pass 抛错都包装为 `PipelineError`，携带"哪个 Pass、第几步、当时的 IR"
- 支持取消（通过 `AbortSignal`）
- 最终返回处理后的 fragments 和本次执行的元数据（耗时、快照列表、诊断信息）

Pipeline 本身**也是不可变的**。一旦构造完成，`passes` 不能追加或修改——需要变更时构造新的 Pipeline。这保证了同一个 Pipeline 对象的每次 `run` 语义一致。

---

## 5. 执行模型

### 5.1 执行顺序

Pipeline 严格按 `passes` 数组顺序执行。第 N 个 Pass 的输入，是第 N-1 个 Pass 的输出。第 0 个 Pass 的输入，是 `run()` 传入的 `initial` 数组。

Loom **不做并发优化**——不自动并行执行 Pass，不重排 Pass。顺序就是用户声明的顺序。

（单个 Pass 内部当然可以并发，比如 `Promise.all` 并发解析多个 fragment 的 lazy content。这是 Pass 作者的自由。）

### 5.2 Lazy Content 的解析策略

Loom 对 `content` 的三种形态**不自动解析**。`string | Promise<string> | (() => Promise<string>)` 在管线中可以一直保持为 Promise 或 thunk 状态，直到某个 Pass 主动消费它。

这意味着：

- 一个 fragment 在被丢弃之前，它的 lazy content 可能永远不会被调用——节省 IO
- "什么时候解析 content"是一个 Pass 层的决策，不是引擎层的决策
- 如果用户希望在某个时机统一解析所有 lazy content，可以编写一个 `ResolvePass` 放在该时机

Stdlib 会提供一个 `ResolvePass`——功能是把所有 lazy content 并发解析为 string。用户按需注册。

### 5.3 PassContext

每次 Pass 执行时，引擎会传入一个 `PassContext`：

```ts
interface PassContext<M> {
  readonly passIndex: number
  readonly passName: string
  readonly signal: AbortSignal
  readonly logger: Logger
  // 获取当前 Pass 之前的完整快照历史（若快照开启）
  readonly history: readonly Snapshot<M>[]
}
```

- `signal` 用于感知取消——长耗时 Pass 应周期性检查 `signal.aborted`
- `logger` 是结构化日志出口，写入的内容会进入本次 run 的 trace
- `history` 让 Pass 有能力看"之前发生过什么"——但这是一个**逃生舱口**而非推荐做法。健康的 Pass 应当只依赖当前输入。

### 5.4 快照（Snapshot）

每个 Pass 执行前后，引擎可以生成快照——一个对当前 fragments 的冻结引用（由于 IR 不可变，快照本质上就是引用保存，零额外成本）。

```ts
interface Snapshot<M> {
  readonly index: number
  readonly passName: string
  readonly phase: 'before' | 'after'
  readonly fragments: readonly DataFragment<M>[]
  readonly timestamp: number
}
```

快照是 Loom 可观测性的**物理基础**。DevTools、diff 可视化、replay、时光机式调试，都建立在快照之上。

快照可以通过 `RunOptions.snapshot` 配置开关与粒度：

- `'off'`：不生成快照（生产环境默认）
- `'boundaries'`：每个 Pass 前后都生成（开发环境默认）
- `'after-only'`：每个 Pass 后生成
- 自定义过滤器：只对匹配某些 Pass 名字的做快照

### 5.5 取消与超时

Pipeline 的 `run` 接受一个可选的 `AbortSignal`。信号触发后：

- 当前正在执行的 Pass 的 `ctx.signal.aborted` 变为 `true`
- Pass 可以选择立即抛出（推荐）或尽快返回
- 引擎将 abort 包装为 `PipelineCancelledError` 并附带"已完成到第几个 Pass"的信息

Loom 不提供内置的"Pass 级超时"——如果需要，用户在自己的 Pass 里用 `Promise.race` 自己实现。这也是 The Engine Does Less 的体现。

---

## 6. IR 语义与不可变性

### 6.1 不可变的含义

Loom 中，"不可变"的含义是：

1. **`DataFragment` 对象在其生命周期内不被修改**
2. **fragments 数组在其生命周期内不被修改**
3. **Pipeline 对象在其生命周期内不被修改**

"修改"意味着构造一个新对象。比如要把 fragment A 的 content 换成新字符串，正确做法是：

```ts
const nextA = { ...a, content: newContent } // 新对象
```

而不是：

```ts
a.content = newContent // 禁止
```

### 6.2 冻结的执行层级

运行时层面，Loom 会在关键边界调用 `Object.freeze`：

- 传入 Pass 的 fragments 数组
- 每个 fragment 对象本身（浅冻结）

这保证了"不小心写了 bug"会立刻暴露，而不是悄悄腐蚀下游状态。

注意：`meta` 的深层内容**不做深冻结**——因为它可能是任意用户数据，深冻结成本不可控。用户如果希望 meta 也被保护，在自己的 Pass 里自己处理。

### 6.3 为什么不可变至关重要

- **快照零成本**：由于不可变，快照就是"保存一个引用"，不需要深拷贝
- **并发安全**：同一个 Pipeline 可以被多个 `run` 并发调用，彼此互不干扰
- **可追溯**：任何时刻的 IR 状态都可以被精确复现，不会因为后续 Pass 修改而丢失
- **调试友好**：bug 的范围被严格限定在"某个 Pass 的输出"上，不会跨 Pass 污染
- **DevTools 成立的基础**：没有不可变，DevTools 的 diff 和时光倒流都无从谈起

---

## 7. 插值与模板

Loom 提供一个**极小**的插值能力，理由是：如果 content 里永远不能做变量替换，用户就只能在 Pass 外预先把所有变量拼好——这会让 fragment 失去"模板+数据"的分离价值。

### 7.1 最小插值语法

```
Hello, {{ name }}, today is {{ date }}.
```

规则：

- 只支持 `{{ path }}` 形式的占位符
- `path` 必须是合法的 JavaScript 标识符路径（`foo`、`foo.bar`、`foo.bar.baz`）
- **没有表达式、没有逻辑、没有函数调用、没有循环、没有条件**
- 未定义的 path 按配置处理：`'throw'`（默认）、`'empty'`（替换为空）、`'keep'`（保留原样）

### 7.2 为什么不支持 EJS/Handlebars/Liquid

任何支持表达式或逻辑的模板语言，都是一个攻击面：

- EJS 可以执行任意 JS——一旦数据源被投毒，整条管线沦陷
- Handlebars helper、Liquid filter 都需要注册机制，注册机制又带来约定问题

Loom 的立场：**模板里如果需要逻辑，那是 Pass 的工作，不是模板引擎的工作。** 你想拼接两个字段？在 Pass 里把它们拼好放进一个新的 fragment。你想条件显示？在 Pass 里按条件产出不同的 fragment。

插值只负责最朴素的一件事：**把已经准备好的数据填进已经写好的文本**。其他一切交给 Pass。

### 7.3 插值发生在哪里

插值**不是核心的一部分**，也不是 Stdlib 的一部分。它作为一个独立 utility 包 `@loom/template` 提供，供用户在自己的 Pass 里调用：

```ts
import { interpolate } from '@loom/template'

// 在某个 Pass 里
const rendered = interpolate(fragment.content as string, { name: 'Alice', date: '2025-01-01' })
```

Core 从不主动对 content 做插值。这保持了"核心零 mutation 语义"的原则。

---

## 8. 可观测性

Loom 把可观测性作为**一等目标**，而非事后附加的调试工具。理由是：复杂提示词场景中，"为什么这次 prompt 长这样"是开发者最常问、最难回答的问题。

这一节定义可观测性的**数据层**——引擎承诺产出什么数据。如何把这些数据呈现为可交互的界面，是 §12 DevTools 的职责。

### 8.1 可观测性的三个层级

**L1：运行时日志**
- 每个 Pass 的开始、结束、耗时
- Pass 内部通过 `ctx.logger` 主动输出的信息
- 错误与警告

**L2：快照与 Diff**
- 每个 Pass 前后的完整 IR 状态
- 两个快照之间的 diff（新增/删除/修改的 fragment）
- 支持时间线视图：按时序浏览整个管线

**L3：Pass 贡献归因**
- 每个最终产出 fragment 的**来源链**：它由哪个 Pass 产生、被哪些 Pass 修改、在哪些 Pass 中被保留
- 实现方式：Pass 在产出 fragment 时可以（但不强制）声明它对 fragment 的操作类型（`create` / `transform` / `keep` / `merge`），引擎基于此构建归因图

L1 和 L2 是 Core 必须提供的。L3 在 v0.2 引入。

### 8.2 RunResult

每次 `pipeline.run()` 返回一个 `RunResult`：

```ts
interface RunResult<M> {
  readonly fragments: readonly DataFragment<M>[]
  readonly snapshots: readonly Snapshot<M>[]
  readonly diagnostics: readonly Diagnostic[]
  readonly timings: readonly PassTiming[]
  readonly status: 'ok' | 'cancelled' | 'error'
  readonly error?: PipelineError
}
```

这个对象本身就是一份完整的"本次编译报告"。DevTools 只需要消费这个对象。

---

## 9. 错误模型

### 9.1 错误分类

Loom 定义三类错误：

```ts
class PipelineError extends Error {
  readonly passName: string
  readonly passIndex: number
  readonly cause: unknown // 原始错误
  readonly snapshot: readonly DataFragment<unknown>[] // 出错时的 IR
}

class PipelineCancelledError extends PipelineError {}

class PipelineValidationError extends Error {
  // 构造 Pipeline 时的错误（如 Pass 列表为空、Pass 格式非法）
}
```

### 9.2 错误处理策略

- **Pass 抛错 → 管线终止**。不 swallow，不 retry，不 fallback。
- 错误被包装为 `PipelineError`，保留原始错误为 `cause`
- 附带出错时的 IR 快照——这是"崩溃现场"，对调试至关重要
- 引擎不做自动重试。如果需要重试，在 Pass 内部自己实现

这一条又是 The Engine Does Less 的体现：重试策略强绑定业务（幂等吗？预算允许吗？），引擎不该代做决定。

### 9.3 部分成功

Loom **不支持**"部分 Pass 失败但继续跑完其他 Pass"的模式。要么完整跑完，要么在某个 Pass 失败后终止。

原因：允许部分失败会让 IR 处于未定义状态——后续 Pass 可能依赖失败 Pass 的输出。如果用户真的需要容错，正确做法是在 Pass 内部自行 try/catch 并产出"降级 fragments"，对外仍然是成功。

### 9.4 关于插件"各自抛错"的说明

LLM 应用里常见的一个痛点是"多插件协作时，谁出问题谁报错、每个插件都自己写一套错误传播"。Loom 的立场是：**Pass 抛错是第一等公民的报错渠道**。任何 Pass 内部检测到不变量被破坏（比如 id 冲突、meta 字段缺失、数据源返回非法内容）都应该直接抛。引擎会把它包装成 `PipelineError` 并附带出错时的完整 IR——这份信息足以让上层确定是哪个插件的哪个 Pass 在什么状态下出了问题。

**开发者不需要自己搭事件总线**，也不需要"每个插件都写一个报错停止"——抛异常就行，引擎负责汇总。

---

## 10. Core 不做什么

这一节比"Core 做什么"更重要。下列能力**不在 Core 中**，也不会在未来任何版本中进入 Core。每一条下会标注该能力在三层架构中的归属。

### 10.1 不做排序策略

- 不内置 volatility 排序
- 不内置优先级排序
- 不内置图约束（before/after）排序

> **归属**：Stdlib 会提供 `OrderByVolatility`、`OrderByPriority` 等参考 Pass。其他策略完全开放给生态。

### 10.2 不做聚合策略

- 不内置按 target/subject 吸附
- 不内置按 group 分组
- 不内置按语义相似度聚合

> **归属**：Stdlib 会提供 `AggregateBySubject` 参考 Pass。更复杂的聚合策略（层次聚类、图聚类）属于生态。

### 10.3 不做冲突解决

- 不内置优先级覆盖
- 不内置 source 维度（system > user > rag）
- 不内置 CSS-like cascade

> **归属**：Stdlib 会提供 `DedupById` 参考 Pass。所有语义性冲突解决（谁覆盖谁）都属于领域决策，交给生态。

### 10.4 不做预算剪枝

- 不内置 token 计数
- 不内置剪枝策略
- 不内置 summarize/truncate 降级

> **归属**：Stdlib 会提供 `BudgetByTokens` 的参考 Pass 和一个 tokenizer 接口，但不内置 tokenizer 实现——具体实现由 `@loom/tokenizer-tiktoken`、`@loom/tokenizer-claude` 这类独立包提供。summarize/truncate 降级属于生态。

### 10.5 不做文本清洗

- 不合并连续空白
- 不 normalize unicode
- 不 trim
- 不去重

> **归属**：**既不在 Core，也不在 Stdlib**。核心永远不修改 fragment 的 content 一个字符。清洗是语义决策伪装的机械操作——roleplay 要保留的语气词对 agent 是噪音，代码助手要保留的空白对通用场景是冗余。交给领域预设包或用户自己的 Pass。

### 10.6 不做数据源接入

- 不定义 provider/connector/loader 概念
- 不提供"注册 HTTP 源/数据库源"的机制
- 不内置 RAG

> **归属**：**既不在 Core，也不在 Stdlib**。Loom 的 content 只认 `string | Promise<string> | () => Promise<string>`。用户在把 fragment 交给 Loom 之前，自己把数据准备成 Promise 即可。任何"数据源接入"都是编排层的事。

### 10.7 不做最终形态

- 不产出字符串
- 不产出 messages 数组
- 不产出任何模型 SDK 特定的 schema

> **归属**：Stdlib 会提供常见的"拍扁"Pass（如 `StringifyPass`、`MessagesPass`），但它们是可选的。Loom 的输出永远是一组 fragments。Loom 不预设用户将要喂给哪个模型、要组的是 prompt 还是别的东西。

### 10.8 不做编排

- 不调用 LLM
- 不管理多轮对话状态
- 不做 agent loop
- 不做 tool use

> **归属**：**既不在 Core，也不在 Stdlib**。Loom 是编排层下面的一层。当编排层决定"现在需要构造一个 prompt"时，它调 Loom。Loom 返回结果，控制权回到编排层。

---

## 11. Stdlib

`@loom/stdlib` 是 Loom 生态的**推荐词汇表和参考实现**。它不是 Core 的一部分，也不是必须使用的——但它是让不同作者的插件之间能够协作的关键粘合剂。

### 11.1 Stdlib 的两件事

Stdlib 只做两件事：

1. **定义推荐的 meta schema**——一组字段名和它们的语义，供 fragment 生产者和 Pass 作者共同参照
2. **提供若干"明显正确"的参考 Pass**——它们读写 Stdlib 定义的 meta 字段

Stdlib **不做**：

- 不做某个领域的完整解决方案（这是场景 stdlib 的事，比如 `@loom-tavern/stdlib`）
- 不做数据源接入、清洗、编排
- 不承诺"用了 Stdlib 就能开箱即用"——它只承诺"用了 Stdlib，你写的东西能和别人用了 Stdlib 写的东西合作"

### 11.2 推荐的 meta schema（v0.1 草案）

以下字段是 Stdlib 推荐的公共词汇。**所有字段都是可选的**——fragment 可以完全不用 Stdlib 字段，或只用其中几个。

```ts
interface StdMeta {
  /** 这个 fragment 围绕的主体，用于聚合。例如人物名、文档 id、工具调用 id */
  subject?: string

  /** fragment 的类别，用于聚合内部排序和调试可读性 */
  kind?: 'persona' | 'memory' | 'state' | 'rule' | 'history' | 'tool' | string

  /** 产出源标识，用于冲突溯源和 DevTools 归因 */
  source?: string

  /** 时间稳定性：0.0 = 永久不变，1.0 = 瞬时 */
  volatility?: number

  /** 显式优先级。数字越大越重要。冲突时由 Pass 决定如何使用 */
  priority?: number

  /** 该 fragment 占用的 token 数（通常由某个 tokenizer Pass 填入） */
  tokens?: number

  /** 产出时间戳 */
  createdAt?: number
}
```

这些字段不是 API，是**约定**。没有代码层面的强制——一个 fragment 可以完全不用这些字段，或加入自己的字段。但遵守这份约定的插件，可以直接与遵守同一份约定的 Pass 搭配工作，无需适配代码。

### 11.3 参考 Pass（v0.1 故意很小）

**Loom v0.1 的 Stdlib 只包含最少、最无争议的 Pass**：

- **`DedupById`**——按 id 去重，保留最后出现的。冲突处理最朴素的基线。
- **`StdFragment` 类型**——`DataFragment<StdMeta>` 的便捷别名。

就这两项。**我们故意不发更多。**

理由是**延迟标准化**（Deferred Standardization）：

- Stdlib 一旦发布一个 Pass，它就会变成生态的引力中心——用户抄它、扩展它、围绕它写插件
- 如果首发的 Pass 不够好，我们要么背着包袱维护很多年，要么破坏性升级得罪所有人
- 正确做法是：先让社区各自实现，等事实标准浮现后再"招安"进 Stdlib

这个策略借鉴 W3C 和 ECMAScript 的做法——浏览器厂商先各自实现，规范后发。

### 11.4 v0.1 后 Stdlib 的扩展路径

以下 Pass **计划**在 v0.2+ 纳入 Stdlib，前提是社区中已有多份实现、设计趋于收敛：

- `ResolvePass`——并发解析所有 lazy content
- `OrderByVolatility`——按 volatility 排序
- `OrderByPriority`——按 priority 排序
- `AggregateBySubject`——按 subject 聚簇
- `BudgetByTokens`——基于 token 预算剪枝（需要配合 tokenizer 实现）
- `StringifyPass`——拼接为单字符串
- `MessagesPass`——转换为 OpenAI-style messages 数组

在正式纳入前，它们可能以独立包形式先发布，或者完全由社区维护。

### 11.5 Stdlib 是可竞争的

Loom 团队明确欢迎、鼓励社区发布**替代 Stdlib** 或**场景专属 Stdlib**：

- `@loom-tavern/stdlib`——面向 SillyTavern-like roleplay 场景，meta 字段可能包含 `character`、`scene`、`worldbook`、`author_note` 等
- `@loom-agent/stdlib`——面向通用 agent，字段可能是 `role`、`toolCallId`、`toolResult` 等
- `@your-org/stdlib`——企业内部规范

这些 stdlib 与 `@loom/stdlib` 是**并列关系**。Loom 团队不维护它们，但会在文档中列出社区知名实现。

### 11.6 什么时候不应该用 Stdlib

如果你在构建的系统满足以下任意一条，考虑**跳过 `@loom/stdlib`**：

- 你的领域有更精细的词汇体系（roleplay、legal、medical）——直接用对应的场景 stdlib，或自建
- 你在做企业内部工具，不需要与外部生态互操作
- 你在做 Loom 的元工具（DevTools、lint、test），根本不关心业务 meta

跳过 Stdlib 不会损失 Core 能力。Core 从不依赖 Stdlib。

---

## 12. DevTools

DevTools 是 Loom 用户最直接感知到产品力的地方。它不是事后补丁，而是三层架构中**独立的一层**。

### 12.1 DevTools 解决的问题

复杂提示词组装最典型的调试困境是：

> "为什么艾莉亚的人设被截断了？"

没有 DevTools，开发者只能加 console.log、翻日志、在源码里打断点猜。

有了 DevTools，流程变成：

1. 打开时间轴，看到 Pass 依次执行的 trace
2. 跳到某个 Pass 前后的 diff，看到"艾莉亚人设 fragment #3 被剪枝，原因：超出 8K token 预算"
3. 点进被剪掉的 fragment，看到 `meta.source: "char-var"`、`meta.priority: 20`
4. 结论："是 char-var 插件给的 priority 太低，调高就好"

**这种"几秒钟定位问题"的体验，只有在 Core 保证了 IR 不可变 + 快照完备、Stdlib 保证了 meta 有公共词汇的前提下才成立。** Core 和 Stdlib 的所有克制，最终都是为了 DevTools 这层的丰富。

### 12.2 DevTools 的范围

DevTools 包含（计划）：

- **时间线视图**：按时序浏览整个 Pipeline 的所有 Pass 和快照
- **Diff 视图**：任意两个快照之间的新增/删除/修改
- **Fragment 追溯**：选中一个最终 fragment，追溯它经历了哪些 Pass、被如何变换
- **贡献归因图**：L3 可观测性的可视化——哪个 Pass 对最终产物贡献最大
- **Pass 重放**：修改某个 Pass 的实现，重跑管线，对比新旧结果
- **导入/导出**：保存一次 run 的完整记录，带到别的环境打开调试

### 12.3 DevTools 协议

DevTools 本身不是 Core 的一部分——Core 只保证产出的 `RunResult` 数据结构是完备、可序列化、向前兼容的。DevTools 消费这份数据。

v0.2 会定义一份正式的 **DevTools 协议**，使第三方可以：

- 实现自己的 DevTools UI（浏览器扩展、桌面应用、CLI、Web dashboard）
- 把 Loom 的运行数据接入已有观测系统（OpenTelemetry、Datadog 等）
- 编写元工具（回归测试、lint、CI 对比）

协议优先，客户端其次。Loom 团队会维护一份官方客户端，但它和第三方客户端是平等的。

### 12.4 DevTools 生态的可能形态

一些可以预见、值得鼓励的 DevTools 生态产物：

- **Snapshot Regression Testing**：把一次"正确"的 Pipeline 运行快照保存，作为回归基线。每次 prompt 变更后自动对比。
- **Pass Lint**：静态检查 Pass 的代码，警告"你读了 `Date.now()`，这会损害可重放性"。
- **Token Budget Visualizer**：把"每个 fragment 占多少 token、剪枝前后对比"可视化。
- **场景化 DevTools**：面向 roleplay 的版本会理解 `@loom-tavern/stdlib` 的字段，做更贴近场景的展示。

这些都不由 Loom 团队实现——它们是生态的机会。

---

## 13. 参考类型草案

以下是 v0.1 的预期公共 API。**非最终版本**，作为讨论基础。

```ts
// ============================================================
// Core types
// ============================================================

type Content = string | Promise<string> | (() => Promise<string>)

interface DataFragment<M = Record<string, unknown>> {
  readonly id: string
  readonly content: Content
  readonly meta: M
}

interface Pass<M = Record<string, unknown>> {
  readonly name: string
  run(
    fragments: readonly DataFragment<M>[],
    ctx: PassContext<M>
  ): DataFragment<M>[] | Promise<DataFragment<M>[]>
}

interface PassContext<M> {
  readonly passIndex: number
  readonly passName: string
  readonly signal: AbortSignal
  readonly logger: Logger
  readonly history: readonly Snapshot<M>[]
}

interface Logger {
  debug(msg: string, data?: unknown): void
  info(msg: string, data?: unknown): void
  warn(msg: string, data?: unknown): void
  error(msg: string, data?: unknown): void
}

// ============================================================
// Pipeline
// ============================================================

interface Pipeline<M = Record<string, unknown>> {
  readonly passes: readonly Pass<M>[]
  run(
    initial: readonly DataFragment<M>[],
    options?: RunOptions
  ): Promise<RunResult<M>>
}

interface RunOptions {
  readonly signal?: AbortSignal
  readonly snapshot?: SnapshotMode
  readonly logger?: Logger
}

type SnapshotMode =
  | 'off'
  | 'boundaries'
  | 'after-only'
  | ((passName: string, passIndex: number) => boolean)

interface RunResult<M> {
  readonly fragments: readonly DataFragment<M>[]
  readonly snapshots: readonly Snapshot<M>[]
  readonly diagnostics: readonly Diagnostic[]
  readonly timings: readonly PassTiming[]
  readonly status: 'ok' | 'cancelled' | 'error'
  readonly error?: PipelineError
}

interface Snapshot<M> {
  readonly index: number
  readonly passName: string
  readonly phase: 'before' | 'after'
  readonly fragments: readonly DataFragment<M>[]
  readonly timestamp: number
}

interface PassTiming {
  readonly passName: string
  readonly passIndex: number
  readonly durationMs: number
}

interface Diagnostic {
  readonly level: 'debug' | 'info' | 'warn' | 'error'
  readonly passName: string
  readonly passIndex: number
  readonly message: string
  readonly data?: unknown
  readonly timestamp: number
}

// ============================================================
// Errors
// ============================================================

declare class PipelineError extends Error {
  readonly passName: string
  readonly passIndex: number
  readonly cause: unknown
  readonly snapshot: readonly DataFragment<unknown>[]
}

declare class PipelineCancelledError extends PipelineError {}
declare class PipelineValidationError extends Error {}

// ============================================================
// Constructors
// ============================================================

declare function createPipeline<M = Record<string, unknown>>(
  passes: readonly Pass<M>[]
): Pipeline<M>

declare function createPass<M = Record<string, unknown>>(config: {
  name: string
  run: Pass<M>['run']
}): Pass<M>
```

**Stdlib（`@loom/stdlib`）公共 API 草案**：

```ts
// @loom/stdlib

/** Stdlib 推荐的 meta schema。所有字段可选。 */
export interface StdMeta {
  subject?: string
  kind?: string
  source?: string
  volatility?: number
  priority?: number
  tokens?: number
  createdAt?: number
}

/** DataFragment 的 Stdlib 便捷别名 */
export type StdFragment = DataFragment<StdMeta>

/** 按 id 去重，保留最后出现的 */
export declare const DedupById: Pass<StdMeta>
```

---

## 14. 与相邻系统的关系

### 14.1 与 LangChain / LlamaIndex

它们是编排层；Loom 是组装层。它们决定"下一步做什么"，Loom 决定"要发送的这一条 prompt 长什么样"。两者在同一个应用里可以共存——LangChain 的 `PromptTemplate` 概念可以被 Loom Pipeline 取代，但 `Chain`、`Agent`、`Tool` 这些编排抽象 Loom 不涉及。

### 14.2 与 AI SDK / Vercel AI SDK

AI SDK 是模型 SDK 层——负责与具体模型 API 通信、处理 streaming、tool calling 等。Loom 更底层——产出喂给 AI SDK 的数据。典型用法是：用 Loom 构造好最终的 messages 数组（通过某个 `MessagesPass`），传给 AI SDK 的 `streamText`。

### 14.3 与模板引擎（Handlebars / EJS / Liquid）

Loom 不是模板引擎的替代品。`@loom/template` 的插值能力极简，不支持逻辑。如果用户真的需要完整模板能力，完全可以在某个 Pass 里集成任何模板引擎——把 fragment.content 喂给 Handlebars 渲染后，产出新的 fragment。**Core 只保证不阻挡这种集成，不自带任何一种。**

### 14.4 与 RAG 向量库

Loom 不对接任何向量库。用户的流程应当是：

1. 应用层做检索（向量库、关键字、混合）
2. 检索结果作为 fragments 传入 Loom
3. Loom 的 Pass 负责处理这些 fragments（排序、去重、剪枝）

如果检索本身需要发生在管线中（比如"根据前序 Pass 结果动态触发检索"），用户可以写一个 RAG Pass，在 Pass 内部调用向量库，产出新的 fragments。这完全是应用自由，Loom 不提供也不阻止。

### 14.5 与 SillyTavern / tavern 类 roleplay 应用

Loom 的设计明确考虑了 tavern 类 roleplay 场景——复杂人设、世界书、作者笔记、对话历史、RAG 记忆的组合是 Loom 最典型的用例之一。

但 Loom 不会把 tavern 语义写进 Core 或 `@loom/stdlib`。相反，roleplay 场景的词汇与 Pass 将由 `@loom-tavern/stdlib` 这样的社区包承载。这个场景 stdlib 是 Loom 团队**明确鼓励、但不维护**的类型，由最了解该领域的社区成员（或基于 Loom 构建的 roleplay 应用团队）维护。

---

## 15. 开放问题

以下问题部分已在设计讨论中决议，保留在这里以记录决策路径。

### 15.1 id 冲突怎么办？ [已决议]

**决议**：运行时抛错。

理由：严格比宽松容易放开，反之则难。另外这与 LLM 应用的实际情况一致——上游出问题就由上游报错停止，比悄悄覆盖造成静默数据损坏要好得多。开发者也不需要自己搭事件总线（见 §9.4）。

### 15.2 meta 的深度规则 [已决议]

**决议**：不做深度校验，允许任意值。

理由：meta 的实际使用中会混入各种用户数据和插件数据，深度校验带来的开发体验问题远大于它的收益。快照只做引用保存，diff 策略交给 DevTools 层或用户工具决定。用户如果需要 JSON 可序列化保证，在自己的 Pass 里做一次 `JSON.parse(JSON.stringify(meta))` 即可。

### 15.3 Pipeline 组合

**是否允许 Pipeline 嵌套**（一个 Pipeline 作为另一个 Pipeline 的一个 Pass）？

技术上容易实现，语义上需要明确：子 Pipeline 的快照怎么展示？错误怎么包装？

**当前决议**：v0.1 不支持。v0.2+ 视社区需求决定。

### 15.4 同一 Pipeline 的并发调用

由于 Pipeline 不可变，理论上同一实例可以被多个 `run` 并发调用。但如果用户的 Pass 实现里偷偷用了模块级可变状态，这会引起竞态。

**当前决议**：文档层面明确"Pipeline 是可并发的，但 Pass 作者负责保证自己的 Pass 无可变状态"。引擎不强制。

### 15.5 TypeScript 泛型的传播 [已决议]

**决议**：强制同一 `M`。

`Pipeline<M>` 要求所有 Pass 使用相同的 meta 类型。如果某个 Pass 想要更宽的类型，用户可以用 `Pipeline<MetaUnion>` 取并集。更复杂的逃生舱口（声明式的"要求 meta 至少包含 X 字段"）暂不在 v0.1 考虑——它会让类型推导复杂度大幅上升，收益不匹配。

---

## 16. 路线图

**v0.1（MVP）**
- [x] 三层架构与设计原则确立
- [ ] Core 类型定义
- [ ] Pipeline runtime 实现
- [ ] 快照与 diagnostics
- [ ] `@loom/template` 最小插值 utility
- [ ] `@loom/stdlib` 首发：`StdMeta`、`StdFragment`、`DedupById`
- [ ] 单元测试与集成测试
- [ ] README 与 Quick Start

**v0.2**
- [ ] DevTools 协议 v1
- [ ] 官方 DevTools 客户端（浏览器扩展或 standalone）
- [ ] 贡献归因（L3 可观测性）
- [ ] Stdlib 扩展：`ResolvePass`、`OrderByVolatility`、`OrderByPriority`、`AggregateBySubject`
- [ ] `@loom/tokenizer-tiktoken`、`@loom/tokenizer-claude`
- [ ] `BudgetByTokens`（依赖 tokenizer）
- [ ] `StringifyPass`、`MessagesPass`

**v0.3**
- [ ] 鼓励/协助社区发布 `@loom-tavern/stdlib`（由 Loom 作者的 AIRP 应用驱动）
- [ ] 与 AI SDK、LangChain 的 adapter 示例（文档级，不是代码依赖）
- [ ] 性能基准与优化
- [ ] Pipeline 组合（如果社区有需求）

**v1.0**
- [ ] Core API 稳定性承诺
- [ ] DevTools 协议稳定性承诺
- [ ] 完整的生态公约文档
- [ ] 迁移指南（从 LangChain 的 PromptTemplate 迁移）

---

## 附录 A：一个完整的使用示例（伪代码）

以下示例展示一个 roleplay 场景中 Loom 的典型使用。**示例中每一个 Pass 的归属标注了它来自哪一层**，便于理解三层架构的实际分工。

```ts
import { createPipeline, DataFragment } from 'loom'                    // Core
import { StdMeta, DedupById } from '@loom/stdlib'                      // Stdlib (v0.1)
import { ResolvePass, OrderByVolatility,                               // Stdlib (v0.2+)
         AggregateBySubject, BudgetByTokens,
         StringifyPass } from '@loom/stdlib'
import { tiktokenCounter } from '@loom/tokenizer-tiktoken'             // 独立 utility

// 1. 定义自己的 meta schema——在 StdMeta 基础上扩展
interface MyMeta extends StdMeta {
  // 场景特有字段（未来可能属于 @loom-tavern/stdlib）
  character?: string
  scene?: string
}

// 2. 准备 fragments（从应用层收集而来）
const fragments: DataFragment<MyMeta>[] = [
  {
    id: 'system-rule-1',
    content: '你是一个角色扮演 AI...',
    meta: { volatility: 0.0, priority: 100, source: 'system', kind: 'rule' }
  },
  {
    id: 'persona-alice',
    content: () => loadPersonaFromDB('alice'), // lazy
    meta: {
      volatility: 0.2, priority: 50, source: 'char-var',
      subject: 'alice', kind: 'persona', character: 'alice'
    }
  },
  {
    id: 'memory-alice-42',
    content: fetchRAGAsync('query'), // Promise
    meta: {
      volatility: 0.7, priority: 30, source: 'rag-memory',
      subject: 'alice', kind: 'memory', character: 'alice'
    }
  },
  // ... more fragments
]

// 3. 构造 Pipeline
const pipeline = createPipeline<MyMeta>([
  ResolvePass,                              // 解析所有 lazy/promise content
  DedupById,                                // 去重（Stdlib v0.1）
  AggregateBySubject,                       // 按 subject 聚合相关 fragment
  OrderByVolatility({ direction: 'asc' }),  // 按 volatility 升序
  BudgetByTokens({                          // 预算剪枝
    maxTokens: 4000,
    counter: tiktokenCounter('gpt-4'),
  }),
  StringifyPass({ separator: '\n\n' }),     // 拍扁为单个 fragment
])

// 4. 执行
const result = await pipeline.run(fragments, {
  snapshot: 'boundaries',
})

// 5. 取出最终产物
const finalPrompt = result.fragments[0].content as string

// 6. 想要调试？把 result 喂给 DevTools
// devtools.load(result)
```

注意：

- **Core 的代码在这个示例中只出现一行**（`createPipeline`）——这是 Core 应有的身位。
- **Stdlib 提供了共同词汇**（`StdMeta` 被 `MyMeta` 扩展）和大部分现成 Pass——这是 Stdlib 应有的身位。
- **用户的自由度完全不受损**：`MyMeta` 可以加任意字段；`StringifyPass` 可以被替换为 `MessagesPass` 或自定义的任何 Pass；任何一个 Stdlib Pass 都可以被自己的版本替代。
- **陌生插件之间自动协作**：`char-var` 插件和 `rag-memory` 插件互不相识，但因为都使用了 Stdlib 的 `subject` 字段，`AggregateBySubject` 能把"艾莉亚的所有东西"自动聚到一起。

这就是 Loom 的使用形态：**Core 是织机，Stdlib 是通用词汇表，DevTools 是观察织造过程的窗口。图案由你画，丝线由你备，而每一次织出来的结果都和你声明的一模一样，且清清楚楚能被看见。**

---

*本白皮书为设计阶段文档，在 v0.1 冻结前可能会有修订。所有修订保留在 git 历史中。*
