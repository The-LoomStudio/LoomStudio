# 核心类型速查 (Core Types)

> **状态**：Active Reference / Current Source Is Authority

Loom Studio 使用 TypeScript 构建。以下是最关键的接口定义概念以及它们所在的位置，方便你建立心智模型并在代码中查找源码。

## 1. 内核与扩展基础设施 (Kernel & Extension)

### `Kernel` (packages/kernel/src/index.ts)
整个 Studio 后端的单例大脑。它只对外暴露几个关键能力：
- `registerKernelRpc` / `registerExtensionRpc`
- `callRpc`
- `getEventBus` / `getDocumentStore` / `getDiagnostics` / `getTraceAudit` / `getLoomRunner`

### `EventBus` (packages/kernel/src/index.ts)
极其简单的发布/订阅总线：
- `emit(name: string, payload: JsonValue)`
- `subscribe(patterns: string[], handler)`

### `DocumentStore` (packages/document-store/src/index.ts)
所有状态持久化接口。核心返回包含：
- `DocumentRecord`: `{ id, type, version, content: JsonValue, meta }`

### `ExtensionHost` (packages/extension-host/src/index.ts)
加载和卸载插件。
- `ExtensionManifest`: 插件描述文件 schema (name, version, engines, contributes)。

---

## 2. 应用层运行时 (Application Runtime)

这些定义位于 `packages/application-runtime/src/types.ts`。

### `ApplicationRuntime`
应用层的入口点，包含所有的 `createCard`, `createSession`, `submitTurn`, `previewPrompt` 方法定义。

### `AiGateway` & `ApplicationProvider`
处理与模型 API 的交互。
- `invokeChat(input: GatewayInvokeChatInput): Promise<GatewayChatResult>`

### `CompiledPrompt` (packages/application-runtime/src/prompt-builder.ts)
由 `PromptBuilder` 生成的最终可以发给模型的结构化对象。包含了根据不同 Zone 拼装好的 messages 以及 tool 列表。

---

## 3. UI 实体层 (Apps: Studio Client)

这些定义位于 `apps/studio-client/src/entities/` 目录下。

### `Session` & `Narrative` (entities/session.ts, entities/narrative.ts)
前端用来展示会话时间轴的实体状态。不同于后端纯粹的 CRUD，这里会封装很多用于 UI 渲染的计算属性（例如计算一棵 `Tree` 状时间线变成线性的可滚动列表）。

### `Card` (entities/card.ts)
前端操作角色卡编辑页面的双向绑定模型。

---

## 4. Loom Core 概念 (来自 `@loom/core`)

> `@loom/core` 位于 `packages/core`。Kernel/RPC 通过 `loom-runner` 与 Core 交互；第一方 Application Runtime 的 PromptBuild pipeline 也会直接使用 Core public API。

### `Fragment`
不可变的文本块。一切提示词最终都会被扁平化或组合成 Fragment 数组。
### `PassConfig`
描述了一段处理管线，例如将特定标记替换，或者调用某个 LLM Provider。
### `LoomRunner` (packages/loom-runner/src/index.ts)
`run(input: LoomRunInput)`: 接收片段和 Pass 列表，返回处理后的片段和执行踪迹 (Trace)。
