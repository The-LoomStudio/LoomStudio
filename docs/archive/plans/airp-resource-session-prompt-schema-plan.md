# AIRP 资源、Session 与 Prompt Schema 演进计划

> **状态**：Historical / Superseded
> **目的**：统一记录 Card/Resource、Session/Branch 与 PromptBuild Zone 三组已经互相牵制的数据模型调整，并给出渐进实施与验证顺序。
> **当前阶段**：只收束目标模型和迁移边界；本文不是已实现 Architecture，也不批准立即进行大规模代码重写。
> **2026-07-29 替代说明**：本文中的 Zone Schema 历史与已完成阶段继续保留；Card、PromptWorkspace、Session Resource 关系及后续工程实施已由 [`card-resource-manifest-migration-plan.md`](card-resource-manifest-migration-plan.md) 替代。后续不得再从本文恢复 eager fork、Resource Mount 或 Workspace 运行主链。
> **2026-08-15 数据与路径说明**：本文中的通用 Session 主链已被独立 Narrative Timeline 与 Agent Session 模型替代。当前 `promptResourceIds` 保存于 Narrative Timeline，Branch 只保存 Narrative head 与 fork 来源；未来 Branch State / Resource revision 不在本文恢复设计。Asset Store 的物理字节层、原始 JSON / PNG 保留和统一本地路径见 [`local-data-blob-store-foundation-plan.md`](local-data-blob-store-foundation-plan.md)。
>
> **相关讨论**：
> - [`../discussion/application/card-model-v0.md`](../discussion/application/card-model-v0.md)
> - [`../discussion/application/asset-import-export-boundary-v0.md`](../discussion/application/asset-import-export-boundary-v0.md)
> - [`../discussion/application/isolation-scope-boundary-v0.md`](../discussion/application/isolation-scope-boundary-v0.md)
> - [`../discussion/application/state-store-v0.md`](../discussion/application/state-store-v0.md)
> - [`../discussion/application/prompt/multi-party-contribution-walkthrough-v0.md`](../discussion/application/prompt/multi-party-contribution-walkthrough-v0.md)
> - [`../discussion/application/prompt/composition-skeleton-and-preset-v0.md`](../discussion/application/prompt/composition-skeleton-and-preset-v0.md)
> - [`../adr/ADR-001-data-layer-workspace-sync.md`](../adr/ADR-001-data-layer-workspace-sync.md)
> - [`../adr/ADR-003-asset-store-and-binary-payload-boundary.md`](../adr/ADR-003-asset-store-and-binary-payload-boundary.md)

---

## 0. 当前收束结论

本轮数据模型调整由一条连续链路组成，不能拆成互不相关的三个重构：

```text
自包含 Bundle / Card Package
  -> 导入为平铺、按稳定 ID 寻址的独立资源
  -> Card 通过 Prompt Workspace 保存启动资源集合
  -> Session 直接链接 Card 的 Prompt Workspace，不复制 Prompt Resources
  -> 开发编辑直接修改平铺 Resource Documents
  -> PromptBuild 从 Workspace Resource IDs 构造 Source Set
  -> Source Contribution 直接声明标准 Zone ID
  -> Zone / Block / Entry 确定性编译为最终 Prompt
```

当前已经基本收束的方向：

1. **存储层平铺，Bundle 只作为对外分发和导入边界。**
2. **Card 是 recipe / manifest，不是 Setting Layer、Preset、Session 的强所有者。**
3. **当前 Session 只链接 Card 的 Prompt Workspace 与平铺资源集合，不创建 Session 专属 Prompt Resource 实例。**
4. **当前资源编辑属于开发编辑，直接修改 Resource Document；运行时变量、Setting Diff 与世界线隔离留到变量系统阶段讨论。**
5. **State 与 Setting 概念上分开；当前尚未冻结 State 的持久化和 PromptBuild 消费模型。**
6. **Narrative Entry 继续使用 append-only parent tree；运行时 State 与 Resource 是否随 Branch 回退暂不实施。**
7. **Zone 同时是公开挂载接口、宏观排序单位和 Prompt UI 显示单位；删除独立 Injection Group 层。**
8. **默认 Preset 提供一套功能完整、生态可共同依赖的标准 Zone 词汇；自定义生态使用 namespaced Zone 扩展。**
9. **Prompt 的内容冲突决议与最终投影排序是两套规则，不能压成一条来源优先级。**
10. **二进制按 hash 存入 Asset Store；可执行脚本属于 Extension 安全边界。**

