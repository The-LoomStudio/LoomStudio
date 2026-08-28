# LoomStudio 文档方向与生命周期审计（2026-08-28）

> **状态**：Resolved / Archived
>
> **解决日期**：2026-08-28
>
> **仓库基线**：`main` / `7e69867978b1543e0ddea51ecc22b5cb542ab9d7` + 2026-08-28 当前未提交工作树快照
>
> **审阅方式**：3 个子智能体分别审查方向与旧版本、Plan / Issue / Archive 生命周期、孤儿与索引完整性；主智能体按当前 Architecture、Workbench 状态、归档内容和静态链接结果逐条复核去重
>
> **审阅边界**：本轮关注文档是否仍代表当前方向、是否停留在旧实现、是否已完成但未退场、是否过早归档、是否失去入口；不审计公开网站页面逐句文案，也不把“尚未实现”本身视为缺陷
>
> **审计阶段边界**：首轮只建立 Issue 并更新索引；哥哥批准修复后，第二阶段更新了文档正文、目录和无依赖链接检查脚本，未修改业务源码或产品测试

## 结论摘要

当前主要问题不是 LoomStudio 缺少方向，而是**文档晋升、完成、取代与归档没有形成单一生命周期**。正式 Architecture 已经覆盖多个领域，但旧 ADR、MVP / M0 草案和实施前 Plan 仍停留在活跃入口；与此同时，部分仍有开放事项的 Issue / Plan 又被归入“已 100% 解决”的 Archive。索引和相对链接没有随目录重组同步，进一步削弱了权威入口。

本轮最终纳入 **8 个 P2、1 个 P3**：

| 编号 | 级别 | 结论 |
| --- | --- | --- |
| DOC-LIFE-001 | P2 | Workbench 对“完成后原地保留”与“完成后统一归档”给出冲突规则，并存在两套 Archive 语义 |
| DOC-LIFE-002 | P2 | ADR 状态表和关键方向仍停留在旧版本，Accepted / 主入口身份没有随 Architecture 晋升更新 |
| DOC-LIFE-003 | P2 | 已完成的 MVP 与已删除的 M0 实现仍作为活跃施工稿或“当前事实”存在 |
| DOC-LIFE-004 | P2 | Kernel、Extension、PromptBuild 已晋升，但旧规格仍在活跃 Discussion 形成双权威 |
| DOC-LIFE-005 | P2 | Plans README 不是可靠的统一施工入口，存在漏项、阶段错标和实施前旧稿未退场 |
| DOC-LIFE-006 | P2 | Archive 宣称内容已完全解决，但内部仍保存 Open Issue 与 Pending Plan |
| DOC-LIFE-007 | P2 | 文档重组后遗留大量断链，活跃文档与归档 Plan 的导航均不完整 |
| DOC-LIFE-008 | P2 | Architecture 晋升索引漏更，读者会被错误引回 Workbench |
| DOC-LIFE-009 | P3 | 少量仍标记活跃的文档失去领域索引或有效入站入口 |

## 修复结果（2026-08-28）

- 建立唯一生命周期：Workbench 只保留活跃文档，`docs/archive/` 成为唯一历史归档根；Living Design Method 移入 Guide。
- 新增 ADR 权威状态索引，ADR-001 标记 Partially Superseded，ADR-005 冻结为 Historical / Superseded。
- MVP、M0、WebSocket-only Transport、伪订阅 RPC、Manifest v1、旧 Extension Lifecycle、旧 Composition Pipeline 与相邻早期工程稿已归档。
- Plans 根索引已覆盖全部活跃顶层计划，并同步 Agent、History、Variable / State 与 Extension Data 的当前阶段；完成 Spike 和被取代的 Foundation 已归档。
- Archive 改为“冻结历史快照”语义；原 Open / Pending 文档已标记 Historical / Superseded 或 Residuals Split，并指向当前 successor。
- Architecture 根索引改为分类 README 权威制，Application 索引补入 State 与变量架构。
- Agent Tool 数据视图与 SillyTavern Reference 已恢复领域索引入口。
- 全量 Markdown 内部链接检查已从审计时的 83 个活跃断链、38 个 Archive Plan 断链收敛为 0，并新增无依赖的 `pnpm check:docs` 防回归入口。

## 已确认问题

