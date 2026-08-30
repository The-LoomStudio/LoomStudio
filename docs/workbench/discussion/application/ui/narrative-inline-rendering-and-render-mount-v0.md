# Narrative Inline Rendering 与 Render Mount v0

> **状态**：Partially Promoted / Core Implemented
>
> **日期**：2026-08-28
>
> **目的**：固定 Narrative 与 Agent Message 的消息内渲染边界，定义正文派生 DisplayPart、Extension Node Binding、动态 Render Mount 与流式显示之间的关系；已落地的 Client Renderer Host 与 Render Mount 合同见 [`../../../../architecture/extensions/client-renderer-host.md`](../../../../architecture/extensions/client-renderer-host.md)。

## 1. 决策摘要

消息内渲染保留两条来源，但最终都只产生临时 `DisplayPart`：

```text
Canonical Message Text
  -> Display Transform / Semantic Matcher
  -> DisplayPart

Node-bound Extension Record
  -> Extension Display Provider
  -> Node Render Mount
  -> DisplayPart
```

当前接受以下边界：

1. `NarrativeNode.body.raw` 与 Agent Message 原文继续是 canonical text；Renderer 不写回正文。
2. `DisplayPart` 是可删除、可重建的渲染协议，不作为 canonical data 持久化。
3. Extension 私有 Prompt、生成参数、任务状态、历史结果和当前 Asset 继续保存在自己的 Config / Record Schema 中。
4. Extension Record 已可持久绑定 Narrative Node、Agent Message、Asset 和 State Path；不为消息渲染再复制一套 Extension 数据关系。
5. `Node Render Mount` 只描述当前一次 Projection 中“挂在哪里、交给什么 Renderer”，自身不持久化。
6. 消息内纯显示可以随 Streaming Draft 重算；Capture、Extractor、副作用和持久写入默认等完整输出结束后执行。
7. 正文 Marker 是可选的高稳定性定位方式，不是所有消息内 Renderer 的前提。
8. Renderer Projection 必须纯、幂等、有预算；重复计算不能不断向已有 DOM 或 DisplayPart 列表追加实例。

## 2. 当前实现事实

当前已经实现：

- Narrative / Agent Session History Projection；
- Display Transform、Match Record 与 Text Extractor；
- 内置 Artifact Renderer Catalog 与最小 Slot Host；
- Client Extension Renderer Registry、Surface 仲裁与动态实例生命周期；
- Narrative Node / Agent Message 的 `node.before`、`node.after` 与唯一 literal inline anchor；
- Direct、Shadow DOM、sandbox iframe 与 Standalone Adapter；
- `DisplayPart` 与 Node Render Mount 的瞬时投影。

当前仍未实现的是正式 Match / Marker Anchor 数据源、Streaming Draft Projection、Narrative Attachment，以及 Host Appearance / Style Contribution。内置 `listRenderers` 仍只返回官方 JSON 兼容 Renderer；第三方 Renderer 从 Extension Catalog 声明并在浏览器运行时注册。

Extension 数据基础已经提供：

```ts
type ExtensionEntityRef =
  | { kind: 'narrative-node'; timelineId: string; nodeId: string }
  | { kind: 'agent-message'; agentSessionId: string; messageId: string }
  | { kind: 'asset'; assetId: string }
  | { kind: 'state-path'; timelineId: string; path: string }
```

因此 Extension 可以持久保存自己的数据并绑定到目标 Node；Renderer 阶段不需要先建设 Card Scope、Node Scope、通用 Graph Store 或 Core-owned 文生图数据库。

## 3. 两种消息内 DisplayPart 来源

### 3.1 正文派生

正文中的已注册结构由统一文本管线处理：

```text
Raw Text
  -> ordered Display Rules
  -> Semantic Matcher / Compiler
  -> TextSegment + DisplayPart
```

这条路径适合：

- `<status>`、`<choice>`、`<WorldState>` 等作者文本协议；
- Preset / Card 提供的通用消息显示规则；
- 需要随着正文导出、编辑和分支自然移动的 Source Block。

原始 Source 可以持久化在正文中，但 Renderer DOM、HTML、React Element 和最终 DisplayPart 不进入正文。

