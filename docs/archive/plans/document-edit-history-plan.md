# Document 原子化编辑撤回实施计划（已归档）

> **状态**：Archived / Phase 1–5 Complete
> **归档日期**：2026-07-23
> **归档原因**：原生 Document、Kernel、Application、Card 与 Context Assets 的撤回闭环已经完成；Phase 6 Extension Transaction 已转移到 [`../../discussion/extensions/studio-extension-host-capabilities-v0.md`](../../workbench/discussion/extensions/studio-extension-host-capabilities-v0.md)。
> **日期**：2026-07-13
> **主题**：以 Document Revision / Changeset 为事实基础，为原生编辑器与 Extension Document 提供统一、原子、安全的 Undo / Redo 能力。
> **相关计划**：[`application-runtime-context-plan.md`](application-runtime-context-plan.md)

---

## 0. 结论

Loom Studio 的编辑撤回应建立在现有 Document Store 之上，不实现第二套内存快照或业务对象反向逻辑。

```text
EditOperation
  -> Document transaction
  -> Changeset A
  -> Client HistoryEntry

Undo
  -> revert Changeset A
  -> Changeset B

Redo
  -> revert Changeset B
  -> Changeset C
```

核心边界：

1. Document Store 负责 transaction、revision、changeset 与 restore-as-new-version。
2. Kernel 负责公开通用 Document RPC、传播调用上下文并在提交后发布事实事件。
3. Application Runtime 负责业务校验和编辑语义，只返回 mutation receipt，不维护历史栈。
4. Extension 通过受控 Document API 参与同一套事务和撤回机制，平台不理解插件 Schema。
5. Client 只维护当前会话的 Undo / Redo 时间线、操作标题和可选 UI 定位信息。
6. Workspace 同步、Runtime checkpoint、外部副作用不进入普通编辑撤回。

---

## 1. 已确认的产品边界

### 1.1 第一批应覆盖

资源级编辑：

- 创建、修改、删除角色卡；
- 创建、修改、删除预设；
- 创建、修改、删除 Setting Layer；
- 复制原生资源。

结构级编辑：

- 创建、复制、移动、删除条目；
- 创建、修改、删除连线或软链接；
- 调整层级、父子关系和排序。

组件与属性编辑：

- 挂载、移除、替换 Component；
- 修改名称、正文、关键词、启用状态、优先级和其他持久化属性。

Extension 编辑：

- Extension 注册并持久化在平台 Document Store 中的自有 Document；
- Extension 通过受控 transaction 同时修改的多个 Document；
- Extension 为原生 Document 提交的、经过 Application Mutation API 校验的编辑。

### 1.2 明确不进入普通 Undo / Redo

- Enable / Sync / Import / Export Dev Workspace；
- AI 生成、Agent Step、Tool Call、Chat Reroll；
- Provider 请求、计费调用、Webhook、MCP 文件写入；
- Extension 私有 SQLite、缓存、向量索引、二进制数据；
- UI 选择、面板展开、派生 projection、预览结果；
- 尚未提交的文本输入过程。

Workspace 继续采用显式按钮操作、冲突检测和独立恢复语义。Runtime 继续采用任务级 Checkpoint。外部副作用只审计，不承诺撤回。

### 1.3 操作层级不进入底层类型

“资源级、结构级、组件级、属性级”用于产品描述、操作粒度和测试分类，不固化为 `level1 / level2`，也不固化为 Document Store 的业务枚举。

底层只理解 Document 和 Changeset。Client 可使用可选定位信息：

```ts
type EditOperationAnchor = {
  documentId: string
  subjectId?: string
}
```

`subjectId` 是不透明标识。原生 Setting 可以放 entryId，图插件可以放 nodeId，平台不解释其业务含义。

---

## 2. 调研发现的当前缺口

### 2.1 `transact()` 只有数据库原子性，没有 Changeset 原子性

