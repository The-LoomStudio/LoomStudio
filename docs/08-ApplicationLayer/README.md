# Studio Application 文档区

> **Status**: Planning / Open Design  
> **Purpose**: 收纳 Studio Application 的长期设计材料，避免所有讨论都堆进单个 ADR。  
> **Related ADR**: [`../adr/ADR-005-official-concept-stack-open-design.md`](../adr/ADR-005-official-concept-stack-open-design.md)

---

## 1. 定位

本目录用于承载 Studio Application 的分层设计文档。

目录名 `08-concept-stack/` 是历史名称。根据 2026-05-20 的讨论，`Concept Stack` 不再作为主要正式术语使用。后续正式方向改为：

```text
Studio Application
```

该 Layer 是 Studio 第一方内建 product/package layer，不进入 Kernel，也不作为 ordinary extension。它提供默认完整 AIRP 体验，包括 Card 管理、Session / Chat、Opening、Setting Layer、Agent、Composition、Trace explainability 和第一方 AIRP UI。

Provider adapters、Importers、Exporters、Tools、模型特定 payload adapters 和外部服务集成仍适合 extension 化。

其中 AI Gateway / Provider Extension 已从单纯 Application Provider 边界上升为平台级共享能力，详见 [`../09-PlatformLayer/ai-gateway-and-provider-extension-v0.md`](../09-PlatformLayer/ai-gateway-and-provider-extension-v0.md)。

ADR-005 仍是当前主讨论入口，但它不应无限增长。随着各议题稳定，应逐步拆出本目录下的专题文档。

当前原则：

```text
ADR-005:
  记录开放问题、阶段性决策、讨论顺序。

08-concept-stack/:
  承载逐步稳定下来的专题规格、设计笔记和大议题草案。
```

### 1.1 术语约定

```text
Setting Layer:
  AIRP 作品设定层。

Agent:
  执行任务的工作主体，不等于 Character。

Narrative Timeline:
  被接受的作品产出时间线。

Runtime Transcript:
  Agent 工作过程记录。

Preferences:
  应用设置 / 用户偏好。

Settings:
  不作为主要 UI 术语使用，避免和 Setting Layer 混淆。
```

Config / Settings / Preferences / Setting Layer 的层级、边界和持久化规则尚未系统处理。该议题应后续单独形成 ADR。

---

## 2. 当前已定方向摘要

以下方向来自 ADR-005 当前讨论，仍处于 Open Design，但已作为后续讨论默认前提：

1. `Card` 是顶层内容单元，不等同于 `Character`。
2. Card metadata / readme 只服务展示，不作为 prompt builder 特殊输入。
3. `Character description` / `Personality` / `Scenario` 不作为 canonical prompt 字段。
4. `Opening` 取代 `First Message`，且不是特殊的第一条 Chat 元素。
5. ST `Example Dialogues` 暂不继承为一等概念。
6. 不复刻 ST Group Chat 产品概念。
7. 不建立 `Actor` / `Participant` / `Speaker` / `CharacterProfile` 等过早硬编码类层级。
8. `Setting Layer` 是设定与可变状态的统一地基。
9. `Book` 概念弱化为 collection / folder / namespace，不作为核心语义。
10. `Preset` 属于 Application composition layer，但 backend canonical 倾向 `Composition Skeleton`。
11. `Author's Note` / 临时注入提示不作为独立 canonical concept。
12. ST / CityTalent / 旧角色卡导入兼容延后，不作为当前设计驱动力。
13. AIRP Runtime 应区分 agent 工作对话与剧情产出；剧情文本不应由普通 assistant message 自动写入 canonical timeline，而应通过受控 commit / tool 写入。
14. `Agent` 不是 `Character`。Agent 是工作主体，Character 是作品设定或叙事对象。
15. Runtime loop 是独立专题，不塞进 Prompt Builder。Step 是状态推进记录，不预设 ReAct 分类。
16. Observation / Stop / Reflection 不是 Prompt Builder 基础概念。ToolCall / ToolResult 是 Runtime Transcript / message 层的一等条目。
17. Memory / Summary 是 Agent 的写操作 + 截断，不是独立基础设施层。
18. Retrieval / Search 是 Tool / Capability 的子能力。
19. Regex 应归入 Transform Rule System，在受控阶段执行，不能随处运行。
20. 默认 AIRP Runtime 可以采用 ephemeral transcript projection：完整 Agent 工作对话归档但不默认进入下一轮 prompt。
21. Agent 基座仍保存完整 Run Transcript / ToolCall / ToolResult / Trace / Changeset；ephemeral 只是默认 Runtime Profile，不污染平台性。
22. Agent 主动读取结果先进入 Fresh Read Tail，被消费一轮后沉淀到 Dynamic Context Mount，并按作者设定排序。
23. 程序性触发和主动读取共享动态挂载面，但生命周期不同；关键词失效不能卸载主动读取 item。
24. State Store 不承载"慢变量"；低频人设、性格、年龄、长期关系等仍属于 Setting Store。
25. Preset / Composition Skeleton 采用 Zone Tree + Injection Group：Source Tree 负责存储和分类，Injection Group 只是 Prompt Build 的挂载锚点。
26. 注入位置组不是文件夹；同一个世界书 / preset source 可以按不同 injection group 产生多个 source-scoped slots，并分别排序。
27. 动态 slots 不写死在全局 preset 中；Prompt Build 根据当前 source set materialize slots，并用 Projection Order Profile 的稳定 rankKey 承载 UI 拖拽排序。
28. UI 应区分资源视图和 Prompt 视图：资源树管理内容，Prompt 视图预览最终投影顺序。
29. Session 是默认运行时隔离边界；Card 是内容包边界，不是运行实例边界。
30. Prompt Builder 不扫描整个 workspace；Runtime 每轮构造当前 Source Set。
31. Provider Adapter / Gateway 层需要独立 contract；它只消费 compiled prompt payload，不理解 AIRP documents。
32. 完整玩家回合应由 Runtime Turn Flow 串联 input、compose、provider、tool、commit、state、trace 和 UI events。

