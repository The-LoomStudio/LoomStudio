# 审查归档后的延期事项

状态：Deferred / Backlog（更新：2026-10-25）

本文只承接归档后仍需可发现的实现或验收，不重新启动历史审查。历史账目保留在原报告；本机自动化通过不等于浏览器、真实 Provider、发行或远端 CI 验收，也不产生自动跟进、计费、远程安装、推送或发布授权。

<a id="continuous-review-acceptance-2026-10-06"></a>
<a id="deferred-ci-acceptance"></a>

## 真实环境、发行与远端 CI

[持续审查](../../archive/issues/continuous-code-review-2026-10-02.md)的本机修复已收尾，F-06 与 FR-006 按用户决定延期且不急；保留以下独立验收：

- 真实 Provider 的成功、流、取消、错误与模型误差校准：先明确账户、模型、允许样本及费用上限，不自动发送用户正文。
- 真实远程 ZIP/Git 安装更新：先指定可信来源与 ref，使用临时安装根。
- 当前产物 build→prepare→smoke 与三平台发行：需要隔离产物、所需依赖及各平台结果，不以本机 macOS 构建代替。
- FR-006 远端 CI：统一提交后核对同一提交在 GitHub Actions / Ubuntu 的安装、workspace、build、lint、test:typecheck 与 test。当前未获提交、推送或远端运行授权；本地结果不替代远端结果。

<a id="archive-successor-follow-up"></a>

## 旧模型的后续归属

旧 Chat Message / Session / MessageBlock 阶段已由 Narrative、canonical Transcript、messages/editorProjection 等现行合同替代，不恢复旧 Message Store、EntryNode.source 或 Zone-only 迁移。[Agent Runtime](../../archive/plans/agent-runtime-session-and-workspace-plan.md)已由用户确认完成，资源分发按[资源计划](../plans/workspace-resource-and-distribution-plan.md)接续。

仍需实际核对 Message 预览边界与来源展示，以及多来源消息通过 fragmentIds/sourceRows 回指真实资源、正文不夹带元数据的端到端行为；已有字段不等于完成真实 UI 定位验收。

<a id="simplification-acceptance-2026-10-02"></a>
<a id="implemented-plan-acceptance-2026-10-02"></a>

## 用户 UI 与 Renderer 验收

[10 月 2 日精简](../../archive/plans/code-simplification-2026-10-02-plan.md)已收口，没有未决精简施工项。用户明确自行验收且不急，仍保留：

- 双流长列表的可见行挂载、动态高度、历史阅读不强拉滚底、向前加载位置、编辑行保活、稳定 ID 展开留存及会话切换。
- Renderer 离屏销毁、返回重建、主题更新与卸载保护；mock/SSR 不替代真实 DOM 生命周期。
- 实际浏览器退出重开、Timeline/Branch 切换、扩展重载和目录文件修改；OS IME、键盘/读屏、模态与 iframe 焦点、触摸/窄窗口、颜色和动画由实际体验验收。
- [Token 计数](../../archive/plans/token-counting-and-measurement-plan.md)的页面交互，以及[开场白 Display/HTML](../../archive/plans/card-opening-display-and-html-layout.md)在实际卡片/规则下的最终投影。第三方 ST API 和作者 iframe 循环高度不在旧交付承诺内。[扩展 Prompt/模型 API](../../archive/plans/extension-prompt-and-model-api-plan.md)的真实模型验收使用上方外部调用边界。

<a id="frontend-continuous-audit-follow-ups-2026-10-07"></a>

## 前端持续审查的剩余边界

[2026-10-07 前端审查](../../archive/issues/frontend-continuous-audit-2026-10-07.md)的 38 项均有实施与定向证据；仅承接以下剩余，不把历史修复前场景重新列为当前缺陷：

| 条目 | 当前状态与最小接续 |
| --- | --- |
| FE-028 源位置映射 | 完整 Markdown 源→DOM 映射尚未实现。当前仅接受源文与渲染文本前缀逐字符相同的坐标，其余明确拒绝；仍需可靠映射及真实 DOM 替换/清理验收，不能把前缀防错当成完整完成。 |
| FE-031 旧路径反馈 | 完整路径唯一匹配、缺失/歧义不猜测已修。仍需确定多个常驻工作台监听 `loom:navigate` 时的消费归属与统一不可定位反馈，并验收真实点击的编辑目标；稳定 ID 引用和既有裸名称语义保持。 |
| FE-035 真实恢复验收 | 正文失败降级、重连突发限制与 Fetch 错误分类已实现并有定向证据，没有待实施的已确认缺陷；真机长休眠/断网恢复和后台生命周期仍未验收。 |
| OPT-001/002 性能候选 | 历史工具数据重复转换、最近面板同日分组复制保留为条件优化。按真实 trace 和实际规模决定是否推进，保留配对、流式、顺序及输入不变，不把局部合成测量当成日常卡顿或整页收益。 |

