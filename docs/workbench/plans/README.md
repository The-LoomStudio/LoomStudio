# Workbench Plans 状态索引

本页是 `docs/workbench/plans/` 的施工入口，用于跟踪当前正在推进及延期规划的路线图。
已实现或已被新架构取代的历史 Plan 均已整理归档至 [`docs/archive/plans/`](../../archive/plans/)。

---

## 活跃路线图与延期规划

| 路线图 / 计划                                                                                | 当前状态     | 关注点                                                                  |
| -------------------------------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------- |
| [`agent-runtime-ai-sdk-foundation-plan.md`](./agent-runtime-ai-sdk-foundation-plan.md)       | Phase 5 完成 | AI SDK Gateway、canonical Tool、三类 Transport、Agent Loop 与恢复持久化 |
| [`ai-gateway-streaming-execution-plan.md`](./ai-gateway-streaming-execution-plan.md)         | 后端基础完成 | AI Gateway 流式执行；RPC / Client 消费延期                              |
| [`extension-data-and-portable-payload-foundation-plan.md`](./extension-data-and-portable-payload-foundation-plan.md) | Phase 1—5 完成 | Scoped Storage、Card Portable Payload；Renderer / Job / GC 待讨论 |
| [`application-capability-cli-mcp-adapters-plan.md`](./application-capability-cli-mcp-adapters-plan.md) | 待实施提案 | Application Capability、CLI 与 MCP 适配器 |
| [`file-backed-resource-agent-script-codeact-plan.md`](./file-backed-resource-agent-script-codeact-plan.md) | 待实施提案 | File-backed Resource、Agent Script、Sandbox 与 CodeAct |
| [`extension-developer-experience.md`](./extension-developer-experience.md)                   | 延期规划     | Extension SDK、Host 与开发者体验路线图                                  |
| [`extension-package-source-host-runtime-plan.md`](./extension-package-source-host-runtime-plan.md) | 延期规划     | pnpm / Package Source、Installer 与 Host Runtime 分层                    |
| [`application-runtime-modularization-plan.md`](./application-runtime-modularization-plan.md) | 延期规划     | 待真实领域边界长期稳定后渐进拆分 Runtime 包                             |
| [`search-and-timeline-indexing-plan.md`](./search-and-timeline-indexing-plan.md)             | 延期规划     | 基于 Narrative Store 合同重定 Timeline Search 索引                      |
| [`typed-primary-resource-bundle-plan.md`](./typed-primary-resource-bundle-plan.md)           | 延期规划     | Preset / Setting 主体加附件的增强导入导出 Artifact                      |
| [`product-website-documentation-demo-plan.md`](./product-website-documentation-demo-plan.md) | 讨论草案     | 官网、公开文档、下载页、共享视觉语言与轻量交互 Demo                     |
| [`prompt-resource-ordered-tree-and-caged-slot-plan.md`](./prompt-resource-ordered-tree-and-caged-slot-plan.md) | 待实施方案   | 预设有序文件树、Anchor/Slot 统一抽象与笼中深度（Caged Depth）排序        |
| [`ui/prompt-resource-diff-mode-v0.md`](./ui/prompt-resource-diff-mode-v0.md)                 | 延期规划     | PromptResource Revision 差异对比与 Tokenizer 合同                       |
| [`ui/provider-account-health-plan.md`](./ui/provider-account-health-plan.md)                 | 延期规划     | Provider Account 健康检查与连接状态探测                                 |
| [`ui/provider-model-brand-icons-plan.md`](./ui/provider-model-brand-icons-plan.md)           | 试验完成     | 正式模型品牌资产与图标合同收束                                          |
| [`log-plan/README.md`](./log-plan/README.md)                                                 | 基础已实现   | 历史日志高级过滤、实时订阅与通知系统                                    |

---

## 历史已归档计划

历史 Plan 统一位于 [`docs/archive/plans/`](../../archive/plans/)。其中包括已完成计划、被 Architecture 取代的实施稿，以及原基线已经冻结且剩余工作已拆分到当前 successor 的阶段记录。Archive 中出现的 Pending 不自动构成当前路线；当前施工只以本表为准。

本次归档（2026-08-30）：

- [`renderer-surface-and-client-host-implementation-plan.md`](../../archive/plans/renderer-surface-and-client-host-implementation-plan.md) — Phase 0—6 全部实施
- [`variable-state-system-implementation-plan.md`](../../archive/plans/variable-state-system-implementation-plan.md) — Phase 0—6 完成
- [`history-text-transform-and-rendering-plan.md`](../../archive/plans/history-text-transform-and-rendering-plan.md) — Phase 0—5 闭环
- [`ai-gateway-extension-capability-registry-plan.md`](../../archive/plans/ai-gateway-extension-capability-registry-plan.md) — M1 已实施
