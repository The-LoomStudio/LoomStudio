# History Text Transform、Reasoning Promotion 与 Rendering 实施计划

> **状态**：Phase 0—5 基础闭环已实施；Extension Renderer 注册与正式 Archive/Summary 字段保留为后续增强
>
> **日期**：2026-08-26
>
> **目标**：只围绕 Narrative History 与 Agent Session History 建立受控的文本匹配、替换、内容分类、派生数据和渲染投影管线；不复制 SillyTavern 面向任意世界书、快捷命令和 Provider 内部字段的泛化 Regex 范围。
>
> **实施事实**：Regex Rule / Extractor Document、History Projection、Reasoning Entry、Prompt 接入、RPC/Client API、集中 Workbench、Dry Run、Host Renderer Registry 与 UI Slot Host 已存在。正式 Archive/Summary Store 字段与第三方 Client Renderer 注册尚未实现。

## 1. 决策摘要

本阶段采用以下边界：

- Regex 不是任意代码读取 History 的旁路，而是官方 History Text Pipeline 中的 Matcher / Replace 能力；
- 第一版正式输入只有 `Narrative History` 与 `Agent Session History`；
- Preset、Card、Workspace、Extension 和 User Override 可以贡献 RuleSet，但都通过同一个 Registry、范围、顺序、归档和预算合同执行；
- Text Transform Rule 的正式功能仍是匹配与替换；匹配记录、替换后文本和最终 History Projection 都是可消费的阶段产物；
- Assistant Content 中被识别为 Reasoning 或 Content Tool 的片段不再作为普通正文“隐藏”，而是提升为 canonical 类型化 Entry；
- Content Tool、Reasoning Promotion、普通文本替换和 Semantic Extraction 使用固定阶段，不依靠用户拖拽顺序修复协议污染；
- Prompt Transform、Display Transform、DisplayPart 和 Text Extraction 都不直接覆盖 Narrative / Agent 原文；
- 非消息内 UI 使用正式 Slot 与 Data Source，不让插件自行扫描宿主 DOM 或重复实现 History Regex；
- 必须长期存在、会被逻辑消费的数据优先进入 State；只服务当前展示的正文派生数据可以保持 Text Projection。

一句话边界：

```text
History Projection 选择正确的历史，
Text Pipeline 对它分类、匹配和替换，
Prompt / Display / Extractor / Extension 消费冻结后的阶段产物。
```

## 2. 实施前基线（历史）

以下内容记录本计划开始前的缺口，不是 2026-08-26 完成 Phase 0—5 后的当前事实；当前实现以文首“实施事实”和正式 Architecture 为准。

- `AgentTranscriptEntryData.message` 当前只有 `role + content: string`，没有 canonical Reasoning Entry；
- Agent Tool Loop 已实现 Content Tool Scanner：从 Assistant Content 分离普通文本与 `<loom_tool>`，再持久化 `message` 与 `tool-invocation`；
- Content Tool 即使伴随 Provider `stop` 返回，也会由 Runtime 识别 Invocation 并继续 Loop；
- Provider Observation 可以保存 `rawRef`，但普通 Transcript 不保存 Provider wire message array；
- Prompt Build 已将 Narrative History 与 Session History 投影到不同 Zone / Slot，并使用 `@loom/core` Pass、Trace 与 Diagnostics；
- Variable / State 已有冻结 Snapshot 与 Macro Renderer，不需要 Regex 承担变量赋值；
- 当前没有统一 Regex Rule Definition、RuleSet Mount、History Projection API、Text Extractor、DisplayPart Registry 或 Client Extension Host；
- 当前 Extension Host 主要是 Server Module 生命周期和能力边界，不是不可信 Client Renderer 的 iframe sandbox。

## 3. 正式概念边界

### 3.1 History Source

第一版只接受两种 Source：

```ts
type HistorySource =
  | {
      kind: 'narrative'
      timelineId: string
      branchId: string
    }
  | {
      kind: 'agent-session'
      sessionId: string
      headEntryId?: string
    }
```

