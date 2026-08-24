# Agent Tool 数据视图与交互边界 v0

> **状态**：Open Design  
> **主题**：模型调用检索、读取和写入工具时，Loom Studio 应当怎样向模型呈现数据，以及模型怎样与这些数据交互。  
> **边界**：本文讨论 Agent 面向的数据表面与交互语义，不定义最终 Store Schema、搜索引擎、文件同步实现或 Provider Tool 协议。

---

## 1. 定位

Agent 不应直接面对 Loom Studio 的 SQL 表、Prompt Resource Store 或 Prompt Build 内部对象。它需要的是由当前运行模式决定的数据视图，以及作用在该视图上的受控交互能力。

本文回答四个问题：

1. Agent 能发现哪些资源；
2. Agent 主动读取时实际获得什么内容；
3. Agent 写入时修改哪一层数据；
4. 游玩模式与编辑模式为什么使用不同的数据表面。

核心判断：

> Agent 主动读取与 Prompt Build 被动注入是两个正交维度。资源是否已被 Activation 命中、是否拥有 Zone / Slot、是否已经出现在当前上下文，都不决定 Agent 能否读取它。

---

## 2. 两种运行模式

### 2.1 游玩模式

游玩模式面向当前 Narrative、Session / Branch 和已挂载资源。Agent 通过 Loom Studio 提供的检索、读取和写入工具进行交互，不接触真实宿主文件系统，也不直接操作作者源数据。

```text
Canonical / Session Data
  -> Visibility Filter
  -> Resource Materializer
  -> Agent File View
  -> ls / search / read / write
  -> ToolResult / Session Mutation
```

该模式的目标是：

- 防止未授权设定、隐藏剧情和未来章节被枚举；
- 让 Agent 按需拉取当前任务需要的资源，而不是把全部内容塞入初始 Prompt；
- 让主动读取的内容以 ToolResult 出现在当前上下文末端，重新获得注意力；
- 让剧情运行中产生的新知识保存为 Session / Branch 范围的运行时资源。

### 2.2 编辑模式

编辑模式面向作者原始资源。当前角色、预设及其链接资源被物化为真实文件和目录，保留原始宏、Metadata、脚本和二进制载荷。

```text
Loom Canonical Data
  -> Authoring Workspace checkout
  -> 真实文件系统
  -> IDE / Code Agent / CLI 编辑
  -> validate + commit
  -> Loom Canonical Data + Changeset
```

编辑模式不要求外部 Agent 为每次文本修改调用 Loom RPC，也不把 Prompt Build 结果当成作者源数据。普通 IDE Agent 可以使用其原生文件工具完成搜索、重命名、Patch 和脚本编辑。

真实文件系统是编辑工作面，不等于允许 Agent 直接修改 SQLite、Blob Root 或其他内部存储。提交回 Loom 时仍需执行结构校验、引用校验、冲突检查和 Changeset 记录。

---

## 3. 游玩模式的数据视图

### 3.1 Agent File View 是受控资源索引

游玩模式可以向模型呈现类似文件系统的路径、文件名和目录结构，但它是 Loom 资源的受控投影，不是 POSIX 文件系统，也不是 Prompt Resource Store 的原始结构。

索引项至少可以向模型提供：

```ts
type AgentFileIndexItem = {
  path: string
  name: string
  description?: string
  kind: string
  promptState: "injected" | "not-triggered" | "agent-only"
}
```

其中 `promptState` 是当前轮次的运行时观察，不是资源持久化配置：

- `injected`：本轮已由常驻或 Activation 注入；
- `not-triggered`：存在 Activation 条件，但本轮尚未命中；
- `agent-only`：既非常驻，也没有 Activation，因此只能由 Agent 主动读取。

Zone / Slot / Order 只决定资源被动注入时出现在哪里，不参与 Agent 可读性判断。

### 3.2 Agent 读取不是资源的 Delivery KV

资源不需要持久化 `delivery: retrieval-only`、`agentRetrieval: true` 等字段。

被动注入由现有 Prompt 配置决定：

```text
常驻：直接按 Placement 注入。
Activation：条件命中后按 Placement 注入。
两者皆无：不会被动注入。
```

Agent 主动读取则是自由的运行时行为。只要资源已启用、属于当前可访问范围且没有读取锁，Agent 就可以读取：

- 本轮没有触发的资源；
- 本轮已经触发并进入上下文的资源；
- 没有任何被动注入方式的资源。

已经注入的资源仍允许再次读取。这样可以把远离当前上下文末端的内容作为新的 ToolResult 拉回注意力。索引只需要提醒模型该资源已经注入，不应禁止重复读取。

### 3.3 `ls` 的最小视图

首版不需要完整 Shell。`ls` / list 工具只需要提供两种主要范围：

