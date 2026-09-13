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

在该能力完成前，The World 先使用主动读取和调试台预览，不通过轮询、直接修改宿主 DOM 或读取宿主内部 Store 绕过扩展边界。

## 验收标准

- 提供公开、类型化的 State subscribe API；
- 覆盖 Timeline / Branch 隔离、卸载清理和目标切换；
- 至少有一个扩展示例能收到 State 更新；
- The World 能用该事件驱动动态天色；
- 有重复事件、revision 顺序和冲突处理的定向测试。