---

## 3. 文档分类

### 3.1 总览与原则

| 文件 | 状态 | 目的 |
|---|---|---|
| [`0-overview-v0.md`](0-overview-v0.md) | Migrated / Open Design | Studio Application 总览、原则、边界 |
| `concept-stack-glossary-v0.md` | Planned | Card、Opening、Setting、Skeleton 等术语表 |
| [`discussion-order-v0.md`](discussion-order-v0.md) | Migrated / Open Design | 讨论顺序、未定事项、实施前置条件 |
| [`discussion-plan-v0.md`](discussion-plan-v0.md) | Open Design | 决策驱动讨论计划、依赖图、近期讨论安排 |
| [`document-map-v0.md`](document-map-v0.md) | Open Design / Navigation | Application Layer 文档分区地图 |

### 3.2 Card 与内容单元

| 文件 | 状态 | 目的 |
|---|---|---|
| [`card-model-v0.md`](card-model-v0.md) | Migrated / Open Design | Card 作为顶层内容单元的模型 |
| [`asset-import-export-boundary-v0.md`](asset-import-export-boundary-v0.md) | Open Design / Implementation Planning | Card、Setting Layer、Workspace Artifact、导入导出与运行时 SQL 文档边界 |
| `card-packaging-v0.md` | Planned | Card 分发、资源引用、readme / metadata 边界 |

### 3.3 设定层与状态

| 文件 | 状态 | 目的 |
|---|---|---|
| [`setting-layer-v0.md`](setting-layer-v0.md) | Migrated / Open Design | 统一设定层、嵌套结构、索引、投影规则 |
| [`state-store-v0.md`](state-store-v0.md) | Open Design | 高频变量、Schema、响应式状态与 Setting Store 边界 |
| [`global-scope-v0.md`](global-scope-v0.md) | Migrated / Open Design | 全局 user 设定、全局设定库、跨 Card scope |
| [`state-mutation-api-v0.md`](state-mutation-api-v0.md) | Migrated / Open Design | KV、AI 更新、插件修改、回滚边界 |
| [`memory-summary-v0.md`](memory-summary-v0.md) | Open Design | Memory / Summary 作为 Agent 写操作 + 截断 |
| [`summarization-v0.md`](summarization-v0.md) | Open Design | 总结功能、可替换插件协议、Setting Layer 更新耦合 |

### 3.3.1 Scope / Isolation

| 文件 | 状态 | 目的 |
|---|---|---|
| [`isolation-scope-boundary-v0.md`](isolation-scope-boundary-v0.md) | Open Design | 对话隔离、角色卡隔离、source set、rollback boundary |

### 3.4 Chat 与 Opening

| 文件 | 状态 | 目的 |
|---|---|---|
| [`chat-opening-model-v0.md`](chat-opening-model-v0.md) | Migrated / Open Design | Chat / Opening / compiled message 的语义边界 |
| [`session-timeline-data-model-v0.md`](session-timeline-data-model-v0.md) | Open Design | Session、Narrative Timeline、Runtime Transcript、Chat 数据形式 |
| `session-model-v0.md` | Superseded by session-timeline-data-model-v0 | Session、timeline、branch、运行实例边界 |

### 3.5 Composition Skeleton

| 文件 | 状态 | 目的 |
|---|---|---|
| [`composition-skeleton-v0.md`](composition-skeleton-v0.md) | Migrated / Open Design | Skeleton、slot、cluster、排序、输出结构 |
| [`composition-pipeline-v0.md`](composition-pipeline-v0.md) | Migrated / Open Design | Documents -> Fragments -> loom.run -> compiled payload |
| [`trace-explainability-v0.md`](trace-explainability-v0.md) | Migrated / Open Design | 来源、激活、排序、裁剪的解释模型 |

