# Loom Studio Extension Host Capability 与 Runtime Access v0

> **Status**: Draft v0.1（2026-07-23）
>
> **Purpose**: 讨论 Extension 如何获得 Studio 能力、Host 如何成为身份与权限边界，以及 `activate(ctx)`、未来 Virtual Module Import 和公开 API Client 之间的关系。
>
> **Current Reality**: Server Extension Host 已实现部分生命周期与 capability facade；Client Extension Host、完整权限 enforcement、Virtual Module 和 Extension 作者 Logger 尚未实现。
>
> **Related**:
> - [`studio-extension-lifecycle-v0.md`](studio-extension-lifecycle-v0.md)
> - [`studio-extension-manifest-architecture.md`](studio-extension-manifest-architecture.md)
> - [`../../adr/ADR-002-extension-manifest-and-registration-model.md`](../../adr/ADR-002-extension-manifest-and-registration-model.md)
> - [`../../adr/ADR-004-platform-auth-secrets-and-provider-credential-boundary.md`](../../adr/ADR-004-platform-auth-secrets-and-provider-credential-boundary.md)
> - [`../../plans/extension-developer-experience.md`](../../plans/extension-developer-experience.md)
> - [`../../../architecture/platform/logging.md`](../../../architecture/platform/logging.md)

---

## 1. 问题

Loom Studio 是开放、本地优先的平台。Extension 作者不应该为了接入数据、RPC、日志、UI、存储或生命周期而复制 Studio 源码，也不应该为每项能力重新实现独立系统。

但“安装一个 package”与“获得当前宿主实例里的能力”不是同一件事：

```text
Import package
  得到一份代码和类型。

Host capability
  得到当前 Studio 实例、当前 Extension 身份和当前权限下的受控能力。
```

一个普通 `@loom-studio/logging` package 副本不知道当前 Root Logger、Sinks、extensionId、权限或调用链。一个普通 API Client 也不知道当前 Extension 在 Studio 内被授予了哪些本地 UI 和生命周期能力。

因此需要把以下三层分开：

```text
Authoring SDK
  写代码时的类型、define helper 和 Manifest contract。

Host Capability
  运行时由 Studio 注入或绑定的本地能力。

Public API
  通过鉴权后供 Client Extension、外部网页、CLI 和自动化调用的远程协议。
```

## 2. 核心判断

### 2.1 Host 是 capability/authentication gate

Host 是 Studio 给每个 Extension 发放的、带身份与权限的能力句柄。它不是裸 Kernel，也不只服务于 iframe、Worker 或独立进程。

同进程 Runtime 中，Host 方法可以直接调用进程内 service；跨 Realm 或跨进程 Runtime 中，相同方法可以由 MessagePort/RPC proxy 实现。

```text
Extension
  -> Host Capability
       -> identity
       -> permission check
       -> owner tracking
       -> validation
       -> correlation / audit / logging
       -> Kernel or platform service
```

### 2.2 Host 不暴露 Kernel

不接受：

```ts
host.kernel.documents
host.kernel.eventBus
host.kernel.internalRegistry
host.kernel.stop()
```

原因：

- Kernel internal API 会随实现重构；
- 裸对象无法迁移到 Worker、iframe 或进程代理；
- 插件可以绕过 actor、owner、schema、permission 和 audit；
- 一个插件可能修改其他插件或整个宿主状态；
- 权限无法按 capability 收缩。

Server Extension 可以拥有很强的数据操作能力，但必须通过受控 facade：

```ts
await host.documents.write({
  type: 'example.note',
  content: { value: 42 },
})
```

Host 可以在内部直接调用 Document Store，同时补充可信 actor、owner、changeset、correlation 和日志。是否经过 HTTP 不是安全边界，Host dispatch 才是边界。

### 2.3 Client 后端数据操作仍通过 API

官方 Studio Client 本身通过 Transport/API 使用后端能力，Client Extension 也不应获得绕过 Transport 的 Kernel 通道。

```text
Client Extension
  -> authenticated typed API
  -> Server Application / Kernel RPC
```

Client Host 可以提供一个已经配置 endpoint、认证和 Extension 身份的 `host.api`，但它底层仍然是 API Client。

## 3. Capability Shape

不建议制造一个无所不包的 `Host` 上帝对象。共享基础和运行环境专属能力应分开。

### 3.1 Base Extension Host

候选形状：

```ts
type BaseExtensionHost = {
  extension: ExtensionIdentity
  logger: ExtensionLogger
  lifecycle: ExtensionLifecycle
  permissions: ExtensionPermissions
}
```

共同能力：

- 当前 Extension 的可信 identity；
- 预绑定 Logger；
- dispose/abort 等生命周期；
- 当前 capability grant 的只读视图。

