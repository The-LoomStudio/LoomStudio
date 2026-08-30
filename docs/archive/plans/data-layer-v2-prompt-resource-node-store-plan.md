# Data Layer V2：Prompt Resource Node Store 实施计划

> **状态**：Phase 0–4 Implemented；Phase 5 Deferred；Phase 6 已完成本轮旧路径清理与容量 characterization（Agent mutation / Variable Store remain out of scope）
> **日期**：2026-08-19
> **范围**：在现有共享 SQLite Data Engine 上，将 Prompt Resource 从完整 JSON Document 拆为资源头、独立 Node 与节点级 Revision；明确高频变量和 Agent 写入的持久化边界。
> **取代范围**：取代旧计划中“Prompt Resource 长期保留为单一完整 Document、等待实际性能故障后再拆 Entry”的结论；不取代已经完成的 SQLite Data Engine、Document Store、Narrative Store、Agent Store、Blob Store 与 Commit Journal。
> **事实边界**：Phase 0–4 的 Prompt Resource Store、Application Runtime、RPC、PromptBuild source preparation 与 Card Bundle 资源路径已接入；本轮补齐共享事务失败回滚与日志反向验证，并删除无消费者的旧 Document type 常量、更新正式/reference 文档；不包含 Agent mutation、变量系统或 Client UI。

相关文档：

- [`sqlite-data-engine-domain-stores-kernel-plan.md`](sqlite-data-engine-domain-stores-kernel-plan.md)
- [`document-store-kernel-data-foundation-plan.md`](document-store-kernel-data-foundation-plan.md)
- [`prompt-resource-foundation-plan.md`](prompt-resource-foundation-plan.md)
- [`prompt-build-message-block-implementation-plan.md`](prompt-build-message-block-implementation-plan.md)
- [`../discussion/data/studio-data-layer-architecture.md`](../discussion/data/studio-data-layer-architecture.md)
- [`../../architecture/data/README.md`](../../architecture/data/README.md)

---

## 0. 本轮决定

Loom Studio 继续使用单个本地 SQLite 数据库，不在本阶段引入第二套 NoSQL 引擎。

Data Layer V2 的变化不是把任意 JSON KV 映射成 SQL 行，而是调整 Prompt Resource 的领域聚合边界：

```text
V1
  one Prompt Resource
    -> one documents row
    -> one nested rootNode.children[] JSON
    -> every update writes one full current JSON + one full Revision JSON

V2
  one Prompt Resource
    -> one prompt_resources header row
    -> many prompt_resource_nodes rows
    -> one changed Node writes one current Node + one Node Revision
    -> header changes write one Header Revision for complete header undo/redo
```

核心规则：

1. Prompt Resource 的最小独立编辑单位是 Node，不是任意 JSON KV；
2. `module / folder / entry / script / virtual / order` 继续是领域 Node；
3. Node 使用稳定 `id + resourceId + parentId + orderIndex` 表达树结构；
4. 需要查询、排序、约束或引用的字段进入 SQL 列；低频且可扩展的配置继续保存 JSON；
5. Resource 级 `version` 继续提供 optimistic concurrency；一次批量节点修改只产生一个新 Resource version；
6. Node Revision 记录本次改变的 Node，不再复制完整 Prompt Resource；Resource Header Revision 只保存 Header before/after，用于 Header-only 或 Header+Node 操作的完整 undo/redo；
7. PromptBuild、Card、Timeline 与 Preset 继续只引用稳定 Prompt Resource ID / Node ID，不感知 SQL 表；
8. Agent 对 Setting 的多项修改必须按一次 Turn 或一次明确操作批量提交；
9. 高频变量不进入 Prompt Resource Node Store，后续使用独立 State / Variable Store；
10. 不建立 V1/V2 双写或长期双读路径。开发数据库迁移或清理属于实施阶段的显式操作，执行前必须单独确认。
11. Preset 不再拥有 `linkedSettingIds` 或专属 Setting 绑定字段；所有 Setting 资源进入同一个全局平铺资源池，激活关系只由全局 Setting Mount Registry 维护；
12. Preset 自带、声明依赖或通过外部链接解析得到的 Setting，导入后都注册为全局 Setting，并在 Mount Registry 中记录 Preset 来源；切换 Preset 时按当前 Build 的 Preset ID 重新解析有效 Mount，不修改或复制 Setting Resource。

