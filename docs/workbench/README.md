# 工作台 (Workbench)

这里是项目的"白板"区。所有还在演进、讨论中的文档，以及各类历史记录均存放于此。
这些文档**可能已经过时，也可能与当前主干代码存在差异**。在它们从本目录被"提炼 (Promote)"进 `architecture/` 目录前，请以实际代码实现为准。

开始查阅当前工作前，先看 [`plans/README.md`](plans/README.md)。该索引区分当前施工、延期路线、已实现计划和历史方案，避免把 Workbench 中保留的设计过程误认为仍在执行。

## 目录索引

- `adr/` — 架构决策记录 (Architecture Decision Records)。当前 Accepted：ADR-001、ADR-006；Proposed：ADR-003、ADR-004；ADR-002 已被取代，ADR-005 仍是开放设计。
- `discussion/` — 各个子模块的设计讨论、开放问题、初期设计草案。大量历史的 application/ 层的设计文件存放在此。
- `issues/` — 已知缺陷与待确认事项。
- `plans/` — 演进计划与改进路线图；统一状态入口见 [`plans/README.md`](plans/README.md)。
- `reference/` — 外部参考材料（如 SillyTavern 架构总结等）。
- `archive/` — 归档的文档，包括早期的 MVP 施工笔记，仅供回溯。

## 状态解释

- **Architecture**：已经由当前代码验证的正式事实；
- **Active Plan / Issue**：当前仍有明确未完成工作；
- **Deferred / Roadmap**：方向保留，但不是当前施工入口；
- **Closed / Implemented**：计划已经完成，文件原地保留实施背景；
- **Historical / Superseded**：只用于理解设计演进，不得恢复为当前合同。

Discussion 中关于 Kernel、Extension、Local Data、UI Shell 和 Logging 的部分设计已经晋升到 `docs/architecture/`。这些 Discussion 继续保留历史价值，但遇到冲突时以 Architecture 和代码为准。
