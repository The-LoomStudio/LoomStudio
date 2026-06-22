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
  - 全局的 Context、状态容器初始化 (`useStudioState.ts`) 以及样式入口 (`App.module.css`)。这是组装所有功能块的心脏。
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
  - **复杂或独立的业务块组件**，它们会直接调用 `features/`。
  - `narrative-canvas/`: 聊天会话与时间线画板。
  - `master-detail-editor/`: 左右分栏的主详细视图编辑器基座。
  - `input-dashboard/`: 聊天底部输入区。
  - `preset-workbench/`, `context-workbench/`: 相关工作台。
  - `api-panel/`, `inspector-panel/`, `resource-panel/`: 其他工具面板。
- `shared/`
  - 全局复用的 UI 组件 (`ui/` 下的无状态组件如 `json-block`, `file-tree`)、工具函数和 `i18n`。
- `pages/`
  - 顶级页面路由容器。

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
2. 当你需要修改 **前端 UI 界面** 时，直接去 `apps/studio-client/src/widgets/` 下寻找对应的面板，其底层状态去 `apps/studio-client/src/features/` 找。
3. 当你需要查看 **RPC 路由是如何注册的** 时，去 `apps/studio-server/src/application-rpc.ts` 查看。
4. **绝对不要** 为了贪图便利在不合适的层级写代码（比如在 `kernel` 里写 `Prompt` 的解析）。
