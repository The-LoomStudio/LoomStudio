# Documentation Workflow and ADR Refresh Plan

> **状态**：Completed / Archived
> **日期**：2026-09-09

## 目标

- 让文档流程匹配当前以小规模修补为主、重大改动讨论后直接进入 Plan 的开发节奏；
- 将 ADR 收窄为长期、跨域、难逆转且需要保留取舍理由的决策记录；
- 修复已确认的导航、索引、状态漂移和文档检查盲点；
- 逐份校准现有 ADR 与当前 Architecture 和实现的关系。

## 已确认事实与决策

- Guide、Architecture、Discussion、Plan、Issue、ADR、Archive 继续保留各自职责，不重组目录；
- 普通修补不要求 Discussion、Plan 或 ADR；非平庸改动在决策明确后进入 Plan；
- ADR 不是默认实施门槛，只记录单靠 Architecture 无法解释的长期取舍；
- ADR-001、003、004、006 保留并更新，ADR-002、005 保留为被取代的历史决策；
- 当前没有已闭合且需要新增 ADR 的候选，不新增 ADR-007。

## 非目标

- 不修改业务源码、产品行为或当前状态/变量功能设计；
- 不对全部 Discussion、Plan、Issue 正文做语义审计；
- 不新增依赖或复杂文档生成系统。

## 工作包

1. 更新 Guide、Workbench 导航、当前孤儿入口和技术栈事实；修正文档检查，使链接与生命周期问题可以一次完整报告，并覆盖嵌套 Plan 的索引可达性。
2. 更新 ADR 状态索引和 ADR-001—006 的当前权威入口、状态及过时实现描述，不改写历史决策本身。

## 完成与验证

- `pnpm check:docs` 能完整运行并通过；
- ADR 正文状态与 ADR 索引一致；
- 活跃 Workbench 文档均能从 README 索引到达；
- 人工复核 Diff，确认没有改动当前业务文档的既有未提交内容。

## 最终结果

- Guide 已改为日常修补直接实施、非平庸改动经讨论后进入 Plan，ADR 只作为例外决策记录；
- Workbench 补齐孤儿 Issue、顶层 Plan 与嵌套 Plan 的索引入口；
- ADR-001—006 已按当前 Architecture 和实现校准，当前没有新增 ADR 的成熟候选；
- 文档检查会同时执行链接与生命周期检查，生命周期检查覆盖嵌套 Plan；
- 验证结果：`pnpm check:docs` PASS，任务范围内 `git diff --check` PASS。

## 停止条件

若修复需要改变现行架构、公共契约、新增依赖或判断正在施工文档的产品方向，停止并重新确认。
