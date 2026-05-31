# Agent Model v0

> **状态**：Open Design  
> **主题**：Agent 定义、与 Character / Runtime / Card / Setting Layer 的关系。

---

## 1. 核心判断

Agent 是执行任务的工作主体，不是 Character，不是 Persona，不是 Narrator，不是 Speaker。

```text
Agent:
  在 Studio Application 中执行工作的主体。
  拥有运行策略、工具能力、检索能力和权限约束。

Character / Persona / Narrator:
  作品设定中的角色、身份、叙事视角。
  它们是 Setting Layer 的内容，不是执行主体。
```

混淆 Agent 和 Character 是旧生态最常见的模型错误。

---

## 2. Agent 不是什么

```text
Agent ≠ Character
  Character 是作品内容，Agent 是工作主体。
  一个 Agent 可以扮演某个 Character。
  一个 Character 不一定有对应 Agent。

Agent ≠ Runtime
  Runtime 是推进运行的机制。
  Agent 是被运行的工作主体。
  Runtime 执行 Agent 的 loop / step。

Agent ≠ Provider
  Provider 是外部模型服务。
  Agent 使用 Provider 完成生成任务。

Agent ≠ Tool
  Tool 是 Agent 可调用的能力。
  Agent 决定是否调用 Tool，Tool 不驱动 Agent。

Agent ≠ Chat Speaker
  Chat Speaker 是 provider-facing message 中的角色标记。
  Agent 的工作消息进入 Runtime Transcript，不是直接进入 chat messages。
```

---

## 3. Agent 可以是什么

Agent 可以承担多种工作角色：

```text
写作者:
  生成剧情文本，通过 commit 写入 Narrative Timeline。

旁白 / 导演:
  推进叙事，不直接作为角色发言。

裁判 / 规则执行者:
  校验、判断、应用规则。

检索者:
  搜索 Setting Layer / Memory / Narrative，提供上下文。

状态维护者:
  根据输出更新 Setting Layer 中的状态。

编辑 / 审校:
  修改已有产出，校验格式，补全内容。

子任务执行者:
  被父 Agent 委派执行局部任务。
```

这些不是硬编码分类，而是 Agent 可能承担的工作角色。基础模型不预设这些分类。

---

## 4. Agent 和 Card 的关系

```text
Card:
  顶层内容单元，包含设定、开场、骨架等。

Agent:
  不一定绑定某张 Card。
  可以被 Card / Preset / Session / Runtime 选择或配置。
```

开放问题：

- Agent 是否作为 Card 内的一个配置段；
- Agent 是否作为独立 Document；
- 一个 Session 是否可以有多个 Agent；
- Agent 是否由 Preset / Skeleton 选择；
- Agent 是否可跨 Card 复用。

---

## 5. Agent 和 Runtime 的关系

```text
Runtime:
  推进 Agent 工作过程的运行机制。

Agent:
  定义"做什么"和"可用什么"。
  Runtime 定义"怎么推进"。
```

Agent 不等于 Runtime，但二者紧密协作：

```text
Agent 提供:
  - 可用工具集
  - 运行策略配置
  - 权限边界
  - 输出合约

Runtime 执行:
  - loop / step 推进
  - provider 调用
  - tool 调度
  - commit 决策
  - 丢弃 / 重试
```

---

## 6. Agent 和 Setting Layer 的关系

Agent 可以读取 Setting Layer，但不直接随意修改。

```text
Agent 读取:
  Setting Layer 提供内容投影和查询能力。

Agent 写入:
  通过 State Mutation API 的受控路径。
  写入产生 StatePatchCandidate，经 policy 确认后应用。
```

Memory / Summary 也是一种 Agent 写操作，伴随着截断以前的内容。见 [`../memory-summary-v0.md`](../memory-summary-v0.md)。

---

## 7. Agent 和 Narrative Timeline 的关系

Agent 不直接将 assistant message 写入 Narrative Timeline。

```text
Agent 产出路径:

  Agent work
    -> provider response
    -> runtime 判断是否 commit
    -> commit tool / commit API
    -> Narrative Timeline append / patch
```

Agent 的普通 assistant message 只是 Runtime Transcript 中的工作记录。

---

## 8. Agent 和 Prompt Builder 的关系

Agent 不直接编译 prompt。

```text
Agent 运行中需要上下文:
  -> Runtime 调用 Prompt Builder
  -> Prompt Builder 编译当前 step 需要的上下文投影
  -> 返回 compiled payload
  -> Runtime 提交给 Provider
```

Agent 可以影响 Prompt Builder 的输入选择，但不拥有编译逻辑。

---

## 9. 多 Agent 协作

当前不设计完整 multi-agent framework。

只收束原则：

```text
多个 Agent 可以在同一 Session 中工作。
父 Agent 可以委派子 Agent 执行局部任务。
子 Agent 的失败 run 可以被丢弃，不影响父 Agent。
子 Agent 的产出仍通过 commit 路径提交。
```

开放问题：

- Agent 之间如何通信；
- 子 Agent 的 transcript 是否独立；
- 子 Agent 是否共享工具集和权限；
- 多 Agent 的 commit 冲突如何处理。

---

## 10. 非目标

本文件不定义：

- Agent 的完整 schema；
- Agent 的硬编码角色分类；
- Multi-agent 编排协议；
- Agent 生命周期管理；
- Agent 如何映射到 provider system prompt；
- Agent 与 Kernel 的关系（Kernel 不认识 Agent）。

---

