# ADR-001: stackId 是软标识，不引入运行时校验

- **Status**: Accepted
- **Date**: 2026-04-29
- **Promoted from**: [ADR-C-001](../loom-adr-candidates.md#adr-c-001-stackid-的信任模型)
- **Related**: studio-architecture §9 Tenet IV, §14 Open Question #9

## Context

studio-poc 的 transport 层不校验 client 自报的 stackId。Trace 里 stackId 是 audit string，但架构文档曾把它当作 first-class identity，留下了"是否应做注册绑定校验"的悬念。

从生态开发者视角再审视：
- **Concept Stack 作者**关心的是"我的 stackId 安不安全、能不能被假冒"。
- 但 Loom 的安全模型从设计起就建立在 **Plugin Host 沙箱 + Trace 审计** 上，stackId 从来不是访问凭证，而是用于在多 Concept Stack 共存时为流量打 audit 标签。

## Decision

**采纳候选方向 A**：保持现状，stackId 仅作 audit string；任何依赖 stackId 做权限决策的代码视作 bug。

具体规则：
- transport 层不对 stackId 做注册或绑定校验。
- stackId 仍写入 trace 的每条 PassExecution。
- 在白皮书 / studio-architecture 中显式补一条："stackId 是软标识（audit token），不是访问凭证。"

## Consequences

- **正面**：
  - Kernel 不长出"会话感知"，Tenet IV "Kernel Runs Pipelines, Not Sessions" 维持完整。
  - Concept Stack 注册流程保持极简（无 stackId 握手）。
  - 跨 Concept Stack 流量分析仍可用 stackId + extensionId 组合做事后审计。
- **负面 / 已知缺口**：
  - 无法在运行时阻止恶意 client 伪造 stackId；这一类问题被推给 Plugin Host 沙箱解决（即"恶意代码进不来"，而不是"代码进来了再分辨身份"）。
  - 若未来出现"基于 stackId 做 introspect 权限隔离"的需求，需另起 ADR。

## Alternatives Considered

- **B. 注册绑定校验（client connect 时声明 stackId，kernel 绑定后校验）**
  - 拒绝原因：把会话状态塞进 Kernel，违反 Tenet IV；且只在"恶意 client 已经突破沙箱"的极端场景下提供边际价值。
- **C. 移除 stackId，trace 只记 clientId + extensionId**
  - 拒绝原因：stackId 是分析"同一个 Concept Stack 内多 Extension 协作"的关键聚合键，移除后 DevTool 时间轴的可读性显著下降。

## Implementation Notes

- 不需要代码改动；本 ADR 是对现状的明确化。
- 文档侧在 studio-architecture §9 Tenet IV 与白皮书 Trust Model 章节各加一段引用本 ADR。
