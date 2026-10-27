# Narrative Runtime

负责 Timeline 正文、主写作 Session 与独立 Agent Session 在 Client 侧的编排。先从 [`use-narrative-runtime.ts`](./model/use-narrative-runtime.ts) 看 facade，再按问题下钻：[`use-narrative-collections.ts`](./model/use-narrative-collections.ts) 管 Timeline/Session 目录读取；[`use-timeline-session.ts`](./model/use-timeline-session.ts) 管 Timeline 根 Session；[`use-session-run.ts`](./model/use-session-run.ts) 与 [`agent-run-observer.ts`](./model/agent-run-observer.ts) 管 Run 观察与恢复呈现。

App 将 [`StudioApi`](../../shared/api/studio-api.ts)、endpoint 存储范围、当前 Card/预设、操作回调、宏选择与翻译器注入主 hook。Widget 消费其结果并呈现 Timeline、Composer 与 Session 面板；具体领域行为留在本 Feature，不由 Widget 或 App 重复实现。

正文事实以 Server Transcript 为准。Timeline 的根 Session 与 Timeline 同 ID；Narrative Node/Branch 是正文与分支的索引/投影，不能当作独立正文副本。Provider Replay、Client 消息数组和 Run 展示状态也不是持久正文权威。追加正文输入会先原子提交 canonical user message 与正文索引，再启动 Run；调整读取、分页或恢复时，应保留这条边界。详见[数据所有权](../../../../../docs/architecture/data/README.md)和[Session Runtime 合同](../../../../../docs/architecture/application/agent/runtime-and-session.md)。

目录缓存由本 Feature 按 API 身份隔离并自行刷新；主写作 Session 与侧栏 Session 使用独立的 Run lifecycle 观察，避免切换侧栏替换根 Session 的运行上下文。恢复是否可继续受服务端 Run 状态和检查点约束；Client 观察状态不能单独授权重放。

改动入口：目录读取改 `use-narrative-collections.ts`；Timeline 根 Session 生命周期改 `use-timeline-session.ts`；Run 观察/恢复显示改 `use-session-run.ts` 或 `agent-run-observer.ts`；提交、分支、Swipe 与投影协调改 `use-narrative-runtime.ts`；局部呈现改 `ui/`。跨层规则见[Client FSD 约定](../../../README.md#源码导航与-fsd-架构规范)。

相关验证入口：[Runtime 编排](../../../../../tests/unit/client/use-narrative-runtime.test.ts)、[根 Session 生命周期](../../../../../tests/unit/client/use-timeline-session.test.ts)、[Run 恢复](../../../../../tests/unit/client/narrative-run-recovery.test.ts)、[Session 生命周期](../../../../../tests/unit/client/narrative-session-lifecycle.test.ts)。按实际修改选取。
