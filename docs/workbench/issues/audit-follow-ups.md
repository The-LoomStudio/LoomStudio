# 审查归档后的延期事项

状态：Deferred / Backlog（更新：2026-11-04）

本文只承接归档后仍需可发现的实现或验收，不重新启动历史审查。历史账目保留在原报告；本机自动化通过不等于浏览器、真实 Provider、发行或远端 CI 验收，也不产生自动跟进、计费、远程安装、推送或发布授权。

<a id="c-package-follow-ups-2026-11-04"></a>

## C 包后续：已完成修复之外的边界

[C 包审查](../../archive/issues/narrative-scroll-iframe-audit-2026-11-04.md)的 C-01～08、CS-01、首批隐藏展示精简，以及[元数据消费者与扩展摘要/详情专项](../../archive/issues/resource-catalog-payload-audit-2026-11-04.md) M-01～05 已完成并按用户要求归档。以下明确保留为未实施候选或待验证项，不重新打开已完成缺陷：

- **头像缩略图：未实施。** 用户明确仅处理用户头像、角色头像；扩展/预设图标由作者准备，本轮不自动生成。原图及角色 PNG 内嵌数据/导出来源保留；缩略图生成时机、尺寸、已有头像补齐与资产绑定需另行实现，不每次进页面重新生成。
- **宏预览启动就绪：已实施（2026-11-04）。** 首次用户资料/资源Query结算后再inspect，保留后续真实失效与手动刷新，失败结算不永久卡住；相关三文件16项及Client类型通过。见[候选与后续收敛](../../archive/plans/frontend-cdp-remediation-2026-11-04.md#候选与归档后续收敛2026-11-04)，不再列待施工；启动请求收益未做新的生产计时。
- **版本化扩展文件缓存：未实施。** no-store 背景/脚本的重传已有证据，但要区分可变开发来源与不可变版本，不能统一改 immutable。
- **进一步缩小数据：待设计。** 共享完整 PromptResource 列表仍服务正文树搜索、命中摘要、编辑与锚点；角色资源目录也有真实详情/Token消费者。不得为了 headers 破坏这些功能。服务器摘要仍读取现有 producer/文件，内部 IO 和解析成本是否值得优化需另测。
- **Worker 与整进程内存：待测。** 空闲回收的实际收益/重建成本、native/GPU/已提交页归因尚未完成；不把主线程堆改善换算成整个进程收益。
- **CU-02/03：待复现。** iframe 异步尺寸改变后的阅读位置、真实流式生成期间编辑焦点与自动跟随争抢，尚未证实新增缺陷。CU-01 已采用“同故事切换面板保留当前阅读位置”，不新增逐 History entry 像素恢复。
- **人工验收：** 草稿切面板返回、保存反馈、移动端手势/键盘焦点、真实生成结束后回到底部。元数据专项未开展全部扩展种类与私有包的真实浏览器矩阵；私有安装边界和非空色板有定向测试，不能替代所有实际包验收。

18122/18121为原审查时对照入口，不能作为当前运行状态。2026-11-04后续修复已使用18011 Vite HMR，18121核实时无监听；没有为对照创建新业务数据目录。原报告中另一任务重启导致的401/revision 404/502不列为本批回归或通过证据。

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

旧 Chat Message / Session / MessageBlock 阶段已由 Narrative、canonical Transcript、messages/editorProjection 等现行合同替代，不恢复旧 Message Store、EntryNode.source 或 Zone-only 迁移。[Agent Runtime](../../archive/plans/agent-runtime-session-and-workspace-plan.md)已由用户确认完成，资源分发按[资源计划](../plans/resource-download-and-update-plan.md)接续。

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

原报告另有四个未确认疑点：窄窗尺寸、清空 Undo 的 disabled/preview 门控、同目标 State 后台刷新草稿、导航尺虚拟窗口焦点。触及对应模块时先复核真实消费者/行为，不当成已确认 Bug，也不据此自动扩大修复范围。SettingField 草稿版本已在 [2026-10-26 综合审查 FR-R06](../../archive/issues/full-stack-audit-2026-10-26.md#fr-r06) 用当前表单确认冲突后无法恢复，现已由[综合审查实施计划W2](../plans/full-stack-audit-remediation-2026-10-26.md#w2-实施结果2026-11-04)与FR-R01安装身份隔离一并修复，20项定向验证及Client类型通过；真实体验延期。其他范围的语言完整性与人工体验仍不能宣称全量通过。

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

<a id="backend-responsibility-improvements"></a>

## 前后端职责审查的两项改进

来源：[已归档审查](../../archive/issues/frontend-backend-responsibility-audit-2026-11-03.md)。九项确认问题已修复；D-01仍为待设计增强，D-02已由后续Extension实施完成并归档。

- **D-01 正文投递恢复**：保持“输入先落盘、随后投递”和不自动续跑模型。后续考虑让后端记录已保存输入的投递身份与状态，页面重开可见并允许显式重试；不把整个 Run/Provider/工具副作用塞进单个数据库事务。完成标准是刷新后可识别未投递输入、显式重试不重复正文且不自动调用模型。
- **D-02 扩展包批量启停（已实现）**：后端受理后串行执行，页面退出不截断批次，保留逐模块权限校验与部分成功结果；页面重开可查询当前进程保留的结果。不承诺外部副作用全量回滚或跨重启续跑/历史。证据见[Extension流程实施](../../archive/plans/extension-flow-remediation-2026-11-04.md)。

原报告的两条既有 ScriptManagementPanel 测试断言失败与浏览器/真实 Provider 未验收限制继续保留，不以归档替代验收。

提交、并发与恢复一轮已完成，范围保留为[历史方法参考](../reference/backend-audit-next-scope-2026-11-04.md)；当前按[端到端生命周期准备](../../archive/plans/end-to-end-lifecycle-audit-preparation-2026-11-04.md)开展新审计。

2026-11-04：[后端可靠性九项](../../archive/issues/backend-failure-concurrency-lifecycle-audit-2026-11-04.md)已修复归档；真实Provider/浏览器/硬中断验收未补做，归档时的两个其他前端测试类型错误及既有扩展激活断言保留在报告，不将旧失败自动认定为当前缺陷。旧综合计划其余项目仍由原入口承接。

<a id="card-markdown-bundle-import"></a>

Card Markdown 导入已修复归档，见[结果与验证边界](../../archive/issues/card-markdown-bundle-import-2026-11-04.md)。保留此锚点用于历史链接。

<a id="public-controls-acceptance-2026-11-04"></a>

## 公共控件修复后的验收边界

[公共控件 CDP 审计](../../archive/issues/public-controls-cdp-audit-2026-11-04.md)五项已修复并由用户确认归档；当前源码浏览器定向复查与类型通过，不再作为活跃缺陷重复登记。

- 原18121旧生产快照目前已无监听，当前使用18011 HMR；实际读屏/移动触摸、真实下载与安装busy、父子同时卸载及菜单取消滑动高亮后的体验未全量验收，按用户决定延期。
- D-U01 保留为待核实：焦点留在 Composer 时，Escape 不关闭仅悬停打开的上下文信息；移出鼠标可关闭，未证明输入受阻。若触及 tooltip/信息浮层合同再核对，不提前当作确定 Bug。
- 本轮持续审计已停止并归档，历史方法与结果见[持续审计](../../archive/issues/frontend-cdp-investigation-2026-11-04.md)。


## 2026-11-04 后续小项收敛

已从本清单挑选宏预览初始就绪，与持续CDP报告PERF-05/06一并实施；原9项Narrative fixture前置失败也已修正，两文件11项通过。完整范围与46项定向验证见[实施结果](../../archive/plans/frontend-cdp-remediation-2026-11-04.md#候选与归档后续收敛2026-11-04)。这些结果只更新本次触及条目，不自动关闭其他历史失败或全仓验收。

随后用户授权的FR-R06设置恢复与FR-R01安装target隔离已由[综合计划W2](../plans/full-stack-audit-remediation-2026-10-26.md#w2-实施结果2026-11-04)完成，不再列待施工。头像缩略图/版本化文件缓存、FE-028完整源映射、FE-031导航消费归属、D-01正文投递恢复继续保留；它们不是本次宏/Query/桥容量精简的遗漏文件。用户确认DATA-01是旧契约目录数据、不要求兼容；本轮未转换数据，不再把它当当前代码writer错误。真实现场审计与验收延期，不自动发模型/远程安装/费用或重启生产。


## W2 设置恢复与安装身份收口（2026-11-04）

FR-R01/FR-R06已完成：设置Form和两个实际入口带明确安装target，非法scope不可提交；失败保留草稿并暂停自动保存，显式采用服务端值/重新应用，支持重读失败、二次冲突及异步身份切换。真实DOM与SQLite共20项、Client类型通过，见[实施结果](../plans/full-stack-audit-remediation-2026-10-26.md#w2-实施结果2026-11-04)。未改业务数据、后端存储/权限语义或其他W包；异常目录数据不动，真实环境审计/体验继续延期。


<a id="frontend-audits-archive-2026-11-04"></a>

## 前端A/B与持续CDP归档接续（2026-11-04）

用户确认将[Shell A包](../../archive/issues/shell-navigation-layout-audit-2026-11-03.md)、[资源工作台B包](../../archive/issues/resource-workbench-draft-feedback-audit-2026-11-04.md)、[持续CDP报告](../../archive/issues/frontend-cdp-investigation-2026-11-04.md)归档。已确认修复与证据冻结，归档不启动新审计或代表真实环境全量通过。

- A包延期体验：非首卡预览后浏览他卡再返回/刷新；慢激活时切故事/开工具；删除含游玩数据的当前角色；未固定Dock首次点击；移动抽屉跨断点、Escape与真实触摸。11项问题、5项精简及U-01/03/04已收口，不重复列为待修。
- B包延期体验：配置打开时外部更新后的采用/重新应用、工具保存中继续输入、关键词丢弃后再聚焦、空Lore范围、慢树操作时切节点/范围、真实系统IME。B/BS与BU-01已修；FR-R05删除后草稿撤销仍交[综合计划W4](../plans/full-stack-audit-remediation-2026-10-26.md)，FE-031导航消费归属沿本页原项承接。
- 持续CDP修复以[实施计划](../../archive/plans/frontend-cdp-remediation-2026-11-04.md)为权威，三批及PERF-05/06、宏初始就绪和原9项fixture阻塞均已收敛；FR-R01/06另由综合计划W2完成。DATA-01用户说明为旧契约目录，暂不转换、不要求兼容，不记作当前writer缺陷。
- 未开展的现场边界：生产浏览器、真实模型、物理断网/长休眠、真实大历史/大导入、成功弹窗握手与关闭、图片/附件释放、iframe子目标及长流规模。这些均按用户决定延期；已有本地测试不替代它们。
- 条件候选：单scope旧尺寸key、Inspector派生引用、整文件预处理/流式重算、排序/范围扫描等仍缺真实消费者或规模证据，不转为默认施工。头像、版本化缓存、完整源映射、FE-031及D-01等继续由本页各原入口承接，避免新建平行账目。

本次只整理文档、搬移报告和修复引用，不修改业务代码或数据，不补跑产品验收。


## 本机检查收尾（2026-11-04）

归档后暴露的8条运行快照断链误扫、5条文档生命周期诊断、8项lint错误及测试fixture/合同问题已收敛。最终默认473文件3280项、独立扩展12文件64项全部通过，生产/测试类型、扩展类型、lint、workspace与文档检查通过。具体分类及长集成用例时限证据见[本机收尾记录](../../archive/issues/local-quality-closeout-2026-11-04.md)。这更新本次本机失败状态，不关闭其他产品后续，也不替代延期的真实环境验收；异常目录数据未修改。

<a id="cdp-deep-audit-follow-ups-2026-11-04"></a>

## CDP 深度专审归档后的边界

[专审报告](../../archive/issues/frontend-cdp-deep-audit-2026-11-04.md)的状态隐藏轮询PANEL-01、隐藏脚本消费者重复目录传输PANEL-02已修复，56项定向测试、Client类型、文档检查及开发页Network复验通过，按用户要求移出活动Issue。以下不重新打开已修问题，也不自动启动下一轮审查：

- **启动主线程：待测候选。** 生产空库trace显示启动RPC后仍有主线程/样式工作，但最内层业务归因、录制开销和同规模对照不足，未确认新的性能缺陷。MessageContent静态/动态导入提示同样不能单独构成修复项。
- **生产与真实写入验收：未覆盖。** 两项修复尚未在重建生产服务下复验；未执行实际脚本保存/删除、扩展安装或真实Provider调用。开发页请求减少不能换算为生产时延收益。
- **人工验收：** 带草稿切换Panel返回后的选择与内容保留、脚本/正则页切换，以及移动端手势。历史具体会话/分页与其他未取证Panel没有全覆盖承诺。
