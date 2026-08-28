# Extension Module 真实场景与 Capability Surface v0

> **状态**：Data Foundation Implemented / Renderer Discussion Open
>
> **日期**：2026-08-27
>
> **目的**：使用全局记忆、文生图、Preset 个性化和角色前端四类真实需求，校验统一 Executable Module、生命周期、Event、Renderer 与 Application Capability 的边界。

## 1. 核心判断

不按 `ui / logic / agent` 给可执行代码划分业务 Runtime。代码通过正式 API 注册 Renderer、Action、Tool、Context Provider 或 Event Handler，真实注册行为决定它提供什么能力。

```text
Carrier
  -> Executable Module
  -> activate(ctx)
  -> register contributions
  -> scope abort
  -> dispose registrations
```

Installed Extension、Card Embedded Module 和 Preset Embedded Module 可以复用同一份 Module、Capability、Diagnostic、预算和清理合同。差异保留在 Carrier、默认 Scope、权限上限、安装和更新来源。

执行 Adapter 只描述代码如何被 Host 加载，不描述业务用途：

- Client Direct：第一方或完全信任代码；
- Shadow DOM：共享 JS Realm，仅提供 CSS / DOM 封装；
- sandbox iframe：普通第三方和角色 UI；
- Worker：无 DOM 计算；
- Server Direct：当前受信任 Node ESM；
- Isolated Process：未来普通第三方后台代码的目标边界。

Card 不得内嵌当前同进程 Trusted Server Module。需要真正后台服务时，Card 声明独立 Extension Requirement，由用户单独安装和授权。

## 2. Event 与 Hook

当前 EventBus 适合广播已经发生的事实：Event 无返回值，不修改发布者结果，Subscriber 失败不回滚原操作。

```text
narrative.node.committed
state.revision.created
agent.run.completed
asset.created
```

Event 不等于可靠 Job Queue，也不等于 Hook。必须修改、拒绝或补充当前流程的能力优先使用类型化 Registry：

- Prompt：Loom Core Pass / Context Provider / Activation Controller；
- History：Text Transform Rule / Extractor；
- UI：Renderer / Slot Registry；
- Agent：Tool Registry；
- 用户操作：Action Registry。

只有出现真实的同步决策点后，才建立窄 Hook。暂不建设万能 `beforeAnything` HookBus。

## 3. 全局记忆 Extension

典型链路：

```text
History committed Event
  -> durable indexing job + checkpoint
  -> read canonical History
  -> update extension-owned index

Prompt Build
  -> registered Context Provider
  -> retrieve memories
  -> return traced Prompt Contribution
```

还可以注册 `search_memory` Tool 和记忆管理 Panel。

需要的能力：History 读取、Context Provider、Extension-owned Document、后台 Job、模型或 Embedding Provider、Tool、UI、删除 / 分支 / 回滚事实。

索引是可重建派生数据。Event 不能替代 Durable Job；插件必须处理删除、分支、回滚、Archive、禁用期间漏过的变更和重新索引。

## 4. 全局文生图 Extension

典型链路：

```text
Tool / UI Action
  -> create image generation job
  -> invoke approved Provider Account
  -> progress Event
  -> publish Asset
  -> Tool Result returns artifact-ref
  -> Renderer / Gallery displays Asset
```

需要的能力：Tool、Action、Provider Account、受控网络、Durable Job、取消、Asset、Renderer 和费用确认。

Extension 不直接读取 API Key，Event 不承载图片 Base64。Secret、调用、重试和费用边界由 Provider Capability 管理，图片字节由 Asset Store 管理。

## 5. Preset Embedded Module

典型用途是 Preset 个性化 UI、工具栏 Action 和动态 Prompt Contribution：

```text
Preset selected
  -> activate embedded module
  -> register toolbar / sidebar widget
  -> read scoped Preset
  -> explicit Action applies Preset mutation
  -> close scope and dispose widget
```

Module 不应在 `activate()` 时静默修改 Preset。Canonical Preset、Extension defaults 和 User override 应保持来源可辨，避免插件更新覆盖用户调整。

## 6. Card Embedded Module

角色状态栏和重型前端按 Timeline / Session Scope 挂载，每个 Scope 只创建一个 Widget Instance，不按消息重复创建 iframe。

```text
Card / Timeline activated
  -> Module Instance
  -> register Timeline widget
  -> read scoped State / History Projection
  -> Action submits validated State Mutation
  -> scope closes
  -> abort + dispose
```

“根据变量开关世界书”优先实现为 Prompt Activation Controller，而不是长期轮询和反复修改 Setting canonical `enabled`：

```text
Prompt Build
  -> read current Timeline State
  -> compute activation facts
  -> select Setting entries
```

