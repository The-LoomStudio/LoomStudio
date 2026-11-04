# History Text Pipeline

> 状态：已实现；Script 声明式贡献接入于 2026-10-26；可终止正则隔离与提取预算于 2026-11-04 接入

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

Rule 以 `airp.loomScript` 中的 `text-transform` 声明持久化，源码是唯一可编辑定义；采用由 Script Mount 控制，预设继续保留单条规则的使用与顺序配置。旧 `airp.textTransformRule` 启动时事务迁移为脚本，原规则地址通过贡献映射保留。旧导入格式在边界转换；旧规则 upsert 仅用于新资源导入，已有规则须编辑完整脚本并刷新。Runtime 按 Session 直接引用的 Agent Preset、Timeline 关联 Card 的当前规则、可用扩展安装及公共默认解析有效 RuleSet；不再把创建 Timeline 时的规则快照作为运行来源。Preset metadata 的 `textUses` 按 `kind + id` 显式覆盖启用与可选 `orderIndex`，未配置项保持定义默认值，排序最终以稳定 ID 打破同序。显式禁用不会修改全局规则定义，显式启用也不会绕过 Card 归属与扩展安装可用性校验。

Owner 表示声明来源与 provenance，不等于运行作用域。Workspace / User Override 是公共默认来源，Card 只对对应来源角色生效，Extension 贡献还需匹配当前可用安装。现存 `owner.kind: preset` 仍按匹配预设解析，但配置化不增加新的预设专属归属：扩展携带定义，预设以 `textUses` 引用和使用。Runtime 通过唯一的 Effective Pipeline 解析路径组合 Rule 与 Extractor，PromptBuild、History Projection 与 Inspector 不分别维护来源筛选逻辑。

包内与外部引用同时校验 identity / provenance；缺失或安装不可用时保留 `textUses` 并返回 `text.use_unresolved`，不按名称找替代。公共正则默认参与符合上下文的消费，与公共 Lore 必须显式采用不同；`useCardLore` 只控制默认角色 Lore，不控制角色正则继承。

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

> 2026-11-02 产品收束：不再将 Extractor 作为独立作者功能继续建设。自定义提取由脚本处理；跨组件共享的正式数据优先写入 State/变量。下述 Extractor 合同保留用于已有定义和消费者兼容，本次界面迁移不删除历史数据，也不增加结果自动持久化。


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

Studio 的规则定义统一在扩展页「脚本 → 正则」管理。正则工具栏的「运行检查器」打开 SPA 浮层，按当前 Narrative 或 Agent Session 查看实际生效规则、阶段、匹配、诊断与管线结果；单条规则的「实时预览」仍用于编辑源码的样本测试，两者不可互相替代。旧正则页面只负责跳转到新入口，不再保留独立编辑页。历史提取器产物仍可出现在检查结果中，不代表恢复提取器的独立作者入口。

## 样本来源与执行预算

`previewLoomScript` 的 `source` 仍为脚本文本，新增可选 `previewSource: 'narrative' | 'agent-session'`；省略时兼容 Narrative。预览界面明确显示来源并允许选择；Agent-only 有效声明默认 Agent，其余按当前上下文默认，无法确定时为 Narrative。它只计算所选来源，不双跑，不保存或启用源码，不执行脚本 JavaScript。来源切换使旧请求失去发布资格。

实际预览、History project/inspect/extract、Narrative prompt/display/classify 采样与 Agent prompt/classify 均通过 `history-text-isolation.ts` 执行纯投影/提取任务。每进程最多2个运行线程、16个排队任务；单任务5秒期限包含排队、启动、投影及其全部提取，线程 old-space 128MiB、young-space 16MiB。超时会等待真实线程终止后释放槽位；失败用 `text.execution_timeout`、`text.execution_busy` 或 `text.execution_failed` 明确拒绝，不伪装成成功的截断结果。没有 Rule 且没有 Extractor 时，直接走不含用户正则的纯核心路径。源码 Worker 使用现有 tsx 注册，部署 dist 使用编译后的 JS，不需要 tsx。

每个 Extractor 的默认预算跨全部 Entry 累计：扫描10,000次匹配（含解析失败）、5,000个有效候选、1,000,000个捕获 UTF-16 单元、2,000,000个返回结构单位、100条诊断。捕获总量包括完整匹配和全部编号捕获，命名别名不重复计；返回每个 JSON 值/容器计1单位，字符串与对象键额外计 UTF-16 长度，包含来源ID与诊断。这些是逻辑量预算，不等同网络字节或 heap 字节。组合任务中多个 Extractor 的返回总和仍受2,000,000单位限制。

超限抛 `text.extractor.budget_exceeded`，保留 `budget/limit/actual`，不吞入 `parse_failed`，不返回部分成功；`latest-valid` 只保留当前最优一条，同时累计扫描、候选和捕获成本，保持同深度首条及 stale 语义。原有投影 Entry/输入/输出/匹配预算与 display 可恢复诊断合同继续生效。Agent classification 隔离失败不能回退保存未经处理的 partial Narrative；原错误及失败 Run 状态保留。

## 当前限制

- Agent Session 已持久化 `work-summary`、摘要策略与任务记录；历史读取按已采用摘要的退休边界选择有效工作段，保留原始 Transcript。摘要的来源校验与采用合同见[Agent Runtime](agent/runtime-and-session.md)。Pipeline 的 `archived` 仍是投影输入合同，没有通用的持久化 Entry Archive 状态，不能把摘要退休解释为删除或归档原记录；
- 内置 `listRenderers` 仍只返回官方兼容 Renderer；专门 Runtime 面板从 Client Renderer Host 读取实际 Extension / Loom Script Registry；
- Node Render Mount 第一版限制为每个 Node 64 个 Mount、20 万字符；
- Regex 保留 JavaScript 原生 `RegExp` 语义，在 Node Worker 中执行；预算与失败行为见下节。线程 old-space 限制不是总 RSS 上限。
- Extension-owned Rule / Extractor 由 Package 声明并经显式资源导入进入 Application Store；Module 启停只控制运行时 Renderer，不反向改写声明式资源或既有 Timeline 快照。

## Script 采用边界

规则解析使用当前请求对应的角色/预设，按角色优先于全局去重；角色显式关闭不能被预设单条使用设置重新开启。迁移前禁用但经预设显式采用的旧规则保留原语义，用户主动切换脚本开关后按新采用设置生效。保存源码或配置不改变有效版本；显式刷新更新版本和配置快照。纯声明不启动 JS，独立规则不随未授权或失败的 JS 一起失效。需要代码的贡献必须显式声明依赖并由宿主验证已激活。

静态 `text-extractor` 与现有 Extractor 共享定义、校验及提取执行器；存量 Extractor 文档本轮不强制迁移。详见 [Script 合同](../extensions/loom-script-runtime.md)。
