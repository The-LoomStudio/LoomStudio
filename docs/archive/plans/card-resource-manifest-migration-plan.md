# Card Resource Manifest 迁移实施计划

> **状态**：Implemented / Phase 5 Complete
> **日期**：2026-07-29
> **范围**：将 `PromptWorkspace` 从 Card、Session、PromptBuild 的权威数据链中移除，改为 Card 直接声明资源集合、Session 只保存资源引用。
> **实施约束**：本文属于 Workbench 工程计划；代码落地并通过测试前，不写入 `docs/architecture`。
> **2026-08-15 后续说明**：本文的 Card / Session 术语记录已完成迁移阶段；后端现已由 Narrative Timeline 保存 Card 来源与有序 Prompt Resource 引用。当前 `ImportBundle.sourceArtifact` 仍在 SQLite 中保存标准化 Artifact，原始 PNG / JSON 字节保留、Blob Store 和本地路径迁移进入 [`local-data-blob-store-foundation-plan.md`](local-data-blob-store-foundation-plan.md)。
> **2026-08-15 Card 文件 M0**：Studio Server 已提供三种共享同一 `CardBundleArtifact` 的容器：压缩 `iTXt/loom` 普通 PNG（不使用 Base64）、包含 `manifest.json` 与媒体文件的 `.loomcard` ZIP，以及“头像 PNG + 同一 ZIP 尾部”的 Polyglot PNG。Card 头像是 PNG 主图，背景是完整包内的可选链接二进制资源。ZIP 导入强制校验路径、条目数量、单文件与总解压体积；ST `chara` 与 URL 导入仍属后续范围。

---

## 0. 本轮收束决定

目标主链：

```text
Self-contained Card Bundle
  -> Importer
  -> Card Manifest + flat Prompt Resource Documents + Import Bundle
  -> create Session 时复制 Resource IDs，不复制 Resource 内容
  -> PromptBuild 直接读取 Session Resource IDs
  -> 开发编辑直接修改平铺 Resource Documents
  -> Exporter 从 Card Manifest 收集资源并重新生成自包含 Bundle
```

明确删除的概念依赖：

```text
Card -> PromptWorkspace -> Resources
Session -> PromptWorkspace -> Resources
PromptBuild -> PromptWorkspace -> Resources
```

`PromptWorkspace` 曾是 Phase 2 期间的过渡聚合层，同时承担资源列表、UI 镜像、导入来源、Card Binding 和 PromptBuild 输入。资源平铺后，它不再提供独立领域语义，Phase 5 已将其删除。

如果未来出现真实的多 Card 创作工程需求，可以重新设计可选的 `AuthoringWorkspace`。该对象只管理草稿、编辑器布局、资源选择和项目视图，不得重新进入 Session 或 PromptBuild 权威链。

---

## 1. 当前代码事实

当前已实现：

- Bundle import 在同一事务中创建 `airp.cardSource`、`airp.importBundle` 和多个平铺的 `airp.promptResource`；
- Card 以有序 `promptResourceIds` 作为资源清单，并通过 `importBundleId` 保留导入来源；
- Session 创建时只复制 Card 的 Resource IDs，不复制 Resource 内容；
- PromptBuild 直接从 `Session.promptResourceIds` 读取 Resource Documents；
- Resource 的读取、创建、更新、移动和删除均以 `resourceId` 为入口；
- Studio Client 按 Card Manifest 读取 Resource Documents，并在内存中组装资源视图；
- Card export 从 Card Manifest 收集当前 Resources，并从 Import Bundle 合并来源 metadata；
- `PromptWorkspace` Document Type、Card/Session/Resource Workspace 字段、RPC、client entity 与 fallback helper 已全部删除；
- Bundle 对外类型已收束为 `CardBundleArtifact`，导入入口为 `application.importCardBundle`。

---

## 2. 目标最小数据模型

### 2.1 Card Manifest

