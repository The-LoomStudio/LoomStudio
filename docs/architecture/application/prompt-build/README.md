# PromptBuild Architecture

PromptBuild 是 Studio Application 中负责把领域数据投影为模型输入的编译能力。

当前稳定边界：

```text
AIRP Documents / Runtime Sources
  -> PromptBuild source preparation
  -> Composition data model
  -> Application-owned Passes
  -> Loom Core execution
  -> Compiled Prompt / Provider Messages
```

PromptBuild 拥有 Card、Setting Layer、Narrative Timeline、Skeleton、Slot、Activation 和 Projection 等领域语义。Loom Core 只执行 Fragment pipeline，不理解这些字段。

当前 Agent Turn 的所有提示词来源都在同一次 Core Pipeline 中编译：Preset、全局 Setting Mount、可选 Narrative Timeline Setting、Agent Session History 和当前输入先由 Application Runtime 准备为 Source Fragment，再交给 `@loom/core` 的第一方 `materialize -> order -> emit` Pass。Timeline 与 Session 不保存 `zoneId`；Runtime 通过稳定的 `chat.history`、`session.history` 和 `chat.inside` Zone/Slot 常量建立挂载关系。

Setting Entry 的 `enabled` 是持久化作者配置，Activation 则在每次 PromptBuild 中重新求值；inactive Entry 不进入本轮 Provider Message，但仍可进入解释视图与受控 Agent Context Scope。`read_context` 可以把 Scope 中一个条目作为非持久化 Fresh Context Mount 返回：Runtime 只在下一次 Provider Step 追加该内容，调用后自动卸载，不写入 `global_setting_mounts`、Agent Session 或 Prompt Resource。Settled Mount、TTL、token budget、pin/release 与跨 Step 长期保留尚未实现。

Agent Tool 使用两条构建表面：Provider-managed Tool 与 `messages[]` 平级进入 Provider Payload；Content Tool Description 作为外部 Runtime Source 进入 PromptBuild Zone / Slot。Tool 的正式接缝见 [`../agent/provider-and-prompt-build.md`](../agent/provider-and-prompt-build.md)。

Narrative History 本身不携带 Provider role。它是可被 Preset MessageBlock 挂载的运行时 Context Slot；官方骨架默认将它包在 Developer Block 中，但 Preset 可以把该 Slot 放入任意 MessageBlock，由包裹它的 Block 决定最终的 `system`、`developer`、`user` 或 `assistant` role。

## 为什么外部提示词资源使用 Zone / Slot

PromptBuild 注入的不是已经失去来源信息的字符串，而是提示词数据节点。当前 `PromptContribution` / `PromptFragment` 同时携带正文、稳定 Source 引用、Projection、Activation、Lifecycle、Render Hint 与排序提示；编译结果继续保留 Fragment、Zone 和 Slot 的对应关系，直到 `emit` 阶段才生成 Provider Message 文本。

```text
External Source
  -> PromptContribution(content + sourceRef + capabilities)
  -> PromptFragment(content + projection metadata)
  -> Zone / Slot materialization
  -> Activation / ordering
  -> Provider Message
```

如果外部 Setting、History、Tool Description 或插件内容先被渲染成命名文本变量，再通过 `{{content}}` 嵌入 Preset 正文，节点边界会在进入 Composition 前被压平。Activation、独立排序、生命周期、来源回链、受控检索和 Trace 随后只能依赖另一套隐藏协议重新构造；嵌套变量还会引入递归展开、求值顺序和字符串内部结构编辑问题。

因此 Loom Studio 保持以下职责分离：

- Macro 只在 Source Preparation 中展开当前节点正文里的标量值，不承担外部资源挂载、节点创建或 State 写入；
- Slot 是外部节点的稳定挂载点，允许 Preset MessageBlock 在不复制来源正文的情况下消费动态 Contribution；
- Zone 组织 Slot 的宏观位置、接受范围与 fallback，并为 Projection 排序提供结构边界；
- MessageBlock 决定被挂载节点最终进入哪条 Provider Message 及其 role；
- `prompt.emit` 才把保留结构的 active Fragment 编译为最终文本。

同一变量值中出现的 Macro 标记不构成新的结构化注入。需要动态生成一段完整状态栏或其他复合提示词时，领域 Renderer 应产出新的 Prompt Contribution，而不是让标量 Macro 递归生成节点。

## 正式文档

- [`loom-core/README.md`](loom-core/README.md) — Loom Core 定位、设计原则、非目标与 public surface；
- [`loom-core/execution-model.md`](loom-core/execution-model.md) — Fragment、Pass、Registry、错误和 Owner Tracking；
- [`loom-core/trace-and-replay.md`](loom-core/trace-and-replay.md) — Mutation、Trace v1、Diagnostic、Replay 与 DevTool 边界；
- [`loom-core/studio-integration.md`](loom-core/studio-integration.md) — PromptBuild、Loom Runner、Kernel 与 Provider 集成边界。

Structure / Source / Capability、Skeleton、Activation 和动态投影等仍在演进的设计保留于 [`../../../workbench/discussion/application/prompt/`](../../../workbench/discussion/application/prompt/)。只有已经与实现一致的部分才会逐项晋升。
