# Chat / Opening Model v0

> **状态**：从 ADR-005 迁移 / 开放设计  
> **来源**：[`../adr/ADR-005-official-concept-stack-open-design.md`](../adr/ADR-005-official-concept-stack-open-design.md)

---

## 来自 CS-0 的 Opening 方向

#### 6.1.4 Opening 取代 First Message

`First Message` 这个名字不准确。

它在很多内容中并不是“第一条发给模型的 message”，而可能是：

- 开场场景；
- 首楼；
- 预制剧情；
- 一段假装已经发生过的对话；
- 教学任务开端；
- workflow 初始材料。

当前采用更宽、更中性的术语：

```text
Opening
```

重要约束：

```text
Opening must not become a special first Chat element.
```

Opening 应被视为 Card / Session 初始化材料中的一部分。其具体嵌入方式由 Composition Skeleton 和后续 Chat / Opening model 决定，而不是硬编码为 Chat[] 的第一个元素。

Opening 的内部是否直接复用未来的 `ChatEntry` / `TimelineEntry` 结构仍未定。本文不接受额外发明 `OpeningEntry.kind = narration/dialogue/...` 这类过早分类。

---

## CS-1：Chat / Opening Model

### 7.1 问题

`messages[]` 不是 Chat 本体。它只是某些 Provider API 的请求 payload。

Studio Application 需要继续区分 Chat、Opening 与最终 compiled message payload。

当前已定原则：

```text
Opening is not a special first Chat element.
```

Studio Application 仍需要自己的 Chat / Session model，用于表达：

- session；
- timeline；
- message；
- 发言来源或条目来源；
- branch / variant / retry；
- message part；
- hidden prompt-only content；
- state patches；
- asset references。

### 7.2 开放问题

- Session 是否等于一次游玩 / 一次对话 / 一次运行实例？
- 是否支持 timeline / branch？
- swipe 是 message variant 还是 branch？
- 用户编辑历史消息后，是覆盖还是新分支？
- assistant 回复是否允许多个候选？
- `Message` 一词是否只保留给最终 compiled payload item？
- 持久化聊天记录应叫 ChatEntry、TimelineEntry，还是其他名称？
- Opening 是否复用 ChatEntry / TimelineEntry 结构？
- Opening 如何表达一段预制剧情或预制对话，而不成为 Chat[] 中的特殊第一项？
- user / assistant / system 是否只是 compiled payload 的 role，而不是领域层 role？
- 聊天记录条目是否允许隐藏但参与 prompt？
- 聊天记录条目是否能携带 state patch？
- 聊天记录条目是否能引用 Asset Store 中的多媒体？

### 7.3 候选草案

```ts
type ChatSession = {
  id: string
  title: string
  participantIds: string[]
  timelineId: string
  activePresetId?: string
  activeKnowledgeSetIds?: string[]
  activeMemorySetIds?: string[]
  createdAt: string
  updatedAt: string
}

type ChatMessage = {
  id: string
  sessionId: string
  author: ActorRef
  role: InteractionRole
  parts: MessagePart[]
  createdAt: string
  parentMessageId?: string
  branchId?: string
  statePatchRefs?: string[]
  source?: MessageSource
}

type MessagePart =
  | { type: 'text'; text: string }
  | { type: 'asset-ref'; assetId: string; mimeType?: string }
```

这个草案早于上文 CS-0 的边界收束，尚未被接受。尤其是 `ActorRef` / `InteractionRole` / `Message` 的命名，应在实现前重新审视。
