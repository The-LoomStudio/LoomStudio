# Loom Studio Repository Engineering v0

> **Status**: Draft v0.2（纯工程骨架，2026-05-14）
> **Purpose**: 只锁定 Loom Studio 第一版仓库形态、目录规则、package 边界、前后端组织、FSD 适用范围、命名规则与 Loom Core 依赖边界。
> **Audience**: Studio Kernel / Client / Extension Host / DevTool 实现者，未来 Extension SDK 维护者。
> **2026-08-15 路径替代说明**：本文中的 `.loomstudio-dev/projects/<project-id>`、workspace-local Extension scratch 与 per-project runtime 目录属于早期工程草图，不再作为后续实现依据。本地结构化数据、Blob、Extension、Cache 与 Log 路径统一见 [`../plans/local-data-blob-store-foundation-plan.md`](../plans/local-data-blob-store-foundation-plan.md)。
> **Related**:
>
> - [`loom-studio-mvp-engineering.md`](loom-studio-mvp-engineering.md)
> - [`kernel/studio-transport-protocol-v0.md`](kernel/studio-transport-protocol-v0.md)
> - [`extensions/studio-extension-lifecycle-v0.md`](extensions/studio-extension-lifecycle-v0.md)
> - [`data/studio-document-store-engineering-v0.md`](data/studio-document-store-engineering-v0.md)
> - [`data/studio-trace-audit-correlation-v0.md`](data/studio-trace-audit-correlation-v0.md)

---

## 0. 本文解决什么问题

本文只讨论 Loom Studio 的**仓库骨架**，不讨论依赖填充物。

它锁定：

1. 仓库用什么结构；
2. `apps/`、`packages/`、`extensions/` 如何分类；
3. 前后端怎么放；
4. 是否使用 FSD，以及 FSD 只用于哪里；
5. 第一批 package 边界；
6. 文件夹与文件命名规则；
7. package import 方向；
8. Loom Core 的依赖边界；
9. 第一批骨架 PR 如何切。

本文刻意不讨论：

- CSS 方案；
- React / Vite / TypeScript / ESLint / Prettier / Vitest 等具体依赖；
- server framework；
- UI component library；
- 状态管理库；
- SQLite / in-memory backend 先后；
- 具体 `package.json` 依赖版本。

这些放入后续单独文档：

```text
docs/studio-dependency-and-runtime-choices-v0.md
```

---

## 1. 总体骨架决策

| 问题                 | 决策                                                               |
| -------------------- | ------------------------------------------------------------------ |
| 仓库形态             | workspace monorepo                                                 |
| 顶层分类             | `apps/`、`packages/`、`extensions/`、`docs/`、`scripts/`、`tests/` |
| 前端位置             | `apps/studio-client`                                               |
| 后端位置             | `apps/studio-server`                                               |
| 平台能力             | `packages/*`                                                       |
| 官方/示例插件        | `extensions/*`                                                     |
| Client 架构          | Client 内部使用 FSD                                                |
| 全仓库 FSD           | 不使用                                                             |
| 文件夹命名           | kebab-case                                                         |
| 文件命名             | kebab-case                                                         |
| package public entry | `src/index.ts`                                                     |
| package 间 import    | 只能通过 public entry                                              |
| Loom Core 依赖       | 只允许 `packages/loom-runner` 依赖 Core                            |

---

## 2. 仓库结构

第一版仓库结构：

```text
LoomStudio/
├── apps/
│   ├── studio-server/
│   │   ├── src/
│   │   │   └── main.ts
│   │   └── package.json
│   │
│   └── studio-client/
│       ├── src/
│       │   ├── app/
│       │   ├── pages/
│       │   ├── widgets/
│       │   ├── features/
│       │   ├── entities/
│       │   ├── shared/
│       │   └── main.tsx
│       ├── index.html
│       └── package.json
│
├── packages/
│   ├── shared/
│   ├── diagnostics/
│   ├── transport/
│   ├── document-store/
│   ├── extension-host/
│   ├── extension-sdk/
│   ├── client-bridge/
│   ├── trace-audit/
│   ├── loom-runner/
│   └── kernel/
│
├── extensions/
│   └── example-echo/
│
├── docs/
├── scripts/
├── tests/
├── package.json
├── workspace config files
└── tool config files
```

