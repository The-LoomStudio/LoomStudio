# Workbench Plans 状态索引

本页是 `docs/workbench/plans/` 的施工入口，用于跟踪当前正在推进及延期规划的路线图。
已实现或已被新架构取代的历史 Plan 均已整理归档至 [`docs/archive/plans/`](../../archive/plans/)。

---

## 活跃路线图与延期规划

| 路线图 / 计划                                                                                | 当前状态     | 关注点                                                                  |
| -------------------------------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------- |
| [`session-recovery-and-history-transfer-plan.md`](./session-recovery-and-history-transfer-plan.md) | In Progress / WP1 | 会话恢复、选择与默认上下文；历史移植合同和保真范围待收口 |
| [`data-directory-resource-development-plan.md`](./data-directory-resource-development-plan.md) | In Progress / 数据与文件层 | 角色目录闭环待交互验收，其他资源文件包待接续；开发模式与 CLI/MCP 已移出 |
| [`official-content-installation-and-release-plan.md`](./official-content-installation-and-release-plan.md) | In Progress / 本地安装切片完成 | 官方文件、显式安装与 ST 生命周期解耦已落地；完整样例与远程发布待接续 |
| [`macro-value-provider-and-inspector-plan.md`](./macro-value-provider-and-inspector-plan.md) | In Progress | 作者宏 Master–Detail、动态提供者、冲突选择与构建快照已实现，自动化验证通过，等待人工验收 |
| [`history-text-pipeline-contextual-ui-and-effective-rules-plan.md`](./history-text-pipeline-contextual-ui-and-effective-rules-plan.md) | Implemented / 待视觉验收 | Effective RuleSet、资源作者视图与当前上下文文本管线检查器；后续 Loom Script 已接续 |
| [`ui/state-authoring-runtime-separation-plan.md`](./ui/state-authoring-runtime-separation-plan.md) | Paused | 有效范围转交宏计划统一验收；不恢复 Preset State 与 Workspace 作者 CRUD |
| [`agent-runtime-ai-sdk-foundation-plan.md`](./agent-runtime-ai-sdk-foundation-plan.md)       | Phase 5 部分完成 | AI SDK Gateway、canonical Tool、三类 Transport、Agent Loop；Responses Custom 与跨进程 Resume 待接续 |
| [`ai-gateway-streaming-execution-plan.md`](./ai-gateway-streaming-execution-plan.md)         | 后端基础完成 | AI Gateway 流式执行；RPC / Client 消费延期                              |
| [`agent-session-context-and-workspace-capability-plan.md`](./agent-session-context-and-workspace-capability-plan.md) | Approved / 待实施 | Agent Session Context、PromptBuild Target、Workspace Tool / CodeAct Capability |
| [`application-capability-cli-mcp-adapters-plan.md`](./application-capability-cli-mcp-adapters-plan.md) | 待讨论 / 未授权实施 | 承接独立 CLI/MCP；在线连接、权限、首批命令及 Capability 抽取范围待确认 |
| [`file-backed-resource-agent-script-codeact-plan.md`](./file-backed-resource-agent-script-codeact-plan.md) | 待实施提案 | File-backed Resource、Agent Script、Sandbox 与 CodeAct |
| [`extension-developer-experience.md`](./extension-developer-experience.md)                   | Roadmap / UI 方向已确认 | SDK、工具链，以及扩展页面、声明式设置和组件使用；UI 具体合同待设计 |
| [`ui/background-and-panel-materials-plan.md`](./ui/background-and-panel-materials-plan.md) | 方向已批准 / 实施前收口 | 官方背景与毛玻璃材质共同交付，含来源恢复、采样与人工验收 |
| [`extension-package-source-host-runtime-plan.md`](./extension-package-source-host-runtime-plan.md) | 延期规划     | pnpm / Package Source、Installer 与 Host Runtime 分层                    |
| [`search-and-timeline-indexing-plan.md`](./search-and-timeline-indexing-plan.md)             | Asset Search 已实现 / Timeline Search 延期 | 复用 Narrative Store 分页，后续补搜索、窗口与索引 |
| [`typed-primary-resource-bundle-plan.md`](./typed-primary-resource-bundle-plan.md)           | 延期规划     | Preset / Setting 主体加附件的增强导入导出 Artifact                      |
| [`product-website-documentation-demo-plan.md`](./product-website-documentation-demo-plan.md) | Astro 站点已建立 / 部署待接续 | 独立官网与文档工程已有实现，后续发布和 Demo 在网站仓库推进 |
| [`workspace-dev-sync-plan.md`](./workspace-dev-sync-plan.md)                                 | 待讨论 / 未授权实施 | 承接完整开发模式；复用已有目录和 Apply，编辑源、草稿、权限与同步工作流待确认 |
| [`st-data-compatibility-and-anchor-system-plan.md`](./st-data-compatibility-and-anchor-system-plan.md) | 导入与标准锚点基础已实现 | 剩余兼容范围待核对，安装与发布转交官方内容计划 |
| [`ui/prompt-resource-diff-mode-v0.md`](./ui/prompt-resource-diff-mode-v0.md)                 | 延期规划     | PromptResource Revision 差异对比与 Tokenizer 合同                       |
| [`ui/component-preview-workbench-plan.md`](./ui/component-preview-workbench-plan.md) | 入口与样例已实现 / 待收口 | 开发专用组件预览、内存样例与定稿组件交接 |
| [`ui/provider-account-health-plan.md`](./ui/provider-account-health-plan.md)                 | 延期规划     | Provider Account 健康检查与连接状态探测                                 |
| [`ui/provider-model-brand-icons-plan.md`](./ui/provider-model-brand-icons-plan.md)           | 前端 Spike 已完成 | 静态品牌资产已接入；`iconKey` 数据合同待定 |
| [`log-plan/README.md`](./log-plan/README.md)                                                 | 基础已实现   | 历史日志高级过滤、实时订阅与通知系统                                    |
| [`code-comment-policy-and-ai-maintenance-plan.md`](./code-comment-policy-and-ai-maintenance-plan.md) | Ready for execution | 面向 AI 维护的英文决策注释、边界合同与公共 SDK TSDoc                   |

---

## 历史已归档计划

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