---

## 1. 当前实现与负载判断

### 1.1 V1 历史基线（已由 Phase 0–4 取代）

V1 期间 `airp.promptResource` 使用通用 Document Store：

```text
documents
  id
  type = airp.promptResource
  version
  content_json = {
    resourceKind,
    rootNode: { children: [...] },
    linkedSettingIds,
    sourceArtifactRef,
    createdAt,
    updatedAt
  }

document_revisions
  document_id
  version
  content_json = complete Prompt Resource snapshot
```

更新一个 Entry 会重写完整 current row，并插入一份完整 Revision。

### 1.2 当前测量与目标规模

2026-08-17 对本地正式数据进行只读结构统计：

```text
Setting 约 402 Bytes / Node
Preset  约 599 Bytes / Node
Logic   约 301 Bytes / Node
```

结合目标生态：

```text
Setting: 400–500 Entries
Preset:  约 100 Entries
```

保守估算：

```text
Setting current JSON: 200–500 KB
Preset current JSON:   60–200 KB
```

若一个 300 KB Setting 被 Agent 每天修改 100 次，完整 Revision 会永久增长约 30 MB/天、900 MB/月；实际写入还包括 current row 与 WAL。该风险已经可以由目标规模和写入频率预测，不再要求等到用户数据库实际膨胀后才调整聚合边界。

### 1.3 当前 SQL 利用不足

当前 Prompt Resource 查询只能先按 `documents.type` 读取，再在 TypeScript 中过滤 `content.resourceKind`、解析树和查找 Node。以下稳定字段无法直接索引：

- `resourceKind`；
- Resource label；
- Node `resourceId / parentId / kind / enabled`；
- Node 级更新时间；
- 可建立投影的 Zone、Activation、Tag 等查询字段。

V2 只提升真实需要查询和维护关系的字段，不建设通用 EAV。

---

## 2. 数据归属边界

| 数据 | V2 权威 Store | 原因 |
| --- | --- | --- |
| Card Source / Manifest | Document Store | 中小型、低频、整体版本有产品意义 |
| Prompt Resource Header / Node | 新 Prompt Resource Store | 400–500 Node、独立编辑、Agent 可修改 |
| Prompt Resource Revision | 节点级领域 Revision | 避免完整资源写放大 |
| Global Setting Mount | Prompt Resource Store 内的全局 Mount Registry | 统一手动全局 Setting 与 Preset 来源 Setting，不在 Preset 内保存绑定数组 |
| Narrative Timeline / Branch / Node | 现有 Narrative Store | 已完成的 append/branch 专用模型 |
| Agent Session / Message / Tool Call | 现有 Agent Store | 已完成的 append/message 专用模型 |
| Provider / Agent Profile | Document Store | 小型、低频配置 |
| Runtime Variable / State | 后续独立 State Store | 高频写入、Scope 与回退语义不同于 Setting |
| Source Artifact / Media | Blob + Asset Store | 不可变字节与业务 metadata 分离 |
| Extension 中小型自定义数据 | Document Store | 灵活 Schema 与权限边界 |
| Extension 高频或大量记录 | Extension 专属受控能力，另行设计 | 不把核心 Prompt Store 变成通用插件数据库 |

Prompt Resource Store 是 Application-owned Domain Store，与 Narrative / Agent Store 一样共享 Data Engine transaction 和 Commit Journal，但不通过普通 `docs.*` 修改。

---

## 3. 目标 Schema 草案

Migration namespace：

```text
application.prompt-resource@1
```

### 3.1 Resource Header

```sql
CREATE TABLE prompt_resources (
  id TEXT PRIMARY KEY,
  resource_kind TEXT NOT NULL,
  root_node_id TEXT NOT NULL,
  label TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  tombstoned INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT,
  deleted_by_json TEXT,
  delete_reason TEXT
);

CREATE INDEX idx_prompt_resources_kind_label
ON prompt_resources(resource_kind, label);
```

`metadata_json` 只保存低频 Resource metadata，例如 Source Artifact 引用、兼容导入信息和暂未升格的附加字段。可查询的 Link 不应长期埋在其中。

### 3.2 Resource Node

