# SillyTavern 架构参考

> **状态**：仅作参考
> **日期**：2026-05-17
> **范围**：Prompt Builder、Runtime、会话隔离，以及对 Loom Studio Official Concept Stack 讨论的启发。
> **说明**：本文不是已接受的 ADR，也不是实现规格。它只是保存 SillyTavern 源码调研笔记，供后续讨论使用。

---

## 1. 目的

本文记录一次对 SillyTavern 源码的高层阅读结果，用作 Loom Studio Official Concept Stack 设计时的参考对象。

SillyTavern 目前是 LLM 角色扮演生态里提示词组装能力最自由、复杂度最高的一类应用。它的实现难以维护，但其中有几个领域思想很有参考价值：

- prompt preset 可以被理解为最终输出的骨架；
- marker / slot 形式的组合机制；
- 世界书、聊天历史、角色资料、用户人格、扩展提示词都是运行时上下文来源；
- 内部聊天消息与 provider-facing `messages[]` 并不是同一个东西；
- 最终消息构建阶段需要统一处理 token budget。

本文保存在 `docs/workbench/reference/`，只作为历史外部参考；当前 Application 方向以 Architecture 和仍活跃的 Workbench 议题为准。

---

## 2. 总结

SillyTavern 的架构可以概括为：

```text
Browser UI
  -> sendTextareaMessage()
  -> Generate()
      -> 收集当前会话状态
      -> 收集角色 / 世界 / 扩展上下文
      -> 构建 prompt 或 messages
      -> 调用 provider 后端
      -> 处理响应
      -> 写回 chat
      -> 持久化 chat JSONL
```

最重要的观察：

```text
SillyTavern 的 preset 层本质上是 composition skeleton。
World Info、Chat History、Character、Persona、Author's Note、Extension Prompts 都是在往这个骨架里的 slot 填内容。
```

它的主要架构弱点不是 skeleton 思路本身，而是 runtime、prompt 构建、provider 分发、持久化、UI mutation、extension hooks 严重耦合在一起。

---

## 3. Prompt Builder 架构

### 3.1 主入口

顶层生成与 prompt construction 入口不是 `PromptManager`，而是：

```text
public/script.js
Generate(type, options, dryRun)
```

`Generate()` 会收集运行时材料：

```text
Character Card
Persona
Chat History
World Info
Author's Note
Extension Prompts
Examples
Bias / Quiet Prompt / Group Nudge
```

然后根据 API 模式分流：

```text
Text Completion:
  Generate() 内部构建最终字符串 prompt

Chat Completion:
  Generate()
    -> prepareOpenAIMessages()
    -> PromptManager / PromptCollection
    -> ChatCompletion
    -> messages[]
```

### 3.2 关键文件与函数

| 文件 | 关键符号 | 作用 |
|---|---|---|
| `public/script.js` | `Generate()` | 顶层生成编排与上下文收集 |
| `public/script.js` | `getCharacterCardFields()` | 读取角色卡字段 |
| `public/scripts/openai.js` | `prepareOpenAIMessages()` | Chat Completion prompt builder 入口 |
| `public/scripts/openai.js` | `preparePromptsForChatCompletion()` | 用运行时 prompt 材料填充 preset skeleton |
| `public/scripts/openai.js` | `populateChatCompletion()` | 构建最终 ChatCompletion 结构 |
| `public/scripts/openai.js` | `populateChatHistory()` | 在 token budget 下插入聊天历史 |
| `public/scripts/openai.js` | `ChatCompletion` | 具备 token budget 感知能力的 message builder 容器 |
| `public/scripts/openai.js` | `MessageCollection` | 消息分组 / slot 容器 |
| `public/scripts/openai.js` | `Message` | ChatML-like 消息 |
| `public/scripts/PromptManager.js` | `PromptManager` | preset、prompt order、marker、UI/dry-run 管理器 |
| `public/scripts/PromptManager.js` | `PromptCollection` | 有序 prompt skeleton 集合 |
| `public/scripts/PromptManager.js` | `Prompt` | prompt 或 marker prompt 条目 |
| `public/scripts/world-info.js` | `getWorldInfoPrompt()` | World Info prompt 组装入口 |
| `public/scripts/world-info.js` | `checkWorldInfo()` | World Info 激活扫描核心 |

