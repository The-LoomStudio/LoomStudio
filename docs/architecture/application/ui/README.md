# Studio Application UI Architecture

本分类收录第一方 AIRP Application 如何使用 Studio Shell 容器和通用 UI 原语，呈现 Card、Session、PromptBuild、Agent 等领域体验。

它与顶层 [`../../ui/`](../../ui/) 的区别是：

```text
Architecture / UI:
  Shell、容器、全局功能和领域无关原语。

Application / UI:
  第一方 AIRP 领域体验与交互。
```

当前 Application UI 设计仍在 [`../../../workbench/discussion/application/ui/`](../../../workbench/discussion/application/ui/) 演进，本目录暂不将设计方向声明为已实现 contract。
