# Unified Setting Layer v0

> **状态**：从 ADR-005 迁移 / 开放设计
> **来源**：[`../adr/ADR-005-official-concept-stack-open-design.md`](../adr/ADR-005-official-concept-stack-open-design.md)

---

## 来自 CS-0 的 Setting 方向

#### 6.1.8 统一设定层是核心方向

Studio Application 不应把：

```text
静态知识
角色描述
世界书
状态变量
场景事实
长期记忆
```
这些本质都为"上下文"的东西
拆成彼此孤立的系统。

这样会导致：

- 同一个对象在 Knowledge 层和 State 层重复出现；
- 设定随时间变化后，静态知识滞后；
- 插件各自发明路径，例如 `battle.alice.health`、`roman.alice.love`；
- prompt composition 必须靠后期聚合弥补地基层混乱。

当前方向是建立一个更统一的设定层：

```text
Setting Layer
```

但 Setting Layer 的具体形状仍未定。

当前只确定原则：

```text
Setting is the source of truth.
Prompt is a projection.
Mutable state 应在同一个 setting foundation 中可寻址，
而不是形成独立的 shadow world。
```

Setting Layer 需要进一步讨论：

- 如何嵌套；
- 是否采用树状目录系统；
- 如何通过 id / path 索引；
- 如何挂载 KV；
- 是否采用 ECS-like 的内容组件模型；
- 如何表达 subject / kind / source / visibility / projection 等 component-like 信息；
- 如何与 session 绑定和回滚；
- 如何让插件和 AI 用简单 API 修改；
- 如何避免过早硬编码类体系。

#### 6.1.9 Book 概念弱化

`Worldbook / KnowledgeBook` 中的 `Book` 不是核心语义。

如果保留类似概念，它应只是 collection / folder / bundle / namespace，而不是设定层的最小原子或行为拥有者。

最小原子暂时只称为：

```text
Setting entry
```

但它的具体字段、是否带 KV、如何嵌套、如何激活，仍需单独讨论。

---

## CS-3: Unified Setting Layer

### 9.1 问题

“世界书”这个词来自既有生态，但 Studio Application 不应只建立一个静态 Knowledge model。

当前问题是：设定、知识、状态、变量、场景事实如果被拆成多个孤岛，会导致重复和滞后。

因此本层暂称：

```text
Setting Layer
```

Setting Layer 需要表达：

- 常驻知识；
- 关键词激活知识；
- 场景上下文；
- 世界设定；
- 可变状态 / KV；
- 可嵌套目录；
- 可通过 id / path 索引的设定项；
- 未来的语义检索 / embedding 知识；
- 激活原因和未激活原因；
- 如何投影为 prompt fragments。

### 9.2 开放问题

- Setting Layer 的最小原子叫什么？`SettingEntry` 是否足够？
- Setting Layer 是否采用树状目录 / 嵌套结构？
- 如何表达可变 KV，而不建立独立 shadow state world？
- 是否引入 Content / Setting Layer 组件模型？
- 如果引入，component 是显式字段，还是只是 convention？
- path / folder / subject / component 之间如何分工？
- Binding definition 存在哪里？
- 宏 / 变量注入是直接字符串替换，还是 binding query 的语法糖？
- 如何避免预设 `Entity / StateRecord / RelationRecord / RuleEntry / SceneEntry` 等硬编码分类？
- `Book` 是否只作为弱 collection / folder 概念？
- 激活时扫描哪些源？
  - recent chat messages
  - opening
  - card setting layer
  - global setting layer
  - active scene
  - session summary
  - previous activated entries
- M0 是否支持 recursive activation？
- 是否支持 regex？
- 是否支持 sticky / cooldown / delay？
- 是否支持 negative keywords？
- 是否支持 semantic search？
- 激活和注入是否应该拆成两个 Pass？
- inactive entries 是否进入 trace？
- KV 修改 API / 命令 / SQL-like 语法是否属于 first-party AIRP state/mutation package，而不是 Setting Layer schema 本身？

