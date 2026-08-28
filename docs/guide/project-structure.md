# 项目全量文件地图 (Project Structure)

Loom Studio 使用 `pnpm` workspace 构建了一个 Monorepo。本项目主要分为三大代码区域：`packages/` (内核与领域逻辑), `apps/` (独立应用程序), `extensions/` (插件实例)。

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
3. **业务状态、RPC 编排、领域算法**放 `features/*/model`：例如 context tree mutation、projection order、provider config 映射、narrative runtime action。
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
| 修改角色卡列表、创建卡、选中卡                 | `features/cards/model/use-cards.ts`                         | `entities/card.ts`, `widgets/character-panel/`                                                                                                                   | `tests/unit/client/cards.test.ts`                                             |
| 修改叙事时间线、分支、Narrative Agent 调用流程 | `features/narrative-runtime/model/use-narrative-runtime.ts` | `entities/narrative.ts`, `entities/agent.ts`, `widgets/narrative-timeline/`                                                                                      | `tests/unit/client/narrative-runtime.test.ts`                                 |
| 修改独立 Agent Session 对话流程                | `features/agent-runtime/model/use-agent-chat-runtime.ts`    | `entities/agent.ts`, `widgets/agent-composer/`                                                                                                                   | `tests/integration/application-runtime/agent-session.test.ts` 与 client build |
| 修改 Context Assets 树操作                     | `features/context-assets/model/tree-ops.ts`                 | `context-asset-tree.ts`, `context-asset-normalization.ts`, `widgets/context-workbench/`                                                                          | `tests/unit/client/context-assets.test.ts`                                    |
| 修改 projection order / projection view        | `features/context-assets/model/projection-order.ts`         | `features/context-assets/model/projection-workbench.ts`, `features/context-assets/ui/projection-order-editor/`, `features/context-assets/ui/projection-runlist/` | `features/context-assets/model/projection-order.test.ts`                      |
| 修改 Prompt Build 展示步骤                     | `features/prompt-build/model/build-prompt-build-steps.ts`   | `widgets/prompt-build-flow/`, `widgets/inspector-panel/`                                                                                                         | `tests/unit/client/prompt-build-steps.test.ts`                                |
| 修改 Provider Profile / 模型选择设置           | `features/provider-settings/model/use-provider-settings.ts` | `widgets/model-panel/`                                                                                                                                           | `tests/unit/client/provider-settings.test.ts`                                 |
| 修改 Agent Profile 与当前选择                  | `features/agent-profiles/model/use-agent-profiles.ts`       | `widgets/agent-panel/`, `widgets/agent-composer/`                                                                                                                | `tests/unit/client/provider-settings.test.ts`                                 |
| 修改 typed Studio API client                   | `shared/api/studio-api.ts`                                  | `apps/studio-server/src/application-rpc.ts`, consuming feature hooks                                                                                             | `tests/unit/client/studio-api.test.ts`                                        |
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

- `main.ts`: 服务器启动入口，实例化各个 Store、Kernel、Host。
- `http-server.ts`: 基于 Node HTTP 挂载 RPC、Asset、Card、Extension SSE 等数据入口，并统一执行应用会话认证。
- `application-session-auth.ts`: 本地 Web 启动会话、严格 loopback 同源校验与 HttpOnly Cookie 验证；不承载多用户或业务权限。
- `application-rpc.ts`: Application RPC 的边界 adapter，负责参数读取、校验、请求上下文转换和 `ApplicationRuntime` 调用；领域规则仍属于 Runtime。
- `studio-rpc-router.ts`: 按 namespace 路由 `studio.*`、`application.*`、`ai.*`、`settings.*`、`logs.*`；未知 namespace 才回落 Kernel。
- `rpc-capability.ts`, `rpc-params.ts`: RPC 参数解析与权限能力定义工具。

---

## 📦 核心领域包: `packages/`

这些包大多是独立于运行环境的（Node / Browser 均可或有明确边界）。

- 📦 `packages/core/` (`@loom/core`)
  - 同步、确定、可重放的 Fragment / Pass / Pipeline / Trace 执行层。它与 Studio 同仓开发，但保持独立 package 和 public API 边界。
  - 正式架构说明：[`architecture/application/prompt-build/loom-core/`](../architecture/application/prompt-build/loom-core/)。
- 📦 `packages/application-runtime/` (AIRP Layer)
  - Studio 的**业务心脏**。编排 Card、Agent、Narrative Timeline、PromptBuild、Provider Gateway 与相关 Document Types；权威 Narrative / Agent 持久化分别由专用 Store 承担。
  - 局部开发入口：[`packages/application-runtime/README.md`](../../packages/application-runtime/README.md)。