### DOC-LIFE-001 · P2 · 生命周期规则互相冲突，并存在两套 Archive 语义

**证据位置**

- `docs/workbench/README.md:17-23`：把 `Closed / Implemented` 定义为“计划已经完成，文件原地保留实施背景”。
- `docs/workbench/plans/README.md:1-4`：又声明已实现或已被新架构取代的 Plan 均已整理到 `docs/archive/plans/`。
- `docs/README.md:53-58`：将 `docs/archive/` 定义为正式历史归档库，内容应已完全实现、关闭或被取代。
- `docs/workbench/README.md:15` 同时暴露 `docs/workbench/archive/`；其 `README.md:1-4` 位于 Archive 内却标记为 `Living Notes / Design Method`，不是历史冻结材料。

**为什么是方向 / 生命周期问题**

同一份完成文档可以被解释为“应原地保留”或“应统一归档”，维护者无法从规则判断下一步。`docs/archive/` 与 `docs/workbench/archive/` 又分别承载正式归档和仍在使用的方法论，目录名相同但状态语义不同。这是旧稿长期堆积、完成记录与施工入口混杂的系统性根因。

**最小治理动作**

只保留一套生命周期规则：活跃设计与施工留在 Workbench；已完成或被取代的正文进入 `docs/archive/`，仍有后续工作的部分提炼为窄 successor；Living Method 移回 Guide 或 Discussion。`docs/workbench/archive/` 应迁入正式 Archive，或明确改名为非归档语义的目录，不能继续作为第二个 Archive 入口。

**关闭条件**：根 README、Workbench README、Plans README 与 Archive README 对同一状态给出一致去向；仓库只剩一个具有“历史归档”语义的入口。

### DOC-LIFE-002 · P2 · ADR 状态与方向权威停留在旧版本

**证据位置**

- `docs/workbench/README.md:8-10` 仍称 ADR-003、ADR-004 为 Proposed；两份 ADR 正文的 `:1-4` 已分别标记 `Accepted / Implemented` 与 `Accepted`。
- `docs/workbench/adr/ADR-001-data-layer-workspace-sync.md:3,21-27,179-224` 仍以 Accepted 身份声明 Runtime / Provider / Tool / MCP 都是 Extension Pattern，由 Concept Stack 编译 Runtime Artifact。
- `docs/architecture/application/README.md:1-3,39-55` 已明确 Studio Application 是第一方内建 AIRP 领域层，不伪装成 ordinary Extension，并由 Application 拥有业务语义和流程。
- `docs/workbench/adr/ADR-005-official-concept-stack-open-design.md:3,19-37,156-180` 仍把已不存在的 `docs/08-concept-stack/` 当拆分目录和下一步讨论入口。
- `docs/workbench/discussion/application/README.md:13-25` 已承认 Concept Stack 是历史名称，却仍称 ADR-005 是“当前主讨论入口”。

**为什么是方向 / 生命周期问题**

ADR 是高权重决策入口。Accepted ADR-001 中仍成立的数据 / Workspace 决策与已被取代的 Runtime / Concept Stack 边界没有分离；ADR-005 同时扮演历史决策日志和当前开放设计入口。读者即使优先查 ADR，也会被带回已经被正式 Architecture 取代的方向。

**最小治理动作**

建立一个可点击的 ADR 状态索引；根 Workbench 只链接该索引，不复制状态。ADR-001 标记 `Partially Superseded` 并明确仍有效章节与 successor；ADR-005 冻结为 Historical Decision Log，当前 Application 设计由领域 README 和残余开放议题接管。

**关闭条件**：每份非 Draft ADR 都有准确状态及 `Superseded by / Partially superseded by` 关系；不存在指向已删除目录的“当前主入口”。

### DOC-LIFE-003 · P2 · 已完成 MVP 与已删除 M0 仍占据活跃事实位置

**证据位置**

- `docs/workbench/discussion/studio-mvp-development-plan.md:1-4` 仍自称“正式施工门控计划”，目标是从空仓库进入工程落地；`docs/workbench/archive/mvp-stage-notes/stage-5.md:1-11` 已记录 MVP Stage 5 `Passed`。
- `docs/workbench/discussion/loom-studio-mvp-engineering.md:1-6,43-59` 仍以 Draft 身份描述“当前 LoomStudio 是空白独立目录”。
- `docs/workbench/discussion/application/m0-backend-slice-v0.md:3-6,10-58` 仍称旧 Session、`submitTurn`、镜像 Transcript、CommitCandidate 和 AgentRuntimeProfile 是“当前已实现的 M0 事实”。
- `docs/architecture/data/README.md:76-97` 已明确旧 `Session / NarrativeEntry / submitTurn` 路径删除，当前是独立 Narrative Store 与 Agent Store。

