# Host Kernel 重塑与平台架构收敛计划

状态：P1–P5 与 Wave 6–8 工程实施、全套测试迁移与独立审计收口均已通过验证（15→7 包收敛、Kernel 零应用层依赖、`dashboard.createBackup` UI 与 SQLite 热备份、卡片媒体 `?v=` 不可变缓存、`InspectorPanel` 三账本联查与单元测试、`extension-module-batches` Query 迁移及全量 Vitest/扩展/导入器检查通过）；待人工 UI 验收与归档收口；2026-11-17。

---

## 1. 目标与不可化约基线（去壳留骨）

### 1.1 核心重构策略

本计划采取**“去壳留骨”**策略：卸下早期“全系统通用微内核 + 万物皆 Document + 15 个细碎内部包 + 外部零散状态文件”的过重外壳，同时在全仓源码中死死守住已经过实践验证的 **6 条不可化约领域契约**：

1. **单一运行事实与叙事分支指针投影**（[Agent Runtime 与 Session](../../architecture/application/agent/runtime-and-session.md)）：`AgentTranscript` 为 append-only 唯一运行事实，不绑定厂商 `messages[]` 格式；`NarrativeNode` 仅保存索引与稳定楼号（`floor`）；`Branch` 与恢复点同时锁定 `Transcript Head + State Revision + Workspace Revision` 三位一体指针。
2. **预设树独裁物理顺序 + Anchor/Slot 注入 + 单次同步线性 DFS**（[PromptBuild 架构](../../architecture/application/prompt-build/README.md)）：结构化组装走 `Anchor/Slot`，纯标量替换走 `Macro`，运行期按需查阅走 `Agent Tool`；编译器输出可审计 Trace，且 `Provider Adapter` 对 Card/Session 保持盲态。
3. **五层消费解耦**（[Timeline 扩展采用](../../architecture/application/extension/timeline-participation.md)）：严格区分 **安装 ≠ 启用 ≠ 预设挂载（`LoreMount` / `preset_tool_mounts`） ≠ 故事采用（`Timeline Adoption` 代次租约） ≠ 本轮激活**，依靠初始化快照冻结与 `withTransactionGuard` 代次校验拦截过期任务写入。
4. **双通道工具协议与受控 VFS**（[工具系统](../../architecture/application/agent/tool-system.md)）：短结构化参数走 `Native Function`，长正文与补丁走流式剥离的 `loom-content-v1`（`Content Tool`）；通过 QuickJS Worker 与受控 VFS 暴露 `/narrative/<floor>.md`、`/state/data/`、`/resources/`、`/workspace/`，强制先读后写基线 CAS 与游玩/作者双视图审批。
5. **单连接 FIFO 事务引擎与物理资产隔离**（[Data 架构](../../architecture/data/README.md)）：SQLite 单连接读写 FIFO 串行 + `BEGIN IMMEDIATE` + 统一 `changesets`；二进制大文件按 SHA-256 进 `Blob/AssetStore`，系统凭据进 `SecretStore`，绝不以 Base64 或明文污染控制面 JSON。
6. **场景驱动与生态兼容隔离**：内核绝不原生理解 SillyTavern 的 EJS/MVU 或特定世界规则，所有兼容适配与垂类玩法规则统一关在扩展与兼容包边界之内。

### 1.2 工作区既有改动保护红线

当前工作区存在以下与既有任务相关的未提交修改，全阶段施工期间**严禁覆盖、重置或混入无关改造**；后续若阶段触及这些文件，必须在既有改动基础上最小叠加：
- `packages/application-runtime/src/runtime/loom-scripts-runtime.ts`
- `apps/studio-client/src/features/loom-scripts/model/use-scoped-script-editor.ts`

---

## 2. Host Kernel 宪法级定位、API 三层边界与数据原语

### 2.1 宪法级定位与双路径正门

> **Host Kernel 是“无叙事语义的宿主底座与多租户资源管理器”。**
> 它只认识「事务、字节、凭据、执行实例、身份权限、动态路由与事实事件」；绝不认识「角色卡、时间线、楼层、提示词树或对话轮次」。