仍待拍板的实现选择：

- 全局 Resource、Card 推荐 Resource 与用户手动挂载 Resource 的解析顺序；
- 运行时变量和低频 Setting 变化的权威数据边界；
- State 使用每回合完整 Snapshot，还是 Event + 周期性物化 Checkpoint；
- Prompt 冲突决议的最小字段与缺省行为；
- 未知 Zone 采用 fallback 还是 isolate。

本文暂不接受以下扩展：

- Session Overlay 的 lazy copy-on-write；
- JSON Patch Overlay 与三方合并；
- 在 State 持久化方案拍板前直接实施 Event Sourcing 或 Replay 引擎；
- Promote / Refresh 的完整产品流程；
- Asset GC；
- 自动安装或自动执行 Card 携带的 Extension；
- 通用 Resource Resolver Registry；
- 实时多人协作。

---

## 1. 为什么必须放在同一个 Plan 中

Card/Resource、Session/Branch 和 PromptBuild Schema 之间存在直接依赖：

```text
资源没有独立身份
  -> Card 无法声明多个可复用输入
  -> Bundle 无法完整收集依赖
  -> PromptBuild 无法解释 Source 来自哪里

Card 没有稳定 Prompt Workspace 引用
  -> 创建 Session 时必须由调用方额外猜测 workspaceId
  -> 只点击 Card 无法保证加载全部 Prompt Resources

Zone 接口不稳定
  -> Card、世界书、Preset 和插件无法共同创作
  -> 换 Preset 后 Source Contribution 大量悬空
```

因此，本计划不把它们拆成三个互不协调的局部 Schema 任务。实现仍可分阶段，但验收必须以完整数据链为准。

---

## 2. 当前实现基线

以下是计划编写时已经由代码证明的当前事实，不代表目标模型：

### 2.1 Card 与 Workspace

- `CardSourceContent` 类型仍保留 `preset`、`opening` 和 `settingLayer`，用于 `createCard` 的 M0 简单卡路径；
- Bundle / Workspace import 已将顶层 `contextAssets` 拆成独立 `airp.promptResource` Documents；
- 导入生成的 Card 不再保存权威 `preset` / `settingLayer` 内容，只保留展示信息与 opening；
- `PromptWorkspaceContent.resourceIds` 保存当前 workspace 的 prompt resource 顺序；
- `PromptWorkspaceContent.contextAssets` 暂时作为现有 UI 的镜像视图保留，PromptBuild 与 export 优先从 `airp.promptResource` 读取；
- Bundle import 生成的 Card 通过 `promptWorkspaceId` 指向该资源集合；
- `bindings` 已指向被 Card 推荐的 `airp.promptResource` 文档；
- `applicationDocumentTypes` 尚无独立 `settingLayer`、`compositionSkeleton`、`stateSchema`、`resourceMount` 或一等 `importBundle` Document。

### 2.2 Session、Narrative 与 State

- `NarrativeEntryContent.parentEntryId` 与 `NarrativeBranchContent.headEntryId` 已形成 append-only 消息树；
- `forkBranch` 已允许从指定 Narrative Entry 创建分支；
- `submitTurn` 已在一次 Document transaction 中写入 Narrative Entry、Commit Candidate、Branch State Snapshot、Branch Head 与 Run；
- `BranchStateSnapshotContent` 已存在，但目前只保存空 `patch`，尚无真正 State Store 或 Resource Head；
- `createSessionFromCard` 会优先采用调用方显式 `workspaceId`，否则继承 Card 的 `promptWorkspaceId`；Session 不复制 Prompt Resources。

