# File-backed Resource、Agent Script 与 CodeAct 实施计划

> **状态**：提案，等待实施切片确认
> **日期**：2026-08-24
> **范围**：从非 Prompt、文件型 Workspace Resource 的持久化开始，建立 Agent Script Definition、Card / Preset / Agent Profile / Session 挂载、角色包导入导出、受控 JavaScript Runtime，以及 CodeAct inline / resource 两种执行模式。
> **事实边界**：本文是 Workbench Plan，不是已实现 Architecture。当前已实现 Document Store、共享 SQLite Data Engine、内容寻址 Blob Store、Source Artifact、Media Asset、Agent Tool Registry、Content Tool 与 Agent Loop；通用 File-backed Resource、Agent Script、Script Mount、Sandbox Host 和 CodeAct 尚未实现。
> **2026-08-25 Bundle 边界补充**：Preset / Setting 的增强分发不建立通用 Package 领域实体或递归依赖图。未来 Bundle 必须拥有唯一主体，导入后仍回到 Preset / Setting / Card canonical state；附件关系、运行时 Mount 与外部 Requirement 保持分离。详见 [`typed-primary-resource-bundle-plan.md`](./typed-primary-resource-bundle-plan.md)。

## 1. 决策摘要

Loom Studio 不按“文本 / 二进制”划分持久化边界，而按“结构化业务事实 / 原始载荷”划分：

```text
SQLite / Document Store
  -> Resource identity、类型、版本、权限、关系、Mount、Changeset

Blob Store
  -> 不可变原始字节，包括 JS、Markdown、TXT、JSON、图片、音频
```

Agent Script 采用“结构化描述 + Blob 源码”模型：

```text
AgentScript Document
  -> name / description / runtime / schema / requested capabilities
  -> source.blobId

Blob Store
  -> exact JavaScript source bytes
```

资源在底层继续按稳定 ID 平铺。Card、Preset、Agent Profile 和 Session 不复制源码，通过 SQL 关系或 Script Mount 链接资源。UI 中的角色文件夹或会话资源树只是关系投影，不是运行时权威文件目录。

CodeAct 使用一套 canonical executor，但支持两种互斥调用模式：

```ts
type CodeActInvocation =
  | { mode: 'inline'; source: string; input?: JsonValue }
  | { mode: 'resource'; scriptId: string; version?: number; input?: JsonValue }
```

- `inline`：模型现场编写，一次性执行，不保存；
- `resource`：执行角色作者、Preset 作者、插件或用户预制的持久化 Agent Script。

两种模式共用同一个隔离 Runtime、Capability、Tool Registry、执行记录和结果协议。脚本只能通过显式注入的 Loom API / Tool Executor 操作领域数据，不能直接访问 SQLite、Blob Root 或任意本机路径。

## 2. 当前实现事实

### 2.1 数据底座已经具备

当前 [`packages/blob-store`](../../../packages/blob-store) 已实现：

- stream / bytes 写入；
- staging file；
- SHA-256 内容寻址；
- 相同字节去重；
- 文件系统保存载荷、SQLite 保存 Blob metadata；
- 大小限制和受控读取；
- 不向业务层暴露物理路径。

当前 [`packages/document-store`](../../../packages/document-store) 已实现：

- typed JSON Document；
- optimistic concurrency；
- Document Revision；
- Changeset、Data Commit Fact；
- tombstone、restore 和 Document-only revert；
- 与共享 SQLite Data Engine 的事务协作。

当前 [`packages/asset-store`](../../../packages/asset-store) 已经采用：

```text
SQL Asset / Artifact descriptor
  -> blobId
  -> Blob Store bytes
```

因此本计划不新增第二套文件仓库，不把角色、Card 或 Session 映射成真实运行时目录，也不把用户文件名作为内部物理路径。

### 2.2 当前 Agent Tool 链可以复用

现有 Agent 基建已经具备：

