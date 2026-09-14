# LoomStudio Package 与 Application Runtime 架构收敛调研（2026-09-14）

> **状态**：已归档。Package 与 Runtime 收敛主线完成，审计缺陷已修复；持久化语义与平台 scope 后续决策另行跟踪。
> **调研基线**：当前 `main` 与 2026-09-14 工作树；当前源码和 workspace manifest 优先于旧 Architecture、Plan 或讨论稿
> **范围**：`packages/` 的 package 边界、Store 生命周期，以及 `packages/application-runtime/src/` 的内部领域分类、文件命名和公共合同
> **当前授权**：允许在下方执行合同范围内进行 package 收敛、Application Runtime 内部重组、生命周期修复和公共入口整理；不改变持久化语义、RPC 合同、权限模型或外部发布身份

## 问题摘要

当前仓库可能同时存在两层结构性过度拆分：

1. **Package 层**：多个 Store 被拆成独立 package，但它们共享同一个 SQLite Data Engine，主要由同一个 Application Runtime 消费，也没有自己的完整启动、订阅、关闭和错误恢复生命周期。
2. **Application Runtime 内部**：所有业务最终重新聚合进 `application-runtime` 这个超级 package；内部目录和文件名部分沿袭历史实现，不一定对应真实领域、状态所有权、事务边界和生命周期。

因此当前结构同时表现为：

```text
外部 package 过细
  -> Application Runtime 重新拼装所有 Store
  -> Runtime 内部继续按历史文件和 API 形状分组
  -> 公共 types.ts 与总 Runtime Facade 扩大耦合面
```

> **变更账目说明**：当前工作区截图中的 `+1,093/-329` 不是 Package 合并结果。`+1,093` 由已跟踪改动 `+221`、新建 `workspace-types.ts` 的 `+193`、本 Issue 文档的 `+562`，以及既有未跟踪 `packages/loom-ui` 的 `+117` 组成；合计正好为 `1,093`。其中 `workspace-types.ts` 是从 `workspace.ts` 搬出已有类型，原文件同步删除约 187 行，不是重复实现。

这不是单纯的文件数量或代码风格问题。需要先确认哪些边界确实承载独立生命周期，哪些边界只是物理拆分；未完成证据收集前，不应直接合并 package 或批量移动文件。

## 已确认事实

### Package 层

- 当前 `packages/` 有 8 个 Store 或资源存储 package：`agent-store`、`narrative-store`、`state-store`、`prompt-resource-store`、`document-store`、`asset-store`、`blob-store`、`secret-store`。
- `apps/studio-server/src/main.ts` 集中创建这些 Store，并把它们注入 `ApplicationRuntimeContext`。
- 除 `document-store` 和 `data-engine` 外，多数 Store 没有明确的 `close()` / `dispose()` 公共合同；Server 主要通过关闭共享 Data Engine 结束它们的底层生命周期。
- `agent-store`、`narrative-store`、`state-store` 都直接依赖 `data-engine` 与 `shared`，主要消费者是 `application-runtime` 和相关测试。
- `asset-store` 依赖 `blob-store`；Asset 的业务身份、Owner、媒体元数据和 Blob 字节存储分别存在，但由 Server 手工组装。
- `secret-store` 包含 Keyring 等外部安全副作用，不能仅因它是 Store 就与普通领域 Store 合并。
- `document-store` 同时承担 Document、Revision、Changeset、Data Commit 转接和 SQLite transaction participant，不能简单视为普通领域 Store。

### Application Runtime 内部

- `runtime/runtime.ts` 将 Cards、Narrative、Agents、Prompt、State、Transforms、Providers、Extensions、Loom Scripts 和 Official Content 的方法重新组装成一个 `ApplicationRuntime`。
- `foundation/application-context.ts` 持有几乎所有跨领域 Store、Registry、Gateway、Blob/Asset 能力和运行时辅助函数，是当前内部生命周期的总容器。
- `types.ts` 聚合 Application Runtime API、Agent、Card、Narrative、Prompt、State、Extension、Provider、Tool、Bundle 和请求上下文等多类公共类型，并通过 `index.ts` 大量重新导出。
- `cards/workspace.ts` 不只处理 Card，还处理 Card Bundle、Prompt Resource、State Artifact、Portable Extension Payload、Loom Script 附件、导入导出和资源归一化。
- Agent 逻辑分散在 `agents/`、`agents/official-tools/`、`runtime/agents-runtime.ts`、`runtime/narrative-runtime.ts`、`runtime/prompt-runtime.ts` 和 `runtime/macros-runtime.ts`。
- State 逻辑分散在 `state/`、`runtime/state-runtime.ts`、`runtime/narrative-runtime.ts` 和 `runtime/agents-runtime.ts`。
- `foundation/` 同时包含应用上下文、Document helper、JSON helper、分页、Mutation helper 和 Document 类型；其中部分文件并非真正的基础设施。

以上事实说明当前目录名不能直接作为领域边界证据，必须结合调用链、状态写入者、事务参与者和生命周期释放路径继续核对。

## 待验证问题

### Package 边界

