# Workspace 开发入口

> **状态**：Active Guide

本页负责把开发者和 AI 从全仓文档路由到实际代码区域。它不复制各模块内部结构；进入目标 Workspace 后，以该目录的 `README.md`、当前源码和正式 Architecture 为准。

## 接手任务的最短路径

1. 用下方需求词或任务表选中一个领域，读取对应源码入口和局部 README；不先通读整个文档库或递归列目录。
2. 涉及跨模块行为时，读取该领域 Architecture；需要确认当前施工范围时再查 [Plan 索引](../workbench/plans/README.md)或 [Issue 索引](../workbench/issues/README.md)。
3. 确认一个当前实现入口、相关调用者和一项覆盖风险的验证。文档与源码冲突时，以源码与可执行证据确认事实，不能拿候选设计覆盖实际行为。

已经知道包名时直接进入下方 Workspace README；已知方法名时进入 [RPC 导航](../workbench/reference/rpc-methods.md)或[类型导航](../workbench/reference/core-types.md)。只有需要全仓视野时才读[仓库目录地图](project-structure.md)。

## 文档分工

```text
docs/guide/
  全仓开发流程、任务路由和共同规则。

apps/*/README.md / packages/*/README.md
  当前 Workspace 的职责、入口、目录、运行方式和局部边界。

docs/architecture/
  跨 Workspace 的稳定实现合同和数据流。

docs/workbench/
  当前计划、问题与参考材料；讨论在对话或 Plan 内收束，不能替代当前源码。
```

局部 README 只维护靠近代码的事实，不重复完整 API、Schema 或跨包架构。跨模块事实发生变化时更新 Architecture；局部入口、命令或目录发生变化时更新对应 Workspace README。

## 需求词与易混淆名称

本表是检索别名，不表示这些词在业务上完全等价。源码列给出第一定位点；行为以对应合同为准。

