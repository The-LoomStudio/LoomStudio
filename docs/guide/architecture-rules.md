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

## 3. Kernel 与 Extension 的能力发现

Kernel 与 Extension RPC 必须注册到同一个 Runtime Registry，并通过 `system.introspect` 暴露 owner 与命名空间。Application、AI、Settings 与 Logs 属于 Studio Server 内部路由，以当前源码和类型为事实源，不再维护平行的静态 Capability 目录。

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

正式能力所有权见 [`Architecture / External Dependency Ownership`](../architecture/platform/external-dependency-ownership.md)。开发时默认先复用已经拥有该语义的依赖或项目 adapter，尤其不要平行重写远端缓存、路由、菜单焦点、虚拟列表、Schema parser、ZIP 和数据库事务。

这不是永久白名单。现有选择无法覆盖真实语义，或其包体积、安全、宿主边界不适用时，可以使用原生能力或更小的局部实现；但不能让新旧实现长期共同拥有同一份可写状态。形成新公共基础设施或替换现有所有者时，必须把理由、迁移边界和删除旧路径的条件写入 Workbench Issue/Plan。

- **基础运行时**：保持 Node-compatible baseline；其他运行时不是当前平台合同。
- **校验库边界化**：新增跨端结构化边界且没有既有 parser 时优先评估 `zod`，不扩散到可信内部纯函数，也不机械替换现有专用 parser。
- **UI 样式合同**：第一方 UI 使用 SCSS Modules 与 CSS Custom Properties。新增全局 CSS 框架或重型组件库属于架构变更。
- **安全沙箱防线**：没有真正的多进程 / VM 隔离时，不引入只提供表面限制的沙箱库制造安全错觉。
