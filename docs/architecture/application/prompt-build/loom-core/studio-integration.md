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

当前 `runPromptBuildPipeline()` 会在调用 Core 前异步完成：

- Narrative branch 读取；
- Workspace prompt asset 读取；
- Card snapshot 与 macro context 准备；
- SourceNode、Contribution 和 OrderProfile 组合。

## 4. 当前 PromptBuild Pipeline

当前实现注册两个 Pass：

```text
prompt.source.prepared
  -> 添加输入摘要 Fragment

prompt.compile
  -> 调用 compilePromptDataModel()
  -> 生成 CompiledPrompt / ProviderMessage
  -> 添加输出摘要 Fragment
```

运行配置：

```ts
run({
  fragments: [],
  passes: [
    { name: 'prompt.source.prepared' },
    { name: 'prompt.compile' },
  ],
  registry,
  trace: { mode: 'on' },
})
```

### 4.1 当前粒度限制

完整的 Activation、排序、Zone/Slot materialization、Skeleton fill 和 ProviderMessage 生成目前都在 `prompt.compile` 内一次完成。

因此当前 Trace 能证明：

- PromptBuild 输入已经准备；
- PromptBuild 编译成功或失败；
- 输入/输出摘要 Fragment 如何产生；

但它还不能通过独立 Core Pass 展示每个领域阶段的 Mutation。

历史 `loom-st` 文档提出过将 Activation、Filter、Order、Fill、Emit 拆成原子 Pass，以便 DevTool 观察每一步。该方向与当前 PromptBuild 的 Structure / Source / Capability 设计兼容，但尚未在现行 pipeline 落地，不能作为当前 Architecture 描述。

## 5. 编译结果的输出方式

`prompt.compile` 当前通过闭包 callback 把：

```text
CompiledPrompt
ProviderMessage[]
```

带出 Core run，同时在 Fragment 流中只添加一个输出摘要 Fragment。

这意味着 CompiledPrompt 不是 Core Fragment 的正式最终格式。Core Trace 记录编译步骤，结构化 payload 由 PromptBuild 自己返回。

该设计保持 Provider payload 不进入 Core，但也意味着仅凭 Core Fragment replay 不能重建完整 `CompiledPrompt` 对象。

## 6. PromptBuild Trace 压缩

Application Runtime 不直接把原始 Core Trace 全量返回给 UI，而是生成 compact trace：

- 保留 version、mode、status、error；
- 保留 PassConfig、Diagnostic、Pass 顺序与耗时；
- 保留 Mutation 形态；
- Fragment content 改为 length + 最多 240 字符 preview；
- Meta 收窄为 PromptBuild 需要的统计字段。

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