只有需要响应已提交事实并产生持久变化时才订阅 Event，并使用 source event ID、idempotency key、expected revision 和 origin metadata 防止重复执行和自触发循环。

## 7. Card 作为 Portable Extension Payload 的分发 Carrier

Card 级需求首先是分发，不是第三种运行时存储 Scope，也不要求 Core 理解每种插件配置。Extension 负责把允许分发的配置、初始数据或其他私有资源序列化为 Portable Payload；Card 作者显式绑定，Core 只负责安全运输、未知数据保留和 Requirement。

```text
Card Bundle
  -> Extension Requirement
  -> Portable Extension Payload Binding
  -> State Template / Timeline State Binding
  -> Prompt Resources / static Assets
  -> Core imports and preserves opaque payload
  -> installed Extension validates and applies it explicitly
```

这条链不引入 `card` Extension Storage Scope：

- Card 是 Carrier、来源和推荐组合关系，不是可变插件数据库；
- Core 不扫描 Extension 数据库、判断哪些字段应导出或设计插件私有 Schema；
- 已创建 Timeline 不自动追随 Card Payload 的后续修改；
- 真正需要跨 Timeline 共享的可变数据应成为显式命名的共享档案，而不是隐式 Card Scope；
- Card 删除、升级或缺失原 Extension 时，不应破坏已物化的 Timeline 数据；
- Extension 缺失时，Importer 保留 Opaque Payload，不能静默丢弃。

变量只承载角色或世界的共享语义状态。会被 Prompt、多个脚本、UI 和分支回滚共同消费的外貌、服装或关系值，可以通过 Card State Template 初始化 Timeline State；只被文生图 Extension 消费的画师串、模型、采样器和负面词由该 Extension 放入 Portable Payload。生成任务、缓存、索引和 Asset 不是变量。

Card Bundle 不得携带 Provider API Key、Token 或其他 Secret，也不应默认导出用户私有历史、缓存、生成记录或全部 Timeline 数据。正式边界见 [`card-extension-portable-payload-v0.md`](card-extension-portable-payload-v0.md)。

## 8. Capability Matrix

| Capability | 记忆 | 文生图 | Preset | Card |
|---|---:|---:|---:|---:|
| History read | ✓ | 可选 | 可选 | ✓ |
| State read / mutate | 可选 | — | 可选 | ✓ |
| Prompt contribution | ✓ | 可选 | ✓ | ✓ |
| Tool / Action | ✓ | ✓ | ✓ | ✓ |
| Renderer / Widget | ✓ | ✓ | ✓ | ✓ |
| Asset | 可选 | ✓ | 可选 | 可选 |
| Provider / Network | ✓ | ✓ | — | 通常不需要 |
| Durable Job | ✓ | ✓ | — | 少量 |
| Event subscription | ✓ | ✓ | ✓ | ✓ |

## 9. 当前实现缺口

- Client Extension Host 与 Direct / Shadow / iframe / Worker Adapter 尚未实现；
- Server Extension 缺少 History、State、Prompt 等 Application typed capability；
- 没有 Durable Job / Trigger Queue；
- 没有 Context Provider / Activation Controller Registry；
- Renderer Registry 还不能加载第三方 Client code；
- Card / Preset Embedded Module 的导入、Mount、授权和更新尚未实现；
- Card Bundle 已有 UTF-8 Portable Payload import / canonical Document / export / ZIP transport；尚无 CRUD、Extension Packaging Capability、Requirement 安装联动与 Pending Apply 合同；
- Provider Account 尚未作为 Extension Capability 开放。

## 10. 推荐切片

角色和 Preset 渲染的第一批能力：

```text
scope
lifecycle
ui / renderer / slot
actions
state.read
history.read
events.subscribe
owned storage
```

记忆和文生图的第二批能力：

```text
prompt context provider
tools
durable jobs
assets
providers
network
```

下一步需要定义的是 Application Capability Surface，而不是继续增加 Script / Extension 业务分类。

## 11. 尚待讨论的相邻问题

1. Portable Payload 的 Asset 闭包、Pending Apply UI 与任意二进制 envelope；
2. Extension 如何选择可分发内容，并在导入后验证、迁移和显式应用；
3. Extension 缺失、版本不兼容或配置 Schema 升级时，Importer、Timeline 创建和 UI 如何降级；
4. 已实现的 Global / Timeline / Agent Session Config / Record / typed binding 如何进入作者 UI 与调试视图；
5. Narrative Attachment、记忆来源与生成记录绑定到 Node 后，分支隐藏、显式删除、失效重建和 Asset GC 分别采用什么生命周期；
6. Embedded Module 与独立 Extension 的安装授权、Capability grant、更新和卸载体验。
