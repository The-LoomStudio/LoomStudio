# Permission / Consent v0

> **状态**：Open Design  
> **主题**：Agent 权限、确认策略、安全边界。

---

## 1. 定位

Permission / Consent 控制 Agent 能做什么。它属于 Agent 领域。

```text
Agent:
  有能力做很多事。

Permission:
  决定 Agent 被允许做什么。

Consent:
  决定某些操作是否需要用户确认。
```

---

## 2. 核心问题

> Agent 可以 commit narrative、修改状态、调用外部工具、读取私有内容。这些操作需要什么层级的授权？

---

## 3. 需要控制的操作类别

### 3.1 读取

```text
读取 Setting Layer:
  哪些 setting entries 对 Agent 可见。
  私有 / 插件贡献内容是否可读。

读取 Narrative Timeline:
  哪些剧情内容对 Agent 可见。
  被丢弃 run 的内容是否可读。

读取 Memory / Summary:
  哪些记忆对 Agent 可见。
```

### 3.2 写入

```text
commit narrative:
  Agent 是否被允许写入 Narrative Timeline。
  是否需要用户确认。

state patch:
  Agent 是否被允许修改 Setting Layer。
  是否需要用户确认。

memory write:
  Agent 是否被允许写入 / 更新记忆。
  是否需要用户确认。
```

### 3.3 工具调用

```text
只读工具:
  默认允许。

写入工具:
  需要明确权限。

外部效果工具:
  需要明确权限和 audit。
  可能需要用户确认。
```

### 3.4 子 Agent

```text
子 Agent 是否继承父 Agent 权限。
子 Agent 权限是否可以缩小。
子 Agent 是否可以委派更深层的子 Agent。
```

---

## 4. 确认策略

不是所有操作都需要用户确认。

候选分级：

```text
auto:
  自动执行，不需要确认。
  例如：search、read setting、read narrative。

confirm:
  需要用户确认后执行。
  例如：commit narrative、state patch。

deny:
  不允许执行。
  例如：超出权限范围的操作。
```

哪些操作属于哪个分级，由 Agent 配置 / Policy / 用户偏好决定。

---

## 5. 与 Runtime Policy 的关系

Runtime Policy 决定运行推进，Permission 决定操作许可。

```text
Runtime Policy:
  "继续还是停止？"

Permission:
  "你被允许做什么？"
```

两者交叉：

```text
Runtime Policy 说继续下一步。
Permission 说这一步的工具调用需要确认。
-> 暂停运行，等待用户确认。
```

---

## 6. 与 Kernel Capability 的关系

Kernel 有自己的 Capability 系统（capability grants）。

但 Kernel 不理解 Agent、Tool、Commit 的语义。

```text
Kernel Capability:
  控制哪些 Extension 可以注册哪些 RPC。
  控制哪些操作需要什么权限。

Application Permission:
  在 Kernel Capability 之上，定义 Agent 领域的权限语义。
  例如：Agent 是否可以 commit narrative。
```

Application Permission 最终可能通过 Kernel Capability 实施，但语义层在 Application。

---

## 7. 非目标

本文件不定义：

- 完整 RBAC / ABAC 系统；
- Kernel Capability 的扩展；
- Sandboxing / isolation 机制；
- 用户认证 / workspace unlock（这是平台安全层）；
- Provider API key 管理。

---

## 8. 开放问题

1. Permission 是 Agent 配置的一部分，还是全局 Policy？
2. 用户如何配置 Agent 权限？
3. 子 Agent 权限委派的粒度？
4. 确认操作的 UI 如何设计而不频繁打断 Agent loop？
5. 是否支持临时提权（一次确认后后续同类操作自动允许）？
6. Agent 越权操作如何处理：静默拒绝 / 报错 / 通知用户？
7. 权限变更是否影响正在运行的 Agent run？
