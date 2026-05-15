# Loom Studio MVP 阶段门控开发计划

> **Status**: Draft v0.1（正式施工门控计划，2026-05-15）
> **Purpose**: 指导 Loom Studio MVP 从空仓库进入工程落地，明确每个阶段的构建范围、完成标准、review/test 方法，以及实现与既有架构文档冲突时的记录与回写机制。
> **Audience**: Studio Kernel、Runner、Extension Host、Client、工程基础设施实现者。
> **Related**:
> - [`studio-repository-engineering-v0.md`](studio-repository-engineering-v0.md)
> - [`studio-dependency-and-runtime-choices-v0.md`](studio-dependency-and-runtime-choices-v0.md)
> - [`studio-initial-package-api-v0.md`](studio-initial-package-api-v0.md)
> - [`studio-config-and-local-state-v0.md`](studio-config-and-local-state-v0.md)
> - [`../03-kernel/studio-kernel-public-surface-v0.md`](../03-kernel/studio-kernel-public-surface-v0.md)
> - [`../03-kernel/studio-rpc-methods-v0.md`](../03-kernel/studio-rpc-methods-v0.md)
> - [`../04-data/studio-document-store-engineering-v0.md`](../04-data/studio-document-store-engineering-v0.md)
> - [`../05-extensions/studio-extension-lifecycle-v0.md`](../05-extensions/studio-extension-lifecycle-v0.md)

---

## 0. 文档定位

本文不重复解释 Studio 是什么，也不重写白皮书。

本文只回答四个施工问题：

1. **先搭什么**；
2. **每一步做到什么程度算完成**；
3. **怎么 review / test**；
4. **实现过程中发现和白皮书、架构文档或 Loom Core 现状冲突时，怎么记录、反思、回写**。

本文是阶段门控计划，不是功能愿望清单。任何阶段没有通过 Build / Review / Test / Reflect，都不进入下一阶段。

---

## 1. 目标与非目标

### 1.1 目标

启动 Studio MVP 工程落地，建立一条最小但真实的端到端链路：

```text
Client
  -> Transport RPC
  -> Kernel
  -> Document Store / Event Bus / Diagnostics
  -> Loom Runner 或 Extension RPC
  -> Trace / Diagnostics 可见
  -> Client 展示结果
```

MVP 的目标是验证平台骨架，而不是做完整产品。

第一条验收链路必须证明：

- Studio Kernel 能作为 headless server 启动；
- Client 能通过 Transport 调用 Kernel RPC；
- Kernel 能读写 Document；
- Kernel 能调用 `loom.run`；
- `packages/loom-runner` 是唯一接触 `@loom/core` 的 Studio 包；
- Extension 能注册 RPC 并被调用；
- Trace / diagnostics 能被记录并在 Client 中看见；
- `system.introspect` 能暴露最小能力图。

### 1.2 非目标

MVP 阶段不做：

- 完整产品 UI；
- Provider Gateway；
- Tool Loop；
- MCP Bridge；
- Chat Runtime；
- Agent Runtime；
- 官方 chat / character / worldbook schema；
- marketplace；
- extension signature verification；
- complex capability security model；
- SQLite schema 优化；
- desktop bundle；
- streaming provider payload；
- 多 workspace 管理；
- 自动更新。

这些能力可以作为 Extension Pattern 或后续阶段出现，但不能进入 MVP Kernel contract。

---

## 2. 前提判断

### 2.1 Loom Core 当前足够支撑 MVP

当前 Studio MVP 只需要 Loom Core 提供：

- `Fragment[]`；
- `PassConfig[]`；
- 同步 Pass / Pipeline 执行；
- mutation-only trace；
- diagnostics；
- owner tracking。

MVP 不依赖 Core 提供：

- Promise content；
- content thunk；
- Resolve Barrier；
- Scope；
- Provider-neutral invocation schema；
- messages schema；
- capability validation runtime enforcement。

如果实现中发现必须依赖这些被移除能力，必须停下来走本文 §10 的冲突处理机制。

### 2.2 Studio 只通过 `packages/loom-runner` 接入 Core

依赖方向必须固定：

```text
packages/loom-runner -> @loom/core
packages/kernel      -> packages/loom-runner interface
apps/studio-server   -> packages/kernel
apps/studio-client   -> packages/client-bridge / packages/transport
```

禁止：

```text
packages/kernel      -> @loom/core
packages/extension-* -> @loom/core internal path
apps/studio-client   -> @loom/core
Document Store       -> @loom/core
Extension Host       -> @loom/core
```

