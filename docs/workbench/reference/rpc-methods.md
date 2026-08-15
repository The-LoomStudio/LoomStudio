# 全量 RPC 方法速查 (RPC Methods)

Loom Studio 使用统一的 JSON-RPC-like 协议跨进程通讯。本列表收录了内核层 (`kernel`) 和应用层 (`application`) 所有暴露的 RPC 方法。

## 1. Kernel RPC (内核级方法)

内核 RPC 主要处理最底层的基础设施：系统探测、文档读写、事件订阅和可观测性。
这些方法由 `packages/kernel/src/index.ts` 注册，`owner` 为 `kernel`。

### System
- **`system.ping`**: 心跳测试，返回 `serverTime`。
- **`system.getInfo`**: 获取内核与协议版本号，能力枚举。
- **`system.introspect`**: 暴露当前内核中注册的所有 RPC、Event 等映射，供 Studio Client 动态探测能力。

### Document Store
- **`docs.get`**: 根据 ID 获取单个 Document 的完整内容。
- **`docs.list`**: 获取匹配类型的文档列表。
- **`docs.write`**: 创建或更新文档，会触发 `docs.changed` 事件。
- **`docs.delete`**: 删除文档。

### Extensions
- **`extensions.listPackages`**: 返回插件管理初始快照，包括 Package 展示元数据、`tags`、受控 `iconUrl`、不泄露物理目录的 `sourceKinds`、可用性、声明式资源和各 Module 的 desired/runtime 状态。
- **`extensions.installPackage`**: 从本地 `sourceDirectory` 安全安装 Manifest v2 Package。
- **`extensions.uninstallPackage`**: 删除指定 installed Package 版本；不删除其 Document 与 Media Asset。
- **`extensions.enableModule`**: 使用 `packageId + moduleId` 持久化启用选择与事件 / Asset grant；Server Module 会被激活或按需 reload。
- **`extensions.disableModule`**: 持久化禁用目标 Module；Server Module 的当前 instance 会被释放。
- **`extensions.reloadModule`**: 重新加载一个已启用 Server Module，不改变 sibling Module。
- **`extensions.getDiagnostics`**: 按可选 `packageId + moduleId` 查询发现、激活、运行与清理 Diagnostics。

### Observability
- **`diagnostics.list`**: 获取系统范围内的所有诊断信息 (Diagnostics)。
- **`trace.list`**: 获取最近运行的 Trace。
- **`audit.list`**: 获取审计日志。

### Runtime
- **`loom.run`**: 将 `Fragment[]` 与 `PassConfig[]` 提交给 `@loom/core` 进行管线执行。

---

## 2. Application RPC (应用层方法)

这些是由 Airp (Application Runtime) 提供的特定领域能力，定义在 `apps/studio-server/src/application-rpc.ts` 中。

### Provider & Model
- **`application.createProviderAccount`** / **`getProviderAccount`** / **`listProviderAccounts`** / **`updateProviderAccount`** / **`deleteProviderAccount`**
- **`application.createModelProfile`** / **`getModelProfile`** / **`listModelProfiles`** / **`updateModelProfile`** / **`deleteModelProfile`**
- **`application.pingModelProfile`**: 测试特定模型端点的联通性。

### Card 与导入导出
- **`application.createCard`** / **`getCard`** / **`listCards`** / **`updateCard`** / **`deleteCard`**
- **`application.importCardBundle`**: 导入自包含 Card Bundle，在同一事务中创建 Card、平铺 Prompt Resources 与 Import Bundle。
- **`application.updateCardPromptResources`**: 以有序 `promptResourceIds` 更新 Card Manifest；拒绝重复、缺失或非 Prompt Resource 引用。
- **`application.exportCardArtifact`**: 从 Card 的有序 Prompt Resource IDs 导出当前自包含 Artifact。
- **`application.getImportBundle`**: 按 Card 保存的 `importBundleId` 查询独立导入来源与兼容数据。

### Agent 配置与 Session
- **`application.createAgentPreset`** / **`getAgentPreset`** / **`listAgentPresets`** / **`updateAgentPreset`** / **`deleteAgentPreset`**
- **`application.createAgentLocalBinding`** / **`getAgentLocalBinding`** / **`listAgentLocalBindings`** / **`updateAgentLocalBinding`** / **`deleteAgentLocalBinding`**
- **`application.createAgentSession`** / **`getAgentSession`** / **`getAgentMessagePage`** / **`deleteAgentSession`**
- **`application.previewAgentTurn`**: 构造本轮 Prompt 与 Provider payload，但不持久化 Agent Message 或 Narrative Node。
- **`application.invokeAgentTurn`**: 调用 Provider 并提交 Agent Message；可选在同一 Changeset 中提交 Narrative Node。

### Narrative Timeline
- **`application.createNarrativeTimelineFromCard`**: 从 Card 当前版本创建 Timeline、初始 Branch 与 Opening Nodes。
- **`application.getNarrativeTimeline`** / **`getNarrativePage`**
- **`application.forkNarrativeBranch`** / **`switchNarrativeBranch`** / **`deleteNarrativeTimeline`**

### Prompt Resource
- **`application.getPromptResource`**: 按 `resourceId` 读取一个 Prompt Resource。
- **`application.listCardPromptResources`**: 按 Card Manifest 中的顺序读取全部 Prompt Resources。
- **`application.createPromptResourceAsset`** / **`updatePromptResourceAsset`** / **`updatePromptResourceAssets`** / **`movePromptResourceAsset`** / **`deletePromptResourceAsset`**: 只修改指定 Resource Document；跨 Resource move / batch update 当前明确拒绝。

## 3. Media Asset HTTP 数据面

大型字节不进入 JSON-RPC：

- **`POST /assets`**: raw body 上传，使用 `Content-Type` 与 `X-Loom-Asset-Kind` 创建 Media Asset；
- **`GET /assets/:assetId`** / **`HEAD /assets/:assetId`**: 按稳定 Asset ID 读取字节和 metadata headers。

## 4. Extension HTTP 数据面

- **`GET /extensions/:packageId/:version/icon`**: 读取 Manifest 声明的 Package 图标；只支持 Package 内的 PNG/JPEG/WebP/GIF，不暴露源目录。
- **`GET /extensions/events`**: 建立 SSE 连接并推送 `extensions.changed`。初始和刷新后的完整状态仍通过 `extensions.listPackages` 获取。
