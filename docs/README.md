# Loom Studio 文档体系

为了保证文档不仅对于人类开发者清晰易读，也对 AI 辅助开发极其友好，Loom Studio 采用 **"Stable & Workbench (正式发布与草稿台)" 双轨制** 文档架构。

我们废弃了早期的数字编号分类法，现在整个文档库按以下四类内容组织。Reference 尚未整体晋升，目前物理存放在 Workbench 中。

## 1. 📘 Guide: 开发者行为规范
**入口: [`guide/README.md`](guide/README.md)**

这里是新加入的开发者（或 AI）的第一站。它告诉你在这里"应该怎么干活"。
- [`guide/getting-started.md`](guide/getting-started.md) — 如何启动项目、跑通第一遍
- [`guide/project-structure.md`](guide/project-structure.md) — 核心：**项目全量文件地图**（AI探索必备）
- [`guide/code-style.md`](guide/code-style.md) — 编码规范、命名规则
- [`guide/testing.md`](guide/testing.md) — 测试分类与准则
- [`guide/code-review.md`](guide/code-review.md) — PR 与审查边界
- [`guide/ui-design.md`](guide/ui-design.md) — UI 开发准则与 CSS 架构

## 2. 📖 Reference: 快速参考字典
**当前入口: [`workbench/reference/README.md`](workbench/reference/README.md)**

不需要通读，直接按需搜索的速查手册。开发中最常被查阅的参考内容。

Reference 当前仍位于 Workbench，尚未整体晋升为正式文档；如与实现冲突，以当前代码和 Architecture 为准。

- [`workbench/reference/rpc-methods.md`](workbench/reference/rpc-methods.md) — 全量 RPC 调用速查表
- [`workbench/reference/document-types.md`](workbench/reference/document-types.md) — 全量 Document schema 速查表
- [`workbench/reference/core-types.md`](workbench/reference/core-types.md) — TypeScript 核心类型与概念速查
- [`workbench/reference/dependency-graph.md`](workbench/reference/dependency-graph.md) — 工作区 Package 依赖关系图

## 3. 📐 Architecture: 正式架构说明书
**入口: [`architecture/README.md`](architecture/README.md)**

只有经过完全实现、代码完全跑通且设计非常稳定的模块，才配记录在这里。这里的描述**必须与当前主干代码严丝合缝**。

正式架构按现有 Workbench Discussion 的领域分类组织：

- [`architecture/kernel/`](architecture/kernel/) — Kernel、RPC、事件与平台服务组装；
- [`architecture/data/`](architecture/data/) — Document、Revision、Changeset 与持久化边界；
- [`architecture/extensions/`](architecture/extensions/) — Extension Host、Manifest、生命周期与 SDK；
- [`architecture/platform/`](architecture/platform/) — 跨 Application / Extension 的共享平台能力；
- [`architecture/application/`](architecture/application/) — 第一方 AIRP Application；
- [`architecture/ui/`](architecture/ui/) — Studio Shell 与领域无关 UI 原语。

当前已经晋升的专题包括 [Studio Kernel](architecture/kernel/README.md) 与 [PromptBuild 中的 Loom Core 执行底座](architecture/application/prompt-build/loom-core/README.md)。其他设计仍以 Workbench 和当前代码为准。

## 4. 🔧 Workbench: 演进工作台
**入口: [`workbench/README.md`](workbench/README.md)**

这里是项目的"白板"。它允许混乱、允许未定稿。
所有处于讨论期的设计稿、遗留的白皮书巨型文档、ADR 记录、已知问题列表均存放在此。
**在这些文档定稿之前，请不要将它们作为当前代码开发的绝对真理。**

---
> 如果你要开始进行开发，请优先阅读 [`guide/project-structure.md`](guide/project-structure.md) 建立全局视野。
