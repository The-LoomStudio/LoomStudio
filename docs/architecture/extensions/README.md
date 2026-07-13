# Extension Architecture

本分类收录平台级 Extension 机制的稳定架构，包括 Manifest、发现与加载、生命周期、运行时注册、权限、隔离和 Extension SDK contract。

它与 [`../application/extension/`](../application/extension/) 的区别是：

```text
Extension Architecture:
  Extension 如何接入 Loom Studio 平台。

Application Extension Contribution:
  Extension 如何向第一方 AIRP Application 贡献领域能力。
```

当前 Extension 设计材料位于 [`../../workbench/discussion/extensions/`](../../workbench/discussion/extensions/)。尚未与实现完全收口的 Manifest 与生命周期设计继续保留在 Workbench。
