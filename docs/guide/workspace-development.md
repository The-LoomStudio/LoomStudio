# Workspace 开发入口

> **状态**：Active Guide

本页负责把开发者和 AI 从全仓文档路由到实际代码区域。它不复制各模块内部结构；进入目标 Workspace 后，以该目录的 `README.md`、当前源码和正式 Architecture 为准。

## 文档分工

```text
docs/guide/
  全仓开发流程、任务路由和共同规则。

apps/*/README.md / packages/*/README.md
  当前 Workspace 的职责、入口、目录、运行方式和局部边界。

docs/architecture/
  跨 Workspace 的稳定实现合同和数据流。

docs/workbench/
  尚未稳定的讨论、计划和问题；不能替代当前源码。
```

局部 README 只维护靠近代码的事实，不重复完整 API、Schema 或跨包架构。跨模块事实发生变化时更新 Architecture；局部入口、命令或目录发生变化时更新对应 Workspace README。

## 高频任务路由

| 任务                                                             | 第一入口                                                                                                   | 正式架构                                                    |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Studio 页面、交互状态、typed API Client                          | [`apps/studio-client/README.md`](../../apps/studio-client/README.md)                                       | [`architecture/ui/`](../architecture/ui/)                   |
| Server 进程、HTTP、认证、RPC 路由、依赖组装                      | [`apps/studio-server/README.md`](../../apps/studio-server/README.md)                                       | [`architecture/kernel/`](../architecture/kernel/)           |
| Card、Narrative、Agent、State、PromptBuild 业务流程              | [`packages/application-runtime/README.md`](../../packages/application-runtime/README.md)                   | [`architecture/application/`](../architecture/application/) |
| Kernel RPC、Event Bus、数据提交事件与 Introspection              | [`packages/kernel/README.md`](../../packages/kernel/README.md)                                             | [`architecture/kernel/`](../architecture/kernel/)           |
| SQLite connection、Migration、Transaction、Commit Fact           | [`packages/data-engine/README.md`](../../packages/data-engine/README.md)                                   | [`architecture/data/`](../architecture/data/)               |
| Extension 作者侧 Manifest、Activation Context 与 Capability 类型 | [`packages/extension-sdk/README.md`](../../packages/extension-sdk/README.md)                               | [`architecture/extensions/`](../architecture/extensions/)   |
| Server Extension 的加载、授权与 Instance 生命周期                | [`packages/extension-sdk/extension-host/README.md`](../../packages/extension-sdk/extension-host/README.md) | [`architecture/extensions/`](../architecture/extensions/)   |

其他 Workspace 的职责总览暂时继续从 [`project-structure.md`](project-structure.md) 进入。本地 README 会按真实维护频率逐步补齐，不批量生成没有证据的空壳说明。

## 开发入口

日常开发优先从仓库根目录运行命令，让内部 Package 先构建并持续监听：

```bash
pnpm dev:server
pnpm dev:client
```

局部 README 中的 `pnpm --filter ... build` 用于定向构建。测试以 README 给出的根目录 Vitest 命令为准；部分 Package 现有 `test --passWithNoTests` 脚本可能空跑成功，不能把退出码 0 自动解释为合同已经验证。