### 9.2.1 术语边界

`Setting Layer` 指 AIRP 作品设定层，不是 Studio 应用设置。

术语约定：

```text
Setting Layer:
  AIRP 作品设定层。

Preferences:
  应用设置 / 用户偏好。

Settings:
  不作为主要 UI 术语使用，避免和 Setting Layer 混淆。
```

Config / Settings / Preferences / Setting Layer 的系统边界尚未在本文处理，应后续单独形成 ADR。

### 9.2.2 Content Component / Binding 方向

2026-05-25 讨论补充：Setting Layer 可能也需要 ECS-like 的内容组织方式，但该方向尚未接受为 schema。

候选分层：

```text
Content / Setting Layer Component Model:
  用来组织内容本体。
  例如角色、记忆、状态、关系、事件、插件贡献内容。

Prompt Composition Component Model:
  用来编译提示词。
  例如 slot、ordering、activation、render、budget、provider compatibility。
```

二者通过 projection / source adapter 连接：

```text
Setting Layer entry
  -> projection / binding
  -> Composition Fragment
  -> Prompt Builder
```

宏与变量注入暂按以下方向继续讨论：

```text
结构化 entry / component 是 canonical data。
Binding 是可查询、可投影的引用。
宏只是引用 binding 的一种文本语法。
```

示例：

```text
{{alice.memory}}
  -> BindingRef(alice.memory)
  -> query Setting Layer
  -> aggregate matching entries
  -> render prompt fragments
```

该方向的完整讨论记录见：

- [`prompt/content-component-and-binding-v0.md`](prompt/content-component-and-binding-v0.md)

### 9.3 已废弃草案

```ts
type KnowledgeEntry = {
  id: string
  bookId: string
  title: string
  content: string
  enabled: boolean
  activation: ActivationRule
  placement: PlacementRule
  priority: number
  tags?: string[]
  scope?: KnowledgeScope
}

type ActivationRule =
  | { kind: 'always' }
  | { kind: 'manual' }
  | { kind: 'keyword'; keywords: string[]; caseSensitive?: boolean }
```

上面的 `KnowledgeEntry` 草案仅作为旧讨论产物保留。如果把它解释为静态知识，它就过于狭窄；在 Setting Layer 讨论清楚前，它不应驱动实现。

M0 候选限制可能仍然是：

```text
支持：always、manual、simple keyword activation
延后：recursive、sticky、cooldown、delay、regex、embedding、vector lore
```

---

## Discussion Capture: 稳定设定区 vs 动态变量区 (2026-05-27)

### 背景

Setting Layer 的内容投影到 Prompt 前部（类似 ST 蓝灯世界书）。修改前部内容会导致 Provider KV Cache 从修改位置起全部失效。

### 分区方案

Setting Layer 内容按修改频率和投影位置分为两个区域：

```text
稳定设定区（Lore / 世界书 / 角色资料）:
  - 投影到 Prompt 前部
  - 只在总结阶段修改
  - 修改时 Cache 已因对话截断而失效，不额外付出代价

动态变量区（HP / 好感度 / 临时标记 / 数值变量）:
  - 投影到 Prompt 尾部或 Tool Result 中
  - 可随时通过 patch_state Tool 修改
  - 修改不影响前部 Cache
```

### 设计原则

```text
1. 稳定设定区只在总结阶段批量修改。
2. 非总结阶段，Agent 对稳定设定区的修改意图暂存为 PendingSettingPatch。
3. 待下次总结时统一应用。
4. 动态变量区不受此限制，可随时 patch。
```

### 与总结功能的耦合

Setting Layer 稳定区的更新时机与总结阶段绑定。详见 [`summarization-v0.md`](summarization-v0.md)。