- Workspace Tool Definition；
- Tool Registry 与 Runtime Registration；
- Native Function / Provider Custom / Content Transport；
- ToolInvocation / ToolResult；
- Approval、Validation、Execution；
- Agent Loop、Provider Observation 与 Transcript 持久化；
- Preset Tool Mount 与 Agent Profile 快速开关方向。

Agent Script 不建立绕过 Tool Registry 的地下 API。脚本中的领域操作最终仍进入同一批 Application-owned Tool Executor 或 Capability API。

### 2.3 当前缺失

尚未实现：

- 非媒体、非 Prompt 的 File-backed Resource Definition；
- 独立脚本源码的 Blob 引用和编辑 API；
- Script Mount 与角色 / Preset / Session 的链接；
- `.loomcard` 中 scripts / notes / data 文件的 manifest；
- JavaScript Sandbox / Host；
- Inline CodeAct；
- Saved Script 执行；
- Script Invocation / Result 的专用 Transcript 事实；
- Script Capability Grant 和导入信任边界。

## 3. 资源分类与权威边界

### 3.1 Prompt Resource

用于默认 Prompt Build 的可排序内容：

```text
Prompt Resource
  -> Entry / Zone / Slot / MessageBlock / Activation / Order
```

Prompt Resource 继续由 PromptResourceStore 管理。Agent Script、Markdown 附件和普通数据文件不进入 Prompt Resource Tree，也不自动参加 Prompt Build 排序。

### 3.2 Structured Document

系统需要理解、查询和版本化的业务对象：

- Card Source；
- Agent Profile；
- Tool Definition；
- Agent Script Definition；
- File Resource Descriptor；
- Provider Profile。

这些对象使用 Document Store 或专用领域 Store。

### 3.3 File-backed Resource

拥有独立身份、可导入导出、可被 Agent 按 ID 读取的文件型内容：

- JavaScript / TypeScript source；
- Markdown / TXT；
- JSON / CSV / DSL；
- 图片、音频、视频；
- 第三方原始 Artifact。

文件型资源的原始载荷进入 Blob Store。是否为文本不影响这一决定。

### 3.4 Inline field

短描述、标签、作者备注等没有独立资源身份的内容继续留在所属 Document：

```ts
{
  description: '根据近期事件更新角色信任状态。',
  authorNote: '第二章以后启用。',
}
```

不为几百字的普通 metadata 制造额外 Blob 和 Link。

### 3.5 判断规则

满足以下任一条件时，内容按 File-backed Resource 处理：

- 需要独立文件名或 MIME；
- 可以被多个对象链接；
- 需要单独导入导出；
- Agent 可以按 ID 主动读取；
- 需要 byte-perfect 保存或 Hash；
- 可能较大或需要流式读取；
- 需要源码 / Markdown / 数据文件编辑器。

## 4. 最小数据合同

### 4.1 File Payload Reference

Document 不复制 Blob metadata，只保存稳定引用和文件展示信息：

```ts
type FilePayloadRef = {
  blobId: string
  mediaType: string
  fileName?: string
}
```

`sha256`、`sizeBytes` 和 Blob 创建时间由 Blob Store 权威拥有。需要执行快照或导出 manifest 时再读取 Blob Record。

### 4.2 普通 File Resource

首版只在出现真实普通文本 / 数据附件消费者时建立：

```ts
type FileResourceContent = {
  name: string
  description?: string
  kind: 'text' | 'data' | 'source' | 'other'
  payload: FilePayloadRef
  language?: string
  createdAt: string
  updatedAt: string
}
```

建议 Document Type：

```text
airp.fileResource
```

该 Document 表达“这份文件在 Workspace 中是什么”，Blob 只表达“这些字节是什么”。

### 4.3 Agent Script Definition

Agent Script 具有执行语义，不和普通 File Resource 合并成一个弱类型 Document：

```ts
type AgentScriptContent = {
  name: string
  description: string
  runtime: 'loom-js' | 'trusted-node'
  source: FilePayloadRef
  inputSchema?: JsonObject
  outputSchema?: JsonObject
  guidance?: string
  requestedCapabilities: string[]
  createdAt: string
  updatedAt: string
}
```

建议 Document Type：

```text
airp.agentScript
```