```sql
CREATE TABLE prompt_resource_nodes (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL REFERENCES prompt_resources(id),
  parent_id TEXT,
  order_index INTEGER NOT NULL,
  kind TEXT NOT NULL,
  category TEXT,
  label TEXT NOT NULL,
  meta TEXT,
  enabled INTEGER,
  body TEXT,
  capabilities_json TEXT,
  extra_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(resource_id, id),
  FOREIGN KEY(resource_id, parent_id)
    REFERENCES prompt_resource_nodes(resource_id, id)
);

CREATE INDEX idx_prompt_resource_nodes_parent_order
ON prompt_resource_nodes(resource_id, parent_id, order_index, id);

CREATE INDEX idx_prompt_resource_nodes_kind
ON prompt_resource_nodes(resource_id, kind);
```

首版继续使用带间隔的整数 `order_index`，复用当前 `orderIndex` 心智模型。只有并发重排或大规模同级插入证明整数排序不足时，才迁移到 rank string。

字段边界：

- `body`：作者正文；
- `capabilities_json`：Activation、Lifecycle、Projection 等低频可扩展能力；
- `extra_json`：`configRows / skeletonPatch / slotRanks / orderList / isSection` 等 kind-specific 数据；
- `parent_id`：唯一 containment parent；
- 跨对象引用继续使用明确的 `zoneId / bindingId / nodeId`，不能伪装成 containment。

Root Module 继续作为 Node 保存，V1 的 `rootNode.id` 必须原样保留，避免破坏 Slot Key、Binding 与外部引用。Store 校验一个 Resource 只有一个 `parent_id IS NULL` 的 Root，且必须等于 `prompt_resources.root_node_id`。

### 3.3 Global Setting Mount Registry

所有 Setting Resource 都是全局平铺资源。系统只维护一套 Setting Mount Registry，不在 Preset Header、Node 或 `metadata_json` 中保存 `linkedSettingIds`。

```text
Global Setting Resource Pool
  + Global Setting Mount Registry
      -> manual mount: 对所有 PromptBuild 生效
      -> preset mount: 只对当前 Build 所选 Preset 生效
```

目标表：

```sql
CREATE TABLE global_setting_mounts (
  id TEXT PRIMARY KEY,
  setting_resource_id TEXT NOT NULL REFERENCES prompt_resources(id),
  source_kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  order_index INTEGER NOT NULL,
  origin_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(setting_resource_id, source_kind, source_id)
);

CREATE INDEX idx_global_setting_mounts_source
ON global_setting_mounts(source_kind, source_id, order_index, id);

CREATE INDEX idx_global_setting_mounts_setting
ON global_setting_mounts(setting_resource_id);
```

首版 `source_kind` 只允许：

```text
manual  -> source_id = global，用户显式启用的全局 Setting
preset  -> source_id = Preset Resource ID，由该 Preset 的包、依赖声明或链接解析产生
```

`origin_json` 只记录安装来源和诊断信息，例如 package ID、导入 Artifact 或外部 URL；它不参与 PromptBuild 激活判断。

有效 Setting 由每次 PromptBuild 确定性解析：

```text
manual mounts
  + preset mounts where source_id = currentPresetId
  + Timeline / Card 已有的 Setting Resource 引用
  -> deduplicate by stable Setting Resource ID
  -> PromptBuild
```

同一个 Setting 同时由 manual、Preset 或 Timeline 引用时只编译一次。显式 manual mount 不会因为切换 Preset 被移除；Preset mount 在其他 Preset 的 Build 中自然不生效。

切换 Preset 不需要对数据库执行“先卸载旧 Setting、再挂载新 Setting”的破坏性写入。Resolver 只根据本次 Build 的 `currentPresetId` 选择对应行，因此两个 Agent Session 可以同时使用不同 Preset，而不会争抢一份可变的全局激活列表。

Preset Package 导入规则：

1. Preset 和随包 Setting 分别注册为全局 Prompt Resource；
2. 包内绑定声明转换为 `source_kind = preset` 的 Mount 行；
3. Preset 声明外部 Setting ID / URL 时，先完成可信解析和导入，再创建相同 Mount；
4. 无法解析的依赖产生导入诊断，不创建指向不存在 Resource 的占位 Mount；
5. 删除 Preset 只删除以它为 `source_id` 的 Mount，不删除仍被手动或其他来源使用的 Setting；
6. 删除 Setting 时提示所有 Mount 来源，确认后在同一 transaction 中移除 Mount 和 Resource。

