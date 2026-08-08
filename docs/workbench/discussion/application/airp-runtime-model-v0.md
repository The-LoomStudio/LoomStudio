# AIRP Runtime Model v0

> **状态**：Open Design / Runtime Profile
> **主题**：AIRP 如何使用通用 Agent 基座推进剧情，而不把小说工作流写死到平台。
> **相关**：[`agent/agent-model-v0.md`](agent/agent-model-v0.md)、[`agent/agent-runtime-loop-v0.md`](agent/agent-runtime-loop-v0.md)、[`session-timeline-data-model-v0.md`](session-timeline-data-model-v0.md)、[`runtime-turn-flow-v0.md`](runtime-turn-flow-v0.md)

---

## 1. 定位

AIRP Runtime 是建立在通用 Agent Runtime 上的一种第一方 Runtime Profile。

它可以为互动叙事提供默认体验，但不定义 Agent 平台的唯一工作方式。

```text
Generic Agent foundation:
  Agent Preset / Agent Session Tree / Run / Step / Tool / Changeset

Default AIRP Profile:
  Narrative binding / story context projection / narrative commit policy
```

---

## 2. 两个体验中心

```text
Narrative Timeline:
  一次游玩体验的中心。
  保存剧情世界线和已接受正文。

Agent Session:
  一次编辑体验的中心。
  保存用户与 Agent 的工作树、Run 和 Step。
```

AIRP Agent Session 通常绑定一条 Narrative Timeline，但两棵树不镜像、不共根，也不自动同步回退。

Narrative Timeline 不是 Chat。Agent Session 也不是 Provider `messages[]` 的永久副本。

---

## 3. Agent 工作与剧情正文分离

Agent Session Tree 可以包含：

- 用户指导；
- Provider 输出；
- ToolCall / ToolResult；
- 设定检索；
- 草稿和候选；
- 等待、错误和重试；
- Changeset 引用。

Narrative Timeline 只保存受控提交的剧情正文。

```text
Agent Step
  -> candidate narrative
  -> validate target head and permission
  -> append Narrative Node
  -> write Changeset
  -> append mutation result Step
```

用户输入首先进入 Agent Session，不默认作为与正文平级的 Narrative 节点。短对话也可以通过提交写成很短的 Narrative Node。

---

## 4. AIRP Agent Preset

AIRP 不是一个固定 Agent。Preset 作者可以提供不同工作方式：

- 直接角色扮演并提交短对白；
- 先询问玩家行动，再整理成长正文；
- 先检索设定、生成草稿、请求审查，再提交；
- 与玩家持续协作编辑多个段落；
- 自动推进剧情并按策略更新变量和图像资产。

这些流程由 Agent Preset、Step.kind 和 Runtime Policy 表达。平台不硬编码“每轮必须先检索、再审查、再写正文”。

---

## 5. Context Projection

AIRP 的上下文主要来自剧情和预制设定，而不是无限累积的 Agent 工作历史。

候选输入：

```text
Agent Preset
current Agent Session path
current Run state
bound Narrative branch projection
active Setting / State entries
dynamic Context Sources
selected recent Changesets
explicit memory / summary
```

角色卡作者预制的世界书可见性必须由 Activation / Context Projection 执行。未激活或禁止主动搜索的条目不能因为 Agent 工作记忆、检索邻接或完整 Workspace 扫描而泄漏。

---

## 6. Transcript Projection Policy

默认 AIRP Preset 可以选择 ephemeral 策略：归档 Agent Session 历史，但下一次 Provider 调用只投影当前路径中必要的 Step、Narrative、Setting、State、Changeset 和显式 Memo。

这只是可选 Profile：

```text
ephemeral:
  历史工作记录存在，但默认少量投影。

persistent:
  持续投影较长的 Agent Session 路径。

hybrid:
  当前编辑任务保留完整路径，阶段结束后摘要或裁剪。
```

