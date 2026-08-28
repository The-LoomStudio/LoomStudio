# Loom Studio Dependency and Runtime Choices v0

> **Status**: Archived / Superseded MVP Dependency Snapshot
> **Archived**: 2026-08-28；当前依赖与工具链约束见 [`docs/guide/tech-stack.md`](../../guide/tech-stack.md) 和实际 workspace manifests。
> **Purpose**: 基于 Studio MVP 需求，明确 P0 必需依赖、P1 高概率依赖、暂缓依赖、CSS 策略、Client / Server / Validation / Test / Tooling / Database / Loom Core 选型边界。
> **Audience**: Studio 工程实现者、Client / Server / Extension Host / SDK 维护者。
> **Related**:
> - [`studio-repository-engineering-v0.md`](studio-repository-engineering-v0.md)
> - [`loom-studio-mvp-engineering.md`](../../archive/discussion/loom-studio-mvp-engineering.md)
> - [`../03-kernel/studio-transport-protocol-v0.md`](../../archive/discussion/kernel/studio-transport-protocol-v0.md)
> - [`../05-extensions/studio-extension-lifecycle-v0.md`](../../archive/discussion/extensions/studio-extension-lifecycle-v0.md)
> - [`../04-data/studio-document-store-engineering-v0.md`](../../workbench/discussion/data/studio-document-store-engineering-v0.md)

---

## 0. 本文解决什么问题

仓库骨架文档已经只负责目录与边界。本文单独讨论“填充物”：

1. 第一批工程必须安装哪些库；
2. 哪些库很可能需要，但应按功能触发；
3. 哪些库现在暂缓；
4. Client CSS 方案如何选择；
5. React / Vite / Server / Validation / Test / Lint / Format 如何取舍；
6. Database 依赖何时引入；
7. Loom Core 依赖如何接入。

本文不重新讨论：

- monorepo 目录结构；
- package 命名；
- FSD 适用范围；
- package import direction；
- Kernel / Runtime / Provider / Tool / MCP 架构边界。

---

## 1. Dependency Policy

P0 只引入跑通平台闭环必需的依赖：

```text
TypeScript workspace
  -> Server transport
  -> Client bridge
  -> Extension activation
  -> Document write
  -> Diagnostics
```

其他依赖必须由具体功能触发。

原则：

1. **Node-compatible baseline**：不以 Bun-first 作为 Extension / Script / Runtime 生态契约。
2. **少即是多**：P0 不引入大型 UI 框架、ORM、桌面壳、复杂构建器。
3. **边界优先**：Validation、Transport、Extension Manifest 这类边界可以引入工具；内部纯逻辑不滥用 runtime schema。
4. **用户可扩展性优先**：Client 样式选择必须服务主题、Extension panel、用户 CSS 覆盖。
5. **按需引入**：Radix、React Query、SQLite、file watcher、E2E 等在具体功能需要时加入。
6. **不假装安全**：不引入 VM sandbox 库来制造早期安全错觉。

---

## 2. Decision Summary

| Area | P0 Decision | Notes |
|---|---|---|
| Package manager | `pnpm` | workspace monorepo 首选 |
| Runtime baseline | Node-compatible | Bun 可选加速，不是平台契约 |
| Language | TypeScript | 全仓库 TS |
| TS script runner | `tsx` | server dev / scripts 简化 |
| Client | React latest stable + Vite latest stable | Browser client 起步 |
| CSS | CSS Modules + CSS Custom Properties | 不用 Tailwind 作为 baseline |
| Server transport | Node `http` + `ws` | 不先引入 server framework |
| Validation | `zod` | 只在边界使用 |
| Version range | `semver` | Extension engines / compatibility |
| Test | Vitest | 包单测与基础集成测试 |
| Format | Prettier | 全仓库格式化 |
| Lint | ESLint flat config | import boundary 后续加强 |
| State management | React state 起步 | Zustand / React Query 按需 |
| Database | P0 不引入 SQLite | 先稳定 Document Store interface |
| Desktop shell | P0 不引入 | Electron / Tauri 后续专题 |
| Loom Core | `packages/loom-runner` 单点依赖 | 短期 file dependency，长期 semver |