- `agent-store`、`narrative-store`、`state-store` 是否应合并为一个拥有统一生命周期的 Application Data package，还是只需要由 Application Runtime 提供统一 Facade。
- `prompt-resource-store` 是否是独立资源领域，还是应与 Card、State、Bundle 组成更高层的 Workspace Resource boundary。
- `asset-store` 与 `blob-store` 是否应保留物理分离，同时由 Resource/Asset Facade 统一事务和关闭顺序。
- `document-store` 的职责是否已经超过基础持久化层，是否需要拆分“通用 Document”与“Changeset/transaction participant”概念。
- `diagnostics` 与 `trace-audit` 是否过薄到应归入 Observability 基础模块；此项优先级低于领域 Store 调研。
- 各 Store 的测试是否依赖独立 package identity，合并后是否会损失可替换的 In-memory implementation 或 Extension 消费边界。

### Application Runtime 内部

- `runtime/` 是否只是公共 Facade 组装目录，而非真实领域目录。
- `types.ts` 中哪些类型是稳定公共合同，哪些只是内部跨文件共享类型。
- `cards/workspace.ts` 是否应该改名为 Resource Bundle，或按导入导出责任拆分。
- Agent 的执行机制、Agent Session 领域、Tool Registry、官方 Tool 和 Prompt 投影是否应形成明确的内部子系统。
- State Definition、State Projection、State Mutation、State Contribution 和 State Runtime 是否应按生命周期重新归类。
- Prompt Build、Prompt Resource、Macro、Variable、Text Transform 是否是同一个 Prompt/Projection 子系统，还是需要拆成 Composition、Resource 和 Text Pipeline 三个内部边界。
- `foundation/document-store.ts`、`runtime/context.ts` 等文件是否应移动到更准确的 `persistence`、`authorization` 或 `request-context` 位置。
- `runtime/*-runtime.ts` 的命名是否掩盖了实际职责，例如“领域命令/查询”“投影”“初始化”“外部适配器”被统一命名成 Runtime。
- `index.ts` 的宽泛导出是否导致 package 外部绕过 Application Runtime Facade，直接依赖内部领域合同。

## 执行原则

本 Issue 现在同时承担问题记录和执行计划，不另建重复 Plan。实现目标不是单纯减少 package 或文件数量，而是让物理边界重新贴合以下事实：

```text
基础设施拥有基础设施生命周期
领域 Store 拥有领域 schema 与领域校验
Application Runtime 拥有跨领域事务、引用清理和应用服务编排
Server 拥有组合、启动、停止和最终资源释放
```

执行时允许“合并结构”和“修复由结构暴露的问题”在同一批次完成，但必须保持：

- 不修改现有持久化 schema 和资源身份；
- 不改变 RPC method、Extension SDK 作者合同和用户可见业务语义；
- 不引入 Repository、DI Container、通用 Workflow、Event Bus 或新的权限层；
- 不为了目录整齐把真实独立生命周期强行合并；
- 所有公共 API 改动必须保留兼容导出，或在同一批次更新全部消费者和测试；
- 每个子 Agent 只修改自己的写集，主 Agent 负责跨包整合和最终验收。

## 并行执行计划

最多同时运行 3 个子 Agent。每个工作包必须在独立任务上下文中执行，但不创建额外 worktree；子 Agent 只处理分配的写集，遇到公共合同冲突立即停止并报告。

### Batch 0：主 Agent 先完成的共同准备

**写入范围**：

- 本 Issue；
- 必要的执行分支/工作区状态说明。

**任务**：

1. 冻结当前 package 与 Application Runtime 的公共入口清单；
2. 标记现有未提交修改，不覆盖、不格式化无关文件；
3. 确认当前 `main.ts` 是唯一 Server Composition Root；
4. 建立本批次的兼容策略：内部移动优先保留 re-export，package 合并优先保留旧入口迁移期。

**完成条件**：三个并行工作包可以在不修改同一文件的前提下开始。

### Batch 1：三个可并行工作包

#### WP1：Data Bootstrap 生命周期与跨介质恢复

**目标**：修复由 Store/package 边界暴露出的真实生命周期问题，不合并 `data-engine`、`document-store`、`blob-store`、`asset-store`。

**允许写入**：

- `packages/data-engine/src/`
- `packages/blob-store/src/`
- `packages/asset-store/src/`
- `apps/studio-server/src/main.ts`
- `apps/studio-server/src/resource-directories/`
- 对应 Data/Blob/Asset/Card Directory 测试

**实施内容**：

- 为 Data Engine 明确 closing/drain 状态和排队操作语义；
- 确认并修正 Server 停止顺序，保证 HTTP、Kernel、Extension Host、后台 watcher 和事务队列的关闭顺序；
- 明确 Blob 文件先于 SQLite 元数据提交失败时的恢复语义；
- 只在现有契约支持时增加启动 orphan/staging 清理，不凭空引入 GC；
- 定位并验证 Card Directory `recoverApplies`、`recoverDeletions`、`recoverImports` 的启动调用顺序；
- 不把文件系统 journal 塞回 Data Engine。

**验收**：

- 定向覆盖 close 前后排队读写；
- Blob/Asset 失败路径的持久化结果可解释；
- Card Directory 恢复函数在启动路径有明确证据；
- 相关 package typecheck 和定向测试通过。

**停止条件**：需要新持久化状态、跨进程锁、Blob 引用计数、完整 GC 或改变用户可见失败语义时停止并回报。

#### WP2：Application Runtime 内部收敛

