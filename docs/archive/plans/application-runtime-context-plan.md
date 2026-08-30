# Application Runtime Context 架构评估与计划（已归档）

> **状态**：Archived / Core Direction Implemented
> **归档日期**：2026-07-23
> **归档原因**：基础设施 Context 与请求级 correlation 已落地；稳定边界已提炼到 [`docs/architecture/application/README.md`](../../architecture/application/README.md)，Extension Host Context 由 [`studio-extension-host-capabilities-v0.md`](../discussion/extensions/studio-extension-host-capabilities-v0.md) 继续讨论。
> **目的**：评估是否在 Application Runtime 引入 `ctx` 风格的运行上下文，以减少横切型传参，同时避免把业务输入藏进隐式全局对象。
> **适用范围**：`packages/application-runtime`、`apps/studio-server` 的 RPC 调用上下文、未来 Extension / Plugin Context。

---

## 0. 结论

建议引入 **Application Runtime Context**，但只作为基础设施能力容器，不作为业务状态容器。

核心原则：

- `ctx` 装“能力”：`documents`、`gateway`、`clock/now`、`createId`、`logger/diagnostics`、`secretResolver`。
- request/input 装“本次行为”：`sessionId`、`branchId`、`userInput`、`workspaceId`、`activationFacts`、`projectionOrderProfile`、`modelProfileId`。
- PromptBuild 和 Provider 调用的可解释输入必须保持显式，不能从 `ctx` 里偷偷读取。

一句话：**ctx 是工具箱，不是世界本身。**

---

## 1. 当前问题盘点

### 1.1 Application Runtime 内部横切参数变多

目前 `createApplicationRuntime(options)` 内部大量闭包直接捕获 `options.documents`、`gateway`、`now()`，并在多个模块间继续传递：

- `runtime.ts`
  - 高频使用 `options.documents`
  - 高频调用 `now()` / `createId(...)`
  - 同时负责 Provider Gateway、PromptBuild、Timeline、Run 写入
- `agent.ts`
  - `readAgentBinding({ documents, agentRuntimeProfileId })`
  - `writeAgentTranscriptEntry({ documents, timestamp, ... })`
- `workspace.ts`
  - 所有资源 CRUD 都接收 `documents`
  - 部分操作还接收 `now`
- `prompt.ts` / `prompt-build-pipeline.ts`
  - PromptBuild 输入需要 `documents`
  - 但真正决定本次构建行为的仍是 `session/branch/userInput/workspaceId/activationFacts/orderProfile`
- `gateway.ts`
  - document-backed gateway 需要 `documents`
  - OpenAI compatible gateway 需要 secret 解析、fetch、provider/model config

这些是典型的横切基础设施参数，适合被 ctx 收拢。

### 1.2 已经存在 Server RPC Context，但没有传入 Application Runtime

`apps/studio-server/src/studio-rpc-router.ts` 已有 `RpcCallContext`：

- `clientId`
- `correlationId`
- `callId`
- `parentCallId`

但 application RPC 当前没有使用这个 context。未来如果要做 trace、审计、插件调用链、请求级 diagnostics，这些字段应该能进入应用层运行上下文。

### 1.3 PromptBuild Trace 需要显式输入，不适合把事实藏进 ctx

PromptBuild 已经接入 Loom Core trace。为了让 trace 可解释，以下内容必须继续作为显式 request 字段：

- `userInput`
- `workspaceId`
- `activationFacts`
- `projectionOrderProfile`
- `session/branch`

如果把这些塞进 ctx，会导致 trace 只能看到“某处上下文状态”，很难解释“为什么这次某个 entry active/inactive”。

---

## 2. 适合进入 ctx 的内容

### 2.1 第一批：稳定基础设施能力

建议第一版 `ApplicationRuntimeContext` 只包含这些字段：

```ts
type ApplicationRuntimeContext = {
  documents: DocumentStore
  gateway: AiGateway
  clock: { now(): Date }
  nowIso(): string
  createId(prefix: string): string
}
```

理由：

- 它们是能力，不是业务数据。
- 它们已经在多个模块反复传递。
- 它们不决定“这次业务请求是什么”，只决定“如何执行”。

### 2.2 第二批：观测与诊断能力

等第一批稳定后，可以加入：

```ts
type ApplicationRuntimeContext = {
  diagnostics?: DiagnosticSink
  logger?: RuntimeLogger
  trace?: RuntimeTraceSink
  request?: {
    clientId?: string
    correlationId?: string
    callId?: string
    parentCallId?: string
  }
}
```

用途：

- 把 server RPC 的调用链信息传入 application layer。
- 统一 Provider 调用、PromptBuild、Document 写入的诊断记录。
- 后续 Inspector / DevTools 可以展示 request-level trace。