约束：

1. `runtime = loom-js` 是默认且可由 Agent 使用的安全运行时；
2. `trusted-node` 属于后续高权限开发者模式，首版不实现；
3. Script ID、名称、描述、Schema 和 Capability 是结构化事实；
4. 源码只通过 `source.blobId` 读取；
5. 更新源码写入新 Blob，并更新 Script Document version；
6. 不在每个 Script Revision 的 JSON 中复制完整源码。

### 4.4 普通资源链接

普通附件只表达关联与展示顺序：

```ts
type WorkspaceResourceLink = {
  id: string
  targetKind: 'card' | 'preset' | 'agent-profile' | 'session'
  targetId: string
  resourceId: string
  role: 'attachment' | 'reference' | 'source'
  orderIndex: number
  metadata: JsonObject
  createdAt: string
}
```

只有出现第二种普通 File Resource 消费者后才建设通用 Link Store。第一阶段不为了 Agent Script 提前实现通用 EAV Resource Graph。

### 4.5 Agent Script Mount

可执行脚本需要独立关系，因为它包含开关、Activation、版本和权限：

```ts
type AgentScriptMount = {
  id: string
  targetKind: 'card' | 'preset' | 'agent-profile' | 'session'
  targetId: string
  scriptId: string
  orderIndex: number
  defaultEnabled: boolean
  activation?: PromptActivation
  pinnedVersion?: number
  grantedCapabilities: string[]
  origin: JsonObject
  createdAt: string
}
```

约束：

- Script Definition 唯一，不在 Mount 复制源码、Schema 或描述；
- Mount 只保存链接和运行策略；
- `pinnedVersion` 缺省时使用当前版本；
- 导入的 Script Mount 默认 `defaultEnabled = false`；
- Script 请求 Capability 不等于获得 Capability；
- 有效 Capability 是 `requested ∩ granted ∩ runtime policy`；
- Agent Profile 快速开关只能进一步关闭或显式覆盖，不提升权限。

### 4.6 不建立万能 Resource Table

本计划不把 Prompt、Tool、Script、Media 和 Card 强行塞进一张：

```text
resources(id, kind, content_json, everything_else_json)
```

它们只共享稳定 ID、Blob 引用和链接原则，各自保留明确的领域合同。通用抽象停在 `FilePayloadRef` 和必要的 Link 基础上。

## 5. 源码编辑与 Revision

### 5.1 保存流程

```text
Script Editor commit
  -> validate UTF-8 / size / media type
  -> BlobStore.write(source bytes)
  -> obtain blobId / sha256
  -> update airp.agentScript.source.blobId
  -> Document version + Changeset
```

编辑器不在每个按键产生 Blob。只在显式保存或现有编辑器 commit 边界写入新版本。

### 5.2 历史版本

Script Document Revision 保存旧 `blobId`，因此旧源码仍可读取：

```text
script version 3 -> blob A
script version 4 -> blob B
script version 5 -> blob C
```

首版不实现文本 diff 数据库。需要查看差异时读取两个 Blob 并按需计算。

### 5.3 Blob GC

当前 Blob Store 不做引用计数和物理 GC。本计划不在 Script M1 顺手增加删除。

未来 GC 必须扫描：

- 当前 Document；
- Document Revision；
- Source Artifact / Media Asset；
- Agent Script Invocation snapshot；
- 导入包和备份引用。

只有确认 Blob 不被任何当前或历史事实引用后才能回收。

## 6. Card Bundle 与真实文件表示

### 6.1 导出格式

角色包和 Preset 包可以把 File-backed Resource 物化为可读文件：

```text
manifest.json
card.json
scripts/
  update-trust.js
  inspect-memory.js
notes/
  author-notes.md
data/
  emotion-rules.json
assets/
  avatar.png
```

Manifest 至少记录：

```ts
type BundleFileEntry = {
  resourceId: string
  kind: 'agent-script' | 'file-resource' | 'media'
  path: string
  mediaType: string
  sha256: string
  script?: {
    runtime: 'loom-js'
    inputSchema?: JsonObject
    outputSchema?: JsonObject
    requestedCapabilities: string[]
  }
}
```