不进入第一版 Regex 范围：

- Preset / Setting / Card 普通字段；
- Prompt Resource / 世界书正文；
- 快捷命令与任意 Workspace 文件；
- Provider 已经类型化的 Native Reasoning、ToolCall 或 ToolResult；
- Extension 私有字符串。

Extension 可以在自己的私有数据中使用 JavaScript `RegExp`，但读取 Studio Narrative / Session History 必须通过正式 History Capability。

### 3.2 Rule Carrier 与 RuleSet

Rule 保留真实来源，不复制到一个 Workspace 大对象：

```ts
type TextRuleOwner =
  | { kind: 'workspace' }
  | { kind: 'preset'; presetId: string }
  | { kind: 'card'; cardId: string }
  | { kind: 'extension'; packageId: string; moduleId?: string }
  | { kind: 'user-override' }
```

每个 Carrier 保存自己的有序 RuleSet。集中 Workbench 聚合当前 Workspace、Preset、Card、Extension 和 User Override 的有效挂载，不改变来源所有权。

### 3.3 Text Transform Rule

当前最小合同：

```ts
type TextTransformRule = {
  id: string
  name: string
  owner: TextRuleOwner
  enabled: boolean
  matcher: {
    kind: 'regex'
    pattern: string
    flags: string
  }
  effect:
    | { kind: 'replace'; replacement: string }
    | {
        kind: 'promote-reasoning'
        contentGroup?: number | string
        visibility: 'collapsed' | 'hidden' | 'visible'
        replay: 'omit' | 'assistant-content'
        dialect?: string
      }
  targets: Array<'narrative' | 'agent-session'>
  phases: Array<'classify' | 'prompt' | 'display'>
  range?: {
    minDepth?: number
    maxDepth?: number
  }
}
```

规则：

- 替换为空字符串即删除；
- 支持标准捕获组和命名捕获组替换；
- 每条 Rule 对当前输入只执行一次，不做固定点递归；
- 当前 Rule 输出成为下一条 Rule 输入；
- Pattern、Flags、Replacement、命中次数、耗时和文本变化进入 Trace；
- 第一版不开放 canonical `commit` phase，不让普通 Regex 静默改写 Narrative / Transcript。

### 3.4 History Projection 阶段产物

管线至少暴露四种不可变结果：

```text
HistorySourceSnapshot
  已经过 Lineage、Archive 和 Depth 选择的有效 Entry

TextMatchRecord[]
  ruleId、entryId、range、captures、source revision

TransformedHistoryEntry[]
  替换后文本、applied rule ids、diagnostics

HistoryProjectionSnapshot
  Prompt / Display / Extractor 最终消费的冻结结果
```

外部消费者读取 Snapshot，不获得可修改的内部数组或 Store 句柄。

## 4. Assistant Content Classification

### 4.1 原则

Assistant Content 中出现的类型化协议不应继续作为普通正文，然后依靠 Display Regex 隐藏。

当前 Content Tool 已经证明以下模式可行：

```text
Assistant Content
  -> Scanner
  -> residual assistant text
  -> canonical ToolInvocation
```

Reasoning Promotion 使用同一原则：

```text
Assistant Content
  -> Content Classifier
  -> residual assistant text
  -> canonical Reasoning Entry
  -> canonical ToolInvocation
```

### 4.2 Candidate Canonical Entry

候选 Agent Transcript 扩展：

```ts
type AgentReasoningEntry = {
  kind: 'reasoning'
  content?: string
  source: 'provider-native' | 'assistant-content'
  dialect?: string
  providerCallId?: string
  rawRef?: string
  visibility: 'collapsed' | 'hidden' | 'visible'
}
```

Provider signature、encrypted reasoning、item reference 等 Provider 特例仍留在 Gateway Raw Ref / Adapter Metadata，不进入公共 canonical schema。

### 4.3 固定分类顺序

Provider Step 的固定顺序：

