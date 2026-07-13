# Loom Core 执行模型

本文描述 `@loom/core` 当前 Fragment、Pass、Registry、Pipeline、错误和 Owner Tracking 语义。

## 1. Fragment

```ts
interface Fragment<M = unknown> {
  readonly id: string
  readonly content: string
  readonly meta: M
}
```

### 1.1 结构约束

Core 在输入与每个 Pass 输出边界校验：

- Fragment 必须是对象；
- `id` 必须是非空字符串；
- 同一时刻的 Fragment 数组中 `id` 必须唯一；
- `content` 必须是字符串。

Core 不生成 Fragment ID。谁创建 Fragment，谁负责它的语义身份。

对于需要跨 run diff、Trace 对比或未来缓存的调用方，相同语义 Fragment 应尽量使用稳定 ID。随机 ID 可以通过单次运行校验，但会破坏跨运行关联能力。

### 1.2 顺序的唯一真相

当前 `fragments[]` 的物理数组顺序是唯一执行顺序：

- 下一个 Pass 按该顺序接收输入；
- Trace 按该顺序保存状态；
- Replay 按该顺序重建状态；
- 排序结果必须体现为数组位置变化。

`meta.order`、`meta.position`、`rank`、`sortKey` 只能作为上层排序 Pass 的输入或解释数据，不能与数组顺序形成第二本账。

### 1.3 Meta 与 JSON 边界

`meta` 在类型层保持泛型，但当前 Core 的安全副本通过 JSON serialize/parse 实现。因此可靠运行实际上要求 meta 是 JSON-compatible 数据。

当前 validation 尚未主动拒绝全部不可序列化值。循环引用、BigInt 等值可能在 Clone 阶段抛出；`undefined`、Date 等值也可能被 JSON 过程丢弃或转换。这是当前实现限制，不是开放任意运行时对象的承诺。

## 2. Pass

```ts
interface Pass<M = unknown> {
  readonly name: string
  readonly version?: string
  readonly reads?: readonly string[]
  readonly writes?: readonly string[]
  readonly requires?: readonly string[]
  readonly provides?: readonly string[]
  run(fragments: readonly Fragment<M>[], ctx: PassContext): readonly Fragment<M>[]
}
```

### 2.1 同步线性执行

- Pass 按声明顺序串行执行；
- Core 不自动并行或重排 Pass；
- `Pass.run()` 必须同步返回 Fragment 数组；
- 返回 Promise 会产生 `loom/async-pass-result` 并终止运行；
- Pass 内不应执行文件、数据库或网络 IO。

异步数据应在进入 Core 前由 Application / RPC / Source Adapter 准备，再通过初始 Fragment 或 PassConfig params 注入。

### 2.2 纯函数约束

Pass 应满足：

- 相同输入与配置产生行为等价的输出；
- 不持有跨 invocation 可变状态；
- 不依赖隐式全局状态；
- 不原地修改调用方数据。

这些是生态与 Replay 成立的前提，但 Core 当前不会静态或运行时证明 Pass 为纯函数。`version` 也是可选 metadata，尚未承担缓存或兼容性校验。

### 2.3 声明字段

`reads`、`writes`、`requires`、`provides` 是供上层 lint、DevTool 和文档使用的声明字段。Core 当前不会：

- 校验 capability 链；
- 自动拓扑排序；
- 因声明缺失阻止运行；
- 验证实际 Mutation 是否符合 reads/writes。

## 3. PassContext

```ts
interface PassContext {
  readonly passName: string
  readonly passIndex: number
  diagnose(diagnostic): void
  log(message: string, data?: unknown): void
}
```

`diagnose()` 会自动补充当前 Pass 与相对时间并进入 RunResult/Trace。

`log()` 当前会在执行期间收集日志，但 public Trace 尚未暴露日志字段。调用方不能依赖这些日志被持久化或传输。

Core 当前不向 PassContext 提供：

- Scope；
- Snapshot history；
- AbortSignal；
- Document Store、RPC 或其他能力句柄。

## 4. PassFactory 与 PassConfig

```ts
interface PassFactory<P = unknown, M = unknown> {
  readonly name: string
  readonly version?: string
  readonly paramsSchema?: unknown
  create(params: P): Pass<M>
}

interface PassConfig<P = unknown> {
  readonly name: string
  readonly params?: P
}
```

Factory 模型让 Pipeline 可以由数据描述，而不是只能传递代码对象：

```text
PassConfig JSON
  -> PassRegistry
  -> PassFactory.create(params)
  -> independent Pass instance
  -> Pipeline Runner
```

