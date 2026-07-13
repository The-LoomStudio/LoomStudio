# Trace、Mutation 与 Replay

Core 的可观测性目标不是替调用方解决冲突，而是提供一份足以解释“每个 Pass 改了什么”的结构化事实。

## 1. 观测原则

### 1.1 协议先于 UI

Core 产出 Trace，但不知道谁消费 Trace。CLI、HTML、Studio Inspector 或第三方工具都应读取同一数据格式，不能依赖 Core 或 Studio 内部对象。

### 1.2 暴露，而不是隐藏

Core 通过 Mutation 和 Diagnostic 暴露：

- Fragment 新增、删除、更新和移动；
- Pass 错误；
- owner 越界修改；
- Factory 与输入校验问题。

它不自动事务合并、修复顺序或消除 Pass 冲突。

### 1.3 运行时中立

Core 的 Trace API 不依赖：

- Node `fs`；
- DOM；
- WebSocket；
- ANSI 终端；
- OpenTelemetry 或远程服务。

这些属于 DevTool 或 Platform adapter。

## 2. Mutation

```ts
type Mutation<M> =
  | { op: 'add'; fragmentId: string; index: number; fragment: Fragment<M> }
  | { op: 'remove'; fragmentId: string; index: number; fragment: Fragment<M> }
  | { op: 'update'; fragmentId: string; index: number; before: Fragment<M>; after: Fragment<M> }
  | { op: 'move'; fragmentId: string; fromIndex: number; toIndex: number }
```

### 2.1 自包含要求

`add`、`remove`、`update` 保存 Replay 所需的完整 Fragment；`move` 保存顺序变化。Replay 不依赖私有 `afterFragments` shortcut。

当前选择完整 `before/after`，而不是 field-level patch，优先保证：

- 语义清晰；
- Debug 工具实现简单；
- Trace 可独立读取；
- Replay 不需要重新加载 Extension。

### 2.2 排序是 Mutation

数组物理位置改变就会产生 `move`。排序、rank 和 reorder 不是 UI 附属信息，而是一等可观察变化。

同一个 Fragment 在一个 Pass 内既移动又修改 content/meta 时，会同时产生 `move` 和 `update`。

Meta-only 变化也会产生 `update`。

## 3. Trace v1

```ts
interface Trace<M = unknown> {
  version: '1'
  mode: 'on' | 'off'
  status: 'ok' | 'error'
  error?: SerializedError
  initialFragments: readonly Fragment<M>[]
  finalFragments: readonly Fragment<M>[]
  passConfigs?: readonly PassConfig[]
  executions: readonly TraceExecution<M>[]
  diagnostics: readonly Diagnostic[]
}
```

`TraceExecution` 当前保存：

- `passName` 与 `passIndex`；
- `durationMs`；
- 本 Pass Diagnostic；
- Mutation；
- 可选 Snapshot。

失败状态当前只记录在 Trace 顶层 `status/error`。失败 Pass 还不会形成带 error 的独立 `TraceExecution`；已经成功完成的 executions 会保留。

## 4. 默认观测模式

默认值：

```text
mode: on
snapshot: off
```

也就是 mutation-first，而不是 snapshot-first。

可选 Snapshot：

- `boundaries`：保存 Pass 前后；
- `after-only`：只保存 Pass 后；
- `off`：不保存 Snapshot。

Snapshot 是显式调试成本，Mutation 是默认解释路径。

## 5. `mode: off` 的当前语义

`trace.mode = 'off'` 时：

- `RunResult.fragments` 仍返回真实结果；
- Trace 的 initial/final/executions 为空；
- Diagnostic 仍然保留；
- Trace Sink 不接收 Pass 事件。

但当前 Runner 仍会创建 Pass 前安全副本、执行 Owner 检查并计算 Mutation。因此 `mode: off` 还不是历史 RFC 所设想的“接近 no-op”性能模式。上层不能把它当作零成本保证。

## 6. Replay

Core 提供：

```ts
applyMutation(fragments, mutation): Fragment[]
replayTrace(trace, { untilPassIndex? }): Fragment[]
```