**为什么是方向 / 生命周期问题**

这些文档不是单纯保留历史背景，而是继续使用 Draft、正式施工计划和当前实现事实等活跃措辞。MVP 已完成、M0 路径已删除后仍留在 Discussion 主体，会让维护者把历史里程碑误认成现行路线或兼容合同。

**最小治理动作**

将两份 MVP 文档与 `m0-backend-slice-v0.md` 作为历史里程碑整体归档，并在顶部指向当前 Guide / Architecture。仍有效的 Kernel guardrail 只提炼成短小的当前规则，不继续维护整份旧施工稿。

**关闭条件**：活跃 Discussion 不再把空仓库、旧 Session 或 `submitTurn` 描述为当前状态；历史文档有明确冻结日期和 successor。

### DOC-LIFE-004 · P2 · 已晋升领域仍保留相互冲突的活跃旧规格

**证据位置**

- Kernel：`docs/workbench/discussion/kernel/studio-transport-protocol-v0.md:3-4,12-42,179-220` 仍规定 WebSocket-only 与 `events.subscribe / unsubscribe`；`studio-rpc-methods-v0.md:15-36,180-229` 继续把伪订阅列为 RPC。`docs/architecture/kernel/README.md:99-112,179-187` 则明确当前没有伪订阅 RPC，Server 使用 HTTP JSON-RPC `/rpc`。
- Extension：`docs/workbench/discussion/extensions/studio-extension-manifest-architecture.md:3-8,40-55,121-129` 虽有顶部警告，正文仍完整展示 Manifest v1 与 `Full Extension = server + client`；`studio-extension-lifecycle-v0.md:3-7,26-52,96-117` 仍以旧 Server Extension 单体模型组织生命周期。`docs/architecture/extensions/README.md:1-5,15-32,51-98` 已采用 Package / Module / Instance 与 Manifest v2。
- PromptBuild：`docs/workbench/discussion/application/composition-pipeline-v0.md:3-4,20-32,34-91` 仍把 `LoadSession`、`official.concept.compose.preview` 等旧 M0 当未来候选；`docs/architecture/application/prompt-build/README.md:3-24` 已记录当前 PromptBuild、Application Pass、Loom Core 与 Agent Turn 来源链。

**为什么是方向 / 生命周期问题**

Architecture 已经成为当前事实，但前身规格仍以 Draft / Open Design 形式完整留在活跃目录。顶部追加一句“旧目标草图”不足以消除正文的规范性语气，导致同一主题存在两套可被当作实现依据的合同。

**最小治理动作**

对已经整体失效的 Transport、RPC、Manifest v1 与旧 Lifecycle 文档直接标记 Superseded 并归档；对仍含开放价值的 Prompt / Agent 文档标记 `Partially Promoted`，删除或历史化已晋升章节，只保留尚未进入 Architecture 的真实开放问题。

**关闭条件**：每个已晋升领域只有一个当前事实入口；活跃 Discussion 不再完整复制或反向描述已被 Architecture 取代的协议与模型。

### DOC-LIFE-005 · P2 · Plans README 不是可靠的统一施工入口

**证据位置**

- `docs/workbench/plans/README.md:1-4` 声明自身是当前施工入口。
- 同一索引 `:12` 写 Agent Runtime “Phase 4 完成”，而 `agent-runtime-ai-sdk-foundation-plan.md:1-6` 已记录 Phase 5 完成。
- 索引 `:16` 写 History Text “待实施”，而 `history-text-transform-and-rendering-plan.md:1-9` 已记录 Phase 0—5 基础闭环完成，仅保留增强项。
- `variable-state-system-foundation-plan.md:3-6` 仍称 State Store、Revision、RPC、Tool 与 UI 不存在；`variable-state-system-implementation-plan.md:3-7,694-705` 和 `docs/architecture/application/state-and-variables.md:1-29` 已记录 Phase 0—6、自动化验收及正式 State 合同。
- `agent-runtime-ai-sdk-phase-0-spike.md:1-4` 已明确 Phase 0 与后续 Phase 1 完成，但仍留在活跃 Plans 且未列入索引。
- `application-capability-cli-mcp-adapters-plan.md:1-6` 与 `file-backed-resource-agent-script-codeact-plan.md:1-7` 仍是待实施提案，却未列入根 Plans 状态表。

