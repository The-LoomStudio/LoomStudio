# Agent Tool System

## 1. 三种不同对象

Tool 系统明确区分定义、挂载和运行注册：

```text
Tool Definition
  模型可见身份、描述和输入合同。

Preset Tool Mount
  某个 Preset 是否使用 Tool，以及 Activation 和投影位置。

Runtime Registration
  Approval handler 与实际 Executor。
```

三者不能合并。修改 Tool Definition 不复制 Mount；复制 Preset 会复制 Mount，不复制 Workspace Tool Definition。存在 Definition 但没有 Runtime Registration 的 Tool 不能成功执行。

## 2. Tool Definition

Tool Definition 使用稳定 `id`，保存 Owner namespace、模型暴露名称与描述、structured / freeform / hybrid 输入合同、parameter descriptions、guidance，以及新建 Mount 使用的默认投影模板。

当前 Workspace Tool Definition 持久化为版本化 `airp.agentTool` Document。编辑会更新同一 Tool ID 和 version，不通过改名创建新的调用身份。

Tool Prompt 中允许宏展开的字段只有 description、parameter description 和 guidance。Tool ID、暴露名称、参数键、Schema type、required、enum、grammar 和 Handler identity 保持结构稳定。

## 3. Preset Mount 与有效开关

`preset_tool_mounts` 是 Preset 到 Tool Definition 的权威关系，保存 `defaultEnabled`、Activation、Provider Tool order、Content zone / slot / rank / order hint、origin 和 Mount order。

Agent Profile 只保存 `toolOverrides: Record<toolId, boolean>`。有效候选集合先按以下规则计算：

```text
Preset 已挂载
  && (Agent override ?? Preset defaultEnabled)
```

随后 Tool Prompt Build 再计算 Activation。未挂载 Tool 不能由 Agent Profile 单独开启。

三个状态必须区分：

- `enabled`：Preset / Profile 的持久配置；
- `effectiveEnabled`：合并 Preset 与 Agent override 后的候选状态；
- `active`：本次 Prompt Build 根据输入与 Facts 得出的结果。

## 4. Transport

| Transport | Provider 表面 | 输入 |
|---|---|---|
| `native-function` | Provider 顶层 Function Tools | JSON object |
| `provider-custom` | Provider 原生 Free-form / Custom Tool | raw 或 grammar constrained input |
| `content` | Assistant Content 中的 Loom 标签协议 | metadata + raw body |

当前实际执行路径已经支持 Native Function 与 Content。Provider Custom 仍是 capability 和 projection 候选，正式 Responses adapter 与 Result Replay 尚未完成。

Transport 是一次 Invocation 的事实。Tool 执行结束后不能根据当前 Provider capability 重新猜测 Result Replay 格式。

## 5. Content Tool

Content Tool 使用 `loom-content-v1` 标签协议承载原始正文，避免把长文本、Patch 或代码强制转义进 JSON 字符串。Runtime 负责流式扫描、分离普通 Assistant 正文、校验 Tool 输入、创建 Studio Invocation ID、转换 canonical ToolInvocation，并把 ToolResult 渲染为下一轮 user-role content block。

Provider 对 Content Tool 没有真实 Tool Call ID，Studio 不伪造 Provider ID。Invocation 与 Result 的配对由 Studio 本地 ID 完成。

Content Tool 是 Native Tool 的补充，不替代结构化 Tool。短参数、状态读取和严格 Schema 操作优先使用 Native Function；长正文、Patch 和代码输入适合 Content Transport。

## 6. Registry、批准与执行

`AgentToolRegistry` 负责 Definition 校验与去重、候选解析、Transport 分析、Invocation 校验、Approval、Executor 调用和 Result 归一。

Executor 接收 Tool Definition、Invocation 和 AbortSignal。Tool Result 必须使用同一 Invocation ID 与 Tool ID，并返回明确状态。未知 Tool、非法参数、无 Executor、拒绝、Timeout 和 Abort 都产生可检查错误，不折叠成虚假成功。

当前 Approval handler 已存在，但正式 Permission UI、Grant 继承和 suspend / resume 尚未完成。真实领域写入 Tool 必须通过 owning Application API 和真实 transaction，不能直接修改 Store 内部表。

## 7. Owner 与 Slot

Content Tool Description 作为外部 Runtime Source 进入 PromptBuild。Anchor 表达预设中的挂载孔位，Slot 表达来源所有权与聚合：

```text
@tools.content anchor
  official-tools (slot)
  extension:weather-tools (slot)
  extension:other-tools (slot)
```

官方 Tool 不拥有整个孔位。Extension、角色、Setting 或其他外部来源可以贡献自己的 Slot；卸载一个来源只移除自己的 Slot。

## 8. CodeAct 双入口

2026-09-21 已接入官方 CodeAct，当前只读，不代表 CodeAct/VFS 总计划已完成：

