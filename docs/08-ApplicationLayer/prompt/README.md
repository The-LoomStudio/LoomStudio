# Prompt Builder 领域文档

> **状态**：Open Design / Discussion Capture
> **目的**：集中记录 Studio Application 中与 prompt build、预设骨架、slot 填充、Setting Layer 投影和 Loom Core 对接有关的设计讨论。

---

## 1. 定位

Prompt Builder 是 Studio Application 的领域能力，不属于 Kernel，也不属于 `@loom/core`。

当前边界：

```text
Studio Application Prompt Builder:
  AIRP documents / runtime sources
  -> source adapters
  -> composition fragments
  -> Loom Core pipeline
  -> filled skeleton / compiled prompt payload

Provider Adapter:
  compiled prompt payload
  -> provider-specific request body

Loom Core:
  Fragment[] + Pass[] -> Fragment[] + Trace
```

因此：

- `@loom/core` 不变成提示词编译器；
- Studio Application Prompt Builder 才是 AIRP prompt composition 的正式承载层；
- Provider Adapter 不编译 Card、Setting Layer、Opening 或 Chat documents；
- Provider Adapter 只消费 Prompt Builder 输出的 compiled payload，并进行 provider-specific 映射。

---

## 2. 本目录收纳什么

本目录收纳：

- Loom Core 对接边界；
- Prompt Builder pipeline；
- Composition Skeleton / Preset；
- slot / marker / order / fill policy；
- Setting Layer 如何作为 prompt-facing source；
- Content / Setting Layer 组件化、binding、宏与变量注入；
- compiled prompt payload 与 provider adapter 的边界；
- OpenAI-style skeleton、provider-neutral skeleton、provider-specific skeleton 的兼容性讨论。

本目录不收纳：

- Chat / Session canonical model；
- Card packaging / 展示 metadata；
- Provider API 调用、streaming、secret；
- Kernel RPC registry / Document Store 机制；
- 完整前端 UI 设计。

---

## 3. Chat / Session 的位置

Chat / Session 是 Studio Application 的核心用户层数据模型，但暂不归入 Prompt Builder 文档区。

原因：

```text
Chat / Session 是 prompt builder 的重要输入来源，
但不是 prompt builder 自身的模型。
```

Prompt Builder 可以消费：

- 当前 Session；
- Chat timeline / history；
- hidden prompt-only entries；
- runtime input；
- state patch 结果。

但 Chat / Session 仍应在 Application Layer 的独立文档中定义，避免把用户层交互模型压扁成 provider-facing `messages[]` 或 prompt builder 内部结构。

---

## 4. 当前已收束方向

### 4.1 保留 SillyTavern 的 skeleton-and-slot 洞察

SillyTavern 的重要经验是：

```text
Preset / Prompt Manager 本质上是 composition skeleton。
World Info、Chat History、Character、Persona、Author's Note、Extension Prompts
都是在往这个骨架里的 slot 填内容。
```

Loom Studio 应吸收这个思路。

但需要避免把 ST 的历史包袱带进 canonical model：

- 不把 OpenAI-style `messages[]` 当成唯一通用 IR；
- 不把 Character description / Personality / Scenario 变成 Prompt Builder 特殊字段；
- 不让 Worldbook / Knowledge 自己拥有最终输出结构；
- 不让 Provider Adapter 理解 Card / Setting / Opening / Chat 等上层领域。

### 4.2 Preset 是用户术语，Composition Skeleton 是 backend 术语候选

当前建议：

```text
Preset:
  面向用户 / UI / 社区心智的术语。

Composition Skeleton:
  backend canonical 候选术语。
```

Skeleton 负责声明：

- 稳定 slot；
- slot 顺序；
- 填充策略；
- 合并 / 替换 / 分离策略；
- role-like 或 provider capability hint；
- 输出形状；
- 兼容性诊断规则。

### 4.3 slot 是结构位置，不急着变成内容分类法

不要过早把 slot 压成固定 channel，例如：

```text
instruction / context / history / user-input / assistant-prefill
```

这些分类可能有用，但现在不应成为基础模型。

更稳的方向是：

```text
slot 先表达骨架位置和填充规则；
内容语义、provider role 和最终 payload 由后续 composition / adapter 阶段解释。
```

### 4.4 Setting Layer 是 prompt-facing source，不是 loose notes

Card metadata / readme 不进入 prompt builder 的特殊通道。

Prompt-facing 内容应来自：

- Setting Layer；
- Opening；
- Chat / Session source；
- Runtime input；
- Extension contribution；
- Global scope / memory 等明确 source。

Setting Layer 与 Prompt Builder 的关系应是：

```text
Setting Layer:
  组织设定、状态、可投影内容。

Prompt Builder:
  根据 Skeleton 和场景，把被选中的 setting 内容投影进 slots。
```

