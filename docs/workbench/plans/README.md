# Workbench Plans 状态索引

本页是 `docs/workbench/plans/` 的施工入口，用于跟踪当前正在推进及延期规划的路线图。
已实现或已被新架构取代的历史 Plan 均已整理归档至 [`docs/archive/plans/`](../../archive/plans/)。
暂不实施、未来按需求重新评估的构想放在 [`Draft`](../drafts/README.md)，不作为当前路线图。

---

## 活跃路线图与延期规划

| 路线图 / 计划                                                                                | 当前状态     | 关注点                                                                  |
| -------------------------------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------- |
| [工具参数生成反馈与恢复](./tool-input-streaming-plan.md) | 第一批已实现 / 待人工验收 | 临时工具条目、正式记录接替、过期游标恢复 |
| [扩展任务生命周期与剧情通知](./extension-task-lifecycle-plan.md) | 已实现 / 定向验证通过 | 临时任务结果领取与重启清理、进度游标和结构化结果、提交后剧情失效通知 |
| [新叙事扩展选择与当前故事面板](./new-story-extension-selection-plan.md) | 已实现 / 待人工体验验收 | 新故事一次选择、事务内采用和初始化，统一控件与当前角色上下文 |
| [Agent 通用触发与主写作常驻配置](./agent-trigger-and-standing-resource-bindings-plan.md) | 方向已确认 / 待收束实施合同 | 通用 Session 投递、后端主写作与首次初始化、常驻引用和扩展来源可用性；绑定冲突与迁移待决定 |
| [Timeline 基础设施实施](./timeline-foundation-implementation-plan.md) | 文件/恢复/楼号基础已实现 / 定向验证通过 | Workspace、共同恢复、稳定楼号；Session 总结接续，剧情扩展问题延期 |
| [Session 总结实施](./session-summary-implementation-plan.md) | 后端与交互已接通 / 视觉待验收 | 会话摘要、策略配置、统一记忆入口与 Workspace 文件工作台；剧情总结延期 |
| [Timeline 工作空间与 VFS 组织](./timeline-workspace-and-vfs-organization-plan.md) | 文件与恢复基础已实现 | Timeline 共享 MEMORY 与 Session 自有摘要分开；工作材料、路径及树版本合同待收束 |
| [Timeline 稳定楼号基建](../../archive/plans/narrative-memory-and-refresh-policy-plan.md#10-稳定楼号总结计数与旧原文清理2026-10-20-补充确认) | 已实现 / 定向验证通过 | 与 Workspace 同层；持久位置编号、缺号/分支/Swipe 语义及受控楼号引用，不依赖官方记忆扩展 |
| [Timeline 运行数据共同恢复合同](./timeline-runtime-recovery-contract-plan.md) | 基础恢复已接线 / Session 接续待实施 | 正文、State、Workspace 一致恢复；历史时点、执行来源及记忆/脚本准备边界，不重开已确认 Swipe 规则 |
| [Loom Script 单文件分发与运行](./loom-script-distribution-and-runtime-plan.md) | 实施中 / 现有宿主链路已接通 | 管理、授权、局部刷新、重复导入与包内导出已实现；原生 Worker 已实现并通过浏览器功能诊断，Workspace 文件执行尚未接通 |
| [Settings → Lore 全量命名切换](./settings-to-lore-plan.md) | 源码已实施 / 文件数据迁移待停服 | 全量领域改名、官方扩展同步；数据库已升级，文件型测试卡副本已验证；State 不变 |
| [审查归档后续](../issues/audit-follow-ups.md) | Deferred / Backlog | 远端 CI、旧计划接续及精简后的用户 UI 验收/独立测试维护；完整修复账目已移出活跃目录 |
| [扩展模块补全](./extension-module-completion-plan.md) | 待调研 / 未实施 | 远程安装与独立官方扩展发行接续；来源、构建脚本与权限合同待决定 |
| [扩展的故事级采用与运行隔离](./extension-story-participation-plan.md) | 首版实现完成 / 待人工验收 | Prompt/恢复凭据、通用事务守卫、间接资源过滤与来源诊断已接通；Package 总开关与跨声明迁移未纳入首版 |
| [The World 世界状态与 AI 接入](./the-world-state-and-agent-plan.md) | 首版实现完成 / 待人工与发行验收 | 原生 EC、可信工具、Client 与来源诊断已接通，确定性 Provider/真实 Server 工具链通过；外部模型、公网安装与人工界面尚未验收 |
| [The World 空值初始化](./the-world-null-initialization-plan.md) | 已实施 / 待新故事验收 | 新故事 null 字段结构、首次输入填值与未知状态显示；变量系统投影另议 |
| [`st-migration-and-mvu-state-repair-plan.md`](./st-migration-and-mvu-state-repair-plan.md) | 已实施 / 待人工验收 | ST 转换与宿主导入通路、迁移诊断及 MVU 扁平绑定与旧历史兼容 |
| [`agent-preset-resources-and-usage-plan.md`](./agent-preset-resources-and-usage-plan.md) | 阶段实施完成 / 待人工验收 | 使用配置与空引用、固定 Session、主接收方与临时编辑；官方助手资源实验通过，未做真实模型或浏览器验收 |
| [`ui/README.md`](./ui/README.md) | UI 计划子索引 | Shell 动画、资源 Diff 与 Provider 展示等实施及延期入口 |
| [`opening-swipes-and-runtime-swipe-plan.md`](./opening-swipes-and-runtime-swipe-plan.md) | 多开场已实施 / 人工验收待办；运行时未实施 | 多开场初始化、ST 备选开场兼容；最新 Narrative Swipe 与 Session 工作历史隔离 |
| [`workspace-resource-and-distribution-plan.md`](./workspace-resource-and-distribution-plan.md) | In Progress / 本地分发已实现，资源包改造转独立计划 | 用户自定义来源、Git 更新、开发模式；单资源附件旧方向已被替代 |
| [`codeact-vfs-usability-plan.md`](./codeact-vfs-usability-plan.md) | 已实现 / 待真实模型体验 | State 结构化读写、类型保护、回执、目录与提示词 |
| [`agent-send-and-sdk-boundary-repair-plan.md`](./agent-send-and-sdk-boundary-repair-plan.md) | 已实现 / 待真实 Provider 验收 | 发送幂等、无进展停止、无效工具纠正与原生 reasoning |
| [`agent-approval-recovery-plan.md`](./agent-approval-recovery-plan.md) | 已实现 / 待真实 Session 验收 | 审批恢复、分范围策略、冷放弃及取消状态一致性 |
| [`agent-runtime-session-and-workspace-plan.md`](./agent-runtime-session-and-workspace-plan.md) | In Progress / Agent 执行与流式基础已实现 | 统一写入结果、统计组件与 CodeAct 接入；工具细节归独立计划 |
| [`codeact-vfs-tooling-plan.md`](./codeact-vfs-tooling-plan.md) | In Progress / 双通道与领域 VFS 读取已接入 | 实时源节点、State 子树、脚本 Blob、路径身份与版本；写入、Pin、Narrative 与通用资产待接续 |
| [`agent-context-skeleton-and-memory-projection-plan.md`](./agent-context-skeleton-and-memory-projection-plan.md) | In Progress / 骨架已接线，生命周期未验收 | 投影、统一刷新与 Session 生命周期；摘要策略已拆至独立记忆 Plan |
| [`application-capability-cli-mcp-adapters-plan.md`](./application-capability-cli-mcp-adapters-plan.md) | 待讨论 / 未授权实施 | 承接独立 CLI/MCP；在线连接、权限、首批命令及 Capability 抽取范围待确认 |
| [持久 Agent Script / Script Mount 历史候选](../../archive/plans/file-backed-resource-agent-script-codeact-plan.md) | 历史候选 / 新讨论已独立立项 | Script 当前方向见上方单文件分发与运行计划；CodeAct 以独立计划为准，不自动恢复旧稿范围 |
| [`extension-developer-experience.md`](./extension-developer-experience.md)                   | Roadmap / UI 方向已确认 | SDK、工具链，以及扩展页面、声明式设置和组件使用；UI 具体合同待设计 |
| [`search-and-timeline-indexing-plan.md`](./search-and-timeline-indexing-plan.md)             | 局部 Asset Search 已实现 / 独立 Timeline Search 延期 | 旧局部搜索背景与 Timeline 搜索候选；不属于全局资源搜索的实施或扩容范围 |
| [`ui/prompt-resource-diff-mode-v0.md`](./ui/prompt-resource-diff-mode-v0.md)                 | 延期规划     | PromptResource Revision 差异对比与 Tokenizer 合同                       |
| [`ui/provider-account-health-plan.md`](./ui/provider-account-health-plan.md)                 | 延期规划     | Provider Account 健康检查与连接状态探测                                 |
| [`ui/provider-model-brand-icons-plan.md`](./ui/provider-model-brand-icons-plan.md)           | 前端 Spike 已完成 | 静态品牌资产已接入；`iconKey` 数据合同待定 |
| [`log-plan/README.md`](./log-plan/README.md) | 后续路线 / 部分待设计 | 日志中枢与平台实施记录已归档；专业 Inspector、实时交付等仍是独立后续 |

---

## 历史已归档计划

2026-10-24：[模型日志：Prompt Build 与 Agent Run](../../archive/plans/prompt-run-observability-plan.md)及[技术设计](../../archive/plans/prompt-run-observability-design.md)按用户确认归档；本轮基线已可用，剩余 UI 细节随反馈迭代，实际验证范围与未覆盖项保留在归档结论。

2026-10-21：[剧情记忆与统一刷新策略](../../archive/plans/narrative-memory-and-refresh-policy-plan.md)按用户确认归档；总结保存已由用户实测，后续质量与交互随游玩反馈迭代。旧原文清理与完整长程验收边界保留在归档结论。

2026-10-18：[Node 24 原生能力简化](../../archive/plans/node24-native-modernization-plan.md)已完成并经用户确认归档；原生入口、模块目录、正则转义、Promise 句柄、冒烟自动清理与 macOS/Linux 发布启动缓存已接入。Windows 自动缓存保留为后续可选优化，不阻塞交付；平台验证范围见原记录。

2026-10-14：[Timeline 与 Agent Session 命名及辨识信息](../../archive/plans/ui/timeline-session-identification-plan.md)已完成并归档；Studio 创建时生成简短名称，四处列表复用来源 metadata，保留人工视觉验收边界。

2026-10-13：[全局资源搜索与范围 Token](../../archive/plans/global-resource-search-plan.md)已实现并经用户确认归档；当前合同见 [全局资源搜索 Architecture](../../architecture/application/global-resource-search.md)，覆盖范围浏览、全文检索、持久化与定位高亮，保留真实大库性能验证边界。

2026-10-13：[主应用 tRPC 契约迁移](../../archive/plans/trpc-contract-migration-plan.md)已实施并按用户要求归档；205 条 procedure 接管旧网络接口，保留测试失败与未验收边界，见[后续清单](../issues/audit-follow-ups.md#trpc-migration-follow-ups-2026-10-13)。

2026-10-12：[重要入口职责与类型契约收束](../../archive/plans/entrypoint-contract-refactor-2026-10-12.md)已完成：目录 Apply 字段修复、Preset 单一快照、局部就绪与核心恢复门槛、导入收尾、Agent Run 服务/工具协议、PromptBuild 与类型断言边界。25 文件 / 244 测试及源码类型构建通过；测试类型 43 条均为 HEAD 既有诊断，人工界面验收未执行。

2026-10-12：[核心模块职责边界收束](../../archive/plans/responsibility-boundary-refactor-2026-10-12.md)首批六包已完成并归档：Sessions/Character 业务模型、Server/CLI 与应用适配、Agent 工具能力、Text Transform 检查状态、Narrative 目录与 Run 观察已分离。定向验证及主应用类型构建通过；原版同样失败的 Character SSR 用例、44 条测试类型诊断及既有 lint/文档问题保留，未做浏览器验收。

2026-10-09：[测试套件真实度与编译基线对齐](../../archive/plans/test-suite-and-compiler-baseline-remediation-plan.md)已完成并归档。Linux 源码构建与 Preset 重命名问题已修复；tsconfig 基线与 lib 统一升级对齐至 ES2024；本地 check:types 与 check:all 类型检查门禁已建立；轻量 happy-dom 与零外部依赖 renderHook 基建已落地并通过真实单测验证；剩余历史测试的假 Mock 清理按规范列入日常渐进维护，未假称全仓旧测试全部重写。

2026-10-07：[AI 开发文档导航优化](../../archive/plans/documentation-navigation-2026-10-07.md)已完成。需求词路由、Client / Runtime 文件与验证入口、RPC / 类型导航及已核实的架构摘要已更新；9 个定位样本、18 个注册类型和 25 个 RPC 示例静态核对通过，不代表全仓架构或产品验收。

2026-10-07：[退出 Discussion 文档流程](../../archive/plans/discussion-retirement-plan.md)已完成。64 份旧稿冻结归档，讨论改为对话或 Plan 内收束；文档检查无新增问题，既有 5 个断链与 4 个生命周期问题保留。

2026-10-06：[测试结构与可靠性改进](../../archive/plans/test-suite-maintenance-2026-10-05.md)已完成并归档。分类、重复夹具、过时合同与测试类型迁移收口；主应用 311 文件 / 2059 用例、测试类型检查及浏览器恢复探针 9 项通过，历史波动与未验收边界保留。

2026-10-02 活跃目录清理：[扩展 Prompt/模型 API](../../archive/plans/extension-prompt-and-model-api-plan.md)、[Token 计数与测量](../../archive/plans/token-counting-and-measurement-plan.md)、[开场白 Display/HTML 修补](../../archive/plans/card-opening-display-and-html-layout.md)已实际移入归档。已交付基线不继续占用施工入口；真实模型、IME、页面/卡片交互与视觉验收保留在[独立后续清单](../issues/audit-follow-ups.md#implemented-plan-acceptance-2026-10-02)，未冒称通过。

2026-10-02：[代码精简实施计划](../../archive/plans/code-simplification-2026-10-02-plan.md)及三份 Issue 已实际归档：28 项精简完成、4 项明确保留，数据侧补测 3 文件/31 用例通过。无未决精简施工项；UI 验收由用户实施，4 个未改路径上的测试失败保留在[活跃后续清单](../issues/audit-follow-ups.md#simplification-acceptance-2026-10-02)，未宣称通过。

2026-10-02：[四份审查修复记录](../../archive/plans/audit-remediation-2026-10-02-plan.md)与[专题审查计划](../../archive/plans/specialized-audits-2026-10-02-plan.md)已完成并归档；OCT、API、内存预算及 17 个 UI 复用实例的本轮修复已收口，定向证据及未验收边界保留。

2026-10-02：[单 Node.js 发布与玩家安装计划](../../archive/plans/node-release-and-player-installation-plan.md) 已归档。Beta 主程序切片已交付，远程扩展安装转入《扩展模块补全》；未验证的平台、凭据与远端发布边界保留。

2026-09-29：[资源包与 Agent 预设底层计划](../../archive/plans/resource-packages-and-agent-presets-backend-plan.md)、[资源工作台与 Agent 预设 UI](../../archive/plans/ui/resource-workbench-and-agent-presets-plan.md) 已按用户确认归档。本轮主干已交付；历史兼容边界、后续 UI/性能优化及未执行验收保留在原记录，不继续列为整套重构的活跃任务。

2026-09-24：已实际移动[审查修复实施记录](../../archive/plans/audit-issue-remediation-plan.md)、[工作区导航](../../archive/plans/studio-navigation-and-workspace.md)和[事件日志中枢](../../archive/plans/log-plan/operational-log-experience-plan.md)，不再保留在活跃目录。人工观感限制保留于原记录；延期CI及旧计划后续由上方短清单承接，不假称全部远期能力完成。

2026-09-24：[`native-message-html-plan.md`](../../archive/plans/ui/native-message-html-plan.md) 已实施并归档；消息 HTML 渲染、共享 iframe 基建、实例更新与通知授权桥已交付，定向测试、类型检查、打包和客观浏览器证据见原 Plan。归档不代表剩余人工验收或 ST 生态兼容已完成。

2026-09-15：[`ui-primitives-and-panel-reuse-plan.md`](../../archive/plans/ui/ui-primitives-and-panel-reuse-plan.md) 已完成并归档；通用组件归属、真实消费者迁移与视觉返修完成，用户确认返修后的界面可接受；Extension 公共合同继续归 Extension DX。

2026-09-15：[`testing-gate-and-pipeline-resilience-plan.md`](../../archive/plans/testing-gate-and-pipeline-resilience-plan.md) 已完成并归档；测试通道分级隔离（fast/server/real/stress）、卡片慢速 crc32 硬件加速修复（提速 360 倍）、AIRP 与卡片往返全链路业务实线、SQLite 50 并发事务与千节点提示词 DFS 编译硬性压测门线、fast-check 属性不变量覆盖已全部交付；全仓 172 个测试文件 25 秒稳定通过。

2026-09-14：[`core-dependencies-performance-and-state-plan.md`](../../archive/plans/core-dependencies-performance-and-state-plan.md) 已完成并归档；Panel 分包、Prompt Resource Query 状态、资源树属性测试、Shared Lore Mount Schema、Knip 与体积基线已交付。Pretext 与 `proxy-memoize` 因缺少真实收益证据未引入；浏览器 Profiler 与切换手感仍保留为未验收项。

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

本次归档（2026-09-22）：

- [`log-platform-consumption-plan.md`](../../archive/plans/log-platform-consumption-plan.md) — 历史 JSONL 搜索、扩展统一日志接入、一键查看、诊断复制与实体 URI 已交付；原生诊断助手 P6 延后为独立后续方向