第一阶段不建立通用 Binding Graph，只保存当前 PromptBuild 所需的稳定有序 ID：

```ts
type CardSourceContent = {
  name: string
  userName?: string
  description?: string
  promptResourceIds: string[]
  importBundleId?: string
  opening: OpeningChatContent
  createdAt: string
  updatedAt: string
}
```

约束：

- `promptResourceIds` 顺序是 Card 的资源集合顺序；
- 保存引用不表示 Card 拥有 Resource；
- 删除 Card 不级联删除 Resource；
- 当前 `preset` / `settingLayer` 字段只保留给 M0 simple-card 兼容路径，迁移完成后另行删除；
- Preset 的全局选择与 Card recommendation 语义不在本阶段重构，先保持现有 PromptBuild 等价行为。

### 2.2 Session

```ts
type SessionContent = {
  cardSourceVersionId: string
  cardSnapshot: JsonObject
  promptResourceIds: string[]
  activeBranchId: string
  createdAt: string
  updatedAt: string
}
```

创建 Session 时只复制 Resource ID 数组：

```text
Card.promptResourceIds
  -> Session.promptResourceIds
```

由此获得：

- Card 后续增删资源绑定，不静默改变旧 Session 的资源集合；
- Resource 内容被开发编辑后，所有引用它的 Session 在下一次 PromptBuild 读取新内容；
- 不复制 JSON 内容，不建设 Session Resource Instance、Diff、Overlay 或 CoW。

### 2.3 Prompt Resource

```ts
type PromptResourceContent = {
  resourceKind: PromptResourceKind
  rootNode: PromptResourceNode
  sourceArtifactRef?: CardBundleSourceArtifactRef
  createdAt: string
  updatedAt: string
}
```

Resource 不保存 Workspace 所有权或来源 Workspace ID。

本阶段不拆分每个 Setting Entry。一个顶层 Prompt Resource 继续是一个聚合 Document。

### 2.4 Import Bundle

迁移前由 Workspace 保存的导入来源已移入独立 Document：

```ts
type ImportBundleContent = {
  cardId: string
  documentIds: string[]
  sourceArtifact: CardBundleArtifact
  importedAt: string
}
```

目标 Document Type：

```text
airp.importBundle
```

当前阶段继续保存标准化 Artifact。原始 PNG、二进制 Asset、unknown-field 完整 round-trip 在 Asset Store / Compatibility 阶段处理。

---

## 3. 权威数据链

### 3.1 Import

```text
CardBundleArtifact
  -> normalize
  -> create Prompt Resources
  -> create Card with ordered promptResourceIds
  -> create Import Bundle
  -> commit in one Document transaction
```

导入完成后不再要求创建 Prompt Workspace Document。

### 3.2 Development Edit

```text
Resource Editor
  -> resourceId
  -> update airp.promptResource
  -> Document revision + Changeset
```

当前所有 Resource 编辑均为开发编辑。不存在玩家运行时 Setting 修改。

### 3.3 Session Start

```text
Card
  -> copy promptResourceIds
  -> Session
  -> create Primary Narrative Branch
```

Session 不读取、复制或生成 Prompt Workspace。

### 3.4 PromptBuild

```text
Session.promptResourceIds
  -> batch/read ordered Prompt Resources
  -> collect Source Contributions
  -> deterministic Zone / Slot / Entry compile
```

PromptBuild 不接收 `workspaceId` 作为 canonical 输入。

### 3.5 Export

```text
Card.promptResourceIds
  -> read current Prompt Resources
  -> merge retained Import Bundle compatibility data
  -> emit self-contained Artifact
```

多 Setting Resource 作为多个独立顶层资源导出，不缝合为单一世界书。

---

## 4. 分阶段工程实施

### Phase 1：建立 Card / Session 直接资源引用

状态：已完成。

目标：先建立新权威字段，保留 Workspace 兼容读取。

