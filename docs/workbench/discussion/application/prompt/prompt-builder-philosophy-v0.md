# Prompt Builder 设计哲学 v0

> **状态**：Open Design / Discussion Capture  
> **主题**：Structure、Composition、Source 与 Capability 的边界收束。

---

## 1. 核心结论

Prompt Builder 不应该把“提示词结构”和“内容编排”合并成同一个模型。

更稳的分层是：

```text
Structure:
  由 Preset / Composition Skeleton 提供。
  负责 prompt 的空间结构、挂载点、约束和输出形状。

Source:
  由 Card、Setting Layer、Memory、Plugin、Runtime、Preset Asset 等提供。
  负责产出内容。

Capability:
  挂在 Source 或 Source contribution 上。
  负责声明如何激活、投影、排序、冲突处理和生命周期。
  这里的 Capability 是 Application composition component，
  不是 Kernel Capability Broker 的权限 capability。

Composition:
  Prompt Builder 横向能力。
  根据当前 Source Set + Skeleton + Capability 编译出 compiled prompt payload。
```

一句话：

```text
Structure 负责接，Source 负责产出，Capability 负责编排。
Everything is a Source, Composition is a Capability.
```

### 1.1 2026-06-20 补充：Activation 是通用控制能力

围绕 Agent Runtime 的提示词开关讨论已收束为更通用的 PromptBuild 控制问题。

核心判断：

```text
Activation 不是 Agent 专属能力。
Activation 是 Prompt Builder 中决定 prompt-facing 原子
在本次 composition 是否 active 的通用控制阶段。
```

Agent mode / step、Setting Layer 变量、关键词命中、向量检索命中、用户手动 pin、插件事件，本质上都只是 Activation Engine 的输入事实或信号。

因此：

```text
Agent Runtime:
  可以提供 facts，例如 agent.mode = write / finalize。
  不拥有独立 prompt 开关系统。

Setting Layer / State Store:
  可以提供 facts，例如 alice.affection = 85、location = black_tower。

Keyword / Retrieval:
  可以提供 signals，例如 keyword.hit 或 vector.match。

Prompt Builder:
  统一求值 activation condition，产出 active / inactive / reason。
```

Prompt Builder 不应把每轮求值结果写回 Source 配置。`enabled` 是作者配置，`active` 是本次 build 的求值结果。

### 1.2 2026-06-22 补充：Activation 的外部经验映射

这类需求不是 Loom Studio 独有。其他领域已经反复处理过“输入变量变化后，哪些输出应被激活”的问题。当前可借鉴但不直接照搬的经验如下：

```text
Feature Flags:
  区分静态配置、运行时判定、规则寿命和治理责任。
  对应到 PromptBuild：enabled 是配置，active 是本次求值结果。

Rule Engine:
  使用 facts -> rules -> agenda / result 的模型。
  对应到 PromptBuild：facts / signals 进入 Activation Engine，
  产出 active candidates 和 Activation Report。

Reactive / Dataflow:
  把变量变化视为事件流，但计算时需要稳定快照。
  对应到 PromptBuild：build 前收集 facts / signals snapshot，
  build 中不让 facts 边变边求值。

PLC / Control Scan Cycle:
  读输入 -> 执行逻辑 -> 更新输出。
  对应到 PromptBuild：
    collect facts / signals
    evaluate activation
    emit active set / report
    compose prompt
```

这些经验收束成 PromptBuild Activation 的平台原则：

```text
1. Snapshot first
   每次 PromptBuild 先冻结 facts / signals 快照。

2. Evaluate, do not mutate
   Activation 只产生 active set，不修改 enabled、source tree 或 skeleton 配置。

3. Separate activation from resolution
   Activation 只回答“谁参与本次 composition”。
   互斥、覆盖、merge、select-one 属于 Resolution。

4. Trace everything
   每个 active / inactive 都必须能解释 fact、signal、rule、manual override 和来源。

5. Classify rules
   keyword、vector、runtime fact、state fact、permission、manual pin、experiment 等
   不应混成不可治理的一类。

6. UI low-code, model declarative
   用户可以通过配置面板编辑条件；
   底层保存声明式 rule，而不是保存 UI 操作过程或任意脚本。
```

因此，Activation Engine 更像 PromptBuild 专用的轻量规则求值器 / 控制扫描周期，而不是 Agent Runtime 的附属系统，也不是通用工作流引擎。

---

## 2. 为什么 Structure 与 Composition 必须分离

传统酒馆生态中，提示词系统常同时承担两类职责：

```text
提示词结构:
  System -> World Info -> Chat History -> User Input

内容编排:
  何时触发、插入哪里、如何排序、是否启用。
```

如果让内容直接依赖具体结构，例如：

```text
character.position = before_chat
memory.position = lower_context
```

短期看起来方便，长期会产生耦合：