Card / Timeline 的 Setting 引用继续属于 Narrative 初始化和当前 Timeline 资源链，不在本计划中强行迁入全局 Mount Registry；这里只取代 Preset 专属 `linkedSettingIds`。

### 3.4 节点级 Revision

```sql
CREATE TABLE prompt_resource_node_revisions (
  resource_id TEXT NOT NULL,
  resource_version INTEGER NOT NULL,
  node_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  changeset_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by_json TEXT NOT NULL,
  PRIMARY KEY(resource_id, resource_version, node_id)
);

CREATE INDEX idx_prompt_resource_revisions_changeset
ON prompt_resource_node_revisions(changeset_id);
```

`operation` 首版只允许：

```text
create
update
move
delete
```

Revision 保存完整“受影响 Node”的 before/after，而不是每个 KV 一行。一次操作修改多个 Node 时，共享同一个 Resource version 与 Changeset。

完整历史 Resource 快照、定期 checkpoint、Revision retention 和压缩在测量前不进入 Phase 1；当前状态始终由 `prompt_resources + prompt_resource_nodes` 直接读取，不依赖重放 Revision。

### 3.5 Resource Header Revision

Resource Header 的 `label / metadata / tombstone` 变化不能只依赖 Node Revision，否则包含 `resource.update + node.*` 的 Changeset 无法完整撤销。Store 额外保存一条 Header before/after Revision：

```sql
CREATE TABLE prompt_resource_header_revisions (
  resource_id TEXT NOT NULL,
  resource_version INTEGER NOT NULL,
  before_json TEXT,
  after_json TEXT,
  changeset_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by_json TEXT NOT NULL,
  PRIMARY KEY(resource_id, resource_version)
);

CREATE INDEX idx_prompt_resource_header_revisions_changeset
ON prompt_resource_header_revisions(changeset_id);
```

它只服务于 Resource Header 的完整领域 undo/redo，不是完整 Resource 快照，也不改变 Node 仍是主要独立 Revision 单位的边界。

---

## 4. Store 与事务合同

`PromptResourceStore` 已由 Studio Server composition root 创建并注入 Application Runtime。它通过 `transaction(tx)` 与 Narrative、Agent、Document participant 共享同一 SQLite Data Engine transaction。

最小能力：

```ts
type PromptResourceStore = {
  getResource(id: string): Promise<PromptResource | null>
  listResources(input?: ListPromptResourcesInput): Promise<PromptResourcePage>
  listSettingMounts(input?: ListSettingMountsInput): Promise<SettingMount[]>
  replaceSettingMounts(input: ReplaceSettingMountsInput): Promise<SettingMountMutationResult>
  createResource(input: CreatePromptResourceInput): Promise<PromptResourceMutationResult>
  mutateResource(input: MutatePromptResourceInput): Promise<PromptResourceMutationResult>
  deleteResource(input: DeletePromptResourceInput): Promise<PromptResourceMutationResult>
  revertChangeset(input: RevertPromptResourceChangesetInput): Promise<PromptResourceMutationResult>
  transaction(tx: SqliteDataTransaction): PromptResourceTransaction
}
```

Mutation 使用 ID 寻址的领域操作，不公开 JSON 数组下标 Patch：

```ts
type PromptResourceMutation =
  | { kind: 'node.create'; parentId: string; node: PromptResourceNodeDraft }
  | { kind: 'node.update'; nodeId: string; patch: PromptResourceNodePatch }
  | { kind: 'node.move'; nodeId: string; parentId: string; orderIndex: number }
  | { kind: 'node.delete'; nodeId: string }
  | { kind: 'resource.update'; patch: PromptResourceHeaderPatch }
```

Setting Mount 使用独立领域操作，不伪装成 Resource Node mutation：

```ts
type SettingMountMutation =
  | { kind: 'mount.add'; settingResourceId: string; source: SettingMountSource; orderIndex: number }
  | { kind: 'mount.remove'; mountId: string }
  | { kind: 'mount.move'; mountId: string; orderIndex: number }
```

每次 `mutateResource`：

```text
validate expectedVersion
  -> validate all referenced Node IDs
  -> reject cycle / cross-resource parent / root removal
  -> apply all current-row mutations
  -> increment Resource version once
  -> write changed Node Revisions
  -> record Data Commit operations
  -> commit once
  -> publish one post-commit fact
```