### 2.3 Studio 先验证 Kernel / Runner / Trace / Client 闭环

MVP 优先验证平台闭环：

```text
RPC 可调用
Document 可写
Event 可订阅
Extension 可激活
Loom Runner 可执行
Trace / diagnostics 可见
Client 可操作
```

不先追求领域体验。

---

## 3. 阶段门控规则

每个阶段固定使用同一模板：

```md
### Build
本阶段要搭建的最小内容。

### Review
人工检查什么边界、命名、依赖方向。

### Test
自动测试和手动验证怎么做。

### Reflect
实现中暴露了哪些和白皮书、架构文档、Loom Core 现状的冲突。
```

每个阶段完成时必须留下阶段记录：

```text
docs/06-engineering/mvp-stage-notes/<stage-id>.md
```

阶段记录至少包含：

- build summary；
- review conclusion；
- test result；
- reflect notes；
- open conflicts；
- next-stage readiness。

如果该目录在阶段开始时不存在，由该阶段创建。

---

## 4. 阶段 0：仓库与工程骨架

### Build

搭建最小工程骨架：

```text
apps/
  studio-server/
  studio-client/
packages/
  shared/
  diagnostics/
  transport/
  document-store/
  extension-host/
  extension-sdk/
  client-bridge/
  trace-audit/
  loom-runner/
  kernel/
extensions/
  example-echo/
```

建立：

- `pnpm-workspace.yaml`；
- root `package.json`；
- root `tsconfig.base.json`；
- package-level `tsconfig.json`；
- Vitest 基础配置；
- ESLint / Prettier 基础配置；
- build / test / lint 脚本；
- 每个 package 的 `src/index.ts` public entry；
- `.gitignore` 包含 `.loomstudio-dev/`。

P0 只填最小 placeholder，不实现大功能。

### Review

人工检查：

- 是否符合 [`studio-repository-engineering-v0.md`](studio-repository-engineering-v0.md)；
- 是否只有 `packages/loom-runner` 允许未来依赖 `@loom/core`；
- package 命名是否统一使用 `extension-*` 而不是 `plugin-*`；
- 是否没有出现 `runtime`, `provider`, `tool`, `mcp`, `chat`, `messages` 作为 Kernel package 概念；
- 是否没有 deep import；
- public entry 是否统一为 `src/index.ts`。

### Test

自动验证：

```text
pnpm install
pnpm lint
pnpm test
pnpm build
```

P0 可以只有空测试，但命令必须可运行并失败语义清楚。

手动验证：

- `pnpm -r build` 能遍历所有 workspace package；
- `apps/studio-server` 和 `apps/studio-client` 可以暂时只输出 placeholder；
- `.loomstudio-dev/` 不进入 git。

### Reflect

记录：

- 实际 package 边界是否与文档冲突；
- 哪些 package 被证明过早；
- 哪些 package 缺失导致后续实现不自然；
- Node-compatible baseline 是否足够；
- 是否出现 Bun-first、framework-first、UI-first 的诱惑。

---

## 5. 阶段 1：Kernel 最小运行闭环

### Build

实现最小 Kernel 能力：

- `packages/transport`
  - JSON-RPC-like envelope types；
  - request / response / event message types；
  - serialized error type。

- `packages/diagnostics`
  - `Diagnostic` type；
  - in-memory diagnostics registry。

- `packages/document-store`
  - `DocumentRecord`；
  - in-memory backend；
  - `docs.get` / `docs.list` / `docs.write` / `docs.delete` 支撑所需 API；
  - version 单调递增；
  - tombstone delete。

- `packages/kernel`
  - `createKernel()`；
  - RPC registry；
  - Event bus；
  - `system.ping`；
  - `system.getInfo`；
  - `system.introspect` 最小返回；
  - `events.subscribe` / `events.unsubscribe`；
  - `diagnostics.list`；
  - docs RPC handlers。

- `apps/studio-server`
  - Node `http` + `ws`；
  - Transport dispatch 到 Kernel；
  - server start / stop script。

Capability 基础模型只做声明与 audit placeholder，不做复杂权限系统。

### Review

人工检查：