**为什么是方向 / 生命周期问题**

索引同时漏掉真实待办、错标已完成阶段，并保留明确过期的实施前事实。维护者可能错过 CLI / MCP 与 File-backed Resource 路线，却重新设计已经落地的 State Store 或把已完成的 History Pipeline 当成未开始。

**最小治理动作**

重建一个唯一 Plan 状态表：每个活跃或延期 Plan 必须可达，状态与正文头部一致。完成的 Phase 0 Spike 归档；Variable / State Foundation 标记 Superseded 并只保留真实未完成增量；Implementation Plan 在人工视觉验收完成前标记 Closing，完成后归档。

**关闭条件**：Plans 根索引覆盖全部活跃 / 延期计划；索引状态与文件头一致；已完成 Spike 和被正式 Architecture 取代的实施前计划不再占据活跃入口。

### DOC-LIFE-006 · P2 · Archive 的“已完全解决”定义与内部内容相反

**证据位置**

- `docs/archive/README.md:1-16` 声明归档内容已经完全实现、关闭或被新架构取代，Issue “已 100% 解决或澄清”。
- 归档 Issue 仍直接标记开放：`Back_package..md:1-5` 为 `Audited / Open`，`Prompt-build-issue.md:1-5` 与 `documentation-audit.md:1-5` 为 `Partially Resolved`，`architecture-governance-v0.md:1-7` 为 `Open Issues`，`refactor-chores.md:1-6` 为 `Active Backlog`。
- `frontend-audit-v0.md:1-7` 明确当前只保留尚未实施项，却也位于已解决 Archive。
- 归档 Plan 仍直接标记未完成：`provider-profile-secret-store-foundation-plan.md:1-6` 为 `In Progress`，`prompt-build-loom-core-pipeline-migration-plan.md:1-7` 为 Phase 3—4 Pending，`event-system-extension-scope-plan.md:1-7` 仍有 General Transport、Client Host、权限持久化与 durable trigger 等后续阶段。

**为什么是方向 / 生命周期问题**

真正未解决的债务从 Workbench 索引消失，而 Archive 又给出“已经关闭”的反向信号。这比单纯未归档更危险：维护者可能认为问题已被验证解决，或在找不到原待办时重新建立平行方案。

**最小治理动作**

逐篇做二选一：已经失效或被替代的内容冻结为 `Historical / Superseded` 并标 successor；仍有独立价值的开放项提炼为新的活跃 Issue / Plan，旧文档只保留已完成阶段的历史记录。不要把整篇旧计划直接搬回去继续追加新阶段。

**关闭条件**：Archive 内不再存在无 successor 的 `Open / Active / In Progress / Pending` 状态；所有仍需推进的事项都能从当前 Workbench 索引到达。

### DOC-LIFE-007 · P2 · 文档重组后遗留大量失效相对链接

**证据位置**

按 Markdown 相对链接存在性做静态检查，忽略外部 URL、页内锚点和图片后确认：

- Archive 之外共有 **83 个**失效 Markdown 链接；主要来自旧数字目录（如 `03-kernel`、`04-data`、`05-extensions`、`08-concept-stack`）、已移动 Plan、错误的 ADR 相对层级与旧 Reference 位置。
- `docs/archive/plans/` 中有 **12 个文件、38 个**失效 Markdown 链接；批量移动后仍沿用原 Workbench 相对路径。
- 代表位置：`docs/guide/contributing.md:14`、`docs/workbench/adr/ADR-001-data-layer-workspace-sync.md:6-7`、`ADR-005-official-concept-stack-open-design.md:9-13,95-133`、`ADR-006-extension-package-module-instance-model.md:7`、`docs/workbench/discussion/application/prompt/README.md:422`。
- 当前 Plan 中也有直接断链：`docs/workbench/plans/ui/prompt-resource-projection-workbench-v0.md:11` 与 `provider-account-health-plan.md:6` 仍按旧路径引用已归档 Plan。