失败时 current rows、Revision、Changeset 和事件全部不产生。

---

## 5. 读取、PromptBuild 与导入导出

### 5.1 读取与树投影

Store 按 Resource ID 读取 Header 与 Nodes，并构建：

```text
nodesById
childrenByParentId
```

Application API 首阶段可以继续返回当前嵌套 `rootNode.children[]`，减少 Client 同步改造；权威存储不因此退回嵌套 JSON。

### 5.2 PromptBuild

PromptBuild 继续消费领域 `PromptResourceNode`，不直接查询 SQL。`collectPromptInputs()` 的来源改为 PromptResourceStore 读取结果，现有 Node ID、Source ID、Zone、Slot Key、Activation 与排序语义必须保持。

Agent Turn 构建输入时，不再读取 `Preset.linkedSettingIds`：

```text
Agent Profile.presetId
  -> load Preset Resource
  -> resolve Global Setting Mounts(currentPresetId)
  -> merge Timeline Setting Resource IDs
  -> deduplicate
  -> load Prompt Resource Nodes
```

Global Settings 的激活解析属于 Application Runtime source preparation，不进入 Loom Core；Core 仍只接收已经准备好的 Contributions / Fragments。

V2 不在同一阶段重写 PromptBuild Composition Schema。ZoneRef / RuntimeSlot / MessageBlock 属于编译模型，Prompt Resource Node Store 属于持久化模型，两者通过稳定 Node ID 和 Projection capability 对接。

### 5.3 导入导出

导入：

```text
external nested JSON / Card Bundle
  -> validate
  -> flatten to Resource Header + Nodes + Setting Mounts
  -> one transaction
```

导出：

```text
Resource Header + Nodes + relevant Setting Mount declarations
  -> rebuild nested rootNode.children[]
  -> existing Card / JSON / YAML / PNG package serializers
```

内部拆分不能泄漏到角色卡分发格式。未知兼容字段继续由 Source Artifact / `extra_json` 的明确透传规则处理。

---

## 6. Agent 修改与变量边界

Agent 不获得任意 SQL 或任意 JSON Patch 权限，只能调用 Application 提供的受控 Prompt Resource mutation capability。

首版约束：

1. Agent 只能修改显式授权的 Resource / Node；
2. 一次 Turn 内的多个 Node 修改合并为一个 `mutateResource`；
3. Agent mutation 与 Agent Message、可选 Narrative commit 可以共享同一个 Data Engine transaction；
4. Changeset actor/source 区分 developer、user、agent 和 extension，不复制第二套 Resource；
5. Setting Node 适合低频世界事实变化，不作为每轮变量容器；
6. 变量、计数器、角色当前状态等高频值进入后续 State Store，并由 PromptBuild 作为 Runtime Source 消费；
7. State Store Schema 未确定前，不把变量临时塞回 `capabilities_json` 或 Setting body。

---

## 7. NoSQL 决策与重新评估条件

本计划不引入 NoSQL，因为 Node 粒度、嵌套查询索引、局部写入和节点 Revision 均可由当前 SQLite Data Engine 实现，并可继续使用跨 Store transaction。

只有以下产品目标至少一项成为正式需求时，才重新评估嵌入式文档数据库：

- 多设备离线同步；
- 多人协作编辑；
- 自动冲突合并与 Revision DAG；
- 文档级 replication；
- 查询级 reactive subscription 无法由 Commit Event + Projection 满足。

重新评估时必须比较桌面、Server、Android 的打包、备份、迁移、事务和 Extension 权限成本，不能只比较文档 API 的便利性。

---

## 8. 实施阶段

### Phase 0：Characterization 与合同冻结（部分完成）

- 生成确定性的 V1 nested 500 Entry Setting 与 100 Entry Preset fixture；
- 验证 Store flatten/read 后的 nested 结果等价，并记录单 Node update 只产生一条 Node Revision；
- PromptBuild、Card、Timeline 的 V1/V2 等价、导入导出与引用链已在 Phase 3–4 的 Runtime/RPC 定向验证中覆盖；
- DB/WAL 容量基线已在 Phase 6 通过临时 SQLite characterization 脚本记录；Setting Mount 已由独立通用 API 暴露，Prompt Resource 响应不再携带 `linkedSettingIds`。