```text
Provider-native typed parts
  -> Assistant Content Reasoning Promotion
  -> Content Tool Scanner on residual text
  -> residual ordinary Assistant Message
  -> persist canonical entries
```

这样可以保证：

- `<think>` 中的 `<loom_tool>` 不会被当作真实 Tool 执行；
- `<think>` 中的 `<status>`、`<choice>` 或 Renderer 标签不会污染普通正文；
- Tool Invocation 仍由 Studio Invocation ID 配对；
- Reasoning 不会因为 Provider `stop` 被误判成 ToolCall；
- 只有完整、合法、闭合的分类结果才从正文中移除；失败时保留原文本并产生 Diagnostic。

分类器的安全阶段优先级由 Runtime 固定，不允许普通 Rule 排到 Content Tool Scanner 之后再修补协议污染。

### 4.4 Reasoning Replay Policy

Reasoning 是否进入下一次 Provider Step 是 Prompt Projection Policy，不由显示开关决定：

```text
provider-native replay
  Provider 支持且 Adapter 保留必要元数据时使用原生 reasoning surface

assistant-content replay
  Provider 不支持 reasoning part，但 Preset 明确要求保留历史思维过程时，按批准 dialect 编译回 Assistant Content

omit
  默认不进入后续 Prompt，只保留 canonical / trace 事实
```

第一版不得伪造 Provider Reasoning ID、Signature 或 Responses Item Reference。

## 5. History Projection Pipeline

### 5.1 Selection 先于 Regex

统一执行链：

```text
read current Branch / Session lineage
  -> apply Summary / Archive Policy
  -> select Active text entries
  -> assign unified depth
  -> apply Rule target / range
  -> run ordered Text Transform Rules
  -> freeze Projection Snapshot
```

Archived Entry 不进入正常 Regex、Prompt 或 Renderer。UI 分页、虚拟列表和 DOM 是否挂载不影响 Depth 或 Rule 结果。

### 5.2 统一 Depth

只保留一套参数：

```text
depth 0 = 当前目标 History 中最新的有效文本 Entry
depth 1 = 上一个有效文本 Entry
```

- Narrative 沿当前 Branch Node lineage 计算；
- Agent Session 沿当前 Head 的文本 Message lineage 计算；
- `provider-observation`、Tool、Run State 等运行 Entry 不计入文本深度；
- 同一 Rule 同时选择两种 Target 时，同一区间分别应用到各自 History。

### 5.3 Prompt Projection

```text
Active History
  -> History Prompt RuleSet
  -> Transformed History
  -> Narrative History / Session History Prompt Contributions
  -> Prompt Build Zone / Slot / Order / Token Budget
```

Prompt Transform 结果不覆盖 Node 或 Transcript。一次 Agent Run 可以持久化 Projection ID、RuleSet Revision、Trace Ref 和最终 Provider Request Artifact，用于复现，不把投影结果变成正文权威。

### 5.4 Display Projection

```text
Active History
  -> History Display RuleSet
  -> Transformed display text
  -> Semantic Matcher
  -> TextSegment / DisplayPart
  -> Markdown / registered Renderer
```

Display Matcher 固定在 Display Text Transform 之后。普通 Rule 先移除 Reasoning / hidden block，Semantic Matcher 再解析 `status`、`choice`、`WorldState` 等可见结构。

## 6. Text Extractor 与非消息 UI

### 6.1 Text Extractor

需要从正文捕获结构化数据但不在消息内渲染时，注册 Text Extractor：

```ts
type TextExtractorDefinition = {
  id: string
  owner: TextRuleOwner
  source: {
    target: 'narrative' | 'agent-session'
    selector: 'latest-valid' | 'all-matches'
  }
  matcher: RegexMatcher | TagMatcher
  parser: ParserDefinition
  outputSchema: JsonObject
}
```

Extractor 消费官方 Match Record / History Snapshot，不直接查询 DOM、Store 或自行决定 Branch、Archive、Depth。

### 6.2 Widget Data Source

非消息 UI 的数据源统一候选：