**为什么是方向 / 生命周期问题**

断链不只是导航瑕疵。许多链接仍指向旧目录名或已经归档的计划，说明文档迁移只移动了文件，没有同步它们的状态关系和 successor。读者无法判断目标是被删除、被取代，还是仅仅换了位置。

**最小治理动作**

按“旧目录、已归档 Plan、ADR 层级、Reference”四类修复。指向归档 Plan 的链接需同时注明其历史状态和当前 successor，不能只机械改路径。修复后增加一个不引入依赖的最小 Markdown 相对链接检查。

**关闭条件**：活跃文档不存在失效内部链接；Archive 内保留的链接均可回溯；后续移动文件时链接检查能够阻止同类回归。

### DOC-LIFE-008 · P2 · Architecture 晋升索引没有跟上正式内容

**证据位置**

- `docs/architecture/README.md:35-44` 的“当前已晋升内容”只列出 Application 下的 Loom Core，并规定未列出的专题应先去 Workbench 查阅。
- `docs/architecture/application/README.md:7-15` 实际已经收录 PromptBuild、Agent、History Text、Extension 与 UI；同目录还存在正式的 `state-and-variables.md`，但该 Application 索引也没有列出。

**为什么是方向 / 生命周期问题**

即使读者遵循 Architecture-first 规则，也会因为根索引漏项而误判 Agent、History、Extension Data 与 State 仍未晋升，再次回到旧 Workbench 文档。正式事实存在，却没有成为可发现的权威入口。

**最小治理动作**

根 Architecture 不再手工复制所有专题，改为链接各分类 README；分类 README 负责完整列出本领域正式文档。删除“未列出即去 Workbench”的失真兜底，或保证晋升清单能随文件变更同步更新。

**关闭条件**：从 `docs/architecture/README.md` 可以到达所有正式 Architecture；分类索引与实际文件一致，不会把已晋升领域误导回 Workbench。

### DOC-LIFE-009 · P3 · 活跃文档存在孤儿与失效入口

**证据位置**

- `docs/workbench/discussion/application/agent/tool-data-view-interaction-v0.md:1-5` 标记为 Open Design，但未列入 `application/agent/README.md:84-95` 的文件表；全仓 Markdown 文件名检索没有其他入站引用。
- `docs/workbench/reference/sillytavern-architecture-reference.md:1-6` 仍作为参考文档存在，但未列入 `docs/workbench/reference/README.md:1-11`。
- 它唯一的活跃入口 `docs/workbench/discussion/application/prompt/README.md:422` 相对路径错误；文档自身 `:22` 仍称位于已不存在的 `docs/reference/`。

**为什么是方向 / 生命周期问题**

文档仍标记活跃或具有参考价值，却脱离领域索引，无法判断是仍需推进、已被相邻设计吸收，还是应当归档。长期看会形成无法被维护者发现、也无法自然退场的闲置文本。

**最小治理动作**

逐篇确认归属：方向仍有效就补入唯一领域索引；已被其他文档吸收就合并残余信息并归档；不再有独立价值才删除。不要仅凭“没有入链”批量处理当前脏工作区中新建的进行中文档。

**关闭条件**：每篇 Active / Open Design 文档至少有一个明确领域索引入口；Reference README 覆盖所有保留参考材料；不存在只有自身可发现的活跃文档。

## 建议治理顺序

1. 先统一生命周期与唯一 Archive 规则，确定 ADR / Discussion / Plan / Issue 的状态去向。
2. 再修正 ADR、Architecture 和 Plans 三个权威索引，建立当前路线入口。
3. 按索引逐篇处理 MVP / M0、晋升前旧规格、完成 Spike 与过早归档内容。
4. 最后修复相对链接和孤儿入口，并用最小静态检查防止再次漂移。

## 本轮明确不纳入

- 公开网站页面与当前实现的逐句错配：不属于本轮“方向与生命周期”范围。
- 仅仅尚未实现的 Proposal / Roadmap：只要状态、入口和边界准确，就不是问题。
- 当前未提交工作树中新建且仍在施工的文档：没有稳定证据前不判定为孤儿或漏归档。
- `.DS_Store` 等目录杂物：属于仓库清洁，不属于方向治理。
- Accepted ADR 留在 `workbench/adr/`：ADR 可以长期保留；问题只在状态、取代关系与链接是否准确。
