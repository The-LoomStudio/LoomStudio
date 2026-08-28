# ADR-002: Extension Manifest 与 Runtime Registration 边界

- **Status**: Superseded
- **Date**: 2026-05-13
- **Related**:
  - [`ADR-006-extension-package-module-instance-model.md`](ADR-006-extension-package-module-instance-model.md)
  - [`../05-extensions/studio-extension-manifest-architecture.md`](../../archive/discussion/extensions/studio-extension-manifest-architecture.md)
  - [`../06-engineering/loom-studio-mvp-engineering.md`](../../archive/discussion/loom-studio-mvp-engineering.md)
  - [`ADR-001-data-layer-workspace-sync.md`](ADR-001-data-layer-workspace-sync.md)

## Context

> 本 ADR 的 Manifest v1 与“Full Extension = Server + Client”模型已被 ADR-006 取代。本文保留为历史决策记录，不再描述当前实现事实。

Loom Studio 的定位是本地优先的 Extension 工作台，而不是内置 Chat / Agent / Provider / Tool / MCP 业务框架。

Studio Kernel 需要提供稳定、克制的能力底座：Document Store、Extension Host、RPC、Events、Trace、Audit、Loom Runner、Diagnostics 与 Introspection。Runtime、Provider、Tool、MCP Bridge、Concept Stack、Workspace Adapter 等能力都应作为 Extension Pattern 出现。

这要求 Extension Manifest 同时满足两类目标：

1. 为安装、兼容性检查、插件管理器、市场、静态能力索引提供足够信息；
2. 不把 Manifest 设计成沉重、重复、业务化的配置系统。

如果 Manifest 过早承担过多职责，会出现几个问题：

- 普通 Extension 作者需要填写大量与代码重复的字段；
- Runtime / Provider / Tool 等业务语义被误固化为 Kernel contract；
- `roles` 被滥用为权限、加载顺序或 dispatch 依据；
- Client Extension 可能绕过 Host Bridge，通过主窗口全局对象暴露不受控 API；
- 子生态需要扩展元信息时，只能污染核心字段。

因此，本 ADR 决定 Manifest 与 runtime registration 的职责边界，以及 Server / Client Extension 的最小工程模型。

## Decision

### 1. Manifest 是静态安装描述和能力索引

Manifest 的职责是描述 Extension 的静态 contract：

- identity；
- compatibility；
- server / client entrypoints；
- capability / permission declaration；
- dependencies / conflicts declaration（MVP 后逐步实现）；
- static contribution index；
- plugin manager / marketplace metadata；
- namespaced child ecosystem metadata。

Manifest 不负责：

- 实现 RPC handler；
- 保存用户设置；
- 保存 API key / token / credential；
- 保存 Runtime 业务状态；
- 替代 Document Store；
- 替代 runtime registration；
- 定义官方 Chat / Agent / Provider / Tool 协议。

核心规则：

```text
Manifest declaration is contract.
Runtime registration is truth.
```

### 2. Server / Client 是唯一硬工程边界

Extension 在工程形态上只硬区分：

```text
Server Extension
Client Extension
Full Extension = Server + Client
```

该边界影响：

- 运行位置；
- 加载方式；
- 隔离方式；
- 生命周期；
- 可用 Host API；
- 是否能注册后端 RPC / document types / events 等 public capabilities。

以下概念不作为硬插件类型：

```text
runtime
provider
tool
MCP bridge
concept stack
workspace adapter
devtool panel
theme
extension pack
```

它们只通过 `roles` / `contributes` 表达。

### 3. `roles` 是软标签，不参与核心语义

`roles` 只用于插件管理器展示、搜索、分类和生态发现。

`roles` 不能用于：

- 权限判断；
- RPC dispatch；
- Extension 加载顺序；
- Document ownership；
- capability enforcement；
- dependency resolution。

真实能力必须来自 `contributes` 静态声明和 activation 后的 runtime registration。

### 4. Manifest 必填字段保持最小

MVP Manifest 最小必填字段为：

```json
{
  "manifestVersion": 1,
  "id": "example.hello",
  "version": "0.1.0",
  "displayName": "Hello Extension",
  "engines": {
    "studio": "^0.1.0"
  }
}
```

如果 Extension 有 server entry，则声明：

```json
{
  "server": {
    "entry": "./dist/server.js"
  }
}
```

如果 Extension 有 client entry，则声明：