- **第一方主业务直连正门**：`Studio Client (typed tRPC) → ApplicationRuntime → ApplicationData` 是第一方叙事业务的正式正门，不再视为“绕过 Kernel”。
- **扩展与脚本先过内核门禁**：一切第三方扩展与 `.loom.js` 脚本严禁直接与 Application 裸连，必须先由 `Host Kernel` 签发不可伪造的身份、生命周期 `Scope` 与隔离存储空间，再通过 `Application` 暴露的唯一受控插槽 `extensionPorts` 参与叙事流程。

### 2.2 五大核心维度职责矩阵

| 维度 | 主权归属 | Host Kernel 负责什么（支持面与约束面） | Host Kernel 明确不碰什么 |
| --- | --- | --- | --- |
| **1. 数据 (Data)** | 物理底座与租户隔离存储归 **Kernel**；领域 SQL 表归 **Application** | 1. 掌管唯一 SQLite 串行引擎（`DataEngine`）、提交前 `withTransactionGuard` 与 `changesets`；<br>2. 掌管 `Blob/AssetStore`、`SecretStore`、热快照备份与 Safe Container I/O；<br>3. 收回 `DocumentStore` 仅作内部隔离引擎，按 `(packageId, installationTarget)` 分配 Config / Record / 文件目录与门禁状态表。 | 不定义 `Transcript`、`Narrative`、`PromptResource`、`State` 等业务表；**彻底废除对前端裸露的 `docs.*` 后门**。 |
| **2. 进程与执行单元 (Process / Units)** | **Host Kernel** 拥有统一生命周期底座 | 1. 五阶启动序列、`<dataRoot>/loom.lock` 目录独占锁与镜像倒序停机排空；<br>2. **统一接管 Server 扩展模块、`.loom.js` 脚本与受管子 Worker**：合并双宿主，停用或重载时连根拔除其 RPC、监听与定时器。 | 不理解沙盒内部映射的业务 VFS 路径语义（如 `/narrative/<floor>.md`、`/state/data/` 仍归 Agent 模块）。 |
| **3. AI Gateway** | 站在 Kernel 底座上的**独立平台子系统** | 1. 通过 `SecretStore` 锁死 API Key 读取权（仅授信 Gateway 读取明文，扩展只能传 `profileId` 代发）；<br>2. 托管扩展注册的自定义 `ProviderAdapter` 或 `AICapabilityId` 生命周期句柄。 | Kernel 不解析模型参数；Gateway 不认识 Card、Session 或 Lore。 |
| **4. Prompt Build** | 100% 归 **Application** | 对扩展注册的 `PromptProcessor` 与宏提供者做包命名空间前缀与权限校验，并提供实例存活状态与 `installationVersion` 供编译器记录依赖租约。 | 预设有序树、`Anchor/Slot` 挂载、激活求值与单次同步 DFS 遍历全在 `ApplicationRuntime` 内闭环。 |
| **5. Agent Run** | 100% 归 **Application** | 1. 调用扩展工具时注入不可伪造的扩展 `actor` 身份并穿透 `AbortSignal`；<br>2. 借 `withTransactionGuard` 拦截过期租约迟到写入；<br>3. 提供轻量状态通知通道。 | `AgentSession`、canonical `Transcript`、双通道工具循环、自管直播流与动态审批回调全归 `ApplicationRuntime`。 |

### 2.3 API 与 Endpoint 三层注册边界

`Host Kernel` 保持**传输协议无关（Transport-agnostic，不直接绑定 `node:http`）**，对外入口分为三层：
1. **HTTP 会话与字节流端点（`studio-server` 薄传输壳）**：负责 Origin/Session 鉴权、连接排空与原生二进制流（`/assets/:id`、Card 导入导出压缩包、SSE 推送）。**硬禁令：严禁第三方扩展直接注册裸 HTTP 路由**。
2. **第一方静态业务与宿主管理 API（`AppRouter` typed tRPC）**：`application.*`、`ai.*`、`settings.*` 与宿主管理 `extensions.*` 直连对应服务，废除 `tRPC → kernel.callRpc('extensions.xxx') → extensionManager` 的回旋镖转发；移除 `platformRouters.docs` 通用后门。
3. **动态扩展接口与包资源网关（`Host Kernel` 注册表）**：扩展只可注册包命名空间下的动态 RPC（`<packageId>.<method>`，绑定 owner 与 `global/card` target），前端通过唯一的 `extensions.invoke` 网关调用；文件/媒体通过 `ctx.assets` 或包静态文件网关读取。

