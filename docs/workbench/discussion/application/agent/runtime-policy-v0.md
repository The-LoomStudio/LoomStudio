# Runtime Policy v0

> **状态**：Open Design  
> **主题**：Agent 运行策略、loop 控制、retry / stop / discard / commit policy。

---

## 1. 定位

Runtime Policy 控制 Agent 的运行过程。

```text
Agent Model:
  定义 Agent 是什么、能做什么。

Runtime Policy:
  定义 Agent 的运行如何推进、停止、重试、丢弃和提交。
```

Runtime Policy 不等于 Agent Model，但属于 Agent 领域。

---

## 2. 核心问题

> Agent 的一次 Run 从开始到结束，由什么规则控制？

需要避免两个极端：

```text
极端 A:
  没有任何 policy，Agent 无限循环或任意停止。

极端 B:
  过度工程化的状态机，每种 step 都有独立 policy class。
```

---

## 3. 当前已收束方向

### 3.1 Run 是受控执行实例

Run 不是无限制循环。

```text
Run:
  一次 Agent runtime 执行实例。
  有开始条件、推进规则和结束条件。
```

### 3.2 失败 run 可以丢弃

因为 Agent 工作过程和剧情产出分离，Runtime 可以丢弃一次失败运行：

```text
discard 条件（候选）:
  - Agent 幻觉 / 输出质量差
  - 子 Agent 死循环
  - 工具调用错误
  - 超时
  - 用户手动中止
  - 超过最大步数
```

丢弃时不污染 Narrative Timeline，除非已有 commit 被接受。

### 3.3 Commit 不自动发生

Agent 产出不自动写入 Narrative Timeline。

```text
commit 是受控操作:
  - 由 Runtime 根据 policy 决定是否 commit
  - commit 可能需要用户确认
  - commit 结果写入 Narrative Timeline
  - commit 关联 trace / audit
```

---

## 4. 候选 Policy 维度

不预设完整 policy schema，只列出需要讨论的维度。

### 4.1 推进控制

```text
max steps:
  单次 Run 最多执行多少步。

timeout:
  单次 Run 最大执行时间。

step 触发:
  什么条件下继续下一步。

loop 停止:
  什么条件下结束 Run。
```

### 4.2 错误处理

```text
provider error:
  重试 / 换 provider / 终止 / 通知用户。

tool error:
  重试 / 跳过 / 终止 / 通知用户。

commit error:
  回滚 / 重试 / 终止。

state mutation error:
  回滚 / 跳过 / 终止。
```

### 4.3 丢弃策略

```text
discard 触发:
  什么条件下丢弃当前 Run。

discard 范围:
  丢弃整次 Run transcript。
  保留哪些 audit / diagnostics。
  已 commit 的 narrative 是否回滚。
```

### 4.4 Commit 策略

```text
commit 触发:
  Agent 显式调用 commit tool。
  还是 Runtime 自动判断是否 commit。

commit 确认:
  是否需要用户确认。
  哪些情况自动确认。
  哪些情况必须用户确认。

commit 模式:
  append / patch / replace。
```

### 4.5 重试策略

```text
retry 触发:
  provider error。
  tool error。
  输出质量差。
  用户手动要求重试。

retry 边界:
  重试是否重新开始 Run。
  重试是否保留之前 transcript。
  最大重试次数。
```

---

## 5. 与 Runtime Transcript 的关系

Runtime Policy 决定 transcript 如何增长和清理。

```text
transcript 增长:
  每个 step 可能追加 entries。
  tool call / tool result 追加。
  错误信息追加。

transcript 清理:
  丢弃 run 时 transcript 如何处理。
  重试时之前 transcript 是否保留。
  commit 后 transcript 是否裁剪。
```

---

## 6. 与 Prompt Builder 的关系

Prompt Builder 不理解 Runtime Policy。

```text
Runtime Policy 决定:
  - 是否继续 loop
  - 是否 commit
  - 是否丢弃
  - 是否重试

Prompt Builder 只负责:
  编译当前 step 需要的上下文投影。
```

---

## 7. M0 候选

M0 可能只需要：

```text
max steps 限制
timeout 限制
用户手动中止
commit 需要用户确认（可配置自动）
discard 不影响 narrative
```

---

## 8. 非目标

本文件不定义：

- 完整状态机或 workflow engine；
- Agent step 的硬编码分类；
- Policy 的 schema；
- Policy 与 Kernel 的关系（Kernel 不认识 policy）；
- 子 Agent 的 policy 委派协议。

---

## 9. 开放问题

1. Runtime Policy 是配置、代码还是 rule system？
2. Policy 是否可以由 Preset / Card / Session 覆盖？
3. 子 Agent 是否继承父 Agent 的 Policy？
4. Policy 是否支持动态调整（例如运行中修改 max steps）？
5. 丢弃 run 后的 audit / trace 保留策略是什么？
6. 用户确认 commit 的 UI 交互如何设计而不阻塞 agent loop？
7. 什么情况允许自动 commit 而不需要确认？