当前 In-memory 和 SQLite backend 都能在 transaction 失败时撤销未提交写入，但 transaction 内的每次 `write/delete` 仍各自产生一个独立 `changesetId`。

这与既有设计约定冲突：

```text
one successful transaction = one changeset
```

没有修复这一点前，“创建条目并挂载默认组件”无法成为单个可撤回操作。

### 2.2 Changeset 缺少公共读取与恢复接口

SQLite 已有 `changesets` 和 `document_revisions` 表，但 `DocumentStore` 当前没有：

```text
getChangeset
revertChangeset
```

In-memory backend 目前只返回临时 changesetId，没有保存 Changeset 实体。

### 2.3 Application 丢失 mutation receipt

Application 的 `writeDocument()` helper 从 `WriteDocumentResult` 中只取出 `DocumentRecord`，导致 changesetId、operations 和 correlation 信息无法到达 RPC Client。

现有创建、修改、删除 Result DTO 也没有统一的 mutation receipt。

### 2.4 Application RPC 没有继承请求上下文

Studio Server 已生成：

```text
clientId
correlationId
callId
parentCallId
```

但 Application Route 没有把它们传入 Application Runtime。Application 直接写 Document Store 时缺少正确 actor、correlation 和统一的 `docs.changed` 事实链路。

本缺口与 `application-runtime-context-plan.md` 的 Phase 4 直接重合，本计划应复用该计划定义的 `RuntimeRequestContext`，不再创建第二套请求上下文。

### 2.5 Extension Document API 缺少 transaction

Extension Activation Context 已提供受控 `documents.get/list/write/delete`，并自动设置 ownerExtensionId，但目前：

- 没有多 Document transaction；
- Extension RPC 的调用上下文没有绑定到 Document mutation；
- Client Extension contribution 尚未形成统一 Edit History 接入面。

### 2.6 Context Assets mutation 不是可靠的可等待操作

当前 Context Assets 先修改 React state，再 fire-and-forget 持久化；失败只写入 console。部分持久化副作用发生在 state updater 内。

在接入 History 前必须先保证：

- mutation 可等待；
- 失败不会进入 History；
- 失败后本地状态不会永久偏离服务端；
- 一次用户操作只发出一次明确 mutation；
- 连续属性输入不会为每次按键创建 Revision。

---

## 3. 目标架构与依赖方向

```text
apps/studio-client
  features/edit-history
          |
          v
  typed Studio / Plugin Host API
          |
          v
packages/application-runtime     packages/extension-sdk
  domain validation                 scoped document API
          |                               |
          +---------------+---------------+
                          v
                  packages/kernel
              RPC / event / actor context
                          |
                          v
              packages/document-store
        transaction / revision / changeset / revert
```

依赖纪律：

- Document Store 不 import Kernel、Application、Extension SDK 或 Client。
- Kernel 不理解 Card、Preset、Setting Entry 或插件业务 Schema。
- Application 不 import Client History。
- Extension 不接触 ApplicationRuntimeContext 或底层 SQLite。
- Client History 不读取 Document Revision 内容，只保存 changesetId。
- Event 只报告已提交事实，不作为 Command Bus。

---

## 4. 核心接口方向

以下类型用于锁定职责，具体命名可在 Phase 1 实施时按现有代码风格微调。

### 4.1 Document Store

```ts
type Changeset = {
  id: string
  createdAt: string
  createdBy: ActorRef
  reason?: string
  correlationId?: string
  callId?: string
  parentCallId?: string
  operations: ChangesetOperation[]
}

type DocumentTransactionInput = {
  actor: ActorRef
  reason?: string
  correlationId?: string
  callId?: string
  parentCallId?: string
}

type DocumentTransactionResult<T> = {
  value: T
  changeset: Changeset
}

type RevertChangesetInput = {
  changesetId: string
  actor: ActorRef
  reason?: string
  correlationId?: string
  callId?: string
  parentCallId?: string
}

type DocumentStore = {
  get(...): Promise<DocumentRecord | null>
  list(...): Promise<PageResult<DocumentRecord>>
  write(...): Promise<WriteDocumentResult>
  delete(...): Promise<WriteDocumentResult>
  transact<T>(
    input: DocumentTransactionInput,
    fn: (tx: DocumentTransaction) => Promise<T>,
  ): Promise<DocumentTransactionResult<T>>
  getChangeset(id: string): Promise<Changeset | null>
  revertChangeset(input: RevertChangesetInput): Promise<WriteDocumentResult>
}
```