### 3.3 Preset 作为骨架

OpenAI-style presets 包含两个核心数组：

```text
prompts[]
prompt_order[]
```

许多条目是 marker prompts，例如：

```text
main
worldInfoBefore
worldInfoAfter
charDescription
charPersonality
scenario
personaDescription
chatHistory
dialogueExamples
jailbreak
```

这些 marker prompts 本质上是 slot。它们不一定拥有最终运行时内容。运行时数据会通过 `identifier` 匹配，然后替换或填入对应 slot。

简化流程：

```text
PromptManager preset skeleton
  + runtime system prompts
  + character data
  + persona
  + world info
  + extension prompts
  + chat history
  + examples
  -> ChatCompletion
  -> messages[]
```

### 3.4 Chat Completion prompt construction 流程

```text
Generate()
  |
  v
prepareOpenAIMessages()
  |
  v
preparePromptsForChatCompletion()
  |
  +-- promptManager.getPromptCollection()
  |     从 preset prompts[] + prompt_order[] 获取骨架
  |
  +-- 构建运行时 prompts
  |     main
  |     worldInfoBefore
  |     worldInfoAfter
  |     charDescription
  |     charPersonality
  |     scenario
  |     personaDescription
  |     authorsNote
  |     summary
  |     vectors
  |
  +-- 按 identifier 替换 marker prompts
  |
  v
populateChatCompletion()
  |
  +-- 插入固定 slot
  +-- 插入 extension relative prompts
  +-- 插入 in-chat depth prompts
  +-- populateChatHistory()
  +-- populateDialogueExamples()
  +-- control prompts
  |
  v
chatCompletion.getChat()
  |
  v
messages[]
```

### 3.5 Provider-facing payload

在 Chat Completion 模式下，前端会先构建一个通用的 ChatML-like `messages[]`，然后发送给后端。

后端入口：

```text
src/endpoints/backends/chat-completions.js
router.post('/generate')
```

后端按 `chat_completion_source` 分发，并为不同 provider 转换或适配 messages，例如：

```text
OpenAI-compatible
Claude
Gemini / MakerSuite / VertexAI
Mistral
Cohere
DeepSeek
XAI
OpenRouter
Custom
```

prompt 转换辅助逻辑大致位于：

```text
src/prompt-converters.js
```

这提示我们可以采用类似分层：

```text
内部 composition payload
  -> provider adapter
  -> provider-specific request body
```

---

## 4. Runtime 架构

### 4.1 主 runtime 调用链

用户消息生成大致遵循：

```text
Send button
  -> sendTextareaMessage()
  -> Generate(type)
      -> sendMessageAsUser()
      -> collect context
      -> build prompt/messages
      -> sendGenerationRequest() or sendStreamingRequest()
      -> provider backend
      -> saveReply() / StreamingProcessor
      -> saveChatConditional()
```

### 4.2 `Generate()` 内部的 Runtime 职责

`Generate()` 是一个很大的 orchestration function。它混合了：

```text
user message commit
context collection
world info scanning
prompt construction
provider request data construction
request dispatch
streaming setup
non-streaming response handling
assistant message writeback
chat persistence
extension event hooks
UI state transitions
```

这很灵活，但会造成严重的边界耦合。

### 4.3 Provider 分发

前端分发入口：

```text
sendGenerationRequest()
sendStreamingRequest()
```

OpenAI-like 路径：

```text
sendOpenAIRequest()
  -> POST /api/backends/chat-completions/generate
```

Text completion 路径：

```text
POST /api/backends/text-completions/generate
```

其他路径包括 NovelAI、Kobold、Horde、text-generation-webui-like backends 等。

### 4.4 Streaming 响应处理

Streaming 处理主要集中在：

```text
public/script.js
StreamingProcessor
```

它的职责包括：