```ts
type ListAgentFilesInput = {
  scope: "untriggered" | "all"
  path?: string
}
```

语义：

- `untriggered`：列出当前可发现、但本轮尚未由 Prompt Build 注入的资源；
- `all`：列出当前全部可发现资源，并标记 `promptState`。

`untriggered` 不是“未读取”，而是“尚未被 Prompt Build 注入”。Agent 是否曾主动读取属于 Session / Tool 调用历史，不需要成为资源 Metadata。

---

## 4. 可发现性与读取权限

“搜索不到”和“不能读取”是两种不同边界。最小访问策略可以使用一个枚举表达，避免堆叠多个相互矛盾的布尔字段：

```ts
type AgentAccess = "listed" | "unlisted" | "sealed"
```

| `agentAccess` | `ls` / 搜索 | 知道路径或 ID 后直接读取 | 典型用途 |
|---|---|---|---|
| `listed` | 可见 | 可以 | 普通设定、记忆和资料 |
| `unlisted` | 不可见 | 可以 | 弱隐藏、用户按需指定的资料 |
| `sealed` | 不可见 | 不可以 | 剧透、未来章节、权限限制 |

### 4.1 `unlisted` 是弱阻挡

`unlisted` 只阻止 Agent 自主发现。用户明确给出资源路径、ID 或可解析引用后，Agent 可以直接读取。

它不是安全边界，不能用于真正需要保密的内容。

### 4.2 `sealed` 是强阻挡

`sealed` 同时阻止枚举、搜索和直接读取。即使对话文本告诉 Agent 具体路径，读取工具也不能自动穿透：

```json
{
  "code": "resource.sealed",
  "message": "该资源当前不可访问"
}
```

需要访问时，应由 Application 层执行明确的解封、章节推进或临时授权。自然语言指令本身不能成为绕过强锁的授权证明。

如果资源已经被 Prompt Build 注入给模型，它在该轮事实上已经可见。因此强锁必须在注入前解除，或者同时阻止该资源被动注入；不能一边发送正文，一边声称模型无权读取正文。

### 4.3 与 `enabled` 的区别

```text
enabled = false:
  资源不进入当前运行环境，不能被 Prompt Build 注入，也不能被 Agent 读取。

agentAccess = sealed:
  资源属于当前环境，但在解封前不能被 Agent 获得内容，也不能被注入。

agentAccess = unlisted:
  资源可以被直接访问，只是不参与 Agent 自主发现。
```

搜索和目录枚举必须先执行可见性裁剪，不能先对所有资源搜索，再从结果中过滤，否则命中数量、摘要和文件名仍可能泄露隐藏内容。

---

## 5. 主动读取的数据语义

### 5.1 游玩模式读取 Materialized 内容

游玩模式读取的不是作者原文，而是当前会话下已经完成基础物化的内容。例如：

```text
作者源数据：
  {{User}}进入了王都。

Agent 在当前会话读取：
  李明进入了王都。
```

该过程复用 Prompt Build 的 Resource Materializer，但不执行完整 Prompt Build：

```text
执行：
  当前 Card / Session 宏解析
  基础文本变换
  权限与可见性裁剪

不执行：
  Activation 扫描
  Zone / Slot / Order 排序
  Message Composition
  其他资源的级联注入
```

主动读取结果作为当前 ToolCall 对应的 ToolResult 写入 Agent Session。资源原本位于 Prompt 的哪个位置，对这个 ToolResult 不再有意义。

### 5.2 编辑模式读取原始内容

编辑模式中的文件保留作者原始表达：

```text
{{User}}进入了王都。
```

编辑 Agent 可以同时看到资源正文、Metadata、Activation、Placement 和链接关系，并按作者语义修改它们。

Prompt Build 物化结果不可逆。系统不能把游玩模式中出现的“李明”自动反推回 `{{User}}`，因此游玩写入和作者源数据修改必须保持不同目标。

---

## 6. 游玩模式写入

### 6.1 默认写入运行时资源

游玩 Agent 默认写入 Session / Branch 范围的剧情知识，而不是修改作者的 canonical Setting 或 Prompt Resource。

写入内容保存当前剧情中的实际值：

```text
李明答应在三天后返回王都。
```

不要求 Agent 写回 `{{User}}`，也不执行宏反推。

### 6.2 新资源的最小默认行为

首版新建资源只需要满足：

```text
enabled = true
非常驻
没有 Activation 条件
没有 Agent 读取锁
scope = 当前 Session / Branch
```

因此它不会被程序被动注入，只能由 Agent 后续通过 `ls`、搜索或直接读取再次获得。这个行为由现有配置缺省自然产生，不需要额外的 `retrieval-only` KV。