### 6.2 导入流程

```text
read archive
  -> validate entry count / sizes / total size
  -> reject absolute path / traversal / symlink / special file
  -> verify manifest path and SHA-256
  -> write bytes to Blob Store
  -> create Script / File Resource Documents
  -> create disabled Mounts
  -> commit canonical state
```

导入包中的 `.js` 扩展名不自动赋予执行权限。只有合法的 Agent Script Definition 加上用户确认的 Mount / Grant 才能被执行。

### 6.3 解包目录不是权威存储

内部运行时不长期保留：

```text
characters/alice/scripts/update-trust.js
```

物理路径仅用于临时导入、导出或以后明确设计的 Authoring Folder Adapter。默认运行时通过 `scriptId -> Document -> blobId` 解析。

### 6.4 Authoring Folder Mode

真实文件夹同步、watch、冲突合并、外部编辑器和 Git 工作流属于后续独立计划。它可以把 Blob-backed Resource 物化为 `.js` / `.md`，但不得成为 Script Runtime 的第二权威来源。

## 7. Script Catalog 与 Agent 可见性

### 7.1 Mount 不等于自动执行

```text
Mount enabled + Activation matched
  -> 本轮允许 Agent 看到并选择该 Script

不等于
  -> Runtime 自动执行 Script
```

自动 `beforeTurn` / `afterTurn` / event hook 会引入重入、递归、顺序和失败恢复，本计划不在 M1 实现。

### 7.2 Prompt Build 接缝

Script 源码不进入 Prompt Build。只把模型需要的调用信息编译进 Tools Zone：

```text
Script ID
Name
Description
Guidance
Input Schema 摘要
当前是否可用
```

Script Mount 的 Activation、排序和开关进入与 Tool Mount 相同的动态 Prompt Build 管线。Script 可以拥有官方 Slot、角色 Slot 或插件 Slot，但不复制到 Preset Message Entry。

### 7.3 模型表面

第一阶段建议只暴露统一入口：

```ts
run_script({ scriptId, input })
```

Prompt 中同时提供当前已挂载 Script Catalog。模型不得运行未挂载、未启用或未授权的任意 Script ID。

后续可以把单个 Script 虚拟投影成 Provider-native Tool：

```text
alice_update_trust(args)
  -> internal CodeAct resource invocation
  -> script/alice/update-trust
```

Script Definition 仍然只有一份，Provider Tool 只是模型表面。

## 8. CodeAct canonical contract

### 8.1 两种调用模式

```ts
type CodeActInvocation =
  | {
      mode: 'inline'
      source: string
      input?: JsonValue
      timeoutMs?: number
    }
  | {
      mode: 'resource'
      scriptId: string
      version?: number
      input?: JsonValue
      timeoutMs?: number
    }
```

它是 canonical Runtime contract，不要求所有 Provider 使用同一个 wire shape。

### 8.2 Provider projection

根据模型能力投影：

| Canonical 模式 | 首选 Transport | Fallback |
| --- | --- | --- |
| Inline CodeAct | Responses Custom raw source | Content XML；最后才用 JSON `{ code }` |
| Resource Script | Native Function `run_script` | Provider Custom / Content |

外部可以呈现为两个 Tool Surface，以减少 Schema 模糊：

```text
codeact_inline
run_script
```

内部仍进入同一个 CodeAct Executor。

### 8.3 Content Transport 示例

Inline：

```xml
<loom_code_action mode="inline">
const resources = await loom.promptResources.list()
return resources.map(resource => resource.id)
</loom_code_action>
```

Resource：

```xml
<loom_code_action mode="resource" script="alice/update-trust">
{"characterId":"alice","action":"用户承认了谎言"}
</loom_code_action>
```

Content scanner 生成 Studio-owned Invocation ID。Chat Completions 即使返回 `finish_reason = stop`，Runtime 只要扫描出合法 Invocation，就派生为 Tool / CodeAct Step 并继续 Loop。