**目标**：让 `application-runtime` 的内部文件名、目录和类型来源反映真实职责，同时保持公共 Runtime 行为不变。

**允许写入**：

- `packages/application-runtime/src/`
- `packages/application-runtime/README.md`
- 直接覆盖该包内部结构的定向测试和必要 import

**实施内容**：

- 将 `runtime/runtime.ts` 明确收敛为 Composition/Factory 角色，或采用不改文件名但明确职责的最小方案；
- 优先拆分 `types.ts` 的内部来源，至少区分 Runtime API、请求上下文、领域 Content Contract 和基础设施 Port；
- 拆分 `cards/workspace.ts` 中不依赖跨事务顺序的纯校验、归一化和 Codec 辅助；导入/导出事务编排必须保持完整；
- 将 `foundation/application-context.ts`、`runtime/context.ts` 等文件归入准确的 Composition/Request Context 语义；
- 将 Agent、Prompt、State、Narrative 的 runtime 文件按真实领域归属整理，但不把跨领域应用服务错误下沉到某个 Store；
- 保留旧公共入口的 re-export，禁止直接改公共方法名和 DTO。

**验收**：

- `index.ts` 公共导出保持兼容；
- 包外 import 和内部 import 无深层路径回归；
- Application Runtime 定向测试、typecheck 和相关构建通过；
- 每次文件移动都有明确旧路径到新路径的映射。

**停止条件**：需要修改 Application Runtime 公共方法、DTO、持久化格式或跨领域事务顺序时停止。

#### WP3：公共基础包入口与协议依赖收敛

**目标**：降低 `shared` 和 `ai-gateway` 的错误公共耦合，不把合理的 `transport`、`client-bridge`、`logging` 边界拆散。

**允许写入**：

- `packages/shared/src/`
- `packages/shared/package.json`
- `packages/ai-gateway/src/`
- `packages/ai-gateway/package.json`
- `apps/studio-client/src/entities/`
- `apps/studio-client/src/shared/api/`
- 直接覆盖这些入口的测试、tsconfig 和 package exports

**实施内容**：

- 先按明确子路径收敛 `shared` 的宏、State Contribution、Resource Directory 和 JSON 基础导出；
- 保留旧根入口兼容导出，确认没有包外深层路径断裂；
- 将 Studio-facing Provider DTO 与底层 Provider Adapter/Run 类型分开；
- 让 Client 不再直接依赖底层 `ai-gateway` Provider 类型，除非该类型确实属于跨端合同；
- 暂不把 `ai-gateway` 拆成多个 workspace package；先通过内部模块和 export 面区分 Provider Core、Capability Registry 和 Studio DTO。

**验收**：

- 受影响 Client、Server、Extension SDK 和测试 typecheck 通过；
- Client 不再出现不必要的 Provider adapter 类型 import；
- `shared` 的根入口仍能兼容现有消费者，新增子路径职责清晰；
- 不改变 RPC/Event wire format。

**停止条件**：需要新增 workspace package、改变 Extension SDK public contract 或修改 RPC DTO 才能完成时停止。

### Batch 2：串行整合与生命周期边界

由主 Agent 在 Batch 1 三个工作包完成后执行：

1. 合并各工作包的公共类型和导出变更；
2. 解决 Application Runtime 对 Store 私有表的直接访问，优先处理 State changeset 查询；
3. 明确 `ApplicationRuntime` 是否需要拥有 `close()`，以及它与 Server/Kernel/Store 的责任关系；
4. 补 Kernel `start -> stop -> start` 生命周期回归测试；
5. 检查 `shared`、`ai-gateway`、Store 和 Runtime 的依赖图没有反向依赖或新的循环；
6. 更新 Architecture/README 只记录已实现事实，不提前把候选方案写成稳定规范。

### Batch 3：最终验证与 Issue 收口

**主 Agent 验证**：

- `git diff --check`；
- 受影响 package 的定向 typecheck；
- Data Engine/Store/Kernel/Application Runtime 的定向测试；
- 受影响 Client/Server/Extension contract 测试；
- workspace manifest、exports 和依赖图检查；
- 记录未执行的完整测试、人工验收和剩余风险。

Issue 只有在以下条件满足后才能关闭或转归档：

- 三个工作包的实际改动、偏差和验证结果已记录；
- 没有未解释的失败；
- 公共 API、持久化、权限和 RPC 语义没有被隐式改变；
- 生命周期关闭顺序和跨介质失败语义有明确事实；
- 未完成的大重构候选已转成后续 Issue，而不是伪装成已完成。

历史调研阶段的子 Agent 只做只读调研和文档交付；当前执行阶段的子 Agent 可以在上述明确写集内修改源码和测试。每个工作包必须返回：实际修改文件、行为变化、验证命令及结果、未处理项和停止原因。

### WP-A：Store 与数据生命周期

**范围**：`agent-store`、`narrative-store`、`state-store`、`prompt-resource-store`。

**重点**：

- 创建、初始化、事务、Commit、订阅和关闭路径；
- Store 之间的交叉引用和共同消费者；
- 是否存在独立 package 的真实消费者；
- 合并为 Application Data package 的收益、风险和迁移阻力。

### WP-B：Resource、Document 与文件生命周期

**范围**：`document-store`、`asset-store`、`blob-store`、Card Directory 相关 Server 代码。

**重点**：

