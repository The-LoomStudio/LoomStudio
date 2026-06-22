# Composition Skeleton / Preset v0

> **状态**：Open Design
> **主题**：预设层、骨架填充、slot / marker、provider 兼容性。

---

## 1. 背景判断

SillyTavern 的 Prompt Manager / Preset 经验说明：

```text
Preset 更像一套 prompt / message 的填空骨架，
而不是一组普通字符串。
```

运行时来源把内容填进骨架：

- 角色 / 卡片中的 prompt-facing 内容；
- Setting Layer；
- Opening；
- Chat history；
- 用户人格 / 全局设定；
- Memory / Knowledge；
- Extension prompts；
- Runtime input。

这个 skeleton-and-slot 洞察值得吸收。

---

## 2. 术语建议

```text
Preset:
  用户 / UI / 社区心智术语。

Composition Skeleton:
  backend canonical 候选术语。

Slot:
  Skeleton 中的稳定填充位置。

Marker:
  ST 风格中用于占位并被运行时替换的 prompt 条目。
  在 Loom Studio 中可视为 slot 的一种历史形态或导入形态。
```

---

## 3. Skeleton 应该表达什么

Skeleton 应优先表达结构和填充规则：

- slot id；
- slot 顺序；
- slot 是否必填；
- slot 接受哪些 source kind；
- slot 填充策略；
- slot 合并 / 替换 / 分离策略；
- slot 间冲突或覆盖关系；
- output shape hint；
- provider capability requirement；
- compatibility diagnostics。

Skeleton 不应急着表达完整内容分类法。

尤其要避免过早固化类似下面的顶层分类：

```text
instruction / context / history / user-input / assistant-prefill
```

这些可能作为后续 hint 或 preset family 出现，但不应在当前阶段成为基础 slot 模型。

---

## 4. 与 OpenAI-style messages[] 的关系

ST 的经验是：

```text
先构建一个 ChatML-like messages[]，
再由 provider adapter 映射到 OpenAI / Claude / Gemini / Mistral / Cohere 等格式。
```

这个思路降低了预设作者负担，但也有风险：

- 多 system message 在某些 provider 下不是等价能力；
- assistant prefill 在不同 provider 下语义不同；
- Gemini 等 provider 的 role 心智不完全等于 OpenAI；
- system / developer / user / assistant 的边界会被 provider capability 改写；
- OpenAI-style skeleton 可能让作者误以为它天然通用。

Loom Studio 的候选方向：

```text
默认支持 provider-neutral skeleton。
允许 provider-specific skeleton。
对 OpenAI-style skeleton 做 capability diagnostics。
```

也就是说：

- 普通作者可以使用默认 skeleton；
- 高级预设作者可以声明 target provider family；
- Provider Adapter 可以注册 capability validation；
- Studio 在 provider 不匹配时给出 warn / error / fallback 诊断。

---

## 5. Provider 兼容性策略

候选策略：

```text
Skeleton declares:
  - target provider family hint
  - required capabilities
  - fallback policy

Provider Adapter declares:
  - supported capabilities
  - mapping behavior
  - loss / degradation diagnostics
```

示例能力，不作为已接受枚举：

```text
multiple-system-messages
assistant-prefill
message-name
system-instruction
tool-call
multimodal-parts
cache-control
```

诊断策略：

```text
warn:
  可以映射，但可能不等价。

error:
  目标 provider 无法表达该 skeleton 要求。

fallback:
  允许 adapter 合并、降级或改写结构，但必须进入 trace / diagnostics。
```

---

## 6. 与 Fragment meta 的关系

Source Adapter 或插件可以给 fragment 标注目标 slot。

但这仍然是 Application convention：

```text
fragment.meta.slot 是 Studio Application 的约定，
不是 @loom/core 的字段。
```

候选流程：

```text
Source Adapter:
  document -> fragment(meta.source / meta.slot?)

Composer Pass:
  根据 Skeleton、source kind、priority、activation 结果分配 slot

Fill Skeleton:
  将 fragment 填入 slot，应用 merge / replace / separate

Emitter:
  输出 compiled prompt payload
```

开放问题：

