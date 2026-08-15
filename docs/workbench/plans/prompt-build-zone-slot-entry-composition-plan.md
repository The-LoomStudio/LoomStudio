# PromptBuild Zone / Slot / Entry Composition 重构计划

> **状态**：Approved Design / Implementation Pending
> **日期**：2026-08-16
> **优先级**：P1 PromptBuild Model Correction
> **范围**：将当前“所有内容必须投影到 Zone”的 Composition 模型重构为 `Zone / Slot / Entry` 三类结构节点；让 Preset 直接拥有完整主排序，让 Narrative History、Agent Session History 和当前用户输入以固定 Slot / Entry 参与同一次 Loom Core Pipeline。
> **非目标**：本计划不实现 Tool Runtime、Mode Runtime、变量系统、Token Budget、Extension Pass、Prompt Trace Inspector、流式 Provider 或多 Agent 调度。

相关文档：

- [`prompt-build-loom-core-pipeline-migration-plan.md`](prompt-build-loom-core-pipeline-migration-plan.md)
- [`preset-agent-prompt-build-module-plan.md`](preset-agent-prompt-build-module-plan.md)
- [`ui/prompt-resource-projection-workbench-v0.md`](ui/prompt-resource-projection-workbench-v0.md)
- [`../discussion/application/prompt/composition-skeleton-and-preset-v0.md`](../discussion/application/prompt/composition-skeleton-and-preset-v0.md)
- [`../../architecture/application/prompt-build/README.md`](../../architecture/application/prompt-build/README.md)

---

## 1. 问题定义

当前实现把 Composition Skeleton 定义成纯 `ZoneNode[]`，并要求每个 `PromptContribution` 的 Projection 必须包含 `zoneId`。这使所有参与 PromptBuild 的内容都必须先伪装成某个 Zone 内的 Fragment。

刚接入 Core Pipeline 的 Runtime Source 因此被映射为：

```text
Narrative Timeline  -> chat.history Zone -> narrative Slot
Agent Session       -> session.history Zone -> session Slot
Current User Input  -> chat.inside Zone -> current-input Slot
```

这条链能够生成正确 Provider Messages，但混淆了三种不同概念：

1. Zone 是 Preset 暴露给外部来源的分类与注入位置；
2. Slot 是一组外部 Entry 的宏观排序单元；
3. Entry 才是最终扁平化后参与 Prompt 的内容原子。

它还阻止 Preset 作者表达一个正常需求：在两个 Zone 或 Slot 之间直接放置自己的独立文本，例如：

```text
以上是之前的剧情历史，以下是这轮的工作记录对话。
```

这段文本不属于任何 Zone。它的位置本身就是 Preset 主排序的一部分，不应被迫声明一个虚假的注入点。

### 1.1 已确认的当前实现事实

- `CompositionSkeleton` 当前只保存 `zones`；
- `PromptProjectionCapability.zoneId` 当前必填；
- `CompiledPrompt` 当前以 `zones[] -> slots[] -> fragments[]` 为主要结构；
- Application Runtime 当前把 Narrative、Session History 和 Current Input 都转换为普通 Contribution；
- Preset Workbench 当前只把 `skeletonPatch.zones` 当作主排序结构定义；
- 空 Zone 只要存在于当前 Preset 保存的 Zone definitions 中就可以显示；
- 本地官方 Preset 缺少 `session.history`，是因为它保存了旧 Skeleton，初始化逻辑没有更新 Builtin Skeleton，并非因为尚未创建 Agent Session；
- Builtin Zone 的 `displayName` 当前直接显示英文，尚未走 Client i18n。

## 2. 核心决定

> **结构类型、内容来源和放置权限必须保持正交。**

结构层只保留三种类型：

```ts
type CompositionItem = ZoneNode | SlotNode | EntryNode
```

不再使用 `RuntimeSlotNode`、`RuntimeEntryNode` 之类的名称。`runtime`、`preset`、`setting`、`extension` 描述内容来自哪里，不描述它在 Composition 中是什么结构。

Preset 是 Agent 的完整 PromptBuild Module，因此 Preset 作者拥有主排序的最终决定权。外部来源只拥有向 Preset 已公开位置贡献内容的权利，不能自行绕过 Preset 结构。

### 2.1 Zone

Zone 是：