```ts
type WidgetDataSource =
  | { kind: 'state'; target: StateTarget; path: string }
  | { kind: 'text-projection'; extractorId: string }
  | { kind: 'tool-result'; toolId: string }
  | { kind: 'extension-rpc'; method: string }
```

变量 / State 是长期权威数据的推荐来源；Text Projection 服务兼容非结构化正文输出。如果数据必须在来源消息归档后长期存在并被逻辑消费，应提升为 Timeline State，而不是依赖隐形 Renderer 缓存。

### 6.3 UI Slot 与生命周期

第一批候选 Slot：

```text
narrative.entry.inline
agent.message.inline
timeline.hud
timeline.sidebar
timeline.overlay
agent-session.header
agent-session.sidebar
composer.accessory
studio.panel
```

重型世界仪表盘、地图和商店使用 Timeline / Session Scope Slot，每个 Scope 只创建一个实例；不在每条消息中重复创建 iframe。

复杂第三方 HTML / JS 使用 Host 管理的 sandbox iframe。Regex Replacement 不产生可执行宿主 HTML，iframe 只通过受限 Client SDK / MessagePort 消费结构化 Data Source 和发起受控 Action。

## 7. 排序与最终视图

排序是正式语义，不是单纯 UI 偏好：

```text
phase
  -> mounted RuleSet order
  -> rule order inside owner RuleSet
  -> stable rule id tie-break
```

集中 Workbench 提供：

- 来源视图：Workspace、Preset、Card、Extension、User Override；
- 最终顺序视图：当前挂载组合展开后的真实执行序列；
- Rule 开关、拖拽、Pattern / Replacement 编辑；
- Prompt / Display、Narrative / Session、Depth Range；
- 测试输入、匹配 Capture、逐 Rule Diff、耗时和 Diagnostic；
- Extractor 的 Preview JSON、Output Schema 和 Consumer 列表；
- Renderer 的 Slot、Data Source、Instance Scope、Fallback 和权限。

普通作者可以编辑声明式 Rule。Extension 也可以通过正式 SDK 注册静态 Rule / Extractor；动态 JavaScript Callback 属于可执行 Module，需要 Host、Capability 和预算，不取代声明式配置。

## 8. 持久化边界

| 数据 | 权威持久化 | 说明 |
|---|---:|---|
| Narrative raw body | 是 | 故事正文权威 |
| Agent ordinary message | 是 | 分类后的普通文本 |
| Agent reasoning entry | 是 | 从 Provider native 或 Assistant Content 提升的类型化事实 |
| ToolInvocation / ToolResult | 是 | Studio Invocation ID 配对事实 |
| Provider raw response | 可选受控 Raw Ref | 调试与协议复现，不进入普通正文 |
| Rule Definition / RuleSet order | 是 | 跟随真实 Carrier |
| Prompt Transform result | 否 | 单次 Build Projection；可保存 Artifact / Trace Ref |
| Display Transform string | 否 | 动态显示投影 |
| Match Record | 否 | 当前执行产物；可进入受控 Trace |
| DisplayPart | 否 | 可重建渲染协议，可做失效缓存 |
| Text Extractor output | 默认否 | 派生 Projection；长期逻辑事实应进入 State |

第一版不允许普通 Regex Rule 直接写 State、Document 或 Narrative。需要副作用时由明确 Script / Tool / Action 消费 Match Record，再通过 owning Application API 和权限边界提交。

## 9. 预算与失败语义

Archive Policy 先缩小候选 History；执行预算只针对 Active Entries。

第一版合同至少保留以下 Host Hard Limit：

- 单 Entry 最大处理字符数；
- 单 Phase 最大启用 Rule 数；
- 每条 Rule 最大 Match 数；
- 最大替换后文本长度和膨胀比例；
- 单次 Projection 总执行时间；
- 单 Entry 最大 DisplayPart 数；
- 单 Scope 最大活跃 iframe / Widget 数；
- Extractor 输出最大 JSON 大小。

