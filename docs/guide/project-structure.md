# 项目全量文件地图 (Project Structure)

Loom Studio 使用 `pnpm` workspace 构建了一个 Monorepo。本项目主要分为三大代码区域：`packages/` (内核与领域逻辑), `apps/` (独立应用程序), `extensions/` (插件实例)。

## 依赖关系方向

> **核心原则：内层不依赖外层。**
> `packages/` 内层包 **绝对不可** import `apps/` 或外部特定实现。
> 依赖方向始终是单向箭头： `apps/` -> `packages/` -> `@loom/core` (通过 runner)。

---

## 💻 前端架构: `apps/studio-client/src/`

前端采用严格的按业务职能分层，而非简单按 UI 组件分类。

- `app/`
  - 顶层 App 组装、状态 facade (`use-studio-state.ts`) 以及样式入口 (`app.module.css`)。这是组装所有功能块的心脏。
- `entities/`
  - 承载所有的**业务数据类型与实体抽象** (`card.ts`, `session.ts`, `narrative.ts`, `prompt.ts`, `workspace.ts` 等)。
  - 这里定义了前端视角的数据结构。
- `features/`
  - 纯粹的**业务逻辑模型与钩子 (Hooks)**，按领域划分：
    - `cards/`: 角色卡业务
    - `session-runtime/`: 会话与流式对话逻辑
    - `prompt-build/` & `context-assets/`: 设定与提示词装配
    - `provider-settings/`: API与模型供应商配置
- `widgets/`
  - **复杂或独立的业务块组件**，负责页面级 UI 组合和局部交互。跨领域状态与 RPC 流程应放在 `features/` 或 app facade 中，不要塞回 widget。
  - `narrative-canvas/`: 聊天会话与时间线画板。
  - `master-detail-editor/`: 左右分栏的主详细视图编辑器基座。
  - `input-dashboard/`: 聊天底部输入区。
  - `preset-workbench/`, `context-workbench/`: 相关工作台。
  - `api-panel/`, `inspector-panel/`, `resource-panel/`: 其他工具面板。
- `shared/`
  - 全局复用的 UI 组件 (`ui/` 下的无状态组件如 `json-block`, `file-tree`)、工具函数和 `i18n`。
- `pages/`
  - 顶级页面路由容器。

### Client 放置规则

新增前端代码前，先按下面顺序判断位置：

1. **跨领域基础能力**放 `shared/`：typed API client、无业务含义的 UI、通用 hooks、i18n、纯工具。
2. **领域类型**放 `entities/`：前端视角的业务数据结构和很薄的纯函数。
3. **业务状态、RPC 编排、领域算法**放 `features/*/model`：例如 context tree mutation、projection order、provider config 映射、session runtime action。
4. **领域绑定 UI**放 `features/*/ui`：需要认识某个 feature 类型，但不拥有跨领域流程。
5. **页面级组合**放 `widgets/`：组合 feature/entity UI，承载局部 UI 状态和布局，不拥有 RPC 流程或复杂领域算法。
6. **全局组装**放 `app/`：只做 provider、page shell、facade 组合和顶层 glue。

以下信号出现时，先停下来拆边界，不要继续往同一个文件里塞：

- `use-studio-state.ts` 开始直接实现新领域逻辑，而不是组合 feature hook。
- widget 内出现 `bridge.call(...)`、跨 feature refresh choreography、树递归修改、provider config normalization。
- React 组件文件为了复用类型而向 `widgets/` 内部互相 deep import。
- 单个 hook 同时处理 RPC、form state、derived data、event subscription。
- 新组件文件使用 `PascalCase.tsx` 或 CSS Module 使用 `PascalCase.module.css`。

### Client 任务路由表

如果你没有上下文，先按任务类型定位，不要从 `App` 或 widget 盲目向下翻。

