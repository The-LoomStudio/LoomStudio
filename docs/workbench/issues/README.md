# Workbench Issues 索引

这里只跟踪仍有实际后续的质量事项。已完成或基线已冻结的审查见[历史归档](../../archive/README.md)，不在本页重复修复账目。

| 当前事项 | 范围 |
| --- | --- |
| [扩展跨资源引用](extension-cross-resource-references.md) | 工具、跨包图标与现有 assetId 读取校验已补齐；仍跟踪媒体可移植引用、Lore／文本依赖诊断、跨包脚本挂载及媒体回收边界。 |
| [综合审查修复与优化](../plans/full-stack-audit-remediation-2026-10-26.md) | 审查报告已归档；15 项确认问题、1 项精简和 5 项条件优化仍待实施，状态与验收由该计划统一承接。 |
| [归档后的后续](audit-follow-ups.md) | FE-028/031 等明确残余、触及再复核的疑点、条件性能候选，以及真实环境和人工验收边界；已被新验证覆盖的旧测试失败不继续列为开放缺陷。 |
| [扩展开发热重载](extension-dev-hot-reload-enhancement.md) | 独立/外部 DevLink 构建变化的自动触发尚未统一；低优先级，具体 watcher 方案待决定。 |
| [State 资源与引用检查](state-resource-and-reference-follow-ups.md) | 独立 State Artifact 资源链与运行期只读软引用诊断，仍有能力缺口。 |

[2026-10-28 代码精简定向审计](../../archive/issues/targeted-code-simplification-2026-10-28.md)的 10 项已完成并归档，类型检查及 19 文件 193 项定向测试通过；实施结果与验证边界保留在报告末尾。

新审查参考[审查工作指南](../reference/audit-playbook.md)；它是方法参考，不是待修 Issue。

[2026-10-26 官方扩展审查](../../archive/issues/official-extensions-audit-2026-10-26.md)的 8 项问题已修复并归档，定向验证和邻近套件的 3 项宿主/fixture 失败均保留在报告中。

本轮代码精简的 [Audit](../../archive/issues/code-simplification-audit-2026-10-25.md) 与[统一实施计划](../../archive/plans/package-and-storage-consolidation-plan.md)均已归档，23 项精简及追加修复已完成；实际验证范围保留在原记录。前端持续审查、周期覆盖账目与 State 订阅实现也已归档，真实残余统一由上表承接。
