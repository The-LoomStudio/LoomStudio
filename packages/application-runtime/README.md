# `@loom-studio/application-runtime`

> **状态**：Active Package Guide / Current Source Is Authority

Application Runtime 是 Studio 第一方 AIRP Application 的领域编排层。它拥有 Card、Provider、Agent、Narrative、State、PromptBuild、History Pipeline 与导入导出流程；它不属于 Kernel，也不是 ordinary Extension。

## 公共入口

Package 根入口通过 [`src/index.ts`](./src/index.ts) 暴露 public API，构建产物是 `dist/index.js` 与 `dist/index.d.ts`。离线 Card/Prompt Resource 编解码与扩展导入校验使用 [`@loom-studio/application-runtime/artifacts`](./src/artifacts.ts) 公共子入口，避免加载 Runtime 组合根及 Agent 执行器；类型同样可从该入口导入。根入口保持兼容。主要能力包括：

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
| [`src/runtime/runtime.ts`](src/runtime/runtime.ts)、[`src/runtime/`](src/runtime/) | `ApplicationRuntime` facade 与领域流程组装；没有根 `src/runtime.ts` 源码入口 |
| `types.ts`                                      | 公共 Application 合同                                  |
| `foundation/application-context.ts`            | Store、Gateway、Registry、Logger、Clock 等内部基础设施 |
| `foundation/document-types.ts`                 | 第一方 Application Document Types                      |
| `cards/card.ts`、`cards/workspace.ts`、`cards/workspace-codec.ts` | Card、Bundle、Artifact 和 Prompt Resource 导入导出、编解码与 SillyTavern 兼容转换 |
| `prompt/prompt-builder.ts`、`prompt/prompt-build-pipeline.ts` | Composition 类型与宽松 DFS 编译器（缺失项跳过、宏保留警告不阻断） |
| `prompt/prompt-activation.ts`、`prompt/variables.ts` | Activation 和只读变量宏                            |
| `narrative/sampling.ts`                        | Narrative 历史采样器（支持 tail / range 截取与节点/字符预算控制） |
| `agents/`                                     | Tool Registry、Prompt、Provider Step 与 Tool Loop      |
| [`agents/agent-tool-scope.ts`](src/agents/agent-tool-scope.ts) | 本轮工具 State/资源/Narrative I/O 能力组装；显式绑定请求身份与目标，不在 PromptBuild 函数中实现写入 |
| `agents/codeact/`                              | 官方 CodeAct 沙箱环境（基于 QuickJS）、VFS 操作与 `readNarrative` |
| `vfs/`                                        | 面向智能体的虚拟文件系统映射与网关                     |
| `providers/`                                  | Provider Profile、Gateway、wire payload adapter 与软引用容错 |
| [`observability/`](./src/observability/README.md) | Provider 请求与 Runtime / PromptBuild 观测；内存 Store 与可选快照持久化 |
| [`archive/`](./src/archive/README.md)          | Timeline Archive 编解码与扩展参与者注册；导入恢复由 Narrative Runtime 组装 |
| [`profiles/`](./src/profiles/)                 | 用户资料与全局背景集合；背景增删要求当前文档版本并引用已存在的受支持栅格媒体；[用户资料生命周期架构](../../docs/architecture/application/user-profiles.md) |
| `state/`                                      | State Mutation、Revision、Definition 与 Binding        |
| `transforms/`                                 | History Transform、Extractor 与 Renderer Projection    |
| `scripts/`                                    | Loom Script Metadata、编解码与挂载解析                 |

`ApplicationRuntimeContext` 只保存稳定的基础设施组件（Stores、Gateway、Registry、Logger、Clock 等），**严禁保存 `sessionId`、`branchId`、`userInput` 等具体请求的业务事实**。调用相关身份、请求载荷与关联信息必须通过具体操作参数或 `RuntimeRequestContext` 显式传递。

## 依赖边界与架构规约

