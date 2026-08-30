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
| `runtime.ts`                                    | `ApplicationRuntime` facade 与领域流程组装             |
| `types.ts`                                      | 公共 Application 合同                                  |
| `application-context.ts`                        | Store、Gateway、Registry、Logger、Clock 等内部基础设施 |
| `document-types.ts`                             | 第一方 Application Document Types                      |
| `card.ts`、`workspace.ts`                       | Card、Bundle、Artifact 和 Prompt Resource 导入导出     |
| `prompt-builder.ts`、`prompt-build-pipeline.ts` | Composition 与 Loom Core Pipeline                      |
| `prompt-activation.ts`、`variables.ts`          | Activation 和只读变量宏                                |
| `agent/`、`agent-turn.ts`                       | Tool Registry、Prompt、Provider Step 与 Tool Loop      |
| `gateway.ts`、`provider-payload.ts`             | Provider Profile、Gateway 与 wire payload adapter      |
| `state.ts`、`state-definition.ts`               | State Mutation、Revision、Definition 与 Binding        |
| `history-text.ts`                               | History Transform、Extractor 与 Renderer Projection    |

`ApplicationRuntimeContext` 保存稳定基础设施，不保存 `sessionId`、`branchId`、`userInput` 等请求业务事实。调用相关身份和关联信息通过操作参数与 `RuntimeRequestContext` 显式传递。

## 依赖边界

- 领域存储：Agent、Narrative、Prompt Resource、State、Document；
- 平台能力：Data Engine、AI Gateway、Secret Store、Logging、Shared；
- `@loom/core`：只用于第一方 PromptBuild Pipeline；
- `undici`：OpenAI-compatible Gateway 的代理传输。

本包不注册 HTTP/JSON-RPC 路由，不拥有 React/Zustand 状态，不提供 Kernel RPC/Event/Extension Host，也不实现各 Store 的 SQLite 内部细节。Shared Data Engine 和 Prompt Resource Store 在当前运行时是必需依赖。

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
