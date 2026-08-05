# Provider Account Health Plan

> **状态**：Planned / Deferred
> **日期**：2026-08-05
> **边界**：本文规划 Provider Account 连接探测。当前阶段只实现配置完整性提示，不实现 RPC、轮询或后台健康状态。

## 目标

API 导航入口和设置页面应能在玩家实际发起模型调用前发现失效的 Provider Account，同时避免持续轮询、额外 Token 消耗和日志噪音。

健康状态归属于 Provider Account，而不是 Model Profile。Model Profile 的模型名称、能力和参数错误不能被误报为 Provider 网络断联。

## 计划合同

后续增加服务端 RPC：

```ts
application.probeProviderAccount({ providerAccountId })
```

由对应 Provider Extension 实现无 Token 的可选 `probe`。OpenAI-compatible 可以优先评估认证后的模型列表接口；不具备安全探测方式的 Provider 返回 `unsupported`，不得偷偷执行一次付费生成。

候选结果：

```ts
type ProviderProbeResult = {
  providerAccountId: string
  status: 'available' | 'unreachable' | 'auth-error' | 'service-error' | 'unsupported'
  checkedAt: string
  latencyMs?: number
}
```

## 触发策略

不采用固定高频轮询。只在以下时机按过期时间触发：

- 页面加载完成；
- Provider Account 创建或修改完成；
- 打开 API 设置且缓存状态已过期；
- 页面从后台恢复且状态已过期；
- 用户手动点击重新检查；
- 正常 Provider 调用成功或失败时顺带更新。

后台检查不弹通知。手动检查和首次状态恶化可以进入统一通知系统，并对连续相同错误去重。

## UI 聚合

- 没有完整 Provider Account，或全部账户明确不可达：红色；
- 部分账户异常但仍有可用账户：黄色；
- 至少一个可用且没有已知异常：默认色；
- 尚未探测或 Provider 不支持探测：默认色。

HTTP 401/403 属于凭据或配置问题；429、模型不存在、上下文超长和普通 4xx/5xx 不直接等同于网络断联。

## 当前阶段

当前只根据已加载的 Provider Account 判断配置完整性：至少存在一个账户，并且当前内建 OpenAI-compatible Account 同时具有非空 Base URL 与 API Key reference。该判断不代表连接健康。

## Model Catalog 与启用状态

Provider Account 的 Models 输入后续通过 Provider Extension `listModels` RPC 获取远端目录。首次聚焦时懒加载，当前会话内缓存；手动模型 ID 始终作为降级入口。

远端目录与持久化 Model Profile 合并展示：已有 Profile 视为已启用并排在最前，远端未启用模型使用 muted 状态。远端不再返回但仍被 Agent Runtime Profile 引用的模型不能被隐藏或直接删除。

当前前端使用明确标注的 Mock Model Catalog 验证聚焦、过滤、排序和手动添加交互。正式 `listModels` RPC 落地后必须删除 Mock，不得将其作为 Provider 能力事实。

当前 Schema 没有 Model Profile `enabled` 字段，删除也没有完整引用保护。因此第一阶段只展示已有 Profile 的启用状态；关闭 Toggle、远端 Fetch、安全删除和引用诊断等待后端合同后实现。
