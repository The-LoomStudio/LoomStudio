# 工作台 (Workbench)

这里是项目的"白板"区，只存放仍在演进、讨论或施工中的文档。
这些文档**可能已经过时，也可能与当前主干代码存在差异**。在它们从本目录被"提炼 (Promote)"进 `architecture/` 目录前，请以实际代码实现为准。

日常修补不要求先写 Workbench 文档；非平庸改动可在对话中讨论，也可边写 `plans/` 边收束问题。Plan 必须区分已确认决策、开放问题和实施授权，不能把候选当作施工合同。ADR 只记录跨域、长期、难逆转且需要保留取舍理由的例外决策，不是默认实施门槛。

开始查阅当前工作前，先看 [`plans/README.md`](plans/README.md)。该索引只列仍有未完成工作或未决合同的计划；已交付阶段移入 Archive，避免把历史过程误认为仍在执行。

## 目录索引

- [`adr/`](adr/) — 架构决策记录；权威状态表见 [`adr/README.md`](adr/README.md)。
- `issues/` — 已知缺陷与待确认事项。
- `plans/` — 演进计划与改进路线图；统一状态入口见 [`plans/README.md`](plans/README.md)。
- [`drafts/`](drafts/README.md) — 暂不实施、未来按明确需求重新评估的构想，不属于当前施工路线。
- `reference/` — 外部参考材料（如 SillyTavern 架构总结等）。
- [`../archive/`](../archive/) — 唯一历史归档库；Workbench 内不再维护第二套 Archive。

## 状态解释

- **Architecture**：已经由当前代码验证的正式事实；
- **Active Plan / Issue**：当前仍有明确未完成工作；
- **Deferred / Roadmap**：方向保留，但不是当前施工入口；
- **Draft**：暂存构想，只有明确新需求或重新授权才会重启，不作为既定实施方向；
- **Closing**：实现已完成，但仍有明确的最小验收或收尾项；
- **Closed / Implemented**：当前工作已经完成，正文移入 `docs/archive/`；
- **Historical / Superseded**：只用于理解设计演进，不得恢复为当前合同。

不再维护独立 Discussion 目录或前置阶段。旧稿保留在 [`历史讨论归档`](../archive/discussion/README.md)，仅作设计演进依据；继续推进的事项以当前 Plan / Issue 为准，未被接续的候选不自动构成待办。
