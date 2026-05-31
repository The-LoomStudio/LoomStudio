# Setting Layer 作为 Prompt Source v0

> **状态**：Open Design
> **主题**：Setting Layer 与 Prompt Builder 的关系。

---

## 1. 核心判断

Setting Layer 是 prompt-facing 内容的主要来源之一。

但 Setting Layer 不等于 Prompt Builder。

更准确的分层：

```text
Setting Layer:
  组织设定、状态、可索引内容、可投影内容。

Prompt Builder:
  根据 Skeleton、Session、Runtime 和 Provider 约束，
  选择并投影 Setting Layer 中的内容。
```

因此 Setting Layer 不应直接拥有最终 message 结构，也不应直接绑定 provider role。

Setting Layer 内部未来可能采用 ECS-like 的内容组件模型，但这仍是开放问题。即使采用，也应与 Prompt Builder 的 composition components 分层：

```text
Setting Layer components:
  描述内容本体。

Prompt Builder components:
  描述 prompt 编译过程。
```

---

## 2. 为什么 Card metadata 不进 prompt

Card metadata / readme 服务展示、分发和作者说明。

它们不应成为 Prompt Builder 的特殊输入。

Prompt-facing 内容应进入明确 source：

- Setting Layer；
- Opening；
- Chat / Session source；
- Global Scope / User Profile；
- Extension contribution；
- Memory / Knowledge；
- Runtime input。

这避免重新制造旧生态中的混乱：

```text
作者说明、平台简介、角色描述、Author's Note、场景事实、行为指令
混在同一批 loose notes 字段里。
```

---

## 3. Setting Layer 输出给 Prompt Builder 的内容

候选方向：

```text
Setting Layer Document
  -> Source Adapter
  -> Composition Fragment[]
```

fragment meta 可以携带：

```text
sourceDocumentId
sourceField
sourceKind
activation state
priority
slot hint
projection hint
```

这些 meta 是 Prompt Builder convention，不是 Core schema。

Setting Layer 自身的内容组织可以更结构化。例如一个 subject 下可能聚合来自用户、插件、AI、importer 的多个 entries：

```text
/characters/alice/profile
/characters/alice/memory/event-001
/characters/alice/state/mood
/characters/alice/plugin/foo/private-note
```

Prompt Builder 不应直接依赖这些路径细节，而应通过 projection / binding / source adapter 得到 Composition Fragment。

---

## 4. Activation 与 Projection

Setting Layer 至少涉及两个步骤：

```text
Activation:
  哪些 setting entries 在当前 session / chat / runtime input 下被选中。

Projection:
  被选中的 entries 如何变成 prompt-facing fragments，
  并填入 Composition Skeleton 的 slots。
```

开放问题：

- activation 结果写入 fragment meta，还是单独写 activation report；
- inactive entries 是否默认进入 trace；
- projection rule 是 Setting Layer 的能力，还是 Prompt Builder 的能力；
- slot hint 是 author 明确声明，还是 composer 自动推断；
- mutable state 与静态设定如何一起投影。

---

## 5. 与 Skeleton 的关系

Setting Layer 不决定最终 prompt 结构。

Skeleton 才决定：

- 哪些 slot 存在；
- slot 顺序；
- slot 合并策略；
- slot 是否允许某类 source；
- slot 如何输出到 compiled prompt payload。

Setting Layer 负责提供可被选择和投影的内容。

候选流程：

```text
Setting entries
  -> activation / selection
  -> composition fragments
  -> assign slots
  -> fill skeleton
  -> compiled prompt payload
```

---

## 6. 与 Chat / Session 的关系

Chat / Session 不放入 Prompt Builder 文档区作为 canonical model。

但 Chat / Session 会作为 Prompt Builder 的重要输入：

- recent history；
- hidden prompt-only entries；
- current user input；
- branch / variant 选择结果；
- state patches。

Prompt Builder 应消费这些输入，而不是把 Chat 本体定义为 provider-facing `messages[]`。

---

## 7. 与宏 / Binding 的关系

宏不应成为 Setting Layer 的 canonical data model。

候选方向：

```text
结构化 entry / component 是 canonical data。
Binding 是可查询、可投影的引用。
宏只是引用 binding 的一种文本语法。
```

例如：

```text
{{alice.memory}}
  -> BindingRef(alice.memory)
  -> query Setting Layer
  -> aggregate matching entries
  -> render fragments
  -> trace source entries
```

这允许作者继续使用变量语法，同时保留目录式查看、插件贡献、activation、ordering、budget 和 trace 的细粒度能力。

---

## 8. Dynamic Context Mount: 被动触发与主动读取共享挂载面

Setting Layer 的动态投影需要同时容纳：

```text
被动触发:
  关键词、变量、JS activation rule 等程序性触发的 entries。

主动读取:
  Agent 通过 read / search tool 主动拿到的 entries 或 query results。
```

二者不应变成两套互相竞争的排序系统。更稳的方向是共享同一个动态挂载面：

```text
Dynamic Context Mount:
  slot / mount region 由 Skeleton / author 规则决定。
  priority / folder order / entry order 由作者规则决定。
  origin 标记 item 来自 passive activation 还是 active read。
  lifecycle 由 Runtime Policy 控制。
```

主动读取结果的第一次投影可以临时进入 `Fresh Read Tail`，让模型明确感知"这是刚刚读取到的材料"。消费一轮后，该内容进入 Dynamic Context Mount，并按作者排序。

```text
fresh active read:
  tail marker + high recency attention

settled active read:
  authored ordering + normal dynamic mount lifecycle
```

### 8.1 卸载边界

被动触发和主动读取不能共用同一种卸载条件。

```text
passive activation item:
  activation condition 不满足即可卸载。

active read item:
  由 TTL / token budget / pin / source stale / branch boundary 卸载。
```

如果同一个 Setting Entry 同时被关键词触发和 Agent 主动读取，Projection 可以通过 `sourceRef` 去重，但不能用关键词条件卸载主动读取的挂载。

### 8.2 Setting 与 State 的边界

低频、稳定、需要总结阶段才修改的人设、性格、年龄、关系等，不应为了 UI 或宏访问而被提升成"慢变量"。

```text
稳定设定:
  属于 Setting Store。
  可以通过统一寻址、Binding、UI projection 读取。
  修改通常走 mutate_setting / summarization 阶段。

高频状态:
  属于 State Store。
  例如 HP、回合数、临时 flag、需要即时规则判定和 JSON Patch 的变量。
```

State Store 不应膨胀成第二套世界书。

## 9. 非目标

本文件不定义：

- Setting Layer 的完整 document schema；
- Chat / Session document schema；
- Provider request body；
- 复杂 worldbook 兼容行为；
- 完整 state mutation API。
- 完整宏语言或模板引擎。

这些分别属于对应的 Application Layer 专题文档。