```text
总结阶段流程中的 Setting Layer 更新:
  1. 总结子 Agent 读取即将截断的对话 + 当前 Setting Layer
  2. 应用 PendingSettingPatch + 从对话中提取新的设定变更
  3. 生成 Setting Layer Patches → MutationCandidate 提交
  4. 生成剧情摘要 → 写入特殊 slot
  5. 截断旧对话
```

先更新设定，再总结。因为设定更新后摘要可以更简洁（避免重复记录已写入设定层的信息）。

### 与任务级 Checkpoint 的回滚一致性

在双 Store 架构下，频繁变动的 `State Store` 变量（如 HP、好感度）面临在 Chat Reroll 时与聊天历史保持一致的回滚需求。为了避免每一次原子 ToolCall（`patch_state`）都去创建 Checkpoint 导致持久化 Revision 爆炸，我们采取了以下**任务级大 Checkpoint 深度配合方案**：

1. **Checkpoint 的时机**：只在**用户新一轮输入/交互开启时**，由 AIRP 体验层创建底层的 Document 集合大 Checkpoint（例如以 `user_input` 触发）。
2. **打包写入以求天然回滚**：
   * 在 Agent 执行过程中的高频 `patch_state` 仅在内存中更新变量状态。
   * **当 Agent 决策循环完全结束、生成完剧情正文并提交 Session 变更时**，AIRP 体验层将最终变动后的变量状态，以一个整体快照 Document（如 `airp.session.state:*`）打包写入 Document Store，作为一个原子 Changeset 的一部分。
3. **回滚效果**：
   * 当用户需要回退消息、重 roll 这一轮回复时，底层 Document Store 会自动 restore 用户输入开始时的大 Checkpoint。
   * 随着 Checkpoint 的恢复，`airp.session.state` 的 Document 状态也会自动重置为上一轮结束时的初始值，**瞬间实现 HP 扣减与消息历史的一致性回滚**。
   * 中间一系列失败或被丢弃的 Agent 原子操作、ToolCall 和临时变量修改，全部干干净净地随 Checkpoint 恢复而自然抹去。

---

## Discussion Capture: 双 Store 架构与统一寻址 (2026-05-29)

### 背景

Setting Layer 需要同时承载"知识/设定"（文本内容、世界观、角色描述）和"可变状态"（HP、好感度、标记）。但二者在存储特性、变动频率、运行时消费者、Prompt 投影位置上完全不同，不适合强行合并为同一种数据结构。

### 核心结论：统一寻址，分区存储

```text
┌──────────────────────────────────────────────────┐
│              统一寻址层 (Namespace)                │
│                                                   │
│   alice.lore.background  →  查 Setting Store      │
│   alice.hp               →  查 State Store        │
│   combat.rules           →  查 Setting Store      │
│   scene.current_weather  →  查 State Store        │
│                                                   │
│   上层（Agent / 宏 / Prompt Builder）不需要        │
│   知道数据到底存在哪个 Store                       │
└────────────┬─────────────────────┬────────────────┘
             │                     │
     ┌───────▼───────┐     ┌──────▼────────┐
     │  Setting Store │     │  State Store  │
     │  (设定条目)     │     │  (变量)       │
     │               │     │              │
     │  树状路径组织   │     │  scope+key   │
     │  文本内容为主   │     │  有 Schema    │
     │  关键词激活     │     │  频繁变动     │
     │  总结阶段才改   │     │  随时 patch   │
     │               │     │              │
     │  → Prompt 前部 │     │  → Prompt 尾部│
     └───────────────┘     └──────────────┘
```

### Setting Store

设定条目的组织采用树状路径结构（类似文件夹），用于分类归档：

```text
王都/
  人物/
    爱丽丝 (entry: 背景、人设...)
    莎拉 (entry)
  地点/
边境小镇/
  ...
```

条目本身是以文本内容为主的知识载体，附带激活规则、关键词等元数据。

### State Store

变量系统独立于 Setting Entry，采用扁平的 scope + key 寻址：

