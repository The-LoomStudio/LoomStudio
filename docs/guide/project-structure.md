# 项目全量文件地图 (Project Structure)

Loom Studio 使用 `pnpm` workspace 构建了一个 Monorepo。本项目主要分为核心代码区域：`packages/` (内核与领域逻辑), `apps/` (独立应用程序), `official/` 与 `tests/fixtures/extensions/`（官方内容与测试扩展），并由 `scripts/` 提供全仓工程治理工具，由 `data/` 承载唯一持久业务数据。

本页提供全仓地图。开始具体任务时，先通过 [`workspace-development.md`](workspace-development.md) 进入目标 Workspace，再阅读该目录的本地 `README.md`；局部 README 负责入口和命令，本页不重复维护每个 Package 的完整文件清单。

## Workspace 工具链

- Node.js 固定为 `22.18.0`，pnpm 固定为 `9.15.0`；版本来源分别是 `.node-version` / `.nvmrc` 与根 `package.json`。
- 新依赖默认保存精确版本，所有依赖都禁止使用 `latest` 或 `*`。安装与 CI 使用 `pnpm install --frozen-lockfile`。
- 内部 packages 的运行时入口位于各自 `dist/`。根目录的 `dev:server` 和 `dev:client` 会先构建并持续监听这些 packages，避免 workspace 链接正确但产物过期。
- `pnpm run check:workspace` 会先构建内部 packages，再检查工具链版本、依赖确定性、lockfile 和关键跨包运行时导出。

## 依赖关系方向

> **核心原则：内层不依赖外层。**
> `packages/` 内层包 **绝对不可** import `apps/` 或外部特定实现。
> 依赖方向始终是单向箭头：`apps/` -> `packages/` -> `packages/core`。Core 仍通过 `@loom/core` public API 消费。

---

## 💻 前端架构: `apps/studio-client/src/`

局部开发入口：[`apps/studio-client/README.md`](../../apps/studio-client/README.md)。

前端采用严格的按业务职能分层，而非简单按 UI 组件分类。

- `app/`
  - 顶层 App 组装、状态 facade (`use-studio-state.ts`) 以及样式入口 (`app.module.scss`)。这是组装所有功能块的心脏。
- `entities/`
  - 承载所有的**业务数据类型与实体抽象** (`card.ts`, `agent.ts`, `narrative.ts`, `prompt.ts`, `workspace.ts` 等)。
  - 这里定义了前端视角的数据结构。
- `features/`
  - 纯粹的**业务逻辑模型与钩子 (Hooks)**，按领域划分：
    - `cards/`: 角色卡业务
    - `narrative-runtime/`: Narrative Timeline、Branch、Node 与按需 Agent Session 调用逻辑
    - `agent-profiles/`: Agent Profile、Preset Prompt Resource 列表与当前选择状态
    - `agent-runtime/`: 独立 Agent Session 的创建、线性 Message 历史与 Agent-only Turn 编排
    - `prompt-build/` & `context-assets/`: 设定与提示词装配
    - `provider-settings/`: API与模型供应商配置
- `widgets/`
  - **复杂或独立的业务块组件**，负责页面级 UI 组合和局部交互。跨领域状态与 RPC 流程应放在 `features/` 或 app facade 中，不要塞回 widget。
  - `narrative-timeline/`: 聊天正文与时间线画板。
  - `chat-composer/`: 聊天底部输入区。
  - `preset-workbench/`, `context-workbench/`: 相关工作台。
  - `model-panel/`, `agent-panel/`, `character-panel/`, `inspector-panel/`: 其他工具面板。
- `shared/`
  - 全局复用的 UI 组件 (`ui/` 下的无状态组件如 `json-block`, `file-tree`)、工具函数和 `i18n`。
- `pages/`
  - 顶级页面路由容器。

### Client 放置规则

新增前端代码前，先按下面顺序判断位置：