- Preset 内部的语义分类；
- 对 Setting、Card、Timeline、Runtime Adapter 和未来 Extension 暴露的注入点；
- 动态 Slot 的容器与排序边界；
- 空内容时仍然存在的结构节点。

Zone 自身不生成 Prompt 文本，也不等同于 Provider Message。

### 2.2 Slot

Slot 是一组外部 Entry 的集合，也是外部来源参与主排序的宏观单元。

Slot 有两种产生方式，但编译后使用同一种结构：

```text
Preset-declared fixed Slot:
  Narrative History
  Agent Session History

Zone 内动态 materialize 的 Slot:
  SettingLayerA@setting.stable
  PluginMemory@memory.active
```

固定 Slot 可以由 Preset 直接放进主排序，不必再归属某个 Zone。动态 Slot 必须通过 Zone 注入产生。

### 2.3 Entry

Entry 是最终内容原子。来源可以是：

- Preset 自身文本；
- Setting / Card 等 Prompt Resource；
- Narrative Timeline Node；
- Agent Session Message；
- 当前用户输入；
- 未来 Extension Contribution。

Preset Entry 默认仍建议投影到 Zone，以复用统一分类和排序。但 Preset 作者可以把自己的 Entry 直接放入主排序，使其完全跳出 Zone。

外部来源没有这项权限。外部 Entry 只能：

1. 经由 Zone 进入动态 Slot；或
2. 填充 Preset 已显式声明的固定 Slot / Entry Binding。

## 3. 权限与放置合同

### 3.1 Preset 作者权限

Preset 作者可以：

- 创建、删除和排序 Zone；
- 在主排序中直接放置固定 Slot；
- 在主排序中直接放置 Preset Entry；
- 声明一个由 Runtime 填充的 Entry Binding；
- 调整 Zone、Slot、Entry 的相对顺序；
- 为结构节点配置 render hint、默认 role 和 activation。

### 3.2 外部来源权限

Setting、Timeline、Agent Session 和 Extension 不能：

- 自己声明 Direct Entry；
- 自己插到两个顶层 Composition Item 之间；
- 绕过 Preset 选择任意最终顺序；
- 修改 Preset Skeleton。

它们只能向匹配的 Zone、固定 Slot 或固定 Entry Binding 提供内容。未知目标必须产生可解释 Diagnostic，而不是静默回退到任意位置。

### 3.3 Direct Entry

Direct Entry 是 Preset 主排序中的普通 `EntryNode`，不是新的内容类型。

它可以引用：

```text
Preset-owned content:
  一段承上启下的说明
  模式分隔文本
  特殊格式约束

Preset-declared binding:
  runtime.currentInput
```

外部来源不能自行把自己的 Contribution 标记成 direct。`runtime.currentInput` 能直接出现，是因为 Preset 明确声明了这个 Entry Binding，而不是 Runtime 获得了绕过 Zone 的通用权限。

## 4. 目标 Composition Schema

以下 Schema 用于约束实施方向。字段名允许在编码时按现有风格微调，但不能重新混合结构、来源与放置语义。

```ts
type CompositionSkeleton = {
  id: string
  items: CompositionItem[]
  fallbackZoneId: string
}

type CompositionItem = ZoneNode | SlotNode | EntryNode

type CompositionItemBase = {
  id: string
  orderIndex: number
  displayName: string
  activation?: PromptActivation
  renderHint?: {
    providerRoleHint?: PromptProviderRole
    wrapper?: 'section' | 'message' | 'inline'
  }
}

type ZoneNode = CompositionItemBase & {
  kind: 'zone'
  band: 'stable-prefix' | 'narrative' | 'lower-context' | 'current-turn' | 'fresh-tail'
  accepts?: PromptSourceKind[]
}

type SlotNode = CompositionItemBase & {
  kind: 'slot'
  bindingId: string
}

type EntryNode = CompositionItemBase & {
  kind: 'entry'
  source:
    | { kind: 'preset'; nodeId: string }
    | { kind: 'binding'; bindingId: string }
}
```

### 4.1 Binding ID

Binding ID 使用 namespaced stable string。首版只注册三个第一方 Binding：

```text
runtime.narrativeHistory  -> collection -> Slot
runtime.sessionHistory    -> collection -> Slot
runtime.currentInput      -> single     -> Entry
```

Binding ID 不等于 Zone ID，也不等于 Document ID。它表达“这个固定结构节点需要哪一种 Runtime 数据”。