### 2.4 四大高阶数据原语分工

| 能力 | Kernel 的职责 | 领域 Owner 的职责 | 核心约束 |
| --- | --- | --- | --- |
| **Changeset（提交账本）** | 100% 拥有：每次 `DataEngine.transact()` 自动分配 `changesetId`，将操作摘要写入 `changesets` 表 | 在事务内诚实调用 `tx.recordOperations(...)` 上报实体身份、版本与归属范围 | Changeset 是跨表因果审计账本与失效信标，**不是全库行级恢复快照**。 |
| **回滚性（Rollback / Undo）** | 拥有未提交事务的物理 `ROLLBACK`（含 `withTransactionGuard` 拦截）与底层文档补偿写入 | **各自拥有已提交历史的补偿算法**：`State` 从父快照生成补偿 Revision；`Narrative` 事务内执行 `restoreBranch` 指针回拨 | **严禁 Kernel 提供按 `changesetId` 盲目倒退全表的通用物理回滚**；所有撤回均表现为往前提交的新事务。 |
| **备份与恢复保护（Backup）** | 独占 `DataEngine` FIFO 队列，提供在线一致性热快照（WAL checkpoint / `VACUUM INTO`）与“SQLite 快照 + SHA-256 Blob 清单”备份原语 | 触发维护或 Schema 变更前调用保护快照 | 消除热拷 `.sqlite/-wal/-shm` 损坏风险；将扩展开关与门禁表收进 SQLite 后，一套快照完整覆盖全部控制面。 |
| **解包与压缩（Safe Container I/O）** | 收编 [`zip-checksums.ts`](../../../apps/studio-server/src/codecs/zip-checksums.ts) 等容器校验逻辑，提供流式 ZIP/PNG 安全原语 | 接收干净字节或临时目录后校验 `loom.cardBundle@v4`、`loom-timeline-archive.v2` 与 `manifest.json` 语义 | 内置硬安全预算：最大条目数、防 Zip Bomb 解压字节上限、CRC32 校验、`../` 路径穿越与软链拦截、staging 原子替换。 |

### 2.5 五阶启动序列与镜像逆序排空

1. **Stage 0 · 引导自检**（[`scripts/start.mjs`](../../../scripts/start.mjs) / 未来桌面壳）：校验 Node `>= 24.22.0` 与构建产物完整，解析只读安装目录与平台隔离 `dataRoot`。
2. **Stage 1 · 目录独占锁**（修复现存换端口双开毁库隐患）：在碰数据库前先独占锁定 `<dataRoot>/loom.lock`（记录 PID / 启动时间 / 端口）；存活实例拒绝重入并给出提示，死锁安全接管，挂载根日志器与信号钩子。
3. **Stage 2 · Host Kernel 内核态冷启动**（修复 [`server.ts`](../../../apps/studio-server/src/server.ts) 构造期同步建表副作用）：保持 `createStudioServer(options)` 同步返还句柄签名（仅保留纯参数前置校验），将数据库版本预检、自动保护快照、`DataEngine` 开库、`SecretStore / AssetStore` 唤醒及 `ExtensionState` 入库全部下沉到 `listen()` 异步序列，此时不跑任何扩展代码。
4. **Stage 3 · Application 领域层挂载与崩溃自愈**：挂载 `ApplicationData`、压平后的 `AI Gateway` 与 `ApplicationRuntime`（含收回自管的 Run/审批服务），执行 Card 目录未竟恢复与孤儿 `running` Run 状态修复（绝不自动偷跑模型），将 `runtime.extensionPorts` 与 `runtime.scopeValidator` 一次插入 Kernel。
5. **Stage 4 · 租户激活与端口开门**：Kernel 按顺序唤醒已启用的扩展与 `.loom.js` 脚本，发出 `system.ready`，最后绑定 `127.0.0.1` HTTP 端口对外接流。

