# Setting Layer 作为 Prompt Source v0

> **状态**：Open Design
> **主题**：Setting Layer 与 Prompt Builder 的关系。
> **2026-09-20 收束**：第 7 节明确 Setting 注入与配置宏的分工，取代早期“宏查询 Binding 并生成 Fragment”的候选。配置面板与作品来源选择待实施，见 [上下文骨架 Plan](../../../plans/agent-context-skeleton-and-memory-projection-plan.md)；其他历史动态挂载方案不因本次补记自动成为实现合同。

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
  哪些 setting entries 在当前 facts / signals 下 active。

Projection:
  active entries 如何变成 prompt-facing fragments，
  并填入 Composition Skeleton 的 slots。
```

这里的 Activation 是 Prompt Builder 的通用控制阶段，不是 Setting Layer 私有机制。

Setting Layer 可以提供：

```text
content:
  setting entries / folders / subjects。

facts:
  好感度、地点、阵营、状态变量等可被条件引用的事实。

signals:
  keyword hit、vector match、manual pin、plugin signal 等激活信号。
```

Prompt Builder 统一执行 Activation Evaluation，并产出 active / inactive / reason。Setting Layer 的 `enabled` 只表示作者配置层是否允许该 entry 被使用；`active` 是某次 PromptBuild 的求值结果，不应写回源配置。

开放问题：

- activation 结果写入 fragment meta，还是单独写 Activation Report；
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

## 7. Setting 与配置宏的职责

已确认方向：Anchor 负责注入独立内容，配置宏负责宿主文本的候选取值与局部替换。Setting 内容和设置面板不是同一个概念。

选择标准是“配置选择”还是“多方汇集”：

- 单选或限定数量多选，选中内容构成本次配置值：使用宏。
- 多方独立贡献需要同时表达，彼此不是替换关系：使用 Anchor。
- 多本世界书的常驻内容、多个提醒、记忆贡献属于后者。宏也可以有多来源候选，所以来源数量不是单独的判断依据。
- 条目 / Token 预算不属于配置选项的互斥或多选规则，不因此把 Anchor 改成宏。

| 方式 | 作者提供什么 | 构建行为 |
| --- | --- | --- |
| Anchor 注入 | 具有来源、激活和排序信息的 Setting / Runtime Contribution | 在预设指定位置组织多份独立内容，不替换其他 Preset Entry |
| 配置宏 | 预设默认候选、角色卡或扩展候选，以及用户选择的来源 | 在宿主 Entry 中展开一个确定值，不生成独立节点 |

正文可以引用 `{{Setting.wenfeng_macro}}`，预设提供多种文风供设置面板选择；角色卡提供自己的候选时，请用户确认采用它还是保留当前选择。示例宏名不是文件路径、自动 Setting 查询语法或已定命名空间。

局部推演同样可以引用 `{{cot.剧情推进}}`。角色卡候选只替换该处配置文本，预设前后的固定步骤保持不变。宏值可以是长文本；需要独立启停、排序与来源身份时仍使用 Contribution，不能用宏递归生成提示词树。

受限多选应先准备好选定的配置值，再按现有标量宏展开；数组宏、组合格式及设置 UI 不视为已实现。记忆来源更新自身摘要版本是生命周期行为，不是让一个记忆贡献在 Anchor 中自动覆盖其他来源。

分工：

- Preset 决定树、包裹、固定 Entry、开放 Anchor 和配置宏的使用位置。
- Card / Setting 来源提供设定贡献，Card / Extension 也可以显式提供配置候选；文件夹名相同不构成自动覆盖。
- 用户设置选择宏候选，展示有效值和来源；作品选择不修改全局预设开关或原文。
- 宏作为平台通用配置方式可以有全局默认，但不成为所有角色卡共享写入的全局可变 KV。具体选择的持久化归属仍待生命周期讨论。
- State 宏继续只读真实状态；文风选择不赋值到 State，状态提交也不能隐藏在宏或 Prompt 加工中。

本轮不增加 Anchor 的通用替换功能。早期用宏隐式查询 Setting、聚合 Fragment 并继承其 Activation / Placement 的方案不再沿用；需要先加工 Setting 得到字符串时，由明确的来源准备过程完成。

已实现的宏展开、候选选择和诊断以 [正式消费合同](../../../../architecture/application/prompt-build/injection-and-inline-expansion.md) 为准。多候选设置与角色卡覆盖确认是后续工作，不在本文冒充已实现行为。

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