1. **跨领域基础能力**放 `shared/`：typed API client、无业务含义的 UI、通用 hooks、i18n、纯工具。
2. **领域类型**放 `entities/`：前端视角的业务数据结构和很薄的纯函数。
3. **业务状态、RPC 编排、领域算法**放 `features/*/model`：缓存型远端状态优先由 feature 内的 TanStack Query hook 管理；本地应用偏好使用 Zustand；未保存草稿和瞬时交互留在组件或 feature hook。
4. **领域绑定 UI**放 `features/*/ui`：需要认识某个 feature 类型，但不拥有跨领域流程。
5. **页面级组合**放 `widgets/`：组合 feature/entity UI，承载局部 UI 状态和布局，不拥有 RPC 流程或复杂领域算法。
6. **全局组装**放 `app/`：只做 provider、page shell、facade 组合和顶层 glue。

以下信号出现时，先停下来拆边界，不要继续往同一个文件里塞：

- `use-studio-state.ts` 开始直接实现新领域逻辑，而不是组合 feature hook。
- widget 内出现 `bridge.call(...)`、跨 feature refresh choreography、树递归修改、provider config normalization。
- React 组件文件为了复用类型而向 `widgets/` 内部互相 deep import。
- 单个 hook 同时处理 RPC、form state、derived data、event subscription。
- 新组件文件使用 `PascalCase.tsx` 或 CSS Module 使用 `PascalCase.module.scss`。

### Client 任务路由表

如果你没有上下文，先按任务类型定位，不要从 `App` 或 widget 盲目向下翻。

| 任务                                           | 先看                                                        | 常见改动位置                                                                                                                                                     | 对应测试                                                                      |
| ---------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 修改角色卡列表、创建卡、选中卡                 | `features/cards/model/use-cards.ts`                         | `entities/card.ts`, `widgets/character-panel/`                                                                                                                   | 暂无专属测试，跑 `tests/unit/client/` 相关用例与 client build                   |
| 修改叙事时间线、分支、Narrative Agent 调用流程 | `features/narrative-runtime/model/use-narrative-runtime.ts` | `entities/narrative.ts`, `entities/agent.ts`, `widgets/narrative-timeline/`                                                                                      | `tests/unit/client/use-narrative-runtime.test.ts`                             |
| 修改独立 Agent Session 对话流程                | `features/agent-runtime/model/use-agent-chat-runtime.ts`    | `entities/agent.ts`, `widgets/agent-composer/`                                                                                                                   | `tests/integration/application-runtime/agent-session.test.ts` 与 client build |
| 修改 Context Assets 树操作                     | `features/context-assets/model/tree-ops.ts`                 | `context-asset-tree.ts`, `context-asset-normalization.ts`, `widgets/context-workbench/`                                                                          | `tests/unit/client/context-assets.test.ts`                                    |
| 修改 projection order / projection view        | `features/context-assets/model/projection-order.ts`         | `features/context-assets/model/projection-workbench.ts`, `widgets/context-workbench/`, `widgets/preset-workbench/` | `features/context-assets/model/projection-order.test.ts`                      |
| 修改 Prompt Build 展示步骤                     | `features/prompt-build/model/build-prompt-build-steps.ts`   | `widgets/prompt-build-flow/`, `widgets/inspector-panel/`                                                                                                         | `tests/unit/client/prompt-build-steps.test.ts`                                |
| 修改 Provider Profile / 模型选择设置           | `features/provider-settings/model/use-provider-settings.ts` | `widgets/model-panel/`                                                                                                                                           | `tests/unit/client/provider-settings.test.ts`                                 |
| 修改 Agent Profile 与当前选择                  | `features/agent-profiles/model/use-agent-profiles.ts`       | `widgets/agent-panel/`, `widgets/agent-composer/`                                                                                                                | `tests/unit/client/provider-settings.test.ts`                                 |
| 修改 typed Studio API client                   | `shared/api/studio-api.ts`                                  | `apps/studio-server/src/rpc/handlers/application/index.ts`, consuming feature hooks                                                                                             | `tests/unit/client/studio-api.test.ts`                                        |
| 修改通用文件树交互                             | `shared/ui/file-tree/file-tree-model.ts`                    | `shared/ui/file-tree/file-tree.tsx`                                                                                                                              | `tests/unit/client/file-tree.test.ts`                                         |
| 修改页面整体排布                               | `pages/studio/studio-page.tsx`                              | `app/app.tsx`, `widgets/*`                                                                                                                                       | 先跑相关 feature test，再跑 client build                                      |
| 新增用户可见文案                               | `shared/i18n/en-us.ts`, `shared/i18n/zh-cn.ts`              | 使用方组件或 feature                                                                                                                                             | 相关 feature test / client build                                              |