说明：

- `workspace config files` 指工作区配置文件，具体使用 pnpm / npm / other workspace 由依赖选型文档决定；
- `tool config files` 指 TypeScript、lint、format、test 等工具配置，具体工具由依赖选型文档决定；
- 本文只锁定这些配置文件位于仓库根部，不锁定具体工具内容。

---

## 3. 顶层目录分类规则

| Directory     | Rule                                                |
| ------------- | --------------------------------------------------- |
| `apps/`       | 可运行应用，例如 server、client、未来 desktop / cli |
| `packages/`   | 平台库，不直接作为产品入口运行                      |
| `extensions/` | 官方或示例 Extension                                |
| `docs/`       | 架构文档、ADR、工程规格                             |
| `scripts/`    | 仓库维护脚本，不放业务逻辑                          |
| `tests/`      | 跨包 integration tests；单包测试放包内              |

### 3.1 数据层不使用业务根目录

仓库骨架不创建这些顶层目录：

```text
user/
users/
chat/
worldbook/
world/
characters/
concept-stacks/
```

原因：这些都是 **Concept Stack 或具体 Extension 的业务语义**，不是 Studio 仓库骨架语义。

Studio 平台层只承认：

```text
Document Store
Document type
Document content
ownerExtensionId
Revision / Changeset / Checkpoint
Trace / Audit / Diagnostics
```

因此数据层在仓库里的位置是：

| Concern                                   | Repository place                                               | Runtime / local-state place                                                                   |
| ----------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Document Store interface / memory backend | `packages/document-store/`                                     | `.loomstudio-dev/projects/<project-id>/`                                                      |
| Trace / Audit store abstraction           | `packages/trace-audit/`                                        | `.loomstudio-dev/projects/<project-id>/traces`, `.loomstudio-dev/projects/<project-id>/audit` |
| Kernel-owned system documents             | `packages/kernel/` handlers + `packages/document-store/` types | Document Store 中的 `system.*` document types                                                 |
| Extension-owned documents                 | Extension 通过 `contributes.documentTypes` 声明                | Document Store 中的 extension-owned document types                                            |
| Extension scratch / cache / index         | Extension 自己的代码                                           | `.loomstudio-dev/extensions/` 或未来 workspace `extensions/scratch/`                          |

`user` 不作为仓库根目录。若未来需要用户 profile / actor / account 语义，应表现为 Document type，例如 `system.user-profile` 或某个 Extension 声明的 `example.account.profile`，而不是顶层文件夹。

### 3.2 Concept Stack 数据命名规则

不同 Concept Stack 可以声明相似概念，例如：

```text
SillyTavern-compatible stack: chat, worldbook, character, preset
World simulation stack: chat, world, actor, location
```

这些概念不能直接占用裸 type 名：

```text
chat
worldbook
world
```

Document type 必须带 owner / stack namespace，推荐形态：

```text
<extension-id>.<domain>.<kind>
```

示例：

```text
official.st.chat.session
official.st.chat.message
official.st.worldbook.entry
official.st.character.card

example.world.chat.thread
example.world.world.state
example.world.location.node
```

如果两个 Concept Stack 都有 `chat`，它们仍然是不同 document types：

```text
official.st.chat.session
example.world.chat.thread
```

Kernel 不理解这两个 type 的业务含义，也不提供跨 type 外键。跨文档关系由各自 Extension 在 `content` 中保存引用，并通过自己的 RPC / compile pipeline 解释。

### 3.3 SQLite 分块不是仓库骨架决策

MVP P0 先实现 in-memory backend；持久化目标是 SQL-backed Document Store。