```json
{
  "client": {
    "entry": "./dist/client.js"
  }
}
```

`engines.studio` 必填。

`server.engines.node` 可选。Studio 平台以 Node-compatible baseline 为默认目标，Bun 可以作为可选加速路径，但不成为 Extension 生态的强制运行时契约。

### 5. `contributes` 只声明实际贡献，不写空数组

Manifest 不要求列出空贡献点。

推荐：

```json
{
  "contributes": {
    "rpc": [
      { "name": "example.hello.sayHello" }
    ]
  }
}
```

不推荐：

```json
{
  "contributes": {
    "rpc": [],
    "documentTypes": [],
    "events": [],
    "commands": [],
    "panels": [],
    "conceptStacks": [],
    "workspaceAdapters": []
  }
}
```

MVP 允许的核心 contribution categories：

- `rpc`：公开 RPC 静态索引；
- `documentTypes`：typed JSON Document 类型、ownership、schema/introspection/migration 入口；
- `events`：该 Extension 可能发布的 public events；
- `commands`：用户可触发动作，不等同于 RPC；
- `panels`：Client Extension UI 面板；
- `conceptStacks`：项目语义、compile/project/import-export 规则提供者；
- `workspaceAdapters`：Dev Workspace layout/import/export/validate/build 映射提供者。

### 6. Public capability 必须通过 activation 动态注册

Server Extension 的公开能力采用：

```text
Manifest 静态声明 + activate(ctx) 动态注册
```

流程：

```text
1. Studio 读取 manifest。
2. Extension Host 校验 manifest 基本字段、engine range、entrypoints。
3. Extension Host 加载 server entry。
4. Extension 调用 activate(ctx)。
5. Extension 通过 ctx 注册 RPC / document types / events / commands 等能力。
6. Extension Host 记录注册物 owner = extensionId。
7. Extension Host 对比 manifest declaration 与 runtime registration。
8. 根据一致性标记 active / degraded / disabled，并写入 diagnostics。
```

这避免 Manifest 声明了不存在的 handler，也避免代码动态注册了未公开声明的 public API 而没有静态索引。

### 7. Dev Mode 与 Published Mode 严格度不同

Dev Mode：

- 允许 runtime registration 暂时超前于 Manifest；
- 必须产生 diagnostics；
- 工具可以提供 `ext inspect` / `ext sync-manifest` / `ext validate` 之类流程，从动态注册结果生成或同步 Manifest。

Published / Signed Mode：

- public runtime registrations 必须是 Manifest declaration 的子集；
- 未声明的 public capability 应被拒绝或导致 Extension degraded / disabled；
- Manifest 声明但 activation 未注册成功的能力必须产生 diagnostics。

MVP 可以先实现 Dev Mode 宽松检查，但 registry 数据结构必须保留 owner 与 declaration/registration 对比能力。

### 8. Client Extension 使用 Client Host Bridge

Client Extension 不应通过主窗口任意 `window.xx` 暴露 Studio-facing API。

允许的入口约定可以是 sandbox 内的窄入口，例如：

```text
window.LoomClientExtension.activate(ctx)
```

或 ESM 形式：

```ts
export default defineClientExtension({
  activate(ctx) {
    // use Client Host Bridge
  }
})
```

Client Extension 访问 Studio 能力必须经过 Client Host Bridge / sandbox activation context。Bridge 只暴露受控 Host API，例如 command invocation、panel state、RPC call、event subscription、diagnostics display 等。

Bridge 不重新封装资源 CRUD。Card、Preset、Setting Layer、Session 等完整数据读取与持久化写入优先复用 typed RPC；activation context 只承载插件生命周期、宿主轻量快照、权限、UI 扩展点、diagnostics 与 scoped RPC。

### 9. `meta` 开放但必须 namespaced

Manifest 可以提供开放 `meta` 字段，服务子级生态、市场、迁移工具或外部兼容层。

规则：

- `meta` 下的 key 必须 namespaced，例如 `sillytavern.*`、`marketplace.*`、`vendor.example.*`；
- Studio Core 必须 preserve unknown meta；
- `meta` 不参与核心加载、权限、依赖、冲突、entrypoint、dispatch 语义；
- 如果某字段需要被 Studio Core 解释，它不应放在 `meta`。

### 10. 不把 Runtime / Provider / Tool / MCP 固化进 Kernel Manifest 类型

