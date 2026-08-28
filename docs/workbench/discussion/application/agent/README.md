# Agent 领域文档

> **状态**：Open Design / Discussion Capture  
> **目的**：集中记录 Agent Preset、Agent Session Tree、Run、Step、工具、权限和 Context Projection。

---

## 1. 当前中心模型

```text
Agent Preset:
  作者可创作和分发的 Agent 定义。

Agent Session:
  一次编辑体验的中心，保存独立的工作树。

Agent Run:
  Agent Session 中一次有边界的执行。

Agent Step:
  工作树中的状态推进节点，可由 kind 驱动恢复和控制。

Narrative Timeline:
  一次游玩体验的中心，保存独立的剧情世界线。

Changeset:
  Agent 或用户实际写入 Narrative、变量、资产后的 diff 历史。
```

Agent Session 可以绑定 Narrative Timeline，但不拥有它。两棵树不共根、不镜像，也不自动同步回退。

---

## 2. 核心原则

1. Agent 是工作主体，不是 Character、Provider 或单次模型调用。
2. Agent Preset 是作者可分发单位；本地模型、密钥和权限属于 Local Binding。
3. Agent Session 保存编辑工作树；Narrative Timeline 保存剧情世界线。
4. 用户输入首先进入 Agent Session Step，不默认成为 Narrative 节点。
5. Agent 通过受控 Mutation 写入 Narrative、State、Setting 或其他资产。
6. 成功持久化修改形成 Changeset，并关联来源 Step / Run / User Action。
7. `Step.kind` 可以驱动 Runtime 状态机，但平台不硬编码某一种写作工作流。
8. ToolCall / ToolResult 是 Agent 工作记录的一等事实。
9. Context Projection 决定 Agent 当前能看到什么，不能把 binding 等同于无限读取权限。
10. Narrative 回退不回退 Agent Session；Agent 通过当前 head、版本和 Changeset 重新理解状态。

---

## 3. 作者工作面

Agent Preset 作者主要定义：

- Agent 人格和工作方式；
- mode / workflow prompt；
- Tool / Capability；
- Context Projection policy；
- Run、Step、等待和结束策略；
- Mutation / commit policy；
- Extension 依赖。

Card / 内容作者主要提供角色、设定、Opening 和世界书，可以推荐 Preset，但不复制 Runtime 引擎定义。

Extension 作者可以贡献 Agent Preset、Tool、Context Source 和 Runtime Driver。缺失依赖保持 unresolved，不自动安装、激活或授权。

---

## 4. 与其他领域的关系

```text
Agent Preset -> Runtime Policy:      工作方式
Agent Session -> Agent Run / Step:   编辑历史和状态
Agent Session -> Target Binding:     当前工作目标
Agent -> Tool / Capability:          读取和操作能力
Agent -> Prompt Builder:             编译受控 Context Projection
Agent -> Changeset:                  观察和关联真实修改
Agent -> Narrative Timeline:         通过受控 Mutation 写入
Agent -> Trace / Audit:               运行证据
```

Kernel 不认识这些领域语义。Provider Adapter 只消费编译后的 payload。

---

## 5. 文件列表

| 文件 | 状态 | 主题 |
|---|---|---|
| [`agent-model-v0.md`](agent-model-v0.md) | Open Design | Agent Preset、Session、Run、Step、Changeset 与 Narrative Binding |
| [`agent-runtime-loop-v0.md`](agent-runtime-loop-v0.md) | Open Design | Agent Session Tree、Step.kind、Run 生命周期、Mutation 与 Changeset |
| [`runtime-policy-v0.md`](runtime-policy-v0.md) | Open Design | loop、retry、stop、discard、commit policy |
| [`tool-capability-v0.md`](tool-capability-v0.md) | Open Design | Tool、ToolCall / ToolResult、受控 Mutation |
| [`multi-agent-orchestration-v0.md`](multi-agent-orchestration-v0.md) | Open Design | Agent Preset 之间的调用与编排 |
| [`retrieval-search-v0.md`](retrieval-search-v0.md) | Open Design | Agent 主动搜索与 Context Source |
| [`tool-data-view-interaction-v0.md`](tool-data-view-interaction-v0.md) | Open Design | Agent Tool 面向模型的数据视图、检索、读取与写入交互边界 |
| [`permission-consent-v0.md`](permission-consent-v0.md) | Open Design | Agent 权限、确认和安全边界 |

---

## 6. 相关文档

- [`../session-timeline-data-model-v0.md`](../session-timeline-data-model-v0.md) — 两棵树、Changeset 与数据边界
- [`../runtime-turn-flow-v0.md`](../runtime-turn-flow-v0.md) — 用户输入到受控写入的完整路径
- [`../isolation-scope-boundary-v0.md`](../isolation-scope-boundary-v0.md) — 所有权和隔离边界
- [`../airp-runtime-model-v0.md`](../airp-runtime-model-v0.md) — 默认 AIRP Profile 与通用 Agent 基座的关系
- [`../prompt/README.md`](../prompt/README.md) — Prompt Builder 与 Context Projection
- [`../extension/airp-extension-contribution-v0.md`](../extension/airp-extension-contribution-v0.md) — Extension 贡献 Agent Preset 和能力