- Document、Changeset、Blob、Asset、Source Artifact 的所有权；
- SQLite 与文件系统的跨资源事务边界；
- `AssetStore -> BlobStore` 的生命周期和错误恢复；
- 是否需要 Resource Facade，哪些边界必须保留。

### WP-C：Application Runtime 内部领域地图

**范围**：`application-runtime/src/runtime`、`foundation`、`types.ts`、`index.ts`。

**重点**：

- 每个文件实际提供的命令、查询、投影、编解码或组装职责；
- `runtime/*-runtime.ts` 之间的真实依赖图；
- `types.ts` 的类型归属；
- 文件名与实现职责不一致的高置信候选；
- 不改变行为的最小目录收敛方案。

### WP-D：Agent、Prompt、State 与 Narrative 交叉边界

**范围**：`agents`、`prompt`、`state`、`narrative`，以及它们在 `runtime/` 中的对应实现。

**重点**：

- Agent Turn、Prompt Build、State Projection、Narrative Context 的真实生命周期；
- 哪些调用关系是稳定领域依赖，哪些只是历史互相引用；
- Official Tools 应归属 Agent、Capability 还是被操作的领域；
- State 与 Narrative 的绑定是否需要更高层 Context 子系统。

### WP-E：公共 API、测试与包消费者

**范围**：`application-runtime/src/index.ts`、所有外部 import、相关测试和 README。

**重点**：

- 哪些导出是真实外部消费者需要，哪些只是测试或 Server 组装便利；
- package 合并或内部移动会影响哪些测试、Extension、Playground 和应用入口；
- 当前 package boundary 是否提供了真实的替换能力；
- 为未来收敛设计兼容导出或迁移顺序，但不实施改名。

## 本轮不做

- 不批量移动、重命名或拆分 `application-runtime` 文件。
- 不改变 RPC、Persistence Schema、Extension SDK、权限合同或事务语义。
- 不因为文件行数大就自动判定为需要拆分。
- 不把测试目录结构或历史 Plan 的目录描述当作当前架构事实。
- 不以“更纯粹的分层”作为独立理由引入新的 Facade、Repository、DI Container 或通用 Capability 层。

## 本轮合并授权

哥哥已明确授权执行物理合并：将 `agent-store`、`narrative-store`、`state-store`、`prompt-resource-store` 迁入新的 `@loom-studio/application-data` package。

合并规则：

- 只保留一套 Store 实现，不创建复制实现或长期兼容 package；
- 保留 Store 内部领域子目录/文件名，先改变 package 边界，不把四个 Store 粗暴揉成一个文件；
- 更新全部生产代码、测试、workspace manifest 和锁文件消费者；
- 不改变持久化 schema、表名、RPC/Extension 合同、Store 导出的运行时行为；
- 删除旧四个 package 的 manifest、tsconfig、源码入口和 workspace identity；
- Application Runtime 继续负责跨 Store 编排，`application-data` 不新增通用 Facade、Repository 或 DI 层。

## 交付标准

本 Issue 的调研阶段完成后，应形成：

1. 当前 package 与内部目录的事实地图；
2. 每个候选合并/移动的证据、收益、成本和反例；
3. 明确保留的边界，以及不应合并的原因；
4. 按风险排序的最小实施批次；
5. 受影响公共导出、测试、构建和回滚路径；
6. 仍需哥哥确认的架构、持久化或公共契约决策。

只有在这些证据完成后，才另开实施 Plan。当前 Issue 不等同于已批准的重构计划。

## 验证账目

- 已完成只读检查：workspace manifest、Store 依赖、Server 创建顺序、Application Runtime 文件树、内部导入关系和生命周期方法扫描。
- 已确认当前工作区存在大量未提交修改；本 Issue 创建过程不覆盖、不回滚这些修改。
- 已完成 3 个只读子 Agent 调研：Store 生命周期、Application Runtime 内部地图、Agent/Prompt/State/Narrative 交叉边界。子 Agent 未修改文件、未创建 worktree、未运行测试或构建。

## 调研结果

### Store 不应简单合并成一个“大 Store”

调研确认 `agent-store`、`narrative-store`、`state-store`、`prompt-resource-store` 都是共享 `SqliteDataEngine` 上的领域适配层：

- Store 构造时各自执行 migration，但不拥有 Data Engine；
- 写入最终进入共享 `engine.transact()`；
- 事务、回滚、Commit Journal、提交通知和关闭由 `data-engine` 统一负责；
- Store 之间没有 Store 级外键或订阅；
- 跨 Store 原子写入和引用清理由 Application Runtime 编排。

因此当前最主要的问题不是“这四个 Store 必须合成一个 package”，而是**生命周期所有权没有显式建模**：

- `Application Runtime` 没有 Runtime 级 `close()`；
- 多数 Store 没有自己的 `close()` / `dispose()`；
- Server 最后直接关闭 Data Engine；
- `SqliteDataEngine.close()` 不等待排队事务排空；
- Store 没有统一的 Bootstrap owner 来表达创建、停止、释放顺序。

最小高价值方向是先明确 Bootstrap 生命周期合同，而不是立即合并 Store：

```text
创建 Data Engine
  -> 按顺序运行各 Store migration
  -> 创建 Application Runtime
  -> 启动 Kernel / Extension Host / HTTP
  -> 停止写入与后台订阅
  -> 停止 Kernel / Extension Host
  -> 关闭 Runtime-owned resources
  -> 最后关闭 Data Engine
```