- **领域存储依赖**：统一依赖 `@loom-studio/application-data`（内聚托管 Agent Session/Transcript、Narrative Timeline/Branch/Node、State 与 Prompt Resource 树）以及 `@loom-studio/document-store`（管理版本化快照文档）。
- **平台与基础设施**：`@loom-studio/data-engine`、`@loom-studio/ai-gateway`、`@loom-studio/secret-store`、`@loom-studio/logging`、`@loom-studio/shared`、`@loom-studio/extension-sdk`、`@loom-studio/tokenizer`（统一文本计数及交接摘要上限）。LLM SDK 和 Provider Schema 由 `ai-gateway` 持有；Runtime 不直接接入厂商 SDK。
- **外部网络与执行依赖**：`undici`（模型服务请求及 `ProxyAgent` 代理支持）、`quickjs-emscripten`（CodeAct Worker 执行）、[`yaml`](./src/vfs/resource-filesystem.ts)（VFS 的 YAML 元数据/State 编解码）、[`diff`](./src/vfs/resource-filesystem.ts)（VFS Prompt Resource unified patch；[`session-summary.ts`](./src/agents/session-summary.ts) 也用它应用摘要 patch）。这些职责应复用现有入口，不在消费者中另写解析器或补丁应用逻辑。
- **宽松引用与容错构建**：删除 Provider/Model、Agent Preset 或被引用的 Lore 保留下游软引用，不自动改绑；必要 Provider Profile/Preset/Model 缺失时执行失败。PromptBuild 对可跳过的缺失 Lore/Tool 发出警告并跳过，未解析宏保留原文；这不意味着必要资源缺失或存储失败也可以忽略。
- **Agent 身份**：普通 `kind: agent` Session 创建时固定引用 Agent Preset，换预设须新建 Session；特殊 `kind: timeline` Session 与 Timeline 同 ID，可暂时没有 Preset。修改 Preset 或 `narrativeMode` 时，Store 拒绝最新 Run 为 `created`、`running`、`suspended`，或 `failed` 且仍有 `recovery` 检查点；不一概禁止所有失败 Run。允许更新时继续使用同一工作历史。Preset 聚合编排、历史/交付配置、可选模型绑定及资源使用配置。Agent Profile 层已取消，Provider Profile 仍是独立模型连接配置。合同见 [`AgentSession` Store](../application-data/src/agent/store.ts) 与[Agent 身份架构](../../docs/architecture/application/agent/runtime-and-session.md#1-身份与绑定)。
- **定义与消费分离**：预设 Lore Mount 显式采用 Lore，`useGlobalLore` 控制已挂载的全局 Lore 继承（默认开启），`useCardLore` 控制默认角色 Lore，`textUses` 覆盖正则/提取器启用与顺序，Tool Mount 配置工具。未挂载的公共 Lore 不默认注入，公共正则按上下文参与默认消费；引用不改变归属或绕过安装可用性。切换 Session 不启停整个扩展，也不建立预设专属代码实例。
- **单资源导出**：输出资源树、作者宏及已实现的使用配置引用，不递归包含脚本、规则定义或关联资源内容；只有实际纳入扩展文件及贡献清单的资源才随扩展包分发。见[资源归属与使用配置](../../docs/architecture/application/prompt-build/README.md#资源归属与使用配置)。

本包不注册 HTTP/JSON-RPC 路由，不拥有 React/Zustand 前端状态，不提供 Kernel 核心路由，也不直接操作 SQLite 裸连接。装配接收独立 Store，而不是 `ApplicationDataStore` 聚合对象：`dataEngine`、`documents`、`promptResources` 必需；`states` 可基于同一 Engine 创建，Agent/Narrative 操作要求对应的 `agents` / `narratives` 已注入，见 [`application-context.ts`](./src/foundation/application-context.ts)。

## 提交与消费合同

- **用户正文先落库**：Timeline 正文输入先通过 Narrative API 保存节点，成功后再单独投递 Timeline 根 Session；append 本身不启动 Agent。`invokeAgentTurn.narrativeTarget.inputNodeId` 必须指向目标分支已有节点；[`prepareAgentTurn()`](./src/runtime/agents-runtime.ts) 从节点 `body.raw` 读取输入，不使用调用方重复携带的文本。投递失败保留已提交节点；重投递沿用该 Timeline 根 Session 和原节点 ID，不提供改投普通副 Session 的路径。
- **Agent 正文只走工具**：Assistant 最终回复只保存在 Transcript，不自动追加 Narrative。未提供 `inputNodeId` 的调用也不自动写入用户正文。已注册工具执行中的非取消异常（包括正文写入冲突）由 [`tool-registry.ts`](./src/agents/tool-registry.ts) 转为 failed Tool Result，再由 [`tool-loop.ts`](./src/agents/tool-loop.ts) 保存并返回后续 Provider Step。
- **分阶段提交**：Transcript 与工具副作用各按自己的事务提交；Provider 或后续步骤失败不回滚先前提交。返回的 `mutation.scope: 'agent-session-transcript'` 及 Changeset 不是整轮 Tool Loop 的原子回滚凭证。消费者应保留已提交身份，将刷新失败与写入失败分开处理。
- **Prompt 资源 CAS**：资源更新沿用调用方 `expectedVersion`，冲突不自动覆盖。编辑消费者保留草稿及原基线；只有用户显式重新应用时才读取最新资源、合并已编辑字段并按最新版本再次 CAS，不复活远端已删除节点。该消费边界见 [草稿回归用例](../../tests/unit/client/context-asset-drafts.test.ts)。
- **分页必须完整消费**：Profile 等列表返回 `nextCursor`，不能把首个 100 条当作全量。全量读取沿 cursor 收集后发布；Runtime 的 Document 收集与 Prompt Resource 稳定 ID 扫描见 [`foundation/document-store.ts`](./src/foundation/document-store.ts)、[`cards/workspace.ts`](./src/cards/workspace.ts)。Keyset 仍是动态遍历，不提供跨请求快照。

CodeAct 的 QuickJS/VFS 与 `readNarrative` 只代表当前已接入的执行和读取能力，不代表完整 Memory/Session 生命周期已完成。未装配 Narrative Context Provider 时，被动 Prompt 构建仍有 recent-100 回退及诊断，它不是冻结的 Memory 基线；主动工具读取不继承这一回退，见[默认剧情上下文来源](../../docs/architecture/application/extension/narrative-context.md)与 [`agents-runtime.ts`](./src/runtime/agents-runtime.ts)。

## 跨文件定位

| 任务 | 调用入口与下游 | 验证入口 |
|---|---|---|
| Agent PromptBuild、消息顺序、Anchor / Slot | [agents-runtime.ts](src/runtime/agents-runtime.ts) → [composeAgentTurnPrompt](src/agents/agent-turn.ts) → [compilePromptDataModel](src/prompt/prompt-build-pipeline.ts) | [default-preset.test.ts](../../tests/integration/application-runtime/default-preset.test.ts) |
| Session 历史、摘要后的工作段 | [session-history.ts](src/agents/session-history.ts) | [session-history.test.ts](../../tests/integration/application-runtime/session-history.test.ts) |
| Run 冷恢复、检查点与工具结果 | [run-recovery.ts](src/agents/run-recovery.ts)、[tool-loop.ts](src/agents/tool-loop.ts) | [agent-run-recovery.test.ts](../../tests/integration/application-runtime/agent-run-recovery.test.ts) |
| 多开场、用户正文、分支写入 | [narrative-runtime.ts](src/runtime/narrative-runtime.ts) → [Narrative Store](../application-data/src/narrative/store.ts) | [opening-selection.test.ts](../../tests/integration/application-runtime/opening-selection.test.ts)、[narrative-timeline.test.ts](../../tests/integration/application-runtime/narrative-timeline.test.ts) |
| CodeAct 与虚拟文件读取 | [execute.ts](src/agents/codeact/execute.ts)、[vfs/](src/vfs/) | [codeact-tool-loop.test.ts](../../tests/integration/application-runtime/codeact-tool-loop.test.ts)、[resource-vfs.test.ts](../../tests/integration/application-runtime/resource-vfs.test.ts) |
| Provider / Runtime 观测及可选持久化 | [observability/README.md](src/observability/README.md) | [observability.test.ts](../../tests/unit/application-runtime/observability.test.ts)、[observability-persistence.test.ts](../../tests/unit/application-runtime/observability-persistence.test.ts) |
| Timeline Archive 与参与者数据 | [archive/README.md](src/archive/README.md)、[`narrative-runtime.ts`](src/runtime/narrative-runtime.ts) | [timeline-archive-participant.test.ts](../../tests/unit/application-runtime/timeline-archive-participant.test.ts)、[extension-record-archive.test.ts](../../tests/integration/application-runtime/extension-record-archive.test.ts) |

按改动选取相关用例，不默认执行整张表。文件存在与测试通过均不代表全部产品或恢复场景已经验收。

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