### 3.2 Server Extension Host

候选形状：

```ts
type ServerExtensionHost = BaseExtensionHost & {
  documents: ExtensionDocuments
  rpc: ServerExtensionRpc
  events: ServerExtensionEvents
  diagnostics: ExtensionDiagnostics
}
```

按真实需求可能继续增加：

- `secrets`；
- `network`；
- `filesystem`；
- `backgroundTasks`。

这些能力不能因为“以后可能需要”一次性加入。每一项都需要明确的 Manifest declaration、权限、审计和跨隔离边界数据形状。

### 3.3 Client Extension Host

候选形状：

```ts
type ClientExtensionHost = BaseExtensionHost & {
  api: StudioApiClient
  ui: ClientUiHost
  storage: ClientExtensionStorage
  events: ClientEventHost
}
```

Client Host 的职责是：

- 本地 UI contribution 和挂载点；
- 当前主题与有限宿主快照；
- Extension 私有 Client 存储；
- 当前 Client 生命周期；
- 已鉴权、已绑定 Extension 身份的 API Client；
- Client 本地日志；
- iframe/Worker 与宿主之间的 Bootstrap/Bridge。

Client Host 不重新发明 Card、Preset、Session 或 Setting Layer CRUD。完整持久化数据继续使用 typed API。

## 4. 三种消费入口

Host Capability 是唯一语义来源，但可以提供不同开发者体验。

### 4.1 `activate(ctx)`：可靠基础入口

```ts
export default defineServerExtension({
  activate(ctx) {
    ctx.logger.info('Extension initialized')
    ctx.rpc.register('example.echo.echo', params => params ?? null)
  },
})
```

优点：

- Extension 身份天然明确；
- 每个实例得到独立 facade；
- 测试容易注入 fake；
- 同一 contract 可以序列化为 proxy；
- 不依赖全局单例或隐式加载顺序。

`ctx` 是当前最可靠的 canonical entry。

### 4.2 Host-provided Virtual Module：未来 Import DX

候选作者体验：

```ts
import { logger, rpc, ui } from '@loom-studio/host'

logger.info('Extension initialized')
```

这里的 `@loom-studio/host` 不是普通 npm 实现副本，而是由宿主解析并绑定的运行时模块。它只是同一 Host Capability 的语法糖。

候选 Runtime 适配：

| Runtime | Host module 的可能实现 |
|---|---|
| Server in-process | Host-controlled Node module resolver / facade |
| Client Direct Mount | Import Map 或宿主 bundle facade |
| Shadow DOM | 与宿主共享 JS Realm 的 facade |
| iframe | Bootstrap 后连接 MessagePort proxy |
| Worker | Worker Bootstrap + MessagePort proxy |
| External application | 不提供，使用公开 API Client |

Virtual Module 的难点：

- 同一 Realm 多 Extension 不能错误共享身份；
- 插件构建必须把 Host module 标记为 external；
- iframe/Worker 需要初始化握手；
- Server ESM 解析需要稳定方案；
- 测试需要可替换 facade；
- Host module 版本和 capability negotiation 必须可检查。

因此第一阶段不能因为追求 Import 语法就同时建设完整自定义 Loader。先稳定 capability contract，再决定 Virtual Module 实现。

### 4.3 `@loom-studio/api-client`：公开远程访问

候选外部体验：

```ts
import { createStudioApiClient } from '@loom-studio/api-client'

const api = createStudioApiClient({ endpoint, token })
await api.call('application.listCards', {})
```

适用：

- Client Extension；
- 独立网页；
- CLI；
- 编辑器集成；
- 自动化脚本；
- 第三方桌面应用。

它是正常鉴权的公共协议客户端，不提供 panel registration、Client lifecycle 或宿主本地 Logger。运行在 Studio 内部的 Client Extension 可以通过 `host.api` 获得已经配置好的同类客户端。

## 5. Client Runtime 自由度

Client Extension 可以根据需求选择不同 Runtime：

| Runtime | DOM | JS Realm | 隔离性质 | Host 调用实现 |
|---|---|---|---|---|
| Direct Mount | 宿主 DOM | 与宿主共享 | 无隔离 | 直接函数 |
| Shadow DOM | Shadow Tree | 与宿主共享 | CSS/DOM 封装，不是安全沙箱 | 直接函数 |
| iframe | 独立 Document | 独立 Realm | 可配 sandbox/权限 | MessagePort proxy |
| Worker | 无 DOM | 独立 Realm | 计算隔离 | MessagePort proxy |

重要约束：

```text
Shadow DOM 隔离样式，不隔离 JavaScript 权限。
```

