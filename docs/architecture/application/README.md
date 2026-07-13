# Studio Application Architecture

Studio Application 是 Loom Studio 第一方内建的 AIRP 领域层。它定义默认产品体验中的 Card、Session、Setting Layer、PromptBuild、Agent、Runtime 和领域 UI，但不进入 Kernel，也不伪装成 ordinary Extension。

## 子分类

| 分类 | 职责 | 当前状态 |
|---|---|---|
| [`prompt-build/`](prompt-build/) | Sources、Composition、PromptBuild pipeline 与 Loom Core 对接 | Loom Core 边界已晋升 |
| [`agent/`](agent/) | Agent 模型、运行策略、Tool、检索与权限 | 分类已建立，具体设计仍在 Workbench |
| [`extension/`](extension/) | Extension 向第一方 AIRP 领域贡献能力的协议 | 分类已建立，具体设计仍在 Workbench |
| [`ui/`](ui/) | 第一方 AIRP UI 如何使用 Studio Shell | 分类已建立，具体设计仍在 Workbench |

Application 的其他领域文档在稳定前继续保留于 [`../../workbench/discussion/application/`](../../workbench/discussion/application/)。

## 边界

```text
Application:
  拥有 AIRP 业务语义和流程。

Kernel:
  提供业务无感知的平台原语。

Platform:
  提供可被多个 Application / Extension 复用的共享能力。

UI Shell:
  提供容器和通用交互原语。
```
