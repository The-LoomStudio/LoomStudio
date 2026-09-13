# 扩展 State 变更订阅

> 状态：待排期
> 创建日期：2026-09-13
> 关联扩展：`official.the-world`

## 问题

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

该项已明确延期，**不阻塞 The World 的其他迁移工作**。在该能力完成前，调试台通过显式读取刷新；继续实现日历检查、导入预览与提交、资源诊断等不依赖订阅的能力。扩展订阅应由宿主变更通知驱动，不要求每个扩展自行持续轮询。

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
