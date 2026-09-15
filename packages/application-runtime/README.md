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
| `cards/card.ts`、`cards/workspace.ts`、`cards/workspace-codec.ts` | Card、Bundle、Artifact 和 Prompt Resource 导入导出与编解码 |
| `prompt/prompt-builder.ts`、`prompt/prompt-build-pipeline.ts` | Composition 类型与当前 DFS 编译器             |
| `prompt/prompt-activation.ts`、`prompt/variables.ts` | Activation 和只读变量宏                            |
| `agents/`                                     | Tool Registry、Prompt、Provider Step 与 Tool Loop      |
| `providers/`                                  | Provider Profile、Gateway 与 wire payload adapter      |
| `state/`                                      | State Mutation、Revision、Definition 与 Binding        |
| `transforms/`                                 | History Transform、Extractor 与 Renderer Projection    |
| `scripts/`                                    | Loom Script Metadata、编解码与挂载解析                 |

`ApplicationRuntimeContext` 只保存稳定的基础设施组件（Stores、Gateway、Registry、Logger、Clock 等），**严禁保存 `sessionId`、`branchId`、`userInput` 等具体请求的业务事实**。调用相关身份、请求载荷与关联信息必须通过具体操作参数或 `RuntimeRequestContext` 显式传递。

## 依赖边界与架构规约

- **领域存储依赖**：统一依赖 `@loom-studio/application-data`（内聚托管 Agent Session/Message、Narrative Timeline/Branch/Node、State 与 Prompt Resource 树）以及 `@loom-studio/document-store`（管理版本化快照文档）。
- **平台与基础设施**：`@loom-studio/data-engine`、`@loom-studio/ai-gateway`、`@loom-studio/secret-store`、`@loom-studio/logging`、`@loom-studio/shared`、`@loom-studio/extension-sdk`。
- **外部网络依赖**：`undici`（用于与模型服务通信及 `ProxyAgent` 代理支持）。

本包不注册 HTTP/JSON-RPC 路由，不拥有 React/Zustand 前端状态，不提供 Kernel 核心路由，也不直接操作 SQLite 裸连接。`DataEngine` 与 `ApplicationDataStore` 是运行时装配的必需依赖。


## 构建与验证

```bash
pnpm --filter @loom-studio/application-runtime build
pnpm exec vitest run tests/unit/application-runtime tests/integration/application-runtime
```

当前 Package `test` 脚本仍指向已不存在的旧测试入口；验证 Runtime 合同时使用上面的根目录命令。

## 正式文档

- [Application Architecture](../../docs/architecture/application/README.md)
- [Agent Architecture](../../docs/architecture/application/agent/README.md)
- [PromptBuild Architecture](../../docs/architecture/application/prompt-build/README.md)
- [State and Variables](../../docs/architecture/application/state-and-variables.md)
- [History Text Pipeline](../../docs/architecture/application/history-text-pipeline.md)
- [Extension Data and Portable Payload](../../docs/architecture/application/extension/data-and-portable-payload.md)