```text
scope: alice
  hp:      100    (schema: number, 0~100)
  attack:  15
  defense: 8
```

变量需要 Schema 约束（类型、范围），支持频繁读写和回滚。

### 变量不挂在 SettingEntry 上

SettingEntry 不是变量的存储单元。变量有自己独立的位置和 Schema。

但 SettingEntry **可以声明变量的初始值和 Schema**（用于 Session 启动时的初始化）。初始化完成后，变量系统独立运转，patch_state 修改的是变量系统的值，不是 Entry 本身。

### 隐秘生态：两个 Store 之间的交互

虽然物理分离，但存在两条重要的交互通道：

```text
1. 变量 → 设定（条件激活）
   Setting Entry 的 activation rule 可以引用变量。
   示例：条目"爱丽丝濒死状态"的激活条件为 alice.hp <= 20。
   Prompt Builder 在 Activation Pass 中跨 Store 查询变量值进行判定。

2. 设定 → 变量（初始化与 Schema 声明）
   Setting Entry 中可以声明变量的元信息。
   示例：爱丽丝条目声明"hp: number, 0~100, 初始值 100"。
   Session 启动时，变量系统扫描相关条目并初始化。
```

### 场景验证

以战斗系统为例验证完整流转：

```text
初始状态:
  Setting Store: 条目"爱丽丝濒死状态", activation: alice.hp <= 20
  State Store:   alice.hp = 100

战斗中:
  Agent 调用 patch_state → alice.hp 从 100 降到 15
  → State Store 更新，Setting Store 不变

下一轮 Prompt Build:
  Activation Pass 扫描条目激活规则
  → 查询 State Store: alice.hp = 15 ≤ 20 → 条件成立
  → 条目"爱丽丝濒死状态"被激活
  → 投影到 Prompt 前部（稳定设定区）

同时:
  → alice.hp = 15 投影到 Prompt 尾部（动态变量区）

LLM 同时看到濒死描写和 HP 数值，产出的文本自然带有紧迫感。
```

### 本章节的定位

这是数据层的基座设计（东西存在哪、怎么找到它）。以下内容不在本章节范围：

- Setting Entry 的完整字段定义；
- State Store 的完整 Schema 系统；
- 激活规则的具体语法；
- Prompt Builder 如何编译和投影；
- Agent 的读写 Tool API。

---

## Discussion Capture: 设定树组织与 ECS 组件模型 (2026-05-29)

### 背景

在确定了 Setting Store 和 State Store 的双 Store 架构后，我们需要细化 Setting Store 底层的存储与组织结构。主要面临以下三个设计痛点：
1. **扁平存储与树形结构的矛盾**：底层使用 SQL 扁平存储，而上层需要类似文件夹的路径结构（Path）进行分类与整理。
2. **虚拟文件与复用需求**：同一个条目（例如同一个 NPC 莎拉）可能同时出现在多个分类中（例如“王都/人物”和“边境小镇/人物”），如果写两个 Entry 会导致数据冗余与同步困难。
3. **扩展性与字段爆炸（Schema Bloat）**：不同插件和预设作者需要对条目附加各种属性（关键词、优先级、冷却时间、排序、插件自定义数据）。硬编码这些字段会导致表结构臃肿且难以维护。

### 核心结论

为了保持简洁性、可扩展性与健壮性，我们采用 **Adjacency List (parentId) + 虚拟引用表 + ECS 组件模型** 的设计。

---

### 1. 基于 `parentId` 的树形组织

树结构在扁平的 SQL 表中通过显式父指针表达。文件夹（Folder）本身也是一种特殊的 Setting Entry，只是它们没有正文内容组件。

#### 表结构设计示意：
```ts
interface SettingEntry {
  id: string;        // 唯一标识符
  parentId: string | null;  // 指向父级 Entry ID
  name: string;      // 节点显示名称 (如 "爱丽丝"、"人物")
  type: 'folder' | 'entry' | 'link'; // 节点类型
}
```