Placement 与读取权限无关。即使资源拥有 Zone / Slot，只要它既非常驻也没有 Activation，就不会被动注入；Placement 只在未来配置了注入方式后才生效。

### 6.3 写入结果

写入工具应返回确定性的资源引用，而不是把整个文件再复制进上下文：

```ts
type AgentWriteResult = {
  resourceId: string
  path: string
  revision: string
  created: boolean
}
```

成功写入形成可审计的 Session Mutation / Changeset。以后需要把运行时知识提升为角色或世界 canonical 资源时，应使用独立的 Promote 操作，而不是让普通游玩写入静默跨越作用域。

---

## 7. 编辑模式的真实文件系统

编辑模式不复用游玩模式的虚拟 Tool 文件视图。它为作者和外部 Code Agent 提供真实 Authoring Workspace，例如：

```text
character-li-ming/
├── character.json
├── settings/
│   └── capital/
│       ├── resource.json
│       └── content.md
├── scripts/
│   └── update-reputation.js
└── assets/
    └── portrait.png
```

其中：

- `resource.json` 保存作者可编辑的资源 Metadata；
- 正文、脚本和数据使用真实扩展名；
- 二进制资源以真实文件出现；
- Loom 内部 ID 和链接关系必须能够稳定 round-trip；
- 外部工具不需要理解 Prompt Build 才能编辑文件。

为了避免数据库与文件系统形成持续竞争的双权威源，首版优先使用有边界的 checkout / commit：

1. 创建编辑工作区时物化当前 revision；
2. 编辑期间由真实文件系统承载工作副本；
3. commit 时统一校验并写回 canonical data；
4. revision 冲突时拒绝静默覆盖；
5. 成功提交后形成 Changeset。

是否需要长期双向文件监听和增量同步，留到出现真实消费者后再决定。

---

## 8. 模型与数据交互的最小闭环

### 8.1 游玩模式

```text
模型
  -> ls(untriggered | all)
  -> search(query)
  -> read(path | resourceId)
  -> 获得 Materialized ToolResult
  -> 完成推理、写正文或写入运行时资源
  -> write / patch
  -> 获得资源引用与 revision
```

### 8.2 编辑模式

```text
模型 / IDE Agent
  -> 读取真实作者文件
  -> 使用原生 search / patch / move / script
  -> Loom validate + commit
  -> canonical data + Changeset
```

这两个模式共享资源身份和 Application 校验，但不共享同一种模型交互表面。

---

## 9. 与现有文档的关系

- [`retrieval-search-v0.md`](retrieval-search-v0.md) 定义 Retrieval / Search 是 Tool / Capability 的子能力；本文进一步定义搜索前的可见性裁剪、读取内容形态和 `ls` 视图。
- [`tool-capability-v0.md`](tool-capability-v0.md) 定义 ToolCall / ToolResult 与受控 Mutation；本文收束资源读取和运行时写入时的数据契约。
- [`permission-consent-v0.md`](permission-consent-v0.md) 定义权限和确认边界；本文补充 `listed / unlisted / sealed` 三种 Agent 读取语义。
- [`../../../plans/file-backed-resource-agent-script-codeact-plan.md`](../../../plans/file-backed-resource-agent-script-codeact-plan.md) 讨论文件型资源、Agent Script 和 CodeAct 的持久化与执行；本文只讨论这些资源在模型面前怎样呈现和交互。

如与早期 Retrieval 讨论中“搜索结果再由 Runtime 决定是否投影”存在表述差异，以本文的主动读取闭环为当前讨论结论：成功的读取结果作为 ToolResult 进入当前 Agent Session，并供后续模型调用消费。

---

## 10. 非目标

本文暂不定义：

- 最终 TypeScript / SQL Schema；
- 搜索使用关键词、全文索引还是 Embedding；
- `ls` 是否使用 Shell 字符串或 JSON Function Tool；
- 二进制资源的视觉理解和 Artifact 返回协议；
- 真实 Authoring Workspace 的 watcher、锁和清理机制；
- CodeAct Sandbox、Node Host 和 Capability API；
- Provider 原生 Tool、Content Tool、Custom Tool 的 Transport 差异；
- Runtime 资源 Promote 到 canonical Setting 的 UI 流程。

---

## 11. 仍需确认的问题

1. `unlisted` 的直接引用只接受稳定 Resource ID，还是同时接受规范化路径；
2. `sealed` 的解封来自章节 Activation、用户临时授权，还是两者都支持；
3. Session / Branch 运行时资源是否需要在分支合并时提供显式冲突策略；
4. `ls(all)` 是否展示最近主动读取时间，还是只显示本轮 Prompt Build 状态；
5. 编辑工作区首版采用一次性导出 / 导入，还是保留显式 checkout / commit Session。
