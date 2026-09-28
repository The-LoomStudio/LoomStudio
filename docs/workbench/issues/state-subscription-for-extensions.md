# 扩展 State 变更订阅

> 状态：Partially Resolved / 主平台正式写入通知已修复，独立扩展接入仍未验收
> 创建日期：2026-09-13
> 关联扩展：`official.the-world`

## 问题

当前复核：SDK/Host 已有 state.subscribe，不能再沿用下文“没有订阅 API”的历史结论。两处过滤缺陷已修复：target 直接比较 scope/Timeline/Branch 字段，不依赖 JSON 对象字段顺序；路径匹配覆盖父级替换、同路径、子级写入与根路径，同时排除相邻名称。两条回归修复前失败，修复后现有契约文件6项通过（含取消、释放及能力授权）。这是实际 EventBus/Host 测试，不是 The World 视觉验收。

取消清理补修：此前只解除 EventBus 订阅，手动 dispose 或 Extension Scope 卸载后仍在外部 AbortSignal 上保留监听器与订阅闭包。现手动释放、Scope 清理和 abort 共用同一释放句柄，解除信号监听后释放底层注册；两条先失败回归修复后，该契约文件8项通过。

主平台发布修复：通知现由 State 领域在普通 mutation、补偿回滚和 Global Definition 默认值事务成功后发出，Server 桥接到受保护 EventBus，扩展适配器不再重复 emit。真实 SQLite 验证默认值/普通写入/回滚事件、幂等重放与冲突不发新事件、事务中已创建 revision 后的回滚不通知，以及观察者抛错不影响已提交数据。真实 HTTP 加载临时扩展验证 UI Global/Timeline 写入可被订阅、扩展幂等重放仅通知一次，原重启授权恢复仍通过；三文件20项通过，Server project build 与主测试类型检查通过。首轮测试扩展未声明 state.write 被正确拒绝，补夹具声明后通过，没有放宽权限。

Agent 工具入口补验：`native-tool-loop.test.ts` 使用确定性 Provider 夹具执行真实 Runtime、官方 State 工具与 SQLite，三项定向测试通过（其余13项未执行）。显式目标、从 Narrative 上下文推导目标的点路径写入、提交后后续 Provider 步骤失败，均只通知一次，目标、最终 revision 和标准化路径一致；读取不增加通知。未修改执行器，也未调用外部模型。

剩余边界：未执行外部 Provider 端到端测试。The World 当前源码未找到 state.subscribe/state.changed 消费，动态天色仍未验收，独立扩展接入不纳入主应用 CI。当前事件为进程内提交后提示，不保证进程崩溃/重启后的补发；初始化及选择分支不是本事件的 State Mutation。revisionId 是不透明标识，消费者不能按其字典序判断先后，异步重读需防止晚结果覆盖。

历史发布链定位：普通 UI/Agent/扩展写入共同进入 `applyApplicationStateMutation`，幂等命中在事务前返回旧 revision/changeset；旧 Server 扩展适配器无条件 emit，导致 UI/Agent 漏报和扩展重放重复通知。本轮已覆盖这条路径、`revertApplicationStateChangeset` 补偿 revision，以及 `upsertStateDefinition` 中的默认值事务出口。未改 Data Engine 提交结构，未从“最新 Head”反推历史事件，也未增加持久事件队列。

以下问题描述与方案为原审计基线：

扩展目前只能通过 `context.state.get(target)` 主动读取指定 State。Studio 内部发生 State 写入后，没有向扩展推送变更的正式契约，因此 The World 无法在世界时间、天气或背景组件变化后立即驱动动态天色和其他表现更新。

## 期望能力

为扩展 SDK 增加类型化的 State 订阅能力，至少支持：

- 按 scope、Timeline、Branch 订阅；
- 事件携带新的 `revisionId`、target 和受影响路径或 changeset；
- 扩展卸载、`AbortSignal` 取消或目标切换时自动清理；
- 严格保持 Timeline / Branch 隔离；
- 明确事件顺序、重复投递和 revision 冲突语义。

## The World 用例

Studio 或 Agent 更新 `WorldTimeComponent` 后，State Store 提交 revision，The World 收到事件，使用 `skyPaletteAt()` 计算新天色，再通过正式外观 API 更新全局背景层。天气效果和作者 Renderer 局部刷新也复用同一机制。

## 当前决策

