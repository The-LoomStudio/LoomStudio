# Application Capability、CLI 与 MCP 适配器计划

> **状态**：提案，等待实施切片确认
> **日期**：2026-08-24
> **范围**：建立 RPC、Agent Tool、CodeAct Script API、CLI 与 MCP 共享的 Application Capability 边界；实现面向用户和外部 Agent 的最小 CLI，并分阶段提供 Loom MCP Server / Client。
> **事实边界**：本文是 Workbench Plan，不是已实现 Architecture。当前已有 Application Runtime RPC、Agent Tool Registry、Provider Tool Transport 和本地 Studio Server；Application Capability Registry、正式 CLI 与 MCP 尚未实现。

相关计划：

- [`agent-runtime-ai-sdk-foundation-plan.md`](./agent-runtime-ai-sdk-foundation-plan.md)
- [`file-backed-resource-agent-script-codeact-plan.md`](./file-backed-resource-agent-script-codeact-plan.md)
- [`ai-gateway-streaming-execution-plan.md`](./ai-gateway-streaming-execution-plan.md)

## 1. 决策摘要

Loom Studio 不为 CLI、MCP、CodeAct 和前端 RPC 分别实现业务逻辑。它们共享同一批 Application Query / Command：

```text
Frontend RPC ───────┐
Agent Tool ─────────┤
CodeAct Script API ─┼──> Application Capability ──> Domain Store
CLI ────────────────┤
MCP ────────────────┘
```

硬边界：

1. Adapter 不直接访问 SQLite、Document Store、PromptResourceStore 或 Blob Root；
2. CodeAct 不通过 HTTP 反向调用前端 RPC；
3. CLI 不直接打开 Studio 数据库；
4. MCP Tool 不绕过 Agent Loop、Approval、Changeset 和权限；
5. Application Capability 接受不同调用方的 Actor / Grant / Correlation Context；
6. 同一业务操作只有一个 canonical input、校验和执行实现；
7. 首版只抽取真实需要跨 Adapter 复用的少量能力，不重写全部 Runtime RPC。

CLI、MCP 与 Bash 的定位不同：

| 能力 | 主要使用者 | 定位 |
| --- | --- | --- |
| CodeAct | Loom 内置 Agent | 复杂循环、判断和组合调用 |
| CLI | 作者、CI、开发者、外部 Code Agent | Headless 自动化与调试入口 |
| MCP Server | 外部 Agent Client | 标准化发现和调用 Loom 能力 |
| MCP Client | Loom 内置 Agent | 使用外部 MCP Tool / Resource |
| Bash | 高权限开发者模式 | 任意本机程序、文件和进程操作 |

首阶段不开放通用 Bash。需要命令式模型表面时，使用不启动 Shell 的受限 Command Router。

## 2. 当前问题

### 2.1 直接复用 Store 会绕过业务边界

Store 只负责自己的持久化不变量，不拥有完整 Application 规则。例如删除 Prompt Resource 还需要检查 Agent Profile、Preset Mount、Card 和 Timeline 引用。CLI、MCP 或 Script 如果直接调用 Store，会绕过：

- Application 级引用校验；
- Permission / Consent；
- ToolInvocation / ToolResult；
- Changeset 与 parentCallId；
- 领域事务；
- 错误归一和审计。

### 2.2 直接包装 RPC 会复制 Transport 约束

前端 RPC 是 Client / Server wire adapter，可能包含 UI 专用分页、下载或连接语义。CodeAct 和 MCP 不应通过 JSON-RPC 套壳才能调用本机业务能力。

正确关系是：

```text
RPC handler
  -> Application Capability

CodeAct proxy
  -> Application Capability

CLI / MCP adapter
  -> Application Capability
```

### 2.3 Tool Registry 与 Application Capability 不完全相同

Tool Definition 是模型可见描述和调用投影。Application Capability 是 Server 内部可授权执行的 Query / Command。

不是每个 Query 都需要进入 Provider 顶层 `tools[]`：

```js
await loom.promptResources.list()
```

可以是 Script SDK 能力，但不必成为模型直接看到的独立 Tool。产生领域 Mutation 的 Script API 首版必须通过 Tool Registry 或显式 Application Command 执行。

## 3. Application Capability 最小合同

### 3.1 Capability Definition

建议从最小内部类型开始：