### Client 模块索引

| 模块                         | 职责                                       | 不负责                                 |
| ---------------------------- | ------------------------------------------ | -------------------------------------- |
| `app/app.tsx`                | 装配 Studio page 与 widgets                | 业务算法、RPC action、树操作           |
| `app/use-studio-state.ts`    | 组合 feature hooks，暴露 app facade        | 直接实现新领域状态                     |
| `shared/api/studio-api.ts`   | typed `application.*` RPC 映射             | React state、UI form、刷新编排         |
| `shared/api/renderer-api.ts` | typed `renderer.*` RPC 映射                | renderer UI 或 session state           |
| `shared/ui/file-tree/`       | 无业务含义的树形 UI 与拖放判定             | Context Asset 语义、projection 规则    |
| `entities/*`                 | 客户端领域类型                             | widget props glue、RPC transport       |
| `features/*/model`           | 业务状态、领域算法、RPC 编排、可测试纯函数 | 页面布局                               |
| `features/*/ui`              | 绑定单个 feature 的局部 UI                 | 跨领域状态                             |
| `widgets/*`                  | 页面级组合、局部 UI 状态、props 转发       | RPC、跨领域 server state、复杂领域算法 |
| `pages/studio/`              | Studio 页面 shell 与区域布局               | 具体业务动作                           |

### Client 改动路径模板

1. 先在上面的任务路由表找到 feature / shared / widget。
2. 如果需要新类型，先放 `entities/` 或靠近对应 API client。
3. 如果有非平庸逻辑，先放 `features/*/model` 或 `shared/ui/*/*-model.ts`，再写最小 unit test。
4. UI 只消费 model 输出；widget 只组合，不反向承载算法。
5. 最后把新能力接入 `app/use-studio-state.ts` 或页面 widget，并跑对应测试。

---

## 🖥️ 后端架构: `apps/studio-server/src/`

后端是一个组合器，主要将 `packages/` 下的各个基础设施组装为可运行的 Node.js 进程。

局部开发入口：[`apps/studio-server/README.md`](../../apps/studio-server/README.md)。

- `main.ts`: 服务器启动入口与组合根，实例化各个 Store、Kernel、Host。
- `http/`: 基于 Node HTTP 挂载 RPC、Asset、Card、Extension SSE 等数据入口，并统一执行应用会话认证 (`http-server.ts`, `application-session-auth.ts`)。
- `rpc/`: RPC 路由中心与按领域细分的 RPC 边界 Adapters（消除了巨型单一入口，细分为 `cards`, `agents`, `workspaces`, `providers` 等子模块）。
- `codecs/`: 卡片 PNG 与 ZIP 打包/解包格式编解码。
- `platform/`: 宿主系统路径、系统代理与网络配置。
- `logging/`: 日志观测与审计适配器。
- `extensions/`: 插件包源管理、安装与生命周期编排。

---

## 🧪 实验沙箱: `apps/playground/` 与本地草稿区 `drafts/`

实验与推演逻辑严格划分为两级形态，避免临时试错污染生产代码，也避免有价值的原型资产散失：

