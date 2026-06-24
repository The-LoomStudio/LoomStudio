# Summarization v0

> **状态**：Open Design / Discussion Capture  
> **主题**：总结功能的定位、触发机制、Setting Layer 更新耦合、可替换插件协议。  
> **相关**：[`memory-summary-v0.md`](memory-summary-v0.md)、[`setting-layer-v0.md`](setting-layer-v0.md)、[`agent/agent-model-v0.md`](agent/agent-model-v0.md)、[`airp-runtime-model-v0.md`](airp-runtime-model-v0.md)

---

## 1. 定位

总结是一个**专门的功能**，不是普通的 Agent 写操作。

它有独立的触发条件、配置项、事件广播和可替换性，但在 Agent 架构中以**子 Agent** 形式执行。

```text
总结功能:
  本质上是一个子 Agent，执行以下工作：
  1. 读取特定长度的上下文 + 当前设定
  2. 在特定位置写入总结（特殊 slot）
  3. （可选）更新 Setting Layer 稳定设定区

总结功能不是:
  - 独立的基础设施层
  - 一个硬编码的"总结 Agent 类型"
  - Kernel 概念
```

---

## 2. 核心设计原则

### 2.1 总结是可替换的

内置总结只提供**简朴的默认实现**。

```text
设计原则:
  平台不应把总结做得太复杂，否则抢了插件生态的路。
  内置实现只保证基本可用。
  插件可以注册自己的总结实现来替换默认行为。

替换示例:
  - 插件 A：向量化 + RAG + 知识图谱的高级总结
  - 插件 B：多语言摘要 + 关键事件提取
  - 默认：简单的 LLM 摘要压缩
```

### 2.2 总结与 Setting Layer 更新绑定

Setting Layer 的稳定设定区（Lore / 世界书 / 角色资料）只在总结阶段修改。

```text
为什么绑定总结阶段:
  1. Setting Layer 内容投影到 Prompt 前部（类似 ST 蓝灯世界书）
  2. 修改前部内容 → Provider KV Cache 从修改位置起全部失效
  3. 总结阶段本身就要截断对话历史 → Cache 已经要失效
  4. 趁 Cache 失效的时机批量更新 Setting Layer → 不额外付出代价
  5. 需要写入的信息恰好是即将从对话窗口中丢失的细节

设计规则:
  非总结阶段，Agent 对稳定设定区的修改意图先暂存为 PendingSettingPatch。
  待下次总结时统一应用。
```

注意：动态变量区（HP、好感度等数值变量）不受此限制。详见 [§3.3](#33-与动态变量区的区分)。

---

## 3. 功能结构

### 3.1 触发条件

```text
自动触发（候选）:
  - 对话历史长度达到阈值（楼层数配置）
  - Token 使用量接近上下文窗口限制
  - 累积的 PendingSettingPatch 达到阈值

手动触发:
  - 用户主动请求总结
  - Card / Preset 在特定剧情点触发

配置项:
  - 触发楼层数阈值
  - 触发 Token 阈值
  - 是否自动触发 vs 仅手动
  - 总结后保留多少近期对话
```

### 3.2 执行流程

```text
总结阶段流程:
  1. 触发条件满足
  2. Runtime 广播 summarization.started 事件
  3. 子 Agent 启动（默认实现或插件替换实现）
     a. 读取即将截断的对话段
     b. 读取当前 Setting Layer 快照
     c. 应用 PendingSettingPatch + 生成新的 Setting Layer 更新
     d. 生成剧情摘要
  4. 产出写入：
     - Setting Layer Patches → 通过 MutationCandidate 提交
     - 摘要文本 → 写入特殊 slot
     - 截断旧对话
  5. Runtime 广播 summarization.completed 事件
```

### 3.3 与动态变量区的区分

```text
Setting Layer 内容分两区:

  稳定设定区（Lore / 世界书 / 角色资料）
    → 投影到 Prompt 前部
    → 只在总结阶段修改
    → 修改 = Cache 失效，但此时本来就要失效

  动态变量区（HP / 好感度 / 临时标记）
    → 投影到 Prompt 尾部或 Tool Result 中
    → 可随时通过 patch_state 修改
    → 修改不影响前部 Cache
```

---

## 4. 事件广播

总结涉及对外广播，供 UI 和插件监听。

```text
事件（候选）:
  summarization.started
    - 通知 UI 显示总结进度
    - 通知插件准备相关数据

  summarization.completed
    - 通知 UI 总结完成
    - 通知插件总结结果可用
    - payload 包含：摘要内容、Setting Layer 变更列表、截断范围

  summarization.failed
    - 总结失败（子 Agent 错误、超时等）
    - 回退策略
```

---

## 5. 插件替换协议

### 5.1 替换机制

```text
默认实现:
  Studio 内置简朴的 LLM 摘要子 Agent。

插件替换:
  Extension 通过 contributes.summarizer 声明替换实现。
  同一时刻只有一个总结实现生效。
  用户在 Preferences 中选择使用哪个总结插件。

替换合约:
  任何总结实现必须满足统一的输入/输出合约：
  - 输入：待截断的对话历史 + Setting Layer 快照 + PendingSettingPatch
  - 输出：Setting Layer Patches + 摘要文本
```

### 5.2 扩展点

```text
插件可以替换的部分:
  - 总结的 LLM 调用逻辑
  - Setting Layer 更新的提取逻辑
  - 摘要的存储格式和位置

插件不能替换的部分:
  - 触发条件的判断（由 Runtime 控制）
  - 事件广播（由 Runtime 控制）
  - MutationCandidate 的提交路径
  - Permission / Consent 的校验
```

---

## 6. 摘要的存储位置

总结产出的摘要文本写入一个**特殊 slot**。

```text
候选方案:
  摘要作为 Setting Layer 中的特殊 entry（kind: summary）。
  该 entry 在 Prompt Builder 编译时被投影到指定位置。
  位置由 Composition Skeleton 的 slot 规则决定。
```

开放问题：

- 摘要 slot 在 Skeleton 中的默认位置；
- 多次总结是替换还是追加；
- 摘要是否有版本历史。

---

## 7. 非目标

本文件不定义：

- 完整的向量化 / RAG / 知识图谱方案（留给插件生态）；
- 总结 UI 的交互设计；
- 总结的完整 schema；
- 跨 Session 的摘要共享；
- 自动遗忘 / 记忆衰减策略。

---

## 8. 开放问题

1. 总结是否需要用户确认才能应用？还是自动应用？
2. 总结子 Agent 的 Provider 是否可以与主 Agent 不同（用便宜模型做总结）？
3. 总结失败时的回退策略：保留未截断的历史？使用简单截断？
4. 多个插件注册了总结实现时的冲突处理？
5. PendingSettingPatch 的暂存格式和存储位置？
6. 总结触发时机是否应该在 commit_narrative 之后立即评估？
7. 总结的 Trace 如何记录？需要记录哪些信息？
