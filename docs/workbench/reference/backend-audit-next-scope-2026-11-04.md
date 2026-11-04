# 后端提交、并发与恢复审查范围（历史参考）

状态：方法参考；2026-11-04 四方向审查已完成，结论见[正式报告](../../archive/issues/backend-failure-concurrency-lifecycle-audit-2026-11-04.md)。下文保留审查范围，不是业务修改授权。当前审计由[端到端生命周期准备](../../archive/plans/end-to-end-lifecycle-audit-preparation-2026-11-04.md)接续。

上一轮[前后端职责与 API](../../archive/issues/frontend-backend-responsibility-audit-2026-11-03.md)九项已完成。下一轮建议从“失败与并发下，后端是否仍保存正确事实”入手，按完整链路推进。

| 顺序 | 范围 | 要证明的性质 | 主要入口 |
| --- | --- | --- | --- |
| 1 | 提交、补偿与响应 | 提交前失败无半成品；提交后通知/清理失败不谎报未保存；重试不误删已生效结果 | `foundation/mutation.ts`、`runtime/providers-runtime.ts`、Server `resource-directories/card-directory-import.ts`、`extensions/import-batch.ts`、Kernel 提交通知 |
| 2 | 多入口并发写入 | UI、Agent Tool、SDK、导入/恢复使用相同版本与归属约束；事务外读到的事实不会在写入时静默过期 | `runtime/state-runtime.ts`、`runtime/workspace-runtime.ts`、`runtime/agents-runtime.ts`、application-data 各 Store 的 transaction 入口 |
| 3 | 后台任务恢复 | 暂停/取消/重启状态与真实执行器一致；异步摘要晚到不能推进错误分支或覆盖新版本；锁与资源最终释放 | `agents/session-summary.ts`、`agents/run-recovery.ts`、Server `agents/agent-run-service.ts` |
| 4 | 导入、归档与删除生命周期 | 引用重映射、State/Workspace/Transcript 拓扑完整；失败重试不会重复导入；删除范围和保留历史符合合同 | `archive/timeline-archive.ts`、`extensions/timeline-recovery.ts`、Card/Timeline 删除与资源目录恢复 |

优先第 1 组，再沿发现进入第 2 组。不以“多事务”“存在catch”直接定罪：数据库、Blob、Secret及文件系统不天然共享原子性，必须先确定成功时点和可恢复协议；不擅自加通用事务管理器、队列或强引用级联。

## 去重与验收

[10-26 综合修复计划](../plans/full-stack-audit-remediation-2026-10-26.md)仍记有待实施项，涉及通知、恢复和媒体等。先复核当前源码，标明“仍存在/已修复/合同改变”，不复制成新问题，也不凭旧状态宣称缺陷仍在。

每条确认问题记录实际入口、失败点/并发交错、已提交数据、用户可见结果、反证及最小修复方向。允许最小隔离故障注入来消除具体疑点；不修改实际数据库，不调用真实付费 Provider。静态扫描与运行复现分开报告。

分工沿用主 Agent 作语义判断、少量 `luna_operator` 做边界明确的只读取证；独立实施只有获授权后交 `sol_implementer`。按完整工作包集中验证，不按文件数或发现数设配额。
