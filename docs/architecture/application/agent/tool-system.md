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

Content Tool Description 作为外部 Runtime Source 进入 PromptBuild。Zone 表达出现区域，Slot 表达来源所有权：

```text
tools zone
  official-tools
  extension:weather-tools
  extension:other-tools
```

官方 Tool 不拥有整个 `tools` Zone。Extension、角色、Setting 或其他外部来源以后可以贡献自己的 Slot；卸载一个来源只移除自己的 Slot。

## 8. 实现来源

- [`packages/application-runtime/src/agents/tool-registry.ts`](../../../../packages/application-runtime/src/agents/tool-registry.ts)
- [`packages/application-runtime/src/agents/content-transport.ts`](../../../../packages/application-runtime/src/agents/content-transport.ts)
- [`packages/application-runtime/src/agents/tool-prompt-build.ts`](../../../../packages/application-runtime/src/agents/tool-prompt-build.ts)
- [`packages/application-runtime/src/agents/tool-loop.ts`](../../../../packages/application-runtime/src/agents/tool-loop.ts)
- [`packages/prompt-resource-store/src/types.ts`](../../../../packages/prompt-resource-store/src/types.ts)
