# Extension 数据与 Portable Payload 基建实施计划

> **状态**：Phase 1—5 基础已实施；Renderer / Job / GC 阶段待讨论
>
> **日期**：2026-08-27
>
> **设计来源**：
> - [`../discussion/application/extension/extension-module-scenarios-v0.md`](../discussion/application/extension/extension-module-scenarios-v0.md)
> - [`../discussion/application/extension/card-extension-portable-payload-v0.md`](../discussion/application/extension/card-extension-portable-payload-v0.md)
> - [`../discussion/application/asset-import-export-boundary-v0.md`](../discussion/application/asset-import-export-boundary-v0.md)
>
> **目标**：在不确定 Renderer 挂载点之前，先完成 Extension 数据的 Scope、Changeset、实体引用和 Card Portable Payload 基础，使插件能够持久化可审计数据，并把自己理解的配置或初始内容安全地随 Card 分发。

## 1. 已接受边界

- Extension 运行时持久化 Scope 只考虑 Global、Timeline 与 Agent Session；Card 和 Narrative Node 不是存储桶；
- Card 是分发 Carrier。Core 不理解插件私有配置 Schema，也不在导入时执行插件代码；
- Node、Agent Message、Asset 等是可选绑定目标，用于来源、失效、展示锚点或审计，不自动决定级联删除；
- 用户可见的 canonical Extension 写入进入 Document Store / Data Engine Changeset；缓存、索引和临时 Job 状态不伪装成可撤销业务事实；
- State 继续承载跨 Prompt、脚本、UI 与分支回滚共享的角色或世界语义；插件私有配置和记录不塞进 State；
- Secret 不进入 Document、Portable Payload 或 Card Bundle；
- Renderer、Client 挂载点、iframe / Shadow DOM 交互和 Narrative Attachment 展示协议不属于本计划。

## 2. 现有可复用基础

- Document Store 已支持 Extension owner、Revision、Tombstone、Changeset 和事务参与；
- Extension Host 已向 Server Extension 提供受 owner 与声明类型约束的 Documents API；
- Asset / Blob Store 已提供稳定 `assetId`、ownerPackageId、内容寻址 Blob 与受控读取；
- Card Bundle V2 已支持 JSON、ZIP、PNG、Source Artifact、Import Bundle、State Template 和 Timeline Binding；
- Narrative Node 已保存 `stateRevisionId` 与 Agent Session / Message / Run / Changeset 来源；
- State 回滚和 Application Changeset 已经形成统一受控写入路径。

因此首版不新增数据库 Package，不建设通用 Graph Store，也不复制 Document Store 的 Revision / Undo 逻辑。

## 3. Phase 1：Portable Payload Artifact 纵向链路

第一条交付只支持 UTF-8 JSON / text Payload：

```text
Card Bundle Payload
  -> validate generic metadata and budgets
  -> import as airp.portableExtensionPayload Document
  -> Card stores canonical Payload document ids
  -> unknown Extension remains opaque
  -> export current canonical Payloads
  -> ZIP writes namespaced files
  -> re-import preserves bytes and metadata
```

### 3.1 Artifact 合同

```ts
type PortableExtensionPayloadArtifact = {
  id: string
  packageId: string
  fileName: string
  format: string
  mediaType: string
  schemaVersion?: number
  requirement?: { versionRange?: string }
  metadata?: JsonObject
  content: string
}
```

Core 只验证通用边界：稳定安全 token、basename、有限整数版本、非空 Media Type / Format、UTF-8 字节预算和重复 ID。`content` 对 Core 保持 Opaque。

### 3.2 Canonical Document

导入时为每个 Artifact Payload 创建独立 `airp.portableExtensionPayload` Document。Document 使用新的本地 ID，并在 content 中保留 Artifact Payload ID；Card 保存本地 Document ID。这样重复导入同一 Card 不发生 Document identity 冲突，同时导出仍能恢复插件定义的 Payload identity。