| 需求词 / 旧名称 | 当前概念与边界 | 第一源码入口 | 行为合同 |
|---|---|---|---|
| 聊天、正文、剧情、分支、开场白、多开场、Swipe | Narrative Timeline / Branch / Node；多开场初始化与运行时 Swipe 不是同一能力 | [narrative-runtime.ts](../../packages/application-runtime/src/runtime/narrative-runtime.ts) | [当前开场与 Swipe Plan](../archive/plans/opening-swipes-and-runtime-swipe-plan.md) |
| 主写作、主对话、Agent 聊天、会话恢复、继续、重试 | 接收 Session、查看 Session 与 Run 恢复分开；旧 `agent-runtime` Feature 不再是入口 | [use-narrative-runtime.ts](../../apps/studio-client/src/features/narrative-runtime/model/use-narrative-runtime.ts)、[run-recovery.ts](../../packages/application-runtime/src/agents/run-recovery.ts) | [Runtime 与 Session](../architecture/application/agent/runtime-and-session.md) |
| Agent Profile、智能体配置、预设、Agent Preset | Agent Profile 已取消；Preset 是 Prompt Resource 执行定义，不等于 Provider Profile | [use-agent-presets.ts](../../apps/studio-client/src/features/prompt-resources/model/use-agent-presets.ts) | [Agent 身份](../architecture/application/agent/README.md) |
| 世界书、设定、Lore、挂载 | 内容资源 / Lore Mount；不是应用偏好或 Provider 设置 | [prompt-runtime.ts](../../packages/application-runtime/src/runtime/prompt-runtime.ts) | [资源归属与使用配置](../architecture/application/prompt-build/README.md#资源归属与使用配置) |
| 提示词、PromptBuild、注入、Anchor、Slot、笼中深度 | Application DFS 编译；当前 Agent 路径不执行 Loom Core Pass | [agent-turn.ts](../../packages/application-runtime/src/agents/agent-turn.ts)、[prompt-build-pipeline.ts](../../packages/application-runtime/src/prompt/prompt-build-pipeline.ts) | [PromptBuild](../architecture/application/prompt-build/README.md) |
| 正则、提取器、Regex、Extractor、Display | History Text Pipeline；显示处理与存储原文分开 | [transforms-runtime.ts](../../packages/application-runtime/src/runtime/transforms-runtime.ts) | [文本管线](../architecture/application/history-text-pipeline.md) |
| HTML、Markdown、消息渲染、iframe | 消息内容展示入口；不是所有 Renderer 都属于消息正文 | [message-content/](../../apps/studio-client/src/features/message-content/) | [iframe 隔离](../architecture/ui/iframe-runtime.md) |
| CodeAct、VFS、工具、脚本执行 | Agent QuickJS 执行与受控读取；不等于 Loom Script UI Renderer | [codeact/execute.ts](../../packages/application-runtime/src/agents/codeact/execute.ts)、[vfs/](../../packages/application-runtime/src/vfs/) | [Tool 系统](../architecture/application/agent/tool-system.md) |
| Token、字数、usage、用量、估算 | UI 文本计数、请求估算、Provider 回报是不同口径 | [use-token-counts.ts](../../apps/studio-client/src/shared/tokenizer/use-token-counts.ts)、[token-estimate.ts](../../packages/ai-gateway/src/token-estimate.ts) | [Provider 与 PromptBuild](../architecture/application/agent/provider-and-prompt-build.md) |
| 撤销、Undo、Revision、版本冲突、草稿 | 编辑历史与领域事务不是整轮 Agent 回滚 | [use-edit-history.ts](../../apps/studio-client/src/features/edit-history/model/use-edit-history.ts) | [编辑与提交](../architecture/application/ui/README.md) |
| 插件、扩展、安装、授权、重载 | Extension Package / Module / Instance / Grant；声明不等于激活 | [extension-manager.ts](../../apps/studio-server/src/extensions/extension-manager.ts) | [Extension](../architecture/extensions/README.md) |
| 日志、诊断、报错、Log、Trace | 日志缓冲/历史、诊断与编译 Trace 分属不同入口 | [services.ts](../../apps/studio-server/src/rpc/trpc/services.ts) | [日志合同](../architecture/platform/logging.md) |

## 高频任务路由

| 任务                                                             | 第一入口                                                                                                   | 正式架构                                                    |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Studio 页面、FSD 业务 Feature、交互状态、typed API Client         | [`apps/studio-client/README.md`](../../apps/studio-client/README.md)                                       | [`architecture/ui/`](../architecture/ui/)                   |
| Server 进程入口、HTTP、会话认证、RPC 路由、依赖组装              | [`apps/studio-server/README.md`](../../apps/studio-server/README.md)                                       | [`architecture/kernel/`](../architecture/kernel/)           |
| Card、Narrative、Agent、State、PromptBuild 业务流程              | [`packages/application-runtime/README.md`](../../packages/application-runtime/README.md)                   | [`architecture/application/`](../architecture/application/) |
| Agent 会话/消息、时间线、状态定义与 Prompt 资源树持久化          | [`packages/application-data/README.md`](../../packages/application-data/README.md)                         | [`architecture/data/`](../architecture/data/)               |
| Kernel RPC 注册、Event Bus、提交事实投影与 Introspection         | [`packages/kernel/README.md`](../../packages/kernel/README.md)                                             | [`architecture/kernel/`](../architecture/kernel/)           |
| SQLite connection、Migration、Transaction、Commit Fact           | [`packages/data-engine/README.md`](../../packages/data-engine/README.md)                                   | [`architecture/data/`](../architecture/data/)               |
| 多模型网关调度（OpenAI/Claude/Gemini）、流式执行与 Fake Provider | [`packages/ai-gateway/README.md`](../../packages/ai-gateway/README.md)                                       | [`architecture/platform/external-dependency-ownership.md`](../architecture/platform/external-dependency-ownership.md) |
| 内容寻址二进制块存储 (SHA-256 Blob) 与原子 Finalize              | [`packages/asset-store/README.md`](../../packages/asset-store/README.md)                                     | [`architecture/data/`](../architecture/data/)               |
| 媒体资产元数据 (Media Asset) 与原始导入产物 (Source Artifact)    | [`packages/asset-store/README.md`](../../packages/asset-store/README.md)                                     | [`architecture/data/`](../architecture/data/)               |
| 敏感 API 凭据托管、Keyring/Memory 后端与受控使用                 | [`packages/secret-store/README.md`](../../packages/secret-store/README.md)                                 | [`architecture/data/`](../architecture/data/)               |
| 全仓结构化日志、Console/Memory Sink 与 Node 旋转归档             | [`packages/logging/README.md`](../../packages/logging/README.md)                                           | [`architecture/platform/logging.md`](../architecture/platform/logging.md) |
| 通用 UI 原语组件（Button/Field/Input）与图标集                   | [`packages/loom-ui/README.md`](../../packages/loom-ui/README.md)                                           | [`architecture/ui/`](../architecture/ui/)                   |
| Extension 作者侧 Manifest、Activation Context 与 Capability 类型 | [`packages/extension-sdk/README.md`](../../packages/extension-sdk/README.md)                               | [`architecture/extensions/`](../architecture/extensions/)   |
| Server Extension 的加载、授权与 Instance 生命周期                | [`packages/extension-sdk/extension-host/README.md`](../../packages/extension-sdk/extension-host/README.md) | [`architecture/extensions/`](../architecture/extensions/)   |
| 本地独立命令行沙箱、Kernel CRUD 与 CodeAct 快速自测              | [`apps/playground/README.md`](../../apps/playground/README.md)                                             | [`architecture/kernel/`](../architecture/kernel/)           |

全仓 Package 职责与本地 README 请参阅 [`project-structure.md`](project-structure.md)。Client 文件和测试路由只在 [Client README](../../apps/studio-client/README.md#任务到文件与验证入口)维护。

## 定向搜索与边界

以下是按需选择的查询，不是每次任务都要执行的清单。从仓库根目录运行：

```bash
# 不知道哪个领域：先只搜当前文档；不把历史草案当现行结果
rg -n -F '主写作' docs/guide docs/architecture
# 知道文件名片段：先取文件名，不打印整个目录树
rg --files packages/application-runtime/src -g '*session*' -g '!*.d.ts'
# 知道符号或 RPC：缩小到所属实现，再追调用者
rg -n -F 'createAgentSession' apps/studio-server/src/rpc/trpc/application/agents.ts
# 需要追溯历史时，单独包含被忽略的归档目录
rg --no-ignore -l -F 'Setting' docs/archive/discussion
```

默认 `rg` 跳过 Git 忽略项；`docs/archive/`、`extensions/`、`data/` 都不是默认搜索可见范围。不要为找源码对全仓使用 `--no-ignore`，它会混入依赖、构建产物和用户数据。独立扩展目录可能没有检出；先确认目录，再在指定扩展内搜索。空的旧目录或残留 `.d.ts` 不证明模块仍存在。

## 维护与验证

- 高频入口使用可点击的相对 Markdown 链接；类型/方法清单以源码注册表为准，不在多个文档手抄 Schema。
- 文件移动时更新所属局部 README；跨模块合同变化时更新 Architecture 和必要摘要，不以“见源码”掩盖已知矛盾。
- `pnpm check:docs` 当前只扫描 `docs/**/*.md` 的链接与生命周期，不校验根 README、Workspace README，也不验证行内代码路径或行为事实。局部 README 改动须另外核对链接与对应符号。
- 文档导航验证只证明可定位；测试文件存在、构建通过和真实行为验证不是同一件事。最小执行方式见[测试准则](testing.md)。

## 开发入口

日常开发优先从仓库根目录运行命令，让内部 Package 先构建并持续监听：

```bash
pnpm dev:server
pnpm dev:client
```

局部 README 中的 `pnpm --filter ... build` 用于需要产物验证时的定向构建，不是每次修改的默认步骤。测试优先选择直接覆盖本次行为的文件；核对实际收集的文件和用例，不能把退出码 0 自动解释为目标合同已经验证。
