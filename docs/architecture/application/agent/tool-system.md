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

Tool/Lore 挂载全量替换要求 `expectedMountIds`，Store 在同一写事务内与完整当前集合比较；替换会重建挂载 ID，旧空集合也不能覆盖新挂载。新 Preset 与其默认 Tool Mount 在同一事务创建，初始化失败不会留下部分预设。

Agent Preset 使用这一份挂载配置，不再叠加 Profile `toolOverrides`。候选集合按以下规则计算：

```text
Preset 已挂载
  && Mount.defaultEnabled
```

随后 Tool Prompt Build 再计算 Activation。Agent 面板与预设资源视图修改同一挂载集合；未挂载 Tool 不进入候选集合。

持久开关与运行结果必须区分：

- `defaultEnabled`：Agent Preset 的持久配置，字段名沿用既有 Mount 合同，不表示另有 Profile 覆盖层；
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

官方 Tool 不拥有整个孔位。Extension、角色、Lore 或其他外部来源可以贡献自己的 Slot；卸载一个来源只移除自己的 Slot。

## 8. CodeAct 双入口

官方 CodeAct 已接入受控读写与宿主绑定的 Narrative 追加，不代表 CodeAct/VFS 总计划已完成：

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

Guest 执行预算为 10 秒，宿主 ctx 操作（包括 API 与审批）等待不计入该预算；保留 16 MiB QuickJS 堆、512 KiB guest 栈、40 Ki 字符源码及 32 Ki 字符结果边界。ctx 调用不设累计次数上限；最多 8 次桥接调用同时在途，其余在 Guest 内排队，正常批量调用不再因并发超过 8 次而报 `codeact.call_limit`。WASM 内存与整个 Node 进程占用不等同于 guest 堆限制；Worker 是执行和终止边界，不是 OS 安全沙箱，也不构成第三方安全审计证明。

当前实际方法：

- `ctx.ls(path?, { offset?, limit?, format? }?)`：默认一层文本目录与状态，默认 50 项；`format: "json"` 返回完整路径、类型、状态、total、offset、hasMore 和可选 nextOffset。空目录与翻到末尾在文本中分别提示。
- `ctx.search({ path?, terms, match?, limit? })`：同一文件内 all/any 字面匹配，返回路径、行范围和少量原文。
- `ctx.read(path, { startLine?, endLine? }?)`：纯正文字符串，每次最多 16384 字符；读取路径/行范围另外显示在结果中。
- `ctx.readNarrative({ selection, maxNodes?, maxCharacters?, view? })`：按当前分支楼层采样授权 Timeline 的历史正文。`selection` 支持 `{ kind: "floors", from, through }`、`{ kind: "tail", count, throughFloor? }`、`{ kind: "range", afterFloor?, throughFloor? }`，不接受节点 ID 字段。返回节点的 `floor / path`、拼接正文、`complete` 以及可选 `nextBeforeFloor / missingFloors`；`view` 可选 `raw / prompt`，读取仍受节点上限、字符预算及历史授权约束。
- `ctx.appendNarrative({ content })`：向当前绑定的 Timeline/Branch 追加非空剧情正文；不能传目标 ID，返回 `{ path }`。路径可用于 `ctx.read`，完整读取后可用 `ctx.write` 替换，替换成功返回新节点路径。无绑定或非法参数明确失败。追加不推进默认投影 Head；即使后续脚本失败或取消，结果仍保留已提交路径，不能盲目重试。
- 宿主方法返回值支持结构化 `JsonValue`，不强制将对象转换为扁平字符串。其余写方法（`write`, `patch`, `create`, `delete` 等）按授权受控提供。
- `ctx.readValue(path)`：直接读取 State 值文件为 JSON 值，并建立完整读后写基线；只支持 `/state/current.yaml` 和属性的 `@value.yaml`，不解析其他资源的 YAML。完整 JSON 超过 16384 字符则拒绝，不返回部分对象；普通 `ctx.read` 继续返回文本。
- `ctx.write(path, value, { mode: "replace", allowTypeChange?: boolean })`：必须先完整读取同一路径；支持作者模式下的 Prompt Resource、State 属性及 Narrative 节点正文替换。使用资源版本、State Revision 或正文读取基线做冲突检查。State 对象/数组改为其他类型默认报 `vfs.type_change`，有意改变类型需显式 `allowTypeChange: true`；该选项不跳过审批、CAS 或领域 Schema 校验，也不适用于文本资源。字符串不会自动解析成 YAML/JSON。
- `ctx.patch(path, unifiedDiff)`：必须先读取覆盖所有修改上下文的正文范围；支持 Workspace 文本与 Prompt Resource 正文的单文件 unified diff，按唯一旧文本上下文定位，不依赖行号。两者均校验读取基线、执行对应写入审批及版本 CAS；Prompt Resource 另需作者模式，Workspace 不要求作者模式。State、Narrative 与 Metadata 不支持 patch，也不支持模糊匹配、创建、删除或移动。

