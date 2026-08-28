# LoomStudio 文档方向与生命周期复核（2026-08-28）

> **状态**：Open
>
> **仓库基线**：`main` / `7e69867978b1543e0ddea51ecc22b5cb542ab9d7` + 2026-08-28 当前未提交工作树快照
>
> **复核范围**：上一轮文档治理之后仍存在的方向、实现基线和生命周期残留；不重复登记已经修复的链接、索引和目录迁移问题
>
> **审阅方式**：子智能体按活跃 Discussion 与 Plan / Issue / Archive 分域审查，主审回到当前 Architecture、源码类型和 Workbench 索引交叉验证

## 结论

上一轮治理已经统一 Archive 根目录并补齐静态索引，但仍有两类语义问题没有关闭：部分活跃方向稿继续把迁移前的 M0 数据模型写成当前事实；部分带有真实后续事项的 Plan 已进入 Archive，却没有可从 Workbench 到达的当前 successor。

| 编号           | 级别 | 结论                                                                                    |
| -------------- | ---- | --------------------------------------------------------------------------------------- |
| DOC-FOLLOW-001 | P2   | 活跃 AIRP Discussion 仍把旧 Session / NarrativeEntry / 镜像 Transcript 模型写成当前实现 |
| DOC-FOLLOW-002 | P2   | Archive 中仍有无明确 successor 的未完成 Plan，开放事项从当前施工入口消失                |

`pnpm check:docs` 能验证路径、锚点、状态声明和索引可达性，但不能判断正文中的“当前实现”是否仍然新鲜，也不能证明归档正文中的残余事项已经被其他计划接管。

## 已确认问题

### DOC-FOLLOW-001 · P2 · 活跃 Discussion 的实现基线仍停留在旧 M0

**活跃文档证据**

- `docs/workbench/discussion/application/session-timeline-data-model-v0.md:6,269-278` 仍称当前 Document Types 保留旧 Session、NarrativeEntry role 与镜像 Transcript。
- `docs/workbench/discussion/application/runtime-turn-flow-v0.md:176-187` 仍把拆分 Agent Session、Narrative commit、Changeset 与两棵树列为未来迁移。
- `docs/workbench/discussion/application/narrative-timeline-content-schema-v0.md:263-273` 仍称当前使用 `SessionContent`、`NarrativeBranchContent.sessionId` 和 `NarrativeEntryContent`。
- `docs/workbench/discussion/application/airp-runtime-model-v0.md:204-210` 仍称旧 `submitTurn` 会在一次事务中写入 Narrative entries、镜像 Transcript、Run 与 State Snapshot。
- `docs/workbench/discussion/application/isolation-scope-boundary-v0.md:194-204` 仍称旧 Session 是当前多领域聚合点，Narrative Timeline 是否取代它尚待确认。

**当前事实反证**

- `docs/architecture/data/README.md:78-97` 明确记录旧 `Session / NarrativeEntry / submitTurn` 后端路径已删除，Client 已切换到 Narrative Timeline、Agent Profile 与按需 Agent Session 合同。
- `packages/narrative-store/src/types.ts:19-53` 已定义独立的 `NarrativeTimeline`、`NarrativeBranch` 与 roleless `NarrativeNode`。
- `packages/agent-store/src/types.ts:8-20,92-100` 已定义独立的 `AgentSession` 与 canonical `AgentTranscriptEntry`。

Client 中仍存在名为 `submitTurn` 的表单 handler，但它调用的是当前 `agentSessions.invoke` 合同；这不能证明旧 Session / NarrativeEntry / 镜像 Transcript 数据模型仍然存在。问题是文档中的实现基线陈旧，不是函数名称本身。

**方向影响**

这些文件的目标方向大体仍有效，但“当前实现差异”已经倒置。读者会把已经完成的数据层迁移重新当作待办，并基于不存在的旧聚合设计新的迁移计划。

**关闭条件**

- 上述活跃 Discussion 的当前实现章节与 `docs/architecture/data/` 及当前 Store 类型一致；
- 已经晋升的迁移内容从开放问题中移除或明确标记为已完成；
- 仍有独立价值的方向只保留真实未实现部分，完全被 Architecture 吸收的正文归档。

### DOC-FOLLOW-002 · P2 · 归档 Plan 的残余事项没有进入当前 successor

**治理合同**

- `docs/archive/README.md:5-11` 规定：原基线失效但仍有价值的开放项，归档前必须在 Workbench 建立当前 successor。
- `docs/archive/plans/README.md:3` 声明归档计划的剩余事项已经拆分到当前 successor。

**反例**

- `docs/archive/plans/agent-session-chat-message-foundation-plan.md:3-5` 只标记 `Phase 1 Complete`，没有 Archived / Superseded 状态，也没有当前 successor。
- `docs/archive/plans/agent-session-narrative-timeline-data-layer-plan.md:756-758` 仍把 Session 列表、刷新后恢复、流式、取消、工具和 Narrative commit UI 列为后续工作；文首链接的 Workbench Search Plan 不能承接这些事项。
- `docs/archive/plans/prompt-build-message-block-implementation-plan.md:3,71-90` 仍保留前端消费、旧资源迁移、Direct Preset Entry、Projection Runlist 与 provenance 等后续任务，却没有链接当前 Plan。
- `docs/workbench/plans/README.md:8-29` 的当前路线表没有覆盖上述 Agent Session UI residual 或 MessageBlock migration residual。

**反证检查**

这里不是在正文历史中机械搜索 `Pending`。这些候选在文首状态或“后续事项”章节中继续把内容定义为真实后续工作，也没有 `Superseded by` 说明，因此不能从当前治理合同推导为已关闭事项。

**方向影响**

维护者从唯一 Plans 入口看不到这些工作，但从 Archive 又能读到它们仍然待办，无法判断方向是延期、被取代还是意外丢失。后续容易重新建立平行计划，或把仍有效的收尾项永久遗忘。

**关闭条件**

- 仍有效的残余事项提炼为窄 Workbench successor，并同时从归档 Plan 顶部和 Plans 索引链接；
- 已失效或已被其他实现吸收的事项明确标记 `Archived / Superseded`，并写出当前 Architecture 或 Plan 入口；
- Archive 中不再存在无法从当前 Workbench 确认去向的真实后续工作。

## 本轮不纳入

- 已经归档并明确标记 Historical / Superseded 的正文内旧术语；它们是历史证据，不是当前方向。
- 单纯尚未实现的 Proposal；只要状态和入口准确，就不是生命周期问题。
- 已由 `docs/workbench/issues/full-repo-code-review-2026-08-27.md` 跟踪的启动指南 WebSocket 文案，不重复登记。
- `pnpm check:docs` 已覆盖的断链、孤儿、顶层 Plan 漏索引和 ADR 状态格式问题。

## 建议处理顺序

1. 先修正活跃 AIRP Discussion 的当前实现基线，避免继续产生错误迁移判断。
2. 再逐项裁决归档 Plan residual：建立 successor，或明确判定为已被取代。
3. 完成后运行 `pnpm check:docs`，并由主审再次核对正文语义；静态检查通过不能替代这一步。