### 2.3 PromptBuild

当前编译模型使用：

```text
Source Contribution
  -> zoneId
  -> Zone
  -> dynamic Slot
  -> Fragment
```

现有 PromptBuilder 已实现：

- Activation；
- Zone order；
- Projection Order rank；
- `slotOrderHint`；
- Source Tree fallback；
- `entryOrderHint`；
- stable ID tie-break；
- Editor Projection 与基础 explainability。

因此，后续不是重做整个 PromptBuilder，而是继续收束跨 Mount 顺序和冲突语义。

---

## 3. 术语与数据边界

为避免“资产”一词继续混合所有对象，后续讨论使用以下术语：

| 术语 | 含义 | 默认存储 |
|---|---|---|
| Resource | Setting Layer、Preset、Prompt 内容、State Schema 等结构化可编辑内容 | SQL Document / Dev Workspace Files |
| State | 好感度、HP、背包、Flag 等 Session 高频运行值 | Session/Branch State Document |
| Asset | 图片、音频、视频、原始 PNG、缩略图等二进制 | Asset Store |
| Extension | JS、Manifest、Client/Server Bundle 等可执行能力 | Extension Store + SQL 安装元数据 |
| Artifact / Bundle | 导入、导出、分享、备份和重置使用的自包含分发格式 | Artifact / Asset Store |
| Card | 可分发、可启动的内容 recipe / manifest | SQL Document + Bundle manifest |
| Session | 一次运行、游玩或对话实例 | SQL Documents |
| Branch | Narrative、State 与可变 Resource 演进的最小隔离边界 | SQL Documents / revisions |

必须保持：

```text
内部真理：平铺资源池 + 稳定 ID 引用。
外部协议：一个自包含 Bundle，用户拿到即可导入和游玩。
```

内部平铺结构不得泄漏为“分享一张 Card 需要用户手动收集十几个文件”的产品体验。

---

## 4. Card、Bundle 与平铺 Resource Pool

### 4.1 Card 的目标定位

Card 不再作为 Prompt-facing 内容的基础容器。目标 Card 更接近：

```text
Card Manifest
  metadata / readme / author / tags
  avatar / cover / media refs
  opening / startup candidates
  recommended resource refs
  default state schema refs
  runtime / model / preset hints
  extension dependency declarations
  source artifact / import bundle provenance
```

Card 可以随包携带专用 Setting Layer 或 Preset，但导入后这些内容成为独立 Resource Document。Card 只保留推荐引用，不形成强所有权。

Card 与 Session 的关系是创建来源而不是生命周期所有权：

```text
Session.createdFromCardId
Session.launch snapshot / branch resource copies
```

删除、升级或重新导入 Card 不得静默改变已有 Session，也不得默认级联删除已有 Session。

### 4.2 独立结构化资源

第一阶段候选资源类型：

```text
airp.settingLayer
airp.compositionSkeleton
airp.stateSchema
airp.promptResource       // 是否需要独立于前两者，实施前再验证
airp.cardManifest
```

当前不要求每一个 Setting Entry 都成为独立 Document。M0 优先使用“一个 Setting Layer 一个聚合 Document”，直到大型资源的真实性能数据证明需要分片。

### 4.3 资源身份、名称与去重

硬规则：

- Document ID 是稳定身份；
- display name 可以重复；
- 文件名和展示名不得作为主键；
- 导入两份同名资源时允许同时存在；
- 结构化可编辑 Resource 默认不因内容 hash 相同而共享逻辑 Document；
- 只有明确声明同一个 package/resource identity 时才复用同一逻辑资源。

二进制 Blob 可以按 `sha256` 去重。结构化 Resource 即使内容完全相同，也应默认拥有独立 ID，防止编辑其中一份时意外污染另一张 Card。

### 4.4 Import Bundle 与 Round-trip

Import Bundle 记录一次导入创建的 Card、Resources、Assets 与依赖，但不表达永久所有权。

兼容外部生态时必须保留：

