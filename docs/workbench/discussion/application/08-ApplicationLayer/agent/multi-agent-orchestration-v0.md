# 多 Agent 编排 (Multi-Agent Orchestration) v0

> **状态**：Open Design  
> **主题**：Agent 的主子调度架构、模式切换、工作区隔离、上下文传递及平台层面的扩展原则。  
> **相关**：[`agent-runtime-loop-v0.md`](agent-runtime-loop-v0.md)、[`agent-model-v0.md`](agent-model-v0.md)

---

## 1. 核心架构认知：分发即 Preset 嵌套

多 Agent 的本质并不是平台底层硬编码出“包工头”和“泥瓦匠”两套代码逻辑。在底层，**所有 Agent 都是平等的 Preset**。

- 编写一个“子 Agent”和编写一个“主 Agent”，在体验上完全一致（都是在配 Preset，有 System 槽位、Chat 槽位、Setting 槽位）。
- “多 Agent 编排”在底层其实就是 **Preset A 调用了一个 Tool，唤起了 Preset B**。
- Agent 的能力差异，本质上就是分配给它们的不同 Tool 权限以及约束在提示词里的要求。

### 1.1 平台绝不写死分工

作为平台基建，引擎不能规定“主 Agent 负责调度，子 Agent 负责写剧情”。

- 分工由 Preset（预设作者）决定。
- 官方可能提供一套默认的 Preset 思路（主分发、子干活），但角色卡作者或高级预设作者可以完全颠覆这套分工。
- 例如，预设作者可以没收主 Agent 的 `commit_narrative` 权限，把它交给一个专门负责描写的子 Agent。

### 1.2 运行时的非平等性（防止嵌套失控）

虽然在“预设编写体验”上它们是平等的，但在 **Runtime Loop 中必须严格区分执行上下文**。主子关系由“是否被调起”动态决定。

- **禁止递归嵌套**：为了防止死循环和 Token 失控爆炸，**子 Agent 绝对不允许再次调用子 Agent**。
- **权限剥夺**：当一个 Preset 被作为“子 Agent”唤起时，Runtime 会强制将其 `dispatch_sub_agent` 的 Tool 权限剥夺，无论其原配置中是否包含该工具。
- **单次执行返回**：主 Agent 是一个持续交互的循环（响应用户），而子 Agent 是被一次性唤起执行特定任务的短生命周期实例，得出 `tool_result` 即告销毁。

---

## 2. 调度机制：模式切换与工具派发

### 2.1 模式切换 (Mode Switch)

为了防止负责调度的 Agent 提示词发生 Token 注意力崩溃（既要懂分发，又要懂繁杂的设定和写作规则），引入模式切换机制。

- **模式即热替换**：模式切换本质上是主系统提示词的动态热替换。
- Agent 在“调度/决策”模式时，仅加载极简的调度规则。只有当其切换至“写作/特定工作”模式时，Prompt Builder 才会将相关的文风、人称等厚重设定投喂给它。
- 模式切换通常是编排级 Agent（主 Agent）的特权，用来防止任务被过度细分。

### 2.2 工具派发 (Dispatch)

当一个任务超出了当前 Agent 的处理能力或模式时，它通过调用 `dispatch_sub_agent` Tool，将任务委派给另一个 Preset。

- 主 Agent 通过工具传参，将一段明确的“要求/指令”直接传递给子 Agent。
- 主 Agent 不负责为子 Agent 拼凑上下文，拼凑逻辑由子 Agent 自身的 Preset 配置决定。

---

## 3. 子 Agent 的数据流与隔离

### 3.1 树状 Chat 结构与一次性子环境

- **支持回滚的树结构**：由于设定推演和剧情可能面临回滚/重开，工作对话在数据层必然是带有父节点指向的树形（Tree）结构。
- **绝对独立的子环境**：子 Agent 在干活时，会在底层开辟一个绝对独立的子分支。它产生的思考过程、Tool Calls（如查规则、掷骰子）都记录在这个子环境的 Chat 轨迹中。
- **一次性废弃**：子 Agent 的 Chat 轨迹是**暂时性、一次性的**，用完即丢，不会污染全局的工作历史，也不需要持久化。