停机严格按镜像倒序排空：HTTP 拒收新请求（503）→ 触发 `AbortController` 并等待在途请求收敛 → Kernel 发 `system.stopping` 并 `disposeAll` 全部扩展、脚本与受管 Worker → 重试密钥清理与冲刷观测缓存 → `DataEngine` 排空 FIFO 队列后关闭 SQLite → 释放 `<dataRoot>/loom.lock` 并关闭日志器。

---

## 3. 四大横向联动子系统定调方案

### 3.1 事件与实时流彻底分家（「小纸条广播」vs「专属直播间」）

1. **Kernel 管「小纸条广播」（仅存持久化事实 + 归属标签前置）**：
   - 在写入源头为 `DataCommitOperation.scope` 增加可信归属标签（`cardId / timelineId / installationId`），只承载轻量实体失效标识（`store / kind / entityType / entityId / version / scope`），绝不承载正文大包；若单次事务操作数超批量阈值，自动折叠为按 `store + scope` 聚合的 `overflow: true` 范围失效提示。
   - **直接下线**：`docs.changed` 兼容投影事件、[`kernel`](../../../packages/kernel/README.md) 的 64 KiB 分片器（`splitCommitPayload`）、前端 [`data-commit-events.ts`](../../../apps/studio-client/src/shared/api/data-commit-events.ts) 的 4 MiB / 10 秒重组缓冲，以及服务端 [`extension-event-projection.ts`](../../../apps/studio-server/src/extensions/extension-event-projection.ts) 的逐片跨表反查过滤逻辑。
   - **保留下游兼容性**：客户端 `use-narrative-runtime.ts` 与 `use-timeline-session.ts` 依赖 `entityType / entityId / kind / scope.entityId` 做精确失效判断，新小纸条保留这些轻量字段（`overflow` 时触发对应范围宽失效）。
2. **Application 管「专属直播间」（高频流式输出收回 Runtime）**：
   - AI 增量吐字（`text-delta` / `reasoning-delta`）、工具实时进度与动刀签字暂停请求，由 `ApplicationRuntime` 直接管理并通过专用订阅流推送给当前窗口，不进入 Kernel 事件总线。

### 3.2 日志、故障黑匣子与模型账单串联（「快递单号」贯穿三本账）

- 在 tRPC / HTTP 请求与扩展后台任务进门时由宿主统一签发追踪单号（`traceId / correlationId`），全程穿透到底层；
- 普通运行日志（JSONL）、Kernel 扩展故障黑匣子（`Diagnostics`）、`ObservationStore` 提示词构建快照与 `StatisticsStore` 模型用量账单**各自独立落盘，但共享同一 `traceId`**，前端排查面板按单号实时聚合，无需把高吞吐日志与大体积 Trace 硬塞进同一张表。

### 3.3 脚本与沙盒执行分流（「长工」vs「10 秒临时工」）

- **`.loom.js` 脚本作为受控长工并入唯一 `ExtensionHost`**：废除 [`server-script-runtime.ts`](../../../packages/kernel/src/script-runtime/server-script-runtime.ts) 私建的第二个 `ExtensionHost` 实例，统一纳管启停、热重载与销毁清理。
- **`CodeAct` 作为 10s / 16MiB 临时工**：平台层提供干净无外网无 FS 的 QuickJS Worker 沙盒池与超时熔断器；每次唤醒往房间内挂载哪些 `/narrative/<floor>.md`、`/state/data/`、`/resources/` VFS 数据视图，仍由 `ApplicationRuntime` 的 Agent 模块按当前授权范围控制。

### 3.4 权限与审批分层（「静态门禁卡」vs「动态施工签字单」）