写入支持宿主 `approveMutation(preview, signal)` 回调：预览提供前后文本，State 使用 YAML 并附带目标与 Pointer；只返回 allow 或 deny/reason。审批期间取消不再写入，通过后仍由领域 CAS 拒绝过期版本。 Agent Preset 的 `approvalPolicy` 按共享工作区写入、设定资源写入、State 写入、剧情正文修改、历史读取及作者模式分别选择 `ask / allow / deny`，缺省为询问。策略只处理已有审批点，不扩大挂载或读取范围，也不替代工具挂载与 Registry 权限；不经过这些审批点的操作（如剧情追加）不因此新增审批。策略随后续 Run 读取的 Preset 生效。Agent Run 已将预览转为等待事件，Studio Agent Panel 提供允许/拒绝弹窗并回传决定；关闭弹窗只隐藏预览，可从当前 Session 的“查看审批”重新打开。订阅每轮返回待审批快照，刷新后重新观察存活 Run 可以恢复预览；直接 Runtime 调用即使没有 Run 审批回调，只要配置了 `approvalPolicy`，仍按策略决策：`allow` 放行、`deny` 拒绝、`ask`（包括未配置该项的默认值）因缺少 handler 而拒绝。只有策略与回调都未提供的旧路径才跳过此写入审批；其他挂载、访问和 CAS 限制继续生效。

Narrative 追加复用 `ToolExecutionScope.narrative.appendNode`，与官方 `append_narrative` 共用当前 Run 的宿主目标绑定和 Head CAS；不经过 VFS 的资源/State 变更审批，也不新增单独的追加审批。工具本身仍须经现有挂载、调用验证与 Registry 审批。`/resources/.../@body.md` 是世界书节点正文，不是剧情；`/state` 是结构化状态，不能通过 `ctx.write` 代替剧情追加。

VFS 的权威来源与投影视图分开：

| 根目录 | 来源与读取行为 |
| --- | --- |
| `/resources/` | 本次挂载的 Preset/Lore 真实资源树，每次操作读取当前 SQL 数据；正文保留宏源码，宿主绑定 resourceId、nodeId 和 resource version |
| `/context/` | 本次 Prompt 准备时已供给的文本投影；不能将其行号和内容直接写回作者源节点 |
| `/state/current.yaml` | 当前授权目标的完整快照，保留兼容入口 |
| `/state/data/` | 沿实际 State 属性树发现目录；每个属性目录的 `@value.yaml` 是对应子树，数组作为完整值读取；宿主绑定目标、JSON Pointer、Revision |
| `/attachments/` | 当前预设拥有且挂载的脚本，索引来自 Document，正文按需读 Blob；遵循挂载指定的版本，读取不执行 |

例如 `ctx.read("/state/data/world/persons/C/components/inventory/@value.yaml")` 读取一个组件，不再必须返回完整 State。集合位置来自真实数据，不假定角色一定在 `entities.characters`。状态路径按目录返回原样使用，特殊字符有无损转义。

`ResourceVfs` 独立于 JavaScript Sandbox，在本次 ToolExecutionScope 内保留读取版本和路径身份。用户编辑后重新读取能得到新版本；观察过的路径被另一个节点占用时返回 `vfs.path_rebound`，不静默换目标。版本记录不作为模型正文输出，也不是现已实现的写入授权。

只遍历显式挂载的 resource IDs，不枚举整个 Workspace。资源树顺序遵从作者顺序，同名挂载消歧；有正文又有子节点的节点用 `@body.md` 表示自身正文。disabled 源文件只在已授权作者视图中可读。宿主可将节点标为 locked 或 hidden，LS/Search/Read 使用同一访问规则；当前正式接线只为本次已选资源供给读取，不据此宣称通用权限 UI 已完成。

### 游玩与作者视图（2026-09-30）

CodeAct 默认使用游玩视图：`/resources` 不显示、搜索或读取 disabled 节点及其子树，不暴露 Metadata 文件，不允许设定资源修改。未满足激活条件不等于 disabled，仍允许主动查阅宿主可读的正文。

`ctx.setAuthorMode(true)` 使用现有审批请求通道，以独立 `author-mode` 动作申请本轮 Run 的作者视图；无交互处理器默认拒绝。批准后可读取已挂载资源的 disabled 和 Metadata，修改仍需逐项审批。模式不绕过宿主 locked/hidden，不扩大挂载，不产生持久 grant。`false` 恢复游玩视图并清除读取基线，但不能抹去 Transcript 中已披露的信息。

`/narrative/<floor>.md` 是当前绑定分支的固定楼层地址，例如 `/narrative/32.md`；由宿主生成，采样返回的每个节点也附带 `path`。修改正文后楼层路径保持不变，缺号不会重排；读取后目标改变时必须重新读取，不能沿用旧写入基线。VFS 精确路径读取与目录发现复用有界 Narrative sampler，旧历史仍要求单次授权，审批等待沿用暂停预算。目录超过采样预算时明确失败，可改用小范围 `readNarrative` 发现路径。替换复用分支编辑和旧正文校验；Narrative 正文当前不支持 `patch`，该方法仅支持 Workspace 文本与作者模式中的 Prompt Resource 正文。

