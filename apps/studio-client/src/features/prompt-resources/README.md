# Prompt Resources

负责 Prompt Resource、扩展安装信息、Lore mounts、Preset Tool mounts，以及由这些资源派生的编辑草稿和预设选择。阅读顺序：[`use-prompt-resource-workspace.ts`](./model/use-prompt-resource-workspace.ts) 看组合；[`use-prompt-resource-state.ts`](./model/use-prompt-resource-state.ts) 看远程读模型与缓存；[`use-context-assets.ts`](./model/use-context-assets.ts) 看 Context Asset 草稿写入；[`use-agent-presets.ts`](./model/use-agent-presets.ts) 看预设选择；命令和纯树操作分别看 [`use-prompt-resource-commands.ts`](./model/use-prompt-resource-commands.ts) 与 [`tree-ops.ts`](./model/tree-ops.ts)。

App 通过 `usePromptResourceWorkspace` 注入 `StudioApi`、endpoint、编辑历史记录器、操作包装器和翻译器；Widget/Workbench 消费组合结果。资源、安装和 mounts 的远程读模型使用 TanStack Query，query key 按 endpoint 分域；Context Asset 编辑草稿则是本地内存 Map，并通过串行写入队列提交。不要将草稿误当服务端缓存或绕过队列直接并发写入。Agent Preset 选择是本地偏好，资源本身来自 Prompt Resource 数据；选择状态不是预设实体的权威字段。

依赖前提：`usePromptResourceState` 需要应用树提供 `QueryClientProvider`；持久化操作经过注入的 `StudioApi`/`runAction`，本 Feature 不直接访问文件系统或 Server 存储。改查询与 invalidation 改 `use-prompt-resource-state.ts`；草稿和版本提交改 `use-context-assets.ts`；预设选择偏好改 `use-agent-presets.ts`；领域命令改 commands；纯树变换改 `tree-ops.ts`；UI 改 `ui/`。跨 Feature 组合回到 App facade，不从兄弟 Feature deep import。

业务数据合同见[系统总览](../../../../../docs/architecture/system-overview.md)与[Client FSD 约定](../../../README.md#源码导航与-fsd-架构规范)。相关验证入口：[资源缓存](../../../../../tests/unit/client/prompt-resource-cache.test.ts)、[命令](../../../../../tests/unit/client/prompt-resource-commands.test.ts)、[Context Asset](../../../../../tests/unit/client/context-assets.test.ts)、[Lore 使用配置](../../../../../tests/unit/client/preset-lore-uses.test.ts)。按修改的责任层选择。
