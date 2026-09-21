# Default 预设骨架

## 模板与创建

唯一模板源为 [`default-preset.json`](../../../../packages/application-runtime/src/prompt/default-preset.json)，随 Application Runtime 构建交付。它是普通 `loom.promptResource` JSON，不依赖官方问答包安装、仓库文件路径或额外模板服务。

`createPromptResource({ resourceKind: 'preset' })` 从模板创建独立节点与宏配置；用户可以正常编辑、复制和导出。不会迁移或覆盖已有预设，也不改变官方问答助手的独立模板。新建工具挂载继续默认关闭，作者选择启用，不因增加锚点自动扩大工具权限。

默认正文只提供简短身份、连续性、写作与输出要求，不做模型特化。`writing.style`、`writing.progression`、`writing.output` 是现有宏系统中的配置值，在稳定 Entry 内展开；不是替换锚点。

## 物理顺序与来源

下表按 JSON 树顺序排列。除 Session 与当前输入外，默认都是 system 消息；剧情块默认 developer。来源为空且没有普通正文的块不输出消息。提醒、工作区与普通尾部各自拥有独立 MessageBlock。

| 位置 | Anchor / 内容 | 当前来源 |
| --- | --- | --- |
| 稳定前缀 | 身份 Entry、写作宏；`@chat.system`、`@preset.system` | 模板正文；显式指向该位置的资源贡献 |
| 稳定工具说明 | `@chat.tools`、`@runtime.skills` | Content Tool 编译结果；Skills 自动生产尚未接入 |
| 常驻资料 | 包裹 Entry、`@setting.stable` | 指向该位置的 Setting Entry |
| 剧情基线 | `@narrative.before`、`@memory.narrative`、`@chat.narrative`、`@narrative.after` | Narrative 投影已接入；记忆及前后补充只留位置 |
| 工作记忆 | `@memory.session` | 只留位置 |
| Session 原生消息 | `@chat.session` | 持久化 Session 的文本消息及显式允许回放的 reasoning |
| 本次动态上下文 | `@setting.lower`、`@runtime.state`、`@memory.recalled`、`@chat.session.post`、`@tools.dynamic` | 条件 Setting 与显式贡献；State、召回、动态工具自动生产尚未接入 |
| 最新输入 | `@chat.input` | 当前调用输入，单独 user 消息 |
| 普通尾部 | `@prompt.tail`、`@fresh.tail` | 只留位置 |
| 工作区 | `@runtime.workspace` | 只留位置 |
| 提醒区 | `@runtime.notices` | 只留位置 |

“只留位置”表示编译器可以消费对应 `PromptContribution`，不表示已经存在扩展注册 API、默认生产者或跨 Step 更新机制。不能用一段固定占位说明冒充运行时内容。

新增 Setting Entry 仍沿用既有 `@chat.system` 默认投影；要放入常驻或动态位置，作者须明确设置目标 Anchor。本次不迁移已有 Setting。

## 原生构建链

```text
Preset 有序树 + 已挂载 Setting + 宏检查结果
Narrative 当前分支窗口 -> 既有 prompt 阶段文本变换 -> @chat.narrative
Session 文本投影 -> @chat.session
当前调用输入 -> @chat.input
已启用 Content Tools -> @chat.tools 或挂载指定位置
  -> SourceNode / PromptContribution
  -> 仅遍历所选 Preset 的骨架
  -> 编译后的 messages[]
  -> Preview / Agent Tool Loop 首次 Provider 请求

已启用 Native Function Tools -> 独立 tools[] -> 同一个 Provider 请求
```

无 `targetAnchorId` 的 Preset Entry 按树位置输出，宏展开与父级 enabled / Activation 同样生效。新建 Preset Entry 不再自动指定 `@chat.system`。已有显式指定目标的 Entry 仍按锚点注入，不再在原位置重复输出；外部资源树不作为第二份骨架直接输出。

MessageBlock 决定普通文本的 role。Session 来源例外：保留各条消息原有角色和边界，不因外层包裹而全部变成 system，也不合并相邻的同角色历史消息。当前输入在默认模板里只有一个位置，不另外重复到 Session 尾部。

## 当前限制

- Narrative 仍使用现有分支最近 100 节点窗口，经已有 Text Pipeline 处理；不是新的范围采样器，也没有 Token 驱动预算。
- Session 仍读取最近 100 个 Transcript Entry，再投影文本消息；这不等于 100 轮。跨 Run 的历史 tool-invocation / tool-result 完整协议回放尚未补齐。本切片只修复已有文本投影的角色与边界。
- 当前 Run 内后续工具调用与结果由原生 Tool Loop 追加，未改它的传输、权限或返回协议。现有 Fresh Context 也是 Tool Loop 的 Step 临时挂载，不宣称已经接入本模板 `@fresh.tail`。
- 新 Preview / Invoke 仍按现有流程重新准备上下文；跨交互冻结 Narrative 基线、Session Memo、摘要版本切换与 Workspace / Notice 刷新留待生命周期切片。稳定前缀排序不等于已验证 Provider 缓存命中。
- 只有默认模板采用这里的排列。作者可以重排自己的树；位置名本身不强制角色、缓存行为或工具权限。

## 验证入口

[`default-preset.test.ts`](../../../../tests/integration/application-runtime/default-preset.test.ts) 使用临时 SQLite 与测试 Gateway，验证创建、复制、宏、Setting、Narrative 文本变换、Session、工具双通道、Preview 与实际请求一致性，以及预留块与编辑位置。

[`compiler.test.ts`](../../../../tests/unit/prompt-builder/compiler.test.ts) 验证骨架隔离、节点开关 / Activation、Session 边界和禁用显式锚点不被旧 fallback 重新注入。自动化验证不代替真实模型的写作效果与缓存测量。

[`default-preset-lifecycle.test.ts`](../../../../tests/integration/application-runtime/default-preset-lifecycle.test.ts) 进一步使用磁盘临时 SQLite 与脚本化模型模拟 105 节点分支剧情、三轮用户交互、七次 Provider 请求、工具实际读写、写后故障、数据库重开、调用前取消及独立 Session。该测试明确保留两条预期失败合同：跨轮工具事实回放、跨交互 Narrative 基线冻结。不能把测试命令退出成功解释成整个生命周期已经正确；详情见 [Plan 第 13 节](../../../workbench/plans/agent-context-skeleton-and-memory-projection-plan.md#13-多轮-agent-生命周期仿真验收2026-09-21)。
