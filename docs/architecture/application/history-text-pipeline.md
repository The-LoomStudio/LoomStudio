# History Text Pipeline

> 状态：已实现（2026-09-11）

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

Owner 只表示声明来源与 provenance，不等于运行作用域。Workspace / User Override 是跨上下文默认来源；Preset 只对使用该 Preset 的 Agent 生效；Card 只对对应 Timeline 生效；Extension 表示 Package / Module 贡献来源。Runtime 通过唯一的 Effective Pipeline 解析路径组合 Rule 与 Extractor，PromptBuild、History Projection 与 Inspector 不分别维护来源筛选逻辑。

Narrative `display` 可以独立于 Agent 解析。Narrative `prompt` 必须声明消费它的 Agent Session，以该 Session 的 Agent Profile / Preset 组合规则；因此两个使用不同 Preset 的 Agent 可以对同一 Narrative 获得隔离的 Prompt 投影。Agent Session Source 直接使用自身 Profile / Preset。

Rule 支持 `replace`、`mark` 与 `promote-reasoning`。`mark` 不修改文本，只产生稳定 `matchId`、UTF-16 输入范围、可映射的 Display Range 与单 Entry Trace。Depth 只计算有效文本 Entry，Provider Observation、Tool Invocation、Tool Result 与 Run State 不计入 Agent Session Depth。

## Assistant Content 分类顺序

```text
Provider typed parts
  -> Reasoning Promotion
  -> Content Tool Scanner on residual text
  -> ordinary Assistant Message
```

因此 Reasoning 内出现的 `<loom_tool>` 不会执行。普通 Content Tool 仍可在 Provider `stop` 时被 Runtime 识别并驱动下一轮。

自定义 `<think>` 等方言由产生输出的 Agent 所使用的 Preset 显式声明为 `promote-reasoning` Rule。捕获内容进入 Agent Session reasoning Entry，剩余 Assistant Content 才继续交给 Tool Scanner 和普通 Message；Narrative 不承担思维链折叠或隐藏。系统可以提供可选模板，但不全局猜测所有标签方言。

## Extractor 与 Renderer

Extractor 使用 `airp.textExtractor` Document 持久化，只消费官方 Projection Snapshot。第一版支持 `latest-valid`、`all-matches`、原始文本和 `key-value-lines` parser。较新的候选解析失败时，`latest-valid` 可以返回较旧有效值并标记 `stale`。

Card-owned Extractor 与 Card Rule 一样在 Timeline Runtime Context 中冻结。Preset / Workspace / Extension / User Override Extractor 按当前消费上下文解析。`extractHistory` 只能执行当前上下文中有效、启用且 Target 匹配的 Extractor，不能拿其他 Card 或 Preset 的 ID 旁路读取当前 History。

Extractor 可以把结果固化为带 `artifactType`、Extractor Version、`sourceEntryId`、stale 与 Diagnostic 的 Artifact。History Text API 的内置 Renderer Catalog 当前只保留官方 JSON Artifact 兼容投影；Client Extension 与 Loom Script Renderer 的实际注册、Surface 仲裁与实例生命周期由 Studio Client Host 管理。完整合同见 [`../extensions/client-renderer-host.md`](../extensions/client-renderer-host.md) 与 [`../extensions/loom-script-runtime.md`](../extensions/loom-script-runtime.md)。

Narrative Node 与 Agent Message 已接入瞬时 Node Render Mount。Extension 的 `projectNode()` 可以在 Node 前后或正文锚点挂载 `DisplayPart`；Host 不修改 canonical 正文，也不持久化 Renderer DOM。Literal Anchor 由 Host 解析；Loom Script Runtime 会把官方 `displayRange` 与稳定 `matchId` 送入 `match-ref`，无法映射时产生 Diagnostic。Marker 仍没有正式数据源。

Runtime Override 以 Source、Phase 与 Consumer 为键保存 `disabledRuleIds` 和 `orderedRuleIds`。它只改变当前 Effective Pipeline，不改写作者 Rule；PromptBuild、Display Inspector 与 Renderer 输入使用同一解析结果。

## API

- Rule CRUD：`list/get/upsert/deleteTextTransformRule`
- Extractor CRUD：`list/get/upsert/deleteTextExtractor`
- History：`projectHistory`、`extractHistory`
- 运行检查：`inspectTextPipeline`，返回当前 Source / Phase / Consumer、有效 Rule / Extractor 与同一次 Projection Snapshot
- 运行覆盖：`get/upsert/deleteTextPipelineOverride`
- 内置 Renderer Catalog：`listRenderers`
- Loom Script：见 [`../extensions/loom-script-runtime.md`](../extensions/loom-script-runtime.md)
- Client Extension Data：`listExtensionRecords`、`getExtensionRecord`

Studio 将作者配置和运行检查分离：Card / Preset 在各自资源工作台的外层 Master–Detail 中只编辑本 Owner 的 Rule / Extractor；Workspace 与 User Override 从设置中的文本管线入口编辑；运行面板只按当前 Narrative 或 Agent Session 展示 Effective RuleSet、来源、Match、Diagnostic 与 Dry Run。来源用于标签和筛选，不作为 Workspace / Card / Preset / Extension 四套一级导航。Preview 与 Runtime Prompt Build 共用同一 Effective Pipeline 与 Projection 实现。

## 当前限制

- Archive / Summary 尚无正式 Store 字段；Pipeline 已保留 `archived` 排除合同，但不会伪造归档状态；
- 内置 `listRenderers` 仍只返回官方兼容 Renderer；专门 Runtime 面板从 Client Renderer Host 读取实际 Extension / Loom Script Registry；
- Node Render Mount 第一版限制为每个 Node 64 个 Mount、20 万字符；
- Regex 使用 JavaScript 原生 `RegExp`，由输入、输出、Entry 和 Match 预算限制资源消耗，尚未进入可中断的独立执行进程。
- Extension-owned Rule / Extractor 由 Package 声明并经显式资源导入进入 Application Store；Module 启停只控制运行时 Renderer，不反向改写声明式资源或既有 Timeline 快照。
