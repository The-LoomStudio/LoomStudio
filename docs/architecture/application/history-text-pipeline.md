# History Text Pipeline

> 状态：已实现；资源使用配置更新于 2026-10-02

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

Rule 使用 `airp.textTransformRule` Document 持久化，资源定义与预设使用配置分离。Runtime 按 Session 直接引用的 Agent Preset、Timeline 关联 Card 的当前规则、可用扩展安装及公共默认解析有效 RuleSet；不再把创建 Timeline 时的规则快照作为运行来源。Preset metadata 的 `textUses` 按 `kind + id` 显式覆盖启用与可选 `orderIndex`，未配置项保持定义默认值，排序最终以稳定 ID 打破同序。显式禁用不会修改全局规则定义，显式启用也不会绕过 Card 归属与扩展安装可用性校验。

Owner 表示声明来源与 provenance，不等于运行作用域。Workspace / User Override 是公共默认来源，Card 只对对应来源角色生效，Extension 贡献还需匹配当前可用安装。现存 `owner.kind: preset` 仍按匹配预设解析，但配置化不增加新的预设专属归属：扩展携带定义，预设以 `textUses` 引用和使用。Runtime 通过唯一的 Effective Pipeline 解析路径组合 Rule 与 Extractor，PromptBuild、History Projection 与 Inspector 不分别维护来源筛选逻辑。

包内与外部引用同时校验 identity / provenance；缺失或安装不可用时保留 `textUses` 并返回 `text.use_unresolved`，不按名称找替代。公共正则默认参与符合上下文的消费，与公共 Settings 必须显式采用不同；`useCardSettings` 只控制默认角色 Settings，不控制角色正则继承。

Narrative `display` 可以独立于 Agent 解析。Narrative `prompt` 使用明确的消费 Agent Session 或预设身份组合规则；因此不同 Agent Preset 可以对同一 Narrative 获得隔离的 Prompt 投影。Agent Session Source 直接使用自身 `agentPresetId`。

Rule 支持 `replace`、`mark` 与 `promote-reasoning`。`mark` 不修改文本，只产生稳定 `matchId`、UTF-16 输入范围、可映射的 Display Range 与单 Entry Trace。Depth 只计算有效文本 Entry，Provider Observation、Tool Invocation、Tool Result 与 Run State 不计入 Agent Session Depth。

Narrative 的 `display`、`prompt`、`classify` 均使用关联角色卡的当前规则。保存、新增、禁用或删除后，下次投影使用新规则，不回退到旧快照；仍应用当前 Source／Phase 的 Override，不重写 canonical 正文、已提交分类事实或 State。Preset／Workspace 等其他规则来源保持原有解析语义。

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

Card-owned Extractor 读取来源角色的当前定义，更新与移除后不从 Timeline 快照恢复。Preset / Workspace / Extension / User Override Extractor 按当前消费上下文解析。`extractHistory` 只能执行当前上下文中有效、启用且 Target 匹配的 Extractor，不能拿其他 Card 或 Preset 的 ID 旁路读取当前 History。

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

Studio 将定义编辑、预设使用配置和运行检查分离：文本资源面板编辑 Rule / Extractor 定义；预设配置的“正则 / 提取器”子 Tab 按来源 FileTree 调整 `textUses`，点击资源行按原 ID 打开定义编辑，不复制资源或改变归属。运行面板按明确的 Narrative 或 Agent Session 展示 Effective RuleSet、来源、Match、Diagnostic 与 Dry Run。来源用于标签和筛选，不为每个 Owner 建一套定义编辑器。Preview 与 Runtime Prompt Build 共用同一 Effective Pipeline 与 Projection 实现。

## 当前限制

- Archive / Summary 尚无正式 Store 字段；Pipeline 已保留 `archived` 排除合同，但不会伪造归档状态；
- 内置 `listRenderers` 仍只返回官方兼容 Renderer；专门 Runtime 面板从 Client Renderer Host 读取实际 Extension / Loom Script Registry；
- Node Render Mount 第一版限制为每个 Node 64 个 Mount、20 万字符；
- Regex 使用 JavaScript 原生 `RegExp`，由输入、输出、Entry 和 Match 预算限制资源消耗，尚未进入可中断的独立执行进程。
- Extension-owned Rule / Extractor 由 Package 声明并经显式资源导入进入 Application Store；Module 启停只控制运行时 Renderer，不反向改写声明式资源或既有 Timeline 快照。