| Tool ID / 模型名 | 传输 | 输入 |
| --- | --- | --- |
| `official/codeact` / `codeact` | Content，freeform | 原始 JavaScript，metadata 必须为 `{}` |
| `official/codeact_json` / `codeact_json` | Native Function，structured | `{ "code": "JavaScript source" }` |

两个入口使用同一执行器和 `ctx`，沿用 Registry、Approval、Invocation、ToolResult 与当前 Run 工具回放。不会自动迁移已有预设或开启工具。新建预设会挂载可用工具但默认关闭；已有预设须显式添加并启用所选入口，通常只选一个。

Content 调用：

```xml
<loom_tool name="codeact"><metadata>{}</metadata><content>
print(await ctx.ls("/"));
</content></loom_tool>
```

JSON Function 参数：

```json
{ "code": "print(await ctx.ls(\"/\"));" }
```

Content 原文保留 JS 换行、引号与反斜杠，但仍受 `loom-content-v1` 保留结束标签限制。源码含 `</content>` 或 `</loom_tool>` 字面序列时，使用 JSON 入口或在 JS 内拆分构造字符串。Provider 截断/错误的 Step 不执行 CodeAct；正文转换规则改写了 Content 源码时明确拒绝执行，不能把改写后的文本当代码静默运行。

### 执行与读取范围

`agents/codeact/` 使用 `quickjs-emscripten@0.32.0`，每次 Invocation 新建 Worker 与独立 QuickJS Runtime/Context。没有宿主 fs、process、require、fetch、模块导入、后台定时器或跨调用 JS 变量。

当前固定上限：10 秒墙钟时间、16 MiB QuickJS 堆、512 KiB guest 栈、40 Ki 字符源码、32 Ki 字符结果、128 次 ctx 调用、最多 8 次在途调用。WASM 内存与整个 Node 进程占用不等同于 guest 堆限制；Worker 是执行和终止边界，不是 OS 安全沙箱，也不构成第三方安全审计证明。

当前实际方法：

- `ctx.ls(path?, { offset?, limit? }?)`：一层文本目录与状态，默认 50 项。
- `ctx.search({ path?, terms, match?, limit? })`：同一文件内 all/any 字面匹配，返回路径、行范围和少量原文。
- `ctx.read(path, { startLine?, endLine? }?)`：纯正文字符串，每次最多 16384 字符；读取路径/行范围另外显示在结果中。
- `ctx.readNarrative({ selection, maxNodes?, maxCharacters? })`：采样读取当前授权 Timeline 的历史节点，返回结构化 JSON 对象（节点列表、拼接正文与截断标记），受节点上限和字符预算保护。
- 宿主方法返回值支持结构化 `JsonValue`，不强制将对象转换为扁平字符串。其余写方法（`write`, `patch`, `create`, `delete` 等）按授权受控提供。
- `ctx.write(path, value, { mode: "replace" })`：必须先完整读取同一路径；当前只允许 Prompt Resource 正文和 State 属性替换，使用读取到的资源版本或 State Revision 做冲突检查。
- `ctx.patch(path, unifiedDiff)`：必须先读取覆盖所有修改上下文的正文范围；当前只允许 Prompt Resource 单文件 unified diff，按唯一旧文本上下文定位，不依赖行号，不支持模糊匹配、创建、删除或移动。

写入支持宿主 `approveMutation(preview, signal)` 回调：预览提供前后文本，State 使用 YAML 并附带目标与 Pointer；只返回 allow 或 deny/reason。审批期间取消不再写入，通过后仍由领域 CAS 拒绝过期版本。Agent Run 已将预览转为等待事件，Studio Agent Panel 提供允许/拒绝弹窗并回传决定；未提供 Run 回调的直接 Runtime 调用仍沿用此前直接写入行为。

VFS 的权威来源与投影视图分开：

| 根目录 | 来源与读取行为 |
| --- | --- |
| `/resources/` | 本次挂载的 Preset/Setting 真实资源树，每次操作读取当前 SQL 数据；正文保留宏源码，宿主绑定 resourceId、nodeId 和 resource version |
| `/context/` | 本次 Prompt 准备时已供给的文本投影；不能将其行号和内容直接写回作者源节点 |
| `/state/current.yaml` | 当前授权目标的完整快照，保留兼容入口 |
| `/state/data/` | 沿实际 State 属性树发现目录；每个属性目录的 `@value.yaml` 是对应子树，数组作为完整值读取；宿主绑定目标、JSON Pointer、Revision |
| `/attachments/` | 当前预设拥有且挂载的脚本，索引来自 Document，正文按需读 Blob；遵循挂载指定的版本，读取不执行 |

例如 `ctx.read("/state/data/world/persons/C/components/inventory/@value.yaml")` 读取一个组件，不再必须返回完整 State。集合位置来自真实数据，不假定角色一定在 `entities.characters`。状态路径按目录返回原样使用，特殊字符有无损转义。