`DocumentTransaction` 只提供事务内的 get/list/write/delete，不暴露递归开启顶层 transaction 的能力。

### 4.2 Mutation Receipt

Application 和 Extension 的用户编辑操作统一返回：

```ts
type MutationReceipt = {
  changesetId: string
}
```

例如：

```ts
type UpdateCardResult = {
  card: Card
  mutation: MutationReceipt
}
```

只有明确声明为用户创作编辑的操作进入 Client History。后台刷新、迁移、自动索引和 Runtime 写入即使产生 Changeset，也不自动进入 Undo 栈。

### 4.3 Client History

```ts
type HistoryEntry = {
  label: string
  changesetId: string
  anchor?: EditOperationAnchor
}
```

推荐调用形态：

```ts
await history.run(
  { label: '修改角色卡名称', anchor: { documentId: cardId } },
  () => api.cards.update(input),
)
```

规则：

- action 成功并返回 mutation receipt 后才进入 undo 栈；
- Undo 成功后保存其新 changesetId，供 Redo 反向恢复；
- Undo 后执行新操作立即清空 redo 栈；
- 第一版 History 只保存在当前 Client 会话；
- 暂不持久化 Command 对象或跨重启恢复 History 游标。

---

## 5. Revert 语义

### 5.1 Restore-as-New-Version

任何 Undo / Redo 都写入新的 Revision 和新的 Changeset：

```text
restore as new version, never move history backward
```

禁止：

- 移动 current version 指针；
- 删除较新的 revision；
- 修改旧 changeset；
- 回滚 Trace / Audit；
- 宣称外部副作用已被恢复。

### 5.2 反向操作

| 原操作 | Revert 行为 |
|---|---|
| create | 为当前 Document 创建 tombstone 新版本 |
| update | 读取 fromVersion，恢复其 content/meta 为新版本 |
| delete | 恢复删除前 Revision 为新版本 |
| restore | 恢复 restore 前的 Revision 为新版本 |

### 5.3 并发安全

执行 revert 前必须在同一事务内检查所有受影响 Document：

```text
current.version === operation.toVersion
```

任意一个不匹配，整个 revert 失败，不允许部分恢复或 last-write-wins。

### 5.4 同一事务多次修改同一 Document

Changeset 对同一 Document 最终只保留一条归并后的 operation：

```text
first fromVersion -> final toVersion
```

典型归并：

- create + update -> create；
- update + update -> update；
- update + delete -> delete，但 fromVersion 保留事务开始前版本；
- create + delete -> 当前为 tombstone，revert 后仍应表达“事务前不存在”。

归并算法必须由 In-memory 与 SQLite backend 共用或通过相同测试矩阵约束。

---

## 6. 分阶段实施计划

### Phase 1：修正 Document Store Changeset 语义（已完成）

目标：先让数据层契约真实成立，不接 UI。

主要文件：

```text
packages/document-store/src/index.ts
tests/unit/document-store/in-memory-store.test.ts
tests/unit/document-store/sqlite-store.test.ts
```

任务：

1. 增加 Changeset 公共类型和查询接口；
2. In-memory backend 持久化 Changeset；
3. 调整 transaction，使一次成功事务只提交一个 Changeset；
4. 聚合同一事务内的多次 Document 操作；
5. 实现安全的 `revertChangeset()`；
6. 保持单次 `write/delete` 继续隐式生成单操作 Changeset；
7. 保证 nested transaction 不产生独立 Changeset；
8. 保证两种 backend 的外部行为一致。

