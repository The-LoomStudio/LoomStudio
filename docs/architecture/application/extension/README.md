# Application Extension Contribution

本分类收录 Extension 向第一方 AIRP Application 贡献领域能力的稳定协议。

平台级加载、Manifest、生命周期和 SDK 位于 [`../../extensions/`](../../extensions/)。这里不重复定义 Extension Host。

当前已实现的数据与 Card 分发协议见 [`data-and-portable-payload.md`](data-and-portable-payload.md)。Client Extension Host、Renderer Surface、消息内 Render Mount 与 Workbench 位于平台 Extension 架构的 [`../../extensions/client-renderer-host.md`](../../extensions/client-renderer-host.md)。尚未实现的 Prompt source 和其他 contribution point 继续保留在 [`../../../workbench/discussion/application/extension/`](../../../workbench/discussion/application/extension/)，不进入正式架构。

默认剧情记忆的专用接收与交接合同见 [`narrative-context.md`](narrative-context.md)：扩展发布 Memory / 固定 Raw 范围，Runtime 在 Session 工作交接后通知采用，不是任意 Prompt source 注册引擎。