```text
format
rawArtifactAssetId
unknown fields / opaque compatibility payload
source mapping
```

同格式导出优先采用：

```text
clone 原始 payload
  -> 用当前 canonical 数据覆盖已知字段
  -> 保留未识别字段
  -> 输出并报告无法保真的 diagnostics
```

未知字段不进入 PromptBuild，也不得因为被原样保留而获得执行权限。

### 4.5 Binary Asset 与 Extension

二进制字节不进入普通 JSON Document：

```text
Asset Store:
  bytes / thumbnails / derived files / hashes

Document Store:
  assetId / mime / size / dimensions / ownership refs / revisions
```

脚本和 Extension Bundle 属于可执行代码边界：

```text
Extension Store:
  manifest.json + versioned JS bundles

Document Store:
  installed version / enabled state / permissions / approval / Card refs
```

Card 可以声明或携带 Extension dependency，但不得在导入后自动安装、启用或执行。

---

## 5. Session、Branch 与当前资源链接

### 5.1 当前 M0 边界

当前不为 Session 或 Branch 创建 Prompt Resource 副本，也不建设 Resource Mount、Diff、Overlay 或 copy-on-write：

```text
Card.promptWorkspaceId
  -> Session.workspaceId
  -> PromptWorkspace.resourceIds
  -> PromptBuild 读取当前 Prompt Resource Documents
```

Bundle import 创建 Card 时写入 `promptWorkspaceId`。`createSessionFromCard` 在调用方未显式指定 Workspace 时自动继承该引用。因此只点击 Card 即可启动包含多个 Setting / Preset Resource 的 Prompt Workspace。

当前 Prompt Resource 编辑 API 直接修改平铺 Document。这是明确的开发编辑语义，修改会被所有链接该 Workspace 的 Session 看到；当前版本不提供运行时隔离保证。

### 5.2 Card 多资源与自包含 Bundle

Card 不区分嵌套的“主世界书 / 子世界书”所有权。一个 Prompt Workspace 可以按顺序引用多个平铺 Resource：

```text
Card
  -> Prompt Workspace
      -> Character Setting
      -> World Setting
      -> Community Clothing Setting
      -> Preset recommendation
```

PromptBuild 按 `resourceIds` 读取全部 Resource；Bundle export 将这些 Resource 根节点重新收集进自包含 Artifact。外部 Registry、网络下载、版本求解和传递依赖不属于当前阶段。

### 5.3 运行时变化延期

变量、角色动态状态、低频 Setting 变化、世界线 Fork 与 Reset 语义必须在变量系统和真实运行需求出现后一起设计。当前不提前增加 Session Working Resource、State Diff 或 Branch Resource revision map。

### 5.4 Narrative 与 accepted turn

Narrative Entry 继续采用 append-only parent tree：

```text
NarrativeEntry.parentEntryId
NarrativeBranch.headEntryId
```

State 不绑定某一条普通 Message 的独立 Event Log，而绑定一次 accepted turn 的原子提交：

```text
Accepted Turn Changeset
  user Narrative Entry
  assistant Narrative Entry / accepted output
  State authority update
  changed Resource revisions
  Branch head update
  Run completion
```

当前不新增 TurnCommit Document。Document Store changeset 继续承担原子操作和审计锚点；只有在 changeset 无法满足业务查询时才讨论一等 Turn Commit。

### 5.5 State Snapshot 与 Event Replay 的待决选择

当前有两条可行路线：

#### 路线 A：每个 accepted turn 保存完整 State Snapshot

- 恢复逻辑最短；
- 回退与 fork 不需要 replay；
- 适合当前 State 规模未知、单机存储成本较低的阶段。

#### 路线 B：State Event + 周期性物化 Checkpoint

- 状态变化事件是恢复链的一部分；
- 从最近 Checkpoint replay 到目标 Narrative Entry；
- 更节省重复存储，但会引入事件兼容、replay 正确性和 checkpoint 策略。