### 3.2 Extension 外部贡献

Extension 可以不修改正文，而是从自身 Node-bound Record 动态贡献显示内容：

```text
Narrative Node
  -> list current Package Records bound to Node
  -> Extension Display Provider
  -> Node Render Mount[]
  -> Host resolves target
  -> DisplayPart[]
```

这条路径适合：

- 正文提交后异步生成的图片；
- 插件私有的按钮、状态和重生成操作；
- 只需要绑定整条消息 before / after 的展示；
- 不应进入 Narrative canonical text 的运行数据。

Extension Display Provider 只能读取已经授权的数据并返回投影结果。它不能在 Projection 中发起文生图、写 State、创建 Asset、提交 Document 或修改 DOM。

## 4. 最小 Render Mount 合同

候选最小形态：

```ts
type NodeRenderMount = {
  key: string
  target:
    | { slot: 'node.before' }
    | { slot: 'node.after' }
    | {
        slot: 'node.inline'
        selector: TextSelector
        placement: 'before' | 'after' | 'replace'
      }
  part: DisplayPart
}
```

`nodeId` 属于外层 Node Projection Context，不属于内部定位器：

```ts
type NodeDisplayProjectionContext = {
  nodeId: string
  rawText: string
  displayText: string
  surface: 'narrative' | 'agent-message'
}
```

持久 Node Binding 回答“属于哪一条消息”；`target` 回答“在这条消息的哪个显示位置”。不要把插件业务数据、Asset Schema 或生成参数塞入 `target`。

第一版 `TextSelector` 只需要覆盖已证明的需求：

```ts
type TextSelector =
  | { kind: 'literal'; value: string }
  | { kind: 'match-ref'; matchId: string }
  | { kind: 'marker'; markerId: string }
```

- `literal`：Extension 在自己的数据中保存目标句子，Host 使用统一引擎定位；
- `match-ref`：复用当前 Display Pipeline 已经生成的受控 Match Record；
- `marker`：正文允许显式稳定 Marker 时使用。

首版不需要允许每个 Extension Record 注册任意持久 Regex Rule。动态 Regex 是否进入 Mount Selector，等待真实样本证明 `literal`、已有 Match Record 和 Marker 不足后再决定。

## 5. 幂等、排序与失败

每次 Projection 都从 canonical text、当前有效 RuleSet、当前 Node Binding 和当前 Renderer Registry 重新构建：

```text
Projection Input
  -> fresh Mount list
  -> target resolution
  -> ordered DisplayPart list
  -> React / Renderer output
```

Host 不在既有 DOM 上累积 append。Mount 使用稳定身份：

```text
packageId + recordId + mount.key
```

同一 Projection 中身份重复时产生 Diagnostic，不重复渲染。第一版定位规则保持保守：

- `literal` 恰好命中一次：挂载；
- 没有命中：标记 unresolved；
- 命中多次：标记 ambiguous，不由 Host 猜测；
- Renderer 缺失或失败：回退安全文本 / JSON Preview，或按注册的 fallback 隐藏；
- 单 Node 的 Mount 数、匹配字符数、执行时间和 DisplayPart 数受 Host Hard Limit 约束。

是否允许 Extension 为 unresolved inline Mount 显式声明 `node.after` fallback，留到 API Schema 阶段决定，不在本讨论中提前增加字段。

## 6. Streaming

Streaming 分成纯显示和最终消费：

```text
Provider text delta
  -> in-memory Draft Buffer
  -> throttled Display Projection
  -> provisional DisplayPart

Provider Step terminal
  -> final classification / Display Projection
  -> Capture / Extractor
  -> canonical Message / Node and controlled mutations
```

消息内纯渲染可以在每次 Draft Snapshot 上重算。它必须满足：

- 结果是 provisional，可以被后续字符全部替换；
- 未闭合标签不触发行为；
- 不产生 Tool、Job、Asset、State 或 Document 副作用；
- Run 取消或失败后不留下 canonical DisplayPart。

Capture、Extractor 和文生图触发默认等完整输出结束后统一执行。Native Tool 或 Content Tool 也只有在输入闭合、完成校验并形成 canonical Invocation 后才能执行。

## 7. 文生图 Extension 示例