验证检查点：Phase 0 的 500/100 nested round-trip 与 Node revision characterization，加上 Phase 3–4 的 PromptBuild/Card/Timeline 定向集成验证，以及 Phase 6 的 DB/WAL characterization，构成当前已实现链路。

### Phase 1：PromptResourceStore 与 Schema（已完成）

- 注册 `application.prompt-resource@1` migration；
- 实现 Header、Node、Global Setting Mount 的 create/get/list/mutate/delete；
- 实现树校验、批量事务和 Data Commit operation；
- 只做当前状态，不先实现历史恢复 UI。
- Studio Server 已在共享 `SqliteDataEngine` 上创建并注入该 Store。

验证检查点：跨资源 parent、环、重复 Root、非法 kind 和失败 transaction 均被拒绝且不留下部分数据。

### Phase 2：节点级 Revision 与领域 Revert（已完成）

- 写入 changed Node before/after；
- Changeset operation 使用 `store = prompt-resources`；
- 实现 Prompt Resource 专属 changeset revert；
- `docs.revertChangeset` 明确拒绝包含 Prompt Resource operation 的混合提交。
- Header Revision 已补足 Header-only/Header+Node 的完整领域 revert；Runtime 与 RPC 已通过 PromptResourceStore 使用该能力。

验证检查点：修改一个 Entry 不产生完整 Resource Revision；create/update/move/delete 均可通过领域命令生成反向新版本。

### Phase 3：Application Runtime 与 RPC 切换（已完成）

- Prompt Resource CRUD 改用 PromptResourceStore；
- 保持嵌套 Prompt Resource response shape，但不再把 Setting Mount 投影进 Resource；
- 增加批量 Node mutation RPC；
- 增加通用 `application.listSettingMounts` / `application.replaceSettingMounts` RPC；source 统一支持 manual/global 与 Preset；
- Card、Preset、Timeline、Agent Profile 的 Resource ID 引用保持稳定；
- Extension 不获得原始 Store 或 SQL handle。

验证检查点：Client 在不理解 SQL Node 表的情况下可以完成当前创建、编辑、排序、删除和关联操作。

本次实现事实：Studio Server 在同一 `SqliteDataEngine` 上创建并注入 `PromptResourceStore`；Runtime CRUD、Preset/Global Setting Mount、官方初始化、Prompt Resource JSON import/export 与 Card Bundle 中的 Resource flatten 均使用该 Store。Setting Mount 通过独立 API 和 Client state 读取，旧 `airp.promptResource` Document 不参与读取或双写。

### Phase 4：PromptBuild、Card 导入导出切换（已完成）

- PromptBuild 来源读取迁移；
- PromptBuild 改为解析 manual + current Preset Mount，并与 Timeline Setting 去重；
- Card Bundle import flatten；
- Preset Bundle / 外部依赖导入统一生成全局 Setting Resource 与 Preset 来源 Mount；
- export rebuild nested tree；
- Source Artifact 和未知字段透传继续工作；
- 删除 Application Runtime 对 `airp.promptResource` Document 内容的依赖。

验证检查点：500 Entry Setting 与 100 Entry Preset 的 PromptBuild 顺序、Activation、MessageBlock 输出和 round-trip 保持一致。

本次实现事实：Agent Turn 通过 manual Mount、当前 Preset Mount 和 Timeline 中的 Setting Resource ID 解析来源并按稳定 Resource ID 去重；Preset 之间互不泄漏。Loom Core、MessageBlock、Zone、Slot 编译语义未改写。Card Bundle 仍保存稳定 `promptResourceIds`，导出重建嵌套外部格式；未知 legacy Node 字段经 `extra_json` round-trip。

### Phase 5：Agent Mutation 基座（Deferred）

本阶段尚未实现。不得把 PromptResourceStore 的通用 mutation API 误报为 Agent capability。

明确前置：

- Agent Tool Runtime 能消费 Provider tool call、执行受控 Tool、写入 ToolResult 并继续或挂起 Run；
- Application-owned Mutation Effect contract，包含 Resource/Node 目标、schema、expectedVersion、结果与 Changeset 关联；
- 服务端 Resource/Node grant 与 Permission/Consent enforcement，授权不能来自 Client allowlist；
- PromptBuild 对 ToolCall / ToolResult transcript 的明确投影策略。