是否按 Concept Stack 拆分 SQLite 文件、按 workspace 拆库、按 document type 分表，属于 Document Store backend 实现策略，不属于仓库骨架。

默认逻辑模型应先保持单一 Project Document Store：

```text
.loomstudio-dev/projects/<project-id>/workspace.db
```

在逻辑层用 `type`、`ownerExtensionId`、`source`、`changesetId`、`traceId` 区分来源和归属，而不是第一版就物理拆成多个 SQLite。

只有出现明确需求时才考虑物理分块，例如：

- 某个 Extension 的 scratch index 体积巨大；
- 某个 Concept Stack 需要可删除 / 可重建的派生数据库；
- 用户需要按 stack 导出独立 operational snapshot；
- SQLite vacuum / migration 成本成为真实瓶颈。

即便发生物理分块，也不能改变 Kernel-facing Document Store contract。Kernel 仍只看到统一的 Document Store interface。

不采用：

```text
src/server
src/client
src/shared
```

原因：Studio 的关键风险不是文件数量，而是边界污染。Monorepo package boundary 可以用 package exports、TS path、lint rule 或 workspace 约束 import 方向。

---

## 4. Apps

### 4.1 `apps/studio-server`

职责：

- 创建 Kernel；
- 挂载 Transport；
- 连接 Document Store backend；
- 加载 builtin / local extensions；
- 启动本地 server app。

不负责：

- 定义 Kernel 类型；
- 实现 Document Store 核心接口；
- 实现 Extension Host 核心逻辑；
- 实现 Chat / Runtime / Provider / Tool / MCP 业务协议。

第一版入口形态：

```text
apps/studio-server/src/main.ts
```

### 4.2 `apps/studio-client`

职责：

- Studio UI；
- 初始化 Client Bridge；
- 组织 pages / widgets / features / entities；
- 展示 diagnostics、documents、extensions、trace/audit 等工作台视图。

不负责：

- 直接 import Kernel；
- 直接 import Document Store implementation；
- 直接调用 Extension server implementation；
- 绕过 Client Bridge 访问 Studio Host 能力。

---

## 5. Client FSD 规则

`apps/studio-client/src` 使用 Feature-Sliced Design：

```text
src/
├── app/
├── pages/
├── widgets/
├── features/
├── entities/
├── shared/
└── main.tsx
```

推荐含义：

| Layer       | 用途                                                              |
| ----------- | ----------------------------------------------------------------- |
| `app/`      | app bootstrap、providers、routing、layout shell                   |
| `pages/`    | 页面级组合，例如 workspace、extensions、diagnostics               |
| `widgets/`  | 复合 UI 区块，例如 document explorer、diagnostics panel           |
| `features/` | 用户动作，例如 write document、enable extension、subscribe events |
| `entities/` | 领域实体视图与 model，例如 document、extension、diagnostic、trace |
| `shared/`   | client-only UI primitives、lib、utility                           |

规则：

- FSD 只用于 client；
- `apps/studio-client/src/shared` 是 client-local shared，不等同于 `packages/shared`；
- Client FSD layer 不应 import server app；
- Client FSD layer 不应 import kernel internals。

---

## 6. Packages 不使用 FSD

Server packages 按 capability / bounded context 组织，不使用 `features/entities/shared`。

示例：

```text
packages/kernel/src/
├── create-kernel.ts
├── kernel.ts
├── rpc/
├── events/
├── extensions/
├── documents/
├── diagnostics/
├── trace/
└── index.ts
```

原因：

- Kernel、Transport、Document Store、Extension Host 是平台能力，不是前端功能切片；
- 强套 FSD 会模糊 capability 边界；
- package 本身已经是 bounded context，不需要再用前端分层术语重包一层。

---

## 7. 第一批 Packages

### 7.1 `packages/shared`

定位：跨包基础类型与极小工具。

规则：

```text
能放具体 package，就不要放 shared。
```

`shared` 不应成为垃圾桶。

### 7.2 `packages/diagnostics`

定位：Diagnostics 类型与 registry 边界。