- Kernel public surface 是否仍符合 [`../03-kernel/studio-kernel-public-surface-v0.md`](../03-kernel/studio-kernel-public-surface-v0.md)；
- Kernel RPC 是否仍符合 [`../03-kernel/studio-rpc-methods-v0.md`](../03-kernel/studio-rpc-methods-v0.md)；
- `system.introspect` 是否存在；
- event name 是否使用 `docs.changed`；
- Document 是否使用 `content` / `ownerExtensionId`；
- Kernel 是否没有 `chat.send`、`provider.invoke`、`tool.call`、`agent.step`、`messages[]` 等业务 contract；
- Transport 是否不泄露本地绝对路径和 secrets。

### Test

自动测试：

- RPC registry 注册 / 查找 / 重复注册；
- `system.ping` round-trip；
- `system.getInfo` 不含业务能力；
- `system.introspect` 返回最小 namespaces / methods / events；
- Document create / update / list / delete；
- version 单调递增；
- tombstone 默认不在 list 中；
- `docs.changed` event 发出；
- malformed request 返回 serialized error。

手动验证：

- 启动 `apps/studio-server`；
- 用 headless client 或脚本调用：
  - `system.ping`；
  - `system.introspect`；
  - `docs.write`；
  - `docs.list`。

### Reflect

记录：

- Kernel method 是否太多或太少；
- Document Store interface 是否暴露了不该暴露的持久化细节；
- Event payload 是否需要提前稳定；
- capability placeholder 是否已经影响 Extension 设计；
- 是否出现把 Runtime / Provider / Chat 便利方法塞进 Kernel 的压力。

---

## 6. 阶段 2：Loom Runner 集成

### Build

实现 `packages/loom-runner`：

- 依赖 `@loom/core`；
- 暴露 Studio-facing `LoomRunner` interface；
- 接收最小 `LoomRunInput`：
  - `fragments`；
  - `passes`；
  - `options?`；
  - `trace?`。
- 返回最小 `LoomRunOutput`：
  - `fragments`；
  - `traceId?`；
  - `diagnostics?`。

在 Kernel 中接入：

- `loom.run` RPC；
- 禁止 `messages`、`model`、`provider`、`tools`、`chatId`、`sessionId` 等字段进入 Kernel schema；
- trace persist failure 默认不阻塞业务返回；
- diagnostics 能通过 `diagnostics.list` 看见。

### Review

人工检查：

- 是否只有 `packages/loom-runner` import `@loom/core`；
- `loom.run` 是否仍是 `Fragment[] + PassConfig[] -> Fragment[] + Trace`；
- 是否没有 provider-neutral invocation schema；
- 是否没有官方 messages schema；
- Trace 是否是事实记录，不参与 rollback；
- `Trace.passConfigs` / diagnostics / correlation 是否足够 replay 和排查。

### Test

自动测试：

- 一个 no-op pass run；
- 一个 uppercase pass run；
- pass not found 返回 `loom.pass_not_found` 或等价错误；
- pass throw 产生 diagnostics；
- `loom.run` 拒绝或忽略禁止字段；
- trace enabled 时产生 trace id；
- trace persist failure 默认不使 `loom.run` failed；
- strict persist option 显式开启时可 fail。

手动验证：

- 通过 RPC 调 `loom.run`；
- 输入 1 个 fragment；
- 执行 1 个简单 pass；
- 在 Document / diagnostics / trace 视图中看到结果。

### Reflect

记录：

- Loom Core API 与 Studio Runner 预期是否不一致；
- Core trace shape 是否足够 Studio 展示；
- owner tracking 是否产生可理解 diagnostics；
- 是否需要修改 Loom Core 文档或 Studio Runner 文档；
- 是否出现把 Runtime payload 塞进 `loom.run` 的需求。

---

## 7. 阶段 3：Extension 最小闭环

### Build

实现最小 Extension Host：

- manifest parser；
- manifest validation；
- local extension discovery；
- server entry activation；
- activation context `ctx`；
- `ctx.rpc.register`；
- `ctx.events.emit`；
- `ctx.documents` 最小访问能力；
- `ctx.diagnostics`；
- extension dispose；
- registry fact 记录 `ownerExtensionId`。

实现 `extensions/example-echo`：

- `manifest.json`；
- server entry；
- 注册 `example.echo.echo` RPC；
- 可选注册一个 document type；
- 可选发出一个 event。

Capability 校验 MVP：

- manifest 中声明 capability；
- Host 激活时记录声明；
- RPC / docs write boundary 能识别 owner；
- 未声明能力先产生 diagnostic，不做复杂 enforcement。

### Review

人工检查：