当前工程建议优先评估路线 A，因为它更符合 M0 的 KISS 边界；但这不是已经由讨论拍板的结论。无论选择哪条路线，上层必须提供相同语义：

```text
resolveState(branchId, headEntryId)
  -> 返回该 Branch Head 对应的确定 State
```

Runtime / Tool 的 Transcript、Trace 或 Audit 事件也不能在方案拍板前被默认视为 canonical State source。

---

## 6. PromptBuild：Zone 作为唯一公开挂载接口

### 6.1 删除 Injection Group 中间层

当前实现状态（2026-07-28）：

- PromptBuild 编译模型已经使用 `zoneId` 作为唯一公开挂载接口；
- `InjectionGroup`、`Zone.key`、`targetZoneKey` 与 PromptBuild `anchor` 已从当前 runtime/client/server schema 中移除；
- 默认 Zone 暂时沿用原 injection group ID：`preset.system`、`setting.stable`、`chat.history`、`setting.lower`、`chat.before`、`chat.inside`、`chat.after`、`fresh.tail`；
- `ProjectionOrderProfile.slotRanks` 已改为按 `zoneId + slotKey` 寻址；
- 未知 Zone 当前仍是 hard error；fallback / diagnostic 语义尚未拍板。

目标编译链路：

```text
Source Contribution
  -> zoneId
  -> Zone
  -> source-scoped Block / Slot
  -> Entry / Fragment
  -> compiled prompt
```

删除：

```text
Zone.key
InjectionGroup
InjectionGroup.targetZoneKey
InjectionGroup.anchor
PromptProjectionCapability.injectionGroupKey
```

改为：

```ts
type PromptProjectionCapability = {
  zoneId: string
  sourceSlotKey?: string
  joinSlotKey?: string
  slotOrderHint?: number
  entryOrderHint?: number
}
```

Zone 的 `id` 同时承担：

- 公开稳定接口；
- Source Contribution 的挂载目标；
- Prompt UI 的结构标识；
- Projection Order 的作用目标；
- Trace / Diagnostic 的解释引用。

`displayName` 只负责用户可见名称，可以本地化或由生态作者自由命名，不参与稳定寻址。

### 6.2 Zone 候选最小模型

```ts
type PromptZone = {
  id: string
  displayName: string
  orderIndex: number
  band: 'stable-prefix' | 'narrative' | 'lower-context' | 'current-turn' | 'fresh-tail' | string
  accepts?: PromptSourceKind[]
  renderHint: {
    providerRoleHint: PromptProviderRole
    wrapper: 'section' | 'message'
  }
}
```

`before / inside / after` 不再作为隐藏 anchor。需要独立位置时直接定义相邻 Zone：

```text
chat.before
chat.inside
chat.after
```

这让 Prompt 视图、外部接口和真实顺序保持一致。

### 6.3 标准 Zone 词汇与自定义生态

Loom Studio 默认 Preset 必须提供一套功能完整、可共同创作的标准 Zone 清单。标准化的是接口 ID，不是展示语言，也不是固定版式。

第一版候选词汇至少覆盖：

```text
system.core
style.guide
setting.stable
chat.history
chat.before
chat.inside
chat.after
tail.context
tail.behavior
tail.format
tail.event
```

最终清单与内部顺序仍需单独拍板，本文不把候选列表提前晋升为正式规范。

Preset 作者可以：

- 自由调整标准 Zone 的顺序；
- 修改显示名称；
- 修改 render hint 与 provider role；
- 显式声明不支持某个标准 Zone；
- 增加 namespaced custom Zone，例如 `author.example.memory.echo`；
- 围绕自定义 Zone 形成独立生态。

Preset 作者不应：

- 静默把标准 Zone 改成私有别名；
- 依赖 display name 寻址；
- 让外部资源必须知道当前 Preset 的第 N 个条目或内部路径。

默认 Preset 是标准 Zone 词汇的完整参考实现。开放生态可以扩展词汇，但不能退回完全无协议的野蛮锚点命名。

### 6.4 Zone / Block / Entry

Prompt 视图采用三层结构：