- 📦 `packages/kernel/`
  - Studio 的底层发动机，管理内部的六个核心服务（RPC注册, 事件总线等）。**禁止包含任何 AI/业务（Provider/Agent）逻辑。**
  - 局部开发入口：[`packages/kernel/README.md`](../../packages/kernel/README.md)。
  - 正式架构说明：[`architecture/kernel/README.md`](../architecture/kernel/README.md)。
- 📦 `packages/data-engine/`
  - 共享 SQLite connection、transaction、migration、Commit Journal 与提交通知。
  - 局部开发入口：[`packages/data-engine/README.md`](../../packages/data-engine/README.md)。
- 📦 `packages/secret-store/`
  - 平台通用 Secret metadata、受控使用边界与凭证后端接口；SQLite 不保存 Secret 明文，真实系统凭证后端由 Server 组合根注入。
- 📦 `packages/document-store/`
  - 保存适合版本化编辑的 Document 与 Revision，不再承载全部业务数据。
- 📦 `packages/prompt-resource-store/`
  - 在共享 SQLite 中持久化 Prompt Resource 树（Preset/Setting/Logic/Runtime）、细粒度节点版本与 SettingMount 挂载关系。
- 📦 `packages/narrative-store/` / `packages/agent-store/`
  - 分别保存 Narrative Timeline / Branch / Node 与 Agent Session / append-only Message。
- 📦 `packages/blob-store/`
  - 基于 SHA-256 的不可变字节存储，负责 staging、去重、原子 finalize 与受控 stream/read，不包含业务 Asset 语义。
- 📦 `packages/asset-store/`
  - 在共享 SQLite 中保存 Source Artifact 与 Media Asset metadata，并通过稳定 ID 关联 Blob。
- 📦 `packages/transport/`
  - 定义了系统内所有 RPC 消息、事件通知的格式 (Message Envelope)。
- 📦 `packages/client-bridge/`
  - 供前端使用的 Bridge SDK，连接到后端的 Transport 以进行远程调用。
- 📦 `packages/logging/`
  - Server/Client 共用的结构化运行日志底座，提供 Root/Child Logger、Memory/Console Sink 与查询类型；Node JSONL 持久化通过 `@loom-studio/logging/node` 子入口提供。
  - 正式架构说明：[`architecture/platform/logging.md`](../architecture/platform/logging.md)。
- 📦 `packages/loom-runner/`
  - 面向 Kernel/RPC 的 Core adapter，负责 JSON 输入校验、默认 PassFactory 和 Trace Audit。
- 📦 `packages/extension-sdk/`
  - 第三方 Extension 作者侧合同。局部开发入口：[`packages/extension-sdk/README.md`](../../packages/extension-sdk/README.md)。
- 📦 `packages/extension-sdk/extension-host/`
  - 物理嵌套但具有独立 Workspace identity 的 Server Extension Host。局部开发入口：[`packages/extension-sdk/extension-host/README.md`](../../packages/extension-sdk/extension-host/README.md)。
- 📦 `packages/shared/`
  - 通用的工具函数、通用的类型定义 (`JsonValue`, `createId`, 时间处理等)。
- 📦 `packages/diagnostics/` & `packages/trace-audit/`
  - 提供系统级错误收集与运行时审计支持。

当前只有 `packages/loom-runner` 和 `packages/application-runtime` 可以直接依赖 `@loom/core`。前者提供平台 adapter，后者只在第一方 PromptBuild pipeline 内使用 Core public API。Kernel、Document Store、Extension Host、Client 与 Extension 不得直接依赖 Core。

## 🧩 插件库: `extensions/`

- `extensions/example-echo/`: 一个示例插件，演示如何使用 `extension-sdk` 暴露 RPC 或操作文档。

---

## 给 AI 助手的特别提示

1. 当你需要理解 **Application Runtime 公共合同** 时，先看 `packages/application-runtime/README.md`，再按需进入 `src/types.ts`；持久化类型还需查看对应领域 Store。
2. 当你需要修改 **前端 UI 界面** 时，先定位页面级 widget，再把业务状态、RPC 与领域算法放回对应 `features/`。widget 只保留布局、局部交互和 props 传递。
3. 当你需要查看 **RPC 如何分流** 时，先看 `apps/studio-server/src/studio-rpc-router.ts`；`application.*` 的边界映射再看 `application-rpc.ts`。
4. **绝对不要** 为了贪图便利在不合适的层级写代码（比如在 `kernel` 里写 `Prompt` 的解析）。