- slot assignment 应由 source 提前声明，还是由 composer 统一决定；
- 插件是否能直接声明 slot；
- source kind 与 slot accepts 的词汇表由谁维护；
- slot 是否需要 namespace；
- Skeleton 是否支持继承 / patch / override；
- 用户临时改 preset 是 fork 还是 patch。

---

## 7. Discussion Capture: Preset Zone Tree 与 Injection Group (2026-05-30)

### 7.1 核心收束

Preset / Composition Skeleton 不应只是扁平 slot 列表，而应提供一棵用于 prompt 输出的 Zone Tree。

同时需要明确三种结构不能混淆：

```text
Source Tree:
  内容来源自己的存储 / 分类 / UI 组织树。
  例如 preset snippets 的分类树、Setting Layer 的世界书树。

Preset Zone Tree:
  Prompt Builder 输出时使用的挂载拓扑。
  定义哪里可以挂内容、有哪些 anchor、如何排序和 fallback。

Injection Group:
  Source item 上的投影标记。
  用来声明“我希望注入到哪个 prompt 锚点”。
```

关键原则：

```text
Injection Group 不是文件夹。
Injection Group 是 Prompt Build 时的锚点标签。
```

因此，一个条目在存储上可以位于 `/创作约束/错误避免`，但在投影时声明：

```text
injectionGroup: safety.anti_pattern
```

它不是被移动到 `safety.anti_pattern` 文件夹中，而是在编译时被挂载到该组对应的 Zone / Anchor。

---

### 7.2 Source Tree 与 Zone Tree 的差异

Source Tree 服务作者管理内容。

```text
Preset source tree:
  /创作约束/
    📘错误避免
    ✅禁词表
  /文风/
    🖋️轻小说
    🖋️武侠
  /模式开关/
    🧭保守
    🧭冒险
```

Setting Layer source tree 服务设定管理和激活。

```text
Setting source tree:
  王都/
    人物/
      爱丽丝
    地点/
      黑塔
```

Preset Zone Tree 服务最终 prompt 组织。

```text
Root
  System
  StablePrefix
  NarrativeContext
  LowerContext
  CurrentTurn
  FreshTail
```

Setting Layer 的树可以用于分类和级联触发；Preset Zone Tree 不负责级联激活，只负责挂载、排序、渲染和 fallback。

---

### 7.3 不使用蓝灯 / 绿灯作为 canonical 语义

旧生态中的蓝灯 / 绿灯更像 UI 心智，不应成为 canonical 模型。

应拆成正交维度：

```text
位置:
  stable prefix / narrative context / lower context / current turn / fresh tail / custom zone

生命周期:
  always / conditional / activeRead / fresh / pinned / archived

来源:
  preset / setting / worldbook / card / plugin / runMemo / activeRead

缓存期望:
  stable / variable / one-turn fresh
```

因此，下方的 `LowerContext` 也可以有常驻内容。上方的 `StablePrefix` 也可以有条件内容，只是作者需要理解它会影响缓存和注意力。

### 7.3.1 Zone / Slot 也参与 Activation

Activation 不只发生在 Setting Entry 或 fragment 上。Preset Zone、Slot、Injection Group 也可以作为 controllable target，在本次 PromptBuild 中被求值为 active / inactive。

```text
enabled:
  Zone / Slot 的作者配置状态。
  表示该结构默认允许参与。

active:
  本次 build 中该 Zone / Slot 是否实际参与。
  由 Activation Engine 根据 facts / signals 求值产生。
```

示例：

```text
agent.mode == micro_play
  -> active short_interaction zone
  -> inactive final_prose zone

agent.mode == finalize
  -> inactive short_interaction zone
  -> active final_prose zone

state.combat.active == true
  -> active combat_rules slot
```

这不应写回 Skeleton 配置。Prompt Preview / Trace 需要展示 Zone / Slot 为什么 active 或 inactive。

---

### 7.4 Zone Node 候选数据结构

Composition Skeleton 可以在一个 Document 内保存扁平的 parentId adjacency list。