## 9. JavaScript Runtime 与安全边界

### 9.1 默认 Runtime

M1 只实现：

```text
runtime = loom-js
```

运行环境默认不提供：

- `process`；
- `require` / Node module resolution；
- `fs`；
- `child_process`；
- 原生 `fetch`；
- 环境变量；
- Blob Root、SQLite connection 或应用内部绝对路径。

只注入显式 Capability API：

```ts
type LoomScriptApi = {
  tools: {
    call(toolId: string, input: JsonValue): Promise<JsonValue>
  }
  results: {
    emit(value: JsonValue): void
  }
  log: {
    info(message: string, data?: JsonValue): void
  }
}
```

领域便利 API 可以后续增加，但底层仍映射到 Tool Registry / Application Capability，而不是直连 Store。

### 9.2 隔离要求

普通 Node `vm` 不作为安全边界。正式执行至少使用独立 Worker 或子进程，并具备：

- hard timeout；
- memory / output limit；
- Abort；
- 禁止继承敏感环境变量；
- 明确 IPC contract；
- Host crash 与 Agent Run 隔离；
- 每次 Invocation 独立取消；
- 不允许脚本取得 Host object reference。

具体 Sandbox 技术选型必须在实施前做小型 Spike。本计划不预先引入第三方依赖。

### 9.3 Trusted Node

真实本机 Node、文件系统、网络、CLI 和外部依赖属于：

```text
runtime = trusted-node
```

它是后续显式开发者模式，不与 `loom-js` 共用默认 Grant：

- 导入脚本永远不能自动获得；
- Agent 不能自行升级到 Trusted Node；
- UI 必须明确展示主机权限；
- 执行使用独立进程；
- 首版不实现。

## 10. Capability、Approval 与 Mutation

### 10.1 三层权限

```text
Script requestedCapabilities
  ∩ Mount grantedCapabilities
  ∩ Agent / Runtime policy
  = effective capabilities
```

Inline CodeAct 没有持久化 Mount，其 Grant 来自当前 Agent Profile、CodeAct Tool Policy 和本次用户审批。

### 10.2 API 调用仍是 Tool Invocation

脚本内部：

```js
await loom.tools.call('workspace/update-entry', input)
```

Runtime 仍为每次调用创建子 Invocation：

```text
CodeAct Invocation
  ├── child ToolInvocation A
  ├── child ToolInvocation B
  └── child ToolInvocation C
```

这样保留：

- 参数校验；
- Approval；
- Tool Result；
- Changeset；
- parentCallId；
- 审计和错误归因。

### 10.3 不提供隐式脚本级事务

M1 不允许任意 JS 长时间持有 SQLite transaction。一个脚本连续执行多个写 Tool 时，前面的提交不会因后续脚本错误自动回滚。

需要原子写入时应提供一个领域级原子 Tool：

```js
await loom.tools.call('workspace/apply-entry-batch', batch)
```

而不是让 Script Host 包住任意代码事务。执行结果必须如实列出已提交和未执行的子调用。

## 11. 执行结果、Transcript 与恢复

### 11.1 Script Invocation 事实

Session 至少记录：

```ts
type ScriptInvocationEntry = {
  kind: 'script-invocation'
  invocationId: string
  mode: 'inline' | 'resource'
  scriptId?: string
  scriptVersion?: number
  sourceBlobId: string
  sourceSha256: string
  input?: JsonValue
  effectiveCapabilities: string[]
  status: 'proposed' | 'running' | 'completed' | 'failed' | 'aborted' | 'suspended'
}
```

Inline CodeAct 也必须把实际 source 保存为 Blob，再执行。它虽然不是 Workspace Script Resource，但执行历史不能只依赖临时内存。

### 11.2 Result

```ts
type ScriptResult = {
  invocationId: string
  status: 'completed' | 'failed' | 'aborted' | 'suspended'
  value?: JsonValue
  logs: Array<{ level: string; message: string; data?: JsonValue }>
  childInvocationIds: string[]
  error?: { code: string; message: string }
  suspension?: {
    reason: string
    resumeToken: string
    state?: JsonValue
  }
}
```

