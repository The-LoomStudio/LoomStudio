# Agent Model v0

> **状态**：Open Design
> **主题**：Agent、Agent Preset、Agent Session、Agent Run 与 Narrative Timeline 的候选边界。
> **事实边界**：本文描述目标方向，不代表当前 M0 Schema 已经实现。

---

## 1. 核心判断

Agent 是能够在一次有边界的运行中，多次接收用户指导、调用工具、观察结果并继续工作的执行主体。

```text
Agent ≠ Character
Agent ≠ Provider
Agent ≠ Runtime
Agent ≠ Narrative
Agent ≠ 单次模型调用
```

Character、Persona、Narrator 和 Speaker 属于作品设定或表现形式。Agent 可以扮演它们，但它们不是 Agent 本身。

平台基座不预设 Agent 一定用于写小说。短对话、长文写作、互动扮演、检索、审校、图像工作流和 Extension 专用助手都应建立在同一组运行原语上。

---

## 2. 中心对象

### 2.1 Agent Preset

`Agent Preset` 是作者可创作、保存和分发的 Agent 定义单元。

它描述：

- 助手的工作方式和人格；
- 可用模式及其提示内容；
- 可调用的 Tool / Capability；
- Context Projection 规则；
- 输出合约和提交策略；
- Run 的继续、挂起、结束和丢弃策略；
- 所依赖的 Extension contribution。

它不应保存本机环境绑定：

- 本地 `modelProfileId`；
- API Key；
- 当前用户授予的权限；
- 本地安装路径；
- 某条 Narrative Timeline 的实例引用。

候选分发文件名：

```text
*.agent.json
```

这只是开放设计中的文件约定，尚未成为已实现 Manifest Schema。

### 2.2 Agent Session

`Agent Session` 是某个 Agent Preset 的持续运行实例和工作关系。

候选职责：

- 关联选中的 Agent Preset；
- 使用本地 Model / Provider / Permission Binding；
- 保存 Agent 工作过程的树和当前 head；
- 保存多个 Agent Run、Step 与分支的归属关系；
- 决定历史 Transcript 的保留和投影范围；
- 可选地绑定某条 Narrative Timeline 或其他工作目标。

Agent Session 与 Narrative Timeline 不应结构性嵌套。绑定应是可替换的引用，因此同一个 Agent Session 可以在策略允许时解绑或切换目标。

Agent Session 自己可以是一棵工作树。用户回到先前的指导、重新尝试某个工具路径或从旧 Step 继续时，可以创建新的 Agent Session 分支。它表达的是“如何编辑和工作”，不是剧情世界线。

`Agent Session` 是否是最终正式名称、是否必须长期持久化，仍是开放问题。

### 2.3 Agent Run

`Agent Run` 是 Agent Session 中一次有边界的执行。

一次 Run 可以包含：

- 多次用户输入；
- 多次 Provider 调用；
- ToolCall / ToolResult；
- 等待用户确认；
- 读取设定或外部资源；
- 生成和修改候选结果；
- 提交、结束、失败、中止或丢弃。

Run 不是“一次用户输入”或“一次模型调用”的同义词。由谁开始 Run、何时结束 Run，属于 Preset / Runtime Policy 和产品交互共同决定的行为。

### 2.4 Step 与 Agent Session Tree

`Step` 是 Agent 工作推进和状态保存的节点。它可以表示 Provider 输出、ToolCall、ToolResult、等待用户、提交结果或其他 Runtime 能识别的动作。

候选关系：

```text
Agent Session
  -> Session Branch
  -> Step parent/head relation
  -> one or more Agent Runs
```

`Step.kind` 可以作为持久化类型判别和 Runtime 状态机的驱动信息。平台可以定义少量 well-known kinds，Extension 也可以在受控命名空间下贡献类型。

需要避免的不是 `Step.kind` 本身，而是把一套特定写作流程的全部阶段硬编码成平台唯一状态机。Step 的确切字段、Message 与 Step 是一对一还是引用关系，仍是开放问题。

### 2.5 Run Transcript

Run Transcript 保存 Agent Run 的工作记录，例如：

- user guidance；
- assistant working message；
- ToolCall / ToolResult；
- suspend / resume；
- candidate 和 commit result；
- error、retry 和 discard reason；
- Trace / Audit 引用。

Transcript 是工作记录，不是剧情正文，也不是 Provider `messages[]` 的原样持久化副本。

一个 Run 内通常沿 Agent Session Tree 的一条路径推进。Agent Session 可以分支，但平台基座不要求它与 Narrative Timeline 镜像、共根或同步切换 head。

---

## 3. 与 Narrative Timeline 的关系

Narrative Timeline 是剧情世界线的权威树。Agent 是读取、讨论和受控修改作品的执行主体。

```text
User
  -> Agent Session
  -> Agent Run
  -> Run Transcript / Tool Calls / Candidate
  -> controlled commit
  -> Narrative Timeline
```

基本规则：

1. 用户输入首先属于 Agent 交互，不默认成为 Narrative 节点。
2. Provider 的普通 assistant response 不自动写入 Narrative。
3. 只有受控提交的作品文本才进入 Narrative Timeline。
4. Narrative 节点可以很短；文本长度不决定它是否属于 Narrative。
5. 不产出剧情的 Agent 可以完全不绑定 Narrative Timeline。
6. Narrative 分支不要求 Agent Session 同步回退或切换到对应分支。
7. Agent Session 分支也不自动创建 Narrative 分支。

Agent 在 Narrative 回退后继续工作时，应重新观察当前权威状态。是否向它注入“发生了回退”的系统事实、是否开启新 Run，由 Runtime Policy 决定，而不是通过回退整段 Agent 会话来维持一致性。