```text
create placeholder assistant message
hold abort controller
consume async generator chunks
update chat[messageId].mes incrementally
update DOM incrementally
track first-token timing
handle reasoning / tool calls / swipes / logprobs
finalize message
save chat
```

这是一个很有价值的边界参考，但在 Loom 中不应该直接修改 UI，也不应该绑定 provider-specific data。

### 4.5 Non-streaming 响应处理

Non-streaming 流程：

```text
sendGenerationRequest()
  -> provider response JSON
  -> onSuccess(data)
      -> extractMessageFromData()
      -> cleanUpMessage()
      -> saveReply()
      -> saveChatConditional()
```

---

## 5. Session / Chat 隔离

### 5.1 存储模型

SillyTavern 主要通过文件路径和前端全局状态来隔离 chat。

用户数据根目录大致如下：

```text
data/default-user/
  characters/
  chats/
  groups/
  group chats/
  worlds/
  settings.json
```

单角色 chat：

```text
chats/{characterAvatarWithoutPng}/{chatName}.jsonl
```

群聊 chat：

```text
group chats/{chatId}.jsonl
```

群组 metadata：

```text
groups/{groupId}.json
```

### 5.2 Chat 文件格式

每个 chat 文件都是 JSONL：

```text
第 1 行：ChatHeader
第 2 行以后：ChatMessage
```

Chat header 形状：

```js
{
  chat_metadata: { ... },
  user_name: 'unused',
  character_name: 'unused'
}
```

`chat_metadata` 是开放对象，被很多功能和扩展共同使用。

### 5.3 当前前端 session 状态

当前 session 状态主要由前端全局变量维护：

```js
chat
chat_metadata
this_chid
selected_group
characters
characters[this_chid].chat
groups[].chat_id
```

当前 chat id 大致这样派生：

```text
if selected_group:
  groups.find(id).chat_id
else:
  characters[this_chid].chat
```

### 5.4 内部 chat message 形状

SillyTavern 的内部聊天消息不是 provider `messages[]`。

它们通常包含：

```js
{
  name,
  is_user,
  is_system,
  send_date,
  mes,
  extra,
  swipe_id,
  swipes,
  swipe_info,
  force_avatar,
  original_avatar
}
```

这支持 provider-facing `messages[]` 无法直接表达的功能：

```text
swipes / variants
reasoning
media
file attachments
tool invocations
group character identity
message timing
model / API metadata
```

因此，即使是 SillyTavern，也在概念上隐含地区分了：

```text
canonical chat history
  != provider-facing messages[]
```

只是它的代码没有把这个边界整理干净。

### 5.5 群聊差异

单人 chat：

```text
current chat pointer = characters[this_chid].chat
chat directory = chats/{avatarWithoutPng}/
```

群聊：

```text
current chat pointer = group.chat_id
chat list = group.chats[]
chat files = group chats/{chatId}.jsonl
```

群聊消息会使用这些字段：

```text
force_avatar
original_avatar
name
```

这使多个 actor identity 可以保存在同一条共享聊天时间线中。

---

## 6. 综合流程图

```text
Browser UI
  |
  v
sendTextareaMessage()
  |
  v
Generate()
  |
  +-- write user message into chat[]
  |
  +-- read current session state
  |     chat[]
  |     chat_metadata
  |     this_chid / selected_group
  |     character card
  |     group state
  |
  +-- collect context materials
  |     character description
  |     personality
  |     scenario
  |     persona
  |     examples
  |     world info
  |     extension prompts
  |
  +-- Prompt Builder
  |     |
  |     +-- Text Completion -> string prompt
  |     |
  |     +-- Chat Completion
  |           PromptManager preset skeleton
  |             -> fill marker slots
  |             -> ChatCompletion token budget
  |             -> messages[]
  |
  +-- Provider Request
  |     sendOpenAIRequest / textgen / novel / kobold
  |
  +-- Response Handling
  |     non-streaming: saveReply()
  |     streaming: StreamingProcessor
  |
  +-- Persistence
        saveChatConditional()
          -> /api/chats/save
          -> JSONL file
```

---

## 7. 对 Loom Official Concept Stack 的启发