Extension 自定义 Binding 的注册、权限和生命周期不在本轮实现；首版只验证上述第一方 Binding。

### 4.2 Prompt Resource Entry 的普通 Projection

普通 Prompt Resource Entry 继续通过 Projection Capability 注入 Zone：

```ts
type PromptProjectionCapability = {
  zoneId: string
  sourceSlotKey?: string
  joinSlotKey?: string
  slotOrderHint?: number
  entryOrderHint?: number
}
```

这里保留 `zoneId` 是正确的，因为这条合同只服务需要挂载的 Contribution。Direct Preset Entry 不走该 Projection，而由 `EntryNode.source.preset.nodeId` 直接引用。

## 5. 默认官方 Composition

官方 Preset 的默认主排序调整为：

```text
Zone   preset.system            系统预设
Zone   setting.stable           稳定设定
Slot   runtime.narrative.main   剧情历史
Zone   setting.lower            下部上下文设定
Zone   session.before           会话历史之前
Slot   runtime.session.main     会话历史
Zone   session.after            会话历史之后
Entry  runtime.current.input    当前用户输入
Zone   fresh.tail               新鲜尾部
```

默认 Preset 不需要自动添加承上启下文本，但 Preset 作者可以在任意两个 Item 之间增加 Direct Entry，例如：

```text
Slot   runtime.narrative.main
Entry  preset.transition.narrative-to-session
Slot   runtime.session.main
```

`Current Chat / chat.inside` 不再作为固定 Zone。Agent Session History 替代它承担对话历史；当前用户输入成为独立 Entry；`fresh.tail` 明确表示当前用户输入之后的内容。

### 5.1 Runtime 生命周期

```text
第 N 轮 PromptBuild:
  runtime.sessionHistory = 已持久化的旧 Agent Messages
  runtime.currentInput   = 本轮尚未持久化的用户输入

第 N 轮成功提交:
  当前输入与 Assistant 回复写入 Agent Session

第 N+1 轮 PromptBuild:
  上一轮输入与回复进入 runtime.sessionHistory
  新输入填充 runtime.currentInput
```

Current Input 必须保持独立 `user` message boundary，不能和 Session History 中最后一条 user message 合并。

## 6. Preset 与 Skeleton 的权威关系

Preset 已经被定义为 Agent 的完整 PromptBuild Module，因此目标上不再把完整结构伪装成 `ProjectionOrderProfile.skeletonPatch`。

目标边界：

```text
Preset:
  Composition Skeleton / Items
  Preset Prompt Entries
  Projection Order Profile
  linkedSettingIds
  historyPolicy

Projection Order Profile:
  只保存动态 Slot / Entry 的局部排序覆盖
  不再拥有完整 Skeleton
```

新建 Preset 时复制官方默认 Skeleton 作为初始结构。复制后该 Preset 自己拥有结构，后续官方默认变化不能静默改写用户 Preset。

## 7. Core Pipeline 迁移

本轮继续使用现有唯一 Core Pipeline，不恢复 Core 后置消息拼接。

### 7.1 Source Preparation

Core 外准备：

- Preset 自身 Entry；
- linked Settings 与 Timeline Settings 的 Zone Contributions；
- Narrative History Binding 数据；
- Agent Session History Binding 数据；
- Current Input Binding 数据；
- Activation facts 与 Order Profile。

### 7.2 `prompt.materialize`

Materialize Pass 按 Skeleton Item 顺序生成 Composition Fragment：

- Zone：保留结构身份，并收集目标 `zoneId` 的 Contributions；
- 固定 Slot：按 `bindingId` 获取外部 Entry 集合；
- Direct Preset Entry：读取被引用的 Preset Node；
- Binding Entry：按 `bindingId` 获取单个外部 Entry；
- Zone 内 Contribution：按 source / joinSlotKey materialize 动态 Slot。

空 Zone 和空固定 Slot仍保留在 Editor Projection 与 Trace 中，但 Emit 时不产生空 Provider Message。

### 7.3 `prompt.order`

排序分三层：

```text
Composition Item:
  Skeleton orderIndex

Zone 内 Slot:
  rankKey -> slotOrderHint -> source tree -> stable ID

Slot 内 Entry:
  entryOrderHint -> source order -> stable ID
```

Direct Entry 直接参与第一层排序。它不生成隐式 Slot，也不需要虚构 Zone。

