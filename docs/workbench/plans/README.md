# Workbench Plans 状态索引

本页是 `docs/workbench/plans/` 的施工入口，用于跟踪当前正在推进及延期规划的路线图。
已实现或已被新架构取代的历史 Plan 均已整理归档至 [`docs/archive/plans/`](../../archive/plans/)。

---

## 活跃路线图与延期规划

| 路线图 / 计划                                                                                | 当前状态     | 关注点                                                                  |
| -------------------------------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------- |
| [`workspace-resource-and-distribution-plan.md`](./workspace-resource-and-distribution-plan.md) | In Progress / 本地文件与分发基础已实现 | Preset / Setting 附件、用户自定义来源、Git 更新、开发模式 |
| [`agent-runtime-session-and-workspace-plan.md`](./agent-runtime-session-and-workspace-plan.md) | In Progress / Agent 执行与流式基础已实现 | 统一写入结果、统计组件、Workspace Tool；跨进程恢复与插件 Handler 延后 |
| [`application-capability-cli-mcp-adapters-plan.md`](./application-capability-cli-mcp-adapters-plan.md) | 待讨论 / 未授权实施 | 承接独立 CLI/MCP；在线连接、权限、首批命令及 Capability 抽取范围待确认 |
| [`file-backed-resource-agent-script-codeact-plan.md`](./file-backed-resource-agent-script-codeact-plan.md) | 待实施提案 | File-backed Resource、Agent Script、Sandbox 与 CodeAct |
| [`extension-developer-experience.md`](./extension-developer-experience.md)                   | Roadmap / UI 方向已确认 | SDK、工具链，以及扩展页面、声明式设置和组件使用；UI 具体合同待设计 |
| [`search-and-timeline-indexing-plan.md`](./search-and-timeline-indexing-plan.md)             | Asset Search 已实现 / Timeline Search 延期 | 复用 Narrative Store 分页，后续补搜索、窗口与索引 |
| [`ui/prompt-resource-diff-mode-v0.md`](./ui/prompt-resource-diff-mode-v0.md)                 | 延期规划     | PromptResource Revision 差异对比与 Tokenizer 合同                       |
| [`ui/provider-account-health-plan.md`](./ui/provider-account-health-plan.md)                 | 延期规划     | Provider Account 健康检查与连接状态探测                                 |
| [`ui/provider-model-brand-icons-plan.md`](./ui/provider-model-brand-icons-plan.md)           | 前端 Spike 已完成 | 静态品牌资产已接入；`iconKey` 数据合同待定 |
| [`log-plan/README.md`](./log-plan/README.md)                                                 | 基础已实现   | 历史日志高级过滤、实时订阅与通知系统                                    |

---

## 历史已归档计划

2026-09-14：[`official-content-installation-and-release-plan.md`](../../archive/plans/official-content-installation-and-release-plan.md) 已完成并归档；本地官方内容、显式安装、ST 生命周期解耦、正式导出包与完整样例已交付。远程来源、在线更新与远程发布保留为延期路线。

2026-09-13：会话恢复、宏动态值、上下文文本管线、背景与材质、State 作者分离、组件预览共六份计划已归档，见[历史索引](../../archive/plans/README.md)。已实现基线不因人工视觉验收未完成而继续占用活跃入口；归档记录保留未验证项，不等同于所有验收通过。

2026-09-13：[`code-comment-policy-and-ai-maintenance-plan.md`](../../archive/plans/code-comment-policy-and-ai-maintenance-plan.md) 已完成并归档；注释规范、运行时与 Client 边界注释、Extension SDK TSDoc 及定向验证已交付。

2026-09-12：[`play-and-session-navigation-plan.md`](../../archive/plans/play-and-session-navigation-plan.md) 已完成并归档；游玩入口、最近会话与会话导航整合。

2026-09-11：[`file-backed-card-bundle-plan.md`](../../archive/plans/file-backed-card-bundle-plan.md) 已完成并归档；文件化 ZIP、PNG Base64 ZIP 与旧容器兼容已落地，后续 CLI / Dev Workspace 复用同一编解码。

2026-09-11：[`text-pipeline-loom-script-renderer-integration-plan.md`](../../archive/plans/text-pipeline-loom-script-renderer-integration-plan.md) 已归档交付基线；保留未执行验证记录，可加载的默认/开发演示数据留待后续推进。

历史 Plan 统一位于 [`docs/archive/plans/`](../../archive/plans/)。其中包括已完成计划、被 Architecture 取代的实施稿，以及原基线已经冻结且剩余工作已拆分到当前 successor 的阶段记录。Archive 中出现的 Pending 不自动构成当前路线；当前施工只以本表为准。

本次归档（2026-09-03）：

- [`prompt-resource-ordered-tree-and-caged-slot-plan.md`](../../archive/plans/prompt-resource-ordered-tree-and-caged-slot-plan.md) — 预设有序文件树与笼中深度架构（Phase 1—4 已落地归档，本地文件同步已拆分至独立 Plan）
- [`renderer-surface-and-client-host-implementation-plan.md`](../../archive/plans/renderer-surface-and-client-host-implementation-plan.md) — Phase 0—6 全部实施
- [`variable-state-system-implementation-plan.md`](../../archive/plans/variable-state-system-implementation-plan.md) — Phase 0—6 完成
- [`history-text-transform-and-rendering-plan.md`](../../archive/plans/history-text-transform-and-rendering-plan.md) — Phase 0—5 闭环
- [`ai-gateway-extension-capability-registry-plan.md`](../../archive/plans/ai-gateway-extension-capability-registry-plan.md) — M1 已实施

本次归档（2026-09-09）：

- [`application-runtime-modularization-plan.md`](../../archive/plans/application-runtime-modularization-plan.md) — Runtime facade 与领域模块边界已落地
- [`extension-data-and-portable-payload-foundation-plan.md`](../../archive/plans/extension-data-and-portable-payload-foundation-plan.md) — Phase 1—5 完成；后续 Renderer / Job / GC 保持开放
- [`state-entity-reference-v1-plan.md`](../../archive/plans/state-entity-reference-v1-plan.md) — State v1 核心完成并晋升 Architecture；独立 Artifact 与运行引用检查转入 Workbench Issue
