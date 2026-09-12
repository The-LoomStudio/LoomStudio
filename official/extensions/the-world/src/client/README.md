# Client 源码边界

> **状态**：Deferred / 目录预留

后续承载世界面板、地图展示与编辑交互、背景 Renderer。复用正式 Surface 和 mount / update / disposer，不把 ST 的 body 挂载、全局 CSS 注入和宿主选择器带入稳定接线。

本目录尚无入口。框架、构建方式与组件合同在实现前根据宿主已有能力收口，参见 [迁移讨论](../../docs/migration-discussion.md)。
