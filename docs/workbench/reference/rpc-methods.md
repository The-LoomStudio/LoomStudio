# 全量 RPC 方法速查 (RPC Methods)

Loom Studio 使用统一的 JSON-RPC-like 协议跨进程通讯。本列表收录了内核层 (`kernel`) 和应用层 (`application`) 所有暴露的 RPC 方法。

## 1. Kernel RPC (内核级方法)

内核 RPC 主要处理最底层的基础设施：系统探测、文档读写、事件订阅和可观测性。
这些方法由 `packages/kernel/src/index.ts` 注册，`owner` 为 `kernel`。

### System
- **`system.ping`**: 心跳测试，返回 `serverTime`。
- **`system.getInfo`**: 获取内核与协议版本号，能力枚举。
- **`system.introspect`**: 暴露当前内核中注册的所有 RPC、Event 等映射，供 Studio Client 动态探测能力。

### Events
- **`events.subscribe`**: 订阅服务器事件。
- **`events.unsubscribe`**: 取消事件订阅。

### Document Store
- **`docs.get`**: 根据 ID 获取单个 Document 的完整内容。
- **`docs.list`**: 获取匹配类型的文档列表。
- **`docs.write`**: 创建或更新文档，会触发 `docs.changed` 事件。
- **`docs.delete`**: 删除文档。

### Extensions
- **`extensions.list`**: 列出当前 Extension Host 加载的所有插件状态。
- **`extensions.getDiagnostics`**: 获取指定插件的加载或运行错误。

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

### Card & Agent Runtime Profile
- **`application.createCard`** / **`getCard`** / **`listCards`**
- **`application.importCardBundle`**: 导入自包含 Card Bundle，在同一事务中创建 Card、平铺 Prompt Resources 与 Import Bundle。
- **`application.exportCardArtifact`**: 从 Card 的有序 Prompt Resource IDs 导出当前自包含 Artifact。
- **`application.getImportBundle`**: 按 Card 保存的 `importBundleId` 查询独立导入来源与兼容数据。
- **`application.createAgentRuntimeProfile`** / **`getAgentRuntimeProfile`** / **`listAgentRuntimeProfiles`** / **`updateAgentRuntimeProfile`** / **`deleteAgentRuntimeProfile`**

### Session & Timeline
- **`application.createSession`**: 创建全新会话。
- **`application.createSessionFromCard`**: 从现有角色卡创建会话。
- **`application.getSession`**: 获取会话详情与分支树。
- **`application.getTimeline`**: 获取会话中某个分支的用户可见叙事时间线。
- **`application.getAgentTranscript`**: 获取智能体的真实日志 (包含系统级思考、底层交互)。
- **`application.forkBranch`**: 从时间线的特定位置分叉。

### Prompt Resource
- **`application.getPromptResource`**: 按 `resourceId` 读取一个 Prompt Resource。
- **`application.listCardPromptResources`**: 按 Card Manifest 中的顺序读取全部 Prompt Resources。
- **`application.createPromptResourceAsset`** / **`updatePromptResourceAsset`** / **`updatePromptResourceAssets`** / **`movePromptResourceAsset`** / **`deletePromptResourceAsset`**: 只修改指定 Resource Document；跨 Resource move / batch update 当前明确拒绝。

### Prompt
- **`application.previewPrompt`**: 在不提交真实对话的情况下，预览编译后发给模型的 Prompt。

### Core Turn Flow
- **`application.submitTurn`**: 向当前会话分支提交一次回合操作，触发 AI 生成流程。

### Run Trace
- **`application.getRun`**: 获取特定一次 `submitTurn` 产生的所有过程数据 (Run)。
