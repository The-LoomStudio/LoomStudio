# 工作台 (Workbench)

这里是项目的"白板"区，只存放仍在演进、讨论或施工中的文档。
这些文档**可能已经过时，也可能与当前主干代码存在差异**。在它们从本目录被"提炼 (Promote)"进 `architecture/` 目录前，请以实际代码实现为准。

开始查阅当前工作前，先看 [`plans/README.md`](plans/README.md)。该索引区分当前施工、延期路线、已实现计划和历史方案，避免把 Workbench 中保留的设计过程误认为仍在执行。

## 目录索引

- [`adr/`](adr/) — 架构决策记录；权威状态表见 [`adr/README.md`](adr/README.md)。
- `discussion/` — 各个子模块的设计讨论、开放问题、初期设计草案。大量历史的 application/ 层的设计文件存放在此。
- `issues/` — 已知缺陷与待确认事项。
- `plans/` — 演进计划与改进路线图；统一状态入口见 [`plans/README.md`](plans/README.md)。
- `reference/` — 外部参考材料（如 SillyTavern 架构总结等）。
- [`../archive/`](../archive/) — 唯一历史归档库；Workbench 内不再维护第二套 Archive。

## 状态解释

- **Architecture**：已经由当前代码验证的正式事实；
- **Active Plan / Issue**：当前仍有明确未完成工作；
- **Deferred / Roadmap**：方向保留，但不是当前施工入口；
- **Closing**：实现已完成，但仍有明确的最小验收或收尾项；
- **Closed / Implemented**：当前工作已经完成，正文移入 `docs/archive/`；
- **Historical / Superseded**：只用于理解设计演进，不得恢复为当前合同。

Discussion 中已经被 Architecture 完整取代的正文应归档；只保留仍有独立开放问题的 Discussion，并在顶部标注已晋升部分与当前 Architecture 入口。
