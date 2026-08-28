# 开发者行为手册 (Guide)

本目录记录所有关于"如何在项目中进行开发"的指导性文件。

日常开发先看本目录。`workbench/` 记录讨论、议题和历史决策，不作为当前施工规则的第一入口；当 Guide 与 workbench 历史草案冲突时，以 Guide 为准，再回到 workbench 更新对应议题。

- [`getting-started.md`](getting-started.md) — 如何启动项目、跑通第一遍
- [`workspace-development.md`](workspace-development.md) — **开发代码第一入口**：任务到 Workspace README / Architecture 的路由
- [`project-structure.md`](project-structure.md) — 核心：**项目全量文件地图与任务路由表**（AI探索必备）
- [`tech-stack.md`](tech-stack.md) — **必读**：NPM 依赖清单与技术栈选型底线
- [`design-philosophy.md`](design-philosophy.md) — **必读**：场景驱动的设计哲学
- [`design-method.md`](design-method.md) — 领域发现、场景模拟、ADR / Spec 收口与最小实现验证的方法
- [`architecture-rules.md`](architecture-rules.md) — **必读**：架构红线与包间约束
- [`code-style.md`](code-style.md) — 编码规范、命名规则
- [`testing.md`](testing.md) — 测试分类与准则
- [`code-review.md`](code-review.md) — PR 与审查边界
- [`ui-design.md`](ui-design.md) — UI 开发准则与 CSS 架构
- [`contributing.md`](contributing.md) — 贡献指南总览
- [`i18n.md`](i18n.md) — 国际化流程

---

## 🏛️ 深度架构入口

当前实现边界从 [`docs/architecture/README.md`](../architecture/README.md) 进入。各分类 README 是正式事实索引。

- **[Loom Studio 历史架构白皮书](../archive/discussion/whitepaper-v0.md)** — 保存早期愿景、术语和约束演进；它不是“终极蓝图”，也不会整体晋升。遇到冲突时以当前 Architecture 和代码为准。