```text
Zone
  Preset 原生 Entry
  Source Block
    external Entries
```

- Zone 是宏观分类、接口和显示单位；
- Source Block 是外部来源的隔离、排序和出处单位；
- Entry / Fragment 是最终内容原子；
- Preset 原生内容可以直接位于 Zone；
- Setting Layer、Card Resource、Plugin、Run Memo 等外部来源必须以 Source Block 进入；
- 同一个 Resource 可以在多个 Zone 中形成不同 Source Block；
- Source Block 内暂不允许继续嵌套 Block。

### 6.5 未知 Zone 的失败语义

最终默认仍需拍板。当前建议：

```text
Authoring / Dry Run:
  产生 error diagnostic，Preview 继续，并明确显示未解析 contribution。

Runtime default:
  降级到 fallback Zone，同时记录 warning 和原始 zoneId。

Strict mode:
  可配置为 PromptBuild hard error。
```

禁止静默丢弃未知 Zone，也禁止未经 Trace 直接改写到其他 Zone。

---

## 7. Prompt Resolution Contract

### 7.1 内容冲突与投影顺序必须分离

以下是两个不同问题：

```text
Conflict Resolution:
  多个来源是否在表达同一个可替换语义，谁胜出？

Projection Order:
  已经保留的内容最终放到哪个 Zone、Block 和位置？
```

不能建立简单的：

```text
Preset > Card > Setting > Runtime
```

因为 Preset 主要定义结构，Setting 与 State 主要贡献内容，它们不总是在同一维度竞争。

### 7.2 冲突只由显式语义键触发

默认情况下，两条内容即使 display name、文件名或 path 相同，也不自动互相覆盖。

只有显式声明相同的下列目标时，才进入 Resolution：

```text
bindingKey
replaceKey
semanticSlotKey
state namespace key
```

候选 specificity：

```text
Step / Run temporary
  > Branch / Session
  > Card package recommendation
  > Workspace / Global
  > Built-in fallback
```

同一 scope 内继续比较：

```text
explicit priority
  > PromptWorkspace resource order
  > stable ID
```

具体字段与 merge / append / replace / single 求值语义需在实现 Resolution M0 前单独形成短规格。

### 7.3 投影排序

候选确定性顺序：

```text
Zone:
  Zone.orderIndex

Block / Slot:
  explicit ProjectionOrder rank
  -> slotOrderHint
  -> PromptWorkspace resource order
  -> stable block / slot ID

Entry / Fragment:
  entryOrderHint
  -> Source Tree order
  -> stable fragment ID
```

每个最终 Fragment 必须能够解释：

- 为什么可见；
- 为什么 active / inactive；
- 是否参与过 conflict resolution；
- 为什么进入该 Zone；
- 来自哪个 Prompt Resource；
- 为什么处于当前 Block 和 Entry 顺序。

---

## 8. Resource Explorer 的数据视角

资产视图不拥有数据。后续同一个 Resource Explorer 可以提供不同 Lens：

```text
Library Lens:
  Workspace 中安装和创作的基础 Resources。

Card Lens:
  当前 Card 携带、推荐和声明的 Resources / Assets / dependencies。

Session / Branch Lens:
  当前 Branch 实际使用的 forked Resources、State 与 Source Blocks。
```

M0 只要求数据 API 能区分这些来源，不要求立即完成完整三 Lens UI。

编辑目标必须明确显示：

```text
Base Resource
Branch Resource Copy
Runtime State
```

当前版本只提供开发编辑，直接写入平铺 Resource Document。Play Mode 的变量、运行时 Setting 变化和隔离写入尚未设计。

---

## 9. 分阶段实施顺序

### Phase 0：契约与 Fixture 收束

目标：在改代码前冻结最小词汇和验收样本。

任务：

1. 拍板标准 Zone M0 清单；
2. 拍板未知 Zone 默认行为；
3. 拍板全局 Resource、Card Resource 与用户手动挂载 Resource 的解析顺序；
4. 将官方教程定义为唯一 Reference Bundle / Workspace fixture；
5. 明确哪些当前字段是 legacy compatibility，而不是目标模型。

