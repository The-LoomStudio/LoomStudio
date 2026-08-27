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

Rule 使用 `airp.textTransformRule` Document 持久化，来源可以是 Workspace、Preset、Card、Extension 或 User Override。Runtime 按当前 Agent Profile 的 Preset、Timeline 的来源 Card，以及全局来源解析有效 RuleSet；排序只使用 `orderIndex` 与稳定 ID。

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

Renderer Registry 由 Host 管理。Client 通过正式 Slot Host 渲染 Artifact；普通 Panel Renderer 由 React 宿主渲染，iframe 模式使用无脚本 sandbox 和转义后的文本，不执行任意 HTML。

## API

- Rule CRUD：`list/get/upsert/deleteTextTransformRule`
- Extractor CRUD：`list/get/upsert/deleteTextExtractor`
- History：`projectHistory`、`extractHistory`
- Renderer：`listRenderers`

Studio 的“文本管线”面板提供来源顺序、JSON 编辑、History Dry Run、Extractor Dry Run 与 Renderer Registry 视图。Preview 与 Runtime Prompt Build 共用 `composeAgentTurnPrompt` 中的同一 Projection 实现。

## 当前限制

- Archive / Summary 尚无正式 Store 字段；Pipeline 已保留 `archived` 排除合同，但不会伪造归档状态；
- Renderer Registry 第一版只有 Host 内置 JSON Renderer；Extension Client Renderer 注册属于后续 Extension Host 工作；
- Regex 使用 JavaScript 原生 `RegExp`，由输入、输出、Entry 和 Match 预算限制资源消耗，尚未进入可中断的独立执行进程。
