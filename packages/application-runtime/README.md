# `@loom-studio/application-runtime`

> **状态**：Active Package Guide / Current Source Is Authority

Application Runtime 是 Studio 第一方 AIRP Application 的领域编排层。它拥有 Card、Provider、Agent、Narrative、State、PromptBuild、History Pipeline 与导入导出流程；它不属于 Kernel，也不是 ordinary Extension。

## 公共入口

Package 只通过 [`src/index.ts`](./src/index.ts) 暴露 public API，构建产物是 `dist/index.js` 与 `dist/index.d.ts`。主要入口包括：

- `createApplicationRuntime()` 与 `ApplicationRuntime` 合同；
- Application Document Types 与各领域输入输出类型；
- PromptBuild、Activation、Variable 和 History helpers；
- Provider Gateway / payload adapters；
- Agent Tool Registry、官方 Tool 与 Content Transport；
- Card Bundle、Prompt Resource 和 Portable Payload Artifact helpers。

不要 deep-import `src/*`。完整 Runtime 方法面直接查看 [`src/types.ts`](./src/types.ts)，不要在 README 复制第二份 API 清单。

## 源码导航

| 文件或目录                                      | 当前职责                                               |
| ----------------------------------------------- | ------------------------------------------------------ |
| `runtime/runtime.ts`、`runtime/`                | `ApplicationRuntime` facade 与领域流程组装；根 `runtime.ts` 仅重导出 |
| `types.ts`                                      | 公共 Application 合同                                  |
| `foundation/application-context.ts`            | Store、Gateway、Registry、Logger、Clock 等内部基础设施 |
| `foundation/document-types.ts`                 | 第一方 Application Document Types                      |
| `cards/card.ts`、`cards/workspace.ts`、`cards/workspace-codec.ts` | Card、Bundle、Artifact 和 Prompt Resource 导入导出、编解码与 SillyTavern 兼容转换 |
| `prompt/prompt-builder.ts`、`prompt/prompt-build-pipeline.ts` | Composition 类型与宽松 DFS 编译器（缺失项跳过、宏保留警告不阻断） |
| `prompt/prompt-activation.ts`、`prompt/variables.ts` | Activation 和只读变量宏                            |
| `narrative/sampling.ts`                        | Narrative 历史采样器（支持 tail / range 截取与节点/字符预算控制） |
| `agents/`                                     | Tool Registry、Prompt、Provider Step 与 Tool Loop      |
| `agents/codeact/`                              | 官方 CodeAct 沙箱环境（基于 QuickJS）、VFS 操作与 `readNarrative` |
| `vfs/`                                        | 面向智能体的虚拟文件系统映射与网关                     |
| `providers/`                                  | Provider Profile、Gateway、wire payload adapter 与软引用容错 |
| `state/`                                      | State Mutation、Revision、Definition 与 Binding        |
| `transforms/`                                 | History Transform、Extractor 与 Renderer Projection    |
| `scripts/`                                    | Loom Script Metadata、编解码与挂载解析                 |

`ApplicationRuntimeContext` 只保存稳定的基础设施组件（Stores、Gateway、Registry、Logger、Clock 等），**严禁保存 `sessionId`、`branchId`、`userInput` 等具体请求的业务事实**。调用相关身份、请求载荷与关联信息必须通过具体操作参数或 `RuntimeRequestContext` 显式传递。

## 依赖边界与架构规约

- **领域存储依赖**：统一依赖 `@loom-studio/application-data`（内聚托管 Agent Session/Transcript、Narrative Timeline/Branch/Node、State 与 Prompt Resource 树）以及 `@loom-studio/document-store`（管理版本化快照文档）。
- **平台与基础设施**：`@loom-studio/data-engine`、`@loom-studio/ai-gateway`、`@loom-studio/secret-store`、`@loom-studio/logging`、`@loom-studio/shared`、`@loom-studio/extension-sdk`。
- **外部网络与执行依赖**：`undici`（用于与模型服务通信及 `ProxyAgent` 代理支持）、`quickjs-emscripten`（用于 CodeAct 沙箱隔离执行）。
- **宽松引用与容错构建**：删除 Provider/Model、Agent Preset 或被引用的 Setting 保留下游软引用，不自动改绑；必要 Provider Profile/Preset/Model 缺失时执行失败。PromptBuild 对可跳过的缺失 Setting/Tool 发出警告并跳过，未解析宏保留原文；这不意味着必要资源缺失或存储失败也可以忽略。
- **Agent 身份**：Session 直接引用 Agent Preset；Preset 聚合编排、历史/交付配置、可选模型绑定和 Tool Mount。Agent Profile 层已取消，Provider Profile 仍是独立模型连接配置。单资源导出只输出资源树与作者宏，不递归包含脚本、规则或关联资源。

