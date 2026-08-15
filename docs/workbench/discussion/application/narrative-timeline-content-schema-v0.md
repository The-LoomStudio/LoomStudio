# Narrative Timeline Content Schema v0

> **状态**：Core Node Implemented / Semantic Projection Pending
> **日期**：2026-08-11
> **主题**：Narrative Timeline 的正文节点、Loom Markdown source、Semantic Part、派生 Projection 与多目标投影边界。
> **事实边界**：Narrative Timeline / Branch / Node 与 `loom-markdown.v1` raw source 已实现；Semantic Part、派生 Projection 与作者自定义 Renderer 仍是目标设计。

---

## 1. 核心判断

Narrative Timeline 是剧情世界线的正文权威树，不是 Chat，也不使用 Chat Completions `Message[]` 心智模型。

```text
Narrative Timeline
  -> Narrative Branch
  -> Narrative Node Tree
  -> accepted narrative source
```

每个 Narrative Node 保存一份可编辑、可导出、可重新编译的原始正文。Markdown、Semantic Part、前端 Renderer 和 Prompt Projection 不得形成第二份 canonical 正文。

---

## 2. Timeline / Branch / Node

候选目标结构：

```ts
type NarrativeTimeline = {
  id: string
  activeBranchId: string
  createdFromCardId?: string
  createdAt: string
  updatedAt: string
}

type NarrativeBranch = {
  id: string
  timelineId: string
  headNodeId?: string
  parentBranchId?: string
  forkedFromNodeId?: string
  createdAt: string
  updatedAt: string
}

type NarrativeNode = {
  id: string
  timelineId: string
  parentNodeId?: string
  body: {
    format: 'loom-markdown.v1'
    raw: string
  }
  source?: {
    agentSessionId?: string
    agentMessageId?: string
    runId?: string
    changesetId?: string
  }
  createdAt: string
}
```

字段名在代码实施前仍可按现有命名风格调整，但以下语义已经固定：

- Narrative Node 没有 `user | assistant` role；
- Branch 通过 `headNodeId` 和 Node `parentNodeId` 得到路径；
- Fork 后的祖先 Node 可以被多个 Branch 共享；
- Node 的正文真相只有 `body.raw`；
- Provider raw response、Agent 工作记录和渲染结果不进入 Narrative Node。

短对白、长正文和纯叙述使用同一种 Node。文本长度和视觉样式不决定数据类型。

---

## 3. Source、Segment 与 Semantic Part

Narrative source 始终是字符串。普通区域可以使用 Markdown；作者也可以在标签内使用 YAML-like KV 排版，让自然语言内容更容易被作者和模型阅读、定位。

```text
她低头看向手机，屏幕突然亮起。

<chat>
avatar: asset:character/alice/avatar
message: |
  **今晚**还回来吗？
bubble:
  side: left
  tone: quiet
</chat>
```

YAML-like 排版本身没有系统语义。只有某个已注册的 Semantic Compiler 明确声明接管该标签时，Host 才把对应 block body 交给它编译：

```text
body.raw
  -> tagged block scanner
  -> registered Semantic Compiler
  -> NarrativeSegment[]
       - TextSegment
       - SemanticPart
```

候选通用结构：

```ts
type NarrativeSegment =
  | {
      type: 'text'
      sourceRange: SourceRange
    }
  | {
      type: 'semantic'
      sourceRange: SourceRange
      part: SemanticPart
    }

type SemanticPart = {
  kind: string
  schemaVersion: number
  data: JsonObject
  prompt: {
    mode: 'omit' | 'fallback' | 'custom'
  }
  fallbackText?: string
}
```

规则：

- YAML-like KV 只是 block body 中的作者文本约定，不是 Loom 系统配置格式；
- Core 不扫描或解释普通正文中的 YAML-looking 文本；
- 只有注册到对应 tag / alias 的 Semantic Compiler 才能解析 block body；
- Compiler 输出的 `data` 必须是 JSON-compatible object；
- TextSegment 只保存 source range，正文仍从 `body.raw` 读取，Projection Cache 不复制整段普通文本；
- `kind` 是带所有者的稳定 ID，例如 `author.example/chat`；
- `<chat>` 等短标签是 Card、Preset 或 Extension scope 内的 alias；alias 只负责把原始 block 路由到对应 Compiler；
- Renderer 只消费 `SemanticPart`，不得再次解析原始标签或 YAML；
- v1 不支持 Semantic block 嵌套；
- 解析失败、alias 缺失或 Schema 校验失败必须产生 Diagnostic，不能静默吞掉正文。

Extension 缺失时，Host 保留并展示原始 source，不猜测其中的 YAML-like KV。Prompt Projection 对无法执行的 `custom` part 默认 fail closed：省略该 Part 并产生 Diagnostic，不把未知结构误当成系统字段。

---

## 4. Markdown 的边界

Markdown 只是 `TextSegment` 的内置显示优化，不是 Semantic Part 协议，也不是通用 Render IR。

