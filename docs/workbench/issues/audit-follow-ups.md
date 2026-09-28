# 审查归档后的延期事项

状态：Deferred / Backlog（2026-09-24）

本轮审查修复已收尾。本文只保留归档后仍需可发现的事项，不重新启动审查或扩大实施范围。历史证据见[修复实施记录](../../archive/plans/audit-issue-remediation-plan.md)。

<a id="deferred-ci-acceptance"></a>

## FR-006：远端 CI 首跑

用户确认不急，留待并行开发整合、统一提交后验收。`.github/workflows/ci.yml` 已有本地配置；届时核对同一提交在 GitHub Actions / Ubuntu 上完成依赖安装、workspace 检查、build、lint、test:typecheck 和 test，失败按日志处理。本地分批验证不替代远端结果。

没有提交、推送或远端运行授权；不安排自动跟进。流程不发布、不部署，不纳入独立扩展的发布节奏。当前状态为延期，非通过。

<a id="archive-successor-follow-up"></a>

## 旧计划后续去向

以下承接原 DOC-FOLLOW-002 的记录，不将历史设计自动变成当前需求。

| 历史事项 | 当前归属及剩余边界 |
| --- | --- |
| Chat Message 基座 Phase 3 | 当前 Narrative / Agent Store 和 canonical Transcript 已替代旧模型；完整工作树、跨进程恢复等仍以 [Agent Runtime 计划](../plans/agent-runtime-session-and-workspace-plan.md)为准，不重建旧 Message Store。 |
| Session / Narrative 数据层 Phase 6 | 导航、列表、恢复与失败传播已有分批证据；Session 与分支的完整生命周期仍归 Agent Runtime，不能将界面恢复等同 Server 重启恢复 Run。 |
| MessageBlock 第1项 Direct Preset Entry | 当前 Message 分支直接消费 Entry body；不恢复旧 EntryNode.source 模型，正式语义见 [Default 骨架](../../architecture/application/prompt-build/default-preset.md)。 |
| MessageBlock 第2项 zones 消费方 | 旧 zones/messageBlocks 已被 messages/editorProjection 取代；仍需按当前输出核对客户端投影消费者，不恢复旧 Zone 矩阵。 |
| MessageBlock 第3项 Message 预览 | Message 边界和来源展示仍待真实 UI 核对；旧 Zone 包围框不直接作为新要求，交互设计变化需另行确认。 |
| MessageBlock 第4项旧 Preset 迁移 | 旧 Zone-only 迁移已失效；资源分发按[资源计划](../plans/workspace-resource-and-distribution-plan.md)推进，不新增旧格式兼容，不按旧清单批量删除类型。 |
| MessageBlock 第5项 provenance | 已有 fragmentIds/sourceRows 不等于多来源消息可以端到端定位；仍需验证回指真实资源且正文不夹带元数据。 |

UI 细节和读屏验证按用户决定留待后续微调，不是当前阻塞项，也未记为已通过。The World State 订阅、热重载、State 资源与引用检查继续使用各自 Issue，不在本文重复排期。