### 7.1 保留 skeleton-and-slot 洞察

SillyTavern 证明了 prompt preset 最适合被理解为 composition skeleton。

Skeleton 定义稳定输出 slot 和最终 prompt/message 结构。运行时来源负责填充这些 slot。

对 Loom 来说，这提示一种 canonical separation：

```text
Composition Skeleton
  定义 slots / order / role / output shape

Context Sources
  character / actor / persona / chat history / knowledge / memory / extensions

Composer
  填充 slots，排序 fragments，应用 token budget，emit payload
```

### 7.2 不要让 Worldbook 拥有最终输出结构

Worldbook / Knowledge 不应该直接拥有最终 message 结构。

更好的分层：

```text
Knowledge Layer:
  activation and selected facts

Composition Layer:
  slot assignment and ordering

Emitter:
  messages-like payload or other target output
```

### 7.3 Chat canonical model 不能是 provider `messages[]`

SillyTavern 自己的内部消息也需要 provider `messages[]` 无法干净表达的字段：

```text
actor identity
swipes / variants
media
reasoning
tool invocations
attachments
group speaker identity
message lifecycle metadata
```

因此 Loom 应该维护：

```text
official.concept.message = canonical chat document
messages-like payload = compose output artifact
```

### 7.4 分离 runtime、composition、provider、persistence

SillyTavern 最大的架构问题是这些层耦合在一起：

```text
session state
prompt composition
world/knowledge activation
provider invocation
streaming response handling
persistence
UI mutation
extension hooks
```

Loom 应该把它们分离为：

```text
Concept Stack:
  compose documents into prompt payload

Runtime Extension:
  sendMessage loop and message lifecycle

Provider Extension:
  invoke / stream and provider normalization

Platform Security:
  secrets and credential access

Document Store:
  canonical persisted documents

Trace / Diagnostics:
  explanation and facts
```

### 7.5 把 explainability 作为一等输出

SillyTavern 可以展示 prompts 和 itemized prompts，但 prompt construction 还不是完整、稳定、可解释的 trace model。

Loom 应该要求 composition output 包含：

```text
which documents contributed each segment
which knowledge entries activated
which entries did not activate and why
why a fragment was assigned to a slot
why final ordering is stable
what was trimmed or omitted
```

---

## 8. 候选 ADR 文本

以下文本后续可以复用到 ADR-005 或专门的 Concept Stack spec 中，但目前尚未接受：

```text
SillyTavern 证明了 prompt preset 最适合被理解为 composition skeleton。

Skeleton 定义最终 prompt/message 结构和稳定 slot。
角色资料、用户人格、聊天历史、Knowledge/Worldbook、Memory、Extension Prompts 等运行时上下文来源负责填充这些 slot。

SillyTavern 的主要架构失败点不是 skeleton model 本身，而是缺少这些层之间的清晰边界：
- session state；
- prompt composition；
- world/knowledge activation；
- provider invocation；
- streaming response handling；
- persistence；
- UI mutation；
- extension hooks。

Official Concept Stack 应该保留 skeleton-and-slot 洞察，同时将它拆分为明确的 documents、source adapters、fragments、composition passes、emitter 和 explanation trace。
```

---

## 9. 讨论问题

以下问题仍需要在 Loom Official Concept Stack 设计中继续讨论：

1. canonical internal concept 应该叫 `Preset`、`Prompt Skeleton`，还是 `Composition Skeleton`？
2. `Preset` 是否只保留为 UI / 用户术语，而 backend model 使用 `Skeleton`？
3. Slots 应该是一等 document，还是嵌套在 skeleton document 内？
4. Slot filling 应该发生在 `loom.run` 之前，还是发生在 `loom.run` 内部？
5. Knowledge activation 应该直接产出 fragments，还是产出 activation report，再由 adapter 转成 fragments？
6. M0 应该只输出 messages-like payload，还是同时输出 fragments 和 messages-like payload？
7. M0 应该保留多少 ST-style depth injection？
8. 群聊 actor identity 应该如何映射到 canonical message documents？
