# 日志后续路线

本目录只保留尚未实施、需要按具体需求另行确认的方向，不是已授权施工清单。当前日志、历史查询、扩展接入、模型观测及快照保留以[日志架构](../../../architecture/platform/logging.md)为准，不再在 Plan 中复制实现合同。

## 尚未实施的方向

| 方向 | 当前边界与接续条件 |
| --- | --- |
| 实时交付与持久化 | 实时日志推送、Browser 持久化/ingest、扩展远程采集尚未实施；现有分页、轮询和导出不等于这些能力。先有真实消费需求再决定协议与存储。 |
| 原生诊断助手 | 原 P6 延后；需明确诊断范围、数据访问及授权，不因已有 Logs 面板自动开放采集。 |
| Notification / TUI | 通知协议与交互终端属于独立候选，不随日志中枢交付自动启动。 |
| 完整观测重放 | 现有证据阅读、关联导航和可选快照不等于可重放执行或完整因果追踪；不恢复已退役 Core / TraceAudit 来实现旧稿。 |

## 已完成的实施记录

- [事件日志中枢与前后端展示](../../../archive/plans/log-plan/operational-log-experience-plan.md)
- [日志平台消费能力](../../../archive/plans/log-platform-consumption-plan.md)
- [模型日志：Prompt Build 与 Agent Run](../../../archive/plans/prompt-run-observability-plan.md)及[技术设计](../../../archive/plans/prompt-run-observability-design.md)
- 早期 [Agent Run 专题](../../../archive/plans/log-plan/agent-run-observability.md)和 [Prompt Build 专题](../../../archive/plans/log-plan/prompt-build-observability.md)已被上述统一实现覆盖，作为历史设计归档；未执行的验收边界保留在原记录。