```ts
type CompositionSkeleton = {
  id: string
  name: string
  version: string
  rootZoneId: string
  zones: PresetZoneNode[]
  injectionGroups: InjectionGroup[]
  fallbackZoneId: string
}

type PresetZoneNode = {
  id: string
  parentId: string | null

  key: string
  aliases?: string[]
  displayName: string

  kind: 'group' | 'mount' | 'content' | 'emit'
  band: 'stable-prefix' | 'narrative' | 'lower-context' | 'current-turn' | 'fresh-tail' | string

  orderIndex: number
  accepts?: string[]
  fallbackZoneId?: string

  anchors?: Array<'before' | 'inside' | 'after'>

  orderPolicy?: {
    slot: 'source-scoped' | 'fixed' | 'flat'
    slotOrder: 'rank-then-hint-then-id' | 'hint-then-source-tree'
    entryOrder: 'hint-then-source-tree' | 'source-tree-then-hint'
  }

  renderHint?: {
    wrapper?: 'section' | 'message' | 'inline'
    label?: string
    providerRoleHint?: string
  }
}
```

`path` 可以作为 UI 展示的派生值，但不应作为 canonical 引用。改名和移动不应破坏挂载。

---

### 7.5 Injection Group 候选数据结构

Injection Group 是 Skeleton 暴露给外部内容来源的挂载协议。

```ts
type InjectionGroup = {
  key: string
  displayName: string
  targetZoneKey: string
  anchor?: 'before' | 'inside' | 'after'
  accepts?: string[]
  fallbackGroupKey?: string
  description?: string
}
```

Source Adapter 产出的 fragment 可以声明：

```ts
type FragmentMountMeta = {
  injectionGroupKey: string
  anchor?: 'before' | 'inside' | 'after'
  lifecycle?: 'always' | 'conditional' | 'activeRead' | 'fresh' | 'pinned'
  sourceSlotKey?: string
  targetSlotKey?: string
  joinSlotKey?: string
  slotOrderHint?: number
  entryOrderHint?: number
  breakout?: boolean
}
```

一个 source item 可以保持自己的存储位置，同时投影到任意 injection group。

---

### 7.6 Slot 前 / 中 / 后注入

为了支持世界书与其他 slot 互相插入，每个可注入 Zone 可以暴露 anchors：

```text
before:
  在该 zone 内容之前注入。

inside:
  作为该 zone 内部 item 注入。

after:
  在该 zone 内容之后注入。
```

示例：

```text
Chat 注入位置组:
  chat.before
  chat.inside
  chat.after
```

如果某个世界书条目需要作为 chat-like 用户消息触发剧情事件，可以声明：

```text
injectionGroup: chat.inside
renderHint: user-message-like
activation: conditional
```

Provider Adapter 如果无法原样表达这种结构，应给出 capability diagnostics，而不是让 Setting Layer 或世界书绕过 Prompt Builder。

---

### 7.7 排序模型

排序分宏观和微观两层。

```text
宏观排序:
  同一个 injection group 内，先 materialize 出 slots。
  默认每个 source 在该 group 内形成一个 source-scoped dynamic slot。
  例如 GlobalWorldbook@stable.setting、CostumeWorldbook@stable.setting、PluginX@stable.setting。

微观排序:
  slot 内部按 entryOrderHint 排。
  hint 相同则按 Source Tree 的 UI / DFS 顺序托底。
```

`orderHint` 不应绑定整个世界书，而应绑定具体 mount contribution。

```text
同一本世界书可以贡献多个 dynamic slots:
  WorldbookA@stable.setting
  WorldbookA@lower.context
  WorldbookA@chat.inside
```

每个 slot 独立排序。这样世界书作者不需要把“整本书”压成一个优先级。

如果某个 source 不想和目标 source 隔离，可以显式 join 目标 slot：

```text
玄幻服装 DLC:
  injectionGroup: stable.setting
  joinSlotKey: CostumeWorldbook@stable.setting
```

join 之后，它的 entries 参与目标 slot 的内部排序；没有 join 时，它仍是自己的 source-scoped slot。
slot join 必须可追踪，并且可以被目标 source、preset policy 或用户配置拒绝、降级为独立 slot，或要求诊断提示。

---

### 7.8 动态 Slot 排序与稳定 Sort Key

ST 的 slot 是固定的，所以 slot 顺序可以直接写死在 preset 中。

Loom Studio 的 slot 会被动态 materialize：

```text
固定 skeleton slots:
  preset 作者预先声明的结构位置。

动态 source slots:
  世界书、角色卡、插件、activeRead 等 source 根据 injection group 生成的投影位置。
```