- 角色卡开始依赖具体预设；
- 插件开始依赖具体预设；
- 世界书开始依赖具体预设；
- 换一个 Skeleton 或 Provider，内容贡献就可能失效。

这两个问题的变化速度也完全不同：

```text
Structure:
  变化慢。一个成熟 preset / skeleton 可能很久不变。

Composition:
  变化快。每天都可能新增插件、Memory、Agent、规则和临时上下文。
```

因此 Preset / Skeleton 不能成为所有内容的中心节点。

---

## 3. Preset 的职责边界

Preset 是用户术语；backend canonical 仍倾向 `CompositionSkeleton`。

Preset / Skeleton 应只负责：

- 提供 Zone Tree；
- 提供 Injection Group；
- 提供挂载点和 fallback；
- 提供结构约束；
- 提供 render / provider compatibility hint；
- 提供排序策略的默认规则。

Preset / Skeleton 不应该知道：

- Character；
- Worldbook；
- Plugin；
- Memory；
- Agent；
- Setting Layer entry 的内部路径；
- Runtime loop 的内部结构。

这类似 HTML：

```text
HTML 定义 header / main / footer。
它不关心广告、评论、数据来自哪里。
```

对应到 Prompt Builder：

```text
Composition Skeleton 定义 StablePrefix / Narrative / CurrentTurn / FreshTail。
它不关心这里最终放的是 Card、Setting Layer、Memory 还是 Plugin。
```

---

## 4. Zone 只解决空间问题

Zone 的职责很单纯：

```text
Zone 解决“放哪里”。
```

例如：

- `stable-prefix`
- `narrative-context`
- `lower-context`
- `current-turn`
- `fresh-tail`
- custom zone

Zone 不解决：

- 覆盖；
- 互斥；
- 选择；
- 冲突处理；
- 生命周期；
- 多 source 之间的胜出策略。

这些属于 Composition Capability 或后续 Resolution Layer。

---

## 5. Injection Group 让内容不依赖结构

内容不应直接依赖：

```text
System Message #2
Lower Context 第三个 slot
当前 preset 的第 N 个 prompt item
```

内容应依赖语义化挂载协议：

```text
assistant.persona
style.prose
style.dialogue
memory.active
cot.rules
anti.pattern
```

编译时再由 Skeleton 把这些 Injection Group 解析到 Zone / Anchor：

```text
Source
  -> Injection Group
  -> Zone / Anchor
  -> Provider-facing payload
```

这样结构作者和内容作者解耦：

- Source 作者只知道自己贡献的是 `cot.rules`；
- Skeleton 作者决定 `cot.rules` 挂到哪里；
- Provider Adapter 决定最终如何映射到具体请求。

---

## 6. Semantic Slot 与 Resolution Layer

仅靠排序最终会失控。

如果系统没有语义，所有问题都会退化成：

```text
before / after / priority / depth / z-index
```

排序只应该负责顺序，不应该承担冲突处理、覆盖、互斥和选择。

因此需要把两个概念从排序里拆出来：

### 6.1 Semantic Slot

Semantic Slot 描述内容职责，而不是位置。

例如：

```text
style.prose
style.dialogue
assistant.persona
cot.scene
cot.rules
cot.state
anti.pattern
```

它回答：

```text
这段内容是干什么的？
```

而 Zone 回答：

```text
这段内容放在哪里？
```

### 6.2 Resolution Layer

当多个 Source 同时贡献同一个 Semantic Slot，需要独立的冲突处理层。

候选策略：

```text
single:
  只能存在一个，例如 assistant.persona。

merge:
  全部保留并合并，例如 anti.pattern。

append:
  按顺序组合，例如 cot.scene。

replace:
  后者覆盖前者。

select-one:
  由规则、用户或 runtime 自动选择一个。
```

这样系统不再依赖 `priority = 99999` 解决所有问题。

---

## 7. Prompt Asset 不应是一整段祖传 Prompt

传统预设常把一个大能力写成整段 prompt，例如一大段 COT。

问题是其他 Source 很难替换其中某一小段，只能：

- 排在下面；
- 提高优先级；
- 祈祷模型注意到。

更稳的方向是组件化：

```text
cot.scene
cot.character
cot.rules
cot.state
cot.plan
```

Preset 可以贡献 `cot.scene` / `cot.plan`；
Character 可以贡献 `cot.rules` / `cot.state`；
Plugin 可以贡献 `cot.inventory` / `cot.quest`。

它们共同参与 Resolution，再被投影到 Skeleton 的挂载点。

---

## 8. Composition 是横向能力

Composition 不属于某一个系统。

需要编排的不止世界书：

- Preset 自己内部需要编排；
- Setting Layer 需要编排；
- Character 需要编排；
- Plugin 需要编排；
- Memory / Search Result / Active Read 需要编排；
- Runtime transcript projection 也需要编排。