Host contract 应尽量保持 runtime-neutral。直接函数和 proxy 的参数、返回值应使用 structured-clone/JSON-friendly 数据；DOM node、SQL connection、Kernel class 等对象不能成为通用 capability contract。

Runtime 选择可以影响性能、UI 自由度和隔离强度，但不应迫使作者为 Logger、API 或生命周期编写四套业务代码。

## 6. Extension Logger

### 6.1 Logger 是 Host Capability

插件不应通过以下方式接入官方日志：

```ts
import { createRootLogger } from '@loom-studio/logging'
```

这只会创建一个不知道当前 Studio Sinks、service、instanceId、extensionId 和权限的独立 Logger。

候选公开形状：

```ts
type ExtensionLogFields = {
  event?: string
  data?: JsonObject
}

type ExtensionLogger = {
  child(namespace: string): ExtensionLogger
  debug(message: string, fields?: ExtensionLogFields): void
  info(message: string, fields?: ExtensionLogFields): void
  warn(message: string, fields?: ExtensionLogFields): void
  error(message: string, fields?: ExtensionLogFields): void
}
```

Host 控制：

- `timestamp`；
- `service`；
- `instanceId`；
- 根 namespace；
- `extensionId`；
- Sink；
- JSONL 路径；
- correlation metadata；
- 限流和大小限制。

候选 namespace：

```text
extension.<extensionId>
extension.<extensionId>.<child>
```

Server 与 Client 可以使用相同逻辑 namespace，因为 `service` 已经区分 `studio-server` 与 `studio-client`。

### 6.2 为什么 Client 不以 `logs.add` 为主要入口

Client Extension 技术上可以调用公开日志 ingest API，但它不适合作为本地运行日志入口：

1. Server 断开时，Client 仍需要记录“Server 断开”；
2. 每条日志一次 RPC 会产生不必要的延迟和流量；
3. Client 不能自行声明可信 `service/namespace/extensionId`；
4. Browser Memory/Console 应先得到记录；
5. Host 需要统一脱敏、限流、批量上传和生命周期清理；
6. Transport 错误调用日志 API会形成递归依赖。

推荐路径：

```text
Client Extension
  -> host.logger
  -> Client Memory / Console
  -> optional Host-owned batch uploader
  -> authenticated Server ingest
```

未来如果提供 `logs.ingest`：

- 它面向 Host 批处理或外部客户端；
- Server 重写来源和身份字段；
- 记录标记真实 origin；
- 不能伪造 Server 权威日志；
- 必须有鉴权、限流、大小上限和保留策略。

### 6.3 Correlation 尚未解决

历史设计希望 Extension Logger 自动继承 `correlationId/callId`。当前 Extension Host 没有稳定的异步执行上下文传播，因此不能把它写成已实现事实。

候选方案：

- Server RPC dispatch 使用 Node `AsyncLocalStorage`；
- RPC handler context 提供调用级 scoped logger；
- Host Logger 提供受控 `withContext`，但不允许插件伪造任意 ID。

第一版可以先绑定 extension identity；correlation 方案需要与 RPC/权限上下文一并决定。

## 7. Package 与构建边界

### 7.1 SDK 用于 authoring，不等于 Host runtime

`@loom-studio/extension-sdk` 应提供：

- Manifest、Context、Capability 类型；
- `defineServerExtension` / `defineClientExtension`；
- TSDoc 与开发期校验；
- 尽可能少的运行时代码。

它不应该包含：

- Root Logger 或 Sinks；
- Kernel implementation；
- Studio Server singleton；
- React baseline；
- 隐式数据库访问；
- 宿主权限绕过。

### 7.2 当前 monorepo 示例的限制

当前 `extensions/example-echo/dist/index.js` 仍保留：

```ts
import { defineServerExtension } from '@loom-studio/extension-sdk'
```

它在仓库内能够运行，是因为 workspace link 可以解析该 package。这不能证明安装在独立目录中的第三方 Extension 一定可以解析宿主 package。

正式分发模型需要满足：

- Extension build artifact 自包含；
- SDK identity helper 被 bundle/tree-shake，或者成为明确的 Host external；
- 普通第三方依赖按 Extension package policy 打包；
- Client entry 是浏览器可加载 bundle；
- 不允许从 Loom Studio 内部源码 deep import；
- 安装检查能发现未解析的 `@loom-studio/*` runtime import。

在插件包格式和 Loader 未稳定前，不把当前 workspace 解析行为写成生态契约。

## 8. Identity、Permission 与 Provenance

Host 是未来鉴权的门，但鉴权不只等于用户 token。一次 Extension 调用至少可能包含：

```text
user identity
client identity
extension identity
runtime instance
capability grant
workspace/session scope
correlation/call chain
```

宿主必须生成或验证这些信息，不能信任 params 中同名字段。