---

## 3. P0 Dependencies

P0 依赖只覆盖第一批平台闭环。

### 3.1 Root / Workspace Dev Dependencies

```text
typescript
tsx
vitest
eslint
@eslint/js
typescript-eslint
prettier
```

用途：

| Dependency | Why |
|---|---|
| `typescript` | 类型系统、package API、SDK、Document Store interface |
| `tsx` | 直接运行 TS server/dev scripts |
| `vitest` | 单测与基础集成测试 |
| `eslint` | 静态检查 |
| `@eslint/js` | ESLint flat config 基础规则 |
| `typescript-eslint` | TypeScript lint 支持 |
| `prettier` | 格式化 |

### 3.2 Workspace Manager

```text
pnpm
```

原因：

- workspace 支持成熟；
- `--filter` 适合 monorepo；
- package linking 简单；
- 比 npm workspace 的开发体验更稳定；
- 比 Bun 更符合 Node-compatible baseline。

### 3.3 Client Dependencies

```text
react
react-dom
vite
@vitejs/plugin-react
clsx
```

用途：

| Dependency | Why |
|---|---|
| `react` | Client UI 基础 |
| `react-dom` | Browser render |
| `vite` | Client dev server / build |
| `@vitejs/plugin-react` | React + Vite 官方插件 |
| `clsx` | CSS Modules 条件 className 组合 |

React / Vite 使用最新稳定版。

### 3.4 Server / Transport Dependencies

```text
ws
```

P0 server 使用 Node 内置 `http` + `ws`。

原因：

- Transport MVP 是 WebSocket；
- HTTP routing 需求很少；
- 不需要先引入 Express / Fastify / Hono / Elysia；
- 未来如果需要 REST/static/auth，再评估 server framework。

### 3.5 Validation / Compatibility Dependencies

```text
zod
semver
```

`zod` 用于边界 validation：

- Manifest parse；
- Transport envelope validation；
- config file validation；
- Extension contribution declaration validation；
- Document write input boundary validation。

规则：

```text
只在边界使用 Zod，不在内部纯函数到处套 schema。
```

`semver` 用于：

- `engines.studio`；
- Extension compatibility；
- future dependencies / conflicts；
- SDK/Core version range check。

---

## 4. P1 Likely Dependencies

P1 不是一次性安装清单，而是“功能触发时大概率选择”。

### 4.1 Client Testing

```text
@testing-library/react
@testing-library/jest-dom
@testing-library/user-event
jsdom
```

触发条件：

- Client UI 开始有非平凡交互；
- diagnostics / document explorer / extension manager 需要组件测试；
- Client Bridge 与 UI 状态需要测试。

倾向使用 `jsdom`，因为它更标准。`happy-dom` 可作为速度优化后续评估。

### 4.2 Client State / Server State

```text
zustand
@tanstack/react-query
```

`zustand` 触发条件：

- connection state；
- selected project / selected document；
- panel layout state；
- command palette state；
- diagnostics filter。

`@tanstack/react-query` 触发条件：

- documents list / extension list / diagnostics / trace-audit query 出现明显 server-state 缓存与 invalidation 需求；
- event subscription 需要驱动 query invalidation。

P0 不引入。React state + Client Bridge 先行。

### 4.3 UI Primitives

按需引入 Radix primitives：

```text
@radix-ui/react-dialog
@radix-ui/react-tabs
@radix-ui/react-tooltip
@radix-ui/react-dropdown-menu
@radix-ui/react-popover
@radix-ui/react-select
```

策略：

- 不全量预装 Radix；
- 遇到第一个复杂无障碍交互组件时按需引入；
- Radix 无样式 primitive 与 CSS variables / CSS Modules 兼容；
- 不采用 shadcn/ui baseline。

### 4.4 File Watching / Dev Workspace