- Manifest 是否符合 [`../05-extensions/studio-extension-manifest-architecture.md`](../05-extensions/studio-extension-manifest-architecture.md)；
- Lifecycle 是否符合 [`../05-extensions/studio-extension-lifecycle-v0.md`](../05-extensions/studio-extension-lifecycle-v0.md)；
- `contributes` 是否在顶层；
- `client.entry` / `server.entry` 命名是否正确；
- `engines.studio` 是否必填；
- `engines.loom` 是否只在需要 Loom ABI 时出现；
- Extension 是否不能覆盖 Kernel namespace；
- Extension 是否拿不到整张 RPC map；
- Extension 间调用是否只能通过 `ctx.callRpc` / `host.callRpc`。

### Test

自动测试：

- manifest required fields validation；
- invalid manifest diagnostic；
- duplicate RPC registration conflict；
- extension activation success；
- extension activation failure degraded / disabled；
- `example.echo.echo` RPC round-trip；
- extension dispose 清理注册物；
- `extensions.list` 返回 state；
- `extensions.getDiagnostics` 返回 extension diagnostics。

手动验证：

- 启动 server 自动发现 `extensions/example-echo`；
- 调用 `extensions.list`；
- 调用 `example.echo.echo`；
- 调用 `system.introspect`，确认能看到 extension RPC。

### Reflect

记录：

- Manifest 是否过重；
- activation context 是否过宽；
- capability model 是否阻碍本地开发；
- Extension Host 是否泄露 Kernel 私有对象；
- `roles` 是否被误用于权限 / dispatch / 加载；
- 是否需要回写 Manifest 或 lifecycle 文档。

---

## 8. 阶段 4：Studio Client 最小可视化

### Build

实现 `apps/studio-client` 最小操作台。

只做：

- 连接 server；
- 调用 `system.ping`；
- 展示 `system.getInfo`；
- 展示 `system.introspect`；
- Document list / detail；
- 手动 `docs.write` 一个 JSON Document；
- 手动触发 `loom.run`；
- 手动调用 `example.echo.echo`；
- 展示 run result；
- 展示 diagnostics；
- 展示 trace summary。

UI 方案：

- React + Vite；
- CSS Modules + CSS Custom Properties；
- 不引入大型组件库；
- 不做完整产品布局；
- 不做 Chat UI。

### Review

人工检查：

- Client 是否只通过 Transport / Client Bridge 调 Kernel；
- Client 是否没有 import Kernel internals；
- Client 是否没有假设 Chat / messages schema；
- Client 是否没有通过任意 `window.xx` 暴露 Studio-facing API；
- UI 是否只是操作台，不诱导产品化范围膨胀；
- CSS token 是否保留后续 Extension / theme 扩展空间。

### Test

自动测试：

- client bridge request / response；
- error response display；
- diagnostics display；
- document list render；
- run result render。

手动验证：

- 打开 client；
- 连接 local server；
- 写入 document；
- 调用 `loom.run`；
- 调用 `example.echo.echo`；
- 页面能看到 result / diagnostics / trace summary。

### Reflect

记录：

- Client Bridge 是否足够；
- Transport schema 是否过于底层或过于宽松；
- Trace summary 是否需要调整 trace shape；
- UI 是否暴露出 Kernel introspection 不足；
- 是否出现需要 Client Extension Panel API 的真实压力。

---

## 9. 阶段 5：MVP 总体验收

### Build

完成一条端到端验收链路：

```text
apps/studio-client
  -> system.introspect
  -> docs.write
  -> example.echo.echo 或 loom.run
  -> Kernel 调度
  -> Extension Host 或 Loom Runner 执行
  -> trace / diagnostics 写入
  -> docs.changed / diagnostics.updated event
  -> Client 展示结果
```

补齐阶段文档：

```text
docs/06-engineering/mvp-stage-notes/stage-0.md
docs/06-engineering/mvp-stage-notes/stage-1.md
docs/06-engineering/mvp-stage-notes/stage-2.md
docs/06-engineering/mvp-stage-notes/stage-3.md
docs/06-engineering/mvp-stage-notes/stage-4.md
docs/06-engineering/mvp-stage-notes/stage-5.md
```

### Review

总体验收检查：

- Kernel 没有 Runtime / Provider / Tool / MCP / Chat / messages[] contract；
- `system.introspect` 能发现 Kernel 与 Extension 注册物；
- Document model 使用 `content` / `ownerExtensionId`；
- events 使用 `docs.changed`；
- Extension Host 不泄露整张 RPC map；
- `packages/loom-runner` 是唯一 Core 接入点；
- Client 只走 Transport；
- Trace / Audit 是事实记录，不参与 rollback；
- `.loomstudio-dev/` 不进 git；
- 所有 public exports 走 `src/index.ts`。