因此，两棵树的中心不同：

```text
一次游玩体验:
  以 Narrative Timeline 为中心。

一次编辑体验:
  以 Agent Session 为中心。

Agent Session:
  通过显式 binding 连接 Narrative Timeline。
```

---

## 4. Changeset 与演进历史

`Changeset` 是一次已应用改变的结构化差异记录。它不是只服务 Narrative，也不等于 Agent Session Step。

它可以描述：

- Narrative 节点的新增、替换或删除；
- State / Variable 更新；
- Setting、Prompt Asset 或其他 Document 修改；
- Extension 所有数据的受控变化。

候选关系：

```text
Agent Step / User Action
  -> one or more mutation requests
  -> applied Changeset
  -> affected documents and before/after versions
```

Changeset 的价值包括：

- 为通用 Ctrl+Z / redo 提供操作单位；
- 展示类似 diff 的资产和剧情演进；
- 让 Agent 在压缩或上下文缺失后观察近期发生了什么；
- 把一次工作过程与其真实副作用关联起来；
- 为分支、审计和错误恢复提供证据。

一个 Agent Run 可以产生零个、一个或多个 Changeset。一个 Changeset 也可以由用户直接编辑产生，不要求一定来自 Agent。

需要单独确认的是原子性：Changeset 可以统一描述跨领域改变，但只有底层事务实际覆盖的部分才能承诺原子提交和原子回滚。没有事务保证时，不能因为它们共享 Changeset ID 就宣称不会部分失败。

---

## 5. Context Projection

Agent 的上下文不是 Transcript 的简单累加。

Runtime 在每次 Provider 调用前，根据当前 Agent Preset、Agent Session、Run 状态和目标对象构造受控投影：

```text
Agent Preset
Local Binding
Current Run Transcript
Selected Narrative projection
Allowed Setting / State sources
Active dynamic context
Explicit memory or summary
  -> Prompt Builder
  -> Compiled Provider Payload
```

Context Projection 必须执行可见性和权限规则。未激活的世界书条目、受限设定和不可搜索资源不能因为 Agent 曾经读取过相邻内容而泄漏进后续上下文。

历史 Transcript 可以采用不同策略：

- `persistent`：持续投影历史工作对话；
- `ephemeral`：归档历史，但下一次 Run 默认不投影；
- `hybrid`：当前任务保留完整记录，任务结束后摘要或裁剪。

这些是可选策略，不是 Agent 基座的固定模式。

---

## 6. 本地 Binding

可分发的 Agent Preset 与本地运行环境必须分离。

```text
Portable Agent Preset:
  behavior / prompt / mode / tools / context policy / output policy

Local Binding:
  provider / model / permission grants / local overrides
```

当前 M0 的 `AgentRuntimeProfile` 更接近本地 Binding 占位。它不应直接被解释为最终的可分发 Agent Preset。

本地 Binding 的最终名称和持久化归属尚未确定。

---

## 7. 作者和 Extension 的职责

### Agent Preset 作者

作者主要编写：

- Agent 的身份与工作目标；
- 模式及其提示内容；
- Tool 选择；
- Context Projection 规则；
- 输出和提交规则；
- Run 的停止、等待和失败处理。

作者不需要编写 Runtime 引擎，也不应直接操作 Provider transport。

### Card / 内容作者

内容作者提供角色、设定、开场、世界书和可变状态，并可以推荐某个 Agent Preset。内容包不应复制 Agent Runtime 的执行定义。

### Extension 作者

Extension 可以贡献：

- Agent Preset；
- Tool / Capability；
- Context Source；
- Runtime Driver 或策略扩展点。

Preset 对 Extension 的依赖只声明引用。依赖缺失时保持 unresolved，不自动安装、不自动激活、更不能自动授予权限。

---

## 8. 多 Agent

平台不预设“主 Agent / 子 Agent”的固定等级。

一个 Agent Preset 可以通过受控能力调用另一个 Agent Preset，但二者仍是平等的可运行定义。调用方是否等待结果、共享哪些上下文、是否允许递归以及如何提交结果，应由编排策略和权限边界决定。

当前不定义完整 multi-agent 协议。

---

## 9. 非目标

本文不定义：

- 最终数据库字段；
- Narrative 节点的章节或场景层级；
- 固定的小说生成流程；
- 强制的一轮一压缩；
- Agent Session Tree 与 Narrative Timeline 的强制镜像；
- 每个 ToolCall 都自动产生持久化 Changeset；
- Provider 专用 `messages[]` 格式；
- Multi-agent 通信协议。

---

## 10. 开放问题

1. 当前“剧情游玩实例”的 `Session` 是否应改名为 `NarrativeTimeline` 或其他领域对象？
2. `Agent Session` 是否是合适名称，还是应使用避免与旧 Session 冲突的名称？
3. Agent Session 是否必须持久化，还是可以由多个 Run 和 Binding 动态重建？
4. Agent Session Tree 的节点究竟是 Step、Message，还是二者分离？
5. Run Transcript 的最小持久化粒度是什么？
6. Agent Session 切换 Narrative Timeline 时，哪些 Run 状态可以继续保留？
7. Narrative 回退后，Runtime 应向 Agent 注入怎样的状态变化事实？
8. Changeset 的 undo/redo、分支和跨领域事务边界如何定义？
9. `*.agent.json` 的正式 Schema、版本与命名空间规则是什么？
10. Runtime Driver 需要开放到什么程度，才能支持 Extension 而不暴露底层存储能力？
