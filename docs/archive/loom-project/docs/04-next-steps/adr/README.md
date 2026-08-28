# Loom ADRs

Architecture Decision Records — 由 [`loom-adr-candidates.md`](../loom-adr-candidates.md) 在 PoC 收尾后裁决产出。

## 索引

| # | 标题 | 状态 | 候选来源 |
|---|---|---|---|
| [ADR-001](./ADR-001-stackid-trust-model.md) | stackId 是软标识，不引入运行时校验 | Accepted | C-001 |
| [ADR-002](./ADR-002-trace-default-mutation-only.md) | Trace 默认产出 mutation-only，snapshot 仅 opt-in | Accepted | C-002 |
| [ADR-003](./ADR-003-rpc-namespace-enforcement.md) | Extension RPC 强制 `extensionId.method` 命名空间，Kernel 校验注册冲突 | Accepted | C-003 |
| [ADR-004](./ADR-004-pass-write-soft-ownership.md) | Pass 写权限不阻拦，但 owner 越权写自动产生 Diagnostic | Accepted | C-004 |
| [ADR-005](./ADR-005-pass-registry-factory.md) | PassRegistry 改造为工厂函数注册 + Payload 配置化 | Accepted | C-005 |
| [ADR-006](./ADR-006-capability-validation-as-stdlib-linter.md) | capability 校验下沉到 Stdlib 作为 LinterPass / DevTool 命令 | Accepted | C-006 |
| [ADR-007](./ADR-007-remove-resolve-barrier.md) | 移除 Resolve Barrier，Pipeline 回归纯同步 | Accepted | C-007 |

## 决策视角

七个 ADR 的整体气质来自一个视角切换：**从"Loom 维护者的哲学纯洁"切换到"生态开发者的生存保障"**。

切换后的关键判断：

- 七个里有 **六个走"克制"** 的方向（A/B/C 不引入运行时复杂度），唯一的加法是 **ADR-005**——因为 Spike 已证明"配置化流水线"是 Loom 最有商业价值的抽象，值得 Core 多做一点。
- 三个 ADR（**002 / 004 / 006**）的最终方案**不在原候选 A/B/C/D 之列**，是讨论中扩展的新路线，因为原候选都没有同时解决"克制"和"生态可生存"的张力。

## ADR 间的相互依赖

- **ADR-005 ↔ ADR-007**：工厂参数模式吸收了大部分异步需求，使移除 barrier 成为可能；反过来 barrier 的移除让 factory 必须同步返回。
- **ADR-006 ↔ ADR-005**：`validatePipeline` 的输入是 `PassConfig[]`（来自 ADR-005），可同时校验 capability 与 params schema。
- **ADR-002 ↔ ADR-004**：mutation-only trace（ADR-002）正好承载 cross-owner-write Diagnostic（ADR-004），无需独立通道。
- **ADR-001 ↔ ADR-003**：stackId 是软标识（audit），extensionId 是硬身份（Plugin Host 注入）；两者互补而非冗余。

## Follow-ups

裁决后留给后续 sprint 的具体动作：

- 给 14 个 ST Pass 补 `requires/provides` 声明（ADR-006 follow-up）。
- DevTool CLI v0.1 实现 mutation replay（ADR-002 follow-up）。
- `PassRegistry` 工厂化的正式版实现 + 类型推导（ADR-005）。
- `Pipeline.run` 类型收紧迁移（ADR-007）。
- 白皮书 / studio-architecture 同步更新（ADR-001/002/004/007 都涉及文档调整）。
- **DevTool 分层落地**（ADR-002 + 新增 [`loom-devtool-layered.md`](../../02-architecture/loom-devtool-layered.md)）：
  - 把 `FileSink` 从 `@loom/core` 迁出到 `@loom/devtool` 包。
  - `MemorySink` 默认 ring buffer 上限实施。
  - 创建 `@loom/devtool` 包骨架（CLI + 静态 HTML report）。

## 待提案的 ADR 候选（来自 DevTool 分层讨论）

`loom-devtool-layered.md §9` 浮出三个新候选 ADR 题，需在后续 sprint 单独立项：

- **(候选) Trace JSON Schema 升格为公开契约**：版本号、兼容性策略、跨语言 schema 包发布。
- **(候选) Pass 配置 schema 内省机制**（ADR-005 续集）：让 Workbench 能给用户填表单。
- **(候选) Snapshot 中 Thunk 的序列化策略**（ADR-007 续集）：thunk fragment 如何跨会话 replay。
