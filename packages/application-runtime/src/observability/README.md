# Runtime Observation

本目录记录 Provider API、PromptBuild 与 Run 的临时诊断观测。入口由 [`ApplicationRuntime`](../runtime/observability-runtime.ts) 提供；观测写入是 best effort，不能替代 Agent Store 中的 canonical Transcript，也不决定 Run 的持久化状态。

## 生命周期与注入

- [`createObservationStore()`](./store.ts) 默认只保存在进程内；Runtime 未注入 `observations` 时会创建这个内存 Store。内存记录按 TTL 与记录数/字节预算裁剪，默认保留最长一天。
- 可选持久化需要创建 Store 时提供 `persistencePath`，并显式启用 `setPersistence(true)`。它保存受限 JSON 快照；没有配置路径时，持久化状态返回不可用。Runtime 暴露状态和切换方法，但宿主负责提供路径、权限及请求授权。
- Runtime 查询会按 Session、Timeline 和 Extension Installation 引用过滤已删除或不可用的观测来源；这不替代宿主 RPC/API 的访问控制。
- Provider API 请求观测与 Dashboard 用量统计是两套记录：前者用于诊断，可丢弃或过期；后者由 [`application-data` Statistics Store](../../../application-data/src/statistics/README.md) 持久化并参与统计。

## 阅读入口与验证

- [`types.ts`](./types.ts)：观测种类、状态、字段和 Store 合同。
- [`gateway.ts`](./gateway.ts)：记录 Provider 请求阶段及响应观测；Provider 配置仅采集白名单字段，但请求消息和工具定义也会进入观测记录。
- [`persistence.ts`](./persistence.ts)：快照读写、持久化开关与错误状态。
- [`observability.test.ts`](../../../../tests/unit/application-runtime/observability.test.ts)、[`observability-persistence.test.ts`](../../../../tests/unit/application-runtime/observability-persistence.test.ts)：内存生命周期、限额与持久化行为的现有验证入口。