Import Bundle 的 `documentIds` 收录这些 Document。删除 Card 不自动删除 Payload；后续 Card Binding / GC Phase 再定义共享和孤儿清理策略。

### 3.3 ZIP 边界

JSON / PNG Artifact 可以内联 UTF-8 content；ZIP 导出将 content 写入 Core 生成的 namespaced Entry，Manifest 只保存通用 metadata 与相对路径。插件不能选择物理路径。

首版限制：单个 Payload 1 MiB、每个 Card 64 个、总计 8 MiB。达到真实需求后升级为 Blob / arbitrary bytes Portable Payload，不先引入 Base64。

### 3.4 实施结果

- `CardBundleArtifact.extensionPayloads`、通用 metadata、UTF-8 content 与预算校验已落地；
- 导入在同一 Data Engine transaction 中创建 `airp.portableExtensionPayload` Documents，并把本地 ID 写入 Card 与 Import Bundle inventory；
- 导出从 canonical Documents 重建 Payload，不依赖原始 Artifact 作为唯一权威；
- 未安装 Extension 不阻塞导入，Payload 作为 Opaque Document 保留并可再次导出；
- ZIP Manifest 只保存 metadata / path，内容实际写入 Core 生成的 `extensions/<packageId>/<payloadId>/<fileName>` Entry；
- JSON 与 PNG Artifact 继续使用内联 UTF-8 content；任意二进制尚未实现，Package-owned Packaging SDK 在 Phase 3 接入。

## 4. Phase 2：Application CRUD 与 Card Binding

- List / Get / Create / Update / Delete Portable Payload；
- Replace Card Portable Payload Bindings；
- 所有 mutation 返回 Changeset；
- 校验 Payload Document 类型、Card expected version 与重复绑定；
- Card 删除、Payload 删除和 Binding 删除保持显式，不做隐式级联；
- Client API 提供最小数据接口，暂不实现复杂作者 UI。

### 4.1 实施结果

- Application Runtime、Studio RPC 与 Client typed API 已提供完整 CRUD 和 Card Binding；
- Card Binding 使用 `expectedVersion`，拒绝重复 Document ID 与重复 Artifact Payload ID；
- 删除仍被 Card 引用的 Payload 会被拒绝；解除绑定后可显式删除；
- 所有 mutation 返回 Changeset，Artifact Payload ID 在 update 中保持稳定。

## 5. Phase 3：Extension Packaging Capability

在 Extension Host 增加窄的 typed capability，而不是要求插件直接操作 Application Document Type：

```text
ctx.portablePayloads.publish
ctx.portablePayloads.listOwn
ctx.portablePayloads.readOwn
ctx.portablePayloads.updateOwn
ctx.portablePayloads.deleteOwn
ctx.portablePayloads.replaceOwnCardBindings
```

Host 强制当前 `packageId`，Extension 不能伪造 owner、读取其他插件 Payload 或提供 Bundle 物理路径。导入时不执行插件；Pending Payload 使用持久查询，Event 只作通知。

### 5.1 实施结果

- Server Extension Activation Context 已提供上述 typed capability；
- Host 在 create/update/delete/read/bind 前强制或校验当前 Package owner；
- Card Binding 只替换当前 Package 的 Payload，并保留其他 Package Binding；
- Extension mutation 使用 Extension actor 进入 Application / Document provenance。

## 6. Phase 4：Scoped Extension Storage

在现有 Document Store 上提供 typed facade：

```ts
type ExtensionStorageScope =
  | { kind: 'global' }
  | { kind: 'timeline'; timelineId: string }
  | { kind: 'agent-session'; agentSessionId: string }
```

首版区分 Config 与 Record，但不建设任意 KV、Card Scope 或 Node Scope。Node / Message 引用保存在 Record 的 typed bindings 中；按真实查询需求补索引，第一版不建立万能 Entity Graph。

### 6.1 实施结果