不采用“一楼一压缩”作为平台规则。Preset 可以让一个 Run 跨越多次用户交互和多次 Narrative 提交。

---

## 7. Changeset 与 AIRP 演进

AIRP 中实际改变剧情、变量、设定或资产的操作形成 Changeset。

Changeset 既服务 undo / redo，也可以作为 Agent 的结构化历史来源：

```text
Narrative changed
State variables changed
Prompt / Setting asset changed
Image or artifact reference changed
  -> Changeset diff
```

当旧 Transcript 被压缩或某次剧情回退后，Agent 可以读取当前 head、相关版本和选定 Changeset，理解世界状态怎样演进。

每个 ToolCall 不需要 checkpoint。只有成功持久化的修改才产生 Changeset。Narrative 正文提交是创建剧情 checkpoint 的自然候选时机。

---

## 8. Narrative 回退

Narrative 回退只改变剧情世界线及其关联状态，不回退 Agent Session Tree。

```text
restore Narrative head / checkpoint
  -> restore associated story state versions
  -> record observable change fact
  -> keep Agent Session head unchanged
  -> rebuild Context Projection before next Agent step
```

旧 Agent 对话可以保留。Runtime 通过新的目标版本和 Changeset 让 Agent 知道回退已经发生，而不是把 Agent 会话伪装成从未经历过旧路径。

---

## 9. Tool 与 Mutation

ToolCall / ToolResult 是 Agent Step 的工作事实。

只读 Tool：

- 搜索设定；
- 读取 Narrative；
- 查询变量；
- 获取外部资料。

Mutation Tool：

- 提交 Narrative；
- 更新 State；
- 修改 Setting / Prompt Asset；
- 写入图像或其他 Artifact 引用。

Mutation 必须经过目标领域校验、权限和版本检查。成功后产生 Changeset；失败时返回可修正的错误，不伪装成功。

---

## 10. 与 Prompt Builder、Provider 和 Kernel 的边界

```text
AIRP Runtime:
  推进 Agent Run / Step，选择 Context Projection，调用 Tool 和领域 Mutation。

Prompt Builder:
  编译 Runtime 已选择并获准的 sources。

Provider Adapter:
  映射 compiled payload，调用模型，返回 provider result。

Kernel:
  提供 Document / RPC / Event / Trace 等通用能力，不理解 AIRP 语义。
```

Prompt Builder 不推进 Agent 状态机，Provider Adapter 不决定 Narrative commit，Kernel 不拥有 Agent Session 或 Narrative Timeline。

---

## 11. 当前 M0 差异

当前 M0 `submitTurn` 仍近似单次生成流程，并在一次事务中写入 user / assistant Narrative entries、镜像 Transcript、Run 和 State Snapshot。

当前 `AgentRuntimeProfile` 也更接近本地 Preset / Model Binding 占位，而不是正式可分发 Agent Preset。

这些属于已实现过渡态。本文不授权在没有迁移计划时直接替换 Document Types 或存量数据。

---

## 12. 非目标

本文不定义：

- 最终 Agent / Narrative / Changeset Schema；
- 固定 ReAct、Plan-and-Execute 或小说审查流程；
- 章节、场景等 Narrative 嵌套；
- 强制一轮一压缩；
- Agent Session 与 Narrative Timeline 的镜像分支；
- Extension 的完整 manifest schema；
- UI 的中央栏与侧栏布局。

---

## 13. 开放问题

1. Default AIRP Agent Preset 最小需要哪些 mode 和 tools？
2. Narrative checkpoint 需要关联哪些 State / Asset 版本？
3. 玩家输入 provenance 应如何连接到最终 Narrative Node？
4. AIRP Agent Session 切换 Narrative Timeline 时如何处理 active Run？
5. Agent 查看 Changeset diff 时如何服从世界书和敏感内容可见性？
6. 主动存档是命名 Narrative head，还是物化额外快照？
7. 多个 Agent Session 同时编辑一条 Timeline 时如何处理版本冲突？
