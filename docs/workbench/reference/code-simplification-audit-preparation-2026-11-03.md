# 大规模精简审查：准备认识与建议流程

状态：方法参考；正式审查及五项实施见[归档报告](../../archive/issues/code-simplification-audit-2026-11-03.md)，后续[未发布兼容清理](../../archive/issues/pre-release-compatibility-audit-2026-11-03.md)十组也已实施，实库与服务恢复验证见该报告。
日期：2026-11-03。

本轮仅了解项目、Git、历史审查与当前入口，形成后续审查地图。未逐文件审查，未确认新的代码缺陷或删除项。用户要求先从宏观到微观研究精简，区分前后端，之后再做确定逻辑的专项审查；不包含业务代码修改授权。

## 1. 基线与范围

- 本地分支 `main`，HEAD `12534ce6128eddee5f932835d3cc5309f3f7afff`，提交主题为 `Refine resource authoring and runtime workflows`。
- 调研开始时，Git porcelain 记录 170 个修改项、3 个删除项、30 个未跟踪项。它们是既有工作，不属于本轮；此数量只是当时快照。
- 本地 `origin/main` 指向 `d2a1837e`，本地 HEAD 相对该引用领先 4 个提交。本轮未 fetch，不能据此断言远端服务器的最新状态。
- 后续审查应同时记录 HEAD、涉及文件的工作区状态与读取时点。并发变化使具体证据失效时，只重查受影响部分；不要求清空或提交现有工作区。
- 主仓范围包括 Client、Server、领域与平台 packages，以及相关测试/工程入口。`extensions/st-data-compat`、`extensions/the-world` 被主仓忽略，涉及独立扩展实现时需要单独记录其 Git 基线，不能把主仓历史当作扩展历史。

## 2. 项目职责地图

| 侧别 | 主要所有者 | 审查时应分清的职责 |
| --- | --- | --- |
| 前端装配与交互 | `apps/studio-client` | App/Pages 装配、Widgets 组合、Features 领域命令与状态、Entities DTO、Shared 宿主适配 |
| 通用 UI | `packages/loom-ui` | 领域无关原语、菜单/焦点机制与设计变量；不承担领域流程 |
| 后端入口 | `apps/studio-server` | 进程组装、认证、HTTP/tRPC/SSE、服务端宿主适配 |
| 领域流程 | `packages/application-runtime` | Card、Timeline、Session/Run、Prompt、State、资源与工具流程 |
| 领域持久化 | `packages/application-data` | 各领域数据、版本和 Head；共享事务由 `data-engine` 提供 |
| 平台与扩展 | Kernel、SDK、Host、Gateway、各 Store | 动态能力、生命周期、模型接入与各自持久化边界 |

后端范围不能只划到 Server。跨端合同由主审统筹，但合同仍留在实际 owning source，不因为跨端就统一搬进 shared。总体入口见[系统组成](../../architecture/system-overview.md)、[目录职责](../../guide/project-structure.md)。

本轮用三条代表链验证地图，不代表覆盖这些领域的所有行为：

1. **Card 创建**：CharacterPanel → App registry → `useCards.createCard` → StudioApi → RPC；返回对象更新本地列表与选择，再刷新列表。入口见 [use-cards.ts](../../../apps/studio-client/src/features/cards/model/use-cards.ts)、[studio-api.ts](../../../apps/studio-client/src/shared/api/studio-api.ts)。
2. **Preset/Lore 编辑**：Workbench → Feature 草稿 → scope 内串行提交与 `expectedVersion` → 返回资源同步 Query 与草稿视图。远端快照和未提交编辑有不同职责，不能仅因多份数据就删除。入口见 [use-context-assets.ts](../../../apps/studio-client/src/features/prompt-resources/model/use-context-assets.ts)、[use-prompt-resource-workspace.ts](../../../apps/studio-client/src/features/prompt-resources/model/use-prompt-resource-workspace.ts)。
3. **State 写入**：认证 HTTP → typed procedure → Runtime → 同一事务内 revision/Head → COMMIT → 返回 snapshot/changeset 与提交后通知。形状校验、权限、版本冲突和幂等具有不同含义。入口见 [states.ts](../../../apps/studio-server/src/rpc/trpc/application/states.ts)、[state.ts](../../../packages/application-runtime/src/state/state.ts)、[State Store](../../../packages/application-data/src/state/store.ts)、[Data Engine](../../../packages/data-engine/src/sqlite.ts)。

前端尚未全量迁入 Query；Card 本地状态、Query 远端缓存、编辑草稿、布局偏好和流式状态需要分别判断。静态 tRPC procedure 与动态扩展网关也不是可以直接合并的两份 API。

## 3. 历史审查如何接续

现有方法入口是[系统审计流程](../../guide/audit-workflow.md)、[前端专项](../../guide/audit-frontend.md)、[后端专项](../../guide/audit-backend.md)和[审查工作指南](audit-playbook.md)，无需另建一套平行规范。