本包不注册 HTTP/JSON-RPC 路由，不拥有 React/Zustand 前端状态，不提供 Kernel 核心路由，也不直接操作 SQLite 裸连接。装配接收独立 Store，而不是 `ApplicationDataStore` 聚合对象：`dataEngine`、`documents`、`promptResources` 必需；`states` 可基于同一 Engine 创建，Agent/Narrative 操作要求对应的 `agents` / `narratives` 已注入，见 [`application-context.ts`](./src/foundation/application-context.ts)。

## 提交与消费合同

- **用户正文先落库**：调用方先通过 [`appendNarrativeInput()`](./src/runtime/narrative-runtime.ts) 调用 Store `appendInput()`，成功后再单独投递 Agent Session；append 本身不启动 Agent。`invokeAgentTurn.narrativeTarget.inputNodeId` 必须指向目标分支已有节点；[`prepareAgentTurn()`](./src/runtime/agents-runtime.ts) 从节点 `body.raw` 读取输入，不使用调用方重复携带的文本。投递失败保留已提交节点；换 Session 重投递复用该节点。
- **Agent 正文只走工具**：Assistant 最终回复只保存在 Transcript，不自动追加 Narrative。未提供 `inputNodeId` 的调用也不自动写入用户正文。已注册工具执行中的非取消异常（包括正文写入冲突）由 [`tool-registry.ts`](./src/agents/tool-registry.ts) 转为 failed Tool Result，再由 [`tool-loop.ts`](./src/agents/tool-loop.ts) 保存并返回后续 Provider Step。
- **分阶段提交**：Transcript 与工具副作用各按自己的事务提交；Provider 或后续步骤失败不回滚先前提交。返回的 `mutation.scope: 'agent-session-transcript'` 及 Changeset 不是整轮 Tool Loop 的原子回滚凭证。消费者应保留已提交身份，将刷新失败与写入失败分开处理。
- **Prompt 资源 CAS**：资源更新沿用调用方 `expectedVersion`，冲突不自动覆盖。编辑消费者保留草稿及原基线；只有用户显式重新应用时才读取最新资源、合并已编辑字段并按最新版本再次 CAS，不复活远端已删除节点。该消费边界见 [草稿回归用例](../../tests/unit/client/context-asset-drafts.test.ts)。
- **分页必须完整消费**：Profile 等列表返回 `nextCursor`，不能把首个 100 条当作全量。全量读取沿 cursor 收集后发布；Runtime 的 Document 收集与 Prompt Resource 稳定 ID 扫描见 [`foundation/document-store.ts`](./src/foundation/document-store.ts)、[`cards/workspace.ts`](./src/cards/workspace.ts)。Keyset 仍是动态遍历，不提供跨请求快照。

CodeAct 的 QuickJS/VFS 与 `readNarrative` 只代表当前已接入的执行和读取能力，不代表完整 Memory/Session 生命周期已完成。未装配 Narrative Context Provider 时，被动 Prompt 构建仍有 recent-100 回退及诊断，它不是冻结的 Memory 基线；主动工具读取不继承这一回退，见[默认剧情上下文来源](../../docs/architecture/application/extension/narrative-context.md)与 [`agents-runtime.ts`](./src/runtime/agents-runtime.ts)。

## 构建与验证

```bash
pnpm --filter @loom-studio/application-runtime build
pnpm exec vitest run tests/unit/application-runtime tests/integration/application-runtime
```

## 正式文档

- [Application Architecture](../../docs/architecture/application/README.md)
- [Agent Architecture](../../docs/architecture/application/agent/README.md)
- [Card Bundle 与资源分发](../../docs/architecture/application/card-bundle-files.md)
- [PromptBuild Architecture](../../docs/architecture/application/prompt-build/README.md)
- [State and Variables](../../docs/architecture/application/state-and-variables.md)
- [History Text Pipeline](../../docs/architecture/application/history-text-pipeline.md)
- [Extension Data and Portable Payload](../../docs/architecture/application/extension/data-and-portable-payload.md)