这为 Transport、Trace、Workbench 和测试 fixture 提供共同配置形态。

### 4.1 Registry 规则

`PassRegistry` 当前：

- 拒绝非法 Factory；
- 拒绝空名称；
- 拒绝重复 Factory 名称；
- 按 PassConfig 顺序创建 Pass；
- Factory 缺失产生 `loom/factory-missing`；
- Factory 抛错产生 `loom/factory-threw`；
- 每个 PassConfig 都会调用一次 `factory.create()`；Factory 应返回独立 Pass instance，Core 当前不检测 Factory 是否复用同一对象。

Core 只保存和透传 `paramsSchema`，不在 runtime 中执行 schema validation。PassConfig params 也尚未由 Core 完整验证为 JSON-serializable。

## 5. 执行入口

Core 提供两类入口：

```text
run({ fragments, passes, registry, trace })
  面向配置化 Pipeline。

pipeline(passes).run(fragments, traceOptions)
runPasses({ fragments, passes, ... })
  面向直接代码调用和测试。
```

配置化 `run()` 会把 `PassConfig[]` 写入 Trace。直接 Pass 入口没有完整 PassConfig，因此只能重建状态，不能仅凭 Trace 重新实例化原始 Pass。

## 6. 单次运行流程

```text
1. Registry 根据 PassConfig 创建 Pass
2. 校验初始 Fragment
3. 把输入 owner 归一化为 input
4. 为当前 Pass 创建执行前安全副本
5. 调用 Pass.run()
6. 拒绝 Promise 或非法输出
7. 校验 Fragment id/content
8. 检查 owner 是否被篡改
9. 标注新增 Fragment owner
10. 生成 cross-owner Diagnostic
11. 计算 add/remove/update/move Mutation
12. 写入 TraceExecution
13. 进入下一 Pass
```

## 7. 错误边界

Core 对常规 Pipeline 失败使用 `RunResult`：

```ts
interface RunResult<M> {
  fragments: readonly Fragment<M>[]
  trace: Trace<M>
  diagnostics: readonly Diagnostic[]
  status: 'ok' | 'error'
  error?: SerializedError
}
```

规则：

- 初始 Fragment 或 Pass 形态非法时，返回 `status: 'error'`；
- Factory missing / throw 时，返回错误结果；
- Pass throw、Promise、非法输出或 owner mutation 时 fail-fast；
- 后续 Pass 不执行；
- Pass 抛错前通过 `ctx.diagnose()` 产生的 Diagnostic 保留；
- 失败 Pass 的原地修改不会进入最终结果；
- 返回该 Pass 执行前的安全 Fragment 状态；
- 错误进入 `RunResult.error` 与 Trace 顶层 `error`。

Core 不 retry、不 fallback、不自动继续部分失败的 Pipeline。需要领域降级时，Pass 必须自行捕获并显式返回合法 Fragment。

## 8. 当前不可变实现

早期白皮书设想通过 `Object.freeze` 和引用 Snapshot 实现不可变边界。当前代码没有使用该模型。

当前实现采用：

- `readonly` TypeScript 接口表达调用约束；
- Pass 前 JSON Clone 保存安全副本；
- Trace/Snapshot 写入时 Clone Fragment；
- Pass 失败时返回执行前副本。

因此当前契约是“Pass 边界可恢复”，而不是“所有对象都被运行时冻结”。它避免失败 Pass 污染结果，但会产生 Clone 成本，也要求 Fragment meta 保持 JSON-compatible。

## 9. Owner Tracking

Core 保留 `meta.__owner`：

- 初始 Fragment 的 owner 强制归一化为 `input`；
- 调用方伪造的 input owner 会被覆盖；
- 新增 Fragment 的 owner 强制设为创建它的 `pass.name`；
- Pass 不能修改已有 Fragment 的 owner；
- 修改或删除其他 owner 的 Fragment 会产生 `loom/cross-owner-write` warning；
- 纯 `move` 不视为 cross-owner write。

Owner Tracking 用于归因，不是权限系统。跨 owner 写入仍然允许，Core 只让它可见。

## 10. 未实现或未冻结的语义

- Pass `version` 的缓存与 Replay 兼容规则；
- PassConfig `configKey` / 参数指纹；
- JSON-serializable 的完整输入校验；
- `log()` 的 public Trace 表达；
- Capability lint 的正式 Studio 实现；
- Sub-pipeline 与部分执行；
- Cache、Watch 和增量编译。

这些不能被上层当作现有契约。