验证门槛：

- create/update/delete/revert/redo 单 Document 测试通过；
- 多 Document transaction 只产生一个 Changeset；
- transaction 失败不留下 current、revision 或 changeset 残留；
- 版本冲突时整个 revert 无写入；
- `pnpm build` 与完整默认测试通过。

### Phase 2：Kernel Document RPC 与事实事件（已完成）

目标：通过通用 Kernel 能力安全读取和反向恢复任意平台托管 Document Changeset。

主要文件：

```text
packages/kernel/src/index.ts
apps/studio-server/src/studio-rpc-router.ts
apps/studio-server/src/http-server.ts
tests/contract/kernel/
tests/integration/platform/
```

任务：

1. 增加 `docs.getChangeset`；
2. 增加 `docs.revertChangeset`；
3. RPC actor、correlationId、callId、parentCallId 传入 revert；
4. commit 成功后发布一次 `docs.changed`；
5. 增加 rollback/revert 事实事件时保持事件为提交后事实，不用事件驱动命令；
6. 返回结构化冲突错误，不静默覆盖新版本。

验证门槛：

- Client RPC 可以 revert 任意用户有权编辑的 Document Changeset；
- event payload 只包含已提交结果；
- 失败不发布成功事件；
- correlation 信息贯穿 RPC、Changeset 和 Event。

### Phase 3：Application Mutation Context 与 Receipt（已完成）

目标：原生领域编辑获得正确 Changeset 回执，同时避免继续膨胀根 `runtime.ts`。

主要文件：

```text
packages/application-runtime/src/application-context.ts
packages/application-runtime/src/document-store.ts
packages/application-runtime/src/types.ts
packages/application-runtime/src/mutation.ts
packages/application-runtime/src/runtime.ts
apps/studio-server/src/application-rpc.ts
apps/studio-server/src/studio-rpc-router.ts
```

任务：

1. 复用 `RuntimeRequestContext`，不创建第二套 RPC context；
2. `callApplicationRpc()` 接收并下沉请求上下文；
3. 新增很薄的通用 Document mutation helper；
4. 用户创作 mutation 通过 transaction 执行并返回 MutationReceipt；
5. Card create/update/delete 率先接入；
6. Runtime、Preview、Workspace Export 不自动标记为 EditOperation；
7. 新逻辑放入领域模块或 mutation helper，不向根 runtime 塞 History 状态。

验证门槛：

- Application mutation 的 actor 是实际 Client；
- RPC result 含 changesetId；
- Application 不依赖 Client History；
- 查询和预览接口 DTO 不被无意义修改。

### Phase 4：Client Edit History 与 Card 闭环（已完成）

目标：先用最简单的资源完成端到端 Undo / Redo。

主要文件：

```text
apps/studio-client/src/features/edit-history/model/history-model.ts
apps/studio-client/src/features/edit-history/model/use-edit-history.ts
apps/studio-client/src/shared/api/studio-api.ts
apps/studio-client/src/entities/common.ts
apps/studio-client/src/features/cards/model/use-cards.ts
apps/studio-client/src/app/use-studio-state.ts
apps/studio-client/src/pages/studio/
tests/unit/client/
```

任务：

1. 实现无 React 依赖的纯 History 状态转换；
2. Hook 只组合 run/undo/redo/canUndo/canRedo；
3. Studio API 增加 revert Changeset 调用；
4. Card create/update/delete 接入 `history.run()`；
5. Undo / Redo 后刷新受影响资源并恢复合理选择；
6. 在页面或 Shell 绑定 Ctrl/Cmd+Z 与 Ctrl/Cmd+Shift+Z；
7. 输入框内部原生 undo 优先，已提交操作才进入平台 History。

验证门槛：

- Card 创建、修改、删除可往返 Undo / Redo；
- Undo 后新编辑清空 Redo；
- RPC 失败不进入 History；
- History 不进入 widget、Document Store 或 Application Runtime。

### Phase 5：Context Assets mutation 收束与接入