### 2.3 第三批：安全和外部能力

后续如果需要：

```ts
type ApplicationRuntimeContext = {
  secretResolver?: SecretResolver
  permission?: PermissionContext
  fetch?: typeof fetch
}
```

适用场景：

- Provider API Key 不再只靠 `plain:` / `env:`。
- 多用户或权限模型出现后，需要 request-level permission。
- 测试或插件沙箱需要替换 fetch。

---

## 3. 不适合进入 ctx 的内容

以下字段不应放入通用 ctx：

- `sessionId`
- `branchId`
- `runId`
- `workspaceId`
- `agentRuntimeProfileId`
- `modelProfileId`
- `userInput`
- `activationFacts`
- `projectionOrderProfile`
- `cardSnapshot`
- `prompt contributions`
- `provider messages`

原因：

1. 它们是业务输入，应该在函数签名中可见。
2. 它们影响 PromptBuild 和 Provider payload 的实际结果，必须进入 trace 或 request 摘要。
3. 如果藏在 ctx，会形成隐式耦合，后续插件和测试会更难判断行为来源。

例外：

- `runId` 可以在 `submitTurn` 内部生成后放入局部 `turnContext`，但不应进入全局 `ApplicationRuntimeContext`。
- `agentRuntimeProfileId/modelProfileId` 可以进入 Provider 调用 request 的 metadata，但不应由 gateway 从 ctx 中猜。

---

## 4. 建议类型分层

### 4.1 ApplicationRuntimeContext

应用层基础设施上下文。

```ts
type ApplicationRuntimeContext = {
  documents: DocumentStore
  gateway: AiGateway
  now(): string
  createId(prefix: string): string
  request?: RuntimeRequestContext
}
```

### 4.2 RuntimeRequestContext

请求级观测上下文，来自 RPC / HTTP / Extension Host。

```ts
type RuntimeRequestContext = {
  clientId?: string
  correlationId?: string
  callId?: string
  parentCallId?: string
}
```

### 4.3 Operation Request

每个业务操作仍保留显式 input。

```ts
type SubmitTurnRequest = {
  sessionId: string
  branchId?: string
  input: string
  intent?: string
  workspaceId?: string
  activationFacts?: ActivationFacts
  projectionOrderProfile?: ProjectionOrderProfile
  agentRuntimeProfileId?: string
}
```

### 4.4 Local Operation Context

复杂操作内部可以创建局部上下文，但不要暴露成全局 ctx。

```ts
type SubmitTurnLocalContext = {
  timestamp: string
  runId: string
  userEntryId: string
  assistantEntryId: string
}
```

---

## 5. 迁移计划

### Phase 1：只引入内部 ctx 工厂，不改 public API

目标：

- 在 `runtime.ts` 内创建 `ctx`：

```ts
const ctx = createApplicationRuntimeContext(options)
```

- `createApplicationRuntime(options)` 的 public API 不变。
- 只替换局部重复引用：
  - `options.documents` -> `ctx.documents`
  - `gateway` -> `ctx.gateway`
  - `now()` -> `ctx.now()`
  - `createId(...)` -> `ctx.createId(...)`

收益：

- 低风险。
- 先形成统一入口。
- 不影响 RPC、测试和前端。

验证：

- `pnpm build`
- application-runtime integration tests
- provider rollback regression tests

### Phase 2：模块函数从 `documents` 迁移到 ctx

优先迁移纯基础设施函数：

- `agent.ts`
  - `readAgentBinding(ctx, request)`
  - `writeAgentTranscriptEntry(ctx, request)`
- `timeline.ts`
  - `readSessionBranch(ctx, request)`
  - `readBranchPath(ctx, request)`
- `workspace.ts`
  - CRUD 操作可以逐步从 `{ documents, now, ... }` 迁移到 `{ ctx, ... }`

注意：

- 不要一次性改完整个 runtime。
- 不要为了 ctx 改业务类型。
- 每次迁移一个模块，保持测试绿。

### Phase 3：PromptBuild bridge 接收 ctx，但 request 仍显式

目标形态：

```ts
runPromptBuildPipeline(ctx, {
  session,
  branch,
  userInput,
  workspaceId,
  activationFacts,
  orderProfile,
})
```

原则：

- `documents` 可以来自 ctx。
- `activationFacts/userInput/orderProfile` 继续留在 request。
- Trace meta 继续记录 request 摘要。

### Phase 4：RPC context 下沉到 Application Runtime

当前 server 已有 `RpcCallContext`，但 application RPC 未使用。可以扩展为：

```ts
callApplicationRpc(runtime, method, params, rpcContext)
```

再由 runtime operation 创建 request-scoped ctx：

```ts
runtime.withRequestContext(rpcContext).submitTurn(input)
```

或者更简单：