验证：同一份教程 Bundle 可以描述 Card、Setting Layer、Preset、State Schema、Asset refs 与标准 Zone contribution。

### Phase 1：Zone Schema 合并

状态：已完成当前 M0 代码迁移，后续只剩标准 Zone 词汇与未知 Zone 失败语义需要另行拍板。

目标：先完成独立、可验证的纯编译模型迁移。

任务：

1. `injectionGroupKey -> zoneId`；
2. 删除 `InjectionGroup`；
3. 删除 `Zone.key`，统一使用 `Zone.id`；
4. 将 anchor 展开为独立 Zone；
5. `ProjectionOrderProfile` 改为按 `zoneId + slotKey` 寻址；
6. 更新 Prompt Projection、Trace、fixtures、client types 与 tests；
7. 不保留长期双 Schema 兼容层；必要时只提供一次性 Artifact migration。

验证：旧参考场景在新 Zone Schema 下产生等价 Prompt；未知 Zone 有明确 diagnostics。

### Phase 2：独立 Resource Documents 与 Bundle Import

状态：Phase 2A 与当前多资源直链已完成。当前已新增 `airp.promptResource`，Bundle import 会在同一 transaction 中创建 Card、Prompt Workspace 与顶层 Prompt Resource documents；Card 通过 `promptWorkspaceId` 指向资源集合；`createSessionFromCard` 自动继承该 Workspace；PromptBuild、编辑 API 与 export 已优先读写 resource docs。`contextAssets` 仍作为前端 UI 镜像保留。

目标：让 Card 从聚合 Prompt 容器转为 recipe / manifest。

任务：

1. 增加独立 Setting Layer、Composition Skeleton、State Schema Document；
2. 让 Bundle import 在一个 transaction 中创建 Card、Resources 与 Import Bundle；
3. Card 保存推荐引用，不内嵌权威 Resource 内容；
4. 保留 raw Artifact 与 unknown fields round-trip 数据；
5. 结构化 Resource 使用独立 ID；二进制走 Asset Store 引用；
6. Prompt Workspace 逐步转为作者工作区和 Resource 引用集合。

验证：同一个 Setting Layer 可以被多张 Card 推荐；删除 Card 不删除共享 Resource；Bundle 导出仍自包含。

### Phase 3：变量与运行时资源变化（延期）

目标：在变量系统需求明确后，再决定 State、低频 Setting 变化与世界线隔离的最小边界。

当前不实施 Session / Branch Prompt Resource 副本、Resource Mount、Diff Overlay 或世界线资源 Fork。开发编辑继续直接修改平铺 Resource Documents。

验证条件尚未冻结；进入本阶段前必须先有真实变量 Schema、PromptBuild 消费场景和运行时修改需求。

### Phase 4：官方教程纵向闭环

目标：用真实内容验证前述数据链和编辑体验。

```text
安装 Tutorial Bundle
  -> 查看平铺 Resources
  -> Card 启动 Session
  -> 自动链接 Card Prompt Workspace
  -> 读取多个 Setting / Preset Resources
  -> Dry Run 查看 Zone / Block / Entry 投影
  -> 正式提交一回合
  -> 导出自包含 Bundle
```

验证：前端不再依赖独立巨型 DemoData 作为另一份事实源；产品样本、导入导出和集成测试共享同一 canonical Bundle。

---

## 10. API 影响范围

具体 RPC 名称在实施阶段再定，本计划只记录必要能力：

### Resource / Card

- import / export self-contained Bundle；
- CRUD Setting Layer / Composition Skeleton / State Schema；
- list / get Card recommendations；
- list Resources by stable ID/type；
- round-trip compatibility diagnostics。

### Session / Branch

- create Session from resolved Card recipe；
- list current linked Prompt Resources；
- fork Branch from Narrative Entry；
- atomically commit accepted turn。

State Mutation、运行时 Setting 修改与 Resource Fork API 延期到变量系统阶段。