服务对象：Kernel、Transport、Extension Host、Document Store、Client UI。

### 7.3 `packages/transport`

定位：Transport envelope、RPC dispatch 边界与 event subscription 基础。

不拥有 Kernel method 业务实现。

### 7.4 `packages/document-store`

定位：Document Store interface、Document / Revision / Changeset / Checkpoint / tombstone / restore 边界。

不拥有 Chat / Provider / Tool 业务 schema。

### 7.5 `packages/extension-host`

定位：Manifest loading、server entry loading、`activate(ctx)`、runtime registration、owner tracking、extension lifecycle。

不拥有具体 Provider / Runtime / Tool 协议。

### 7.6 `packages/extension-sdk`

定位：Extension 作者面对的稳定 SDK surface。

Extension 作者应依赖 SDK，不依赖 Kernel internals。

### 7.7 `packages/client-bridge`

定位：Client 与 Studio Host 通信的受控 bridge。

Client UI 和未来 Client Extension 都通过它访问 Host 能力。

### 7.8 `packages/trace-audit`

定位：Trace / Audit 类型、append-only store abstraction、correlation helper。

不拥有 trace viewer UI。

### 7.9 `packages/loom-runner`

定位：Kernel / RPC 到 Loom Core 的受控 adapter。

它与第一方 PromptBuild 所在的 `packages/application-runtime` 是当前唯二允许依赖 Loom Core public API 的 Studio package。

### 7.10 `packages/kernel`

定位：组合各平台能力，注册 Kernel namespace RPC，提供 `createKernel`。

不提供：

```text
chat.send
provider.invoke
tool.call
agent.step
messages[]
currentSession
```

---

## 8. Extensions 目录

第一版只需要：

```text
extensions/example-echo/
```

用途：

- 验证 Manifest loading；
- 验证 `activate(ctx)`；
- 验证 RPC registration owner tracking；
- 验证 Extension 只能依赖 SDK。

未来可以加入：

```text
extensions/official-loom/
extensions/example-document-type/
extensions/example-client-panel/
```

但第一版不急着创建这些目录。

---

## 9. 命名规则

### 9.1 文件夹

全部使用 kebab-case：

```text
document-store
extension-host
client-bridge
trace-audit
studio-server
studio-client
```

### 9.2 文件名

全部使用 kebab-case：

```text
create-kernel.ts
document-store.ts
serialized-error.ts
extension-registry.ts
document-explorer.tsx
```

React 组件内部仍使用 PascalCase：

```tsx
export function DocumentExplorer() {}
```

### 9.3 类型命名

推荐后缀：

```text
XxxInput
XxxResult
XxxOptions
XxxContext
XxxRecord
XxxEvent
XxxError
XxxHandle
```

避免早期抽象名：

```text
BaseManager
AbstractService
GenericHandlerFactory
CommonUtils
```

### 9.4 Resolved Issue: 源码文件命名形态对齐

> **状态**：Resolved / 2026-06-23 已执行 Client 源码文件命名迁移
> **触发**：2026-06-22 Client / Application Layer 审计发现，当前源码文件命名与本文 `9.1`、`9.2` 的 kebab-case 规则不完全一致。

当前规则已经明确：

```text
文件夹：kebab-case
文件名：kebab-case
React 组件内部标识：PascalCase
普通变量、函数、hook：camelCase
```

历史偏差如下，已在 2026-06-23 迁移为 kebab-case：

```text
apps/studio-client/src/app/App.tsx
apps/studio-client/src/app/App.module.css
apps/studio-client/src/app/useStudioState.ts
apps/studio-client/src/pages/studio/StudioPage.tsx
apps/studio-client/src/shared/ui/file-tree/FileTree.tsx
apps/studio-client/src/widgets/context-workbench/ContextWorkbench.tsx
apps/studio-client/src/widgets/preset-workbench/PresetWorkbench.tsx
apps/studio-client/src/widgets/preset-workbench/AgentRuntimeManager.tsx
apps/studio-client/src/widgets/rendering-lab/RenderingLab.tsx
```

