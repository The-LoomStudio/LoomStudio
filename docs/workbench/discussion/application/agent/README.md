# Agent 领域文档

> **状态**：Open Design / Discussion Capture  
> **目的**：集中记录 Studio Application 中与 Agent 模型、运行策略、工具能力、检索和权限有关的设计讨论。

---

## 1. 定位

Agent 是 Studio Application 的核心领域之一，与 Prompt Builder 同等重要性。

当前边界：

```text
Agent:
  执行任务的工作主体。
  拥有运行策略、工具调用、检索能力和权限约束。

Prompt Builder:
  编译 Agent 运行中某一步需要的上下文投影。

Provider Adapter:
  映射和调用 provider 请求。

Kernel:
  不认识 Agent、Tool、Commit 或 Narrative 语义。
```

Agent 不等于 Character、Persona、Narrator 或 Speaker。Character 是作品设定中的角色，Agent 是执行工作的主体。

---

## 2. 核心原则

```text
1. Agent 不是 Character。
   Agent 是工作主体，Character 是作品设定或叙事对象。

2. Agent 的工作对话进入 Runtime Transcript，不直接进入 Narrative Timeline。

3. Agent 产出通过受控 commit / tool 写入 Narrative Timeline。

4. Agent 的失败 run 可以整体丢弃，不污染 canonical narrative。

5. Tool / Capability 是 Agent 可调用的能力。

6. Retrieval / Search 是 Tool / Capability 的子能力。

7. Permission / Consent 控制 Agent 能做什么。

8. Runtime Policy 控制 Agent 的运行过程。
```

---

## 3. 与其他领域的关系

```text
Agent -> Runtime Policy:     如何推进运行
Agent -> Tool / Capability:  可调用哪些能力
Agent -> Prompt Builder:     需要编译上下文时调用
Agent -> Setting Layer:      可读取和受控修改设定
Agent -> Memory / Summary:   写操作 + 截断
Agent -> Narrative Timeline: 通过 commit 写入
Agent -> Transform Rule:     产出经过 transform phase
Agent -> Trace / Audit:      所有动作可追溯
```

---

## 4. 本目录收纳什么

- Agent 模型定义；
- Runtime 策略与控制；
- Tool / Capability / Commit；
- Retrieval / Search；
- Permission / Consent / Safety Policy。

本目录不收纳：

- Prompt Builder pipeline（见 [`prompt/`](../prompt/README.md)）；
- Setting Layer schema（见 [`../setting-layer-v0.md`](../setting-layer-v0.md)）；
- Composition Skeleton / Preset（见 [`../composition-skeleton-v0.md`](../composition-skeleton-v0.md)）；
- Provider Adapter（见 [`../runtime-boundary-v0.md`](../runtime-boundary-v0.md)）；
- Kernel API（见平台层文档）。

---

## 5. 文件列表

| 文件 | 状态 | 主题 |
|---|---|---|
| [`agent-model-v0.md`](agent-model-v0.md) | Open Design | Agent 定义、与 Character / Runtime / Card 关系 |
| [`agent-runtime-loop-v0.md`](agent-runtime-loop-v0.md) | Open Design | Step 原子、kind 约定、Commit→Review→Write 流水线、存储策略 |
| [`multi-agent-orchestration-v0.md`](multi-agent-orchestration-v0.md) | Open Design | 主子架构、Preset 分发、模式切换、一次性子环境与通用投影黑板 |
| [`runtime-policy-v0.md`](runtime-policy-v0.md) | Open Design | Run 控制、loop、retry、stop、discard、commit policy |
| [`tool-capability-v0.md`](tool-capability-v0.md) | Open Design | Tool 定义、ToolCall / ToolResult、commit_output、provider 映射 |
| [`retrieval-search-v0.md`](retrieval-search-v0.md) | Open Design | Agent 主动搜索、作为 Tool / Capability 的子能力 |
| [`permission-consent-v0.md`](permission-consent-v0.md) | Open Design | Agent 权限、确认策略、安全边界 |

---

## 6. 相关文档

- [`../airp-runtime-model-v0.md`](../airp-runtime-model-v0.md) — Runtime Transcript / Narrative Timeline 分离
- [`../runtime-boundary-v0.md`](../runtime-boundary-v0.md) — 高层边界
- [`../memory-summary-v0.md`](../memory-summary-v0.md) — Memory 作为 Agent 写操作
- [`../prompt/README.md`](../prompt/README.md) — Prompt Builder 领域