任务：

1. 为 `CardSourceContent` 增加 `promptResourceIds`；
2. Bundle import 同时写入 Card `promptResourceIds`；
3. 为 `SessionContent` 增加 `promptResourceIds`；
4. `createSessionFromCard` 从 Card 复制资源 ID；
5. 旧 Card 缺少新字段时，临时从 `promptWorkspaceId` 读取；
6. 不增加长期双写抽象。

验证：只给 `cardId` 创建 Session 后，Session 包含全部有序资源 ID；无 Prompt Resource 内容复制。

已验证：新导入、多 Setting Resource、simple Card 空资源集合与 legacy Workspace fallback 均有自动化测试覆盖。

### Phase 2：切换 PromptBuild 与 Export

状态：已完成。

目标：移除运行路径对 Workspace 的依赖。

任务：

1. PromptBuild 从 `session.promptResourceIds` 读取；
2. preview / submit 不再依赖 `workspaceId`；
3. export 以 `cardId` 为入口并遍历 Card 资源；
4. 保留旧 Workspace RPC 作为短期 adapter；
5. 增加缺失 Resource、错误类型和重复 ID 的输入校验。

验证：删除 Session 的 `workspaceId` 后，preview、submit 和 export 仍完整工作。

已验证：删除 legacy Workspace Document 后，直接资源链仍可 preview、submit 和 Card export；重复、缺失和错误类型 Resource ID 均明确失败。

### Phase 3：迁移资源编辑 API 与前端

状态：已完成。

目标：Resource 编辑不再通过 Workspace 聚合层。

任务：

1. 增加按 `resourceId` 读取和编辑 Prompt Resource 的 Application API；
2. Card 详情按 `promptResourceIds` 组装资源树；
3. 前端移除 `contextAssets` 作为持久化事实源；
4. Projection UI 直接消费 Resource Documents；
5. 现有 Workspace API 只做迁移适配，不继续增加功能。

验证：前端完成创建、修改、移动、删除和排序后，只产生 Resource Document revisions。

已验证：

- Card Resource list 保持 Card Manifest 的资源顺序；
- 单 Resource 创建、单项更新、批量更新、Resource 内移动与删除均只产生一个 Prompt Resource operation，legacy Workspace version 不变化；
- Resource changeset 可通过既有 revert API undo / redo；
- 跨 Resource move 与 batch update 当前明确拒绝，不静默写入多个 Documents；
- Studio Client 已退出 Workspace get/list/edit 主链，旧 Workspace API 仅保留给导入和迁移兼容；
- 完整测试为 56 files / 238 tests，TypeScript project build 与 `git diff --check` 通过。

### Phase 4：独立 Import Bundle

状态：已完成。

目标：把导入来源和兼容数据从 Workspace 移出。

任务：

1. 增加 `airp.importBundle`；
2. Import transaction 创建 Import Bundle；
3. Card 保存可选 `importBundleId`；
4. Export 从 Import Bundle 读取来源 Artifact；
5. 删除 Workspace 内嵌的 `sourceArtifact`、`sourceArtifactRef`、`importBundle` 和 `bindings` 权威职责。

验证：导入、编辑、导出、重新导入保持当前已知字段往返；Import Bundle 可独立查询。

已验证：

- Import transaction 创建独立 `airp.importBundle`，Card 保存其 Document ID；
- `application.getImportBundle` 与 Studio Client typed API 可以独立读取 Bundle；
- Card export 从 Import Bundle 合并标准化来源 Artifact、source ref、bindings 与导入清单；
- 删除 legacy Workspace 后，Card export 仍保留原 `artifactId`、metadata 和兼容信息；
- legacy Card 缺少 `importBundleId` 时，Card export 仍从 Workspace 镜像回读；
- export 后重新 import 会生成新的 Card、Resources、Workspace 和 Import Bundle IDs，不复用旧 Document IDs；
- 完整测试为 56 files / 239 tests，TypeScript project build 与 `git diff --check` 通过。