这类 PascalCase 文件名来自 React 生态常见习惯，但和仓库级规则冲突。已采用：

```text
App.tsx -> app.tsx
App.module.css -> app.module.css
useStudioState.ts -> use-studio-state.ts
StudioPage.tsx -> studio-page.tsx
FileTree.tsx -> file-tree.tsx
ContextWorkbench.tsx -> context-workbench.tsx
PresetWorkbench.tsx -> preset-workbench.tsx
AgentRuntimeManager.tsx -> agent-runtime-manager.tsx
RenderingLab.tsx -> rendering-lab.tsx
```

命名形态边界暂定如下：

| 位置                          | 规则         | 说明                                                                     |
| ----------------------------- | ------------ | ------------------------------------------------------------------------ |
| 源码目录                      | kebab-case   | 包括 feature、widget、shared ui 子目录                                   |
| 源码文件                      | kebab-case   | 包括 `.ts`、`.tsx`、`.module.css`                                        |
| React 组件 / 类型 / class     | PascalCase   | 只限代码标识，不用于文件名                                               |
| hook / 函数 / 变量            | camelCase    | 例如 `useStudioState`、`createStudioApi`                                 |
| wire literal / 外部协议字段   | 保留协议原样 | 例如 OpenAI `max_tokens`、`finish_reason`、RPC error code                |
| 文档版本号目录 / ADR / README | 保持既有约定 | 例如 `08-ApplicationLayer`、`ADR-005-*`、`README.md`，不纳入源码命名迁移 |

执行记录：

1. 使用 `scripts/rename-studio-client-files.ts` 维护显式 rename manifest；
2. 使用 Node `--experimental-strip-types` 执行脚本，避免新增 `ts-morph` 依赖；
3. 脚本支持 dry-run / `--write`，并处理 macOS 大小写不敏感文件系统上的 case-only rename；
4. rename 后已运行 TypeScript build 与 Client unit tests。
5. 额外运行 `pnpm --filter @loom-studio/studio-client build`，确认 Vite 与 CSS Modules import 可正常解析。

后续规则：禁止继续新增 PascalCase 源码文件名；新增组件文件应直接使用 kebab-case。

当前施工入口见 `docs/guide/code-style.md` 与 `docs/guide/project-structure.md`；本文只保留命名迁移的决策记录。

---

## 10. Public Entry 与 Internal 规则

每个 package 使用：

```text
src/index.ts
```

作为 public entry。

允许：

```ts
import { createKernel } from '@loom-studio/kernel'
```

禁止：

```ts
import { createKernel } from '@loom-studio/kernel/src/create-kernel'
import { InternalRegistry } from '@loom-studio/extension-host/src/internal/registry'
```

如果需要 internal 目录，约定为：

```text
packages/*/src/internal/
```

`internal` 只能被同 package 内部 import。

---

## 11. Import Direction Rules

### 11.1 允许依赖方向

```text
apps/studio-server
  -> packages/kernel

apps/studio-client
  -> packages/client-bridge
  -> packages/shared
  -> packages/diagnostics types only

packages/kernel
  -> packages/document-store
  -> packages/extension-host
  -> packages/transport types
  -> packages/diagnostics
  -> packages/trace-audit
  -> packages/loom-runner

packages/loom-runner
  -> Loom Core public package

extensions/*
  -> packages/extension-sdk
```

### 11.2 禁止依赖方向

```text
client -> kernel
client -> document-store implementation
extension -> kernel
extension -> document-store implementation
transport -> kernel
shared -> any studio package
extension-sdk -> kernel internals
any package -> another package /src/internal
```

### 11.3 App import 规则

`apps/studio-server` 可以组合平台 packages，但不应成为业务逻辑堆积地。

`apps/studio-client` 只能通过 `client-bridge` 与 Host 交互，不能直接拿 server-side implementation。

---

## 12. Loom Core 边界