### 7.4 `prompt.emit`

Emit 按最终扁平顺序读取 Entry：

- Zone 与 Slot 本身不产生正文；
- Entry 才生成 provider-neutral Message Fragment；
- Narrative History 默认使用 `developer + section`；
- Session History 保留每条 canonical Agent Message 的 role 与 message boundary；
- Current Input 使用 `user + message`；
- Direct Preset Entry 使用自身 render hint；缺少 role 时使用 Preset 明确声明的默认 role，不从相邻 Item 隐式继承；
- Provider Adapter 继续负责外部 API payload 映射。

## 8. Compiled Prompt 与 Trace 合同

当前 `CompiledPrompt.zones[]` 无法表达顶层 Slot 与 Direct Entry，需要替换为结构化顺序：

```ts
type CompiledPrompt = {
  items: CompiledCompositionItem[]
  messages: ProviderMessage[]
  editorProjection: EditorProjection
}

type CompiledCompositionItem =
  | { kind: 'zone'; id: string; slots: CompiledSlot[] }
  | { kind: 'slot'; id: string; entries: PromptFragment[] }
  | { kind: 'entry'; id: string; fragment?: PromptFragment }
```

不长期同时维护 `zones[]` 和 `items[]` 两份权威结构。迁移测试完成后删除旧 `zones[]` 消费路径。

Compact Trace 至少需要解释：

- Skeleton Item kind / id；
- Contribution 进入了哪个 Zone / Slot / Entry Binding；
- Direct Entry 的来源 Preset Node；
- 空固定 Slot 为什么没有输出；
- Current Input 为什么保持独立 Message；
- 未知 Binding、重复 single Binding 或非法 direct Contribution 的 Diagnostic。

## 9. 校验与错误边界

首版需要以下校验：

- Composition Item ID 唯一；
- `orderIndex` 可稳定排序；
- Zone ID 唯一；
- 固定 Slot 的 `bindingId` 已注册且类型为 collection；
- Binding Entry 的 `bindingId` 已注册且类型为 single；
- `runtime.currentInput` 在可调用 Agent 的 Preset 中恰好存在一次；
- 同一个 single Binding 不能被多个 Entry 消费；
- Direct Preset Entry 引用的 nodeId 必须存在且属于当前 Preset；
- 外部 Contribution 不能声明 direct placement；
- 未知 Zone / Binding fail-fast，并产生不包含正文的 Diagnostic；
- Session Tool Call / Result 继续保持当前显式拒绝，等待 Tool 合同单独实施。

`runtime.narrativeHistory` 和 `runtime.sessionHistory` 可以不存在于自定义 Preset；这表示作者明确不消费对应历史。`runtime.currentInput` 属于 Agent 调用的最低输入合同，缺失时 Preview / Invoke 必须给出明确配置错误。

## 10. Preset Workbench 与 i18n

### 10.1 主排序 UI

Preset 主排序不再只展示 Zone，而是展示完整 Composition Items：

```text
Zone:
  可折叠，显示内部动态 Slot / Entry；空时仍显示。

Slot:
  固定显示；没有 Session / Timeline 数据时显示 0 条，而不是消失。

Entry:
  直接显示正文摘要或 Binding 状态；不显示虚假的 Zone ID。
```

拖拽规则：

- Zone、固定 Slot、Direct Entry 可以在主排序顶层互相移动；
- Zone 内动态 Slot 只在 Zone 内调整；
- Slot 内 Entry 只在对应 Slot 内调整；
- Runtime Binding 的来源只读，但 Preset 作者可以移动它在主排序中的位置；
- Builtin Preset 继续只读，用户需要复制后编辑。

### 10.2 Detail Panel

详情面板按结构类型展示：

- Zone：ID、名称、Band、Accepts、默认 Render、内部 Slot 数；
- Slot：Binding、来源类型、Entry 数、Render policy；
- Entry：Preset Node 或 Binding、正文摘要、role、wrapper、Activation；
- 空 Runtime Slot：明确显示“当前没有运行时数据”，不伪装成不存在。

### 10.3 i18n

系统内置 Item 使用稳定 ID / Binding ID 映射 Client i18n：

```text
prompt.composition.presetSystem
prompt.composition.stableSetting
prompt.composition.narrativeHistory
prompt.composition.lowerSetting
prompt.composition.beforeSessionHistory
prompt.composition.sessionHistory
prompt.composition.afterSessionHistory
prompt.composition.currentInput
prompt.composition.freshTail
```