```ts
type ApplicationCapabilityMode = 'query' | 'command'

type ApplicationCapability = {
  id: string
  mode: ApplicationCapabilityMode
  requiredGrants: string[]
  inputSchema: JsonObject
  outputSchema?: JsonObject
  execute(
    context: ApplicationCapabilityContext,
    input: JsonValue,
  ): Promise<JsonValue>
}
```

```ts
type ApplicationCapabilityContext = {
  actor: DataActorRef
  caller: 'rpc' | 'tool' | 'script' | 'cli' | 'mcp'
  grants: string[]
  correlationId?: string
  callId?: string
  parentCallId?: string
  abortSignal?: AbortSignal
}
```

约束：

- 输入输出必须可序列化；
- 不返回 Store、Stream、文件描述符、Host Object 或物理路径；
- Command 必须产生明确 Mutation / Changeset 或说明没有副作用；
- Capability ID 稳定，不使用 UI 文案；
- Adapter 可以增加展示名称，但不能改变业务语义；
- Capability Registry 不成为新的 Service Locator。

### 3.2 Query 与 Command

Query：

- 读取 Prompt Resource；
- 列出 Agent Script；
- Prompt Build Preview；
- 查看 Session / Run 状态；
- 读取 Artifact metadata。

Command：

- 更新 Prompt Entry；
- 替换 Mount；
- 运行 Script；
- 创建 Artifact；
- 提交 Narrative Mutation。

首版优先抽取 Query。Command 只有存在至少两个 Adapter 消费同一操作时才进入 Registry，避免形式主义迁移。

### 3.3 Adapter Projection

同一个 Capability 可以投影为：

```text
Capability: prompt.preview

RPC:
  application.previewPrompt

CLI:
  loomctl prompt preview

MCP Tool:
  prompt_preview

Script API:
  loom.promptBuild.preview()
```

名称可以适配目标协议，但输入、权限和核心执行不重复实现。

## 4. CLI 设计

### 4.1 产品定位

CLI 主要面向：

- 作者批量操作；
- CI 和回归测试；
- Headless 导入导出；
- 开发诊断；
- Codex、Claude Code 等外部 Code Agent；
- 本地脚本和自动化工具。

它不是 Loom 内置 Agent 的默认执行方式，也不等于 Bash。

建议命令名暂定：

```text
loomctl
```

### 4.2 连接方式

正式 CLI 通过本地 Studio Server 的受认证接口调用 Application，不直接加载数据库：

```text
loomctl
  -> discover local Studio Server
  -> authenticate local session
  -> call RPC / Capability endpoint
  -> format result
```

测试可以注入 Application Runtime，但正式 CLI 不建立第二个组合根，也不在 Studio Server 运行时并发打开同一个数据库。

### 4.3 命令形态

第一批只做低风险命令：

```bash
loomctl status
loomctl cards list --json
loomctl presets list --json
loomctl scripts list --preset <id> --json
loomctl prompt preview --preset <id> --input <text> --json
loomctl sessions show <id> --json
```

第二批再增加：

```bash
loomctl scripts run <script-id> --input-file input.json
loomctl resources export <id> --output <path>
loomctl cards import <path>
```

CLI 默认 human-readable，`--json` 输出稳定机器格式。大正文和二进制不通过 stdout JSON base64，使用明确 input / output file。

### 4.4 受限 Agent Command Router

如果模型需要 CLI 语法，提供：

```ts
type LoomCommandInvocation = {
  argv: string[]
}
```

例如：

```json
{
  "argv": [
    "prompt",
    "preview",
    "--preset",
    "preset-1",
    "--input",
    "进入战斗"
  ]
}
```

Runtime 直接进入 Command Parser，不执行：

```text
/bin/sh
bash
zsh
cmd.exe
PowerShell
```

禁止管道、重定向、命令替换、环境变量展开和任意外部程序。Command Router 只认识 `loomctl` 自身子命令。

### 4.5 CLI 不替代 CodeAct

循环和条件逻辑继续优先使用 CodeAct：

```js
for (const resource of await loom.promptResources.list()) {
  if (shouldUpdate(resource)) await loom.tools.call('update-resource', resource)
}
```

不鼓励为了相同行为引入 Shell、`jq` 和 `xargs`。

## 5. MCP Server

### 5.1 定位