- 提供受控 Node mutation capability；
- 一次 Turn 批量写入；
- 支持与 Agent Message / Narrative commit 同 transaction；
- Event 只在 commit 后发布；
- 不在本 Phase 实现变量系统或自动世界状态推理。

未来验证检查点：Provider、Tool 或 Node 校验失败不会留下 Agent Message、Narrative Node、Resource version 或 Revision 的半提交。

### Phase 6：旧路径清理与容量复测（已完成本轮范围）

- 已删除无运行时消费者的 `applicationDocumentTypes.promptResource` 常量和旧 Setting Mount RPC；Prompt Resource projection 不再包含 `linkedSettingIds`；
- 新增 `scripts/measure-prompt-resource-storage.ts` 与 `pnpm run measure:prompt-resource-storage`，只创建并清理临时 SQLite DB，不读写用户数据库；
- 已完成确定性 500 Entry Setting + 100 Entry Preset fixture 的 V1/V2 对比，以及同一 Setting Node 的 100 次等长 body 更新；脚本连续运行两次，量级稳定；
- 当前数据不支持立即引入 snapshot、retention、FTS5 或额外索引：V2 的局部 Node Revision 已显著降低 WAL 与 checkpoint 后 DB 增长；保留后续在更高频率或更大文本规模下重新评估 retention/snapshot 的入口。

验证检查点：权威 Prompt Resource 只存在于一个 Store；修改单 Node 的 Revision 增长与受影响 Node 大小同阶，不再与完整 Resource 大小同阶。

---

## 9. 最小验证矩阵

### Schema 与事务

- migration 连续、失败回滚、新版本拒绝旧程序打开；
- FK、Root、parent、cycle、order 和 Resource ownership 校验；
- optimistic Resource version；
- 一次 transaction 一个 Changeset / Commit Fact；
- observer failure 不影响已提交数据。

### CRUD 与 Revision

- Node create/update/move/delete；
- Folder subtree delete/revert；
- Resource tombstone；
- 多 Node batch 只增加一个 Resource version；
- before/after 不保存未改变的 500 Entry Resource；
- mixed-store changeset 不被 `docs.revertChangeset` 误处理。

### 业务链

- manual Global Setting Mount；
- Preset Package / 声明 / URL 导入后的 Setting Mount；
- 切换 Preset 后只解析对应 Preset Mount，manual Mount 保持；
- 两个 Agent Session 使用不同 Preset 时各自解析正确 Setting；
- Card import/export；
- Timeline Prompt Resource 引用；
- Agent Profile Preset 引用；
- PromptBuild Projection、Activation、Slot/Zone/MessageBlock；
- Agent mutation 与 Agent/Narrative transaction 原子性。

### 容量

- 500 Entry Setting current size；
- 100 Entry Preset current size；
- 连续 100 次单 Node 更新的 DB/WAL/Revision 增长；
- 100 次多 Node batch 更新；
- Resource load、tree rebuild、PromptBuild 和 export 时间；
- Server restart 与 migration 时间。

#### Phase 6 本机 characterization（2026-08-19）

脚本使用同一确定性 fixture：500 Entry Setting、100 Entry Preset、每个 Entry 1024 字节 body；关闭 `wal_autocheckpoint`，初始写入后执行一次 `wal_checkpoint(TRUNCATE)`，再对同一个 Setting Entry 连续执行 100 次等长 body 更新。以下数字只代表当前 Mac、本地 SQLite 和当前实现的 characterization，不是性能 SLA。

| 实现 | 初始 checkpoint 后 DB bytes | 100 次更新后 WAL bytes | 最终 checkpoint 后 DB bytes | 更新耗时（两次运行） |
| --- | ---: | ---: | ---: | ---: |
| V1 DocumentStore 完整 nested JSON | 1,421,312 | 119,521,232 | 58,806,272 | 约 0.51–0.58 s |
| V2 PromptResourceStore Node + Revision | 2,363,392 | 7,280,072 | 2,850,816 | 约 1.21–1.23 s |