因此，排序不能依赖“全局预设里提前列出所有可能世界书”。全局 preset 只定义：

```text
- Zone / Slot 拓扑；
- injection group 到目标 zone / anchor 的映射；
- 每个 group 的默认排序策略；
- fallback policy。
```

具体激活了哪些动态 slots，由当前 session / card / worldbook / plugin source set 决定。

候选编译流程：

```text
1. 收集已激活的 fragments。
2. 根据 injectionGroupKey 解析目标 zone / anchor。
3. Materialize slots:
   - 固定 slot 直接使用 skeleton slot key。
   - 默认按 source + injection group 生成 source-scoped slot。
   - 声明 joinSlotKey 的 fragment 进入目标 slot。
4. 解析 slot order。
5. 解析 slot 内 entry order。
6. 生成 compiled prompt payload，并写 trace / diagnostics。
```

排序键分层生成：

```ts
type PromptSortKey = {
  zonePathOrder: number[]
  anchorOrder: number
  slotOrderKey: StableOrderKey
  entryOrderKey: StableOrderKey
  tieBreak: string
}

type StableOrderKey = {
  rankKey?: string
  orderHint?: number
  sourceTreePath?: number[]
  createdAt?: string
  stableId: string
}
```

`rankKey` 是 UI 拖拽写入的稳定排序键，可以是 fractional indexing / LexoRank 风格的字符串，也可以是等价的有序列表记录。
它不应是“第几个激活就排第几”的临时值。

排序优先级候选：

```text
Zone order:
  来自 skeleton zone tree。

Anchor order:
  before / inside / after。

Slot order:
  先读当前 Projection Order Profile 中的 rankKey。
  没有 rankKey 时读 source / mount contribution 的 slotOrderHint。
  仍相同则读 source tree / source registry 顺序。
  最后用 stableId 做确定性托底。

Entry order:
  先读 entryOrderHint 或 entry rankKey。
  再读 source tree DFS 顺序。
  最后用 stableId 托底。
```

这里的 Projection Order Profile 是“排序覆盖层”，不是全局 preset 本体：

```ts
type ProjectionOrderProfile = {
  id: string
  skeletonId: string
  scope: 'global' | 'project' | 'character' | 'session'
  slotRanks: Array<{
    injectionGroupKey: string
    anchor?: 'before' | 'inside' | 'after'
    slotKey: string
    rankKey: string
  }>
}
```

这样可以解决全局 preset 与局部角色卡 / 世界书隔离的问题：

```text
全局 preset:
  提供稳定的 zone / injection group。

角色卡或世界书:
  自己声明会在哪些 injection group 生成 slot。
  可以携带默认 slotOrderHint。

用户 / 项目 / 当前角色:
  在 Prompt 视图中拖拽后，写入局部 Projection Order Profile。
```

不同角色卡不会同时出现时，它们不需要在全局 preset 里争夺同一个排序值。
真的同时出现的 source，才需要在当前 Projection Order Profile 中有可比较的 rankKey；没有显式配置时，系统仍用 hint + stableId 给出确定排序，并在 Prompt 视图中可解释。

在 Loom Core 边界上，这仍然只是普通 Fragment pipeline：

```text
DataFragment:
  id / content / meta

Application meta convention:
  meta.projection.injectionGroupKey
  meta.projection.slotKey
  meta.projection.sortKey

Order Pass:
  读取 Application meta，计算 sortKey，返回排序后的 fragments。
```

Core 不理解 preset、世界书、角色卡或 slot；它只执行 pass、记录 mutation / trace / diagnostics。
排序语义属于 Studio Application 或后续 Stdlib helper，不进入 Core schema。

---

### 7.9 Breakout Injection

普通条目应挂到默认 injection group。

极少数内容可以声明 breakout：

```text
breakout:
  允许条目越过默认 source group，挂到指定 injection group。
```

但 breakout 必须受控：

```text
- 必须声明 target group。
- 必须进入 trace / diagnostics。
- Preset 可以允许、拒绝或重定向。
- UI 应能显示该条目跨界注入。
```

这避免所有作者都声明“我必须放到最靠近 user input 的位置”，重新制造 depth / z-index 内卷。

---