| 任务                                    | 先看                                                        | 常见改动位置                                                                                           | 对应测试                                                                                      |
| --------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| 修改角色卡列表、创建卡、选中卡          | `features/cards/model/use-cards.ts`                         | `entities/card.ts`, `widgets/resource-panel/`                                                          | `tests/unit/client/cards.test.ts`                                                             |
| 修改会话、分支、发送消息流程            | `features/session-runtime/model/use-session-runtime.ts`     | `entities/session.ts`, `widgets/narrative-canvas/`, `widgets/input-dashboard/`                         | `tests/unit/client/session-runtime.test.ts`                                                   |
| 修改 Context Assets 树操作              | `features/context-assets/model/tree-ops.ts`                 | `context-asset-tree.ts`, `context-asset-normalization.ts`, `widgets/context-workbench/`                | `tests/unit/client/context-assets.test.ts`                                                    |
| 修改 projection order / projection view | `features/context-assets/model/projection-order.ts`         | `projection-view.ts`, `projection-workbench.ts`, `features/context-assets/ui/projection-order-editor/` | `tests/unit/client/projection-order.test.ts`                                                  |
| 修改 Prompt Build 展示步骤              | `features/prompt-build/model/build-prompt-build-steps.ts`   | `widgets/prompt-build-flow/`, `widgets/inspector-panel/`                                               | `tests/unit/client/prompt-build-steps.test.ts`                                                |
| 修改 Provider / Model Profile 设置      | `features/provider-settings/model/use-provider-settings.ts` | `model-profile-config.ts`, `widgets/api-panel/`                                                        | `tests/unit/client/provider-settings.test.ts`                                                 |
| 修改 typed Studio API client            | `shared/api/studio-api.ts`                                  | `apps/studio-server/src/application-rpc.ts`, consuming feature hooks                                   | `tests/unit/client/studio-api.test.ts`                                                        |
| 修改 renderer PoC session               | `features/renderer-poc/model/use-renderer-session.ts`       | `shared/api/renderer-api.ts`, `widgets/resource-panel/`                                                | `tests/unit/client/renderer-events.test.ts`                                                   |
| 修改 Rendering Lab sample / postMessage | `features/rendering-lab/model/`                             | `widgets/rendering-lab/`, `widgets/inspector-panel/`                                                   | `tests/unit/client/rendering-lab-sample.test.ts`, `tests/unit/client/renderer-events.test.ts` |
| 修改通用文件树交互                      | `shared/ui/file-tree/file-tree-model.ts`                    | `shared/ui/file-tree/file-tree.tsx`                                                                    | `tests/unit/client/file-tree.test.ts`                                                         |
| 修改页面整体排布                        | `pages/studio/studio-page.tsx`                              | `app/app.tsx`, `widgets/*`                                                                             | 先跑相关 feature test，再跑 client build                                                      |
| 新增用户可见文案                        | `shared/i18n/en-us.ts`, `shared/i18n/zh-cn.ts`              | 使用方组件或 feature                                                                                   | 相关 feature test / client build                                                              |

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

- `main.ts`: 服务器启动入口，实例化各个 Store、Kernel、Host。
- `http-server.ts`: 挂载 WebSocket (ws) 引擎与基础的 HTTP Express 路由。
- `application-rpc.ts`: 庞大的 Application 层 RPC 方法实现，负责将客户端请求转发至 `ApplicationRuntime`。
- `studio-rpc-router.ts`: Kernel Rpc 的转发器。
- `rpc-capability.ts`, `rpc-params.ts`: RPC 参数解析与权限能力定义工具。

---

## 📦 核心领域包: `packages/`

这些包大多是独立于运行环境的（Node / Browser 均可或有明确边界）。

- 📦 `packages/application-runtime/` (AIRP Layer)
  - Studio 的**业务心脏**。包含 Session, Card, Agent, PromptBuilder, Document Types 定义，以及对接模型的 Gateway。前后端都在共享此包定义的 Schema。
- 📦 `packages/kernel/`
  - Studio 的底层发动机，管理内部的六个核心服务（RPC注册, 事件总线等）。**禁止包含任何 AI/业务（Provider/Agent）逻辑。**
- 📦 `packages/document-store/`
  - 承载所有的状态与数据持久化逻辑（目前后端使用 SQLite 适配器实现）。
- 📦 `packages/transport/`
  - 定义了系统内所有 RPC 消息、事件通知的格式 (Message Envelope)。
- 📦 `packages/client-bridge/`
  - 供前端使用的 Bridge SDK，连接到后端的 Transport 以进行远程调用。
- 📦 `packages/loom-runner/`
  - 唯一允许 import `@loom/core` 的包。负责包装 Core Runtime 供 Studio 调用。
- 📦 `packages/extension-sdk/`
  - 提供给第三方开发者的插件开发 SDK。其内包含了 `extension-host` (管理插件加载生命周期的宿主)。
- 📦 `packages/shared/`
  - 通用的工具函数、通用的类型定义 (`JsonValue`, `createId`, 时间处理等)。
- 📦 `packages/diagnostics/` & `packages/trace-audit/`
  - 提供系统级错误收集与运行时审计支持。

## 🧩 插件库: `extensions/`

- `extensions/example-echo/`: 一个示例插件，演示如何使用 `extension-sdk` 暴露 RPC 或操作文档。

---

## 给 AI 助手的特别提示

1. 当你需要理解 **核心业务数据结构** 时，第一步应当查看 `packages/application-runtime/src/types.ts`。这里定义了所有的类型。
2. 当你需要修改 **前端 UI 界面** 时，先定位页面级 widget，再把业务状态、RPC 与领域算法放回对应 `features/`。widget 只保留布局、局部交互和 props 传递。
3. 当你需要查看 **RPC 路由是如何注册的** 时，去 `apps/studio-server/src/application-rpc.ts` 查看。
4. **绝对不要** 为了贪图便利在不合适的层级写代码（比如在 `kernel` 里写 `Prompt` 的解析）。