- `ctx.storage.configs` 已提供 list/get/upsert/delete；
- `ctx.storage.records` 已提供 list/get/create/update/delete；
- Scope 固定为 Global、Timeline、Agent Session；
- Record Binding 固定为 Narrative Node、Agent Message、Asset 与 State Path；
- Studio Server 写入前校验 Scope 与绑定目标；Host 强制 Package owner 和 optimistic version；
- Config / Record 保存为 `airp.extensionConfig` / `airp.extensionRecord` Document；首版按 owner/type 分页后在内存中过滤，已用 `ponytail` 标记索引升级路径。

## 7. Phase 5：生命周期与 Changeset 基础接合

- Canonical Config / Record / Binding mutation 使用统一 Changeset；
- Node 或 Message Event 只触发处理，不替代持久引用；
- Timeline / Agent Session 删除会清理对应 Scope，不把 Node 或 Message 当作级联存储桶；
- Asset rollback 只删除持久引用，不隐式删除可能共享的 Asset；
- Extension 禁用期间漏过 Event 后，可以通过持久化 scope / binding 查询对账。

Branch lineage 驱动的可见性属于 Renderer / Narrative Attachment 阶段；Derived memory / embedding checkpoint、rebuild、Job Queue 和未引用 Asset / Blob GC 属于各自后续基础设施。本 Phase 只保证 canonical 数据、引用和 Scope 生命周期不会妨碍这些后续能力，不提前实现不存在的 Memory 或 GC 系统。

### 7.1 实施结果

- Config / Record / Binding 与 Portable Payload mutation 均进入 Changeset；
- Config update 已验证可以通过 Document Changeset revert；
- Extension dispose / re-activate 后持久 Config 仍可查询；
- Timeline / Agent Session 删除会在同一 Data Engine transaction 中 tombstone 对应 Scope 的 Config / Record；Global 和其他 Scope 保持不变；
- Node / Message / Asset 仅为持久引用，不被建模为 Store 或隐式级联；删除绑定 Record 已验证不会删除仍存在的 Asset；Asset GC、Derived memory checkpoint 和 Renderer lineage 仍留给后续专门阶段。

## 8. 下一阶段：Renderer 与 Narrative Attachment

完成本计划后再确定：

- 正文稳定 Marker 与 Narrative Attachment Schema；
- inline、before / after、sidebar 等挂载位置；
- Renderer Registry 的第三方 Client code 加载；
- Extension 缺失时的静态 fallback；
- Node lineage、Marker 删除与 Attachment 可见性。

## 9. 实施验证

自动化检查至少覆盖：

1. JSON Card Bundle import → canonical Payload Document → export round-trip；
2. 未安装 Extension 时 Payload 不丢失；
3. 重复 Payload ID、非法 token / basename、非法版本和超限内容在写入前拒绝；
4. Import Bundle `documentIds` 包含 Payload Documents，并与 Card import 保持同一事务；
5. ZIP 将 Payload 写入 namespaced Entry，decode 后恢复相同 metadata / content；
6. 原有 Card V2、State Template、Prompt Resource、PNG / ZIP 测试不回归。

完成审计的当前证据：

- `pnpm test`：123 个 Test Files、545 个 Tests 全部通过；
- `pnpm build`：根构建与 package TypeScript project references 通过；
- `pnpm check:workspace`：Workspace health check 通过；
- 22 个核心聚焦测试文件、126 项测试覆盖 Portable Payload round-trip、预算/非法输入、CRUD、RPC / Client mapping、Extension Host owner 隔离、真实 Studio Server capability 接线、Scoped Storage、四类 typed binding、Changeset revert、Extension restart、超过单页的 Scope 清理、Timeline / Agent Session lifecycle、Asset 保留与 Document Store 组合事务；
- 受影响 Source 文件的定向 ESLint 与 `git diff --check` 通过；
- 全仓 `pnpm lint` 仍被当前基线中与本计划无关的 State Variable UI、Text Transform UI、History Text caught-error 和 State Store unused import 共 15 项错误阻塞，本计划未越界修改这些文件。