| 历史阶段 | 记录的结果 | 本轮应如何使用 |
| --- | --- | --- |
| 10-02 精简 | 最终原计划记录 27 项实施、5 项保留；一次 UI 抽取因净收益不足撤回 | 保留或撤回也可以是正确结论；不以抽象数量衡量成果 |
| 10-25 架构精简 | Provider Query、Artifact 窄入口、旧路径退役、共用 Session Run Hook 等已交付 | 避免把已退役路径和已移出范围的方案重新列为待办 |
| 10-25 包/存储精简 | 23 项及追加修复已归档 | 作为去重和理解演进的依据，不当作当前源码证明 |
| 10-26 综合审查 | 活跃 Plan 仍登记 15 项问题、1 项精简、5 项条件优化 | 下一轮触及时核对当前源码，不能直接复制成新发现 |
| 10-28 定向精简 | 重复校验、无收益 helper、无必要 try/catch 等 10 项已完成 | 模式扫描不能冒充完整逻辑审查，也不宜原样重复报项 |

来源：[10-02 最终计划](../../archive/plans/code-simplification-2026-10-02-plan.md)、[架构精简交付](../../archive/plans/architecture-code-reduction-plan.md)、[10-25 报告](../../archive/issues/code-simplification-audit-2026-10-25.md)、[10-26 活跃计划](../plans/full-stack-audit-remediation-2026-10-26.md)、[10-28 报告](../../archive/issues/targeted-code-simplification-2026-10-28.md)、[残余事项](../issues/audit-follow-ups.md)。Git `6440e4e6` 可核对部分架构精简交付，但不证明当前实现未继续变化。

阅读时发现两处文档口径差异，本轮不顺手修改：Archive 总索引仍写 10-02 为 28/4，应采用原计划最终复核的 27/5；旧 code-review 的 Client 测试措辞比现行审计流程更机械，执行时依本次用户指令按实际风险选验证。

## 4. 建议审查顺序

“先精简”指先寻找能够减少职责、状态和路径的机会。证明行为等价需要必要的逻辑核对；不能先删除，再留待专项审查判断事务、取消或恢复是否损坏。

| 层次 | 主要问题 | 应形成的结果 |
| --- | --- | --- |
| 1. 宏观职责 | 哪个模块拥有事实、命令、恢复和消费？是否存在双重权威或退役职责？ | 前后端所有权与跨端交接地图 |
| 2. 完整逻辑链 | 同一能力是否有多套入口、编排、转换和回写？哪些可由既有实现接管？ | 有生产者、消费者和反证的链路候选 |
| 3. 状态与生命周期 | 缓存、草稿、投影、持久数据是否职责重叠？写入和失效由谁负责？ | 可保留/合并/删除的状态依据 |
| 4. 模块与文件分类 | 装配、领域命令、纯转换、展示、宿主基础设施是否归属明确？ | 减少跨层往返与重复实现的建议；不为目录整齐机械搬文件 |
| 5. 微观实现 | 重复解析、包装、校验、分支和依赖是否还有实际消费者或边界责任？ | 可证明等价且有净收益的最小精简项 |
| 6. 后续逻辑专项 | 对确定链核对失败、并发、取消、重试、回滚、权限与持久化 | 独立的行为审查结果 |

每个候选至少说明：现有调用链、重复责任、拟删除部分、接管者、为何行为等价、会减少什么维护成本及未确定事项。文件长、结构相似、catch 多、静态工具命中本身都不是发现。

报告分为“确认缺陷、可证明精简、待核实候选、需产品/架构决定”。精简与缺陷分别衡量，不用 Bug 严重性奖励风格偏好；没有发现也是有效结果。

## 5. 前后端分工与代理成本

前端后续按 App/命令装配、资源缓存与草稿、Narrative/Session 展示、通用 UI/样式四个责任面分批。后端按传输合同、领域编排、持久化、扩展/Script 生命周期分批。它们是覆盖地图，不要求同时派出八个代理。

主 Agent 负责跨端交接、历史去重、根因合并、架构判断与交付；子代理负责边界清晰的证据核查。每轮只派当前需要的独立问题，不让多个代理分别全仓扫描，也不重新完整阅读已可靠交付的范围。

本轮三项研究错误使用了继承主 Agent 配置的 explorer，用户指出了模型与思考强度造成的成本。后续资料扫描、摘要、定向核对使用 `luna_operator`；已确定合同的独立实现使用 `sol_implementer`；复杂语义或架构判断由主 Agent 承担。升级代理配置必须有具体困难依据，不能把全部研究默认交给高成本配置。

## 6. 验证与文档落点

本轮仅静态阅读与本地 Git 查询；未运行业务测试、构建、浏览器、真实 Provider、远端安装或性能探针。无法据此断言全仓架构合规、旧问题仍存在、代码可删除或真实运行正确。

- Knip 可定位未使用候选，但必须核对动态入口和消费者。
- 类型、构建、定向测试各验证对应风险，不能替代语义审查。
- `check:workspace` 会执行 lockfile install 与包构建，不是只读架构扫描，不能随手作为调研命令运行。
- 本轮运行 `pnpm check:docs`，整体未通过：扩展 `.runtime` 内有 8 个断链，既有 Lore 排序计划缺索引产生 3 项错误，既有附件/打断归档计划缺生命周期状态产生 1 项错误。检查未报告本轮新增文档或索引的问题；未修改这些无关文件。此检查只验证文档链接和生命周期。

正式审查发现进入 `docs/workbench/issues/` 并更新索引；确定的实施工作包再进入 `docs/workbench/plans/`。完成或基线冻结后归档，真正残余留在活跃入口。本准备记录供下一轮选路，不代替正式报告；被正式报告承接后应收口归档，避免形成长期重复台账。
