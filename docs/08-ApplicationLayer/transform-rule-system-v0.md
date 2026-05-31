# Transform Rule System v0

> **状态**：Open Design  
> **主题**：Regex / Transform 规则系统，包括作用阶段、权限、trace 和 rollback。

---

## 1. 核心判断

Regex 不应是一个孤立功能。它应该归入 Transform Rule System。

Transform Rule 是在特定阶段、对特定对象、按特定权限执行的内容变换规则。

```text
Transform Rule:
  在哪个阶段（phase）
  对什么对象（target）
  按什么匹配规则（matcher）
  执行什么变换（transformer）
  产生什么副作用（side effects）
  是否可 trace / rollback
```

---

## 2. 为什么不能只叫 Regex

Regex 只是 matcher / transformer 的一种实现方式。

实际需要的内容变换可能包括：

```text
正则替换
模板渲染
格式转换
字段提取
内容清洗
结构化解析
```

但这些不应该在任意位置运行。

---

## 3. Transform Phase

Transform Rule 必须在受控阶段中执行，不能随处运行。

候选阶段：

```text
Input Transform:
  用户输入进入 Runtime 前。
  例如：清洗输入、提取指令、格式化。

Transcript Transform:
  Agent 工作消息处理。
  例如：清洗 provider 输出、提取结构化内容。

Prompt Transform:
  Prompt Builder 输出前后。
  例如：替换变量、注入标记、裁剪。

Provider Response Transform:
  Provider 返回后进入 Runtime 前。
  例如：清洗输出、提取 tool call、格式化。

Commit Transform:
  Narrative commit 前校验 / 清洗 / 改写。
  例如：格式校验、风格统一、敏感内容过滤。

State Extraction Transform:
  从输出中提取状态候选。
  例如：从剧情文本中提取角色状态变化。

Import Transform:
  旧生态数据导入时转换。
  例如：ST 角色卡字段映射、World Info 格式转换。

Display Transform:
  只影响 UI 展示，不改 canonical data。
  例如：语法高亮、格式化显示。
```

每条规则必须声明它属于哪个 phase。Runtime 只在该 phase 执行对应规则。

---

## 4. 规则属性

每条 Transform Rule 应至少明确：

```text
phase:
  在哪个阶段执行。

target:
  对什么对象执行。
  例如：user input、agent message、provider response、commit candidate。

matcher:
  匹配规则。
  例如：regex pattern、keyword、structure condition。

transformer:
  变换逻辑。
  例如：regex replace、template render、field extraction。

side effects:
  是否产生副作用。
  只读变换 vs 写入变换。

trace behavior:
  变换是否进入 trace。
  原始内容是否保留。

rollback behavior:
  变换是否可回滚。

permission:
  执行需要什么权限。
```

---

## 5. 安全边界

必须避免：

```text
任何地方都能跑 regex:
  规则必须在受控 phase 中执行。

任何 regex 都能改 prompt / narrative / state:
  写入类 transform 需要更高权限。

regex 静默改写 canonical data:
  变换必须可 trace。
  影响 canonical data 的变换必须记录原始内容。

无限递归 transform:
  规则执行必须有终止条件。
```

---

## 6. 与 Agent 的关系

Transform Rule 不是 Agent 专有概念。

```text
Agent 可能触发 Transform Rule:
  Agent 产出经过 commit transform phase。
  Agent 请求经过 input transform phase。

但 Transform Rule 不只服务 Agent:
  Import transform 不需要 Agent。
  Display transform 不需要 Agent。
```

---

## 7. 与 Extension 的关系

Extension 可以贡献 Transform Rule。

```text
manifest declares:
  contributes.transformRules: [...]

规则进入指定 phase。
遵循 Transform Rule System 的作用域和权限。
Rule 执行进入 Trace。
```

详见 [`extension/airp-extension-contribution-v0.md`](extension/airp-extension-contribution-v0.md)。

---

## 8. M0 候选

M0 可能只需要：

```text
Provider Response Transform:
  基本的输出清洗。

Commit Transform:
  基本的格式校验。

Display Transform:
  UI 展示层替换。
```

复杂的 regex chain、state extraction transform、import transform 可以延后。

---

## 9. 非目标

本文件不定义：

- 完整规则引擎实现；
- 规则优先级和冲突解决机制；
- 规则的 schema；
- 规则的 UI 编辑器；
- 规则的测试框架；
- 与 ST regex script 的兼容行为。

---

## 10. 开放问题

1. Transform Rule 是否需要版本控制？
2. 规则执行顺序如何确定？按注册顺序、priority、还是 phase 内固定？
3. 规则冲突如何检测和解决？
4. 哪些 phase 的规则允许修改 canonical data？
5. Import Transform 是否需要单独文档？
6. Display Transform 是否归入 Frontend Projection 文档？
7. 规则执行错误如何处理：跳过 / 终止 / 通知用户？
8. ST regex script 如何映射到 Transform Rule System？
