# 设计哲学：场景驱动设计 (Scenario-Driven Design)

Loom Studio 不是一个普通的"套皮 API 客户端"或简单的表单系统。它是一个面向复杂上下文组装、插件扩展、多模型适配以及智能体调度的开发平台。

如果我们在新需求到来时，只从数据结构出发（Schema-First），很容易得出看似完整但无法使用的模型。例如：
- 过早地将所有的上下文组装写死成了 OpenAI 风格的 `messages[]`。
- 让简单的 API 适配器（Provider Adapter）被迫去理解复杂的角色卡、记忆树概念。
- 让只想贡献一个简单能力的插件作者，被迫理解极其复杂的底层 Prompt 组装逻辑。

因此，Loom Studio 采用 **场景驱动设计 (Scenario-Driven Design)** 作为最高指导哲学。

## 1. 在定义 Schema 前必经的场景拷问

如果你要在 Application Runtime (AIRP) 或任意核心层引入一个新的领域模型，你必须先在讨论区写一个场景用例，并通过以下模板进行拷问：

```text
Actor: 这个场景里是谁在使用 Studio？（例如：简单卡作者、复杂世界观作者、文生图插件作者、API 适配器开发者）
Goal: 他想完成什么？
Input: 他手上已有的数据、文件或配置是什么？
Expected Flow: 他理想中怎么完成？
Studio Friction: 如果按我们现有的或新草拟的设计，Studio 给他们制造了哪些阻碍或认知负担？
Required Concepts: 这个场景究竟需要哪些最小概念？
Unnecessary Concepts: 这个场景暂时不应该要求用户理解什么？
```

## 2. 场景驱动带来的架构收益

正是因为我们坚持了场景推演，Loom Studio 才能保持现在如此清晰的架构隔离：

### (1) 为什么我们有 `Composition Skeleton` 而不仅仅是 `messages[]`？
因为"预设作者"和"复杂世界构建者"需要一个独立于 Provider 格式的装配骨架。如果只用 `messages[]`，Anthropic、Gemini 或开源模型的差异就会直接侵入预设，导致大量兼容性灾难。

### (2) 为什么我们有开放的 `AICapabilityId` 而不是固定的类型枚举？
因为考虑到"文生图插件作者"或"自定义语音插件作者"的场景，平台无法提前写死所有的能力类型（`chat.completion`, `image.generation` 等）。平台应该只提供注册、查询、UI 渲染配置面板的功能，而具体的参数解析和调用交给插件适配器。

### (3) 为什么 Provider Adapter 完全不认识 Card 和 Session？
因为 Adapter 作者的唯一目标是把最终编译好的 Payload 转换成具体外部 API 的 Request Body。如果让 Adapter 认识 Card，我们就把系统耦合度无限放大了。

---
> **总结**：不要凭空想象一个功能该有什么字段。去想象一个真实的人在真实的环境下，如何最顺畅地达成目标。如果你的设计让一个只想完成简单任务的人被迫理解复杂的概念，那就是一个失败的过度设计。