目标：先修复异步持久化边界，再接入结构级编辑撤回。

主要文件：

```text
apps/studio-client/src/features/context-assets/model/use-context-assets.ts
apps/studio-client/src/features/context-assets/model/tree-ops.ts
apps/studio-client/src/shared/api/studio-api.ts
packages/application-runtime/src/workspace.ts
tests/unit/client/context-assets.test.ts
```

任务：

1. 保留 tree-ops 纯函数；
2. 移除 state updater 内的持久化副作用；
3. create/update/move/delete 改为可等待 mutation；
4. RPC 成功后采用服务端返回的 authoritative workspace；
5. 失败时不记录 History，并恢复或刷新本地状态；
6. 拖动只在 drop 后提交一次；
7. 属性输入在明确提交点合并，不逐按键写 Revision；
8. projection reorder 使用单个领域操作，不循环触发多个独立 update。
9. 排序、重排和 rank 变化是一等可撤回编辑，必须返回 MutationReceipt 并进入同一 History 时间线。

验证门槛：

- 新增、复制、移动、删除、属性修改可往返；
- 快速连续操作不会静默覆盖；
- 一次 UI 意图对应一个 Changeset；
- 服务端失败不会留下虚假本地 History。

### Phase 6：Extension Document Transaction 与 History 接入（已转移）

> 本阶段没有随 Phase 1–5 一起完成。其任务和验证门槛已转移到 Extension Host Capability discussion；本节保留原始计划内容，供历史回溯。

目标：让插件自有 Document 在不暴露底层 Store 的情况下获得原子撤回。

主要文件：

```text
packages/extension-sdk/src/index.ts
packages/extension-sdk/extension-host/src/index.ts
tests/contract/extension-host/
```

任务：

1. 在受控 Extension Document API 增加 transaction；
2. 自动设置 ownerExtensionId 和 extension actor；
3. Extension RPC mutation 继承 request correlation；
4. transaction 返回 MutationReceipt；
5. Client Extension Host API 稳定后，暴露平台 EditOperation 接入点；
6. 私有 Scratch 收到 changed/revert 事件后自行失效或重建；
7. 不为外部副作用提供虚假的通用 Undo。

验证门槛：

- 插件一次修改多个自有 Document，只产生一个 Changeset；
- 平台无需理解插件 Schema 即可 Undo / Redo；
- owner、actor 和 correlation 正确；
- 插件私有存储不会被平台标记为已恢复。

---

## 7. 模块解耦约束

实施过程中出现以下情况必须停下来调整：

- `runtime.ts` 新增 History 栈、快捷键、label 或 anchor；
- Document Store 出现 Card、Preset、Entry、Workspace 等业务类型；
- Client 直接读取历史 Revision 内容计算反向 patch；
- 每个业务操作分别手写不对称的 undo 数据逻辑；
- Extension 获得原始 SQLite 或 ApplicationRuntimeContext；
- `docs.changed` 被当作执行 Undo 的命令；
- widget 直接发 `docs.revertChangeset`；
- 为了未来可能的跨设备历史，提前持久化 Client Undo 栈；
- 为简单单 Document 编辑引入复杂 Command 基类或第三方状态库。

推荐依赖关系：

```text
feature command -> typed API -> RPC -> domain mutation -> DocumentStore
feature history -> typed revert API -> Kernel DocumentStore revert
```

---

## 8. 测试矩阵

### Document Store

- 单 Document create/update/delete；
- create -> undo -> redo；
- update -> undo -> redo；
- delete -> undo -> redo；
- 多 Document transaction；
- 同 Document 多次写入归并；
- nested transaction；
- transaction 中途失败；
- revert 前版本冲突；
- tombstone 读取与恢复；
- In-memory / SQLite parity。

### Kernel / RPC

- getChangeset；
- revertChangeset；
- actor/correlation 继承；
- changed/revert event 只在 commit 后发布；
- 结构化冲突错误；
- Extension-owned Document 的用户撤回权限边界。