自定义 Zone、Slot、Entry 使用作者保存的 `displayName`，不要求进入宿主语言包。解析顺序为：

```text
known builtin i18n key -> authored displayName -> stable id
```

## 11. 持久化与迁移

本轮不建立新 SQL 表。Composition 仍是短小、低频修改的 Preset Prompt Resource JSON Document。

迁移原则：

1. 新 Schema 单轨写入，不长期保留新旧编译器；
2. 将旧 `skeletonPatch.zones` 机械转换为 `CompositionSkeleton.items` 中的 Zone Item；
3. 官方 Builtin Preset 是只读资源，初始化时应按 canonical content 比较并更新完整官方结构，不能只更新 `linkedSettingIds / historyPolicy`；
4. 用户 Preset 不被官方默认静默覆盖；
5. 用户旧 Preset 在迁移时保留原有 Zone 与 Entry Projection，不猜测并删除自定义 Zone；
6. 旧 Preset 缺少 `runtime.currentInput` 时，在旧 `chat.inside` 之后、`fresh.tail` 之前插入 Current Input Binding；找不到这些 ID 时插入到末尾；
7. Narrative / Session 固定 Slot 只在能够识别旧默认结构时机械插入；无法确定作者意图时保留原结构并给出配置 Diagnostic，不进行启发式内容搬运；
8. 不清理 Provider、Secret、Card、Timeline 或其他无关数据；如开发环境决定删除旧测试 Prompt Resource，实施前单独确认准确范围。

如果为简化首轮实现采用临时 legacy normalizer，必须在代码附近添加：

```text
// ponytail: legacy Zone-only Preset normalization; remove after all Prompt Resources persist CompositionItem schema.
```

## 12. 分阶段实施

### Phase 1：Schema 与默认 Preset

1. 定义 `CompositionItem = Zone | Slot | Entry`；
2. 将完整 Skeleton 从 `ProjectionOrderProfile.skeletonPatch` 移回 Preset 权威内容；
3. 定义三个第一方 Runtime Binding；
4. 更新官方默认 Composition；
5. 修复 Builtin 初始化，使旧官方 Preset 能更新到 canonical 结构；
6. 增加 Schema validation 与 legacy normalization。

验证检查点：无 Session 和 Timeline 时，官方 Preset 仍能解析出空 Narrative Slot、空 Session Slot 和 Current Input Entry；旧官方 Preset 不会继续缺少新结构。

### Phase 2：Core Pipeline

1. Source Preparation 改为提供 Zone Contributions 与 Binding 数据；
2. `prompt.materialize` 支持三种 Composition Item；
3. `prompt.order` 支持顶层 Item、Zone Slot、Slot Entry 三层排序；
4. `prompt.emit` 只从 Entry 生成 Message Fragment；
5. 删除 Narrative / Session / Current Input 的伪 Zone Projection；
6. 保持 Preview / Invoke 共用唯一 Pipeline。

验证检查点：不存在 Core 后置消息拼接；Provider Messages 顺序与目标默认结构一致；Current Input 独立成 user message。

### Phase 3：Compiled Contract 与 Workbench

1. 用 `CompiledPrompt.items` 替代仅能表达 Zone 的 `zones`；
2. 更新 RPC / Client entity；
3. Projection Runlist 改为 Composition Item Runlist；
4. 空固定 Slot 始终显示；
5. Direct Entry 可创建、编辑、删除和拖拽；
6. Runtime Binding Entry 可移动但来源只读；
7. 补 Builtin i18n 与自定义名称 fallback。

验证检查点：用户能从主排序直接看见 Zone、Narrative Slot、Session Slot、Current Input Entry；没有 Agent Session 时 Slot count 为 0，而不是整行消失。

### Phase 4：清理与文档晋升

1. 删除 `promptZoneIds.narrativeHistory / sessionHistory / currentTurn` 等伪 Zone 常量；
2. 删除旧 `promptSlotIds.currentInput@chat.inside` 合同；
3. 删除 Client 硬编码 `readZoneOrder()` 中的旧 Chat Zone 顺序；
4. 删除旧 `CompiledPrompt.zones` 消费；
5. 更新 PromptBuild Architecture、Reference 与默认资源说明；
6. 更新旧计划状态和 Workbench UI 计划中的实现偏差。