### PromptBuild

- compose from Branch Source Set；
- target `zoneId` directly；
- return Zone / Block / Entry projection；
- expose deterministic order reason；
- expose conflict and fallback diagnostics。

当前不增加通用 `batchEverything()` 或跨领域 Command Bus。一个 accepted turn 或一次 Bundle import 需要多 Document 原子性时，继续显式使用 Application use case + Document transaction。

---

## 11. 验证矩阵

### Resource / Bundle

- 两份同名 Setting Layer 可同时导入；
- 两份完全相同内容的 Setting Layer 默认仍有不同 Document ID；
- 相同二进制 hash 复用同一 Blob；
- Card 删除不级联删除 Resources 或 Session；
- 同格式导入再导出保留 unknown fields；
- 导出 Bundle 包含所有必要 Resource 与 Asset 引用；
- Card 携带 Extension 时不会自动执行。

### Session / Branch

- Session 创建后修改资源库不改变当前 Prompt；
- 两个 Session 的 State 与 Setting 演进互不影响；
- Branch 从旧 Entry fork 后读取当时 Resource revision；
- reroll 时 Narrative、State、Resource Head 一起恢复；
- accepted turn 中任一写入失败时 transaction 全部回滚；
- 重启 Server 后 Session forked Resources 与 State 仍存在。

### PromptBuild

- Source Contribution 仅通过 `zoneId` 定位；
- Zone display name 修改不破坏引用；
- 标准 Zone 在默认 Preset 中全部可解析；
- custom namespaced Zone 可被自定义 Preset 使用；
- 未知 Zone 不静默丢失；
- Zone、Block、Entry 顺序在重复 build 中完全确定；
- 同名/path 内容默认不会互相覆盖；
- 显式相同 semantic key 才触发 Resolution；
- Projection UI 可以解释最终位置和排序来源。

---

## 12. 非目标与升级触发条件

### 12.1 Session Resource isolation

当前 Session 直接链接 Card Prompt Workspace，不创建 Prompt Resource 运行副本。只有在变量系统或真实游玩场景证明需要运行时 Setting 修改时，才重新比较 State、完整 Working Document、Diff 或 copy-on-write；当前不预留其中任何一种实现。

### 12.2 State 持久化升级边界

Phase 0 必须先在“完整 State Snapshot”和“State Event + 周期性物化 Checkpoint”之间做出 M0 选择。若先采用 Snapshot，只有当其存储、恢复或查询成本成为真实瓶颈时，才升级为 replay 模型。

Runtime Transcript 中存在状态修改事件，不等于这些事件天然就是 canonical replay source；若采用 Event Replay，必须单独定义事件版本、幂等性、Checkpoint 和损坏恢复规则。

### 12.3 Promote / Refresh

Session 运行时修改、提升为 Base Resource、资源库升级合并进旧 Session 都是后续产品能力。当前仅提供开发编辑和 Workspace Bundle 导出，不实现三方合并 UI。

### 12.4 Asset GC

删除 Card、Resource 或 Session 时不立即物理删除 Blob。等 Asset Store API 和引用扫描稳定后，再设计 mark-and-sweep / retention policy。

---

## 13. 待拍板事项

后续进入新阶段前仍需讨论：

1. 标准 Zone M0 的最终清单与默认顺序；
2. 未知 Zone 的 Runtime 默认是 fallback + warning，还是 isolate + warning；
3. 全局 Resource、Card 推荐 Resource 与用户手动挂载 Resource 的解析顺序；
4. 变量系统的数据 Schema、PromptBuild 消费方式与持久化边界；
5. Primary Branch Opening 是否也需要对应初始 State 权威记录；
6. Bundle 中 vendored Extension 只保留 dependency，还是允许携带待审批安装包；
7. 同格式 round-trip 无法保留未知字段时的错误等级。

这些问题之外，不应继续扩展新的抽象。当前资源阶段优先验证多资源 Card、PromptBuild 与自包含 Bundle 的真实编辑体验。