```text
chokidar
```

触发条件：

- Dev Workspace live sync；
- Extension dev reload；
- manifest watch；
- generated artifact rebuild。

P0 不需要。

### 4.5 SQLite Backend

候选：

```text
better-sqlite3
```

触发条件：

- Document Store interface 与 in-memory backend 稳定；
- 需要持久化 project state；
- 需要 revision / changeset / checkpoint 落盘。

倾向：

```text
后续 SQLite backend 优先评估 better-sqlite3。
```

原因：

- 本地优先场景成熟；
- API 简单；
- 性能好；
- 适合 append-only revision store。

风险：

- native dependency；
- desktop packaging 时需要额外处理；
- 同步 API 需要避免长事务阻塞。

### 4.6 Lint Boundary Plugins

```text
eslint-plugin-import-x
eslint-plugin-boundaries
eslint-plugin-react-hooks
eslint-plugin-jsx-a11y
```

触发条件：

- 开始严格执行 deep import 禁止；
- 开始执行 client -> kernel 禁止；
- Client UI 组件增多；
- hooks / a11y 检查需要自动化。

可以在 PR-1 后尽早引入，但不是 P0 必须。

### 4.7 Logging

候选：

```text
pino
```

P0 先用内部 logger interface，不直接绑定 logging library。

触发条件：

- server 日志量上升；
- 需要 structured log output；
- 需要按 correlationId / callId 查询 log。

---

## 5. Deferred Dependencies

以下依赖暂缓，不作为 P0/P1 默认选择。

### 5.1 CSS / UI 暂缓

```text
tailwindcss
shadcn/ui
antd
mui
chakra
mantine
styled-components
emotion
vanilla-extract
sass
less
```

说明：

- Tailwind / shadcn 不适合作为 Studio baseline，因为 Studio 需要用户 CSS 与 Extension theme 覆盖；
- 大型 UI 库会锁定主题系统与组件风格；
- CSS-in-JS runtime 不利于用户直接导入 CSS 覆盖；
- Sass / Less 对现代 CSS 与 CSS variables 的增益不足；
- vanilla-extract 很好，但会引入构建复杂度，且用户自定义 CSS 不如 plain CSS 直接。

### 5.2 Server Framework 暂缓

```text
express
fastify
hono
elysia
```

P0 不需要 server framework。

如果未来需要 HTTP routing / middleware / static serving / auth，再单独评估。若必须选轻量方案，优先评估 Hono，但不在 P0 决定。

### 5.3 ORM / Query Builder 暂缓

```text
prisma
typeorm
drizzle
kysely
```

Document Store 第一阶段重点是 interface、revision、changeset、tombstone、restore 语义，不是 schema/query builder。

SQLite backend 开始时，再决定裸 SQL + typed mapper，还是轻量 query builder。

### 5.4 Desktop Shell 暂缓

```text
electron
tauri
```

先做 local server + browser client。

原因：

- desktop shell 会引入打包、native、更新、权限模型；
- 当前重点是 Kernel / Extension / Document / Transport 边界；
- Web app 跑通后再套壳更稳。

### 5.5 Extension Sandbox 暂缓

```text
isolated-vm
vm2
```

P0 不实现安全 sandbox。

原因：

- Extension isolation 是后续专题；
- `vm2` 历史安全问题较多；
- 同进程加载时应明确“不提供安全隔离”，避免制造安全错觉；
- 先用 API boundary、owner tracking、capability facade 为未来隔离铺路。

### 5.6 Build Orchestration / Bundling 暂缓

```text
turbo
lage
rollup
tsup
```

P0 使用 workspace scripts + TypeScript build 即可。

触发条件：

- packages build/test 明显变慢；
- SDK 需要发布并提供更精细的 bundle；
- CLI 需要独立打包。

### 5.7 E2E 暂缓

```text
playwright
```

E2E 后续有价值，但 P0 不需要。等 server + client + transport + extension host 跑通后再引入。

---

## 6. CSS Strategy

### 6.1 决策