### 4.5 内容层组件化与 Prompt 组件化需要分层

当前有两个相似但不同的方向：

```text
Content / Setting Layer Component Model:
  组织内容本体，例如角色、记忆、状态、关系、事件和插件贡献内容。

Prompt Composition Component Model:
  编译提示词，例如 slot、ordering、activation、render、budget 和 provider compatibility。
```

它们可以都采用 ECS-like 思想，但不应合并成同一套 component vocabulary。

Setting Layer 的组件化仍是开放议题。当前只收束一点：

```text
结构化 entry / component 应是 canonical data；
宏更适合作为 binding 引用语法，而不是 canonical source。
```

### 4.6 默认 AIRP Prompt Projection 不等于 Agent 基座

Prompt Builder 消费 Runtime 提供的投影，而不是直接读取所有 Agent 工作历史。

默认 AIRP Runtime 可以选择：

```text
Run Transcript:
  完整归档、可 trace、可 debug。

Prompt Projection:
  默认不投影完整历史 Agent 工作对话。
  只投影当前 Run、Run Memo、Narrative projection、Setting projection、Dynamic Context Mount。
```

这是默认 AIRP 体验的 projection policy，不是 Prompt Builder 或 Agent 基座的硬编码假设。

### 4.7 Dynamic Context Mount 与 Fresh Read Tail

Prompt Builder 需要支持由 Runtime 提供的动态上下文挂载。

候选布局：

```text
stable prefix:
  - preset system
  - blue-light / stable Setting projection
  - narrative projection / summary / checkpoint

settled dynamic mount:
  - passive activation items
  - active read items that have settled
  - run memo / director memo
  - ordered by authored slot / priority / folder order

current tail:
  - current user input
  - current Run transcript projection
  - fresh read tail
```

其中：

```text
Fresh Read Tail:
  本轮刚通过 read tool 得到的结果。
  只特权靠近尾部一次，用 marker 明确标注。

Settled Dynamic Mount:
  fresh read 被消费一轮后进入这里。
  回到作者设定的排序体系。
```

Prompt Builder 不决定 read item 的生命周期。Runtime Policy 决定 TTL、pin、budget、stale 和卸载；Prompt Builder 只按投影输入和 Skeleton 规则编译。

### 4.8 Zone Tree 与 Injection Group

Preset / Composition Skeleton 不应只是一维 slot 列表。

当前新增方向：

```text
Preset Zone Tree:
  Prompt Builder 输出时使用的挂载拓扑。

Source Tree:
  Preset / Setting / Worldbook / Plugin 自己的存储和分类树。

Injection Group:
  Source item 声明的投影锚点标签。
  它不是文件夹，也不是存储位置。
```

这使得世界书、角色卡、插件、Run Memo、activeRead 等内容可以在不改变自身存储结构的前提下，声明式注入到 Skeleton 的不同位置。

详见 [`composition-skeleton-and-preset-v0.md`](composition-skeleton-and-preset-v0.md)。

### 4.9 资源视图与 Prompt 视图

UI 上应区分：

```text
资源视图:
  管内容存在哪里。
  例如 Setting / Worldbook / Preset snippet 的目录树。

Prompt 视图:
  管内容最终投影到哪里、按什么顺序出现。
  例如 Stable Prefix / Lower Context / Current Turn。
```

资源树里的拖拽顺序只在同一 source-scoped slot、同一 injection group 内作为排序托底。最终 prompt 顺序以 Projection Preview / Prompt 视图为准。

动态加入的 slots 不写死在全局 preset 中。全局 preset 只提供 zone / injection group / fallback；当前角色卡、世界书、插件、activeRead source set 会在 Prompt Build 时 materialize 出 source-scoped slots。UI 拖拽写入的是 Projection Order Profile 中的稳定 `rankKey`，可以按 global / project / character / session 作用域覆盖排序，而不是污染 preset 本体。

---

## 5. 文件列表

- [`loom-core-integration-v0.md`](loom-core-integration-v0.md)
- [`composition-skeleton-and-preset-v0.md`](composition-skeleton-and-preset-v0.md)
- [`setting-layer-prompt-source-v0.md`](setting-layer-prompt-source-v0.md)
- [`content-component-and-binding-v0.md`](content-component-and-binding-v0.md)

---

## 6. 相关文档

- [`../composition-skeleton-v0.md`](../composition-skeleton-v0.md)
- [`../composition-pipeline-v0.md`](../composition-pipeline-v0.md)
- [`../setting-layer-v0.md`](../setting-layer-v0.md)
- [`../chat-opening-model-v0.md`](../chat-opening-model-v0.md)
- [`../../reference/sillytavern-architecture-reference.md`](../../reference/sillytavern-architecture-reference.md)
