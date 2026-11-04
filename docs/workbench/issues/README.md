# Workbench Issues 索引

这里只跟踪仍有实际后续的质量事项。已完成或基线已冻结的审查见[历史归档](../../archive/README.md)，不在本页重复修复账目。

| 当前事项 | 范围 |
| --- | --- |
| [C 包归档后的后续](audit-follow-ups.md#c-package-follow-ups-2026-11-04) | 已确认修复及元数据专项均已归档；仅保留用户/角色头像缩略图、缓存/共享目录等候选（宏初始就绪已完成）、CU-02/03 与人工验收，不把候选记为已实现。 |
| [综合审查修复与优化](../plans/full-stack-audit-remediation-2026-10-26.md) | 审查报告已归档；本批BR-01/02、BP-02/04已完成，其余修复/精简/条件优化状态由该计划统一承接。 |
| [归档后的后续](audit-follow-ups.md) | FE-028/031 等明确残余、触及再复核的疑点、条件性能候选，以及真实环境和人工验收边界；已被新验证覆盖的旧测试失败不继续列为开放缺陷。 |
| [扩展开发热重载](extension-dev-hot-reload-enhancement.md) | 独立/外部 DevLink 构建变化的自动触发尚未统一；低优先级，具体 watcher 方案待决定。 |
| [State 资源与引用检查](state-resource-and-reference-follow-ups.md) | 独立 State Artifact 资源链与运行期只读软引用诊断，仍有能力缺口。 |

[2026-11-03 精简审查](../../archive/issues/code-simplification-audit-2026-11-03.md)的五项已实施并归档；生产类型检查与定向用例通过，测试类型检查的既有问题及真实环境限制见实施记录。

[未发布兼容清理 K01–K10](../../archive/issues/pre-release-compatibility-audit-2026-11-03.md)已实施并归档；现库保留、备份与一次性整理、服务恢复和只读 RPC 已验证。旧测试失败及真实环境边界见收口记录。

[2026-10-28 代码精简定向审计](../../archive/issues/targeted-code-simplification-2026-10-28.md)的 10 项已完成并归档，类型检查及 19 文件 193 项定向测试通过；实施结果与验证边界保留在报告末尾。

新审查参考[审查工作指南](../reference/audit-playbook.md)；它是方法参考，不是待修 Issue。

[2026-10-26 官方扩展审查](../../archive/issues/official-extensions-audit-2026-10-26.md)的 8 项问题已修复并归档，定向验证和邻近套件的 3 项宿主/fixture 失败均保留在报告中。

本轮代码精简的 [Audit](../../archive/issues/code-simplification-audit-2026-10-25.md) 与[统一实施计划](../../archive/plans/package-and-storage-consolidation-plan.md)均已归档，23 项精简及追加修复已完成；实际验证范围保留在原记录。前端持续审查、周期覆盖账目与 State 订阅实现也已归档，真实残余统一由上表承接。

[前后端职责与 API 九项修复](../../archive/issues/frontend-backend-responsibility-audit-2026-11-03.md)已归档；D-01/02 由[后续清单](audit-follow-ups.md#backend-responsibility-improvements)承接。

[后端模块与命名七项整理](../../archive/issues/backend-module-structure-audit-2026-11-04.md)已实施归档；两个条件拆分评估后暂不实施，发现的Card Markdown导入问题已另行修复，[归档结果](../../archive/issues/card-markdown-bundle-import-2026-11-04.md)保留。

[端到端生命周期六链路审计](../../archive/issues/end-to-end-lifecycle-audit-2026-11-04.md)三项已修复、103项定向用例通过；Extension追加审计无新增确认缺陷。生产类型通过，测试类型的三个前端阻塞及真实环境限制见报告。

[Extension流程审计与改进](../../archive/issues/extension-flow-audit-2026-11-04.md)已完成；两个生命周期缺口、七项改进及D-02后端批量启停的结果见[实施记录](../../archive/plans/extension-flow-remediation-2026-11-04.md)。生产类型通过，既有验证限制保留。

[综合审查W2](../plans/full-stack-audit-remediation-2026-10-26.md#w2-实施结果2026-11-04)的FR-R01安装配置身份隔离、FR-R06显式冲突恢复已完成；真实React/SQLite共20项定向验证、Client类型通过。异常目录未修改，真实环境验收延期；其他工作包不因此关闭。

2026-11-04：Shell A包、资源工作台B包与持续CDP三份报告已按用户要求[归档](../../archive/README.md)，延期验收与明确剩余统一见[接续清单](audit-follow-ups.md#frontend-audits-archive-2026-11-04)，不再保留活跃报告条目。