### Application

- Card mutation receipt；
- 多 Document 领域操作只返回一个 Changeset；
- 查询接口不生成 Changeset；
- Runtime 操作不自动进入 Edit History；
- request context 不成为隐式业务输入。

### Client

- undo/redo 栈转换；
- 新操作清空 redo；
- action 失败不入栈；
- 快捷键与文本输入原生 undo 的优先级；
- Undo 后资源刷新与选中恢复；
- Context Assets 服务端失败恢复。

### Extension

- ownerExtensionId；
- transaction changeset 聚合；
- 插件 Document undo/redo；
- Scratch invalidation；
- 外部副作用不声明为已撤回。

---

## 9. 暂不做

- 持久化 Client History 栈；
- 跨客户端同步 Undo 游标；
- 多人实时协作下的操作变换或 CRDT Undo；
- 任意 JSON Patch 的自动语义合并；
- Git / Workspace 文件级 Undo；
- 外部 API compensating transaction 框架；
- History Timeline 完整 DevTool UI；
- Command 基类继承体系；
- 新的全局状态管理依赖。

---

## 10. Definition of Done

本计划完成时必须满足：

1. 一次成功 Document transaction 只产生一个 Changeset；
2. Changeset 可查询并可通过 restore-as-new-version 安全 revert；
3. Undo / Redo 都产生新的 Revision 和 Changeset；
4. 冲突时原子失败，不覆盖其他新修改；
5. Application 用户编辑返回统一 MutationReceipt；
6. Kernel RPC context 能关联到 Changeset 和事实事件；
7. Card 与 Context Assets 完成端到端 Undo / Redo；
8. Client History 与业务模块、Document Store 保持单向依赖；
9. Extension 自有平台 Document 可使用同一撤回原语；
10. Workspace、Runtime、私有 Scratch 和外部副作用边界没有被模糊；
11. In-memory 与 SQLite backend 契约一致；
12. `pnpm build`、默认测试和新增最小测试矩阵全部通过。

---

## 11. 推荐开工顺序

严格按以下顺序推进，不跨阶段并行堆功能：

```text
Phase 1 Document Store
  -> Phase 2 Kernel RPC
  -> Phase 3 Application Receipt
  -> Phase 4 Client + Card
  -> Phase 5 Context Assets
  -> Phase 6 Extension
```

第一轮实施只进入 Phase 1。Document Store 的 Changeset 契约通过完整测试后，再开始适配 Kernel 和上层模块。

---

## 12. Implementation Notes

### 2026-07-13：Phase 1 完成

- Document Store 公共入口已拆分为 types、Changeset 规则、In-memory backend 和 SQLite backend；
- 一次成功 transaction 现在只生成一个持久化 Changeset；
- 同一 transaction 内对同一 Document 的连续修改会归并为一条 operation；
- In-memory 与 SQLite 均支持 `getChangeset()` 和 `revertChangeset()`；
- create/update/delete 均可通过 revert 完成 Undo，并通过再次 revert 完成 Redo；
- revert 会先检查所有目标 Document 的当前版本，冲突时整个操作无写入；
- Application Runtime 现有 transaction 调用已适配新返回值，尚未进入 mutation receipt 和 RPC context 阶段；
- 默认测试 145 项通过，`pnpm build` 与 `pnpm lint` 通过。

### 2026-07-13：Phase 2 完成

- Kernel 新增 `docs.getChangeset` 与 `docs.revertChangeset`；
- revert 自动继承 Client actor、correlationId、callId 和 parentCallId；
- revert 成功提交后依次发布 `docs.changed` 与 `docs.rollback.completed`；
- revert 冲突只发布 `docs.rollback.failed`，不会发布 `docs.changed` 或留下部分写入；
- Document Store domain error 现在携带稳定错误码，Transport 序列化时保留该错误码；
- `system.introspect` 可发现新增 RPC 和 rollback 事件；
- Kernel contract、Transport contract 和 Client Bridge integration 已覆盖成功与冲突路径；
- 默认测试 149 项通过，`pnpm build` 与 `pnpm lint` 通过。