### Store 边界中最明确的泄漏

Application Runtime 存在直接查询领域表的路径，绕过 Store 公共 API：

- Prompt Resource changeset 逻辑直接查询 `state_revisions`；
- State changeset revert 直接查询 State 表；
- 这些代码之所以能工作，是因为 Runtime 与 Store 共享同一个 SQLite Engine。

这是比“package 数量太多”更明确的边界问题。后续应优先盘点并消除 `application-runtime` 中所有 `dataEngine.database.prepare(...)` 的领域表访问，先从 State changeset 查询开始。

### `application-runtime` 的真实职责

`runtime/` 并不是单纯的运行时执行层，而是应用服务、查询、投影、初始化、事务编排、文档映射和编解码的混合目录：

- `runtime/runtime.ts` 同时负责依赖组装、初始化、内置 Agent Tool 文档维护和公共 Facade；
- `runtime/*-runtime.ts` 直接执行领域命令和查询，并跨 Store 编排事务；
- `cards-runtime.ts` 包含 Card Bundle 解析；
- `loom-scripts-runtime.ts` 包含源码与 Blob 编解码；
- `narrative-runtime.ts` 包含 Timeline Archive 解析；
- `agents-runtime.ts` 同时负责 Agent Turn、Prompt Projection、State Scope 和 Narrative 写入。

因此 `runtime/runtime.ts` 更接近 `application-runtime-factory` 或 composition root，而不是普通的 Runtime 模块。`foundation/application-context.ts` 也不是纯基础设施，而是依赖注入、默认实现选择和 Registry 组装点。

### `types.ts` 与 `index.ts` 是公共边界放大器

`types.ts` 混合了：

- Application Runtime 服务接口；
- Card、Agent、Narrative、Prompt、State、Provider、Extension 内容模型；
- 请求上下文和 Agent 事件；
- Blob、Asset、AI Gateway 等基础设施端口；
- 各类输入输出 DTO。

`index.ts` 又同时导出 Runtime Factory、领域算法、Bundle 编解码、Official Tools、Prompt 编译器、Loom Script Codec 和整个 `types.ts`。

这不代表宽入口一定错误，但会使内部文件移动和领域合同调整的影响范围难以判断。后续应先盘点包外消费者，再考虑将 `types.ts` 拆为 Runtime API、Request Context、领域 Content Contract 和 Infrastructure Port；不应先改公共方法名或 DTO。

### 文件命名与职责漂移

`cards/workspace.ts` 是最高置信的命名问题。该文件同时包含：

- Card Bundle 导入与导出；
- 跨 Document、Prompt Resource、State、Extension Payload、Loom Script、Blob 的事务编排；
- Prompt Resource 输入投影；
- Artifact 校验与归一化。

它更接近 Resource Bundle / Card Bundle Application Service，而不是一般的 Card Workspace。

`state/state.ts` 同时处理 Scope、Revision、Mutation、Document Changeset 和 Timeline State Head；`runtime/context.ts` 主要是 Target 与写入上下文辅助；`foundation/application-context.ts` 实际是 Composition Context。后续应按真实职责重命名或移动，不能只按文件长度机械拆分。

### Agent、Prompt、State、Narrative 的真实边界

当前领域所有权可以暂时这样描述：

| 领域 | 应持有 | 不应持有 |
| --- | --- | --- |
| Agent | Profile、Session、Transcript、Turn/Run、Tool Registry | Narrative Node、State Revision、Prompt Resource 本体 |
| Prompt | Resource、Preset Mount、Prompt 结构、宏声明和资源引用 | Agent Session、State Revision、Narrative Branch |
| State | Scope、Revision、Snapshot、Mutation、并发和幂等 | Timeline/Branch 结构 |
| Narrative | Timeline、Branch、Node、Branch State Head、Timeline Runtime Context | Agent Transcript、Prompt Resource 本体、State Schema |
| Runtime | 跨领域上下文投影、调用顺序和组合事务 | 长期拥有领域持久化状态 |

最重要的交叉中心是 `prepareAgentTurn()`：它同时读取 Agent Session、Preset、Narrative Page、State Snapshot、Timeline Runtime Context、Text Pipeline 和 Prompt Resource。

当前 Agent Turn 是分阶段提交的，不是单一事务：

1. Agent Transcript 和 Run State 先持续写入；
2. Tool 可以独立写 State、Prompt 或 Narrative；
3. `narrativeTarget.commit` 最后再写 Narrative。

因此返回的 `mutation.changesetId` 不能自然代表整个 Turn 的原子结果。后续应先明确它是“最后阶段 changeset”还是需要新的 Turn Commit 状态，不应通过目录重组掩盖这个语义。

另外，Timeline Runtime Context 实际更接近创建时快照；Prompt 删除会跨 Agent Profile、Narrative、Card 和 Transform Rule 做隐式引用清理；Preset 创建又反向读取 Agent Tool Registry。这些都是跨领域应用服务行为，不应简单塞回某一个 Store。

## 阶段性结论

当前不建议直接执行“合并所有 Store”或“重写 Application Runtime”。证据支持的最小收敛顺序是：

