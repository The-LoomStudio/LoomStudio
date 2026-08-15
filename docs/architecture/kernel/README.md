# Studio Kernel

Studio Kernel 是 Loom Studio 的业务无感知协调层。它组装平台服务、维护统一 RPC 注册面和进程内事件总线，但不理解 Card、Session、Prompt、Agent、Provider 等 Application 语义。

本文对应当前实现：

- [`packages/kernel/src/index.ts`](../../../packages/kernel/src/index.ts)
- [`tests/contract/kernel/kernel-rpc.test.ts`](../../../tests/contract/kernel/kernel-rpc.test.ts)

## 1. 职责边界

Kernel 当前负责：

- 组装 Document Store、Extension Host、Diagnostics、Trace Audit 和 Loom Runner；
- 订阅领域无关的 Data Commit Source，并投影平台数据事件；
- 注册、发现和调用 Kernel RPC 与 Extension RPC；
- 保留 Kernel RPC 命名空间；
- 生成缺失的 `correlationId` 与 `callId`；
- 在平台操作完成后发布事实事件；
- 暴露当前已注册的方法、事件和 Extension 状态。

Kernel 明确不负责：

- 定义 Card、Chat、Setting Layer、Prompt 或 Agent schema；
- 编译 PromptBuild 领域结构；
- 选择 Provider、模型或生成参数；
- 承载前端状态或页面交互；
- 将 HTTP、WebSocket、SSE 等具体传输方式写入 Kernel contract。

`loom.run` 会拒绝 `messages`、`model`、`temperature`、`tools`、`chatId`、`sessionId`、`provider` 等业务字段，防止 Application 语义下沉到 Kernel。

## 2. 组成与依赖

`createKernel(options)` 由 Studio Server 组合根注入以下服务：

```text
Studio Server
  -> Kernel
       -> Document Store
       -> Data Commit Source
       -> Extension Host
       -> Diagnostics Registry
       -> Trace Audit Store
       -> Loom Runner
       -> Event Bus
```

Kernel 只依赖这些服务的 public API，不创建 Application Runtime，也不反向依赖 Studio Client。

`Kernel` 当前通过 getter 暴露已注入服务，供同一进程中的平台组装与测试使用。这些 getter 是进程内接口，不等于远程 Extension 权限。

## 3. 生命周期

```text
createKernel(options)
  -> start()
       注册内建 RPC
       标记 active
       发布 system.ready
  -> stop()
       发布 system.stopping
       释放所有活动 Extension Scope
       标记 inactive
```

`start()` 与 `stop()` 当前都是幂等操作。内建 RPC 在首次启动时注册；重复启动不会重复注册相同方法。Extension 清理失败会从 `stop()` 返回错误，但 Kernel 仍在 `finally` 中收束为 inactive。

## 4. RPC 注册面

Kernel 维护一个进程内 RPC Registry。每个条目包含 handler 与 owner：

```ts
type RpcOwner = 'kernel' | `extension:${string}/${string}`
```

### Kernel RPC

`registerKernelRpc()` 只允许注册以下保留命名空间：

```text
system.*
events.*
docs.*
extensions.*
diagnostics.*
loom.*
trace.*
audit.*
```

重复方法名会被拒绝。

### Extension RPC

`registerExtensionRpc()` 不能写入 Kernel 保留命名空间。Extension 方法必须位于 Package namespace，并记录 `ownerPackageId`、`ownerModuleId` 与 `instanceId`；重复方法名同样会被拒绝。

Extension handler 获得的 context 由 Kernel 注入真实 `packageId`、`moduleId` 与 `instanceId`，不能通过请求参数伪造 owner。Registration handle 只会删除创建它的当前 Registry entry，旧实例清理不会误删 reload 后的新 handler 或 sibling Module。

## 5. 当前 RPC families

| Family | 当前职责 |
|---|---|
| `system.*` | 健康检查、版本与能力信息、动态 introspection |
| `events.*` | 保留给未来真实 Event Transport；当前没有伪订阅 RPC |
| `docs.*` | Document 查询、写入、删除、Changeset 查询与反向 Changeset |
| `extensions.*` | Package Catalog、Module 启停/reload 与诊断查询 |
| `diagnostics.*` | 平台诊断读取 |
| `loom.*` | 经 Loom Runner 执行领域无关 Fragment pipeline |
| `trace.*` | Loom Trace 事实查询 |
| `audit.*` | Audit 事实查询 |

