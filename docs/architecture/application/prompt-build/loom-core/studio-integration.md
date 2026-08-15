# Loom Core 与 Studio 集成

本文说明 Loom Studio 如何在不污染 Core 的前提下使用 `@loom/core`。

## 1. 两条集成路径

```text
Application Runtime
  -> 直接使用 @loom/core public API
  -> 第一方 PromptBuild

Kernel RPC
  -> Loom Runner
  -> @loom/core public API
  -> 领域无关 loom.run
```

两条路径共享 Core 执行模型，但拥有不同的输入校验、Trace 投影和业务职责。

## 2. PromptBuild 的职责

PromptBuild 在 Core 之外负责：

- 从 Document Store 和 Runtime 输入读取数据；
- 构造 SourceNode 与 PromptContribution；
- 执行宏与领域数据准备；
- 计算 Activation；
- 解释 Skeleton、Zone、Slot 和 Injection Group；
- 应用 Projection order；
- 生成 CompiledPrompt 与 ProviderMessage；
- 决定 Trace 对上层暴露的内容。

Core 只看到 PromptBuild 创建的 Fragment、Pass 和 metadata，不理解上述概念。

## 3. Source Adapter 边界

历史设计最终收敛出的稳定边界是：

```text
Documents / Runtime Sources
  -> Application Source Preparation
  -> prepared domain data
  -> Application-owned Core Passes
```

数据库、文件、网络与宏展开发生在 Core 外。Core 不提供 `runWithSources()`，也不把 Card、Setting Layer 或 Session 输入变成命名参数。

当前 `composeAgentTurnPrompt()` 会在调用 Core 前异步完成：

- Narrative branch 读取；
- Workspace prompt asset 读取；
- Card snapshot 与 macro context 准备；
- SourceNode、Contribution 和 OrderProfile 组合。

## 4. 当前 PromptBuild Pipeline

后端当前切片已经注册三个第一方 Pass：

```text
prompt.materialize
  -> Source Fragment 转为 Composition Fragment
  -> 计算 Activation，并保留 active / inactive 原因

prompt.order
  -> 按 Zone、Projection Order、Slot Hint 与 Source Tree 排序

prompt.emit
  -> 从 active Composition Fragment 生成 Message Fragment
  -> Application 适配器构造 CompiledPrompt / ProviderMessage
```

运行配置由 Application Runtime 通过 `PassRegistry` 和 JSON-compatible `PassConfig` 提供：

```ts
run({
  fragments: sourceFragments,
  passes: [
    { name: 'prompt.materialize', params: materializeParams },
    { name: 'prompt.order', params: orderParams },
    { name: 'prompt.emit', params: emitParams },
  ],
  registry,
  trace: { mode: 'on' },
})
```

### 4.1 当前粒度限制

当前仍将 Source Preparation 保留在 Core 外，将 Activation、Composition、排序和 Emit 收束在三个第一方 Pass 中。`normalize`、`filter`、`slot fill` 等更细粒度拆分暂不提前引入，避免 Trace 和 Owner 归因膨胀。

当前实现已经能够通过独立 Core Pass 展示 materialize / order / emit 的 Mutation；400～500 条目真实性能门槛、Client Inspector 消费和旧编译器删除仍属于迁移计划的后续阶段。

## 5. 编译结果的输出方式

`prompt.emit` 生成 provider-neutral Message Fragment。Application Runtime 从 Core final Fragment 读取 Message Fragment、Composition Fragment 和稳定 Source 引用，构造 `CompiledPrompt` 与 Provider Message。

Core 不接收或输出 Provider request body，也不通过 closure callback 带出结构化编译结果。Replay 可以重建 final Fragment；`CompiledPrompt` 是 Application 对 final Fragment 的确定性解释，而不是 Core 的领域类型。

## 6. PromptBuild Trace 压缩

Application Runtime 不直接把原始 Core Trace 全量返回给 UI，而是生成 `core-compact-1` trace：

- 保留 status、Pass 顺序、耗时和 Mutation 操作摘要；
- 保留 Diagnostic code、severity 与关联 Fragment ID；
- 保留 Build / Run / Agent Session / Timeline 关联 ID；
- 不携带完整 Fragment content、Pass 参数、Secret 或 Provider headers；
- Raw Trace 只在 Application Runtime 内部使用，Client 消费 compact Trace。

这是 Application 层的隐私与载荷策略，不改变 Core Trace contract。

## 7. Loom Runner

`packages/loom-runner` 是 Kernel/RPC 面向 Core 的 adapter：

```text
JSON fragments / pass configs
  -> trust-boundary validation
  -> PassRegistry + Core run
  -> Studio Diagnostic mapping
  -> optional Trace Audit persistence
```

Runner 当前：

- 校验 Fragment 是对象且具有 string id/content；
- 校验 PassConfig 具有 string name；
- 注册默认示例 Factory 与注入 Factory；
- 把 Core Diagnostic 映射为 Studio Diagnostic；
- 仅在请求 `trace.enabled` 时持久化 Trace；
- 默认把 Trace 持久化失败降级为 Diagnostic；
- `strictPersist` 时让持久化失败中断调用。

Kernel 不直接 import `@loom/core`。`loom.run` 通过 Loom Runner 进入 Core。

## 8. Kernel 业务防线

Kernel 的 `loom.run` 会拒绝以下字段：

```text
messages
model
temperature
tools
toolChoice
chatId
sessionId
provider
```

这防止 Provider、Chat 和 Agent 语义绕过 Application Runtime 下沉到 Core adapter。

## 9. Extension 边界

ordinary Extension 当前不应直接依赖 Core internal path。未来如果 Extension 贡献 Pass，应通过 Studio 定义的 Extension/Registry contract 接入，并由 Host：

- 记录可信 owner；
- 校验命名冲突；
- 管理生命周期；
- 提供必要隔离；
- 将调用纳入平台 Trace/Audit。

Core 本身不实现这些平台职责。

## 10. 与 Provider 的边界

```text
PromptBuild
  -> CompiledPrompt / ProviderMessage
  -> Provider Adapter
  -> provider-specific request
  -> Gateway / network
```

Core 不认识 Provider。PromptBuild 当前产出 `ProviderMessage[]` 是 Studio Application contract，不是 `@loom/core` contract。

## 11. 当前依赖规则

允许：

```text
application-runtime -> @loom/core
loom-runner          -> @loom/core
```

禁止：

```text
kernel          -> @loom/core
document-store  -> @loom/core
extension-host  -> @loom/core
studio-client   -> @loom/core
ordinary extension -> Core internal path
```

任何新增直接依赖都必须先证明无法通过 Application Runtime、Loom Runner 或公开 Extension contract 表达。
