# Workbench Plans 状态索引

本页是 `docs/workbench/plans/` 的施工入口，用于跟踪当前正在推进及延期规划的路线图。
已实现或已被新架构取代的历史 Plan 均已整理归档至 [`docs/archive/plans/`](../../archive/plans/)。

---

## 活跃路线图与延期规划

| 路线图 / 计划                                                                                | 当前状态     | 关注点                                                                  |
| -------------------------------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------- |
| [`agent-runtime-ai-sdk-foundation-plan.md`](./agent-runtime-ai-sdk-foundation-plan.md)       | Phase 4 完成 | AI SDK Gateway、canonical Tool、三类 Transport、Agent Loop 与恢复持久化 |
| [`ai-gateway-streaming-execution-plan.md`](./ai-gateway-streaming-execution-plan.md)         | 后端基础完成 | AI Gateway 流式执行；RPC / Client 消费延期                              |
| [`extension-developer-experience.md`](./extension-developer-experience.md)                   | 延期规划     | Extension SDK、Host 与开发者体验路线图                                  |
| [`application-runtime-modularization-plan.md`](./application-runtime-modularization-plan.md) | 延期规划     | 待真实领域边界长期稳定后渐进拆分 Runtime 包                             |
| [`search-and-timeline-indexing-plan.md`](./search-and-timeline-indexing-plan.md)             | 延期规划     | 基于 Narrative Store 合同重定 Timeline Search 索引                      |
| [`ui/prompt-resource-diff-mode-v0.md`](./ui/prompt-resource-diff-mode-v0.md)                 | 延期规划     | PromptResource Revision 差异对比与 Tokenizer 合同                       |
| [`ui/provider-account-health-plan.md`](./ui/provider-account-health-plan.md)                 | 延期规划     | Provider Account 健康检查与连接状态探测                                 |
| [`ui/provider-model-brand-icons-plan.md`](./ui/provider-model-brand-icons-plan.md)           | 试验完成     | 正式模型品牌资产与图标合同收束                                          |
| [`log-plan/README.md`](./log-plan/README.md)                                                 | 基础已实现   | 历史日志高级过滤、实时订阅与通知系统                                    |

---

## 历史已归档计划

已落地并在主线中稳定运行的历史 Plan（共 17 篇）已移至 [`docs/archive/plans/`](../../archive/plans/)：

- **Prompt 与数据层 V2**：`data-layer-v2-prompt-resource-node-store-plan.md`、`prompt-build-zone-slot-entry-composition-plan.md`、`prompt-build-message-block-implementation-plan.md`、`prompt-build-loom-core-pipeline-migration-plan.md`、`preset-agent-prompt-build-module-plan.md`、`prompt-resource-foundation-plan.md`
- **存储底座与 Session**：`sqlite-data-engine-domain-stores-kernel-plan.md`、`local-data-blob-store-foundation-plan.md`、`provider-profile-secret-store-foundation-plan.md`、`agent-session-narrative-timeline-data-layer-plan.md`、`agent-session-chat-message-foundation-plan.md`、`card-resource-manifest-migration-plan.md`
- **插件、事件与早期基础**：`extension-package-module-foundation-plan.md`、`server-extension-manager-mvp-plan.md`、`event-system-extension-scope-plan.md`、`document-store-kernel-data-foundation-plan.md`、`airp-resource-session-prompt-schema-plan.md`