具体默认数值在实现前通过真实 Card / Preset 样本测量。普通 Rule 可以申请更小预算，不能突破 Host 上限。

失败规则：

- Pattern 编译失败：禁用该 Rule 并产生 Diagnostic；
- 单 Rule 执行失败：保留上一阶段文本，不让整段 History 消失；
- Reasoning / Tool 分类不完整：不提升、不执行，保留原文并标记错误；
- Extractor 解析失败：不覆盖上一份 valid Projection，Consumer 收到 stale + Diagnostic；
- Renderer 失败：回退为安全文本 / JSON Preview，不修改 canonical data。

## 10. 分阶段实施

### Phase 0：样本、合同与 Regex Runtime Spike

目标：固定真实 Rule、排序、范围和安全边界，不先建设 UI。

任务：

1. 收集思维链隐藏、摘要隐藏、状态标签、WorldState、choice、纯文本清理等真实样本；
2. 固定 Rule、RuleSet、Match Record、Projection Snapshot 和 Diagnostic 候选 Schema；
3. 验证 Node / Browser 原生 RegExp 的 Flags、命名捕获、Unicode、长文本和灾难回溯表现；
4. 对比原生 RegExp + Worker 隔离与 RE2/WASM 的能力损失和集成成本；
5. 固定第一版 Budget 与失败回退。

停止点：形成 Spike 结果与批准合同后再实施 Store / Runtime。

### Phase 1：History Projection 与声明式 Rule Registry

目标：先打通 Narrative / Session 两类 History 的纯文本匹配和替换。

任务：

1. 新增 Rule Definition / RuleSet 持久化合同；
2. 实现 Carrier 注册、Mount、开关和确定排序；
3. 实现 Lineage、Archive、统一 Depth 与 Active Entry Selection；
4. 实现 Match / Replace、Trace、Diff 和 Prompt / Display 两种 Projection；
5. 接入 Narrative History 与 Session History PromptBuild Source；
6. 不接入 Setting、Preset 正文或其他泛化文本范围。

验收：同一 Source Snapshot、RuleSet Revision 和 Phase 得到确定结果；Archived Entry、运行事件和未挂载规则不参与执行。

### Phase 2：Reasoning Promotion 与 Content Classification

目标：把 Assistant Content 中的 Reasoning / Content Tool 从普通正文提升为 canonical 类型化 Entry。

任务：

1. 扩展 Agent Transcript Reasoning Entry；
2. 抽取通用 Assistant Content Classification Pipeline；
3. Reasoning Promotion 先于 Content Tool Scanner；
4. Content Tool 迁移到同一分类结果，不改变现有 Invocation / Result 配对；
5. Gateway Native Reasoning 与 Content-promoted Reasoning 归一到 canonical Entry；
6. 实现 Reasoning Display / Prompt Replay Policy；
7. 确保 `<think>` 内伪 Tool / status / choice 不进入普通文本或执行路径。

验收：普通正文、Reasoning、Content Tool 混合输出按原顺序分离；Provider `stop` 不影响 Tool 判断；Reasoning 单独折叠显示且不会污染 Narrative Commit。

### Phase 3：Text Extractor 与 DisplayPart

目标：让匹配阶段产物可以安全驱动消息内或 Scope UI。

任务：

1. 实现 Text Extractor Registry、Tag / Regex Matcher 与 Output Schema；
2. 实现 `latest-valid` 和基础 `all-matches` Selector；
3. 实现 DisplayPart、Semantic Matcher 和 Renderer Registry；
4. Display Text Transform 固定先于 Semantic Matcher；
5. WorldState、status、choice 使用 Fake Renderer 覆盖主合同；
6. 不执行任意 Replacement HTML。

验收：同一 WorldState 正文可生成结构化 Projection；Malformed 新块不覆盖上一份 valid 数据；Rule / Extractor 修改后 Projection 可重建。

### Phase 4：Client Host Slot 与非消息 Widget

目标：支持 Timeline / Agent Session Scope UI，不把重型界面重复挂到每条消息。