1. **`apps/playground/`（受管工程化实验应用）**
   - 具备完整的 `package.json`、TypeScript 配置与模块划分。
   - 专用于承载具有长期工程价值与交互推演的实验，例如当前重点推进的 **CodeAct 安全执行沙箱**（`apps/playground/src/codeact/`）、脱机 Kernel 自测与控制流推演。
   - 局部开发入口：[`apps/playground/README.md`](../../apps/playground/README.md)。

2. **根目录 `drafts/`（本地极速演算草稿区 / Scratchpad）**
   - 完全被 `.gitignore` 忽略，作为开发者的纯本地草稿纸（原 `Playground/`）。
   - 适用于单次脚本验证、快速对比与临时转储分析。
   - **治理生命周期底线**：
     - **及时转正**：原型成熟后须按架构权责归位（交互实验升格入 `apps/playground/`，测试夹具沉淀至对应扩展如 `official/extensions/st-data-compat/fixtures/`，静态资源进入 `public/`，生产算法合入对应包）。
     - **即时清理**：验证完毕或已转正的测试脚本、动辄数十兆的历史转储目录（如 `storage-*`、`diff-recovery-*`），应及时删除，不作为常态资产滞留工作区。

---

## 📦 核心领域包: `packages/`

这些包大多是独立于运行环境的（Node / Browser 均可或有明确边界）。

- 📦 [`packages/core/`](../../packages/core/README.md) (`@loom/core`)
  - 同步、确定的 Fragment / Pass / Pipeline / Trace 执行层。它是只服务 Studio 的 private workspace package，并保留明确的跨 package API 边界。
  - 正式架构说明：[`architecture/application/prompt-build/loom-core/`](../architecture/application/prompt-build/loom-core/)。
- 📦 [`packages/application-runtime/`](../../packages/application-runtime/README.md) (AIRP Layer)
  - Studio 的**业务心脏**。编排 Card、Agent、Narrative Timeline、PromptBuild、Provider Gateway 与相关 Document Types；权威 Narrative / Agent / State / PromptResource 持久化由 `@loom-studio/application-data` 承担。
- 📦 [`packages/application-data/`](../../packages/application-data/README.md)
  - 核心领域持久化中枢，在共享 SQLite 中内聚管理 Agent 会话与消息、Narrative 时间线与分支、State 状态值与修订、Prompt Resource 资源树与 SettingMount 挂载关系。
- 📦 [`packages/kernel/`](../../packages/kernel/README.md)
  - Studio 的底层发动机，管理内部的核心服务（RPC 注册、事件总线等）。**禁止包含任何 AI/业务（Provider/Agent）逻辑。**
  - 正式架构说明：[`architecture/kernel/README.md`](../architecture/kernel/README.md)。
- 📦 [`packages/data-engine/`](../../packages/data-engine/README.md)
  - 共享 SQLite connection、transaction、namespaced migration、Commit Journal 与提交后通知。
  - 正式架构说明：[`architecture/data/README.md`](../architecture/data/README.md)。
- 📦 [`packages/secret-store/`](../../packages/secret-store/README.md)
  - 平台通用 Secret metadata、受控使用边界与凭证后端接口；SQLite 不保存 Secret 明文，真实系统凭证后端由 Server 组合根注入。
- 📦 [`packages/document-store/`](../../packages/document-store/README.md)
  - 保存适合版本化编辑的 Document、Revision 与 Changeset，支持乐观锁与回滚，提供 SQLite 与 In-Memory 双实现。
- 📦 [`packages/blob-store/`](../../packages/blob-store/README.md)
  - 基于 SHA-256 的不可变二进制字节存储，负责暂存、去重、两阶段原子 finalize 与受控流式读写，不包含业务 Asset 语义。
- 📦 [`packages/asset-store/`](../../packages/asset-store/README.md)
  - 在共享 SQLite 中保存 Source Artifact 与 Media Asset metadata，并通过稳定 ID 关联 Blob 存储。
- 📦 [`packages/ai-gateway/`](../../packages/ai-gateway/README.md)
  - 统一的多模型厂商调度网关（基于 Vercel AI SDK），支持流式执行、工具调用、能力画像映射与离线测试 Fake Provider。
