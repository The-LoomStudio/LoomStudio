# LoomProject 文档归档说明

本目录保存 Loom Core、Stdlib、DevTool 与早期 Studio PoC 的原始设计文档，避免外部 LoomProject 从当前工作区移除后丢失决策语境。

## 来源

```text
source repository: /Users/macbookair/Desktop/LoomProject
source path:       docs/
source commit:     25b0c5b8d26517a1dfff7fa0fb06a8e003131861
archived at:       2026-07-13
markdown files:    24
```

归档内容位于 [`docs/`](docs/)，保持原始目录结构和文件内容。macOS `.DS_Store` 未复制。

## 权威性

这些文件记录了完整的设计演进，但不是 Loom Studio 当前实现的直接契约。阅读时按以下优先级判断：

```text
当前代码与测试
  > docs/architecture 中的正式说明
  > Accepted ADR / Core v0.1 Engineering Blueprint
  > Architecture / Foundation 设计稿
  > Sealed PoC 与历史草案
```

其中 Promise/Thunk Content、Core Scope、Resolve Barrier、异步 Pass、snapshot-first 默认值和 Core capability validation 已被后续 ADR 与当前实现推翻，只能作为历史设计阅读。

当前正式说明从以下位置进入：

- [`../../../architecture/application/prompt-build/loom-core/`](../../../architecture/application/prompt-build/loom-core/)
- [`../../../architecture/kernel/`](../../../architecture/kernel/)

## 原文结构

- [`docs/01-foundation/`](docs/01-foundation/) — 白皮书、Scope 与 loom-st Charter；
- [`docs/02-architecture/`](docs/02-architecture/) — Observability、DevTool 与历史架构答复；
- [`docs/03-poc-archive/`](docs/03-poc-archive/) — Core / Studio PoC 计划与回顾；
- [`docs/04-next-steps/`](docs/04-next-steps/) — Accepted ADR、Engineering Blueprint 与回归测试种子；
- [`docs/README.md`](docs/README.md) — 原文档索引。

## 完整性验证

归档时使用以下方式确认源目录与副本一致：

```bash
diff -qr --exclude='.DS_Store' \
  /Users/macbookair/Desktop/LoomProject/docs \
  docs/workbench/archive/loom-project/docs
```

该命令在归档时无差异输出。外部 LoomProject 未被修改或删除。