### 3.6 Prompt Builder

| 文件 | 状态 | 目的 |
|---|---|---|
| [`prompt/README.md`](prompt/README.md) | Open Design / Discussion Capture | Prompt Builder 领域入口 |
| [`prompt/loom-core-integration-v0.md`](prompt/loom-core-integration-v0.md) | Open Design | Prompt Builder 与 Loom Core 的对接边界 |
| [`prompt/composition-skeleton-and-preset-v0.md`](prompt/composition-skeleton-and-preset-v0.md) | Open Design | 预设层、骨架填充、slot / marker、provider 兼容性 |
| [`prompt/setting-layer-prompt-source-v0.md`](prompt/setting-layer-prompt-source-v0.md) | Open Design | Setting Layer 作为 prompt-facing source 的边界 |
| [`prompt/content-component-and-binding-v0.md`](prompt/content-component-and-binding-v0.md) | Open Design | 内容层组件化、binding、宏与变量注入 |

### 3.7 Agent

| 文件 | 状态 | 目的 |
|---|---|---|
| [`agent/README.md`](agent/README.md) | Open Design / Discussion Capture | Agent 领域入口 |
| [`agent/agent-model-v0.md`](agent/agent-model-v0.md) | Open Design | Agent 定义、与 Character / Runtime / Card 关系 |
| [`agent/runtime-policy-v0.md`](agent/runtime-policy-v0.md) | Open Design | Run 控制、loop、retry、stop、discard、commit policy |
| [`agent/tool-capability-v0.md`](agent/tool-capability-v0.md) | Open Design | Tool 定义、ToolCall / ToolResult、commit_output、provider 映射 |
| [`agent/retrieval-search-v0.md`](agent/retrieval-search-v0.md) | Open Design | Agent 主动搜索，Tool / Capability 的子能力 |
| [`agent/permission-consent-v0.md`](agent/permission-consent-v0.md) | Open Design | Agent 权限、确认策略、安全边界 |

### 3.8 Runtime / Provider 边界

| 文件 | 状态 | 目的 |
|---|---|---|
| [`runtime-boundary-v0.md`](runtime-boundary-v0.md) | Migrated / Open Design | Studio Application 与 Runtime / Provider / Security 边界 |
| [`airp-runtime-model-v0.md`](airp-runtime-model-v0.md) | Open Design / Discussion Capture | AIRP Runtime、Runtime Transcript、Narrative Timeline、ToolCall / ToolResult 与 commit 边界 |
| [`runtime-turn-flow-v0.md`](runtime-turn-flow-v0.md) | Open Design | 玩家输入到回复落盘的完整 loop |
| [`provider-adapter-contract-v0.md`](provider-adapter-contract-v0.md) | Open Design | Provider Adapter / Gateway contract、invoke / stream、capability、usage / error |
| [`../09-PlatformLayer/ai-gateway-and-provider-extension-v0.md`](../09-PlatformLayer/ai-gateway-and-provider-extension-v0.md) | Open Design | 平台级 AI Gateway、Provider Extension、Model Profile、统一配置面板 |
| [`m0-backend-slice-v0.md`](m0-backend-slice-v0.md) | M0 Implementation Slice | 不接 UI / 真实模型前提下的 Application Runtime 后端闭环 |

### 3.9 Transform Rule

| 文件 | 状态 | 目的 |
|---|---|---|
| [`transform-rule-system-v0.md`](transform-rule-system-v0.md) | Open Design | Regex / Transform 规则系统、阶段、权限、trace / rollback |

### 3.10 Extension Contribution

| 文件 | 状态 | 目的 |
|---|---|---|
| [`extension/README.md`](extension/README.md) | Open Design / Discussion Capture | Extension Contribution 领域入口 |
| [`extension/airp-extension-contribution-v0.md`](extension/airp-extension-contribution-v0.md) | Open Design | Extension 如何贡献 AIRP 领域能力 |

### 3.11 交互层

| 文件 | 状态 | 目的 |
|---|---|---|
| [`user-input-intent-v0.md`](user-input-intent-v0.md) | Open Design | 用户输入分类、指令与剧情内容区分 |

### 3.12 Frontend Projection

| 文件 | 状态 | 目的 |
|---|---|---|
| [`frontend-projection-v0.md`](frontend-projection-v0.md) | Migrated / Open Design | Studio AIRP UI 集成、编辑器、预览与 RPC 表面候选 |

### 3.13 UI Foundations

