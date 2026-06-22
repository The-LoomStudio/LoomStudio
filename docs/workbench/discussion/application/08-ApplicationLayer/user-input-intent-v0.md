# User Input Intent v0

> **状态**：Open Design  
> **主题**：用户输入分类、指令与剧情内容的区分、交互层设计。

---

## 1. 核心问题

在 Agent runtime 下，用户输入可能是：

```text
剧情内容:
  "我的角色说：'你好，好久不见。'"
  "一阵寒风吹过，远处的山峦隐没在雾中。"

操作指令:
  "继续写"
  "重写上一段"
  "让女主角更主动"
  "不要提交，先草拟"

检索请求:
  "查一下 Alice 的当前心情"
  "回顾之前的剧情"

状态修改:
  "把时间切换到晚上"
  "Alice 离开房间"

系统操作:
  "换一个预设"
  "撤销上一次操作"
```

这些不是同一种东西，但传统 chat 产品通常把它们都当作 `user message` 处理。

---

## 2. 当前已收束方向

### 2.1 用户输入不总是剧情内容

用户输入可能进入 Runtime Transcript 作为 instruction，也可能同时进入 Narrative Timeline 作为剧情内容。

```text
用户输入:
  -> Runtime Transcript（总是）
  -> Narrative Timeline（如果是剧情内容）
```

### 2.2 区分不是硬分类

不预设硬编码 intent 分类。

更稳的方向是：

```text
用户输入默认进入 Runtime Transcript。
是否也进入 Narrative Timeline 由 Runtime / Agent / Policy 决定。
```

这避免了过早分类，同时保留了灵活性。

---

## 3. 与交互层的关系

User Input Intent 是偏交互层的问题。

它涉及：

```text
UI:
  输入框如何设计。
  是否有模式切换（对话模式 / 指令模式）。
  是否有快捷指令。

Runtime:
  不同类型的输入如何路由。
  是否影响 Agent 行为。

Narrative Timeline:
  哪些用户输入成为作品正文的一部分。
```

---

## 4. 候选方向

### 4.1 单一输入框 + 隐式分类

```text
用户在同一个输入框输入。
Runtime / Agent 判断输入是剧情内容还是指令。
不需要用户手动选择模式。
```

优点：简单，不增加用户认知负担。

缺点：Agent 可能误判。

### 4.2 模式切换

```text
用户选择当前输入模式：
  - 对话模式（默认进入 Narrative）
  - 指令模式（只进入 Transcript）
```

优点：明确，不依赖 Agent 判断。

缺点：增加用户操作步骤。

### 4.3 标记语法

```text
用户通过标记区分：
  普通文本 -> 剧情内容
  /command -> 指令
  {{variable}} -> 绑定引用
```

优点：灵活，不需要模式切换。

缺点：需要学习标记语法。

M0 不需要确定最终方案，只需保证架构上支持多种交互方式。

---

## 5. 与 Narrative Timeline 的关系

如果用户输入是剧情内容（例如角色对白），它应进入 Narrative Timeline。

```text
用户输入 -> 判断是剧情内容
  -> Runtime Transcript append user instruction
  -> Narrative Timeline append user dialogue / narration
```

如果用户输入是指令，它只进入 Runtime Transcript。

```text
用户输入 -> 判断是操作指令
  -> Runtime Transcript append user instruction
  -> Narrative Timeline 不变
```

---

## 6. 非目标

本文件不定义：

- 完整 intent classification 系统；
- NLU / intent parsing 实现；
- UI 具体设计；
- 快捷指令 schema。

---

## 7. 开放问题

1. M0 采用哪种输入方式？单一输入框 + 隐式分类？
2. 用户输入是否总是先进入 Runtime Transcript？
3. 角色扮演对话中，用户输入是否默认同时进入 Narrative Timeline？
4. 是否需要用户手动标记"这是指令"？
5. 指令输入是否可以触发 Runtime Policy 操作（例如中止、重试）？
6. 用户输入经过 Input Transform phase 后是否改变其 intent？