- 📦 [`packages/transport/`](../../packages/transport/README.md)
  - 定义了系统内所有 RPC 消息与事件通知的跨端信封格式 (Message Envelope 与 JSON-RPC 2.0)。
- 📦 [`packages/client-bridge/`](../../packages/client-bridge/README.md)
  - 供前端使用的 typed RPC 调用桥，连接到后端的 Transport 以进行远程调用，并在 401 时自动触发会话刷新。
- 📦 [`packages/logging/`](../../packages/logging/README.md)
  - Server/Client 共用的结构化运行日志底座，提供 Root/Child Logger、Memory/Console Sink 与查询类型；Node JSONL 旋转持久化通过 `@loom-studio/logging/node` 子入口提供。
  - 正式架构说明：[`architecture/platform/logging.md`](../architecture/platform/logging.md)。
- 📦 [`packages/loom-runner/`](../../packages/loom-runner/README.md)
  - 面向 Kernel/RPC 的 Core adapter，负责 JSON 输入校验、注入 PassFactory、对接 Diagnostics 和 Trace Audit。
- 📦 [`packages/loom-ui/`](../../packages/loom-ui/README.md) (`@loom-studio/ui`)
  - 领域无关的原子级 UI 设计系统组件库（Button、TextInput、Field、Radix 菜单原语等）与 SVG 图标集。
- 📦 [`packages/extension-sdk/`](../../packages/extension-sdk/README.md)
  - 第三方 Extension 作者侧合同（Manifest v2、Activation Context 与 Capability 类型）。
- 📦 [`packages/extension-sdk/extension-host/`](../../packages/extension-sdk/extension-host/README.md)
  - 物理嵌套但具有独立 Workspace identity 的 Server Extension Host，负责插件模块加载、授权与生命周期管理。
- 📦 [`packages/shared/`](../../packages/shared/README.md)
  - 通用的环境同构工具函数、类型定义 (`JsonValue`, `createId`, 时间处理)、变量宏渲染引擎与 SettingMount 契约。
- 📦 [`packages/diagnostics/`](../../packages/diagnostics/README.md) & [`packages/trace-audit/`](../../packages/trace-audit/README.md)
  - 分别提供系统级非阻塞错误/告警收集注册表与编译器运行轨迹/安全审计只增不减存储。

当前只有 `packages/loom-runner` 和 `packages/application-runtime` 可以直接依赖 `@loom/core`。前者提供平台 adapter；后者保留声明依赖，但当前第一方 PromptBuild 使用本包 DFS 编译器，未调用 Core public API。Kernel、Document Store、Extension Host、Client 与 Extension 不得直接依赖 Core。

## 🧩 扩展内容

- `official/extensions/st-data-compat/`: 官方 SillyTavern 数据兼容扩展（专属测试夹具位于其 `fixtures/data/` 下）。
- `tests/fixtures/extensions/echo/`: 测试扩展，覆盖 RPC、Macro、State、Text Pipeline 与 Renderer 贡献。
- `tests/fixtures/extensions/weather-station/`: Server Extension 生命周期、事件与文档能力测试样本。

---

## 🛠️ 工程脚本: `scripts/`

[`scripts/`](../../scripts/) 存放面向全仓的基础设施维护、数据迁移、开发沙箱重置、官方内容打包与架构/文档核查脚本。**严禁将未成形的随手试错代码散落在该目录**。

### 核心脚本分类与常用命令

1. **代码重构与工程治理**
   - `pnpm refactor:migrate-imports` (`scripts/dev/migrate-imports.ts`): 在跨包重构或别名调整时，自动化扫描并迁移源码中的模块导入路径。
   - `pnpm audit:unused` (`knip`): 静态分析未引用的孤儿导出、文件与无用依赖。

