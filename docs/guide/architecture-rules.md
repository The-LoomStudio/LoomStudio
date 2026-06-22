# 架构治理法则 (Architecture Rules)

Loom Studio 随着功能的增长，最容易腐化的区域是应用运行时（Application Runtime）的大杂烩、Server 层的越权行为以及事件流的失控。以下是不可逾越的硬性法则。

## 1. 包引用边界 (Package Exports)

- 所有的包间引用**必须**通过公共入口（`src/index.ts`），**绝对禁止**内部文件的深度引用 (Deep Import，例如 `import { X } from '@loom-studio/kernel/src/internal/x'`)。
- **依赖方向只能自上而下**：`apps/` -> `packages/application-runtime` -> `packages/kernel` -> 基础包。绝不允许出现反向依赖。
- `@loom-studio/shared` 只放基础工具和 JSON 定义，绝不能成为放置跨域业务实体的"垃圾桶"。

## 2. Server 的身份限定

`apps/studio-server` **仅仅是一个组装根 (Composition Root)**。
它的职责仅限于：启动进程、挂载 WS/HTTP 服务、注册 RPC 路由字典、实例化各层依赖。
它**绝对不能**承担任何业务规则的判定（如：不写长篇的 Switch Case 判断不同的业务动作，不负责 Provider 的选择逻辑，不解析 Prompt）。所有的业务逻辑必须在 `application-runtime` 内部消化闭环。

## 3. 能力与 RPC 的单一发现面

无论是 Kernel 级别、Application 级别还是 Extension 提供的 RPC，**都必须能在一个统一的发现面上被注册和获取**（通常通过 `system.introspect`）。
在注册 RPC 或 Capability 时，必须明确提供所有者标识 (`owner`)、命名空间和类型签名。禁止为了偷懒而"旁路"系统字典直接监听方法。

## 4. 事件 (Events) 约束法则

不要把全局的 Event Bus 当成任意通信的 Command Bus。我们严格限制事件必须先分类再命名：

- **Fact Event (事实)**：已发生的事实，如 `docs.changed`, `run.completed`。必须在状态真正落库后才发出。
- **Notification Event (通知)**：状态刷新通知，不承载完整业务数据，如 `diagnostics.updated`。
- **Stream Event (流)**：持续更新的数据，如 `provider.stream.chunk`。
- **Lifecycle Event (生命周期)**：如 `extension.activated`。

**命名规范**：`<namespace>.<past-tense-or-state>` (如 `docs.changed`)。严禁使用诸如 `update`, `onProviderData` 这种意义不明的动词。
> **特别注意**：`docs.changed` 仅仅是一个数据库事实，不要用它来驱动特定的上层业务逻辑（例如"收到 docs.changed 就认为对话生成完毕"是极其错误的设计）。上层逻辑应该触发或监听专门的领域事件，如 `run.completed`。

## 5. Application Runtime 的领域切片

如果 `packages/application-runtime/src/runtime.ts` 超过了 300 行并包含多领域的流程处理，这就是架构异味。
- `runtime.ts` 应当只负责模块组装。
- 新增领域概念时，必须按业务切分到具体的领域目录（如 `cards/`, `sessions/`, `providers/`）。
- 切分出的每个领域都应维护自己的命令、查询和相关的 Schema，模块间必须通过暴露的接口交互，不互相读内部状态。

## 6. 第三方依赖与技术栈底线 (Dependency Strategy)

我们奉行**少即是多**与**高扩展性**的基准：
- **基础运行时**：始终保持 Node-compatible baseline。Bun 可作为可选的加速方案，但绝不是平台契约。
- **校验库边界化**：我们使用 `zod`，但**仅限在边界使用**（如 Manifest 解析、Transport envelope、入库防线）。严禁在内部的纯函数中到处套 schema，或用 zod 替代 TypeScript 的原生类型。
- **UI 选型红线**：严禁把 Tailwind 或重型 UI 组件库（如 antd, mui, shadcn/ui）作为全局 baseline。这会严重破坏后续的用户 CSS 覆盖以及插件的主题扩展。我们坚守 `CSS Modules + CSS Custom Properties` 作为官方契约。
- **安全沙箱防线**：在没有真正的多进程 / VM 方案前，不要随意引入看似安全的沙箱库制造安全错觉。我们依靠 API 边界、Owner tracking 来限制越权。