大输出不直接塞进 Transcript，写入 Artifact / Blob，并在 Result 中保存引用和摘要。

### 11.3 Loop 判断

```text
Script completed / failed / aborted
  -> 产生可 replay Result
  -> Runtime 决定是否继续 Provider Step

Script suspended
  -> Agent Run 进入 suspended
  -> 不标记 completed
  -> 满足恢复条件后重新启动 Script Step 或下一 Provider Step
```

Provider `finish_reason` 不决定 Script / Agent 完成状态。

### 11.4 M1 暂停限制

JavaScript 调用栈不能在进程重启后自动恢复。M1 不支持脚本在任意 `await` 位置持久等待另一个 Agent 或用户输入。

第一阶段只允许：

- 有界 API 调用；
- 受控 timeout；
- 顶层显式返回 `suspended` 与可序列化 state；
- Resume 时重新调用持久化 Script，并把 `resumeState` 作为输入。

Inline CodeAct 首版不提供跨进程 continuation。需要长期等待的工作应由 Agent 状态机持有，而不是让 JS 进程常驻。

## 12. UI 与作者体验

### 12.1 Resource / Script Workbench

最小界面：

- Script 列表；
- 名称、描述、Runtime；
- JavaScript 源码编辑器；
- Input / Output Schema；
- Requested Capability；
- 当前版本与来源；
- 保存、试运行、查看日志；
- Card / Preset / Agent Profile / Session 挂载列表。

UI 文件夹是 Link / Mount 投影，不改变 Blob 物理位置。

### 12.2 Preset 与 Agent Profile

Preset 负责：

- Script Mount；
- 默认开关；
- Activation；
- Script Catalog 排序；
- Granted Capability 的默认策略。

Agent Profile 只显示已挂载能力与快速开关，不编辑 Script Definition。

### 12.3 Agent Transcript

CodeAct / Script 需要专用卡片，至少显示：

- Inline 或 Saved Script；
- Script 名称与版本；
- 运行状态；
- Input 摘要；
- 子 Tool 调用；
- 日志；
- Result / Artifact；
- Approval、Abort、Retry 和 Resume。

不把执行日志伪装成普通聊天楼层。

## 13. 分阶段实施

### Phase 0：Sandbox 与数据合同 Spike

目标：在新增正式执行依赖前验证隔离、取消和 IPC。

任务：

1. 固定 `AgentScriptContent`、`FilePayloadRef`、`CodeActInvocation` 和 `ScriptResult`；
2. 用临时目录验证 Blob source 写入和精确读取；
3. 比较 Worker / 子进程候选，验证 timeout、Abort、内存与输出上限；
4. 验证 Host API 不能泄漏 Node object / filesystem；
5. 不接真实 Agent Loop，不开放写 Tool。

验证检查点：恶意无限循环、巨大输出、访问 `process/fs/fetch` 和 Host abort 均得到可归一错误，Server 主进程保持可用。

### Phase 1：Agent Script Definition 与 Blob Source

目标：建立可编辑、可版本化的 Script Resource，不执行。

任务：

1. 增加 `airp.agentScript` Document Type；
2. 增加 Script create / get / list / update / delete API；
3. 源码写 Blob，Document 只保存 `blobId`；
4. 更新源码产生新 Document version；
5. 提供源码读取限制和 MIME / UTF-8 校验；
6. 暂不建立普通 File Resource 泛化层。

验证检查点：Script 重启后可恢复；相同源码复用 Blob；旧 Document Revision 仍能解析旧 Blob；源码不出现在 `content_json`。

### Phase 2：Script Mount 与 Catalog

目标：让角色、Preset、Agent Profile 和 Session 链接 Script，并让 Agent 看到可用 Script。

任务：

1. 增加 `agent_script_mounts` 关系表和 Store；
2. 增加 list / replace Mount API；
3. 合并 Preset 默认、Agent 快速开关、Activation 和 Capability；
4. Prompt Build 只注入 Script Catalog metadata；
5. Script source 不进入 Prompt；
6. 导入来源 Mount 默认关闭。