### 2026-07-13：Phase 3 完成

- 新增无状态 `executeDocumentMutation()` helper，请求上下文不写入全局 ApplicationRuntimeContext；
- 定义 `RuntimeRequestContext` 和统一 `MutationReceipt { changesetId }`；
- Card create/update/delete 已改为显式 Document transaction；
- Card mutation Result DTO 现在返回 mutation receipt，现有 Client 可向后兼容地忽略额外字段；
- Studio RPC Router 会把 clientId、correlationId、callId、parentCallId 传入 Application mutation；
- Card Changeset 的 actor、reason 和 correlation 已通过 Runtime 与真实 HTTP RPC 集成测试验证；
- 查询、Preview、Runtime、Workspace 操作没有被误标为 EditOperation；
- Application mutation 的统一 `docs.changed` 发布仍需在后续事件观察面中收束，本阶段未让 Application 直接依赖 Kernel EventBus；
- 默认测试 150 项通过，`pnpm build` 与 `pnpm lint` 通过。

### 2026-07-13：Phase 4 完成

- 新增独立 `features/edit-history`，纯模型只保存 label、changesetId 和可选 anchor；
- Undo 将原 Changeset 的 revert Changeset 放入 Redo 栈，Redo 同理生成新的 Undo 目标；
- Undo 后执行新编辑会清空 Redo；
- Studio typed API 新增 `history.revert()`，Client 不读取 Revision 内容；
- Card create/update/delete 已记录 History，并在 Undo/Redo 后刷新 authoritative Card 列表；
- Ctrl/Cmd+Z、Ctrl/Cmd+Shift+Z 和 Ctrl/Cmd+Y 已接入 Studio Page；
- input、textarea、select 和 contenteditable 保留浏览器原生 Undo 优先级；
- endpoint/bridge 变化时清空会话 History，避免把旧服务的 changesetId 发到新服务；
- 排序已作为一等 HistoryEntry 增加纯模型测试；实际 Context Assets 排序提交仍属于 Phase 5；
- Card create/update/delete 的 MutationReceipt 已通过真实 RPC Undo/Redo 集成测试；
- 默认测试 154 项通过，`pnpm build` 与 `pnpm lint` 通过。

### 2026-07-13：Phase 5 完成

- Prompt Workspace 的 create/update/move/delete 与 projection order mutation 已纳入显式 Document transaction，并统一返回 MutationReceipt；
- 新增 `application.updatePromptAssets`，同一 Workspace 内的多节点 projection reorder 只写一次 Document、只生成一个 Changeset；
- Studio RPC 会把 clientId、correlationId、callId、parentCallId 继续下沉到 Context Assets mutation；
- Context Assets 不再在 React state updater 内触发持久化，也不再 fire-and-forget；mutation 按 UI 意图串行提交，成功后采用服务端 authoritative workspace；
- 新增、复制、移动、删除、属性修改和排序均在成功后记录 History；失败不记录，并将属性草稿恢复到最近一次服务端状态；
- 文本属性只在 blur 等明确提交点写 Revision，checkbox/select 等离散属性在单次 change 时提交；
- 普通树拖动仅在 drop 后提交一次；Preset/Context projection reorder 不再循环发送多个 update；
- Undo/Redo 后会按 History anchor 刷新 Card 或 Prompt Workspace，并恢复合理的条目选择；
- 真实 HTTP RPC 测试覆盖复制、属性修改、移动、删除、排序的 Undo，以及复制的 Redo；两节点排序验证为单一 `airp.promptWorkspace` Changeset operation；
- 重复启动 Studio Server 时，4173 端口冲突现在会受控退出并输出明确提示，不再触发未处理的 Server `error` 事件；
- 默认测试 157 项通过，`pnpm build`、`pnpm lint` 与 `git diff --check` 通过。