1. 先补 Bootstrap/Runtime 生命周期合同，明确谁创建、停止、释放和最后关闭 Data Engine；
2. 盘点并消除 Runtime 直接访问 Store 私有表的路径；
3. 盘点 `types.ts` 和 `index.ts` 的真实包外消费者；
4. 以不改变公共 API 的方式，优先整理 `cards/workspace.ts` 的纯校验、归一化和 Bundle codec；
5. 再决定是否将 `agent/narrative/state/prompt-resource` 收敛到同一 Application Data package；
6. Agent Turn 的跨领域写入语义单独处理，不把它误归类为目录或 package 重构问题。

本 Issue 仍是调研记录，不构成已批准的重构 Plan。

## 其他 Package 调研结果

### 数据与资源持久化

`data-engine`、`document-store`、`blob-store`、`asset-store` 的职责边界目前基本成立，不支持为了减少 package 数量而直接合并：

- `data-engine` 拥有 SQLite 连接、FIFO 操作队列、事务、changeset、提交通知和关闭；
- `document-store` 拥有 Document、Revision、墓碑和 Changeset 语义；
- `blob-store` 拥有内容寻址文件和 Blob 元数据；
- `asset-store` 拥有 Source Artifact、Media Asset、Owner 和媒体元数据。

真正的问题是跨介质生命周期，而不是 package 过细：

- `data-engine.close()` 不等待已排队操作排空；
- Blob 文件先落盘、再写 SQLite 元数据，失败时可能留下 orphan Blob；
- Asset 写入先写 Blob，再写 Asset 表，当前没有引用计数、GC 或可恢复确认状态；
- Card Directory 是 SQLite 与文件系统之间的可恢复两阶段流程，不是单事务；
- Card Directory Media 与 Asset/Blob Store 形成两种并行媒体来源。

因此暂不合并这些 package。优先补充 Data Bootstrap 的 drain/close 合同，并明确 Blob/Asset 当前是否接受 orphan 语义。Card Directory 的 journal、import、catalog、media 拆分暂时有足够职责差异，不应为了目录整齐合并。

### Kernel、Extension 与 Runner

这组边界总体是有意设计的：

- `kernel` 是 Studio 平台协议层，负责 RPC 注册、Event Bus、文档变更事件、Extension RPC 和生命周期协调；
- `extension-sdk` 是作者合同；
- `extension-host` 是运行时实现，虽然物理嵌套在 SDK 目录下，但拥有独立 package identity 和 export；
- `loom-runner` 是无状态的 Core 执行 Facade。

暂不建议移动 `extension-host` 或合并 Kernel/Runner。当前更实际的风险是：

- Kernel 同时暴露 Extension Host、Loom Runner、Diagnostics 和 Trace Audit，已经接近平台 Composition Kernel；
- `kernel.stop()` 不清理自身 RPC、Event Definition 和 Event Subscription；
- 同一个 Kernel 重复 `start -> stop -> start` 可能因 handlers 未清空而重复注册；
- Kernel 若继续增加 Card、Agent、Timeline、Prompt 等 Application RPC，会越过平台边界。

最小下一步是补 Kernel 生命周期回归测试，并固定 Kernel 只拥有平台 namespace 和跨模块生命周期协调，不承载 Application Domain Handler。

### 平台基础设施

以下边界基本合理：

- `transport` 是跨端 RPC/Event 协议；
- `client-bridge` 是浏览器端 HTTP JSON-RPC binding；
- `logging` 是日志记录、Sink、Reader 和 Node JSONL 生命周期；
- `diagnostics` 是可查询运行状态；
- `trace-audit` 是执行 Trace 与行为 Audit 的当前内存实现。

其中两个明显的收敛点：

1. `shared` 过度聚合。它同时导出 JSON 基础类型、Chat 协议、State Contribution、Resource Directory DTO、宏解析和通用工具。宏、State、目录 DTO 没有共同生命周期，也不应继续全部从根入口导出。优先考虑明确子路径，不急于增加更多 workspace package。
2. `ai-gateway` 偏厚。它同时包含 Provider SDK 适配、流式 Run、Provider Adapter Registry、Extension Capability Registry、配置 Schema 和 Fake Provider。当前仍围绕 AI Provider 边界，可以先保持一个 package，但应减少根入口暴露，并区分 Provider Core、Capability Registry 和 Studio-facing DTO。

其他风险：

- `studio-client` 直接从 `ai-gateway` re-export Provider 类型，造成底层 Provider 适配类型进入前端公共依赖；
- `trace-audit` 将 Trace 与 Audit 放在同一极简 Store 中，当前尚可接受；若增加持久化、权限、保留期或分页，应拆成两个接口；
- `diagnostics` 是进程级内存状态，当前没有 scope；
- `ai-gateway` 的 Run 事件历史保存在数组中，长寿命 Run 存在内存增长风险；
- `transport` 的解析器只校验基本 RPC 形状，不能被误认为完成了完整业务参数校验。

## 全部 Package 调研后的优先级

### 高优先级

- 明确 Data Engine / Application Runtime / Kernel / Server 的启动、停止、排队排空和关闭顺序；
- 盘点并消除 Application Runtime 直接访问 Store 私有表的路径；
- 处理 Blob/Asset 跨文件系统与 SQLite 的失败语义；
- 补 Kernel `start -> stop -> start` 生命周期合同和回归测试。

### 中优先级