### 3.2 子 Agent 交卷机制

当子 Agent 运行完毕后，它的结论是如何回到主线上的？

- 在主 Agent 看来，调用子 Agent 只是调用了一个 Tool。
- 子 Agent 环境销毁前，将其最终结论提取为一个 JSON 对象或文本。
- 该结果以 `tool_result` 的形式追加到主 Agent 的 Chat 树上。
- 主 Agent 根据收到的 `tool_result` 继续推进自己的 Loop。

---

## 4. 上下文共享（替代“黑板”概念）

在多 Agent 场景下，不需要在数据层造一个独立的 `agent.blackboard` 实体结构。

### 4.1 黑板即通用投影 (Context Projection)

所谓的知识共享黑板，本质上就是 Application 层里 Prompt Builder 拼凑出来的一组上下文。它自然包含了：

1. 剧情正文的 Chat（交代故事进展）。
2. 主 Agent 自己的工作 Chat（交代目前的计划和进度）。
3. Setting Layer 被触发的条目（交代世界观、规则、角色状态）。

### 4.2 默认全量 + 滑块限制

针对子 Agent 的上下文挂载策略：

- **默认上下文对齐**：子 Agent 默认可以获得与主 Agent 相同的剧情和工作对话上下文。
- **滑块与过滤**：平台通过 Preset 配置面板提供范围“滑块”（例如：只读取最近 N 条对话，或只读特定 tag 的 Setting），让 Preset 作者自行决定上下文的过滤程度以节约 Token。
- 这意味着上下文的过滤逻辑被固化在子 Agent 的 Preset 定义中，而不是由主 Agent 在运行时动态判断要传什么上下文。

---

## 5. 作者生态对接

- **预设作者**定义生态骨架：创建各种不同职能的 Agent Preset，赋予不同的 Tool，挖好对应的槽位。
- **角色卡作者**填槽：不改变编排骨架，只针对特定的槽位（如 `rule_judge` 子 Agent）注入与本角色相关的专有设定（如特殊的战斗计算公式）。此部分属于提示词注入 (Prompt Injection) 领域的合并逻辑，由 Prompt Builder 负责处理。

---

## 6. 程序性触发与独立异步 Agent

除了由主 Agent 主动路由唤起的“子 Agent”外，平台还支持一类特殊的实体：**独立异步 Agent (Independent Asynchronous Agent)**。

### 6.1 定义与定位

- 这类 Agent 不受主 Agent 管理，它们是游离于主 Loop 之外的“幽灵 Agent”。
- 它们的职责通常是系统级的辅助任务，如：定期总结（Summarizer）、每轮生成配图（文生图 Agent）、自动归档。
- 它们当然也可以被**同时**注册为主 Agent 可路由的普通子 Agent（供主 Agent 在特定情况下主动调用），但在绝大多数情况下，它们依靠程序规则自动运转。

### 6.2 触发器的提供方：插件作者

触发标准（Trigger Criteria）**不由预设作者管理，而是由 Agent 插件的作者直接提供**。

- 作为平台，提供的是一个**触发器注册接口 (Trigger Registration API)**。
- 插件作者在提供文生图 Agent 的同时，向平台注册规则：“本 Agent 需要每轮对话强制触发一次”。
- 插件作者在提供总结 Agent 时，注册规则：“本 Agent 需要在未总结的对话历史达到 20 条时触发”。

### 6.3 执行时机：Finish Hook

为了不阻断用户与主 Agent 的流畅交互，程序性触发器的最佳 Hook 介入点是 **Loop 的 Finish 阶段**。

1. 主 Agent 正常完成本轮工作（Write 阶段完成，`chat[]` 落盘，Loop 退出）。
2. 平台触发 `run.completed` 等 Finish 事件。
3. 挂载在 Finish Hook 上的触发器进行条件判定（算算楼层、查查状态）。
4. 条件满足，系统在后台悄悄拉起独立 Agent，传入所需的上下文投影。
5. 独立 Agent 异步执行完毕，结果默默写入目标位置（如 RAG 向量库、Setting Layer 稳定区），全程不干扰主线对话。
