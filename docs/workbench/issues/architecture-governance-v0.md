# 架构治理与事件约束 v0

> **状态**：Open Design Method / Architecture Guardrails
> **目的**：在 Loom Studio 前期建立目录、引用、能力注册与事件流约束，避免 Application Layer、server 组合根和事件系统随着功能增长变成难以重构的结构。
> **适用范围**：packages、apps、extensions、public RPC、public events、Application Runtime 领域切片。

---

## 0. 背景

Loom Studio 的 Kernel 边界当前是正确方向：

- Kernel 保持小；
- Runtime / Provider / Tool / Agent 不进入 Kernel；
- Transport / RPC 才是平台契约；
- Extension 通过注册能力参与平台。

真正的长期风险不在 Kernel，而在上层：

```text
Application Runtime 变成大泥球；
studio-server 变成隐形内核；
application.* / renderer.* / extension RPC 走不同发现面；
事件名和 payload 随手添加，最后无法追踪事件来源与时序。
```

本文档约束这些风险。

---

## 1. 成功标准

随着项目增长，架构仍应满足：

1. 新增一个领域能力时，可以清楚放进哪个 package / domain slice；
2. 新增一个 public RPC 时，可以被统一发现，且知道 owner；
3. 新增一个 public event 时，可以在事件目录中找到 owner、payload、投递语义和版本；
4. server 只负责装配，不承载业务规则；
5. Application Layer 可以变大，但不能变成单文件或单对象集中控制；
6. Extension 作者不需要读 Studio 内部源码就能知道可调用能力；
7. UI、Extension、Runtime、Provider 的事件流不会互相混用。

---

## 2. Package 引用方向

### 2.1 总规则

```text
apps/* 可以组合 packages/*
packages/* 不允许 import apps/*
extensions/* 只能依赖 extension-sdk 和公开协议，不允许依赖 Kernel 内部
```

任何跨 package 引用都应通过 package export，不允许 deep import：

```text
允许:   @loom-studio/document-store
禁止:   @loom-studio/document-store/src/index
```

### 2.2 推荐依赖层级

```text
shared
  -> transport
  -> diagnostics
  -> document-store
  -> trace-audit

extension-sdk
  -> shared / diagnostics / document-store public types

extension-host
  -> extension-sdk / diagnostics / document-store / shared

loom-runner
  -> @loom/core / shared / diagnostics / trace-audit

kernel
  -> diagnostics / document-store / extension-host / loom-runner / trace-audit / transport / shared

application-runtime
  -> document-store / shared

client-bridge
  -> transport

studio-server
  -> all server-side packages as composition root only

studio-client
  -> client-bridge and client-side UI modules
```

### 2.3 禁止方向

```text
kernel -> application-runtime
kernel -> studio-client
kernel -> studio-server
application-runtime -> kernel
application-runtime -> extension-host
application-runtime -> transport
application-runtime -> client-bridge
extension-sdk -> kernel
extension-sdk -> extension-host
extensions/* -> kernel
extensions/* -> document-store implementation details
```

如果必须违反，先写 ADR。

---

## 3. 文件分类约束

### 3.1 Application Runtime 必须按领域切片

Application Runtime 可以是第一方内建领域层，但不能无限集中到 `runtime.ts` / `types.ts`。

推荐结构：

```text
packages/application-runtime/src/
  cards/
    commands.ts
    queries.ts
    types.ts
    documents.ts
  sessions/
  prompt/
  agents/
  providers/
  runs/
  timeline/
  documents/
    registry.ts
  runtime.ts
  index.ts
```

约束：

- `runtime.ts` 只做组合和 facade，不写长业务流程；
- 一个 domain slice 拥有自己的 command / query / document helper；
- domain slice 之间通过公开函数调用，不互相读内部文件；
- 新增 document type 时，必须归属到某个 domain slice；
- 新增跨领域流程时，优先放到 `runs/`、`sessions/` 或专门 orchestration 文件，而不是塞进根 `runtime.ts`。

触发拆分的信号：

- 单文件超过 300 行且承担多个领域；
- 一个函数同时写入 5 类以上 document；
- 一个文件同时出现 provider、session、prompt、timeline、agent 的核心规则；
- 新增功能时需要反复滚动查找旧逻辑。

### 3.2 Server 只能是 Composition Root

`apps/studio-server` 负责：

- 创建服务实例；
- 注入依赖；
- 启动 transport；
- 调用统一 RPC router；
- 管理进程生命周期。

`apps/studio-server` 不负责：

- 业务状态机；
- provider 选择逻辑；
- session / card / agent 规则；
- prompt 组合规则；
- extension 能力解释；
- 事件 payload 拼装规则。

如果 server 出现新的 `method.startsWith('xxx.')` 分支，应视为架构异味。

---

## 4. Capability / RPC 注册约束

### 4.1 单一发现面

所有 public capability 最终都应进入统一发现面。

包括：

```text
kernel RPC
application RPC
renderer RPC
extension RPC
commands
document types
events
panels / UI contributions
provider capabilities
```

不要求它们都进入 Kernel，但要求它们都能被一个统一 introspection surface 发现。

### 4.2 Public RPC 必填元数据

每个 public RPC 至少应有：