*   **路径解析**：在上层需要完整 Path（如 `/王都/人物/爱丽丝`）时，可通过 `parentId` 向上递归拼装。Path 仅作为展示与寻址的“语法糖”，不作为底层的 canonical 数据，从而避免了移动文件夹或节点改名时产生大范围的级联更新。
*   **级联激活（Cascading Activation）**：
    当一个文件夹被激活时（例如玩家来到了“王都”，激活了“王都”文件夹），其下所有的子节点会自动跟着激活。
    *   **级联逻辑**：在 Activation Pass 中，激活状态会沿 `parentId` 构成的树向下递归传递。
    *   **优点**：作者不需要在每个角色和地点条目上重复写复杂的激活条件，只需将它们归档在特定文件夹下，通过控制文件夹的激活即可实现批量载入。

---

### 2. 虚拟文件与软链接（Link Entry）

为了实现“一个实体，多处载入”，我们引入软链接（Link）机制。

*   **表结构设计示意**：
    ```ts
    interface LinkEntry {
      id: string;        // 软链接节点自身的 ID
      parentId: string;  // 软链接所在的父文件夹 ID
      targetEntryId: string; // 指向的真实实体 Entry ID
    }
    ```
*   **多重归属场景**：
    ```text
    王都/
      人物/
        莎拉 (Entity ID: sarah_entity)  ← 真实实体存放在这里
    边境小镇/
      人物/
        莎拉 (Link ID: sarah_link, targetEntryId: sarah_entity)  ← 虚拟文件
    ```
*   **重定向与解析**：
    *   **级联激活**：无论激活“王都”还是“边境小镇”，其子节点（无论是真实实体还是 Link）都会被触发。当解析到 `type: 'link'` 时，寻址层会自动将其重定向并加载真实实体 `sarah_entity` 的内容。
    *   **单一数据源（Single Source of Truth）**：作者编辑“莎拉”的背景或人设时，只需修改 `sarah_entity` 这一处，所有指向她的虚拟文件都会自动同步，避免了复制粘贴与数据不一致的问题。

---

### 3. ECS (Entity-Component-System) 内容组件模型

为了解决未来插件和预设扩展字段膨胀（Schema Bloat）的问题，我们将 Setting Entry 设计为一个最小实体（Entity），其上的所有属性与内容均为可拆卸的组件（Component）。

*   **Entity（实体）**：仅包含最小的身份信息（`id`, `parentId`, `name`, `type`）。
*   **Component（组件）**：独立的数据包，可动态挂载到 Entry 上。
    *   通过独立的关联表（如 `entry_components`）或 JSON 列的形式存储。
    *   组件拥有独立的 Schema，由不同的 System（系统）进行消费。

#### 常用核心组件与插件扩展示例：

```text
┌────────────────────────────────────────────────────────┐
│ Setting Entry (Entity: id="alice_01", type="entry")    │
├────────────────────────────────────────────────────────┤
│ 挂载组件 (Components):                                   │
│                                                        │
│ 1. ContentComponent (主正文内容)                       │
│    { text: "爱丽丝是一名来自王都的魔法使..." }            │
│                                                        │
│ 2. KeywordComponent (激活关键词)                       │
│    { keywords: ["爱丽丝", "Alice", "魔法少女"] }         │
│                                                        │
│ 3. ActivationRuleComponent (规则触发器)                  │
│    { rules: "alice.hp <= 20" }                         │
│                                                        │
│ 4. OrderComponent (排序与插值优先级)                     │
│    { priority: 100, sticky: true }                     │
│                                                        │
│ 5. PluginCombatComponent (战斗插件自定义数据)             │
│    { element: "fire", weakness: "water" }              │
└────────────────────────────────────────────────────────┘
```