具体方法和参数应以 Kernel public surface 与 `system.introspect` 的运行时结果为准，不在架构文档中复制第二份完整 RPC schema。

## 6. Document 变更与回滚

Kernel 将 `docs.write`、`docs.delete` 和 `docs.revertChangeset` 转交 Document Store。它负责补充可信调用元数据，不实现 Revision 或冲突算法。

Kernel 启动后订阅注入的领域无关 Data Commit Source。当前 Studio Server 直接注入共享 SQLite Data Engine；测试或外部组合仍可用 `createDocumentDataCommitSource()` 适配普通 Document Store。未来其他权威 Store 复用同一 Engine 提交入口，而不是让 Kernel 依赖 Narrative 或 Agent 业务接口。

每次成功提交统一发布一次 `data.changed`。如果 Commit Fact 中包含 `store: documents` operation，Kernel 再投影一次兼容的 `docs.changed`：

```text
docs.write / docs.delete
  -> Document Store commit
  -> new Changeset
  -> data.changed
  -> docs.changed

docs.revertChangeset
  -> Document Store 生成反向 Changeset
  -> data.changed
  -> docs.changed
  -> docs.rollback.completed

revert conflict
  -> 不写入部分结果
  -> docs.rollback.failed
  -> 原错误继续返回调用方
```

回滚不会删除历史 Changeset，而是提交一个新的补偿性 Changeset。因此 Undo 与 Redo 都保留可审计的 Revision 链。

Kernel 从 `clientId` 推导 Document actor，并忽略请求中伪造的 actor 或 owner metadata。`correlationId`、`callId` 和 `parentCallId` 会继续传入 Document Store。

## 7. Event Bus

当前 Event Bus 是 Kernel 内的进程内事实广播设施：

- Event 必须先注册 Definition 才能发布；
- Definition 包含 owner、version、visibility、capability、stability、payload parser 与可选大小上限；
- 每个事件生成 `eventId`、Definition version 与 `emittedAt`；
- 传播 source、client 和调用链 metadata；
- 支持精确事件名与 `namespace.*` 匹配；
- 订阅返回可 `dispose()` 的 handle；
- `public`、`protected`、`internal` 会产生真实发现/订阅权限差异；
- 发布时验证 owner、JSON payload、parser 和 `maxPayloadBytes`；
- 单个订阅者同步异常或 async rejection 不会阻断其他订阅者，并写入 Diagnostics；
- `eventNames()` 与 `definitions()` 返回 Runtime Definition Registry 当前事实。

`data.changed` payload 只携带 Changeset ID 与领域无关 operation summaries，不携带 Document content、Prompt、Message 或其他正文。`docs.changed` 保持原有 Document operation / summary 兼容形状。

当前平台事件由 Kernel 注册并发布；Extension 事件由 Server Extension Host 注入可信 publisher identity。Document Commit actor 继续生成归一化的 `source` / `clientId`，完整 actor 仍以 Changeset 为权威来源。

Event Bus 描述平台事实，不是 Application Command Bus、Hook Registry、Stream 或可靠 Job Queue。当前没有跨端事件 RPC；具体网络投递等待独立 Transport adapter。

## 8. Introspection

`system.introspect` 聚合：

- Studio、Kernel 与 Protocol 版本；
- Kernel 保留命名空间；
- 当前 RPC 方法及 owner；
- 当前已知事件；
- 已加载 Extension 的状态；
- 可选的 Diagnostics。

它是动态能力发现面。静态 Manifest 可以声明能力，但运行时 Registry 才是当前事实。

## 9. Transport 边界

Kernel 的调用入口是：

```ts
callRpc(method, params, context)
```

它不依赖 Node HTTP、WebSocket 或浏览器 Fetch。当前 `apps/studio-server` 使用 HTTP JSON-RPC `/rpc` adapter 将网络请求转入 Kernel；这属于 Server 组合与 Transport 实现，不是 Kernel 永久绑定的协议形态。

## 10. 演进约束

以下变化需要同步更新本文：

- 新增或删除 Kernel 保留命名空间；
- 修改 Kernel 生命周期或 RPC owner 规则；
- 改变 Changeset 回滚事件语义；
- Event Bus 从进程内模型升级为其他投递模型；
- Kernel 开始或停止公开某项平台服务。

仍处于讨论阶段的历史材料保留在 [`../../workbench/discussion/kernel/`](../../workbench/discussion/kernel/) 中。
