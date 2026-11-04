# 开发者行为手册 (Guide)

本目录记录所有关于"如何在项目中进行开发"的指导性文件。

日常开发先从 [Workspace 开发入口](workspace-development.md)按需求词选路，不需要先通读本目录。`workbench/` 保存当前 Plan、Issue、ADR 与参考材料；它不替代当前源码和正式行为合同。

- [`getting-started.md`](getting-started.md) — 如何启动项目、跑通第一遍
- [`beta-release.md`](beta-release.md) — Beta 下载、便捷启动、发行产物与支持边界
- [`workspace-development.md`](workspace-development.md) — **开发代码第一入口**：任务到 Workspace README / Architecture 的路由
- [`project-structure.md`](project-structure.md) — 仓库目录、Package 职责与局部 README；不是递归全量文件清单
- [`tech-stack.md`](tech-stack.md) — 涉及依赖或技术选型时查阅
- [`design-philosophy.md`](design-philosophy.md) — 涉及新设计判断时查阅
- [`design-method.md`](design-method.md) — 领域发现、场景模拟、ADR / Spec 收口与最小实现验证的方法
- [`architecture-rules.md`](architecture-rules.md) — 涉及模块边界与包依赖时查阅
- [`code-style.md`](code-style.md) — 编码规范、命名规则
- [`runtime-diagnostics.md`](runtime-diagnostics.md) — 运行异常取证：日志、浏览器与只读数据库的使用顺序
- [`testing.md`](testing.md) — 测试分类与准则
- [`code-review.md`](code-review.md) — PR 与审查边界
- [`audit-workflow.md`](audit-workflow.md) — 系统审计的可选阅读入口：流程、证据和精简/修复顺序；按需进入[前端专项](audit-frontend.md)与[后端专项](audit-backend.md)
- [`frontend-cdp-diagnostics.md`](frontend-cdp-diagnostics.md) — CDP / Console 实战：接入、短探针、React / Query / Worker、Network、误判反证与清理；随审计更新
- [`ui-design.md`](ui-design.md) — UI 开发准则与 CSS 架构
- [`contributing.md`](contributing.md) — 贡献指南总览
- [`i18n.md`](i18n.md) — 国际化流程

---

## 🏛️ 深度架构入口

当前实现边界从 [`docs/architecture/README.md`](../architecture/README.md) 进入。各分类 README 是正式事实索引。

- **[Loom Studio 历史架构白皮书](../archive/discussion/whitepaper-v0.md)** — 保存早期愿景、术语和约束演进；它不是“终极蓝图”，也不会整体晋升。遇到冲突时以当前 Architecture 和代码为准。
