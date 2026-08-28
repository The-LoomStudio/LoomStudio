# Card Model v0

> **状态**：从 ADR-005 迁移 / 开放设计  
> **来源**：[`../adr/ADR-005-official-concept-stack-open-design.md`](../../adr/ADR-005-official-concept-stack-open-design.md)
> **最新实施收束**：Card 作为直接资源清单、PromptWorkspace 退出运行主链的迁移计划见 [`../../plans/card-resource-manifest-migration-plan.md`](../../../archive/plans/card-resource-manifest-migration-plan.md)。本文保留早期概念讨论，不作为下一阶段工程入口。

---

## CS-0：Studio Application 定位

### 6.1 目前已收束方向

本节记录当前讨论中已经基本收束的方向。它们仍属于本文的 Open Design，但后续讨论应以这些方向为默认前提，除非有新的反例推翻。

#### 6.1.1 顶层内容单元叫 Card

Studio Application 的顶层用户内容单元暂定为：

```text
Card
```

理由：

- `Card` 符合当前社区自然语言，例如“玩卡”“发卡”“卡呢”；
- `Card` 可以继承现有生态的分发心智；
- `Card` 不必等于 `Character`，可以承载更宽的 AI 互动内容。

必须明确：

```text
Card is not necessarily a Character.
```

一张 Card 可以是：

- 单角色互动内容；
- 多角色剧场；
- AI 互动小说；
- 世界模拟；
- 教学内容；
- agent workflow；
- 开发与游玩一体的内容单元。

`Character Card` 是旧生态中的一种历史形态；Studio Application 的 canonical 顶层模型不叫 `Character`。

Card 更准确地说是最小可分发、可启动、可游玩的内容包，不是一次运行时实例。基于 Card 启动出来的一次具体游玩 / 存档 / 运行实例应由 Session 表达。

#### 6.1.2 Card metadata 只服务展示，不进入 prompt

Card 可以有给玩家、作者和平台看的展示信息，例如标题、简介、封面、标签、作者等。

但这些展示信息不应成为 prompt builder 的特殊输入。

当前原则：

```text
Prompt-facing content must live in setting / opening / skeleton-controlled sources,
not in loose Card notes fields.
```

因此，不需要区分：

```text
作者给玩家看的说明
作者给平台展示的描述
```

它们都属于 Card 展示 metadata / readme 范畴。

也不应新增一个宽泛的 `notes` 字段来承载可能进入 prompt 的内容。宽泛 notes 会重新制造 `Author's Note`、角色描述、作者备注、平台简介之间的语义混乱。

#### 6.1.3 Character description / Personality / Scenario 不作为 canonical prompt 字段

Studio Application 不继承 ST 风格的：

```text
Character description
Personality
Scenario
```

作为 prompt builder 的特殊字段。

这些字段的问题是：

- 过度绑定单角色卡；
- 与统一设定层重复；
- 让 prompt builder 必须理解大量历史字段；
- 容易让展示描述、设定事实和 prompt 指令混在一起。

后续 Card 设计应以统一设定层为核心，而不是用 `description / personality / scenario` 三件套作为地基。

#### 6.1.5 Example Dialogues 暂不继承为一等概念

ST 的 Example Dialogues 暂不作为 Studio Application 的一等概念。

理由：

- 它本质上可能只是预制对话片段；
- 也可能是风格样例、few-shot 样例、开场剧情或训练示范；
- 过早继承会把 ST 的 prompt slot 历史包袱带进 canonical model。

后续如果需要，可在 Opening、few-shot source 或 Skeleton slot 设计中重新讨论。

#### 6.1.6 不做 ST Group Chat 产品概念

Studio Application 不复刻 ST 的 Group Chat 产品概念。

如果未来需要多角色剧场、世界模拟、多实体互动或 agent workflow，应通过更通用的设定层和 Chat / Runtime 结构解决，而不是提前引入 `GroupMember` 这类 ST 产品形态。

#### 6.1.7 不建立 Actor / Participant / Speaker / CharacterProfile 硬编码类层级

当前不接受过早建立以下硬编码抽象作为设定层地基：

```text
Entity
Actor
Participant
Speaker
CharacterProfile
RelationRecord
SceneEntry
RuleEntry
ProjectionRule
```

这些名称可能在未来局部出现，但不能作为 CS-0 的顶层定型。

核心原因：

```text
Studio Application should provide capability, not constrain authoring space through premature class hierarchy.
```

设定层应优先讨论“可嵌套、可索引、可投影的统一设定系统”，而不是先把世界拆成多种硬编码类。

#### 6.1.12 Import / Compatibility 延后

导入 ST 卡、导入 ST 世界书、兼容旧角色卡不是当前 CS-0 的驱动力。

本文当前讨论的是下一代 AIRP / Studio Application 内容单元本身，而不是兼容层。

兼容导入可以后续作为单独 Import / Compatibility 议题处理，但不能反向塑造 canonical model。

### 6.2 开放问题

- Studio Application 是默认角色扮演栈，还是更通用的 AIRP 体验层？
- 它是否只服务 Chat？
- 它是否要支持写作、世界模拟、多角色剧场、教学、agent workflow？
- 它是否定义 `messages[]` 作为输出之一？
- 它是否应该输出多个 target payload，例如 `messages-like`、plain text、debug tree？
- 它是否维护运行时状态，还是只负责 compose？
- Card 与 Workspace、Session 的准确关系是什么？其中 Card 倾向内容包，Session 倾向运行实例。
- Opening 如何被编译进 prompt / message payload，而不变成特殊 Chat 元素？
- Setting Layer 是否采用树状目录 / 嵌套结构？
- Setting entry 如何表达可变 KV、文本设定、引用和投影规则，同时避免硬编码类层级？
- 全局设定、全局用户设定、全局设定库如何进入当前 Card / Session？
- Composition Skeleton 的 slot / cluster 是否应成为可扩展的声明式系统？

### 6.3 候选方向

```text
Studio Application 负责 AIRP 领域组织与 prompt composition。
Studio Application 不进入 Kernel，也不负责 provider-specific request mapping。
Card 是顶层内容包；Session 是基于 Card 的运行实例。
Setting Layer 是设定与可变状态的统一地基。
Opening 是开场材料，不是特殊 Chat 元素。
Composition Skeleton 是预设层的 backend canonical 候选。
```
