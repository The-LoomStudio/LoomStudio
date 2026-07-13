# Studio UI Shell Architecture

本分类收录领域无关的 Studio Shell 架构，包括窗口骨架、Canvas、面板容器、全局命令、通知、主题 token 和可复用 UI 原语。

Shell 不理解 Card、Chat、Prompt 或 Agent。第一方 AIRP 领域 UI 位于 [`../application/ui/`](../application/ui/)，Extension UI 则通过平台贡献边界接入。

当前 Shell 形态仍在 [`../../workbench/discussion/ui/`](../../workbench/discussion/ui/) 讨论。本目录只建立正式分类，不把早期布局草稿当作当前 contract。