Studio Client 使用：

```text
CSS Modules
CSS Custom Properties
Design tokens as CSS variables
Plain CSS cascade layers where useful
```

不使用 Tailwind 作为 baseline。

### 6.2 理由

Studio 是可扩展工作台，不是封闭网页应用。样式系统必须服务：

- 用户自定义 CSS；
- Extension panel；
- theme package；
- host shell 与 sandbox 边界；
- 长期可维护的 design tokens。

Tailwind 的 class-heavy 模型不适合作为 Studio 公共主题 contract。Studio 更需要稳定 CSS variables 和 documented host slots。

### 6.3 Global Style Layout

推荐：

```text
apps/studio-client/src/app/styles/
├── reset.css
├── tokens.css
├── theme-light.css
├── theme-dark.css
├── globals.css
└── layers.css
```

### 6.4 Component Style Layout

组件使用 CSS Modules：

```text
widgets/document-explorer/
├── document-explorer.tsx
├── document-explorer.module.css
└── index.ts
```

稳定 contract：

- CSS variables；
- future documented host slots；
- future data attributes；
- panel sandbox root；
- theme metadata。

不承诺内部 CSS Module class name 稳定。

### 6.5 Reset

P0 倾向自写极小 `reset.css`，不引入 `modern-normalize`。

原因：Studio 的全局样式边界需要自己掌握，reset 内容也不会很大。

---

## 7. TypeScript / Build Strategy

### 7.1 TypeScript Options

Root `tsconfig.base.json` 倾向：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmitOnError": true
  }
}
```

暂不强制：

```json
{
  "noUncheckedIndexedAccess": true,
  "exactOptionalPropertyTypes": true
}
```

原因：二者长期有价值，但早期会明显增加类型摩擦。核心包稳定后逐步开启。

### 7.2 Package Build

P0 倾向：

```text
tsc -b
```

不先用 Vite library mode 管全仓库 packages。

原因：

- packages 主要是 TS libraries；
- `tsc -b` 与 project references 足够；
- 避免 tsup / rollup / multi-format bundle 复杂度。

---

## 8. Validation Strategy

使用 `zod`，但只在边界使用。

边界包括：

- manifest parse；
- transport envelope；
- extension contribution declaration；
- config files；
- public RPC input/output（按需）；
- document write input boundary；
- future workspace adapter parse result。

不推荐：

- 每个内部函数都写 zod schema；
- 用 zod 替代 TypeScript 类型设计；
- 在 hot path 重复 parse 同一数据。

未来如果需要公开 JSON Schema，再评估：

```text
zod-to-json-schema
ajv
```

---

## 9. Testing Strategy

P0 使用：

```text
vitest
```

优先测试：

1. Transport envelope parse / error serialize；
2. Extension Host manifest validation / activation / registration mismatch；
3. Document Store revision / changeset / tombstone / expectedVersion；
4. Diagnostics registry；
5. Correlation propagation helpers。

P1 Client 测试再加入：

```text
@testing-library/react
@testing-library/jest-dom
@testing-library/user-event
jsdom
```

E2E 暂缓，后续再引入 Playwright。

---

## 10. Lint / Format Strategy

P0 使用：

```text
eslint
@eslint/js
typescript-eslint
prettier
```

P1 加强：

```text
eslint-plugin-import-x
eslint-plugin-boundaries
eslint-plugin-react-hooks
eslint-plugin-jsx-a11y
```

目标规则：

- 禁止 deep import；
- 禁止 client import kernel；
- 禁止 extension import kernel/document-store implementation；
- 强制 type-only import where useful；
- 检查 React hooks；
- 检查基本 a11y。

暂不使用 Biome 替代 ESLint + Prettier。原因是 import boundary 与 monorepo 复杂规则 ESLint 生态更成熟。

---

## 11. Server / Transport Strategy

P0：

```text
node:http
ws
```

Transport 实现：

- WebSocket only；
- JSON-RPC-like envelope；
- request / response / error；
- event subscription；
- correlation metadata。

不引入 server framework。

后续如果需要 HTTP routing / middleware，可单独评估：

```text
hono
fastify
express
```

Bun / Elysia 不作为 baseline。Bun 可作为 optional fast path，但不应成为 Extension ecosystem 的默认运行时要求。

---

## 12. Document Store / Database Strategy

P0 不引入 SQLite dependency。

P0 做：

```text
Document Store interface
in-memory backend
revision / changeset / tombstone / expectedVersion tests
```

P1 / P2 做 SQLite backend。

首选候选：

```text
better-sqlite3
```

暂缓 ORM / query builder：

```text
prisma
typeorm
drizzle
kysely
```

决策点：

- 当 Document Store interface 稳定后，再写 SQLite backend；
- SQLite backend 文档单独写，不混入依赖选型文档；
- 如果裸 SQL 复杂度上升，再评估 query builder。

---

## 13. Loom Core Dependency

`@loom/core` 当前作为 LoomStudio 内的 workspace package 存放在：

```text
packages/core
```

允许依赖 Core public API 的 Studio package：

```text
packages/loom-runner
packages/application-runtime
```

依赖统一写为：

```json
{
  "dependencies": {
    "@loom/core": "workspace:*"
  }
}
```

规则：

- Core 与 Studio 同仓开发，但保持独立 package、版本与 public exports；
- Studio 不 import Core internal path；
- Kernel 不直接依赖 Core；
- Client 不依赖 Core；
- Extension 不直接依赖 Core，除非未来作为普通第三方依赖另行讨论；
- Kernel/RPC 的 Core 调用通过 `loom-runner` adapter 收敛；
- Application Runtime 只在第一方 PromptBuild pipeline 内直接使用 Core public API。

---

## 14. P0 Install Set

如果现在初始化工程，P0 安装集为：

```text
# workspace / language / scripts / test / lint / format
typescript
tsx
vitest
eslint
@eslint/js
typescript-eslint
prettier

