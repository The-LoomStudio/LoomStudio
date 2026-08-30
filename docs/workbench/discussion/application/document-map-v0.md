# Studio Application 文档地图 v0

> **状态**：Open Design / Navigation
> **目的**：给 Application Layer 文档重新分区，区分领域模型、运行时、组合编译、Provider / IO、隔离与数据边界，避免所有新增议题继续堆进同一层级。

---

## 1. 为什么需要文档地图

Application Layer 已经从单一 ADR 拆成多个专题，但随着 Runtime、Prompt Builder、State Store、Summarization、Provider、隔离边界继续展开，原目录开始出现两个问题：

```text
问题 A:
  文档按出现时间排列，而不是按架构层排列。

问题 B:
  一个完整玩家回合需要跨 8-10 份文档才能看懂。
```

因此需要一个稳定的阅读分区：

```text
Concept / Data:
  用户看见和作品持久化的东西。

Scope / Isolation:
  哪些东西互相隔离，哪些东西可以共享。

Runtime:
  一次输入如何变成运行、工具调用、提交和回滚。

Composition:
  如何把领域数据投影成 prompt payload。

Provider / IO:
  如何调用模型、处理流式、工具调用、错误和凭证。

UI / Extension:
  如何呈现、编辑、扩展这些能力。
```

---

## 2. 建议分区

### 2.1 Overview / Process

| 文件 | 作用 |
|---|---|
| [`0-overview-v0.md`](0-overview-v0.md) | Studio Application 高层边界 |
| [`README.md`](README.md) | 文档索引 |
| [`discussion-plan-v0.md`](discussion-plan-v0.md) | 决策驱动讨论计划 |
| [`discussion-order-v0.md`](discussion-order-v0.md) | 旧讨论顺序与未决清单 |
| [`document-map-v0.md`](document-map-v0.md) | 当前文档分区地图 |

### 2.2 Domain Data Model

这一组定义 Application canonical data，不讨论 provider request body。

| 文件 | 作用 |
|---|---|
| [`card-model-v0.md`](card-model-v0.md) | Card 作为顶层内容单元 |
| [`chat-opening-model-v0.md`](chat-opening-model-v0.md) | Chat / Opening / compiled message 的语义边界 |
| [`session-timeline-data-model-v0.md`](session-timeline-data-model-v0.md) | Narrative Timeline、Agent Session Tree、Step 与 Changeset 数据边界 |
| [`narrative-timeline-content-schema-v0.md`](narrative-timeline-content-schema-v0.md) | Narrative Node、Loom Markdown、Semantic Part 与派生 Projection |
| [`setting-layer-v0.md`](setting-layer-v0.md) | Setting Store / 设定层 |
| [`state-store-v0.md`](state-store-v0.md) | State Store / 高频变量层 |
| [`global-scope-v0.md`](global-scope-v0.md) | Global / Workspace / Card / Session scope |

### 2.3 Scope / Isolation

这一组回答“谁和谁隔离”。

| 文件 | 作用 |
|---|---|
| [`isolation-scope-boundary-v0.md`](isolation-scope-boundary-v0.md) | Narrative、Agent Session、Source、Binding 与 Changeset 隔离边界 |
| [`global-scope-v0.md`](global-scope-v0.md) | 全局设定与跨 Card / Session 共享 |
| [`state-store-v0.md`](state-store-v0.md) | State scope 与变量隔离 |
| [`frontend-projection-v0.md`](frontend-projection-v0.md) | 第三方替代体验与 namespace / 数据根隔离问题 |

### 2.4 Runtime / Agent

这一组回答“玩家输入后怎么跑”。

| 文件 | 作用 |
|---|---|
| [`runtime-turn-flow-v0.md`](runtime-turn-flow-v0.md) | 玩家输入到回复落盘的端到端回合流程 |
| [`airp-runtime-model-v0.md`](airp-runtime-model-v0.md) | Runtime Transcript / Narrative Timeline / commit 边界 |
| [`runtime-boundary-v0.md`](runtime-boundary-v0.md) | Application / Runtime / Provider / Security 边界 |
| [`agent/README.md`](agent/README.md) | Agent 领域入口 |
| [`agent/agent-model-v0.md`](agent/agent-model-v0.md) | Agent 是工作主体，不是 Character |
| [`agent/agent-runtime-loop-v0.md`](agent/agent-runtime-loop-v0.md) | Run / Step / loop / Commit Review Write |
| [`agent/runtime-policy-v0.md`](agent/runtime-policy-v0.md) | retry / stop / discard / commit policy |
| [`agent/tool-capability-v0.md`](agent/tool-capability-v0.md) | ToolCall / ToolResult / commit tool |
| [`agent/permission-consent-v0.md`](agent/permission-consent-v0.md) | Agent 权限与确认 |
| [`agent/retrieval-search-v0.md`](agent/retrieval-search-v0.md) | 主动读取与检索 |
| [`agent/multi-agent-orchestration-v0.md`](agent/multi-agent-orchestration-v0.md) | 多 Agent 编排 |