- **Kernel 管静态门禁卡**：插件安装与启用时授予的 `assets / events.subscribe / ui.notify` 等静态 Capability 账本，由 Kernel 统一校验与持久存储。
- **Application 管动态故事采用与运行期施工签字**：故事是否采用某扩展（`Timeline Adoption`）以及 AI 修改世界书/State/剧情正文时的实时审批策略（`ask / allow / deny`、`mutationApprovals` 挂起弹窗），由原滞留 Server 层的 [`agent-run-service.ts`](../../../packages/application-runtime/src/agents/agent-run-service.ts) 收回 `ApplicationRuntime` 统一掌控（原 `apps/studio-server/src/agents/agent-run-service.ts` 过渡垫片已删除）。

---

## 4. 流向图检验发现的 5 项再精简（S1–S5）与全仓核查事实

通过全仓源码调用链检索与流向拓扑检验，确认以下 5 项结构精简可直接落地：

1. **前置利好：裸 `docs.*` 后门生产态已零调用**
   全仓排查确认 `apps/studio-client`、`scripts/`、`extensions/`、`official/` 对 `docs.get/list/write/delete/revertChangeset/getChangeset` 已**零调用**（Provider、Capability Profile、Agent Tool、Network Settings 与 Extension Storage 已全部走 typed tRPC）。可直接移除 [`trpc/kernel.ts`](../../../apps/studio-server/src/rpc/trpc/kernel.ts) 的 `platformRouters.docs`、Kernel 的 `docs.*` 内置 handler，以及 `client-bridge.ts` / 测试辅助文件中的 `'docs'` 命名白名单（同步迁移 `apps/playground` 与 7 个旧平台测试调用）。
2. **S1 · 动态扩展网关二合一（→ `extensions.invoke`）**
   将 `kernel.invoke` 与 `extensions.callPackageRpc` 合并为唯一强约束入口 `extensions.invoke({ packageId, target, method, params })`，消除 [`client-bridge.ts`](../../../apps/studio-client/src/shared/api/client-bridge.ts) 维护 11 个命名空间前缀的白名单猜测逻辑，并同步替换 `studio-api.ts`、`use-client-extension-runtime.ts`、`client-extension-host.ts` 与服务端 `import-batch.ts` 调用。扩展内部与 Worker 调用的 `ctx.rpc.call` 签名不变，外部扩展代码零改动。
3. **S2 · `AI Gateway` 三层套娃压平成单实例**
   将 `createAiGateway` + `createDocumentBackedAiGateway` + `createObservedAiGateway` + `createDocumentBackedProfiledAiGateway` 收敛为单一网关实例，消除两套重复写入 `ObservationStore` 与 `StatisticsStore` 的实现。重点修正 [`extension-application-adapter.ts`](../../../apps/studio-server/src/extensions/extension-application-adapter.ts) 此前伪造 `sessionId: 'extension-direct'` 的缺陷：因 `StatisticsStore.track` 会用 `sessionId` 反查 `agent_sessions` 推导归属，扩展直调改为传 `sessionId: undefined`、显式 `timelineId` 与清晰 `purpose`（如 `'extension-model'` / `'extension-capability'`），同时保留 `ObservationStore` 所需的 `origin`、`request.capability` 与 `firstOutputMs` 字段契约。
4. **S3 · 扩展状态入 SQLite 消灭双存储分裂**
   将 [`extension-state-store.ts`](../../../packages/kernel/src/extension-manager/extension-state-store.ts)（`extensions-state.json` / `state.json`）、`official-extension-setup.json` 与 `dev-links.json` 迁入共享 `DataEngine` 系统表（`platform.extension-state@1`，启动加载时保留内存同步快照并支持一次性迁移导入旧 JSON），使 `SqliteDataEngine.backup`（`VACUUM INTO`）与 `dashboard.createBackup` 在线热快照一次备份完整覆盖插件开关与门禁授权，且启停状态可与卡片资源变更进入同一物理事务。
