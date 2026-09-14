# Agent Tool 数据视图与交互边界 v0

> **状态**：Open Design  
> **讨论更新**：2026-09-14。读取侧方向已明确；CTX 签名、写入提交和变更消费仍未冻结。
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

面向模型的索引默认返回文本文件树，不把内部资源对象序列化成大型 JSON：

```text
/settings/alice/
├── README.md
├── base.md       [injected]
├── voice.md      [not-triggered]
└── stages/
```

根路径、目录层级和真实文件名足够模型推导可调用路径，不逐项重复 name、path 和数据库 ID。平台内部仍保留稳定资源身份与路径映射，路径不是数据库身份。

LS 不返回 description 或自动摘要，也不为此新增逐条 Metadata。资源用途、阅读顺序、阶段说明和调用教程由作者集中写在普通 `README.md` / `doc` 文件中；它们按普通文件读取，不因名字自动获得注入或权限。

注入标记是当前轮次的运行时观察，不是资源持久化配置：

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

#### 3.2.1 Agent Pin：持续上下文挂载

2026-09-09 讨论补充：Pin 是面向 Agent 的工具操作，不是 State 专属能力，也不是修改作者资源的 `enabled + 常驻` 配置。以下是待实施的语义建议，不代表当前 Runtime 已支持持久 Pin。

作者配置的常驻文本按资源原有 Placement 注入。Agent Pin 则请求把一份可读取的文本持续放入独立的 Agent 固定区；原始正文、Activation 和 Placement 不因此改变。固定区仍由 PromptBuild 编排，不绕过预设直接拼接一条具有特殊优先级的 Provider Message。

Pin 保存的是运行时挂载关系，不是第二份正文，也不需要先建设一个专用 KV Store。持久化应复用现有数据和提交机制；具体载体在实施时确定。“不新增 KV”不等于把关系只放在内存或 ToolResult 里：若承诺总结后仍保留，就必须能从持久关系重建固定区。

Pin / Unpin 分别建立和解除该关系，Unpin 不删除源文本、不关闭作者原有注入方式。Pin 不授予新的读取权限，不能绕过未启用、不可访问或 sealed 边界；它只独立于关键词等被动 Activation 的命中情况。

固定区可以接收已有文本，也可以接收 Agent 新建的持久文本记录。State 的默认投影仍按自身规则裁剪；Agent 可以读取某个实体后写成目标或线索记录，再固定该记录，不要求提供“固定整个 State 实体”的工具。记录中的历史观察不自动成为最新 State 事实。

Pin 的归属应按 Agent 上下文讨论，不能仅因源文本来自 Timeline 就认定 Pin 也属于 Timeline。建议先以 Agent Session 为边界；跨 Session 共享、Narrative Branch 切换后的关联处理、源文本使用当前版本还是固定版本、与常规注入的重复内容处理，仍需在实施前确认。

预算不足不能静默丢弃固定项；固定内容失效或不可读取时也不能静默回退到一份旧正文。具体提示与整理策略尚未定义。本节不新增 KV Schema、工具 API、Anchor ID 或统一生命周期管理器。

相关数据边界见 [数据能力与运行内容](../data-capabilities-and-runtime-content.md)。普通主动读取的即时 ToolResult、短期 Fresh Context 与持续 Pin 是不同生命周期，不相互隐式转换。

### 3.3 `ls` 的最小视图

首版不需要完整 Shell。以目录路径限定范围，默认只展开一层，不默认倾倒整棵资源树。大目录需要明确的截断提示与继续查看方式，具体分页参数尚未确定。

`ctx.ls("/settings/alice")` 只是调用示意，不是冻结的 API。返回只包含路径结构与必要运行时状态；普通可读项不必重复标记 available。

旧提案的 `scope: untriggered | all` 不再作为必需调用参数。后续若确有筛选需求，再确定参数；“未注入”始终不等于“未读过”。

Settings 在本讨论中指作品设定、提示条目及自定义注入内容，不等于应用 Preferences。Settings 读多写少，State 常见流程是读取当前值后更新。两者可以共享按路径发现和读取的体验，但不因此认定拥有相同写入参数或存储语义。

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

### 4.4 可见但上锁的条目

2026-09-14 补充：需要支持“允许知道存在，但当前不允许读正文”的呈现方向：

```text
/settings/alice/stages/
├── README.md
├── acquaintance.md [injected]
└── friend.md       [locked]
```

它不同于上文同时隐藏存在性的 sealed。不能为此把所有隐藏条目列成 locked；是否允许公开名字由访问策略决定。如何扩展现有访问枚举、谁解锁及是否提供单独过渡文档，尚未冻结。

注入状态与读取锁是不同维度。未触发不代表上锁；已注入也不代表当前阶段或正文必然最新。不得由标记反推出运行时没有提供的业务事实。

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
4. 是否提示自上次读取后的变化，以及读取基线、物化上下文和压缩后可见性的追踪范围；
5. 编辑工作区首版采用一次性导出 / 导入，还是保留显式 checkout / commit Session。

## 12. 通用 CodeAct 读取侧讨论收束

本节记录 2026-09-14 的讨论方向，不授权实现通用 Sandbox 或更换领域存储。

