# Default 预设骨架

## 模板与创建

唯一模板源为 [`default-preset.json`](../../../../packages/application-runtime/src/prompt/default-preset.json)，随 Application Runtime 构建交付。它是普通 `loom.promptResource` JSON，不依赖官方问答包安装、仓库文件路径或额外模板服务。

`createPromptResource({ resourceKind: 'preset' })` 从模板创建独立节点与宏配置；用户可以正常编辑、复制和导出。不会迁移或覆盖已有预设，也不改变官方问答助手的独立模板。新建工具挂载继续默认关闭，作者选择启用，不因增加锚点自动扩大工具权限。

默认正文只提供简短身份、连续性、写作与输出要求，不做模型特化。`writing.style`、`writing.progression`、`writing.output` 是现有宏系统中的配置值，在稳定 Entry 内展开；不是替换锚点。

身份 Entry 的写作 SOP 区分设定资源、State 与 Narrative：仅明确创作并写入请求且实际启用追加工具、绑定剧情时才追加；成功节点回执才算入库，普通答复不产生楼层。无能力时报告不能执行，不能改世界书冒充剧情。模板更新只影响新建预设，不覆盖用户已有 Preset，也不自动启用工具。

## 物理顺序与来源

下表按 JSON 树顺序排列。除 Session 原生消息与当前输入外，默认都是 system 消息。作者角色选项为 system/user/assistant；旧作者 developer 读取为 system，历史运行记录不改写。来源为空且没有普通正文的块不输出消息。提醒、工作区与普通尾部各自拥有独立 MessageBlock。

| 位置 | Anchor / 内容 | 当前来源 |
| --- | --- | --- |
| 稳定前缀 | 身份 Entry、写作宏；`@chat.system`、`@preset.system` | 模板正文；显式指向该位置的资源贡献 |
| 稳定工具说明 | `@chat.tools`、`@runtime.skills` | Content Tool 编译结果；Skills 自动生产尚未接入 |
| 用户设定 | 普通 Entry `{{user.description}}`，随后 `@user.context` | 当前全局用户固定描述；已采用并激活的作者 Lore 补充 |
| 常驻资料 | 包裹 Entry、`@lore.stable` | 指向该位置的 Lore Entry |
| 剧情记忆 | `@memory.narrative` | 已注册剧情记忆来源发布的总结文本 |
| 外部故事正文 | `@narrative.before`、`@chat.narrative`、`@narrative.after` | 独立辅助 Session 采用的正文长文本；主故事 Session 不重复贡献正文；前后补充为显式文本贡献 |
| 工作记忆 | `@memory.workspace`、`@memory.session` | 当前分支 Workspace 根 `MEMORY.md`；当前 Session 最新已保存的工作交接文本 |
| 会话历史（消息序列） | `@chat.session` | 主故事 Session 按记录身份合并仍需保留的正文与工作历史；独立 Session 采用自己的工作历史，保留 role 与工具事实 |
| 本次动态上下文 | `@lore.lower`、`@runtime.state`、`@memory.recalled`、`@chat.session.post`、`@tools.dynamic` | 条件 Lore 与显式贡献；State、召回、动态工具自动生产尚未接入 |
| 最新输入 | `@chat.input` | 当前调用输入，单独 user 消息 |
| 普通尾部 | `@prompt.tail`、`@fresh.tail` | 只留位置 |
| 工作区 | `@runtime.workspace` | 只留位置 |
| 提醒区 | `@runtime.notices` | 只留位置 |

“只留位置”表示编译器可以消费对应 `PromptContribution`，不表示已经存在扩展注册 API、默认生产者或跨 Step 更新机制。不能用一段固定占位说明冒充运行时内容。

用户块使用 system role，位于工具说明之后、常驻资料之前。固定描述使用宏展开，不产生独立运行时 Contribution；作者补充遵守普通 Lore 采用、启用与 Activation 规则。空描述且无补充时不输出该块。已有预设须由用户自行添加宏条目和锚点，不自动重写。

新增 Lore Entry 仍沿用既有 `@chat.system` 默认投影；要放入常驻或动态位置，作者须明确设置目标 Anchor。本次不迁移已有 Lore。

## 原生构建链

```text
Preset 有序树 + 已挂载 Lore + 宏检查结果
辅助 Session：Narrative 采样 -> prompt 文本变换 -> 正文长文本 -> @chat.narrative
主故事 Session：正文与工作记录按身份去重、按 sequence 合并 -> @chat.session
已发布记忆来源 -> @memory.narrative + 固定 Narrative 采样范围
当前分支共享 MEMORY.md -> @memory.workspace
最新 Session 工作交接 -> @memory.session
仍需保留的 Session 消息 / 工具投影 -> @chat.session
当前调用输入 -> @chat.input
已启用 Content Tools -> @chat.tools 或挂载指定位置
  -> SourceNode / PromptContribution
  -> 仅遍历所选 Preset 的骨架
  -> 编译后的 messages[]
  -> Preview / Agent Tool Loop 首次 Provider 请求

已启用 Native Function Tools -> 独立 tools[] -> 同一个 Provider 请求
```