验证检查点：正式 Architecture 只描述新结构；仓库中不存在把 Narrative History、Session History 或 Current Input 定义成 Zone 的活跃代码与文档。

## 13. 最小文件边界

预计后端主要涉及：

```text
packages/application-runtime/src/
  prompt-builder.ts
  prompt-build-pipeline.ts
  agent-turn.ts
  prompt-resource-defaults.ts
  workspace.ts
  runtime.ts
  types.ts
  index.ts
```

预计前端主要涉及：

```text
apps/studio-client/src/
  entities/context-asset.ts
  entities/prompt.ts
  features/context-assets/model/projection-order.ts
  features/context-assets/model/projection-workbench.ts
  features/context-assets/ui/projection-runlist/
  widgets/preset-workbench/
  shared/i18n/en-us.ts
  shared/i18n/zh-cn.ts
```

相关测试：

```text
tests/unit/application-runtime/prompt-build-pipeline.test.ts
tests/integration/application-runtime/agent-session.test.ts
tests/unit/client/context-assets.test.ts
apps/studio-client/src/features/context-assets/model/projection-order.test.ts
tests/unit/client/prompt-build-steps.test.ts
```

实施时不得借此重构无关 Prompt Resource Tree、Provider、Narrative Store、Agent Store 或 Studio 页面布局。

## 14. 验证矩阵

### Schema 与权限

- Zone / Slot / Entry ID 唯一；
- Preset Direct Entry 无 `zoneId` 仍可编译；
- 外部 Contribution 尝试 direct 时失败；
- Current Input Binding 缺失、重复时失败；
- 未知 Slot / Entry Binding 产生 Diagnostic；
- 自定义 Preset 可以不消费 Narrative / Session History。

### 编译顺序

- Zone -> Direct Entry -> Zone；
- Narrative Slot -> transition Entry -> Session Slot；
- Session Slot -> Current Input Entry -> Fresh Tail Zone；
- 空 Slot 不生成空 Message；
- Zone 内多个动态 Slot 稳定排序；
- Session History 保留 user / assistant message boundary；
- Current Input 不与最后一条 user history 合并。

### UI

- 空 Narrative / Session Slot 可见；
- Direct Entry 可显示、选择和拖拽；
- Runtime Binding Entry 显示来源且正文只读；
- Builtin 名称中文/英文切换正确；
- 自定义 displayName 不被语言包覆盖；
- 旧官方 Preset 重启后显示新结构。

### 回归

- Preset + linked Settings；
- Timeline Settings 去重；
- Activation active / inactive；
- Preview / Invoke 结果一致；
- Provider failure 不留下半轮；
- Core Trace 不包含 Secret 或完整 Provider request。

## 15. 完成标准

以下条件全部满足后，本计划可以标记 Complete：

1. Composition Skeleton 能在同一主排序中表达 Zone、固定 Slot 和 Direct Entry；
2. Preset Entry 可以不声明 Zone 并直接参与最终排序；
3. 外部来源不能绕过 Preset 自行创建 Direct Entry；
4. Narrative History 是固定 Slot，不是 Zone；
5. Agent Session History 是固定 Slot，不是 Zone；
6. Current User Input 是固定 Entry Binding，不是 Zone 或 Slot；
7. Current Input 在下一轮自然进入 Session History；
8. 空固定 Slot 在 Workbench 中仍然可见；
9. Builtin Composition 名称经过 i18n，自定义名称保持作者文本；
10. PromptBuild 继续只执行一次 Loom Core Pipeline；
11. `CompiledPrompt` 与 Trace 能解释三种结构和来源；
12. 旧 Zone-only 权威合同和 Client 硬编码顺序已经清理；
13. Architecture 与实现一致。

## 16. 明确延期

以下能力不因本轮结构重构提前实现：

- Tool Call / Result 进入 Session Slot；
- 多模态 Entry；
- Extension 自定义 Binding；
- Zone / Slot / Entry 的复杂继承和模板系统；
- 多级嵌套 Composition Tree；
- 自动 Provider Token Budget；
- Prompt Cache 与 Incremental Build；
- 任意脚本修改 Skeleton；
- Client Prompt Trace Inspector。

首版保持一层顶级 Composition Item、Zone 内 Slot、Slot 内 Entry 的三层结构。只有真实用例证明不足时，才讨论更深层嵌套。