# client
react
react-dom
vite
@vitejs/plugin-react
clsx

# server / transport
ws

# validation / compatibility
zod
semver
```

包管理器：

```text
pnpm
```

---

## 15. P1 Triggered Install Set

按功能触发，不一次性安装：

```text
@testing-library/react
@testing-library/jest-dom
@testing-library/user-event
jsdom
zustand
@tanstack/react-query
@radix-ui/react-dialog
@radix-ui/react-tabs
@radix-ui/react-tooltip
@radix-ui/react-dropdown-menu
@radix-ui/react-popover
@radix-ui/react-select
chokidar
better-sqlite3
eslint-plugin-import-x
eslint-plugin-boundaries
eslint-plugin-react-hooks
eslint-plugin-jsx-a11y
pino
```

---

## 16. Explicit Non-Goals

本文不定义：

- 完整 UI component system；
- full theme marketplace；
- Client Panel API；
- Extension sandbox；
- desktop shell；
- SQLite schema；
- ORM strategy；
- Provider / Runtime / Tool / MCP conventions；
- Chat message schema；
- Agent runtime protocol；
- Tool loop protocol。

---

## 17. Open Questions

1. P0 是否立刻加入 `eslint-plugin-boundaries`，还是等 PR-3 后再加？
2. `zod` schema 是否需要从第一天就覆盖所有 transport envelope，还是先覆盖 manifest？
3. Client 是否在第一个 Dialog / Tabs 出现时引入 Radix，还是先自写极小 primitive？
4. `@loom/core` 当前实际 package path 与 public API 名称是什么？
5. SQLite backend 是否紧跟 Document Store in-memory 后做，还是等端到端 demo 后做？
6. 是否需要在 P0 加入 `@types/ws`，取决于 `ws` 当前版本类型支持情况。

---

## 18. Document History

- 2026-05-14: Draft v0.1. 新增依赖填充物与运行时选型文档，定义 P0/P1/Deferred 依赖、CSS 策略、Server/Validation/Test/Database/Core 选型边界。