验证检查点：未挂载 Script 不可调用；Activation 未命中时不暴露；Profile 不能启用 Preset 未挂载 Script；权限不能被 Profile 开关提升。

### Phase 3：Resource Script Runner

目标：先执行持久化 Script，不做 Inline CodeAct。

任务：

1. 实现 `loom-js` Host；
2. 增加 `run_script` canonical action；
3. 按 scriptId / version 解析 Document 和 Blob；
4. 校验 Input Schema 和 effective capabilities；
5. 注入只读 `loom.tools.call` 测试 Tool；
6. 记录 Script Invocation、日志和 Result；
7. 失败、Abort 和 timeout 返回确定性状态。

验证检查点：角色作者预制 Script 能由 Agent 调用测试 Tool；未授权 Tool 被拒绝；脚本异常不会终止 Server 或破坏 Agent Session。

### Phase 4：Script 调用领域 Tool

目标：让 Script 成为复合 Tool，而不是旁路 Store API。

任务：

1. 为 Script API 建立 parent / child Invocation；
2. 复用 Tool Approval、Validation、Executor 和 Result；
3. 子 Tool Result 回传 JS；
4. 记录每个子调用的 Changeset；
5. 对部分成功如实报告；
6. 首批只开放测试 Tool 和 read-only Tool。

验证检查点：一个 Script 可循环调用多个 Tool；每个调用可单独审计；中途失败时已提交副作用和未执行步骤可区分。

### Phase 5：Inline CodeAct

目标：支持模型现场编写、不保存为 Workspace Script 的一次性代码。

任务：

1. 增加 `mode = inline`；
2. 执行前把 source 写入 Blob 并记录 Hash；
3. Responses Custom / Content raw source；
4. JSON Function `{ code }` 只作 fallback；
5. 与 Resource Script 共用 Host 和 Capability；
6. 支持“保存为 Agent Script Resource”的后续 UI 动作。

验证检查点：Inline source 不依赖 Provider ToolCall ID；Chat Completions `stop` 中扫描出的 CodeAct 仍推进 Loop；执行历史可重放和审计。

### Phase 6：Agent Loop、暂停与恢复

目标：把 Script 状态纳入 Agent Run 状态机。

任务：

1. 增加 Script proposed / running / completed / failed / aborted / suspended；
2. Provider stop reason 与 Script state 分开；
3. 支持显式序列化 `resumeState`；
4. Resume 时按 scriptId + version + Blob Hash 重建执行；
5. Inline CodeAct 不承诺任意 JS continuation；
6. 用户暂停时 Abort Host 并记录非成功 Result。

验证检查点：网络断连、用户暂停、Host crash 和显式 suspended 不被误判为 Agent completed；恢复不会静默切换 Script 版本。

### Phase 7：Bundle、UI 与作者流程

目标：角色作者可以预制 Script，用户可以审阅、挂载和运行。

任务：

1. `.loomcard` manifest 支持 scripts / notes / data；
2. 导出物化真实 `.js` 文件；
3. 导入写 Blob + Document + disabled Mount；
4. Script Workbench 和源码编辑器；
5. Preset Script Tab / Catalog；
6. Agent Profile 快速开关；
7. Transcript CodeAct 卡片；
8. Inline 执行结果支持“保存为 Script”。

验证检查点：角色包跨重启导入、审阅、授权、调用和重新导出保持 Script ID、Hash、Schema 与 Mount 语义；人工视觉验收由作者完成。

### Phase 8：普通 File Resource 泛化

目标：在 Script 之外出现第二个真实消费者后，收束 Markdown、数据文件和注释附件。

任务：

1. 增加 `airp.fileResource`；
2. 增加普通 Resource Link；
3. Agent read-resource Tool；
4. MIME / encoding / size policy；
5. Bundle notes / data round-trip；
6. 不让普通 File Resource 自动进入 Prompt Build。

验证检查点：Markdown / JSON 文件可被 Card / Session 链接、由 Agent 主动读取并正确导出；没有被隐式注入默认 Prompt。