原先延期不再表示主平台没有订阅实现，正式 State 写入通知已有集成验证；**不阻塞 The World 的其他迁移工作**。独立扩展接入仍可按自身发布节奏安排，未接入前调试台通过显式读取刷新。扩展订阅应由宿主变更通知驱动，不要求每个扩展自行持续轮询。

## 验收标准

- 提供公开、类型化的 State subscribe API；
- 覆盖 Timeline / Branch 隔离、卸载清理和目标切换；
- 至少有一个扩展示例能收到 State 更新；
- The World 能用该事件驱动动态天色；
- 有重复事件、revision 顺序和冲突处理的定向测试。

## 调研结论与修复方案（2026-09-13）

### 已确认事实

- Kernel 已有统一 EventBus，支持事件定义、扩展能力授权、订阅句柄和卸载清理。
- Data Engine 已有 post-commit observer；Kernel 当前把提交汇总为 `data.changed`，但该事件只包含低层 store/entity 摘要。
- State API 当前只暴露 `read` / `write`，扩展没有从 State Service 获取提交后的快照或 State 路径变更的正式入口。
- 因而 The World 无法可靠判断一次提交是否影响 `theWorld`，也不能在不轮询的情况下取得最新 `revisionId`。

### 建议的最小修复

不要让扩展直接订阅低层 `data.changed` 并自行猜测 State。由 State Service 在一次写入成功、revision 已提交之后发布受保护的 `state.changed` 事件，事件 payload 至少包含：

```ts
{
  target: { scope: 'timeline', timelineId: string, branchId: string },
  revisionId: string,
  changesetId: string,
  paths: string[],
  source: 'kernel' | 'client' | 'extension' | 'system'
}
```

扩展通过 `context.state.subscribe({ scope, timelineId, branchId, paths? }, handler)` 订阅。SDK 返回可释放句柄，并接受 `AbortSignal`；宿主负责把订阅绑定到 Extension Scope。只发送提交成功后的事件，事件顺序沿用 Data Engine commit 顺序；同一 `changesetId` 在 EventBus 层只投递一次，订阅者仍必须按 `revisionId` 丢弃旧事件。

### 与现有事件系统的关系

`state.changed` 应复用 Kernel EventBus 的定义、授权和错误隔离机制，但不把整个 State 快照广播给扩展。扩展收到事件后再用显式 target 调用 `state.read`，避免泄露无关 State，也避免事件 payload 与快照出现双份事实。State Service 负责把写入 operation 映射为稳定的 JSON Pointer 前缀；无法提供准确路径时应发布 `paths: []` 并标记为全量变更，而不是猜测路径。

建议新增一个受控事件能力类别 `state`，并让 Manifest 的 `events.subscribe` 明确声明它。没有该授权的扩展继续只能主动读取，避免把所有 State 变更暴露给普通扩展。

### The World 接入顺序

1. 宿主实现 `state.changed` 定义与 State Service 转发。
2. SDK 增加类型化 `state.subscribe`，保留现有 `events.subscribe` 作为底层通用机制。
3. The World 订阅 `theWorld` 路径，收到事件后按 target 读取最新快照。
4. 仅当 `worldTime`、`weather` 或 `background` 组件发生变化时更新天色、天气效果和背景；其他实体变化只刷新调试台数据。

### 暂不做

- 不在扩展内增加定时轮询。
- 不把完整 State 快照塞进 EventBus payload。
- 不要求作者 Renderer 依赖全局 State 订阅；作者仍可按需读取 State。

### 验收重点

增加 Kernel / State Service 定向测试：Timeline / Branch 隔离、提交失败不发事件、同一 changeset 不重复投递、revision 逆序丢弃、订阅句柄与 Extension Scope 清理，以及跨扩展权限拒绝。完成这些后再接 The World 的动态天色自动同步。


## 实施结果

- Kernel 注册并发布受保护的 `state.changed` 事件，仅在 State mutation 提交成功后发布。
- 事件携带 target、revision、changeset 和 mutation 路径，不携带完整 State。
- SDK 提供 `context.state.subscribe()`，支持目标与路径过滤、`AbortSignal` 和扩展 Scope 自动清理。
- 事件权限使用独立的 `state` capability，未授权扩展无法订阅。
- 已通过 Extension SDK 与 Studio Server 定向 TypeScript 检查。

## 历史完成声明的修订

SDK、订阅过滤/清理及上述正式 State 写入通知已有验证；没有承诺任意底层数据库操作都产生通知。The World 动态天色接入与视觉验收仍单独保留，本 Issue 暂不归档或删除。