Loom 作为 MCP Server，使外部 Agent 能发现和调用 Loom 能力：

```text
External Agent Client
  -> MCP
  -> Loom MCP Adapter
  -> Application Capability
```

MCP 不拥有 Session、Tool Registry、Prompt Build 或 Mutation 权威。

### 5.2 第一阶段只读能力

建议先暴露 Resources：

```text
loom://cards/{id}
loom://presets/{id}
loom://scripts/{id}
loom://sessions/{id}
loom://runs/{id}
```

以及少量只读 Tools：

```text
list_cards
list_presets
list_scripts
preview_prompt
read_session_transcript
```

资源正文需要大小上限和分页；脚本默认只返回 metadata，源码读取需要单独 Grant。

### 5.3 写能力

写 MCP Tool 延后到认证、Consent 和 Changeset 展示稳定后：

```text
update_prompt_entry
run_script
import_card
export_resource
```

所有写调用必须：

- 创建独立 Actor / caller context；
- 执行 Capability Grant；
- 关联 Changeset；
- 返回明确 Mutation Receipt；
- 支持 Abort；
- 不复用浏览器 Client 的隐式全权限。

### 5.4 生命周期与认证

MCP Server 默认由 Studio Server 组合根创建，不由 Extension 任意开启监听端口。首版优先使用本地 transport；远程监听、跨设备认证和公开网络部署不在当前范围。

## 6. MCP Client

### 6.1 定位

Loom 作为 MCP Client，使内置 Agent 使用外部服务：

```text
Loom Agent
  -> Studio ToolInvocation
  -> MCP Client Adapter
  -> External MCP Server
  -> Studio ToolResult
```

外部 MCP Tool 必须导入现有 Tool Registry，而不是建立第二套 Agent Tool Loop。

### 6.2 Tool 映射

```text
MCP server + tool name
  -> stable Workspace Tool ID
  -> Tool Definition
  -> Preset Tool Mount
  -> Agent Profile quick override
  -> Studio Invocation / Result
```

需要保存：

- Server identity；
- Tool schema snapshot；
- exposed name；
- timeout / retry policy；
- Credential reference；
- Provider / Content projection；
- Server disconnect observation。

### 6.3 风险

MCP Client 会引入：

- 外部进程和网络生命周期；
- 凭证与 Secret；
- Tool ID 冲突；
- Schema 漂移；
- Server 不可用和重连；
- 大 Result；
- 外部副作用审批；
- Session 恢复时的 Server snapshot。

因此它晚于只读 MCP Server，并需要独立实施切片。

## 7. Bash 边界

通用 Bash 首版不实现。以下需求不构成开放 Bash 的理由：

- 运行 Loom CLI；
- 批量调用 Loom API；
- 执行角色 Agent Script；
- 读取 Workspace Resource；
- 调用 MCP Tool。

这些分别由 Command Router、CodeAct、Script Runtime、Resource API 和 MCP Adapter 处理。

只有出现明确需求时才规划 Trusted Bash：

- 调用用户本机编译器或媒体工具；
- 操作真实 Authoring Folder；
- Git / npm / ffmpeg 等开发工作流；
- 用户明确授予主机级权限。

Trusted Bash 必须与普通 Agent Profile、导入角色脚本和 `loom-js` Capability 分离。

## 8. 分阶段实施

### Phase 0：Capability Slice Spike

目标：验证同一业务能力可以被 RPC、Script 和测试 Adapter 共用。

任务：

1. 定义最小 Capability Context；
2. 抽取 `prompt.preview` 和 `script.list` 两个 Query；
3. 现有 RPC 改为调用 Capability；
4. CodeAct Script API 调用同一 Capability；
5. 不建设通用自动注册或代码生成。

验证：RPC 与 Script 输入相同，得到等价业务结果；权限 Actor 和 Correlation 仍可区分。

### Phase 1：只读 CLI

目标：提供开发、测试和外部 Agent 可使用的 Headless 入口。

任务：

1. 新增 `loomctl` package / executable；
2. 实现本地 Server 发现和认证；
3. 实现 status、list、preview、session show；
4. 支持 human / `--json` 输出；
5. 错误码和 exit code 稳定；
6. 不支持 Shell 表达式。

验证：运行中的 Studio Server 可被 CLI 查询；CLI 不打开 SQLite；JSON 输出可由自动化稳定消费。