原报告另有四个未确认疑点：窄窗尺寸、清空 Undo 的 disabled/preview 门控、同目标 State 后台刷新草稿、导航尺虚拟窗口焦点。触及对应模块时先复核真实消费者/行为，不当成已确认 Bug，也不据此自动扩大修复范围。SettingField 草稿版本已在 [2026-10-26 综合审查 FR-R06](../../archive/issues/full-stack-audit-2026-10-26.md#fr-r06) 用当前表单确认冲突后无法恢复，修复转由[综合审查实施计划](../plans/full-stack-audit-remediation-2026-10-26.md) W2 承接；本次没有修复。其他范围的语言完整性与人工体验仍不能宣称全量通过。

<a id="trpc-migration-follow-ups-2026-10-13"></a>

## 测试维护的当前状态

[tRPC 迁移](../../archive/plans/trpc-contract-migration-plan.md)已经完成；历史 missing-context-projection 手工 React 渲染器曾有运行失败，本会话没有该文件新的运行证据，触及该 fixture 时定向复核，不用类型通过替代运行通过。

以下旧失败待办在 2026-10-25 关闭，证据见[统一计划的后续验证](../../archive/plans/package-and-storage-consolidation-plan.md#8-后续测试类型与-st-兼容修复2026-10-25)：

- State/Text 的 4 个旧失败：`state-text-accessibility.test.ts` 25 项、`state-variables-panel.test.ts` 4 项通过。
- tRPC 迁移记录中的 31 条测试类型诊断：最终 `pnpm check:types` 已通过，不再作为当前开放类型债。
- 旧 Opening 集成样本失败：Prompt Resource Runtime 的 Opening 预期与 Mio 宏已修，相关 Runtime/Prompt 13 文件、158 项通过。测试在导入前将旧种子 Opening 转为当前单文本；原 `loom-city-v0.json` 的 legacy opening.entries 未改，不宣称任意旧文件迁移兼容已实现。

以上是当前定向结果，不改写原归档的历史失败，也不代表全仓全部测试已运行。

<a id="fault-isolation-browser-follow-ups-2026-10-14"></a>

## 故障隔离与性能后续

[浏览器诊断](../../archive/issues/browser-runtime-audit-2026-10-14.md)与[Prompt 故障隔离](../../archive/issues/prompt-resource-fault-isolation.md)的已确认缺陷已有修复与定向证据。仍保留：

- Host 权限错误契约统一：触及仍抛普通 Error 的 Host 路径时，统一结构化错误并验证取消/权限仍中止；现有按消息保守识别不等于任意第三方错误文本都被覆盖。
- 实际坏资源占位、诊断/警告定位、投影重试与真实生成验收，使用上方真实环境与用户 UI 验收边界。
- 头像缩略图、首次读取、整页长会话和 heap 候选：按实际卡顿/trace 再评估服务端 profiling 与优化；缓存或局部微基准不证明整页收益，也未证明不存在泄漏。

<a id="the-world-state-subscription-acceptance"></a>

## The World State 订阅验收

[State 订阅实现记录](../../archive/issues/state-subscription-for-extensions.md)已由 Server/Client 正式接口与 The World 消费承接。过滤、清理、正式写入通知和客户端重读已有定向证据；动态天色、目标切换/暂停清理的浏览器体验及真实外部模型仍随[故事级采用](../../archive/plans/extension-story-participation-plan.md)与[The World](../../archive/plans/the-world-state-and-agent-plan.md)验收接续。

Server 事件是进程内提交后提示，不承诺崩溃/重启后的历史补发；Client 重连重读快照，revision ID 保持不透明。热重载与 State 资源/引用检查继续使用各自 Backlog，不在本文重复排期。

## 2026-10-25 实施稿归档的接续边界

已交付的融合、摘要、审批恢复、Swipe、工具反馈、扩展采用与 ST 转换计划已移入[历史索引](../../archive/plans/README.md)。本次只整理文档，没有重新执行产品验收。

- 真实 Provider/进程故障、长 HTML/iframe、脚本与跨平台交互仍按本页验收边界处理；新测试通过不替代这些验收。
- 任意 Workspace 文件消费配置及其恢复交 [Workspace 后续](../plans/timeline-workspace-and-vfs-organization-plan.md)；脚本实例恢复交 [Loom Script](../plans/loom-script-distribution-and-runtime-plan.md)，不另留第三份恢复权威。
- The World 的显式 v1 升级预览 UI、完整 Background 资源集成仍未交付；它们是首版之外的后续，须明确需求再启动。官方扩展发行与安装验收交[发行后续](../plans/extension-module-completion-plan.md)，不把历史远端缺 dist 快照当作今天的远端状态。