### Phase 5：删除 PromptWorkspace 运行模型

状态：已完成。

目标：完成迁移清理，不保留永久脚手架。

任务：

1. 停止创建 `airp.promptWorkspace`；
2. 删除 `Card.promptWorkspaceId`；
3. 删除 `Session.workspaceId`；
4. 删除 `PromptResource.workspaceId`；
5. 删除 `PromptWorkspaceContent.contextAssets` 镜像；
6. 删除无调用方的 Workspace RPC、client entity 和兼容 helper；
7. 将对外 Artifact 类型收束为 `CardBundleArtifact`，导入入口收束为 `application.importCardBundle`。

已验证：活动代码与测试中的 Workspace 运行符号搜索归零；TypeScript project build 通过；完整测试为 56 files / 231 tests，包含 Studio Server 本地端口监听型集成测试。

---

## 5. 最小测试闭环

必须新增或保留：

1. 一张 Card 引用两个 Setting Resources，Session 只复制两个 ID；
2. PromptBuild 同时消费两个 Setting Resources；
3. 编辑其中一个 Resource 后，现有 Session 下一次 build 读取新内容；
4. Card 增删资源引用后，旧 Session 的 ID 集合不变化；
5. 两张 Card 可以引用同一个 Resource ID；
6. 删除其中一张 Card 不删除共享 Resource；
7. Export 收集 Card 的全部 Resource；
8. Export 后 re-import 仍得到等价的多资源 Card；
9. 缺失 Resource ID 明确失败，不静默跳过；
10. Card Bundle 导入、导出、重新导入会生成全新的 Document IDs。

验证命令：

```bash
pnpm exec tsc -b --pretty false
pnpm exec vitest run
git diff --check
```

Studio Server 集成测试若在受限沙箱内出现 `listen EPERM`，必须在允许本地端口监听的环境重新执行后才能声明完整通过。

---

## 6. 明确非目标

本轮不实施：

- Session / Branch Prompt Resource 副本；
- 变量、角色动态 State、背包、好感度；
- 运行时 Setting Diff、JSON Patch、Overlay 或 CoW；
- 世界线 Resource Fork 与回退；
- 全局 Resource 与 Card Resource 的最终 Resolution；
- Preset 与模型选择重构；
- 结构化 Resource 自动去重；
- 网络 Registry、URL fetch、版本求解或 lockfile；
- PNG 二进制写回、Asset Store 与 GC；
- 新建 `AuthoringWorkspace`。

这些能力必须由真实变量、资源共享或社区分发需求重新触发，不能为了保留 Workspace 名称而提前建设。

---

## 7. 风险与控制

### 7.1 资源引用失效

风险：Card 或 Session 引用的 Prompt Resource 被删除后，PromptBuild 无法继续。

控制：缺失、重复或错误 Document Type 的 Resource ID 必须明确失败，不静默跳过。

### 7.2 前端过度依赖 Workspace 树

风险：UI 把 `contextAssets` 当成一个可随意重排的巨大树。

控制：前端视图由 Card Resource IDs 与各 Resource root node 组装；跨 Resource 排序写回 Card ID 顺序，Resource 内排序写回对应 Resource Document。

### 7.3 当前命名误导

迁移已完成，对外交换对象统一称为 `CardBundleArtifact`；内部文件名若仍保留历史名称，不构成运行时领域概念。

---

## 8. 完成定义

本计划完成时应满足：

```text
Card 是资源清单。
Resource 是平铺、独立、可复用的编辑对象。
Session 只保存启动时解析出的 Resource IDs。
PromptBuild 不知道 Workspace。
Export 不依赖 Workspace。
PromptWorkspace 不再是运行时 Document Type。
```

完成后再将经代码和测试证明的事实写入 `docs/architecture`，并把本计划标记为 Implemented。