文生图 Extension 通常同时贡献管理 UI 和消息 Renderer，但两者是独立注册：

```text
Management UI
  -> Toolbench / Studio Panel / Workspace Window / Standalone Page

Message Rendering
  -> Node-bound Extension Record
  -> Extension Display Provider
  -> narrative node.before / node.after / node.inline
```

推荐异步链路：

```text
Narrative Node committed
  -> Extension creates durable generation job
  -> publish Asset
  -> create or update Extension Record
       bindings: Narrative Node + current Asset
       data: Extension-private prompt / options / attempts / status
  -> Client receives updated data
  -> Display Provider emits Node Render Mount
  -> Host inserts DisplayPart
```

重新生成、重置和切换当前图片只修改 Extension 自己的 Record 与 Asset Binding，不要求修改正文。若作者要求图片绝对跟随某个正文位置并在频繁编辑后保持稳定，可以选择正文 Marker；整条消息 before / after 不需要 Marker。

Core 不解释画师串、模型参数、Prompt、采样器或生成历史，也不为文生图建立专用 Schema。

## 8. 持久化边界

| 数据 | 是否持久化 | 所有者 |
|---|---:|---|
| Narrative / Agent Message raw text | 是 | Narrative / Agent Store |
| Display Rule / Semantic Compiler definition | 是 | 对应 Workspace / Preset / Card / Extension Carrier |
| Extension Config / Record | 是 | Extension Package |
| Node / Agent Message / Asset Binding | 是 | Extension Record typed binding |
| Node Render Mount | 否 | 当前 Display Projection |
| Match Record | 否 | 当前 Projection，可进入受控 Trace |
| DisplayPart | 否 | 当前 Display Projection，可做失效缓存 |
| Renderer DOM / iframe Document | 否 | Client Runtime |
| Asset bytes / metadata | 是 | Asset Store |

当前不新建通用 `NarrativeAttachment` Document。已有 Extension Record Binding 足以覆盖 Extension-owned 数据与 Node / Asset 关系。未来若第一方普通附件、跨 Extension fallback 或导出闭包证明需要共享的 Core Attachment 语义，再建立窄合同，不能先做万能附件层。

## 9. 与 Regex / Transform Rule 的边界

Regex Rule 是可复用的文本处理配置；Node Render Mount 是某次 Projection 的显示贡献：

```text
Regex Rule
  对一类文本持续生效

Extension Record + Render Mount
  对某个已绑定 Node 贡献一个显示实例
```

不要为每张图片、每个按钮或每条插件记录注册一次性 Regex Rule。Extension 可以使用自己的 Schema 保存目标句子或其他定位依据，再通过 Host 的统一 Selector 能力解析；所有匹配继续受官方文本引擎的范围、预算和 Diagnostic 管理。

## 10. 后续实施接缝

非消息 Surface、冲突仲裁与 Client Extension Host 已收束为独立实施计划：

- [`Renderer Surface 与 Client Extension Host 实施计划`](../../../../archive/plans/renderer-surface-and-client-host-implementation-plan.md)

已接受的核心边界：

- Surface 是 Host 管理位置、生命周期、冲突和降级的合同，不是 Extension 插入 DOM 的权限；
- `narrative.timeline.tail` / `agent.session.tail` 是多实例 Collection Surface；
- `shell.background`、`composer.sheet` 与 `shell.focus-surface` 是单实例 Exclusive Surface；
- `shell.workspace-panel` 与 `standalone.page` 是 Navigation Surface；
- Node 内 Render Mount 是 Anchored Projection；
- 同源 Direct DOM 只能作为不受支持的 escape hatch，不能冒充正式 Renderer 合同或安全边界。

消息内 Node Render Mount 在实施计划 Phase 3 接入 Client Renderer Data Source，不复制 Extension Record、Asset 或 Node Binding。

## 11. 非目标

本文不定义：

- Renderer SDK 的最终 TypeScript API；
- 新的通用 Narrative Attachment Store；
- 文生图专用 Core Schema；
- 任意 HTML / CSS / JavaScript 写入正文；
- Renderer 内直接执行副作用；
- 完整 Regex 兼容层；
- Client Runtime Adapter 的具体实现。