#### ECS 架构带来的工程优势：
1.  **极高灵活性**：文件夹类型的 Entry 无需 `ContentComponent`。纯配置项 Entry 无需 `KeywordComponent`。
2.  **插件完全解耦**：任何第三方插件想要在 Entry 上添加逻辑（如关系图谱、翻译、情感度分析等），只需定义自己的 `PluginXxxComponent` 并挂载即可，**完全不需要修改 Setting 核心表的 Schema**。
3.  **支持多组件协作**：一个条目可以有多个 `ContentComponent`（如“基础设定”和“额外备注”），不需要在实体上硬编码 `content1`、`content2`。

---

### 验证场景（级联激活 + 虚拟链接 + 变量联动）

继续以战斗和旅行系统为例验证：

1.  **场景初始化**：
    *   “王都” 文件夹被激活（因为来到了王都，变量 `scene.location = "王都"` 成立，触发“王都”文件夹激活）。
    *   “王都/人物/莎拉” 实体被激活。
    *   “边境小镇/人物/莎拉（软链接）” 尚未激活，因为“边境小镇”未触发。
2.  **角色变更**：
    *   当旅行到边境小镇，“边境小镇” 文件夹激活，“边境小镇/人物/莎拉（软链接）” 被触发。
    *   软链接被统一寻址层重定向，拉取 `sarah_entity` 的内容。
    *   变量系统中的 `sarah.hp` 等状态直接与当前唯一的 `sarah_entity` 绑定。
3.  **编辑同步**：
    *   作者修改了莎拉的立绘或背景，由于修改的是 `sarah_entity`，边境小镇和王都里引用的莎拉在展示和送模时都会同步变更为最新内容，完全不需要做级联重写。

---

## Discussion Capture: 蓝灯 / 绿灯 / 主动读取的动态挂载 (2026-05-30)

### 背景

Setting Layer 投影需要考虑缓存、动态提示词、排序、挂载和卸载。

当前将 prompt-facing setting 内容粗分为：

```text
蓝灯 / Stable Setting Projection:
  挂在 chat / narrative projection 上方。
  作者应写入不需要频繁修改的设定。
  尽量保持稳定，以利于 provider prefix / KV cache。

绿灯 / Dynamic Context Mount:
  挂在较靠近底部的位置。
  包含程序性被动触发的动态设定，以及 Agent 主动读取后沉淀的内容。
```

### 程序性触发

程序性触发的动态世界书可以自然卸载：

```text
关键词不再命中
变量条件不满足
JS activation rule 返回 false
folder / scene / branch 不再 active
```

这些条件只控制 passive activation item。

### Agent 主动读取

Agent 主动读取用于弥补程序性触发难以覆盖的情况：

```text
- 需要语义理解的内容
- 复杂拓扑关系
- 需要 Agent 判断是否相关的资料
- 程序触发没有命中、但 Agent 推理认为需要的 source
```

主动读取不应被关键词引擎卸载。它进入 Dynamic Context Mount 后，由 Runtime lifecycle 控制：

```text
fresh:
  刚读到，下一次 provider call 放到 Fresh Read Tail。

settled:
  消费一轮后回到绿灯动态挂载层，按作者排序。

pinned:
  Agent / 用户明确保留，跨 run 保持 prompt-facing。

archived / stale:
  卸载出 prompt，但 trace / transcript archive 仍可追溯。
```

### 排序原则

```text
1. fresh read 可以在尾部临时插队一次。
2. settled read 必须回到作者设定的 slot / priority / folder order。
3. passive activation 和 active read 可以通过 sourceRef 去重。
4. 卸载只改变 prompt projection，不删除 canonical setting 或 transcript archive。
```

### 慢变量不是 State Store 目标

如果某个内容低频变化、需要总结阶段才更新，或者本质是人设 / 性格 / 年龄 / 长期关系 / 世界观，它应保留在 Setting Store。

State Store 只承载高频、结构化、需要即时 patch 和 schema 校验的动态状态。
