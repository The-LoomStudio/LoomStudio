# 开发者行为手册 (Guide)

本目录记录所有关于"如何在项目中进行开发"的指导性文件。

日常开发先看本目录。`workbench/` 记录讨论、议题和历史决策，不作为当前施工规则的第一入口；当 Guide 与 workbench 历史草案冲突时，以 Guide 为准，再回到 workbench 更新对应议题。

- [`getting-started.md`](getting-started.md) — 如何启动项目、跑通第一遍
- [`project-structure.md`](project-structure.md) — 核心：**项目全量文件地图与任务路由表**（AI探索必备）
- [`tech-stack.md`](tech-stack.md) — **必读**：NPM 依赖清单与技术栈选型底线
- [`design-philosophy.md`](design-philosophy.md) — **必读**：场景驱动的设计哲学
- [`architecture-rules.md`](architecture-rules.md) — **必读**：架构红线与包间约束
- [`code-style.md`](code-style.md) — 编码规范、命名规则
- [`testing.md`](testing.md) — 测试分类与准则
- [`code-review.md`](code-review.md) — PR 与审查边界
- [`ui-design.md`](ui-design.md) — UI 开发准则与 CSS 架构
- [`contributing.md`](contributing.md) — 贡献指南总览
- [`i18n.md`](i18n.md) — 国际化流程

---

## 🏛️ 深度架构必读

如果你希望深入理解整个 Loom Studio 平台的宏大愿景、全盘架构与底层心智模型，请务必阅读我们最核心的白皮书：

- **[Loom Studio 架构白皮书 (Whitepaper)](../workbench/discussion/whitepaper-v0.md)** — 高达 1400 行的全盘设计图，阐述了 AIRP 分层、Document Store 机制以及 Extension 插件体系的终极蓝图。由于它包含了宏大的演进规划与讨论，目前暂时安放在 `workbench/discussion` 目录下，等待各模块彻底稳定后将升格入驻正式的 `architecture/` 专区。