`ResourceVfs` 独立于 JavaScript Sandbox，在本次 ToolExecutionScope 内保留读取版本和路径身份。用户编辑后重新读取能得到新版本；观察过的路径被另一个节点占用时返回 `vfs.path_rebound`，不静默换目标。版本记录不作为模型正文输出，也不是现已实现的写入授权。

只遍历显式挂载的 resource IDs，不枚举整个 Workspace。资源树顺序遵从作者顺序，同名挂载消歧；有正文又有子节点的节点用 `@body.md` 表示自身正文。`disabled` 仅表示停用注入，不等于禁止源文件读取。宿主可将节点标为 locked 或 hidden，LS/Search/Read 使用同一访问规则；当前正式接线只为本次已选资源供给读取，不据此宣称通用权限 UI 已完成。

脚本目录列表不读 Blob 字节，文本读取上限为 1 MiB；深度 128、视图 20000 项、搜索源文本 2 Mi 字符是当前显式预算，超限要求缩小范围，不伪装成完整结果。

尚不支持 Narrative/Session 搜索、历史追溯、任意通用附件/图片索引、多角色挂载管理 UI、创建/删除/移动资源、Metadata 结构修改、Pin 或世界回滚。已有 Blob 桥不等于所有资产的所属关系和授权已经接通；未实现方法不在 ctx 中暴露。

### 引用与 UI 跳转

读取观察同时可以生成面向用户的 Markdown 引用。引用不是 VFS 路径，也不是前端路由，而是绑定资源身份、版本和范围的 `loom-resource:` URI：

```markdown
[爱丽丝的人设](loom-resource://prompt-resource?resource=...&node=...&version=2#L12-L18)
```

当前支持三类目标：

- `prompt-resource`：资源 ID、节点 ID、资源版本和正文行范围；
- `state`：State 目标、Revision、JSON Pointer 和 YAML 行范围；
- `script`：脚本文档和版本；

CodeAct 的 `read` 和 `search` 结果在有真实绑定时附带 `Reference: [打开引用](...)`。稳定教程要求 Agent 直接复用这个 Markdown 链接，不自行编造 URI、内部 ID 或行号；`/context` 投影没有源正文引用，应先读取 `/resources`。

Studio 将 URI 渲染为可点击引用查看器。查看器按 URI 中的身份和目标读取，不按当前路径或同名节点重新猜测；资源版本或 State Revision 已变化时展示当前内容，但取消旧行号高亮。正文资源可以从查看器进入编辑器；State 引用只读取目标分支，不执行分支切换或写入。URI 只能定位资源，不能绕过 VFS 权限。

### 稳定提示词

默认教程由 CodeAct Tool Definition 的现有 `prompt.guidance` 持久化，仍可在工具编辑能力中修改；初始化不覆盖作者编辑。公共说明及各方法使用统一的用途、签名、参数、返回、示例与限制模板。

无论采用哪种传输，教程只作为一份 `runtime.codeact.instructions` Contribution 投影到 `@chat.tools` 或挂载指定位置。Native `tools[]` 保留必要 schema 和简短说明，Content 协议说明也不再重复整本教程；同时启用两个别名时使用编译顺序中第一个入口的教程。缺少/禁用目标锚点时，Preview 中记录 `codeact.instructions_unmounted`，不另找位置强行注入。

实现与定向验收：

- [`official-tools/codeact.ts`](../../../../packages/application-runtime/src/agents/official-tools/codeact.ts)
- [`codeact-tool-loop.test.ts`](../../../../tests/integration/application-runtime/codeact-tool-loop.test.ts)
- [`codeact-executor.test.ts`](../../../../tests/unit/application-runtime/codeact-executor.test.ts)
- [`vfs-read.test.ts`](../../../../tests/unit/application-runtime/vfs-read.test.ts)
- [`resource-vfs.test.ts`](../../../../tests/integration/application-runtime/resource-vfs.test.ts)
- [`vfs-script-attachments.test.ts`](../../../../tests/integration/application-runtime/vfs-script-attachments.test.ts)

## 9. 实现来源

- [`packages/application-runtime/src/agents/tool-registry.ts`](../../../../packages/application-runtime/src/agents/tool-registry.ts)
- [`packages/application-runtime/src/agents/content-transport.ts`](../../../../packages/application-runtime/src/agents/content-transport.ts)
- [`packages/application-runtime/src/agents/tool-prompt-build.ts`](../../../../packages/application-runtime/src/agents/tool-prompt-build.ts)
- [`packages/application-runtime/src/agents/tool-loop.ts`](../../../../packages/application-runtime/src/agents/tool-loop.ts)
- [`packages/application-data/src/prompt-resource/types.ts`](../../../../packages/application-data/src/prompt-resource/types.ts)
