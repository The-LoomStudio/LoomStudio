# 扩展剧情任务与读取视图

Timeline 扩展可组合公开接口准备剧情材料、运行独立 Session 并提供探索视图。宿主不依赖具体记忆扩展；默认剧情注入仍使用 [Narrative Context](./narrative-context.md)。

## 执行与来源

模块声明 `narrative.read`，在 `ctx.timeline.run(target, work)` 中调用 `ctx.narrative.read({selection,maxNodes?,maxCharacters?})`。选择支持固定楼号、节点范围和末尾数量，沿用宿主采样预算。结果包含原文节点、完整性、缺号与来源凭据；不完整采样不能当作完整摘要输入。

来源含 Timeline、Branch、起止边界、顺序 nodeIds 和正文/楼号 digest。`ctx.narrative.validate(source)` 重新验证当前路径与内容；后续新增节点不会使旧范围失效，范围内替换、编辑或退出路径会失效。归档时映射 ID，内容 digest 不随 ID 迁移变化。方法在异步读取前后检查执行 lease，不能通过参数替换当前 target。

`ctx.narrative.subscribe(handler)` 通知正式正文输入持久化后的 `input`，以及正式叙事 Run 成功完成后的 `run-completed`。通知在当前采用且可运行的 Timeline 作用域内执行，不等待扩展模型任务；异常记入扩展诊断。独立 Agent 任务不发叙事完成通知。

同一订阅还接收 `changed`：数据成功提交后发送 `timelineId/branchId/headNodeId/changesetId/committedAt`。
覆盖分支 head、正文编辑、Swipe、恢复及持久化分支切换；失败事务不通知。提交时同步捕获 head，`changesetId` 是标识而非排序版本。
State/Workspace 导致的分支提交也可能触发，不能假定事件一定表示正文变化；收到后重新读取/校验才是权威。
纯前端选中分支不属于数据提交。删除后的 Timeline 仍受采用/执行资格校验，不能凭通知访问已删除数据。
扩展负责按固定来源去重、持久化准备状态和重启恢复，事件不是持久消息队列。

## 独立 Agent 任务

声明 `agent.tasks` 后，在 Timeline 执行内使用 `ctx.agentTasks`：

- `create({presetId | presetContributionId, title?, lifecycle?})`：默认 persistent，可声明 temporary。绑定独立 Preset，关闭任务 Session 的自动交接总结。
- `invoke({sessionId,input,activationFacts?})`：等待最终结果；temporary 只允许执行一次。结果按 state 区分 completed（text，可选 usage）、failed（error.code/message）、cancelled/suspended/interrupted（可选 reason）。权限、无效输入、存储失败仍抛出异常；模型失败是结构化结果。usage 沿用 Run 最终 provider 结果，不承诺是多步累计值。
- `read(sessionId)`：读取当前快照，包括可恢复的 result。运行期间可出现 idle/running/waiting-approval。
- `subscribe({sessionId,cursor?})`：游标拉取式进度订阅，返回 snapshot、events、nextCursor、done、replayExpired、partialText 和 pendingApprovals。复用已有有界 Run 回放，不持久化第二份事件流。调用方在运行时继续拉取，下一次传 nextCursor；persistent 任务切换 runId 时重置 cursor。晚订阅或回放过期以快照为准。事件包含文本/推理增量、工具进度、用量和状态；审批仍由宿主现有审批流程处理。
- `acknowledge(sessionId)`：扩展保存结果后确认领取。temporary 会软删除 Session 并删除任务记录，重复确认安全；没有持久化结果时拒绝确认。
- `cancel(sessionId)`：取消活动 Run，不丢弃已有结果。
- `dispose(sessionId)`：显式放弃任务和结果，等待 Run 收尾后回收。不要在保存失败的 finally 中无条件调用。

宿主先把最终结果写入任务记录再返回。启动恢复在扩展激活前进行：遗留 temporary Session 被软删除，已完成结果保留到 acknowledge；未完成任务变为 interrupted，不自动重新调用模型。若崩溃发生在 Run 完成但结果记录写入之前，从持久化 transcript 恢复结果。结果不等于事件回放，重启后进度可过期而结果仍可领取。

官方剧情记忆在草稿（或失败状态）保存成功后 acknowledge；修订重新携带来源和当前草稿。保存失败保留任务引用及宿主结果，重试修订时先领取恢复结果，不依赖旧 Session。

宿主私有记录绑定 installation、Timeline、Branch 与 Session；扩展不能通过自己的 records 伪造任务归属。invoke 不接受 narrativeTarget，不会直接把结果追加成剧情楼层。每次调用的 activationFacts 复用现有条件激活，可让同一个 Preset 按任务级别启用不同条目；条件不写入 Timeline State，修订 Run 由调用方重新传入。模型和工具权限继续由 Preset/宿主管理，不为总结硬编码直连模型路径。中断或 suspended 不能被当作成功产物。

## 只读 VFS

声明 `vfs.provide`，通过 `ctx.vfs.register({id,root,resolve})` 返回文本文件/目录。id 使用包命名空间，root 是独立单层绝对根；禁止遮蔽内置根。宿主按 Card、Timeline 采用与实例生命周期筛选，校验路径并剥离写入绑定；文件进入 Agent VFS，不因此自动注入 Prompt。每次准备 Agent turn 时读取一份视图。

## 记录归档

`ctx.archives.registerRecords({id,version,remap})` 让宿主导出该 installation 的 Timeline records。remap 只转换 JSON 数据，获得原 recordId、所有 recordIds 映射和 Timeline/Branch/Node/StateRevision 映射，不获得临时存储权限。宿主重建 scope、owner 和可映射 bindings；全部转换成功后单事务写入新记录。包含没有迁移合同的 asset/agent-message binding 时明确失败，不能带入悬空引用。

扩展不存在、版本不兼容或转换失败时，归档 block 与映射保留 pending。再次导出保留原始映射，再次导入组合到新目标；所有映射目标必须属于归档图。当前没有自动重放 pending 的后台任务，可在扩展可用后重新导入存档。原始记录与 pending 同 namespace 冲突时明确报错，不覆盖任一侧。

## 文件化 Preset

独立资源 ZIP v2 为 `manifest.json`、`index.json`、`entries/0.md` 与嵌套条目 Markdown。索引 schema 为 `loom.promptResource.files.v1`，artifact 保存资源配置，rootNode 保存节点 metadata、body 相对路径和 children 顺序。正文为空也有独立文件；没有正文的节点不伪造空文件。

扩展 `contributes.promptResources[].source` 可指向该 index，Markdown 相对索引目录读取；安装收集全部引用，拒绝目录逃逸、symlink、缺文件与超限。旧 monolithic Artifact JSON 和 ZIP v1 继续可读。编辑后走既有导入/更新入口，不提供自动双向同步，也不要求 CLI。

同一总结 Preset 的条件条目示例：

```json
{
  "activation": {
    "kind": "condition",
    "conditions": [{ "fact": "summary.level", "equals": 2 }]
  }
}
```

该字段位于节点的 `capabilities` 中。任务调用传入 `activationFacts: {summary: {level: 2}}`，PromptBuild 在发给模型前选择条目。公共条目不设条件。级别不是两份预设，也不要求共享同一个任务 Session；每批仍可创建独立 Session，再在其中修订。