## 11. Discussion Capture: 主 Agent 定位与多方贡献 (2026-05-27)

### 11.1 主 Agent = 写作者 + 编排者

主 Agent 的默认模式是写作。写作不拆成独立子 Agent。

```text
理由:
  1. 写作是最频繁的操作，拆子 Agent = 每回合至少 2 次 LLM 调用
  2. 简单回合（用户输入 → 写剧情）占绝大多数
  3. 主 Agent 已有完整上下文，无需再传递给子 Agent

主 Agent 职责:
  - 写作（默认模式）
  - 更新动态变量（通过 patch_state Tool）
  - 调度子 Agent（需要时）
  - 更新 Setting Layer 稳定设定区（仅在总结阶段）

主 Agent 模式（候选）:
  - write: 默认，生成剧情 + commit_narrative
  - plan: 规划叙事走向
  - chat: 简单对话，不需要子 Agent
```

### 11.2 子 Agent 只在必要时调用

子 Agent 不是常态操作，而是特殊需求时的委派。

```text
子 Agent 候选:
  - Summarizer: 总结阶段的摘要 + Setting Layer 更新（可被插件替换）
  - RuleJudge: 战斗结算、技能校验等规则判定
  - [插件贡献的自定义子 Agent]
```

### 11.3 多方贡献模型

Agent 的提示词由三方协作贡献，权能边界清晰。

```text
预设作者（主要支配者）:
  定义 Agent 的行为骨架:
  - System Prompt 基底
  - Step 声明与执行顺序
  - 可用 Tool 集配置
  - 黑板读写规则
  - Commit 策略

角色卡作者:
  不等于预设作者。
  贡献 Step 的填充内容:
  - 规则文本（战斗公式等）
  - 风格指南（角色口吻等）
  - 绑定预设引用（推荐使用哪个预设）
  角色卡作者不决定 Step 数量、执行顺序、子 Agent 类型。

插件作者:
  贡献工具与规则:
  - 自定义 Tools
  - 自定义子 Agent Step 类型
  - Transform Rules
  - Source Adapters
```

核心区分：预设作者写"骨架"，角色卡作者填"血肉"，插件作者装"外挂"。

---

## 12. 开放问题

1. Agent 是否作为独立 Document Type？
2. Agent 配置应该保存在 Card、Preset、Session 还是独立位置？
3. Agent 的身份（扮演谁）是静态配置还是运行时动态切换？
4. Agent 是否需要记忆自己的历史 run？
5. Agent 是否可以动态获得或失去 Tool 权限？
6. Agent 和 Provider 的关系：Agent 是否知道 provider 的存在？
7. Agent 的最小 M0 需要哪些能力？
8. 预设作者定义的 Step 配置 schema 应该多复杂？
9. 角色卡的 Step 内容贡献如何与预设骨架的版本兼容？
10. 多个插件同时向同一个 Step 注入内容时的合并顺序？

---

## 13. Discussion Capture: 默认 AIRP Agent 投影策略与平台边界 (2026-05-30)

### 13.1 核心收束

默认 AIRP 运行形态可以采用"每轮临时 Agent 工作区"：

```text
用户在主剧情窗口输入
  -> 开启一个新的 Agent Run
  -> Agent 在当前 Run 内读工具、调度子 Agent、生成候选、提交正文
  -> Run 结束后归档完整工作对话
  -> 下一轮 Prompt 默认不投影完整历史 Agent Transcript
  -> 连续性由 Narrative / Setting / Dynamic Mount / Run Memo 承担
```

但这只是 **默认 AIRP Runtime 的 Prompt Projection Policy**，不是 Agent 基座的强制运行方式。

```text
Agent foundation:
  保存完整 Run Transcript、ToolCall / ToolResult、Trace、Changeset。

Default AIRP Runtime:
  默认不把历史 Agent Transcript 投影进下一轮 prompt。

Prompt Projection Policy:
  决定当前 runtime profile 是否投影历史工作对话、投影多少、如何裁剪。
```

### 13.2 不污染平台性

不能为了默认 AIRP 体验，在 Agent 基座中开后门或写死短生命周期模式。

```text
允许:
  Default AIRP runtime 使用 ephemeral transcript projection。
  Preset / Runtime Profile 选择 persistent / hybrid projection。
  Extension 声明自己需要 currentRun / recentRuns / fullSession transcript access。

不允许:
  Agent 基座假定所有 Agent 都是一次性工作区。
  Tool / Prompt Builder 假定历史 Agent 对话一定不存在。
  Extension 绕过 Permission 读取完整 transcript。
```

### 13.3 Agent 工作历史的定位变化

默认 AIRP 体验中：

```text
Agent Transcript:
  Runtime execution log。
  用于 trace、debug、replay、review。
  不默认作为下一轮 prompt 的历史上下文。

Run Memo / Director Memo:
  当前 Run 结束时写出的轻量交接。
  可包含未完成计划、伏笔、已读资料 sourceRefs、下一轮建议。
  作为 Prompt Builder 的显式 source，而不是把完整工作 chat 滚入上下文。
```

### 13.4 运行入口区分

用户交互需要区分两类入口：

```text
主剧情窗口输入:
  开启新的 Agent Run。
  用于推进剧情或生成正文。

Agent 工作侧栏输入:
  继续当前 Run / 修改当前候选 / 要求重写。
  不视为新的剧情轮次。
```

这保证默认运行可以保持短生命周期，同时用户仍能在当前工作区内连续指导 Agent。