- 盘点 `shared` 根入口导出，优先拆出明确子路径；
- 切断 Studio Client 对 `ai-gateway` 底层类型的直接依赖；
- 收窄 `application-runtime` 的 `types.ts` 与 `index.ts` 公共导出；
- 明确 `trace-audit` 是否需要独立 Trace/Audit 生命周期。

### 暂不处理

- 不合并 `data-engine` 与 `document-store`；
- 不合并 `blob-store` 与 `asset-store`；
- 不移动 `extension-host` 目录；
- 不把 `transport` 合并进 `client-bridge`；
- 不把 `diagnostics`、`trace-audit`、`logging` 为了减少 package 数量强行合并；
- 不立即把 `ai-gateway` 拆成多个 workspace package。

本轮剩余 Package 调研已完成。调研子 Agent 均为只读任务，未修改源码、manifest、测试或持久化结构；后续实施 Agent 必须按 Batch 1 写集执行，不得把调研结论直接视为实现完成。

## Batch 1 执行记录

Batch 1 三个工作包已完成第一轮实现与主 Agent 复核：

- **WP1 Data Bootstrap**：已完成 Data Engine 异步 drain/close、Document Store close 契约接入、Server 关闭等待、启动恢复顺序核对和定向测试。共享 Engine 的 Store 不取得关闭权；事务回调内关闭 Engine 仍明确属于 non-reentrant 禁止用法。
- **WP2 Application Runtime**：已将 workspace 领域 DTO 类型移入 `cards/workspace-types.ts`，运行时代码改为显式类型依赖，保留少量兼容 re-export；codec 实现仍留在 `workspace.ts`，未扩大为高风险的整文件搬迁。
- **WP3 Public Package Entrypoints**：已撤销把 AI 类型复制到 `shared` 的错误方案；保留 `ai-gateway` 作为类型权威，仅为 `shared` 现有 `chat`、`state-contribution`、`resource-directories` 模块增加明确子路径导出。

主 Agent 复核时额外修正了 `packages/shared/package.json` 中残留的孤立导出。当前已通过相关 package 的 TypeScript 构建、Data Engine 与 Document Store 定向测试，以及 `git diff --check`。

Batch 2 已完成：跨 Store 私有表访问、Application Runtime 最终 close 所有权、Kernel start-stop-start 回归和依赖环检查均已由主 Agent 处理。

### Batch 2 执行记录

- 已将 Application Runtime 两处对 `state_revisions` 私有表的直接查询迁移到 State Store 的 `getRevisionByChangesetId()`，Runtime 现在通过 Store 合同读取 State 数据。
- 已补充 Kernel `start -> stop -> start` 契约测试，并修复内置 Stage One RPC registration 未在 `stop()` 释放的问题。
- 已通过 State Store、Application Runtime State、Kernel RPC 定向测试，以及相关 package typecheck。
- Application Runtime 当前不新增 `close()`：数据 Engine、各 Store 和 Kernel 的关闭责任仍由 Studio Server 统一编排；本轮没有证据表明 Runtime 自己拥有独立可释放资源。
- 依赖图未发现 workspace package 环，也未发现本轮新增的反向依赖。

### Batch 3 验证记录

- 已通过 `git diff --check`。
- 已通过受影响 package 联合 TypeScript 构建：`shared`、`data-engine`、`document-store`、`state-store`、`application-runtime`、`kernel`。
- 已通过 6 个定向测试文件、54 个用例，覆盖 Data Engine drain/close、Document Store close、State Store、Application Runtime State 和 Kernel 生命周期。
- 已执行整个 workspace 的完整测试套件；Client、Extension SDK、Server contract 另有定向测试/typecheck 覆盖，未单独建立新的全量分组。
- 扩大验证已通过 29 个测试文件、208 个用例，覆盖 Application Runtime、Kernel、RPC Router 相关测试；`apps/studio-server`、`extension-sdk`、`client-bridge`、`ai-gateway` 定向 typecheck 通过。
- 前一轮 `pnpm test` 曾出现 `card-directory-media` 缺失文件场景超时；该目标用例随后以 `--testTimeout=15000` 单独通过。
- Application Data 合并后重新执行的完整 `pnpm test` 已全部通过，因此没有修改业务代码或全局测试超时配置。
- `check:workspace` 已修正为遵守 `package.json` 的 Node `>=22.18.0` 约束，当前 Node `26.8.2` 下通过；`.node-version` 与 `.nvmrc` 继续作为推荐基线版本。`check:docs`、`check:docs:links` 与 `check:docs:lifecycle` 均通过。
- 当前未发现需要哥哥确定的公共契约、持久化格式、权限或 RPC wire 语义变更。更大规模的 Store 合并及 `workspace.ts` codec 拆分仍作为后续 Issue 候选，不伪装成已完成。

### Package 合并结论

此前调研没有擅自合并 `agent-store`、`narrative-store`、`state-store` 或 `prompt-resource-store`。哥哥已在本轮明确授权后，进入物理合并实施。当前基线是：四者合计约 4,377 行源码、71 处包名引用，均只依赖 `data-engine`/`shared`，各自保留不同领域 schema 和 Store API。