| 文件 | 状态 | 目的 |
|---|---|---|
| [`ui/README.md`](ui/README.md) | Open Design / Discussion Capture | Studio Application UI 分类入口，归档布局、滚动、状态、I18N、无障碍等基础问题 |
| [`ui/ui-foundation-v0.md`](ui/ui-foundation-v0.md) | Open Design | UI 基础原则、桌面优先、信息密度、设计 token、文案与状态原则 |
| [`ui/visual-language-v0.md`](ui/visual-language-v0.md) | Open Design / Design Direction | 平面编辑式工作台：留白、字重、细线、低装饰的正式 UI 视觉语言 |
| [`ui/default-airp-layout-v0.md`](ui/default-airp-layout-v0.md) | Open Design | 默认 AIRP 布局骨架：稳定阅读主轴、悬浮工具层、输入舱 |
| [`ui/ui-preflight-decisions-v0.md`](ui/ui-preflight-decisions-v0.md) | Open Design / Initial Decisions | UI 动工前的 I18N、滚动、焦点、渲染安全和插件 slot 基础决策 |
| [`ui/css-architecture-and-customization-v0.md`](ui/css-architecture-and-customization-v0.md) | Open Design | CSS Modules、Design Tokens、Custom CSS、插件样式边界 |
| [`ui/agent-panel-rendering-v0.md`](ui/agent-panel-rendering-v0.md) | Open Design | Agent 面板内文本、Artifact、ToolCall 和交互卡片的渲染边界 |
| [`ui/custom-renderer-poc-plan-v0.md`](ui/custom-renderer-poc-plan-v0.md) | PoC Plan | 多标签页 Custom Renderer 的隔离、状态同步、轻量 SDK、CSS/A11Y/I18N smoke |
| [`ui/layout-and-scroll-containers-v0.md`](ui/layout-and-scroll-containers-v0.md) | Open Design | Application 布局、滚动所有权、虚拟列表、滚动恢复 |
| [`ui/interaction-states-v0.md`](ui/interaction-states-v0.md) | Open Design | empty / loading / error / pending / dirty / optimistic / degraded 等状态 |
| [`ui/i18n-and-accessibility-v0.md`](ui/i18n-and-accessibility-v0.md) | Open Design | I18N、键盘导航、焦点管理、ARIA、可缩放文本、对比度 |

### 3.14 Deferred / 兼容层

| 文件 | 状态 | 目的 |
|---|---|---|
| [`compatibility-import-v0.md`](compatibility-import-v0.md) | Migrated / Deferred | ST / CityTalent / 旧角色卡导入兼容 |
| `transform-script-extension-v0.md` | Deferred -> Superseded by [`transform-rule-system-v0.md`](transform-rule-system-v0.md) | Regex、Card Script、扩展绑定、transform rules |

---

## 4. 讨论计划

详见 [`discussion-plan-v0.md`](discussion-plan-v0.md)。

当前建议的主线顺序：

```text
0. Document Map / Scope Map（文档分区与隔离地图）
1. Session / Timeline Data（数据层具体形态）
2. Agent Model（Agent 不是 Character）
3. Runtime Transcript / Narrative Timeline（工作对话 vs 剧情产出）
4. Tool / Capability / Commit（工具调用与剧情写入）
5. Provider Adapter Contract（模型网关层）
6. Runtime Turn Flow（玩家输入到回复落盘）
7. Setting Layer + Retrieval（内容底座与 Agent 主动搜索）
8. Prompt Builder + Skeleton + Setting Projection（上下文编译）
9. Transform Rule / Regex（受控内容变换）
10. Memory / Summary / State Mutation（Agent 写操作与状态更新）
11. Trace / Explainability（可解释性）
12. User Input Intent（交互层）
13. Extension Contribution（扩展协议）
```

每轮只收束会阻塞下一轮的最小结论，不追求一次性把该模块讲完。

---

## 5. 写作规则

1. 本目录文档优先使用中文。
2. 不在专题文档中把候选 TypeScript 草案伪装成 accepted API。
3. 不为了兼容 ST 旧字段而扭曲 canonical model。
4. 不引入过早硬编码类层级。
5. 每个专题文档应明确：
   - 已定方向；
   - 未定问题；
   - 非目标；
   - 与 Kernel / Runtime / Provider / Security 的边界。

---

## 6. 讨论方法

Application Layer 设计遵循方法论文档中的流程：

```text
领域发现 -> 场景模拟 -> ADR / Spec 收口 -> 最小实现验证
```

尤其需要避免一开始就把所有数据结构建模完整。每个模型应优先通过真实场景反推，例如预设作者、简单卡作者、复杂卡作者、插件作者、Provider Adapter 作者和 Importer 作者分别会如何使用 Studio。

详见：

- [`../02-methodology/README.md`](../02-methodology/README.md)
- [`../02-methodology/scenario-driven-design-v0.md`](../02-methodology/scenario-driven-design-v0.md)