### 2.5 Prompt Composition

这一组回答“上下文如何编译”。

| 文件 | 作用 |
|---|---|
| [`prompt/README.md`](prompt/README.md) | Prompt Builder 入口 |
| [`../../../archive/discussion/application/loom-core-integration-v0.md`](../../../archive/discussion/application/loom-core-integration-v0.md) | 与 `@loom/core` 的边界 |
| [`prompt/composition-skeleton-and-preset-v0.md`](prompt/composition-skeleton-and-preset-v0.md) | Zone Tree / Injection Group / Preset |
| [`prompt/setting-layer-prompt-source-v0.md`](prompt/setting-layer-prompt-source-v0.md) | Setting Layer 作为 prompt source |
| [`prompt/content-component-and-binding-v0.md`](prompt/content-component-and-binding-v0.md) | Binding / macro / component |
| [历史 `composition-pipeline-v0.md`](../../../archive/discussion/application/composition-pipeline-v0.md) | 已归档；当前事实见 Architecture PromptBuild |
| [`composition-skeleton-v0.md`](composition-skeleton-v0.md) | 旧 Skeleton 迁移内容 |

### 2.6 Provider / IO

这一组回答“模型网关层怎么接”。

| 文件 | 作用 |
|---|---|
| [`provider-adapter-contract-v0.md`](provider-adapter-contract-v0.md) | Provider Adapter / Gateway contract |
| [`../platform/ai-gateway-and-provider-extension-v0.md`](../platform/ai-gateway-and-provider-extension-v0.md) | 平台级 AI Gateway、Provider Extension、Model Profile、统一配置面板 |
| [`runtime-boundary-v0.md`](runtime-boundary-v0.md) | Runtime 与 Provider 的职责边界 |
| [`prompt/composition-skeleton-and-preset-v0.md`](prompt/composition-skeleton-and-preset-v0.md) | provider capability diagnostics |
| [`../../adr/ADR-004-platform-auth-secrets-and-provider-credential-boundary.md`](../../adr/ADR-004-platform-auth-secrets-and-provider-credential-boundary.md) | Secret / credential boundary |

### 2.7 Mutation / Summary / Transform

| 文件 | 作用 |
|---|---|
| [`state-mutation-api-v0.md`](state-mutation-api-v0.md) | State / Setting mutation API |
| [`memory-summary-v0.md`](memory-summary-v0.md) | Memory / Summary 作为 Agent 写操作 |
| [`summarization-v0.md`](summarization-v0.md) | 总结触发、替换协议、Setting Layer 更新 |
| [`transform-rule-system-v0.md`](transform-rule-system-v0.md) | Regex / Transform Rule |

### 2.8 Trace / UI / Extension / Compatibility

| 文件 | 作用 |
|---|---|
| [`trace-explainability-v0.md`](trace-explainability-v0.md) | composition / runtime / commit 可解释性 |
| [`frontend-projection-v0.md`](frontend-projection-v0.md) | AIRP UI 集成 |
| [`ui/README.md`](ui/README.md) | UI Foundations 入口 |
| [`../../../architecture/ui/visual-language.md`](../../../architecture/ui/visual-language.md) | 已晋升的正式 UI 视觉语言 |
| [`ui/ui-preflight-decisions-v0.md`](ui/ui-preflight-decisions-v0.md) | UI 动工前基础决策 |
| [`ui/agent-panel-rendering-v0.md`](ui/agent-panel-rendering-v0.md) | Agent 面板渲染 surface 与交互边界 |
| [`user-input-intent-v0.md`](user-input-intent-v0.md) | 用户输入路由 |
| [`extension/README.md`](extension/README.md) | Extension Contribution 入口 |
| [`extension/airp-extension-contribution-v0.md`](extension/airp-extension-contribution-v0.md) | Application 层扩展贡献 |
| [`compatibility-import-v0.md`](compatibility-import-v0.md) | ST / CityTalent 导入兼容 |

---

## 3. 当前缺口清单

以下文件已经新增或应优先补强：

```text
High priority:
  - session-timeline-data-model-v0.md
  - isolation-scope-boundary-v0.md
  - provider-adapter-contract-v0.md
  - runtime-turn-flow-v0.md

Next:
  - compiled-prompt-payload-v0.md
  - model-provider-selection-v0.md
  - run-changeset-transaction-v0.md
  - runtime-streaming-events-v0.md
  - card-packaging-v0.md
```

---

## 4. 阅读路线

如果目标是判断“能否支撑完整玩家回合”，建议按以下顺序读：

```text
1. runtime-turn-flow-v0.md
2. session-timeline-data-model-v0.md
3. isolation-scope-boundary-v0.md
4. airp-runtime-model-v0.md
5. agent/agent-runtime-loop-v0.md
6. prompt/README.md
7. provider-adapter-contract-v0.md
8. state-store-v0.md
9. summarization-v0.md
10. trace-explainability-v0.md
```
