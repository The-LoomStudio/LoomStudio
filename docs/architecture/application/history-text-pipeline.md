# History Text Pipeline

> 状态：已实现基础闭环（2026-08-26）

LoomStudio 只对 `Narrative History` 与 `Agent Session History` 提供统一文本管线。Canonical Narrative Node 与 Agent Transcript 始终保留原文；Prompt、Display、Extractor 和扩展消费冻结后的 `HistoryProjectionSnapshot`。

```text
Active lineage
  -> exclude archived entries
  -> assign text depth
  -> ordered Rule execution
  -> Match Records + transformed entries
  -> Prompt / Display / Extractor consumers
```

## Rule 与来源

Rule 使用 `airp.textTransformRule` Document 持久化，来源可以是 Workspace、Preset、Card、Extension 或 User Override。创建 Timeline 时会固化来源 Card 的 Rule；Runtime 按当前 Agent Profile 的 Preset、Timeline Runtime Context，以及全局来源解析有效 RuleSet。旧 Timeline 没有 Runtime Context 时才回退读取来源 Card。排序只使用 `orderIndex` 与稳定 ID。

Rule 支持 `replace` 与 `promote-reasoning` 两种 Effect。Depth 只计算有效文本 Entry，Provider Observation、Tool Invocation、Tool Result 与 Run State 不计入 Agent Session Depth。

## Assistant Content 分类顺序

```text
Provider typed parts
  -> Reasoning Promotion
  -> Content Tool Scanner on residual text
  -> ordinary Assistant Message
```

因此 Reasoning 内出现的 `<loom_tool>` 不会执行。普通 Content Tool 仍可在 Provider `stop` 时被 Runtime 识别并驱动下一轮。

## Extractor 与 Renderer

Extractor 使用 `airp.textExtractor` Document 持久化，只消费官方 Projection Snapshot。第一版支持 `latest-valid`、`all-matches`、原始文本和 `key-value-lines` parser。较新的候选解析失败时，`latest-valid` 可以返回较旧有效值并标记 `stale`。

History Text API 的内置 Renderer Catalog 由 Application Runtime 提供，当前只保留官方 JSON Artifact 兼容投影。Client Extension Renderer 使用同一 `RendererContributionDefinition`，但运行时注册、Surface 仲裁与实例生命周期由 Studio Client Host 管理；完整合同见 [`../extensions/client-renderer-host.md`](../extensions/client-renderer-host.md)。

Narrative Node 与 Agent Message 已接入瞬时 Node Render Mount。Extension 的 `projectNode()` 可以在 Node 前后或唯一正文锚点挂载 `DisplayPart`；Host 不修改 canonical 正文，也不持久化 Renderer DOM。当前 literal anchor 已端到端接入，`match-ref` / `marker` 仍等待正式 Match / Marker 数据源。

## API

- Rule CRUD：`list/get/upsert/deleteTextTransformRule`
- Extractor CRUD：`list/get/upsert/deleteTextExtractor`
- History：`projectHistory`、`extractHistory`
- 内置 Renderer Catalog：`listRenderers`
- Client Extension Data：`listExtensionRecords`、`getExtensionRecord`

Studio 的“文本管线”面板提供来源顺序、JSON 编辑、History Dry Run、Extractor Dry Run 与 Renderer Registry 视图。Preview 与 Runtime Prompt Build 共用 `composeAgentTurnPrompt` 中的同一 Projection 实现。

## 当前限制

- Archive / Summary 尚无正式 Store 字段；Pipeline 已保留 `archived` 排除合同，但不会伪造归档状态；
- 内置 `listRenderers` 仍只返回官方兼容 Renderer；Client Extension Renderer 从 Extension Catalog 声明并在浏览器运行时注册；
- Node Render Mount 第一版限制为每个 Node 64 个 Mount、20 万字符；
- Regex 使用 JavaScript 原生 `RegExp`，由输入、输出、Entry 和 Match 预算限制资源消耗，尚未进入可中断的独立执行进程。