## 14. 测试与验证策略

### 14.1 Store

- 相同 source 字节复用 Blob；
- Script Document version 正确指向不同 Blob；
- Script Mount 唯一性、排序和删除清理；
- 删除 Script 时有 Mount 明确拒绝或受控拆除；
- 导入失败不提交半套 Document / Mount；
- Blob 字节成功但 SQL 失败只留下未引用 Blob，不留下失效引用。

### 14.2 Runtime

- Input Schema 校验；
- Capability 交集；
- 未挂载 / 禁用 / Activation 未命中拒绝；
- timeout、Abort、Host crash；
- 无限循环和巨大输出；
- parent / child Tool Invocation；
- 多次 Tool 调用顺序；
- 部分成功；
- Resource version pin；
- Inline source snapshot。

### 14.3 Agent Loop

- Native `run_script`；
- Responses Custom inline；
- Content inline / resource；
- Chat Completions raw stop 为 `stop` 但扫描出 CodeAct；
- Script Result replay；
- suspended / resumed / aborted；
- Provider 重试不重复执行已提交 Script Invocation。

### 14.4 Bundle

- path traversal、absolute path、symlink、特殊文件拒绝；
- entry count、单文件和总大小上限；
- SHA-256 mismatch；
- 非法 MIME / runtime；
- 导入脚本默认禁用；
- 未知 manifest 字段保留策略；
- export -> import -> export round-trip。

### 14.5 UI

自动化只验证数据行为和组件状态，不替代人工视觉验收。至少覆盖：

- 保存冲突；
- Script 列表与版本刷新；
- Mount 快速开关；
- Capability 警告；
- CodeAct 状态卡；
- 日志和 Artifact 展开；
- 导入脚本未授权提示。

## 15. 明确非目标

本计划第一轮不实现：

- 真实 Bash；
- 默认 Trusted Node；
- npm dependency installation；
- 任意本机文件系统 / 网络访问；
- Persistent JavaScript Kernel；
- 任意 JS continuation 的跨进程恢复；
- 自动 `beforeTurn` / `afterTurn` Hook；
- Script-wide 长事务；
- Git-backed Authoring Folder；
- 通用 Resource Graph / EAV；
- Blob 物理 GC；
- TypeScript 编译器和第三方 bundler；
- 插件提供任意 Sandbox Host。

## 16. 开放问题

实施前需要单独确认：

1. `loom-js` 采用 Worker 还是独立子进程，以及是否需要第三方 isolate；
2. Script Mount 首批 target 是否只做 Preset / Card，暂缓 Agent Profile / Session 直接挂载；
3. `requestedCapabilities` 的命名是否直接复用 Tool / Extension Grant；
4. Script Catalog 是否进入现有 `tools` Zone，还是建立同 Zone 下独立官方 Script Slot；
5. Inline CodeAct 是否默认关闭，只对特定 Agent Profile 开放；
6. Saved Script 首批是否只允许调用测试 Tool 和 read-only Tool；
7. Script 删除时采用“有 Mount 拒绝”还是 Application 事务化拆除；
8. Bundle Script ID 冲突时采用复用、复制新 ID 还是显式导入决策。

## 17. 推荐首个可执行切片

第一轮不要直接做到完整 CodeAct。建议只做：

```text
Agent Script Document
  + Blob source
  + Preset Script Mount
  + Script Catalog preview
  + loom-js Spike Runner
  + 一个只读测试 API
  + 手动运行
```

闭环验收：

1. 作者创建并保存一份 JS Script；
2. 源码进入 Blob，Document 只保存引用；
3. Script 挂载到 Preset；
4. Prompt Preview 能看到 Script 描述但看不到源码；
5. 手动运行 Script；
6. Script 调用一个确定性的只读测试 API；
7. Invocation、日志、Result 和源码 Hash 被持久化；
8. 重启后仍能读取和再次运行。

该切片验证数据层、Prompt 接缝和安全 Host 三个最高风险边界，同时不提前开放写权限、Inline CodeAct 或真实 Node。