因此“合并后代码更多”不能作为目标结果；本轮物理合并只出现 Git 对未跟踪移动文件的新增/删除统计、一次性的 manifest/消费者迁移，没有增加第二套权威实现或长期兼容副本。合并后的 `application-data` 源码与四个旧 Store 源码逐文件对应，只有此前 State API 修复和统一入口增加了真实新增代码。

### Batch 4 执行记录

- WP4-A/B/C 的子 Agent 调度因 429 限流全部未启动；主 Agent 已按同一 disjoint 写集直接完成迁移，没有子 Agent 部分改动需要合并。
- 四个 Store 源码已迁入 `packages/application-data/src/{agent,narrative,state,prompt-resource}`，旧四个 package manifest、tsconfig、源码入口和 workspace identity 已删除。
- `application-runtime`、`studio-server`、测试、Vitest resolver、TypeScript project references 和 pnpm lockfile 已统一指向 `@loom-studio/application-data`。
- 没有新增 Store 实现、兼容 package 或第二套权威类型；各领域 Store 文件仍保持独立子目录。
- 已通过 application-data build、根 TypeScript project build、4 个 Store 单测文件 39 个用例，以及 5 个 Application Runtime 集成测试文件 47 个用例。
- 全量 `pnpm test` 通过：162 个测试文件、803 个用例。
- `check:workspace`、`check:docs`、`check:docs:links`、`check:docs:lifecycle` 和 `git diff --check` 均通过。
- `pnpm list -r` 只发现 `@loom-studio/application-data`，不再发现四个旧 Store package identity；运行时导出检查确认四个 Store factory 均从新 package 可用。

## Batch 5 执行记录

哥哥要求继续处理 Batch 3/4 中的剩余高价值项。本批次在不改变既有 RPC wire、持久化 schema 和 Agent Turn 分阶段提交模型的前提下完成：

- `cards/workspace.ts` 中的 Card Bundle / Prompt Resource 校验、归一化、Projection 和 codec 辅助逻辑已迁入 `cards/workspace-codec.ts`；`workspace.ts` 保留导入、导出和跨领域编排，旧导出通过兼容 re-export 保持可用。
- Blob 写入增加 prepared write 的失败清理；Asset Store、Prompt Resource、Card Bundle、Card Directory 和通用 Blob Document Mutation 都改为在事务失败时丢弃未提交的 Blob 文件。Asset/Source Artifact 写入现在会让 Blob 元数据与引用记录参与同一个 SQLite 事务，避免先提交孤立 Blob。
- `@loom-studio/ai-gateway/contracts` 增加面向 Studio Client 的窄类型入口，Client 不再从 AI Gateway 根入口依赖 Provider/Run 类型。
- AI Gateway 和 Agent Run RPC 对已结束 Run 采用有界保留，最多保留 128 个终态 Run，避免长期进程的事件数组和 Run Map 无限增长。
- `InvokeAgentTurnResult.mutation` 增加 `scope`，明确 changeset 是 `agent-session-transcript` 还是 `narrative-commit`；没有引入新的 Turn Commit 持久化状态，保留当前分阶段提交语义。
- 已通过受影响 package typecheck、Application Runtime build、Blob/Asset/AI/Agent/Workspace 定向测试；本批次未改变全局测试配置。

### 仍保留的决策项

- Application Runtime 的 `types.ts` / 根 `index.ts` 仍保留兼容性宽入口；codec 已完成独立边界，但完整按 Runtime API、领域合同、Request Context 和 Infrastructure Port 拆分会影响较多包外消费者，暂未删除旧入口。
- Blob/Asset 的历史 orphan 文件清理、引用计数和 GC 尚未引入。当前修复覆盖本次写入失败和事务回滚；对历史遗留文件的扫描、确认和删除仍需要独立运维/数据清理策略。
- Agent Turn 仍是分阶段提交；本批次只显式标注最后 changeset 的范围，没有新增跨领域 Turn Commit 记录。
- `diagnostics` scope、`trace-audit` 是否拆分，以及 AI Gateway Provider Core 的物理 workspace 拆包仍属于平台边界决策，不因本次 package 合并强行实施。

## 审计复核与收口修复

本批次完成后进行了三路只读语义审计，分别覆盖数据生命周期、Package/Application Runtime 边界，以及 Kernel/开发编排/验证质量。审计确认 Store 合并、Runtime codec 收敛、Kernel 生命周期、Run retention、Node `>=22.18.0` 检查和 esbuild watch 生命周期均有现实调用者与可验证收益，不属于为了减少文件或 package 数量而进行的空泛改动。

审计发现并已修复两项问题：

- Card Bundle、Prompt Resource 和 Card Directory 的 Blob 准备阶段现在也纳入失败清理；并行准备改为等待全部结果后丢弃已经成功准备的文件，避免单个附件失败时遗留 orphan Blob。
- 删除没有包外消费者的 `@loom-studio/application-runtime/cards/workspace-codec` 公共子路径及测试 alias，保留内部模块和根入口兼容导出，避免扩大无实际收益的长期公共契约。

收口验证：Application Runtime 定向 `tsc --noEmit` 通过；Workspace、Prompt Resource 和 Card Directory 相关 3 个测试文件共 26 个用例通过；`git diff --check` 通过。此前完整并行 `pnpm test` 的 4 个 timeout 已由相关测试单独通过确认属于验证稳定性问题，不能将那次并行结果描述为无条件全绿；本次修复未修改全局测试超时配置。
