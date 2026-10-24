# 扩展任务生命周期与剧情通知

## Goal
扩展独立执行模型任务，读取明确结果和进度，保存后确认回收；剧情提交后获得可重新校验来源的通知。

## Verified facts
现有 AgentRunService 已有游标事件、快照和持久化 transcript；扩展任务归属存在宿主 Document；剧情通知只有 input/run-completed。

## Inherited decisions
不新增工作流引擎或可靠事件队列；复用 Run、Document、Session 软删除和数据提交观察。任务归属检查不能放松。

## Minimal design
- create 可声明 temporary。invoke 将结果持久化到宿主任务记录后返回；acknowledge 确认领取并回收。未确认结果在重启后仍可读取。恢复时把遗留临时 Session 软删除，保留可领取结果或 interrupted 状态。
- 明确 completed/failed/cancelled/suspended/interrupted 结果；subscribe 复用 Run 游标页，包含当前状态和等待审批信息，晚订阅或回放过期可用快照恢复。无额外事件存储。
- 剧情 changed 通知来自成功的数据提交，带分支 head、changesetId；不等价于可靠任务队列，也不覆盖纯前端选中状态。
- 剧情记忆保存草稿后 acknowledge；修订显式携带来源和当前草稿，不依赖旧 Session。

## Work packages
主 Agent：extension-agent-tasks.ts、SDK agent-tasks 契约、host 接线、server 启动恢复、官方记忆和集成测试。
worker narrative_events：剧情提交观察、narrative-work.ts 活动类型和定向通知测试；避开上述文件。

## Acceptance and validation
任务归属隔离；成功输出落盘后才能回收；重启仍可领取；失败/暂停不伪装成功；进度游标和快照；失败事务不发剧情通知。应用 tsc + 相关集成/契约测试，不扩展为全仓修复。

## Open questions or blockers
None.

## 实施结果
三项能力及结构化结果已接通。临时任务结果落盘后等待 acknowledge，启动恢复清理 Session 并保留未领取结果；subscribe 为游标拉取式进度订阅。官方剧情记忆已接入领取协议及来源变化取消。应用源码 tsc 与 14 项定向测试通过；不包含真实模型调用或全仓测试类型修复。