Replay 从 `initialFragments` 开始，按 execution 与 mutation 顺序应用变化：

```text
initialFragments
  -> Pass 0 mutations
  -> Pass 1 mutations
  -> ...
  -> reconstructed state
```

它可以重建最终状态或指定 Pass 后的状态。

### 6.1 Replay 不等于重新执行

当前 `replayTrace()` 只重建 Fragment 状态，不会：

- 重新实例化 Factory；
- 重新执行 Pass 代码；
- 检查 Pass 版本；
- Fork 参数并从中间重新运行；
- 调用 Extension 或外部资源。

历史 DevTool 文档中的 Replayer / Workbench 是建立在 Trace 协议上的未来工具形态，不是当前 Core 已提供的运行能力。

## 7. Diagnostic

```ts
interface Diagnostic {
  severity: 'error' | 'warning' | 'info' | 'hint'
  code: string
  message: string
  pass: string
  fragmentId?: string
  at?: number
  meta?: Record<string, unknown>
  relatedFragmentIds?: readonly string[]
}
```

Diagnostic 是结构化信息，不等于异常：

- `ctx.diagnose()` 的 error severity 不会自动中断 Pipeline；
- 真正中断由 throw、非法结构、Promise 返回或 owner mutation 触发；
- Diagnostic code 应带 namespace；
- Core 内建 code 使用 `loom/<kebab-case>`。

当前内建或使用中的 code 包括：

```text
loom/invalid-fragment
loom/empty-id
loom/duplicate-id
loom/invalid-content
loom/invalid-pass
loom/factory-missing
loom/factory-threw
loom/pass-threw
loom/async-pass-result
loom/cross-owner-write
loom/owner-mutation
```

## 8. TraceSink

当前 Core `TraceSink` 提供三个可选 callback：

```ts
onPassStart?(passName, passIndex)
onPassEnd?(execution)
onDiagnostic?(diagnostic)
```

Sink 是旁路观察者：任何 callback 抛错都会被忽略，不能改变 Core 执行结果。

Core 当前没有独立 `MemorySink`、`NullSink`、`ConsoleSink` 或 `FileSink` class。`TraceCollector` 是运行内部的默认内存收集器。

File、HTML、远程和 UI Sink 不应进入 `@loom/core`。

## 9. 序列化与 Schema

Core 提供：

```ts
serializeTrace(trace): string
deserializeTrace(input): Trace
deserializeTraceChecked(input): Trace
```

`deserializeTraceChecked()` 当前只验证 Trace v1 的最小顶层结构，不执行完整 JSON Schema validation。

完整 Schema 位于：

```text
packages/core/src/schemas/trace.schema.json
@loom/core/schemas/trace.schema.json
```

Schema 当前由 AJV 测试验证运行时 Trace 和序列化 Trace。它定义 Fragment、PassConfig、Diagnostic、Mutation、Snapshot 和 Execution 的 JSON 形态。

Trace 有显式 `version: '1'`，但跨 major 的兼容读取策略尚未冻结。工具作者当前应拒绝无法理解的版本，而不是猜测字段语义。

## 10. 隐私与持久化边界

Core Trace 可能包含完整 Fragment content 和 meta。Core 不做自动脱敏，因为它不知道哪些字段敏感。

调用方负责：

- 决定是否保存 Trace；
- 在跨信任边界前压缩或脱敏；
- 控制 Trace Audit 的访问权限；
- 避免把 Secret、Credential 或不必要的用户数据写入 Fragment。

PromptBuild 当前使用自己的 compact Trace 投影，只保留 content length、有限 preview 和领域统计，详见 [`studio-integration.md`](studio-integration.md)。

## 11. DevTool 边界

Core 保证机器可读的 Trace、Mutation 和 Replay 原语。DevTool 可以在其上提供：

- 时间线；
- Fragment diff；
- 树形投影；
- 排序和 Activation 变化解释；
- 静态报告；
- Workbench 或历史对比。

DevTool 只能消费公开 Trace 数据，不能要求 Core 为官方 UI 提供私有旁路。