```ts
type RpcCapability = {
  name: string
  owner: 'kernel' | 'application' | `extension:${string}` | string
  namespace: string
  description?: string
  stability: 'internal' | 'experimental' | 'stable'
  inputSchema?: unknown
  outputSchema?: unknown
}
```

MVP 可以先缺 schema，但不能缺 owner。

### 4.3 不允许旁路注册

禁止新增这种模式：

```ts
if (method.startsWith('newDomain.')) {
  return callNewDomainRpc(...)
}
```

应改为：

```text
newDomain package/registerNewDomainCapabilities(router)
```

server 只调用注册函数，不理解业务命名空间。

---

## 5. 事件治理

### 5.1 事件分类

事件必须先分类，再命名。

| 类型 | 含义 | 示例 | 约束 |
|---|---|---|---|
| fact event | 已发生的事实 | `docs.changed`, `run.completed` | 可被审计，可被重放或解释 |
| notification event | 状态刷新通知 | `diagnostics.updated` | 不承载完整业务事实 |
| stream event | 流式增量 | `provider.chunk`, `run.step.delta` | 必须有 run / stream id |
| lifecycle event | 生命周期变化 | `extension.activated` | 必须有 owner/source |
| command request | 请求某事发生 | 不应使用 event | 走 RPC / command registry |

禁止用 event 做 command bus。

### 5.2 命名规则

```text
<namespace>.<past-tense-or-state>
```

推荐：

```text
docs.changed
diagnostics.updated
extension.activated
run.started
run.completed
provider.stream.chunk
```

避免：

```text
update
message
doRun
onProviderData
chatEvent
```

### 5.3 Public Event 必填元数据

每个 public event 必须进入 Event Catalog：

```ts
type EventCapability = {
  name: string
  owner: 'kernel' | 'application' | `extension:${string}` | string
  type: 'fact' | 'notification' | 'stream' | 'lifecycle'
  visibility: 'public' | 'internal'
  payloadSchema?: unknown
  version: number
  delivery: 'in-process' | 'sse' | 'websocket' | 'transport-agnostic'
  retention: 'ephemeral' | 'audit' | 'trace' | 'document'
}
```

MVP 可以先缺 `payloadSchema`，但不能缺 `owner`、`type`、`delivery`。

### 5.4 事件发出时机

文档写入相关事件必须遵守：

```text
validate
  -> write transaction
  -> commit
  -> emit fact event
  -> emit notification event
```

禁止观察者看到半提交状态。

### 5.5 `docs.changed` 不是领域事件

`docs.changed` 只表示 Document Store 事实：

```text
哪些 document id / type / version 发生变化
```

它不应表达：

```text
session 已完成一轮
provider 调用失败
agent step 结束
UI 需要刷新哪个 panel
```

领域层需要额外发自己的事件，例如：

```text
run.completed
session.branchChanged
provider.callFailed
```

这些领域事件必须有 owner 和 schema。

---

## 6. Review Checklist

每次新增 package、domain、RPC 或 event 前，检查：

### 文件位置

- 这个文件属于哪个 domain slice？
- 是否把两个以上领域塞进同一个文件？
- 是否让 `runtime.ts`、`main.ts`、`types.ts` 继续变胖？

### 引用方向

- 是否有 package import app？
- 是否有 lower layer import higher layer？
- 是否有 deep import？
- Extension 是否只依赖公开 SDK？

### RPC / Capability

- public RPC 是否注册到统一发现面？
- 是否有 owner？
- 是否有 namespace？
- 是否能被第三方客户端发现？
- 是否通过 server 前缀分支旁路？

### Event

- 这是事实、通知、流式事件，还是命令？
- 是否真的应该用 event，而不是 RPC？
- 是否定义 owner、type、delivery、version？
- 是否会在事务提交前发出？
- 是否把 `docs.changed` 当领域事件使用？

### 测试

- 是否有跨包边界测试？
- 是否有 introspection 测试？
- 是否有事件顺序或事件可见性测试？
- 是否有防止 Kernel 泄漏上层领域概念的 public surface 测试？

---

## 7. 推荐落地顺序

### P0：先立约束

- 本文档进入 `docs/02-methodology`；
- 新 PR 评审按 checklist 过一遍；
- 不急着重构所有现有代码。

### P1：补统一 Capability Registry

- Kernel RPC、Application RPC、Renderer RPC、Extension RPC 都进入同一发现面；
- `system.introspect` 或新的 `capabilities.list` 返回完整能力图；
- 移除新增的 server prefix branch。

### P2：补 Event Catalog

- 为现有事件登记 owner / type / delivery；
- 明确 `docs.changed`、`diagnostics.updated`、renderer PoC events 的边界；
- WebSocket / SSE 投递实现必须基于 Event Catalog。

### P3：切 Application Runtime 目录

- 按 cards / sessions / prompt / agents / providers / runs / timeline 切分；
- `runtime.ts` 收敛为 facade；
- 大流程拆为可测试 orchestration steps。

---

## 8. 判断原则

遇到不确定时，优先选择：

```text
显式 owner > 隐式全局
统一 registry > server 分支
领域切片 > 大 runtime 文件
事实事件 > 模糊通知
RPC command > event command
公开协议 > 读源码约定
```

这套约束的目标不是提前把架构做复杂，而是让复杂度出现时有地方归属。