因此 Composition 更像 ECS 中的 Capability，而不是某个基类。

不同 Source 可以有完全不同的数据结构：

```text
Character:
  CharacterCard

Plugin:
  Quest / CombatRule / ToolResult

Memory:
  SearchResult / Summary

Preset:
  PromptAsset / SkeletonPatch
```

系统不要求它们继承同一个父类。

系统只要求：

```text
如果你想参与 Prompt，就提供对应 Capability。
```

---

## 9. Capability 分层候选

Prompt-facing Source 可以挂载以下能力。

这些是 Application convention，不进入 `@loom/core` schema。

```ts
type PromptCompositionCapability = {
  projection?: ProjectionCapability
  activation?: ActivationCapability
  resolution?: ResolutionCapability
  lifecycle?: LifecycleCapability
  render?: RenderCapability
}
```

### 9.1 Projection Capability

决定贡献投影到哪里。

```ts
type ProjectionCapability = {
  injectionGroupKey: string
  semanticSlotKey?: string
  sourceSlotKey?: string
  joinSlotKey?: string
  slotOrderHint?: number
  entryOrderHint?: number
}
```

### 9.2 Activation Capability

决定某个 prompt-facing 原子何时在本次 build 中 active。

Activation 不等于配置开关。配置层可以有 `enabled`，表示作者是否允许该条目参与；Activation Engine 产出的 `active` 表示当前 facts / signals 下是否实际参与本次 composition。

候选分层：

```ts
type ActivationCapability = {
  enabled?: boolean
  defaultActive?: boolean
  conditions?: ActivationCondition[]
  triggers?: ActivationTrigger[]
  lifecycle?: LifecycleCapability
}
```

候选条件语言先保持克制，不引入任意 JS：

```ts
type ActivationCondition =
  | { fact: string; equals: unknown }
  | { fact: string; notEquals: unknown }
  | { fact: string; gt: number }
  | { fact: string; gte: number }
  | { fact: string; lt: number }
  | { fact: string; lte: number }
  | { fact: string; includes: unknown }
  | { allOf: ActivationCondition[] }
  | { anyOf: ActivationCondition[] }
  | { not: ActivationCondition }

type ActivationTrigger =
  | { kind: 'always' }
  | { kind: 'manual' }
  | { kind: 'keyword'; keywords: string[]; caseSensitive?: boolean }
  | { kind: 'vector'; queryRef?: string; minScore: number }
  | { kind: 'runtime-signal'; signal: string }
  | { kind: 'rule'; ruleId: string }
```

示例：

```text
agent.mode == finalize
  -> active final prose zone

state.alice.affection >= 80
  -> active intimacy setting entry

keyword.hit("黑塔")
  -> active 黑塔 lore entry

vector.match score >= 0.75
  -> active retrieved memory item
```

这些机制共享同一个 Activation Report，而不是各自发明一套开关系统。

### 9.3 Resolution Capability

决定多个 contribution 如何共存。

```ts
type ResolutionCapability = {
  semanticSlotKey: string
  policy: 'single' | 'merge' | 'append' | 'replace' | 'select-one'
  priorityHint?: number
}
```

### 9.4 Lifecycle Capability

决定投影生命周期。

```ts
type LifecycleCapability = {
  scope: 'turn' | 'session' | 'branch' | 'project'
  ttlTurns?: number
  pinned?: boolean
  staleWhen?: string[]
}
```

### 9.5 Render Capability

决定输出提示，而不是直接绑定 provider。

```ts
type RenderCapability = {
  wrapper?: 'section' | 'message' | 'inline'
  roleHint?: 'system' | 'user' | 'assistant'
  label?: string
}
```

---

## 10. 与 Loom Core 的边界

这个设计不改变 Loom Core 契约。

Loom Core 仍然只理解：

```text
Fragment[] + Pass[] -> Fragment[] + Trace
```

Core 不理解：

- Preset；
- Zone；
- Injection Group；
- Semantic Slot；
- Setting Layer；
- Provider role；
- Resolution policy。

这些都属于 Studio Application Prompt Builder。

可行形态是：

```text
Application Documents / Runtime Sources
  -> Source Adapters
  -> Prompt Contribution[]
  -> Application Pass: Collect Facts / Signals
  -> Application Pass: Activation
  -> Application Pass: Projection
  -> Application Pass: Resolution
  -> Application Pass: Dynamic Slot Materialization
  -> Application Pass: Ordering
  -> Application Pass: Fill Skeleton
  -> Compiled Prompt Payload
  -> Provider Adapter
```

这些 pass 可以运行在 `@loom/core` pipeline 内，但语义属于 Application Layer。

---

## 11. 当前实现偏差

当前 M0 / M1 实现能验证基本链路，但有几个偏差需要及时收束。