任务：

1. 固定第一批 Client Slot 与 Instance Scope；
2. 实现 Widget Data Source Subscription；
3. 先提供 Host-owned inline / panel renderer；
4. 再接入 sandbox iframe、MessagePort Bridge、尺寸、焦点和销毁；
5. Action 只能通过受控 RPC / Agent Input / Tool / State Mutation；
6. 插件不能 querySelector 宿主消息 DOM。

验收：切换 Timeline / Branch / Session 时 Widget 获取正确 Projection，旧 Instance 被释放；一百条历史消息不会创建一百个世界仪表盘 iframe。

### Phase 5：集中 Workbench 与 Dry Run

目标：提供 ST 式低门槛管理体验，但展示 Loom 的真实来源、阶段和投影边界。

任务：

1. 增加 Replace Rules / Extractors / Renderers 三个 Tab；
2. 增加来源过滤、最终顺序、挂载和开关；
3. 增加 Pattern / Replacement 编辑、Test Mode、Capture、Diff 和 Trace；
4. 增加 Prompt / Display、Narrative / Session、Depth Range；
5. 增加 Projection Consumer、Slot、State / Text Data Source 和权限展示；
6. 人工验收长列表、拖拽、错误提示、响应式和编辑手感。

## 11. 最小跨阶段验证矩阵

| 风险 | 最小自动证据 | 不替代的验收 |
|---|---|---|
| Rule 顺序与范围 | Sequential replace、Depth、Archive 单元测试 | 不等于作者规则质量 |
| History Source 正确性 | Branch / Session lineage 集成测试 | 不等于所有 Fork UX |
| Reasoning / Tool 分类 | 混合正文、伪标签、未闭合、Provider stop 测试 | 不等于真实 Provider reasoning 兼容 |
| Prompt 一致性 | Preview / Invoke 使用同一 Projection Snapshot | 不等于模型输出质量 |
| Extractor | latest-valid、Schema、stale fallback 测试 | 不等于复杂格式均可解析 |
| Renderer | DisplayPart / Slot / Data Source 组件测试 | 仍需人工视觉与交互验收 |
| 安全与预算 | 超长输入、Match 上限、膨胀、Timeout 测试 | 不等于不可信 Extension 强隔离完成 |

## 12. 明确非目标

- 完整 JavaScript / PCRE Regex 兼容；
- 对任意 Prompt Resource、世界书、快捷命令和 Provider 内部对象运行 Regex；
- Regex Rule 直接写 State、Document 或执行 Tool；
- 把 DisplayPart、HTML 或 Renderer DOM 持久化为正文；
- 允许替换字符串注入宿主 `innerHTML`；
- 通过 Rule 排序解决任意嵌套语言解析；
- 在可靠 Client Host 前运行不可信 iframe Script；
- 把 Provider Reasoning Signature、Encrypted Payload 或 Item ID 伪装成通用文本；
- 让一个 Summary / Archive Policy 与 Regex Rule 相互隐式修改。

## 13. 完成定义

本计划完成时应满足：

1. Narrative / Session History 使用同一受控 Projection Service 和统一 Depth；
2. Workspace、Preset、Card、Extension 和 User RuleSet 可组合、排序、追踪和禁用；
3. Prompt / Display Transform 不覆盖 canonical 原文；
4. Assistant Content 中的 Reasoning 与 Content Tool 被提升为类型化 Entry；
5. `<think>` 内伪 Tool、status、choice 不污染执行与渲染；
6. Match Record、Transformed History 和 Projection Snapshot 可被受权消费者读取；
7. Text Extractor 可以把 WorldState 等正文结构投影为 Widget Data Source；
8. 重型 UI 按 Timeline / Session Scope 挂载，不在每条消息重复实例化；
9. Regex、Extractor、Renderer 都有预算、Diagnostic、Dry Run 和安全回退；
10. 没有把 Regex 扩张成第二套 Prompt Resource、State 或 Extension Runtime。