追加结果只展示简短已保存路径；脚本原样打印 `{ path }` 时不重复展示。后续失败或取消仍保留已完成记录。Narrative VFS 依赖现有默认上下文来源；未配置来源时明确失败，不因此绕过历史权限。

脚本目录列表不读 Blob 字节，文本读取上限为 1 MiB；深度 128、视图 20000 项、搜索源文本 2 Mi 字符是当前显式预算，超限要求缩小范围，不伪装成完整结果。

尚不支持 Session 搜索、任意通用附件/图片索引、多角色挂载管理 UI、Pin 或世界回滚。Narrative 的 VFS 搜索限于授权采样窗口，历史追溯另经审批；作者视图支持已实现的资源节点结构操作与 Metadata 修改。已有 Blob 桥不等于所有资产的所属关系和授权已经接通；未实现方法不在 ctx 中暴露。

### 引用与 UI 跳转

读取观察同时可以生成面向用户的 Markdown 引用。引用不是 VFS 路径，也不是前端路由，而是绑定资源身份、版本和范围的 `loom-resource:` URI：

```markdown
[爱丽丝的人设](loom-resource://prompt-resource?resource=...&node=...&version=2#L12-L18)
```

当前支持三类目标：

- `prompt-resource`：资源 ID、节点 ID、资源版本和正文行范围；
- `state`：State 目标、Revision、JSON Pointer 和 YAML 行范围；
- `script`：脚本文档和版本；

CodeAct 面向模型的读取和搜索结果只保留 VFS 路径、实际行范围与正文或命中片段，不再拼接长 `loom-resource:` URI；资源、State 与脚本搜索遵循相同规则。源正文里作者原有的链接保持原样，不进行字符串清洗。稳定教程要求引用路径与必要行范围，不要求模型构造内部身份链接。已有 URI 查看器继续支持既有消息，但 VFS 路径本身不承诺自动变成可点击的版本化引用。

Studio 将 URI 渲染为可点击引用查看器。查看器按 URI 中的身份和目标读取，不按当前路径或同名节点重新猜测；资源版本或 State Revision 已变化时展示当前内容，但取消旧行号高亮。正文资源可以从查看器进入编辑器；State 引用只读取目标分支，不执行分支切换或写入。URI 只能定位资源，不能绕过 VFS 权限。

### 稳定提示词

默认教程由 CodeAct Tool Definition 的现有 `prompt.guidance` 持久化。当前初始化会同步无扩展来源的官方 Tool Definition；带 origin 的扩展工具按各自来源管理，不能据此声称所有编辑都会跨初始化保留。公共说明及各方法使用统一的用途、签名、参数、返回、示例与限制模板。

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

### VFS 使用契约补充（2026-10-21）

`write / patch / move / delete / create / copy` 的 CodeAct 回执统一为 JSON 对象，直接使用字段，不再返回包含 JSON 的字符串。写入立即生效，后续失败或取消不回滚已提交修改。State 优先结构化读最小目标属性后修改字段，避免手工重建父对象。

字面搜索保留原有范围、all/any 和遍历顺序，增加实际命中词与分离片段，每文件最多六行，省略位置明确标记；不宣称语义检索或相关性排序。路径由目录/搜索原样复用，不对整条路径额外 URL 编码或解码。State patch 在读基线检查前明确报告不支持，不引导模型通过重读反复尝试。

教程将独立探索改为 `Promise.allSettled`，依赖操作顺序 await；能力探测限明确测试目标或临时 Workspace 文件，不以修改真实 State/设定/剧情来检查可用性。Workspace 结构操作不套用 Prompt Resource 的 Metadata 前置要求。

## 扩展预设中的可移植工具引用

扩展 `toolMounts` 可以使用 `reference`：`host` 以 toolId 指向宿主已注册的内置工具；`package` 以 contributionId 指向当前扩展工具；`external` 以 packageId、contributionId、target（global／card）指向声明依赖的扩展工具。旧 `toolId` 单字段仍表示本包工具，不能同时填写 reference。

外部引用要求 manifest.dependencies 声明版本范围，并验证确切安装及工具贡献存在。card 只表示当前 Card 的同包安装，不能借此访问其他 Card，也不自动回退 global。安装把引用解析成真实 toolId，原始引用保存在挂载 origin.toolReference，作者目录导出保留引用而不是固化安装 ID。工具定义仍由提供者拥有；采用不复制定义或执行器，不授予扩展能力或跳过 Agent 审批。

诺姆采用的宿主知识工具示例：

```yaml
toolMounts:
  - reference:
      kind: host
      toolId: official/search_context
    orderIndex: 0
    defaultEnabled: true
```

工具缺少执行注册、模块未激活或权限不足仍由现有执行边界处理，安装成功不能被描述为实际调用一定成功。其他资源的引用能力见[跨资源核对记录](../../../archive/issues/extension-cross-resource-references.md)。