### 7.10 ST 预设条目映射示例

以下示例来自一个 ST 预设条目列表。它不表示 Loom Studio 要继承这些字段，只用于说明“存储分类”和“注入位置组”如何分离。

| ST 条目 | Source Tree 示例 | Injection Group 示例 | 说明 |
|---|---|---|---|
| 🛡️系统提示 | `/系统/核心` | `system.core` | 稳定系统契约 |
| 🛡️伪对话 | `/系统/示范` | `system.example` | 可能渲染为示例 / prefill |
| 📘写作指南 | `/创作/指南` | `style.guide` | 写作规则，不是世界设定 |
| 📘错误避免 | `/创作/错误避免` | `safety.anti_pattern` | 存储在创作分类，投影到反模式锚点 |
| ✅禁词表 | `/创作/禁词` | `safety.anti_pattern` | 与错误避免同组注入 |
| 🖋️轻小说 | `/文风/轻小说` | `style.pack` | 风格包，可由 Activation 控制 active / inactive |
| ⚙️NSFW强化 | `/模式/NSFW` | `mode.modifier` | 模式修饰，不应混入角色设定 |
| 🧊抗机器人 | `/反模式/反AI腔` | `safety.anti_pattern` | 反模式约束 |
| World Info (before) | Setting source tree | `setting.stable` 或作者指定 group | 旧名称只是导入 hint |
| World Info (after) | Setting source tree | `lower.context` 或作者指定 group | 不再由系统硬编码蓝灯 / 绿灯 |
| Chat History | Session / Narrative source | `narrative.history` | 剧情正文投影，不是 Agent 工作历史 |
| ➡️半转述 | `/输入处理/转述` | `current.input_transform` | 靠近当前输入 |
| 📘格式姬 | `/输出格式/格式卡` | `output.format` | 可由 skeleton / provider capability 诊断 |
| 📙大总结助手 | `/助手模式/总结` | runtime profile / helper agent | 不一定进入普通剧情 prompt |

同一个 Source Tree 下的条目可以投影到不同 injection groups；同一个 injection group 也可以接收来自 Preset、Setting、Worldbook、Plugin、Run Memo、activeRead 的 fragments。

---

### 7.11 UI 原则：资源视图与 Prompt 视图分离

Source Tree 和 Projection / Prompt order 不能在 UI 中混成一个视图。

```text
资源视图 / Source View:
  管理内容存在哪里。
  例如世界书目录：王都 / 人物 / 地点 / 事件。

Prompt 视图 / Projection Preview:
  预览内容最终投影到 prompt 的哪里。
  例如 Stable Prefix / Lower Context / Current Turn / Fresh Tail。
```

资源视图中的树状顺序不是全局 prompt 顺序。它只在以下条件下作为排序托底：

```text
同一 source-scoped slot
同一 injection group
entryOrderHint 相同
```

示例：

```text
资源视图:
  王都/
    人物/
      爱丽丝        -> injectionGroup: stable.character
    地点/
      黑塔          -> injectionGroup: lower.context
    事件/
      叛乱开始      -> injectionGroup: current.chat.before

Prompt 视图:
  Stable Prefix
    爱丽丝
  Lower Context
    黑塔
  Current Turn / before chat
    叛乱开始
```

因此 UI 应明确展示每个条目的：

```text
- 存储位置 / source path
- 注入位置组 / injection group
- 生命周期 / lifecycle
- 组内排序来源 / order hint or source tree fallback
- 动态 slot 来源 / slot key
- 排序覆盖来源 / projection order profile
```

可选 UI 模式：

```text
1. 资源视图:
   按作者目录管理内容。

2. Prompt 视图:
   按最终投影区域预览顺序。

3. 混合视图:
   在资源树里显示 injection group 徽标，并允许按投影位置临时分组。
```

这能避免作者误以为把 `/人物` 拖到 `/地点` 上方就会改变所有 prompt 区域的最终顺序。真正的最终顺序以 Prompt 视图为准。

---

## 8. 非目标

本阶段不做：

- 完整 provider request body schema；
- 完整 token budget 策略；
- 完整 ST preset 兼容；
- 把 `messages[]` 作为 Application 唯一输出；
- 把 slot / role / provider 字段加入 `@loom/core`。
