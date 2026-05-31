# Retrieval / Search v0

> **状态**：Open Design  
> **主题**：Agent 主动搜索能力，作为 Tool / Capability 的子能力。

---

## 1. 定位

Agent 主动搜索设定、记忆、知识，本质上是调用一个 search / retrieval 工具。

它不是独立基础设施层，而是 Tool / Capability 的子能力。

```text
Tool / Capability:
  Agent 可调用的能力。

Retrieval / Search:
  其中一类 Tool，负责从 Setting Layer / Memory / Narrative Timeline 中检索内容。
```

---

## 2. 核心问题

> Agent 如何在运行中主动获取需要的上下文，而不是把所有内容一次性塞进 prompt？

传统做法是：

```text
把所有可能相关的内容写进 system prompt 或 context window。
```

但这对长篇写作、复杂世界、大量设定不可行。

更合理的是：

```text
Agent 在运行中按需搜索，获取当前需要的上下文。
```

---

## 3. 搜索什么

Agent 可能搜索：

```text
Setting Layer:
  角色资料、关系、状态、规则、事件。

Memory / Summary:
  长期记忆、剧情摘要、场景总结。

Narrative Timeline:
  已有剧情内容、对白历史。

Global Scope:
  全局设定、用户偏好。

Extension 贡献内容:
  插件私有但 prompt-facing 的内容。
```

---

## 4. 搜索结果是什么

搜索结果是 ToolResult 的一种。

```text
Agent 调用 search tool:
  -> search("alice 的当前心情")
  -> ToolResult:
     - 命中 entries
     - 来源 document ids
     - 相关度 / 激活原因
     - trace 引用
```

搜索结果：

```text
不自动进入 prompt。
进入 Runtime Transcript 作为 ToolResult。
Runtime 决定是否投影给 Prompt Builder。
Trace 记录搜索 query、命中、过滤和注入。
```

---

## 5. 与 Setting Layer 的关系

Setting Layer 提供可搜索的内容底座。

但搜索能力不等于 Setting Layer 本身。

```text
Setting Layer:
  存储内容、提供 query / index 能力。

Search Tool:
  决定搜索什么、如何匹配、返回什么格式。

Runtime:
  决定搜索结果是否进入上下文。
```

Setting Layer 需要提供怎样的 query / index 能力是开放问题。

当前只收束：

```text
Setting Layer 应支持某种形式的查询。
查询结果应是结构化的，而不是纯文本匹配。
查询应可 trace。
```

---

## 6. 与 Prompt Builder 的关系

Prompt Builder 不执行搜索。

```text
Agent 运行中:
  -> 调用 search tool
  -> 获得 ToolResult
  -> Runtime 把选中的搜索结果投影给 Prompt Builder
  -> Prompt Builder 编译到 compiled payload
```

Prompt Builder 只消费投影结果，不理解搜索过程。

---

## 7. 搜索策略（候选方向）

不预设完整搜索引擎，只列候选方向：

```text
关键词匹配:
  基于词条的简单匹配。

语义检索:
  基于 embedding 的相似度搜索。

结构化查询:
  按 path / subject / kind / source 过滤。

激活规则:
  类似 ST World Info 的关键词 / 扫描激活。
  但应受控于 Tool 调用，而不是自动触发。

组合策略:
  上述方式的组合。
```

M0 可能只需要关键词匹配和结构化查询。

---

## 8. 非目标

本文件不定义：

- 完整搜索引擎实现；
- 向量数据库选型；
- 完整 World Info 兼容行为；
- 自动激活 / 自动注入策略（这是旧生态混合，应避免）；
- 搜索结果自动塞进 prompt（应通过 Runtime 投影决定）。

---

## 9. 开放问题

1. search tool 是 Studio 内建 Tool，还是由 Extension 提供？
2. Setting Layer 需要提供哪些 query 能力才能支撑 search tool？
3. 搜索结果是否默认进入下一轮 prompt？
4. 搜索命中如何 trace？是否需要记录未命中的 query？
5. 是否支持多轮搜索（search -> 分析结果 -> 再 search）？
6. 私有 / 插件贡献内容是否可被搜索？
7. 搜索结果是否需要裁剪 / 摘要后进入 prompt？
8. 向量检索何时引入？