无 `targetAnchorId` 的 Preset Entry 按树位置输出，宏展开与父级 enabled / Activation 同样生效。新建 Preset Entry 不再自动指定 `@chat.system`。已有显式指定目标的 Entry 仍按锚点注入，不再在原位置重复输出；外部资源树不作为第二份骨架直接输出。

MessageBlock 决定内部普通文本的 role。`@chat.session` 是与 Message 同级的原生消息序列，不是文本锚点，不能容纳子节点或作为 Lore/工具说明的文本注入目标；同一预设只放一个。菜单、拖拽和资源写入共用 Shared 放置规则。旧已保存预设中的 Message 包裹仍可编译，保留原生角色与边界；新建、移动和导入不能再创建这种嵌套。当前输入在默认模板里只有一个位置，不另外重复到 Session 尾部。

Session Contribution 可携带原生消息批次：Native 调用与 `tool` 结果、Content 调用块与返回块按已有 Transcript 重建。工具批次不经过正文宏或正则处理，不受外层 role 覆盖，也不会因投影而重新执行工具。未记录结果的调用只说明“执行结果未知”，不补造成功回执。该载荷仅允许 Session 来源使用。

## 当前限制

- Narrative 已消费记忆来源的明确范围，普通追加不改变该基线；未注册来源的旧宿主仍用最近 100 节点并报告诊断。这不是官方记忆插件已经安装的证明。接收接口、采用与迁移限制见 [默认剧情上下文来源](../extension/narrative-context.md)。
- Session 按 100 条分页读取上次工作交接后的整个工作段，并携带最新交接文本；页大小不再充当保留上限。Session 自动交接默认启用：40 楼或上次请求估算达到 200000 Token 时安排生成，默认摘要上限 5000 Token、无历史楼层缓冲、同步采用；策略可配置。正常游玩在下一条正文输入持久化后检查，无楼层输入只检查 Token 压力；失败保留原工作段。这是调度阈值，不保证 Provider 上下文容量。跨 Run 的 Native / Content 调用及结果由结构化 Transcript 重建，不承诺原始响应字节一致或缓存命中。
- 当前 Run 内后续工具调用与结果由原生 Tool Loop 追加，未改它的传输、权限或返回协议。现有 Fresh Context 也是 Tool Loop 的 Step 临时挂载，不宣称已经接入本模板 `@fresh.tail`。
- 新 Preview / Invoke 重新读取已发布剧情视图、共享 `MEMORY.md` 与 Session 工作段；Session 交接结果和共享 MEMORY 在安全边界通过同一事务采用。`@memory.workspace` 已有默认生产者，与仍预留的 `@runtime.workspace / @runtime.notices` 不同。Session 自动交接不等于官方剧情记忆插件的完整调度已验收；稳定内容一致也不等于已验证 Provider 缓存命中。
- 只有默认模板采用这里的排列。作者可以重排自己的树；位置名本身不强制角色、缓存行为或工具权限。

## 验证入口

[`default-preset.test.ts`](../../../../tests/integration/application-runtime/default-preset.test.ts) 使用临时 SQLite 与测试 Gateway，验证创建、复制、宏、Lore、Narrative 文本变换、Session、工具双通道、Preview 与实际请求一致性，以及预留块与编辑位置。

[`compiler.test.ts`](../../../../tests/unit/prompt-builder/compiler.test.ts) 验证骨架隔离、节点开关 / Activation、Session 边界和禁用显式锚点不被旧 fallback 重新注入。自动化验证不代替真实模型的写作效果与缓存测量。

[`default-preset-lifecycle.test.ts`](../../../../tests/integration/application-runtime/default-preset-lifecycle.test.ts) 使用磁盘临时 SQLite 与脚本化模型模拟 105 节点分支剧情、三轮用户交互、七次 Provider 请求、工具实际读写、写后故障、数据库重开、调用前取消及独立 Session。当前使用持久化记忆来源夹具，工具回放和跨轮基线冻结均为普通通过测试；未注册来源的生产迁移路径不由此宣称正确。1～40 楼剧情记忆交接用例另见 `narrative-context.test.ts`；这里的生命周期用例不证明完整自动调度或真实 Provider 容量已经验收。