5. **S4 · 7 个散养 Registry 收口为单一 `extensionPorts`**
   在 `ApplicationRuntime` 内部按无环顺序装配（`基础 Store → 7 个 Registry [aiCapabilities 先行] → providerAdapters → 统一 Gateway → ctx`），对外仅暴露单一 `runtime.extensionPorts` 与 `runtime.scopeValidator`（吸收 [`extension-application-adapter.ts`](../../../apps/studio-server/src/extensions/extension-application-adapter.ts) 原本跨表校验的 `validateStorageScope / validateEntityRef`）。彻底消除 [`server.ts`](../../../apps/studio-server/src/server.ts) 顶层创建的 7 个散变量、3 处重复参数透传以及 `ApplicationRuntimeOptions` 冗余入参。
6. **S5 · 摘除完成事件重包，下线 `acknowledge-completion` 握手**
   将完整的 `projection`、`promptBuildTrace`、`toolPromptBuildTrace` 与 `macroInspection` 直接补入已存在的 `ObservationBuild` 记录（按 `buildId` 落盘），从 `InvokeAgentTurnResult` 与 Agent Run `completed` 事件中移除这些大体积 Trace 字段，保留轻量结果与 `buildId` / `runId`。同步删除 `pendingCompletion` 两分钟内存暂存、`agent.run.acknowledge-completion` RPC 及前端 `use-session-run.ts` / `use-narrative-runtime.ts` 上报确认逻辑，修改 `inspector-panel.tsx` 等 8 个前端关联文件改为展开排查面板时按 `buildId` 懒查询。

---

## 5. Monorepo 包合并红线与目标矩阵（15 → 7）

经全仓包引用拓扑与扩展构建脚本核查，外部生态存在不可突破的包名与导出红线：

### 5.1 外部兼容与共享红线

1. **`@loom-studio/ui`**：`apps/studio-client/build/extension-shared-modules.ts`（浏览器运行时 `importmap`）及 `story-memory` / `the-world` 构建脚本显式声明为 `external`，**包名与公共导出不可改动**。
2. **`@loom-studio/extension-sdk`**：所有第一方与第三方扩展的公共 SDK 契约入口，须保持导出稳定（可内联或重导出原先从被合并微包透传的少数纯类型），同时将嵌套其中的子包 `packages/extension-sdk/extension-host` 迁出并入 `@loom-studio/kernel`。
3. **`@loom-studio/shared`**：`st-data-compat`、前后端及测试共同依赖的纯 JS 基础包（可安全吸收仅 100 行的 `@loom-studio/tokenizer`，**严禁引入任何 `node:*` 原生依赖**）。
4. **`@loom-studio/logging`**：保持浏览器主入口与 `@loom-studio/logging/node` 子入口（[`check-workspace.mjs`](../../../scripts/checks/check-workspace.mjs) 显式校验双端导出）。

### 5.2 目标包收敛矩阵（15 个包路径 → 7 个高内聚包 + 3 个 Apps）

| 目标包名 | 合并吸收的原包与职责来源 | 核心定位 |
| --- | --- | --- |
| **`@loom-studio/shared`** | 原 `shared` + `tokenizer` | 浏览器/Node 通用基础工具、JSON 契约与分词估算（零领域语义、零 Node 依赖）。 |
| **`@loom-studio/logging`** | 保留原 `logging` | 前后端同构日志与 `/node` 文件落盘读取器。 |
| **`@loom-studio/ui`** | 保留原 `loom-ui` | 领域无关 UI 原语与扩展共享设计系统。 |
| **`@loom-studio/extension-sdk`** | 原 `extension-sdk`（剥离嵌套 `extension-host`） | 扩展与脚本的纯契约 SDK 与类型自包含入口。 |
| **`@loom-studio/kernel`** | 原 `kernel` + `extension-host` + `data-engine` + `document-store` + `asset-store` + `secret-store` + `diagnostics` + 从 `studio-server` 下沉的扩展管理器/脚本宿主/安全容器/进程锁 | **Host Kernel 宿主内核与共享物理底座**。 |
| **`@loom-studio/ai-gateway`** | 原 `ai-gateway` + `application-runtime/src/providers/` 压平整合 | 压平后的单实例模型网关与适配器（保留 `/contracts` 纯类型子入口）。 |
| **`@loom-studio/application-runtime`** | 原 `application-runtime` + `application-data` + 下沉收回的 `agent-run-service.ts` | **完整叙事业务层与持久领域 Store**（消除跨包 DTO 重复定义）。 |