Manifest 可以声明一个 Extension 贡献了某些 RPC、Concept Stack、Workspace Adapter 或 UI Panel；也可以用 `roles` 标注它是 `runtime`、`provider`、`tool` 或 `mcp-bridge`。

但 Kernel 不因此获得以下 contract：

- 官方 `messages[]` schema；
- provider-neutral invocation schema；
- Agent runtime protocol；
- Tool loop protocol；
- MCP bridge architecture；
- Chat Runtime 内置生命周期。

这些可以在官方 Extension 或 conventions 文档中逐步形成，但不是 Kernel Manifest 的核心语义。

## Consequences

### Positive

- Manifest 保持轻量，普通 Extension 作者上手成本低；
- Studio Kernel 不被 Runtime / Provider / Tool / MCP 业务语义污染；
- Server / Client 边界清晰，后续隔离与权限模型有稳定落点；
- runtime registration 提供真实能力表，避免只看 Manifest 导致假能力；
- Dev Mode 支持从代码生成 Manifest，降低重复维护成本；
- 子级生态可以通过 namespaced `meta` 扩展，而不污染核心字段。

### Negative / Trade-offs

- Extension Host 需要维护 declaration 与 registration 的对比逻辑；
- Dev Mode 与 Published Mode 存在两套严格度，诊断信息必须清晰；
- 插件管理器不能仅凭 `roles` 做能力判断，需要读取 `contributes` 与 registry；
- MVP 需要先定义 registry owner、diagnostics、activation failure 的最小模型。

### Risks

- 如果 diagnostics 做得不清楚，作者可能不理解 Manifest 与 runtime registration 不一致的原因；
- 如果 `meta` 滥用，生态仍可能形成事实上的隐式核心字段；
- 如果后续官方 Provider / Runtime conventions 设计过重，仍可能反向侵蚀 Kernel 边界。

## Rejected Alternatives

### A. 为 Runtime / Provider / Tool / MCP 定义硬插件类型

拒绝。

这些是能力模式，不是工程加载边界。硬类型会迫使 Kernel 理解业务语义，并阻碍一个 Extension 同时提供 Provider、设置面板、diagnostics、workspace adapter 等组合能力。

### B. 只依赖 Manifest，不做 runtime registration

拒绝。

Manifest 不能证明 handler 真实存在，也不能表达 activation 失败、环境缺失、动态资源不可用等运行时事实。

### C. 只依赖 runtime registration，不写 Manifest contributes

拒绝。

这会损害安装前检查、插件管理器展示、市场索引、权限预审、静态文档生成和 Published Mode 安全边界。

### D. 使用 `roles` 进行权限和 dispatch

拒绝。

`roles` 是软标签，语义不稳定。权限和 dispatch 必须基于明确的 capability declaration、contributes 与 runtime registration。

### E. 让 Client Extension 直接挂载任意主窗口 API

拒绝。

这会破坏隔离边界，增加全局命名冲突，难以审计，也不利于未来 iframe / worker / webview / remote UI 等隔离策略。

## Implementation Notes for MVP

第一批实现只需要支持窄子集：

1. 读取 `manifestVersion`、`id`、`version`、`displayName`、`engines.studio`；
2. 读取可选 `server.entry`、`client.entry`；
3. 读取可选 `roles`、`contributes.rpc`、`contributes.documentTypes`、`contributes.events`；
4. 加载 server entry 并调用 `activate(ctx)`；
5. 支持 `ctx.rpc.register(name, handler, options?)` 的 owner tracking；
6. 记录 manifest declaration 与 runtime registration 的 mismatch diagnostics；
7. preserve unknown fields and namespaced `meta`。

暂不实现：

- 完整 marketplace schema；
- 完整 dependency / conflict resolver；
- SAT solver；
- 签名与发布验证；
- worker / process isolation enforcement；
- 完整 Client Panel API；
- Provider / Runtime / Tool / MCP 官方协议。

## Open Questions

- Published / Signed Mode 的具体签名格式何时定义？
- dependency / conflict resolver 的最小可用范围应放在哪个版本？
- Client Host Bridge 的第一版 API 是否应独立成文档？
- `contributes.commands` 与 `contributes.rpc` 的 UI 映射关系何时落地？

## Document History

- 2026-05-13: Accepted v0.1. 从 Manifest 架构讨论稿收敛为 ADR，锁定 Server/Client 硬边界、roles/contributes/runtime registration/meta 规则。