两次运行的行数均为 102 个 Changeset；V1 有 2 个 Document、102 个 Document Revision，V2 有 2 个 Resource、602 个 Node、702 个 Node Revision 和 102 个 Header Revision。V2 初始 DB 因关系表和初始 Revision 行较大，但 100 次局部更新后的 WAL 约为 V1 的 1/16，最终 checkpoint 后 DB 约为 V1 的 1/20；本次脚本中 V2 更新耗时较高，因此不能把容量改善解读成性能保证。

基于该数据，本轮不新增 snapshot、Revision retention、FTS5 或额外索引。当前读取路径只依赖 current Node 状态，100 次更新的 Revision 数量和 WAL 仍处于可观察范围；如果未来出现更高频率、更大 body 或长期历史增长，再以实际保留策略和历史读取需求决定 snapshot/retention。FTS5 与额外索引属于查询需求，不由本次容量数据触发。

自动化结果与人工 UI 编辑体验分别记录，不用 build/test 通过代替前端视觉和交互验收。

---

## 10. 风险与停止条件

### 双事实源

禁止 `documents.content_json` 与 `prompt_resource_nodes` 同时作为权威数据。迁移阶段可以使用一次性转换，但正式读取路径只能有一个。

### Generic Store 膨胀

PromptResourceStore 只理解 Prompt Resource，不抽象成通用 Tree Store、通用 Node Repository 或任意插件数据库。第三个真实领域消费者出现前不提取公共 package。

### JSON 字段重新成为垃圾桶

`capabilities_json / extra_json` 只能保存低频扩展配置；需要过滤、关联或高频修改的字段必须重新评估为列、Link 或独立 Store。

### Revision 过度设计

首版保存 changed Node before/after，不实现任意 JSON Patch 链、全量 Event Sourcing、Revision DAG 或自动压缩。历史版本读取出现真实需求后再决定 snapshot 频率。

### Agent 权限与数据损坏

Agent mutation 必须经过 Resource/Node scope、Schema、引用和 expectedVersion 校验。不能为了降低写放大绕过信任边界。

### 变量边界回退

若变量系统尚未完成，不允许临时把每轮 State 写入 Setting Node。缺少 State Store 是功能未完成，不是污染 Prompt Resource 的理由。

---

## 11. 非目标

- 全局更换为 NoSQL；
- MongoDB / CouchDB 服务进程；
- 任意 JSON KV / EAV 表；
- ORM 或通用 Repository framework；
- Extension 原始 SQL；
- 多设备同步和冲突合并；
- 变量系统完整 Schema；
- FTS5、向量检索；
- Revision 自动 GC、压缩与冷归档；
- 修改 Narrative / Agent 已完成的 Domain Store；
- 在同一阶段重写 PromptBuild Composition Schema；
- 将 Card / Timeline Setting 引用强行迁入 Global Setting Mount；
- 改变 Card / YAML / JSON / PNG / `.loomcard` 的外部分发格式。

---

## 12. 完成定义

1. Prompt Resource 不再把完整树作为 `documents.content_json` 权威保存；
2. Resource Header、Node、Global Setting Mount 使用专用关系表；
3. Node 通过 `parentId + orderIndex` 表达唯一 containment；
4. 修改一个 Node 只写入该 Node 当前状态与 Node Revision；
5. 多 Node batch 只增加一个 Resource version；
6. Prompt Resource commit 进入共享 Changeset / Data Commit Fact；
7. PromptBuild、Card、Timeline、Agent Profile 的稳定引用保持；
8. 导入导出继续使用嵌套可分享格式；
9. **Deferred**：Agent 通过受控 Application capability 原子修改授权 Node；前置为 Agent Tool Runtime 与服务端 Resource/Node grant；
10. 变量没有进入 Prompt Resource 作为临时高频状态；
11. Preset 权威存储不保存 `linkedSettingIds`，手动与 Preset 来源 Setting 统一由 Global Setting Mount Registry 解析；当前 RPC/Client 通过独立 Setting Mount API 读取；
12. 切换 Preset 不修改全局 Resource，也不会移除 manual Mount；
13. V1 Prompt Resource Document 权威路径和双写、旧 Setting Mount RPC 与 `linkedSettingIds` 投影均已删除；兼容嵌套 Artifact 和 mapper 继续承担外部格式转换；
14. 500/100 fixture 证明 Revision 增长与 changed Node 大小同阶；
15. Architecture 文档只在代码、迁移和验证完成后更新为已实现事实。