Server Extension Host 当前已经在部分路径中注入：

- `ownerExtensionId`；
- Extension actor；
- RPC handler extension identity；
- registration ownership；
- Extension lifecycle state。

未来权限 enforcement 应建立在：

- Manifest capability declaration；
- 安装/启用时 grant；
- Host facade；
- owner tracking；
- typed RPC；
- Audit/Diagnostic；
- 必要的 Runtime isolation。

`roles` 仍然只是软标签，不能充当权限。

## 9. 当前事实与候选设计

### 9.1 当前已经实现

- Server `manifest.server.entry` 动态加载；
- `activate(ctx)`；
- Extension identity；
- RPC register/call；
- Document get/list/write/delete facade；
- Event emit；
- Diagnostics report；
- dispose callback；
- owner tracking 和 registration cleanup；
- declaration/registration mismatch degradation；
- `extension.loader` Host 生命周期日志。

### 9.2 尚未实现

- SDK `ctx.logger`；
- Base/Server/Client Host 正式类型拆分；
- Client Extension Host；
- Direct/Shadow/iframe/Worker runtime adapters；
- Virtual Module Import；
- 公开 `@loom-studio/api-client` package；
- 完整 authentication/capability enforcement；
- Client 日志 batch ingest；
- 自动 correlation 传播；
- worker/process isolation；
- 稳定第三方 Extension package format。

### 9.3 延期实施切片：Extension Document Transaction 与 History

原 Document Edit History 计划的原生编辑闭环已经完成，但 Extension Document Transaction 依赖更稳定的 Host Capability 和未来 Client Extension Host，因此转移到本讨论继续保留。

候选任务：

1. 在受控 Server Extension Document API 增加 transaction；
2. transaction 自动设置 `ownerExtensionId` 和 Extension actor；
3. Extension RPC mutation 继承可信 request correlation；
4. transaction 返回通用 MutationReceipt / changeset reference；
5. Client Extension Host 稳定后，提供受控 EditOperation 接入点；
6. 插件私有 Scratch 在 changed/revert 后自行失效或重建；
7. 外部副作用不能声明为已经被通用 Undo 恢复。

验证门槛：

- 一次修改多个 Extension-owned Documents 只产生一个 Changeset；
- 平台不理解插件 Schema 也能通过 Changeset 执行 Undo/Redo；
- owner、actor 和 correlation 正确；
- 插件私有存储和外部副作用不会被错误标记为已恢复。

本切片目前只是保留需求，不代表已经接受具体 SDK API。

## 10. 非目标

- 不把 Kernel object 暴露给 Extension；
- 不让 Client Extension 绕过 API 访问 Server 内部对象；
- 不为 Import 语法复制第二套 capability semantics；
- 不使用任意主窗口 `window.xx` 作为长期 Studio-facing contract；
- 不把 Shadow DOM 描述成安全沙箱；
- 不让 Extension 自行创建官方 Root Logger；
- 不让普通日志 ingest 伪造 Server 身份；
- 不在第一版建设 Module Federation 或复杂自定义 Loader；
- 不一次性暴露 filesystem、network、secrets 等所有未来能力。

## 11. 推荐演进顺序

```text
1. 以现有 activate(ctx) 稳定 Server capability contract
2. 把 Host 明确为 identity/permission gate
3. 为 Server Extension 增加受控 Logger capability
4. 确定 Extension artifact 的自包含构建规则
5. 建立 Client Extension Host 最小生命周期
6. 提供 host.api、host.logger 与一种 UI 挂载方式
7. 再扩展 Shadow DOM / iframe / Worker adapters
8. capability contract 稳定后评估 Virtual Module Import
9. 外部开发者需求明确后发布 typed API Client
```

## 12. 待确认事项

1. 公共命名最终使用 `ctx`、`host` 还是两者并存；
2. `@loom-studio/host` 是否作为虚拟 specifier，还是由 SDK 提供初始化后的 facade；
3. Server ESM 如何为独立 Extension 解析 Host external；
4. Extension artifact 是否要求单文件 bundle；
5. Client Direct/Shadow/iframe 三种 Runtime 的第一优先级；
6. Capability grant 写入 Manifest、安装记录还是独立权限 Store；
7. `host.logger` 的 event prefix 和 child namespace 规则；
8. RPC handler correlation 使用 AsyncLocalStorage 还是调用级 logger；
9. Client 日志是否默认持久化；
10. 外部 API Client 的身份是否允许代表 Extension、用户或自动化主体。

## 13. Document History

- 2026-07-23: Draft v0.1。收录 Host capability、Server/Client 边界、公开 API、Virtual Module、Client Runtime、Extension Logger、构建与权限讨论。