`apps/studio-server` 彻底收敛为薄 HTTP/tRPC/SSE 组合根与本地文件目录服务；`apps/studio-client` 与 `apps/playground` 保持应用层角色不变。

---

## 6. 五阶段零踩踏执行路线图

> **核心工程纪律**：**Phase 1–3 在现有包目录内完成逻辑换骨与契约收口，Phase 4 再使用 [`migrate-imports.ts`](../../../scripts/dev/migrate-imports.ts) 执行纯机械目录合并与路径改写**，严禁把“改业务逻辑”和“大规模物理搬家”混在同一个提交阶段。

| 阶段 | 目标与合并项 | 核心触达面与防踩坑要点 | 阶段完成门禁 |
| --- | --- | --- | --- |
| **Phase 1**<br>启动锁、状态入库与路由收口 | 1. `<dataRoot>/loom.lock` + 五阶异步启动下沉至 `listen()`；<br>2. `VACUUM INTO` 在线热快照原语；<br>3. S3：`extension-state-store.ts` 等三份 JSON 状态迁入 SQLite 系统表；<br>4. S1 + 去裸 `docs.*` 后门 + 拉直 `extensions.*` 管理回旋镖。 | • `createStudioServer(options)` 保持同步返回签名与同步参数前置校验，兼容 `persistence-rpc.test.ts:15`；<br>• 状态入库保留首次从旧 JSON 一次性迁移逻辑与内存同步快照；<br>• 清理 `trpc/kernel.ts`、`client-bridge.ts` 11 前缀白名单、统一 `extensions.invoke`，保留扩展内 `ctx.rpc.call`。 | `pnpm check:types`、`pnpm build:packages`、`pnpm build:app` 通过；受影响旧测试标记清单明确。 |
| **Phase 2**<br>双宿主合一、总插槽与容器下沉 | 1. 合并 `extensionHost` 与 `server-script-runtime.ts` 第二套宿主；<br>2. S4：`ApplicationRuntime` 内聚 7 个 Registry，对外仅暴露 `extensionPorts` 与 `scopeValidator`；<br>3. 下沉 [`zip-checksums.ts`](../../../apps/studio-server/src/codecs/zip-checksums.ts) 等容器校验为平台 Safe Container I/O 原语。 | • 在 `extension-host` 的 `registerModule` 增加可选 `grantCapabilities`、`transformContext` 与 `kind: 'extension' \| 'script'`，确保扩展目录列表与 `system.introspect` 过滤脚本模块；<br>• 注意 `ApplicationRuntime` 内部 `aiCapabilities` 必须先于 `providerAdapters` 初始化；<br>• 若触及 `loom-scripts-runtime.ts`，严格保留工作区既有改动。 | `pnpm check:types`、`pnpm build:app` 通过；脚本与扩展可在单一 Host 激活并清理。 |
| **Phase 3**<br>Gateway 压平、Run 收回与事件小纸条 | 1. S2：压平 `AI Gateway` 三层套娃，修复 `StatisticsStore.track` 假 `sessionId`；<br>2. S5：`agent-run-service.ts` 收回 `ApplicationRuntime`，Trace 补入 `ObservationBuild`，删除 `acknowledge-completion` 握手与前端重包耦合；<br>3. 事件小纸条化：前置归属标签与 `overflow` 折叠，移除 64KB 切片器、`docs.changed`、前端 4MB 重组器与服务端反查投影。 | • 前端同步调整 `studio-api.ts`、`use-session-run.ts`、`agent-run-observer.ts`、`use-timeline-session.ts`、`use-narrative-runtime.ts`、`use-studio-state.ts`、`use-studio-derived-values.ts`、`studio-panel-registry.tsx`、`inspector-panel.tsx`；<br>• 保留小纸条中的最小 `entityType / entityId / kind / scope` 失效键，确保 `use-narrative-runtime.ts` 精准失效不退化。 | `pnpm check:types`、`pnpm build:app` 通过；AI 吐字直播、排查按单号懒拉取与 SSE 轻通知链路完整对齐。 |
| **Phase 4**<br>Monorepo 物理并包（15 → 7） | 1. 按第 5 节目标矩阵合并目录与 `package.json`；<br>2. 用 `migrate-imports.ts` 批量迁移引用；<br>3. 对齐发布、检查与死代码配置。 | • 重点同步更新 `tsconfig.packages.json`、[`prepare-release.mjs`](../../../scripts/release/prepare-release.mjs)（清除硬编码 `packages/extension-sdk/extension-host` 路径）、[`check-workspace.mjs`](../../../scripts/checks/check-workspace.mjs) 与 `knip.json`；<br>• 确认 `@loom-studio/ui` 与 `@loom-studio/extension-sdk` 对 `st-data-compat` / `story-memory` / `the-world` 导出零破坏。 | `pnpm check:types`、`pnpm build:app` 与 `check-workspace.mjs` 全绿，`studio-server` 退回薄组合根。 |
| **Phase 5**<br>前端状态单轨化与轻量列表收尾 | 1. 为 `listPromptResources`、`listAgentPresets`、`listLoomScripts` 切换轻量 Summary DTO（不带全文节点树），按需补齐头像缩略图管线；<br>2. 分批将 `cards`、`narrative-runtime`、`extension-renderers`、`provider-settings` 等残留 `useState/useEffect` 缓存迁入 TanStack Query。 | • 严格保护工作区既有的 `use-scoped-script-editor.ts` 改动；<br>• 小纸条事件到达后由统一中心精准触发 `queryClient.invalidateQueries`，避免手写订阅分散在各组件内部。 | `pnpm check:types`、`pnpm --filter @loom-studio/studio-client build` 及 `pnpm lint` 通过。 |

