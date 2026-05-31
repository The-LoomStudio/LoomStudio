# 场景驱动设计 v0

> **状态**：Open Design Method
> **目的**：为 Studio Application 设计提供一套可复用的场景模拟方法，避免过早 schema-first。

---

## 1. 为什么需要场景驱动

Studio Application 不是普通业务表单系统，而是一个面向 AIRP 内容、预设、插件、provider adapter 和运行时体验的开发平台。

如果只从数据结构出发，很容易得到看似完整但无法使用的模型。例如：

- 预设层过早变成 OpenAI-style `messages[]`；
- Setting Layer 被拆成过多硬编码类；
- 插件作者不知道自己应该写 Document、Fragment、Pass 还是 Runtime hook；
- Provider Adapter 被迫理解 Card / Chat / Opening 等上层领域；
- 简单卡作者为了写一张卡被迫理解复杂 pipeline。

场景驱动的目的不是替代规格，而是在规格之前过滤错误抽象。

---

## 2. 场景模板

每个关键场景用同一套模板记录。

```text
Scenario:
  场景名称

Actor:
  谁在使用 Studio 或扩展 Studio

Goal:
  他想完成什么

Input:
  他手上已有的数据、文件、插件或 provider

Expected Flow:
  他理想中怎么完成

Studio Support:
  Studio 明确提供了哪些帮助

Studio Friction:
  Studio 制造了哪些阻碍或认知负担

Required Concepts:
  这个场景真正需要哪些领域概念

Unnecessary Concepts:
  这个场景暂时不应该要求用户理解什么

Trace / Diagnostics:
  出问题时应该如何解释

Design Implication:
  对文档、模型、RPC、插件接口或实现的影响
```

---

## 3. 第一批模拟场景

### 3.1 预设作者：写 OpenAI 风格预设

Actor:

```text
预设作者
```

Goal:

```text
声明一个类似 SillyTavern preset 的 composition skeleton，
让角色设定、世界信息、用户人格、聊天历史和扩展提示词填进固定位置。
```

需要观察：

- Skeleton 是否能表达 slot / marker / order；
- slot 是否能声明填充策略；
- role-like 设计是否只是 provider hint，而不是 provider payload；
- OpenAI-style skeleton 在 Anthropic / Gemini 下是否有 compatibility diagnostics；
- 预设作者是否需要理解 Provider Adapter 细节。

设计影响：

```text
Composition Skeleton 应该吸收 ST 的 skeleton-and-slot 洞察。
但 Skeleton 不应直接等同于最终 provider messages[]。
```

### 3.2 预设作者：写 provider-specific 预设

Actor:

```text
高级预设作者
```

Goal:

```text
专门为 Anthropic、Gemini 或某个 OpenAI-compatible provider 写预设。
```

需要观察：

- Skeleton 是否能声明 target provider family；
- Studio 是否能在 provider 不匹配时提示风险；
- provider-specific 能力是否通过 capabilities 表达；
- 是否允许 fallback、warn、error 三种策略。

设计影响：

```text
默认应支持 provider-neutral skeleton。
但高级作者应能声明 provider-specific skeleton。
```

### 3.3 简单卡作者：写一张单角色卡

Actor:

```text
简单卡作者
```

Goal:

```text
写角色设定、开场和少量行为规则，然后直接游玩。
```

需要观察：

- 作者是否可以不理解 Skeleton 细节；
- Card metadata 是否保持展示用途，不混入 prompt；
- prompt-facing 内容是否进入 Setting Layer / Opening；
- 默认 Skeleton 是否足够可用；
- preview 是否能解释最终 prompt 包含了什么。

设计影响：

```text
简单 Card 创建流程必须有默认 Composition Skeleton。
Setting Layer 和 Opening 是 prompt-facing 内容的主要入口。
```

### 3.4 复杂卡作者：写多角色 / 世界模拟卡

Actor:

```text
复杂卡作者
```

Goal:

```text
写一个多角色剧场、世界模拟或互动小说，不被 Character Card 三件套限制。
```

需要观察：

- Setting Layer 是否支持嵌套、索引和投影；
- 是否避免过早硬编码 Actor / Speaker / CharacterProfile；
- Opening 是否能表达预制剧情，而不是特殊第一条 Chat message；
- Skeleton 是否能控制多类内容的输出位置。

设计影响：

```text
Card 不等于 Character。
Setting Layer 要提供能力，而不是用硬编码类层级限制创作空间。
```

### 3.5 插件作者：写 prompt 增强插件

Actor:

```text
插件作者
```

Goal:

```text
根据当前 Session / Card / Chat 追加检索结果、风格约束或临时上下文。
```

需要观察：

- 插件贡献的是 Document、Fragment、Pass，还是 Composition Source；
- 插件是否能声明目标 slot；
- 插件是否能被 Trace 解释；
- 插件是否需要理解 provider payload；
- 插件输出是否能被权限和 audit 追踪。

设计影响：

```text
插件应尽量贡献 composition source 或 fragment convention，
不应直接拼 provider request body。
```

### 3.6 Provider Adapter 作者：适配新模型 API

Actor:

```text
Provider Adapter 作者
```

Goal:

```text
把 Studio Application 的 compiled payload 转成某个 provider 的 request body。
```

需要观察：

- Adapter 是否只消费 compiled payload；
- Adapter 是否不需要理解 Card / Setting Layer / Opening / Chat documents；
- Adapter 是否能注册 capability validation；
- role、system、assistant prefill、tool call、content parts 等差异是否可诊断；
- usage / error / streaming 是否能规范化。

设计影响：

```text
Provider Adapter 负责 compiled payload -> provider request body。
它不负责编译 AIRP documents。
```

### 3.7 Importer 作者：导入 SillyTavern 数据

Actor:

```text
Importer / Compatibility 作者
```

Goal:

```text
导入 ST 角色卡、世界书、聊天记录和 preset。
```

需要观察：

- ST 字段是否映射到 canonical model，而不是反向塑造 canonical model；
- Character description / personality / scenario 是否进入 Setting Layer；
- First Message 是否变成 Opening；
- ST preset 是否转换为 Composition Skeleton；
- 无法无损映射的行为是否进入 diagnostics。

设计影响：

```text
兼容层可以保存历史语义，但不能让历史字段决定 Studio canonical model。
```

---

## 4. 场景评估问题

每个场景结束时，至少回答这些问题：

1. 这个场景需要哪些最小概念？
2. 哪些概念只是我们提前想象出来的？
3. 用户需要理解多少层才能完成目标？
4. 失败时 Studio 能否给出清晰诊断？
5. Trace 能否解释最终 prompt / payload 的来源？
6. 这个设计是否污染 Kernel？
7. 这个设计是否把 Provider 差异推给了错误的人？
8. 如果换成 OpenAI / Anthropic / Gemini，行为是否可解释？

---

## 5. 与 Application Layer 的关系

`docs/08-ApplicationLayer/` 中的每个重要模型都应能被场景反推：

- Card Model；
- Chat / Opening Model；
- Setting Layer；
- Composition Skeleton；
- Composition Pipeline；
- Runtime Boundary；
- Provider Adapter Boundary；
- Trace / Explainability。

当一个字段无法对应到任何当前场景时，默认不进入 M0。

当一个场景反复需要同一种能力时，再把它提升为正式模型或 Application convention。