- 读取侧体验实验见 [Playground 冷启动实验](../../../../../apps/playground/CODEACT-EXPERIMENT.md)。使用独立子 Agent 体验多卡挂载、README 导航和动态门控；实验签名不等于正式合同。
- CodeAct 提供统一执行入口；具体能力教程可以作为 Prompt Resource、README 或 Skill，按条件注入或由 Agent 主动读取。教程生命周期与执行权限分离，移除教程不等于撤销权限。
- 面向模型的输出优先是文件树、路径匹配和正文；不默认输出完整内部 JSON 对象。代码内部的数据形态与最终模型输出不是同一个合同，暂不要求脚本解析树形文本来完成批处理。
- LS 负责目录和动态状态；Search 负责定位；Read 负责正文；README 负责解释。不新增每条资源必填 description，不替作者生成强制阅读分类。
- Search 可返回路径和行号；允许显示内容时才返回少量匹配文本。可见但锁定的文件不能通过搜索片段泄露正文。
- Read 的必要状态提示与正文分离，不能让编辑代码误把工具文件头写回资源。返回值、显示方式及正文提取签名仍待确定。
- 游玩读取是当前上下文的物化结果，编辑读取是作者源文件；相同源版本也可能因 State、宏或上下文变化产生不同正文。历史 ToolResult 不会自动变成最新内容，注入状态也不能仅凭 Session 是否压缩判断。
- Agent 可从 LS 树、Search、README 引用或已有上下文获取路径，不要求每次读前机械执行 LS/Search；修改已有内容仍需有可靠读取基线。新建资源的目标发现和写入语义另行讨论。
- 运行时负责权限、稳定 ID 映射和并发校验。不要求模型反复抄写数据库 ID；是否自动关联读取版本、基线保存多久尚未确定。

此前示例中的 State set/delta 统一 write 参数、自动暂存提交、持久 JS 上下文、暂停后恢复同一执行现场，均不是本轮已确认合同。CodeAct 输入传输、执行生命周期与写入语义继续单独讨论。

## 13. 变更查看：候选消费方式与现有基础

### 13.1 候选交互，未冻结

LS 可以附带简短修改标记，但不展开完整 Diff。独立 Status 汇总新增、修改、删除；Diff 按目标展示差异。删除项适合出现在 Status，不必作为当前文件继续挂在 LS。

仅当有明确比较基准时才能标记 modified。当前写入批次、上次读取、指定历史版本是三种不同基准，不能混用；具体命令名、参数、提交时机和保存期限未定。

典型消费者：

- 编辑 Agent 在批量修改后核对范围及意外删除；
- Agent 接手用户或其他执行者的修改，检查与自己旧观察的差别；
- 游玩 Agent 排查 State 重复增减或追溯某次状态变化；
- 用户要求对比旧版本、解释修改或回退之前，先读取有证据的历史差异。

普通续写若只需当前事实，不默认读取 Diff，更不要求每轮消费完整变更历史。用户展开 Session 写入统计与 Agent 主动读 Diff 可以复用变更数据，但不是同一个调用流程。

### 13.2 2026-09-14 源码核对

以下仅是静态源码证据，不代表本轮运行测试或已有 CodeAct 命令：

- `packages/document-store/src/sqlite-store.ts`：持久化 document_revisions，支持按版本读取与 revertChangeset；回退对混入非 Document 操作的 Changeset 有限制。
- `packages/application-data/src/prompt-resource/schema.ts`、`mutations.ts`：保存节点和资源头的 before/after Revision，并有带版本检查的回退路径。
- `packages/application-data/src/state/types.ts`、`store.ts`：StateRevision 包含父 Revision、snapshot、operations、changesetId；支持读取和列出 Revision。
- `packages/application-data/src/narrative/types.ts`、`store.ts`：有分支、正文节点父链和 State Revision 指针；但 editNode 原地更新 body，仅记录更新操作，没有在该路径保存正文编辑前后的独立 Revision。因此分支不等于历史正文快照。
- `packages/data-engine/src/sqlite.ts`：共享事务和 Changeset 记录提供提交事实；操作记录本身不保证每个领域都保存可还原的旧内容。

结论：已有部分领域版本与回退基础，不是从零开始；尚不能宣称拥有统一的全工作区 Git 式存档点、任意历史文件树比较或全领域回退。通用 VFS Status/Diff 仍需连接这些能力，并明确各资源能提供的比较范围。

## 14. Skills 复用预设锚点

2026-09-14 确认：不另建 Skill 系统。预设作者可以提供专门的 Skills 锚点，并通过锚点周围的提示词说明这里挂载的是可按需使用的教程。

- 顶层常驻的是 Skill 名称、用途说明与入口路径，不是整个教程目录的全部内容。
- 角色自有世界书和外部世界书均可通过现有 Prompt Resource 挂载机制贡献入口；来源使用各自的 VFS 路径区分，不默认只允许一个来源。
- 详细教程和附属资料仍是普通可读文件。Agent 根据任务读取；需要持续参照时可使用 Pin，不新增模型侧 loadSkill 工具、Skill 注册器或专用权限系统。
- Skill 的用途说明属于常驻锚点中的提示内容，不要求所有普通资源新增 description，也不把说明搬回 LS。
- 常驻说明可以集中在作者文档中维护；不要求同时维护另一份目录 Metadata，也不在此冻结锚点 ID、文件名或描述字段格式。
- “有入口”“已读教程”“持续 Pin”是三件事；Pin 文件不递归加载目录，移除 Pin 也不删除历史 ToolResult。

边界：专门的 Skills 锚点不是 Provider 顶层 tools，也不因名称自动获得更高指令优先级或写入权限。外部来源必须先在当前范围内获得挂载与访问资格。

默认轻小说文风、战斗教程和衣物教程如何组合，先由预设与教程明确适用场景和冲突处理，不实现按读取先后自动覆盖。若以后要求确定性的文风模式切换或整组挂载生命周期，再单独讨论现有机制是否足够。

深层目录优先由教程给出准确相对引用，模型换算为绝对 VFS 路径；大组件的局部读取、长图遍历、多个教程相互引用等尚未由小型 Playground 验证，不把当前例子视为复杂场景的完整验证。