---

## 7. 验证策略与测试迁移纪律

1. **阶段内验证**：每一阶段仅执行最小必要的静态类型与构建验证（`pnpm check:types`、`pnpm build:packages`、`pnpm build:app`、`pnpm check:docs`），不因局部文件改动频繁打断实施流。
2. **Wave 6–8 验收与全量测试落地事实（2026-11-17）**：
   - **Wave 6（内核下沉与收口）**：完成 15→7 包物理合并与 `packages/kernel` 零 `@loom-studio/application-runtime` / `@loom-studio/ai-gateway` 依赖验证；删除 `apps/studio-server/src/agents/agent-run-service.ts` 垫片；落地 `DataCommitOperationScope` 前置归属标签与 `overflow: true` 单帧 `data.changed`；落地 `SqliteDataEngine.backup`（`VACUUM INTO`）与 `dashboard.createBackup`；完成 `ObservationBuild` 三账本排查视图、`sessions`/`official-content`/`state-variables` TanStack Query 迁移及全仓架构文档与链接刷新。
   - **Wave 7（全量测试迁移与门禁通过）**：10 项全量门禁全部通过，包括 `check-workspace.mjs`、`pnpm check:types`、`pnpm test:extensions:typecheck`、`pnpm run build:app`、`pnpm run lint`（0 warnings / 0 errors）、`node scripts/checks/check-docs.mjs`（483 篇 Markdown 链接与生命周期校验通过）、`pnpm test`（482 files / 3356 tests passed）、`pnpm test:extensions`（8 files / 31 tests passed）、`sillytavern-importer`（8 files / 53 tests passed）与 `pnpm run verify:server-extension`（53 checks passed）。
   - **Wave 8（独立审计与收尾补齐）**：补齐全部卡片媒体 `?v=` 版本缓存拼接；在 `DashboardPanel` / `StudioDashboard` 接入 `dashboard.createBackup` 触发与反馈；将 `extension-module-batches.tsx` 轮询迁移至 TanStack Query；清理文档/测试中的残留 `kernel.invoke` 与 `'extension-direct'`；新增 `tests/unit/client/run-troubleshooting-ledgers.test.ts` 覆盖三账本联查并验证相关客户端与集成测试（6 files / 79 tests passed）。