### Phase 2：受限 Command Router

目标：允许 Agent 或 Script 使用 CLI 风格，而不开放 Bash。

任务：

1. Command Parser 接受 `argv[]`；
2. 复用 CLI command definitions；
3. 调用 Application Capability；
4. 禁止外部程序、重定向和环境变量；
5. 记录 canonical Invocation / Result。

验证：恶意 `; rm`、管道、命令替换只作为普通参数或被拒绝，不进入系统 Shell。

### Phase 3：只读 MCP Server

目标：让外部 Agent 读取 Loom Workspace 并执行 Prompt Preview。

任务：

1. Studio Server 组合根创建 MCP Adapter；
2. 映射 Card、Preset、Script、Session Resources；
3. 映射只读 Capability Tools；
4. 增加本地认证、分页、大小上限和日志；
5. 不开放 Script source 和写权限默认访问。

验证：外部 MCP Client 可列出和读取授权资源；越权、超限和不存在资源返回稳定错误。

### Phase 4：CLI / MCP 写 Command

目标：在 Consent 和 Changeset 边界成熟后开放少量写操作。

任务：

1. 选择一个低风险 Command，例如 Script 手动运行；
2. CLI 要求显式确认或非交互批准参数；
3. MCP 使用独立 Grant；
4. 返回 Changeset / Mutation Receipt；
5. 幂等键和重试边界明确；
6. 不开放通用 Store mutation。

验证：拒绝、成功、Abort、网络重试和重复请求不会产生无法解释的双写。

### Phase 5：MCP Client

目标：把外部 MCP Tool 纳入 Studio Tool Registry。

任务：

1. MCP Server Profile / Credential；
2. Tool discovery 和 schema snapshot；
3. Workspace Tool ID 映射；
4. Preset Mount / Agent Override；
5. Invocation、Result、timeout、disconnect；
6. Session 恢复和 schema drift 诊断。

验证：外部 Tool 与官方 Tool 共享 Agent Loop、Approval 和 Transcript；Server 失联不会被误判为成功或 Agent completed。

## 9. 测试与验证

### Capability

- RPC / Script / CLI / MCP 输入映射一致；
- caller、Actor、Grant、callId、parentCallId 正确；
- Query 无副作用；
- Command 返回 Changeset；
- 输入输出只含可序列化值；
- Adapter 无 Store 逃生口。

### CLI

- exit code；
- stdout / stderr 分离；
- `--json` 稳定；
- Server 不存在、未认证、超时和 Abort；
- 大输出使用文件或分页；
- 不打开 SQLite；
- Command Router 不启动 Shell。

### MCP Server

- Resource / Tool discovery；
- 本地认证；
- Grant；
- 分页与大小限制；
- Script source 默认不可读；
- Changeset 与审计；
- Client disconnect 和取消。

### MCP Client

- Tool schema snapshot；
- Server / Tool ID 冲突；
- Result 大小；
- timeout / reconnect；
- 外部错误归一；
- Agent Session replay；
- Provider Tool Transport 与 MCP Transport 不混淆。

## 10. 明确非目标

第一轮不实现：

- 重写全部 Application RPC；
- 自动从 Schema 生成所有 Adapter；
- CLI 直接数据库模式；
- 通用 Bash / PowerShell；
- 远程公开 MCP Server；
- MCP Marketplace；
- Extension 任意注册监听端口；
- 所有 MCP Tool 自动授权；
- 把 MCP Prompt 当成 Loom Prompt Resource；
- 用 CLI 文本输出作为内部 canonical Result；
- 一个万能的 Service Locator / Repository。

## 11. 推荐首个切片

最小闭环：

```text
Application Capability
  ├── prompt.preview
  └── agent-script.list

Adapters
  ├── existing RPC
  ├── CodeAct read-only API
  └── loomctl read-only CLI
```

验收条件：

1. 三个 Adapter 不复制业务查询逻辑；
2. CLI 连接运行中的 Studio Server，不读取数据库文件；
3. CodeAct 只获得授权后的 Query；
4. RPC 行为保持不变；
5. callId、caller 和 Actor 可在日志中区分；
6. 没有新增 Bash、MCP Client 或写权限。

完成该切片后，再根据外部 Agent 的真实需求决定先做只读 MCP Server，还是扩展 CLI 写命令。