Loom Core 源码位于同一 monorepo 的 `packages/core`，但仍是独立的 `@loom/core` package。Studio package 不 import Core internal path。

允许依赖 Core public API 的位置：

```text
packages/loom-runner
packages/application-runtime
```

禁止：

```text
packages/kernel -> Loom Core
packages/document-store -> Loom Core
packages/extension-host -> Loom Core
packages/transport -> Loom Core
apps/studio-client -> Loom Core
extensions/* -> Loom Core
```

目标依赖方向：

```text
apps/studio-server
  -> packages/kernel
    -> packages/loom-runner
      -> packages/core public package

apps/studio-server
  -> packages/application-runtime
    -> packages/core public package
```

`loom-runner` 是 Kernel/RPC adapter；`application-runtime` 的直接依赖只服务第一方 PromptBuild pipeline。Core 的 Fragment / Pass / Trace 概念仍不得泄漏到 Studio 数据层、Extension Host、Client UI 或 Extension API。

仓库内统一使用 `workspace:*`；未来发布策略不影响当前源码边界。

---

## 13. First Skeleton PRs

第一批 PR 只做骨架，不实现大功能。

### PR-1: Repository skeleton

目标：

- 创建顶层 `apps/`、`packages/`、`extensions/`、`docs/`、`scripts/`、`tests/`；
- 创建 `apps/studio-server` 空入口；
- 创建 `apps/studio-client` 空入口与 FSD 目录；
- 创建第一批 `packages/*` 空 package；
- 创建 `extensions/example-echo` 空目录；
- 创建 root workspace / tool config placeholder。

验证：

```text
仓库目录符合本文结构。
没有跨边界 import。
```

### PR-2: Public entry skeleton

目标：

- 每个 package 添加 `src/index.ts`；
- 每个 package 添加最小 public export placeholder；
- 建立 package public entry 约定；
- 不添加实际业务实现。

验证：

```text
所有 package 都只能通过 public entry 被引用。
```

### PR-3: Boundary enforcement skeleton

目标：

- 增加 import direction 规则的最小校验；
- 禁止 deep import；
- 禁止 client import kernel；
- 禁止 extension import kernel/document-store implementation。

验证：

```text
构造一个非法 import 时，校验会失败。
```

### PR-4: Example extension skeleton

目标：

- `extensions/example-echo` 只依赖 SDK；
- 保留 manifest / server entry 文件位置；
- 不实现复杂逻辑，只用于验证工程边界。

验证：

```text
example extension 不依赖 kernel internals。
```

---

## 14. Explicit Non-Goals

本文不决定：

- 包管理器具体选择；
- React / Vite 版本；
- CSS 方案；
- Tailwind 是否使用；
- UI primitive / component library；
- 状态管理库；
- server framework；
- WebSocket library；
- runtime schema validation library；
- test runner；
- lint / format 工具；
- build tool；
- SQLite backend；
- Core 的具体 dependency spec；
- first demo 的功能路线。

这些放入后续单独文档讨论。

---

## 15. Open Questions

这些问题不在本文回答，但需要在下一份“填充物 / 依赖选型”文档中处理：

1. 包管理器是否正式使用 pnpm？
2. Client CSS 用 CSS Modules + CSS variables，还是其他策略？
3. 是否明确排除 Tailwind baseline？
4. React / Vite 使用最新稳定版还是锁定较保守版本？
5. server 是否只用 Node HTTP/WebSocket，还是引入框架？
6. test runner、lint、format、build tool 如何选择？
7. 是否引入 runtime schema validation，例如 Zod？
8. Client 状态管理是否保持 React state 起步？
9. Loom Core 具体 package path 和 public API 是什么？

---

## 16. Document History

- 2026-05-14: Draft v0.1. 初版混合讨论了仓库骨架与依赖填充物。
- 2026-05-14: Draft v0.2. 按范围收束为纯工程骨架文档，移出 CSS、React/Vite、工具链、依赖版本、server framework 等填充物决策。