```text
TextSegment.raw
  -> built-in Markdown renderer
  -> ordinary narrative DOM

SemanticPart
  -> registered semantic renderer
  -> chat bubble / phone view / status card / extension UI
```

通用 pipeline 不自动对 `SemanticPart.data` 中的字符串运行 Markdown。某个 Renderer 如果需要让 `message` 字段支持 Markdown，必须显式调用受控的文本渲染能力。

CodeMirror / Lezer syntax tree、mdast、hast、HTML 和 React Element 都属于编辑器或前端实现细节，不进入持久化 Schema。

---

## 5. 多目标 Projection

Semantic Part 不只服务前端 Renderer。注册它的 Handler 可以为不同目标提供投影：

```ts
type SemanticPartHandler = {
  kind: string
  projectDisplay(part: SemanticPart): DisplayPart
  projectPrompt(part: SemanticPart): string | undefined
  projectSearch(part: SemanticPart): string
  projectExport(part: SemanticPart): JsonValue
}
```

核心边界：

- Display Projection 决定前端如何展示；
- Prompt Projection 决定该 Part 被省略、使用 fallback，还是由 Extension 生成文本；
- Search Projection 提供可索引文本，不索引 Renderer DOM；
- Export Projection 保留 source 或生成目标格式；
- Display Transform 不得隐式改变 Prompt Projection；
- Prompt Transform 不得写回 Narrative canonical source。

Semantic Part 中的头像和资源优先使用 `asset:` 引用。外部 URL、iframe、点击 Action 与动态数据读取仍受 Renderer 权限、安全和隐私策略控制，YAML 数据本身不授予能力。

Narrative 内联组件默认保存提交时的快照数据。实时状态面板应位于 Narrative 外部；未来如支持 live binding，必须显式声明并经过权限校验。

---

## 6. 派生 Projection 持久化

为了避免 SillyTavern 式的“每次显示都重新遍历全部聊天并执行全部正则”，Semantic 编译结果可以持久化，但只能作为可删除、可重建的派生数据。

```ts
type NarrativeProjection = {
  nodeId: string
  sourceHash: string
  compilerVersion: string
  aliasRegistryVersion: string
  ruleSetHash?: string
  segments: NarrativeSegment[]
  diagnostics: NarrativeDiagnostic[]
}
```

推荐物理边界是独立 Projection Cache / 派生表，而不是 Narrative Document 的权威字段：

```text
narrative_node_projection
  node_id
  source_hash
  compiler_version
  registry_version
  ruleset_hash
  segments_json
  diagnostics_json
```

Projection 不进入 Changeset，不广播为 Narrative 修改。以下任一条件变化时视为 cache miss：

- `body.raw` 改变；
- compiler version 改变；
- alias / part schema registry version 改变；
- 参与编译的 Transform Rule set 改变。

系统按 Node 和 Timeline window 增量重建，不在启动或打开 Timeline 时扫描全部历史。最终 HTML、主题、locale、React 状态和动态数据绑定结果不持久化。

---

## 7. 作者文本 / JSON 边界

```text
Author-written prompt and narrative source:
  string
  may use Markdown, XML-like tags and YAML-like KV for readability

Runtime / SQL / RPC:
  JSON-compatible object
```

Loom 不把 YAML 定义为 Preset、Setting Layer、Card、Manifest、SQL Document 或 RPC 的通用系统格式。系统 canonical data 继续使用 JSON-compatible object，作者正文仍然是 string。

某个 Extension 的 Semantic Compiler 可以选择使用 YAML parser，但这是该 Compiler 的局部实现。使用时至少应禁止：

- custom YAML tags；
- anchor / alias / merge key；
- multiple documents；
- 非字符串 object key；
- 自动 Date 或其他非 JSON runtime type；
- 超出限制的 payload、深度和集合大小。

局部解析结果必须经过 kind 对应的 Schema validation，再归一为 `JsonObject`。其他系统模块不得因为某段作者文本看起来像 YAML 就自动读取其中的 KV。

---

## 8. 当前实现差异

当前 M0 仍使用：

- `SessionContent`；
- `NarrativeBranchContent.sessionId`；
- `NarrativeEntryContent.role`；
- `NarrativeEntryContent.content: string`；
- `submitTurn` 自动写入 user / assistant Narrative Entry。

这些是过渡实现，不代表本文目标 Schema 已经落地。迁移应与 Agent Session / Chat Message 基座分阶段进行。

---

## 9. 非目标

本文不定义：

- 最终 Semantic tag parser grammar 的全部错误恢复细节；
- Renderer SDK 和 iframe sandbox 实现；
- 任意 HTML / CSS / JavaScript 内嵌执行；
- YAML Preset / Setting / Card / Manifest 等系统文件格式；
- Timeline 分页、FTS 和 Projection Cache 的具体 SQL migration；
- live state binding；
- ST Regex 的完整兼容层。
