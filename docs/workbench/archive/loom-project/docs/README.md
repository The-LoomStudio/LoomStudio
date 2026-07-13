# Loom Documentation Index

Loom 的设计与决策文档库。

## 01. 基础与概念 (Foundation & Concepts)
- [白皮书 (Whitepaper)](./01-foundation/loom-whitepaper.md) - Loom 的核心愿景、白皮书与基础框架设计。
- [项目边界 (Scope)](./01-foundation/loom-scope.md) - Loom 包含什么，坚决不包含什么。
- [ST 宪章 (ST Charter)](./01-foundation/loom-st-charter.md) - `@loom/st` 的开发指导原则与目标。

## 02. 架构设计 (Architecture)
- Studio 架构与 UI 文档已迁移到独立 Studio 文档库：`/Users/macbookair/Desktop/LoomStudio/docs/`。本仓库仅保留 Loom Core / Stdlib / DevTool 相关文档。
- [可观测性 (Observability)](./02-architecture/loom-observability.md) - Trace、快照、诊断与可观测性**协议**。
- [DevTools — 投影虚拟树 (UX 哲学)](./02-architecture/loom-devtools.md) - DevTool 在用户面前**应该长什么样**：平铺底座、投影虚拟树、级联剪枝。
- [DevTool 分层方案 (Distribution)](./02-architecture/loom-devtool-layered.md) - DevTool 如何**被打包交付**到三层用户：Layer 1（`@loom/core`）/ Layer 2（`@loom/devtool`）/ Layer 3（Studio Extension）。
- [架构 Q&A (Architecture Answers)](./02-architecture/loom-architecture-answers.md) - 针对架构疑难问题的解答与决策。

## 03. PoC 存档 (PoC Archive)
> 本目录下的文件记录了早期的 Proof of Concept 过程，**现已全部封存 (Sealed)**。仅作历史参考。
- [Loom Core PoC 计划](./03-poc-archive/loom-poc-plan.md)
- [Loom Studio PoC 计划](./03-poc-archive/loom-studio-poc-plan.md)
- [Loom Core PoC 回顾](./03-poc-archive/loom-poc-review.md)
- [Loom PoC 收口行动 (Hardening Brief)](./03-poc-archive/loom-poc-hardening-brief.md)

## 04. 下一步决策与验证 (Next Steps)
- [**ADRs (Accepted)**](./04-next-steps/adr/README.md) - PoC 收尾后裁决落地的七个架构决策记录（ADR-001 ~ ADR-007）。
- [ADR 候选清单 (ADR Candidates)](./04-next-steps/loom-adr-candidates.md) - 候选阶段的历史快照与决策溯源（已全部 promote 为 ADR）。
- [回归测试种子 (Regression Questions)](./04-next-steps/loom-poc-questions.md) - 正式版开发时必须考虑的各种边缘情况和测试用例集。
