# Loom Core 对接边界 v0

> **状态**：Open Design
> **主题**：Prompt Builder 如何使用 `@loom/core`，以及哪些能力不应进入 Core。

---

## 1. 核心判断

`@loom/core` 不应升级为提示词编译器。

当前更准确的分层是：

```text
@loom/core:
  领域无关的 Fragment pipeline engine。

Studio Application Prompt Builder:
  AIRP prompt composition compiler。

Provider Adapter:
  provider-specific request mapper / invoker。
```

这意味着 Core 保持：

```text
Fragment[] + Pass[] -> Fragment[] + Trace
```

Prompt Builder 在 Core 外定义：

- source adapter；
- composition fragment meta convention；
- slot assignment；
- ordering；
- fill policy；
- compiled prompt payload；
- provider compatibility diagnostics。

---

## 2. 为什么不把 messages[] build 放进 Core

`messages[]` 不是稳定的 Core 抽象。

不同 provider 的最终请求结构差异明显：

- OpenAI 风格常用 `messages[]`；
- Anthropic 有 system 分离；
- Gemini 有 `contents` / `systemInstruction`，并使用不同 role 心智；
- 一些 provider 对 assistant prefill、多 system、message name、tool call、content parts 支持不同；
- 未来模型 API 还会继续变化。

如果 Core 内建 `messages[]`，Core 会被某一种 provider family 的历史格式锁定。

但这不代表 `messages[]` build 不重要。

正确位置是：

```text
Studio Application Prompt Builder:
  输出 messages-like 或 provider-neutral compiled payload。

Provider Adapter:
  将 compiled payload 映射到具体 provider request body。
```

---

## 3. Prompt Builder 如何使用 Core

候选 pipeline：

```text
Documents / Runtime Sources
  -> Source Adapters
  -> Composition Fragment[]
  -> loom.run
       NormalizeFragments
       SelectSettingEntries
       AssignSlots
       OrderBySkeleton
       FillSkeleton
       EmitCompiledPromptPayload
  -> Compiled Prompt Payload
```

这里的 `AssignSlots`、`OrderBySkeleton`、`FillSkeleton`、`EmitCompiledPromptPayload` 是 Studio Application 语义，不是 Core 语义。

Core 只负责：

- 执行 pass；
- 校验 fragment 基础结构；
- 记录 trace / mutation；
- 记录 diagnostics；
- owner tracking。

---

## 4. Composition Fragment Meta

Prompt Builder 可以定义自己的 metadata convention。

候选方向：

```ts
type CompositionFragmentMeta = {
  airpKind: string
  sourceDocumentId?: string
  sourceField?: string
  sourceKind?: string

  slot?: string
  order?: number
  priority?: number

  placement?: unknown
  fillPolicy?: unknown
  providerHints?: Record<string, unknown>

  activation?: {
    active: boolean
    reason?: string
  }
}
```

注意：

```text
这是 Studio Application convention，不是 @loom/core schema。
```

`@loom/core` 不应读取或解释这些字段。

---

## 5. Dynamic Slot Ordering 仍是 Application Pass

动态 slot 排序不改变 Core 边界。

Loom Studio 可以把当前 session / card / worldbook / plugin source set 转成 Composition Fragments，并在 Application meta 中携带 projection 信息：

```ts
type ProjectionMeta = {
  injectionGroupKey?: string
  slotKey?: string
  entryKey?: string
  slotOrderHint?: number
  entryOrderHint?: number
  sortKey?: unknown
}
```

随后由 Prompt Builder 的 pass 完成：

```text
ResolveInjectionGroups
MaterializeDynamicSlots
ApplyProjectionOrderProfile
OrderPromptProjection
FillSkeleton
EmitCompiledPromptPayload
```

这些 pass 可以运行在 `loom.run` 中，但语义仍属于 Studio Application。

Core 只看到：

```text
Fragment[] + Pass[] -> Fragment[] + Trace
```

也就是说，Core 不内建 slot、worldbook、card、rankKey 或 preset；它只提供 pass 执行、mutation trace、diagnostics 和 owner tracking。

---

## 6. Compiled Payload 不是普通 JSON 字符串 fragment

PoC 中曾经把最终 OpenAI messages JSON stringify 后塞回一个 `openai-messages` fragment。

这适合验证，但不适合作为正式 contract。

正式方向应区分：

```text
Trace / fragments:
  用于解释 composition 过程。

Compiled Prompt Payload:
  用于 runtime / provider adapter 的结构化输出。
```

开放问题：

- `loom.run` 的最后一个 pass 是否仍返回一个 emit-result fragment；
- Prompt Builder RPC 是否额外返回结构化 payload；
- trace 如何把 payload segment 链回 source fragments；
- 多 target output 是否需要 M0 支持。

---

## 7. 非目标

Core 不做：

- Chat / Session 领域建模；
- Card / Setting / Opening 解析；
- `messages[]` contract；
- provider request body；
- token budget 的 provider-specific 规则；
- prompt preset UI；
- plugin contribution protocol。

这些属于 Studio Application、Runtime、Provider Adapter 或 Extension 层。