### Test

自动测试：

```text
pnpm lint
pnpm test
pnpm build
```

端到端测试至少覆盖：

- server start；
- client / headless client ping；
- docs write + docs list；
- event subscription；
- extension echo RPC；
- loom.run；
- diagnostics list；
- introspection；
- no forbidden Kernel API snapshot。

手动验收：

- 从 Client 完成一次 Extension RPC 调用；
- 从 Client 完成一次 `loom.run`；
- 在 Client 中看到 Document / run result / trace / diagnostics。

### Reflect

完成 MVP 冲突清单：

```text
docs/06-engineering/mvp-stage-notes/conflicts.md
```

该文件必须列出：

- 已发现冲突；
- 已处理冲突；
- 延后冲突；
- 废弃设计；
- 需要回写的文档；
- 需要新增 ADR 的候选。

---

## 10. 白皮书冲突处理机制

### 10.1 冲突类型

实现中发现的冲突分为四类：

1. **设计不完整**
   - 文档方向正确，但缺少足够实现细节。

2. **实现成本过高**
   - 文档设计可行，但超出 MVP 成本，需要降级或切片。

3. **接口边界错误**
   - 某能力被放错层，例如进入 Kernel 后污染 Runtime / Provider / Tool 边界。

4. **概念需要拆分**
   - 一个概念承担了多个职责，需要拆成 Kernel primitive、Extension Pattern、Client convention 或 DevTool 能力。

### 10.2 冲突记录格式

每个冲突必须记录：

```md
## CONFLICT-<number>: <short title>

- **发现阶段**: Stage N
- **发现位置**: PR / commit / file / test
- **原文依据**: 相关文档路径与段落
- **实际问题**: 实现中为什么接不上
- **冲突类型**: 设计不完整 / 实现成本过高 / 接口边界错误 / 概念需要拆分
- **影响范围**: Kernel / Runner / Extension / Client / Data / Docs
- **处理建议**: 改代码 / 改文档 / 延后 / 废弃
- **决策结果**: Accepted / Deferred / Rejected
- **回写位置**: 需要修改的文档或 ADR
```

### 10.3 决策结果

每个冲突只能有四种结果：

| 结果 | 含义 |
|---|---|
| 改代码 | 文档正确，实现偏离，修实现 |
| 改文档 | 实现证明文档错误或过时，修文档 |
| 延后 | 问题真实，但不是 MVP 阶段必须解决 |
| 废弃 | 原设计不再成立，明确废弃并说明替代方案 |

### 10.4 回写规则

- 如果冲突影响 Core contract，优先回写 Loom Core 文档或新增 ADR；
- 如果冲突影响 Studio Kernel contract，回写 `docs/03-kernel/`；
- 如果冲突影响 Document / Trace / Audit，回写 `docs/04-data/`；
- 如果冲突影响 Extension contract，回写 `docs/05-extensions/`；
- 如果冲突只影响工程骨架或依赖，回写 `docs/06-engineering/`；
- 如果只是实现 note，不改变决策，记录到 stage notes 即可。

---

## 11. MVP 完成定义

Studio MVP 只有在同时满足以下条件时才算完成：

1. 工程能安装、构建、测试：
   - `pnpm install`
   - `pnpm lint`
   - `pnpm test`
   - `pnpm build`

2. Kernel / Runner / Extension / Client 有一条端到端链路：
   - Client 能调用 Kernel RPC；
   - Kernel 能读写 Document；
   - Kernel 能执行 `loom.run`；
   - Kernel 能激活 Extension；
   - Client 能调用 Extension RPC；
   - Trace / diagnostics 可见。

3. Kernel contract 没有越界：
   - 无 Chat Runtime；
   - 无 Agent Runtime；
   - 无 Provider Gateway；
   - 无 Tool Loop；
   - 无 MCP Bridge；
   - 无 official `messages[]` schema。

4. 每个阶段都有 Review / Test / Reflect 结论。

5. 白皮书 / 架构冲突有明确处理状态：
   - 已改代码；
   - 已改文档；
   - 已延后；
   - 已废弃。

6. 下一阶段工作可以从事实出发，而不是从宏大架构猜测出发。

---

## 12. Document History

- 2026-05-15: Draft v0.1. 新增 MVP 阶段门控开发计划，定义 Stage 0~5 的 Build / Review / Test / Reflect，以及白皮书冲突处理机制。
