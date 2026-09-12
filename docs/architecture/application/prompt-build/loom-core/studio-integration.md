# Loom Core 与 Studio 集成

本文区分当前可执行调用链与依赖声明。当前 Kernel 的 `loom.run` 通过 Loom Runner 执行 Core；Agent PromptBuild 使用 Application 内部 DFS 编译器，没有调用 Core Pass Pipeline。

## 1. 两条集成路径

```text
Agent Runtime
  -> composeAgentTurnPrompt
  -> compilePromptDataModel（Application DFS）
  -> CompiledPrompt / Provider 输入

Kernel RPC loom.run
  -> Loom Runner
  -> @loom/core run / PassRegistry
  -> Fragment / Trace
```

`application-runtime` 的 package.json 仍声明 `@loom/core` 依赖，但依赖存在不证明业务执行经过 Core。旧文档所述三段 Pass 已不符合当前源码；是否恢复集成需要独立决策，本次事实修订不重开归档迁移计划。

## 2. PromptBuild 的职责

PromptBuild 从领域 Store 与 Runtime 输入准备 SourceNode / PromptContribution，展开宏、计算 Activation，按 Preset 有序树及 Anchor 内部的 `localDepth` 编译消息。Card、Setting、Timeline、Agent 和 Provider 语义由 Application 拥有，不能下沉到 Core。

源码入口：

- [Agent 来源组装与 Trace](../../../../../packages/application-runtime/src/agents/agent-turn.ts)
- [DFS 编译器](../../../../../packages/application-runtime/src/prompt/prompt-build-pipeline.ts)
- [Composition 类型](../../../../../packages/application-runtime/src/prompt/prompt-builder.ts)

## 3. Source Adapter 边界

```text
领域 Store / Runtime Sources
  -> Application Source Preparation
  -> SourceNode + PromptContribution
  -> Application DFS 编译
```

外部贡献保留来源身份与目标 Anchor，宏只展开宿主正文，不替代结构化挂载。数据库、网络与宏数据准备不进入 Core Pass；Core 本身不提供领域 Source Adapter。

## 4. 当前 PromptBuild Pipeline

`composeAgentTurnPrompt()` 直接调用 `prompt/prompt-build-pipeline.ts` 的 `compilePromptDataModel()`。当前路径没有注册或执行 `prompt.materialize`、`prompt.order`、`prompt.emit`。

Narrative Node 使用 `@chat.narrative`，Agent Session 历史使用 `@chat.session`，当前输入使用 `@chat.input`。实际消息位置由 Preset 树与编译器决定，不使用旧 `@history.*` 名称作为 Runtime 默认合同。

Narrative Node 本身没有 Provider role；最终 role 来自包裹它的 Message 节点。当前编译器也包含旧树形态的兼容分支，不能把所有输入都描述为 Core Message Fragment。

### 4.1 当前粒度限制

当前没有 Application Pass Mutation、Pass 耗时或 Core Replay 证据。DFS 编译结果与 Core 的 Fragment Trace 是不同合同，不能因结构中仍有 `core-compact-1` 版本字符串而混同。

## 5. 编译结果的输出方式

DFS 编译器返回 `CompiledPrompt`，包含 `messages` 与 `editorProjection`。Agent Runtime 再将其作为 Provider 输入；Provider Adapter 负责 wire 格式转换。该结果不是从 Core final Fragment 反向解码得到的。

## 6. PromptBuild Trace 压缩

当前 `PromptBuildTrace` 沿用 `version: 'core-compact-1'`，但由 Agent Composer 构造最小摘要：

- 编译成功后的 `status: 'ok'` 与 Build / Run / Agent Session 关联字段；
- 输入贡献数、输出消息数；
- 空 `diagnostics` 与空 `executions`；
- 单独附加的变量读取记录。

这些不是对真实 Core Trace 的压缩。编译抛错时也不会从该路径生成完整失败 Pass Trace。Client 可以展示这份 JSON，但不能据此获得逐 Pass 因果链、Mutation 或 Replay 能力。专业可观测性仍见 [PromptBuild 计划](../../../../workbench/plans/log-plan/prompt-build-observability.md)。

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
- 注册组合根注入的 Factory；
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

Core 不认识 Provider。PromptBuild 当前产出 `CompiledPrompt.messages`，Agent Runtime 将其作为 Provider 输入；这些都是 Studio Application 合同，不是 `@loom/core` 合同。

## 11. 当前依赖规则

依赖规则允许下列 Package 声明 Core 依赖；当前实际执行者是 Loom Runner，Application 依赖声明不等于已接入：

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