### 11.1 `ProjectionOrderProfile.skeletonPatch` 混合了结构补丁和排序覆盖

`ProjectionOrderProfile` 本质应是排序覆盖层。

现在把 `skeletonPatch` 放进去，短期方便“Preset 注册 zone”，但概念上会让排序 profile 承担结构扩展职责。

更稳的拆分：

```text
CompositionSkeleton:
  基础结构。

CompositionSkeletonPatch:
  Preset / Extension / Project 对结构的声明式补丁。

ProjectionOrderProfile:
  用户或局部 scope 对动态 slot 顺序的覆盖。
```

### 11.2 Source 数据被迫直接理解 `PromptFragment.projection`

当前 demo 和 runtime 里，许多 entry 直接携带：

```text
zone / group / slotKey / slotOrder / entryOrder
```

这会让 Setting Layer entry、Preset entry、Plugin contribution 都依赖 Prompt Builder 的内部投影字段。

更稳的方向：

```text
Source 原始数据:
  保持自己的领域结构。

PromptCompositionCapability:
  作为可挂载组件或 adapter 输出。

PromptFragment / CompositionFragment:
  是 Source Adapter 之后的中间产物。
```

### 11.3 Setting Layer entry 不应逐条成为 top-level slot

Setting Layer 选中某个 zone 后，应作为一个 source-scoped dynamic slot 注入：

```text
from Loom City
  - 雨线车站
  - 档案管理员
  - 镜市
```

而不是每个 entry 都伪装成一个独立 slot。

entry 的拖拽主要影响该 source slot 内部顺序；
slot 的拖拽影响该 source 在目标 injection group 内的宏观顺序。

### 11.4 排序不能继续承担冲突处理

当前排序已经能解决“谁在前谁在后”，但还没有表达：

- 同一个 Semantic Slot 是否允许多个贡献；
- 多个 persona / style / rule 是否互斥；
- 谁覆盖谁；
- 哪些贡献应该 merge。

这些不应继续塞进 rankKey 或 orderHint。

### 11.5 Zone 的 `providerRoleHint` 只能是 hint

Zone 可以提供 role-like hint，但不能让 Source 或 Setting Layer 理解 provider role。

最终 role / message / content parts 映射属于：

```text
Fill Skeleton / Emit Compiled Payload / Provider Adapter
```

---

## 12. 建议的下一步设计

### M1.1：概念拆分，不大改运行时

先把类型和文档口径收束：

- 保留当前 `PromptFragment` 编译链；
- 新增 `PromptContribution` 或 `PromptCompositionCapability` 草案；
- 文档中明确 `PromptFragment.projection` 是 adapter 产物，不是 Source canonical schema；
- 将 `skeletonPatch` 标记为临时接线，后续迁出 `ProjectionOrderProfile`。

### M1.2：Preset 注册 Zone 正式化

将 Preset 的结构能力拆成：

```text
Preset / Skeleton document:
  zones
  injectionGroups
  fallback policy

Preset prompt assets:
  content contributions
  projection capability
  semantic slot capability
```

也就是说：

```text
Preset 可以注册 zone。
Preset 也可以贡献内容。
但这两个能力不要塞进同一个排序节点。
```

### M1.3：Setting Layer 通过 Adapter 产出 Source Slot

Setting Layer 不直接保存最终 slot。

候选流程：

```text
Setting Layer tree
  -> activation
  -> selected entries
  -> setting-layer source adapter
  -> one or more source-scoped dynamic slots
  -> Prompt Builder projection
```

UI 上保持：

```text
from Loom City
  - 雨线车站
  - 档案管理员
  - 镜市
```

### M1.4：引入 Semantic Slot 与 Resolution 的最小草案

不要一次做全。

先支持最小字段：

```text
semanticSlotKey?: string
resolutionPolicy?: append | merge | replace | single
```

默认策略：

```text
没有 semanticSlotKey:
  走当前排序与拼接。

有 semanticSlotKey:
  进入 Resolution Pass。
```

### M1.5：Trace / UI 解释模型

Prompt Preview 需要能解释四层：

```text
Source:
  内容来自哪里。

Activation:
  为什么进入当前 prompt。

Projection:
  为什么挂到这个 Injection Group / Zone。

Resolution + Order:
  为什么保留、合并、覆盖，以及为什么排在这里。
```

---

## 13. 暂不做的事

当前不建议立刻做：

- 把 Resolution Layer 做成完整规则引擎；
- 让 Core 理解 Composition Capability；
- 让 Preset 直接绑定 Model Profile 或 Provider 参数；
- 让 Setting Layer entry 保存 provider role；
- 给所有 Prompt Asset 一次性组件化；
- 把所有排序字段迁移到 LexoRank。

先让边界正确，再逐步增加能力。