2. **数据迁移与环境管理**
   - `pnpm data:migrate` (`scripts/data/migrate-data-directory.ts`): 离线检查并迁移旧版存储目录至 `data/`。
   - `pnpm data:reset` (`scripts/data/reset-dev-data.ts`): 在本地开发沙箱被脏数据污染时，自动备份现有数据后安全重置 `data/`。

3. **官方内容与范例打包**
   - `pnpm official:pack` (`scripts/pack/pack-official-content.ts`): 编译并打包官方 Starter 资源与内置卡片包。
   - `pnpm example:character-status` (`scripts/pack/pack-character-status-example.ts`): 打包 Alice 角色状态与 Presentation 脚本卡片范例。

4. **架构合规与健康检查**
   - `pnpm check:workspace` (`scripts/checks/check-workspace.mjs`): 校验跨包依赖确定性、lockfile 与产物导出。
   - `pnpm check:docs` (`scripts/checks/check-docs.mjs`): 校验 Markdown 内部相对路径、锚点与文档生命周期。
   - `pnpm verify:server-extension` (`scripts/dev/verify-server-extension.ts`): 对服务端扩展的生命周期与错误隔离执行冒烟检查。

### 脚本开发规范

- **入口显式化**：通用脚本必须挂载至根 `package.json` 的 `scripts`，并提供清晰的命令行参数与帮助说明。
- **环境自适应**：脚本严禁硬编码本地开发绝对路径，必须通过 `developmentDataEnvironment` 或环境变量（如 `LOOM_STUDIO_DATA_ROOT`）动态感知环境。
- **及时清理孤儿**：阶段性、一次性的迁移脚本在任务彻底验收闭环后，必须连同其 package.json 入口一并移除，禁止长期闲置陈放。

---

## 💾 本地数据与开发沙箱: `data/` 与 `.loomstudio-dev/`

系统遵循“持久业务数据”与“临时易失诊断/缓存”彻底解耦的原则（详见 [`architecture/data/local-storage-and-assets.md`](../architecture/data/local-storage-and-assets.md)）：

1. **`data/`（单一真实数据根目录 / Single Source of Truth）**
   - 承载开发态所有真实的持久化业务资产：SQLite 核心数据库 (`studio.sqlite`)、不可变二进制块 (`blobs/`)、角色工作区 (`characters/`) 以及扩展状态 (`extensions/`)。
   - 受 `.gitignore` 保护。开发启动器（`pnpm dev:server`）通过 `LOOM_STUDIO_DATA_ROOT` 默认指向此目录。
   - 严禁在此目录写入临时测试垃圾或运行日志。

2. **`.loomstudio-dev/`（开发态易失缓存与测试沙箱）**
   - 受 `.gitignore` 保护，由开发启动器通过 `LOOM_STUDIO_HOME` 注入作为辅助根。
   - 仅用于存放本地运行的 JSONL 诊断日志（`.loomstudio-dev/logs/`）以及测试期间动态生成的临时扩展沙箱（如 `test-extensions/`）。
   - **演进边界约束**：早期位于 `.loomstudio-dev/data/` 的历史 SQLite 库与旧版 `document-store.sqlite` 已于 9 月脱机迁移至 `data/` 并彻底下线清空，不得再向 `.loomstudio-dev` 写入任何持久业务数据。

---

## 给 AI 助手的特别提示

1. 当你需要理解 **Application Runtime 公共合同** 时，先看 `packages/application-runtime/README.md`，再按需进入 `src/types.ts`；持久化类型还需查看对应领域 Store。
2. 当你需要修改 **前端 UI 界面** 时，先定位页面级 widget，再把业务状态、RPC 与领域算法放回对应 `features/`。widget 只保留布局、局部交互和 props 传递。
3. 当你需要查看 **RPC 如何分流** 时，先看 `apps/studio-server/src/rpc/studio-rpc-router.ts`；`application.*` 的边界映射再看 `apps/studio-server/src/rpc/handlers/application/index.ts` 及相邻领域 Handler。
4. **绝对不要** 为了贪图便利在不合适的层级写代码（比如在 `kernel` 里写 `Prompt` 的解析）。