```ts
createApplicationRuntime({ ..., requestContextProvider })
```

第一版建议不要引入复杂 builder。只有当 trace/audit 确实需要 request-level 信息时再做。

### Phase 5：Plugin / Extension Context 独立设计

不要直接把 `ApplicationRuntimeContext` 暴露给插件。

插件应拿到独立的 Host Context。它不是资源 API 封装层，而是插件运行环境：

```ts
type PluginContext = {
  rpc: PluginRpcClient
  scope: PluginScopeSnapshot
  app: PluginHostSnapshot
  plugin: PluginIdentity
  permissions: PluginPermissions
  diagnostics?: DiagnosticSink
  logger?: Logger
  ui?: PluginUiBridge
  commands?: PluginCommandRegistry
}
```

原因：

- 插件不能拿到底层 `DocumentStore`。
- 插件不能直接调用 `gateway`。
- 插件读写 Card / Preset / Setting Layer / Session 等数据默认走 typed RPC。
- `scope` 只放宿主挂载插件时已经拥有的轻量快照，例如 `workspaceId`、`cardId`、`sessionId`、卡片名称或当前宿主版本。
- `scope` 不是权威数据源，不承诺实时同步；持久化修改必须回到 RPC。
- 插件权限、沙箱、审计需要单独边界。

---

## 6. 风险与约束

### 6.1 万能 ctx 风险

如果 ctx 变成随手塞字段的容器，会退化成隐式全局变量。

约束：

- 新增 ctx 字段必须满足“基础设施能力”或“观测能力”。
- 业务输入禁止进入全局 ctx。
- ctx 字段必须有明确 owner 和测试替换方式。

### 6.2 Trace 可解释性风险

PromptBuild / Provider 调用如果从 ctx 隐式读取事实，会让 trace 失真。

约束：

- PromptBuild request 摘要必须显式包含影响构建结果的输入。
- Provider request metadata 必须显式包含模型和 run/session/branch 信息。

### 6.3 测试可读性风险

过早把所有函数改成 ctx，会让单测构造成本上升。

约束：

- 提供最小测试 ctx factory。
- 纯函数保持纯函数，不为了统一而引入 ctx。
- `prompt-builder.ts`、`prompt-activation.ts` 这类纯计算模块不接 ctx。

---

## 7. 推荐落地顺序

1. 新增 `application-context.ts`
   - 定义 `ApplicationRuntimeContext`
   - 定义 `createApplicationRuntimeContext(options)`
2. 在 `runtime.ts` 内部使用 ctx
   - 只替换 `documents/gateway/now/createId`
   - public API 不变
3. 视需要迁移 `agent.ts` 和 `timeline.ts`
   - 只有当横切能力继续增加时再迁移，不为了统一而统一
4. 谨慎评估 `workspace.ts`
   - 当前 `{ documents, now, ... }` 仍然直白；除非 trace / request context 进入这些操作，否则不强制替换
5. 视需要迁移 `prompt.ts` / `prompt-build-pipeline.ts`
   - ctx 只提供 `documents`
   - request 保留 PromptBuild 显式输入
6. 等 trace/audit 需求明确后再接 RPC request context

---

## 8. 暂不做的事情

- 不把所有 operation input 合并进 ctx。
- 不把 PromptBuild facts 放进 ctx。
- 不把 Provider model profile 放进 ctx。
- 不把 ctx 暴露给插件。
- 不做依赖注入框架。
- 不引入 decorator / service container。

---

## 9. Definition of Done

第一阶段完成标准：

- `createApplicationRuntime` 内部存在统一 ctx。
- runtime 内部不再大量直接引用 `options.documents`。
- 所有现有 application-runtime / studio-server 测试通过。
- public API 和 RPC payload 不变。
- PromptBuild trace 内容不减少。

最终完成标准：

- Application Runtime 内部基础设施能力统一从 ctx 获取。
- 业务 request 输入仍显式。
- Server RPC correlation 信息可以进入诊断/trace。
- 插件 context 与 application runtime ctx 保持隔离。

---

## 10. Implementation Notes

### 2026-07-01：Phase 1 初始落地

已新增 `packages/application-runtime/src/application-context.ts`：

- 定义 `ApplicationRuntimeContext`
- 收拢 `documents`
- 收拢 `gateway`
- 收拢 `now()`
- 收拢 `createId(prefix)`

`runtime.ts` 已改为通过 ctx 访问上述基础设施能力，`createApplicationRuntime(options)` 的 public API 未变化。

仍保持显式传参的内容：

- PromptBuild 的 `userInput`
- `workspaceId`
- `activationFacts`
- `projectionOrderProfile`
- `session/branch`
- Provider 调用 request metadata

这符合本计划的核心约束：ctx 只作为基础设施工具箱，不承载本次业务行为。
