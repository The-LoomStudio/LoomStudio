# Agent 预设使用配置、Session 与资源工作台

状态：2026-10-01 本阶段后端与正式 UI 实施完成，聚焦验证通过；等待人工交互与真实模型验收。  
日期：2026-10-01。  
本轮授权：继续后端 B1-B4、前端 U1/U2 与草稿一致性修订；保留已做局部改动和工作区无关修改。

## 目标

扩展包继续负责分发，预设通过使用配置选取资源，运行上下文决定本次生效。
可执行代码与业务自动化由扩展编排；平台提供必要上下文、事件和调用结果，不建立独立预设代码实例。
主写作 Session、当前查看的 Session、工作台资源浏览互不误改。
子 Agent 使用的资源从预设详情跳转到对应编辑器，临时打开不改变使用配置、不切换主写作。

## 已确认决定

- 不恢复 Agent Profile，不新增独立预设安装包。完整配套预设以轻量扩展分发，纯骨架仍可按单资源导出。
- SQL 保留独立资源身份与版本，使用配置持久化。来源/所有者仍是用户、角色、扩展；不新增预设来源、所有权或资源父子关系。
- 区分包来源/安装目标、资源归属、使用引用、运行生效范围和状态存储范围。
- Settings、正则、工具等使用已有或必要的引用配置表达采用关系，不区分“预设内部专属”与“外部引用”两种机制。
- 扩展可提供默认使用配置，导入为正常可编辑挂载；注册资源不等于执行或全局启用，只有一个使用者也不改变所有权。
- 同一内容可被多个预设使用，各自的使用开关/顺序不改写共享定义；平台不为了这种复用自动复制资源。
- 预设可以被不同运行上下文使用；停止其中一次运行不得终止其他调用。不据此直接增加长期预设实例系统。
- 简化生命周期：复用扩展模块与 Agent Run 的已有生命周期，不建设预设子进程、功能自动启停或通用自动化调度器。
- 区分“指定主写作接收 Session”与“实际执行 Prompt Build/Agent Run”。前者提供选择状态及变更通知，后者提供调用身份、上下文、结果与取消能力。
- 扩展自行决定专属 UI、监听、定时任务、返回解析与数据写入。切换主写作不自动 Disable 整个扩展；用户显式停用仍走现有模块释放。
- 平台按本次预设解析声明式资源属于正常执行职责，不视为自动化；扩展副作用不因静态资源归属自动获得启停管理。
- 主写作是 Narrative 输入的目标 Session，不是预设永久的主/子类型。预设不再另设独立主选择状态。
- Session 创建时确定 Agent Preset，之后不能原地换预设；换预设通过新建或选择另一个 Session 完成。此决定覆盖此前保留改绑的方案。
- Session 与 Agent Preset 有稳定归属/绑定；该关系不代表删除预设时级联删除会话，也不替代权限或扩展任务所有权。
- Session 列表的加号选择预设创建对话。扩展使用完整 Agent 能力时可创建自己的 Session，正常显示并允许用户打开对话；直接 Invoke 不强制创建 Session。
- 新建 Session 时明确提供“设为主写作对话”选项；不因创建或打开会话隐式更换主接收方。
- 查看其他 Session 不自动成为 Narrative 输入目标。主写作接收 Session 与当前查看 Session 分离，注册表仍不加预设选择器。
- 主写作接收方变化时，注册表“当前使用”根据该 Session 的预设刷新；查看子 Agent 不改变这套集合。
- 生成期间不更换主写作接收方。暂停后若改用其他预设/Session，不能继续旧任务，需重新发消息；旧历史和已提交副作用保留。
- 不建设跨预设历史工具转换；新 Session 不自动继承旧 Transcript、工具执行状态或 continuation。
- 换 Session 不等于换 Timeline；临时创作对话的输入和回复不得自动写入剧情正文。
- 从预设详情跳到 Settings/正则等编辑页。目标不在当前集合时，临时目录替换显示，不追加到主写作集合。
- 临时打开可编辑原资源；顶部历史返回恢复原页面和选中项。打开/返回都不能安装、启用或挂载资源。
- 全部资源保持可浏览；静态“选入/启用”不伪装成本轮已触发。动态触发结果归调试。
- 公共 Settings 来源不默认注入，由用户显式配置采用；角色世界书可以默认选入但可取消，不能因为角色归属或 Timeline 关联被强制注入。
- Settings 的来源选择属于预设/资源使用配置，不因只读浏览发生变化；取消使用不删除原资源。此规则不覆盖已确认默认参与的全局公共正则。

## 当前事实与复用入口

以下为 2026-10-01 源码核对；实施暂停前已做少量改动，不把存在类型/导入记录当作运行闭环。

| 当前事实 | 入口 |
| --- | --- |
| PromptResource 按资源、节点、修订存储，节点有 parent_id；版本冲突仍为资源级 | [schema](../../../packages/application-data/src/prompt-resource/schema.ts)、[mutations](../../../packages/application-data/src/prompt-resource/mutations.ts) |
| Settings 与工具已有独立 Mount 结构 | [mounts](../../../packages/application-data/src/prompt-resource/mounts.ts) |
| 扩展导入保存 settingMounts、toolMounts、scriptMounts；后者指向预设 | [扩展导入](../../../packages/application-runtime/src/runtime/extensions-runtime.ts) |
| 暂停前已把全局 Settings 自动收集改为当前预设 Mount；来源与角色选择、往返和 UI 仍未完成 | [agent-turn](../../../packages/application-runtime/src/agents/agent-turn.ts) |
| 正则已有 preset owner 匹配；扩展规则的 owner 与 origin 需要保留区分 | [文本管线](../../../packages/application-runtime/src/runtime/transforms-runtime.ts)、[规则类型](../../../packages/application-runtime/src/transforms/history-text.ts) |
| 暂停前已移除 Session 改绑字段并在 Store/Runtime/RPC 拒绝额外字段；主接收方分离仍未完成 | [Session 类型](../../../packages/application-data/src/agent/types.ts)、[Agent Runtime](../../../packages/application-runtime/src/runtime/agents-runtime.ts) |
| Extension Host 有模块作用域、取消与 dispose；这不是预设使用实例管理 | [Host 实例](../../../packages/extension-sdk/extension-host/src/instance.ts) |
| 已有逐次 Prompt 附加、独立 build、显式 invokeModel | [已实施 API 计划](./extension-prompt-and-model-api-plan.md) |
| 正式导航支持资源引用目标，已有 Settings 临时打开入口；其他类别需逐项核实接线 | [导航](../../../apps/studio-client/src/shared/studio-shell/use-studio-navigation.ts)、[资源面板](../../../apps/studio-client/src/app/studio-resource-panels.tsx) |
| VFS 是 ID/版本绑定的目录投影，不要求整包 JSON 存储 | [资源 VFS](../../../packages/application-runtime/src/vfs/resource-filesystem.ts) |

已确认草稿：
[工作台](../../../apps/studio-client/src/dev/preview/resource-registry/resource-registry-workbench.tsx)、
[样例](../../../apps/studio-client/src/dev/preview/resource-registry/resource-registry-preview.tsx)、
[预设详情](../../../apps/studio-client/src/dev/preview/resource-registry/agent-preset-detail.tsx)。
地址：`http://localhost:5173/dev/preview/resource-registry`。
只继承本计划列出的交互，不照搬旧草稿中的外部只读、公共挂载操作或所有布局。
草稿的主预设星标和临时对话入口已被最新 Session 方案替代，不能按旧草稿直接接业务。
草稿中的“预设专属”目录和标签也已撤回，正式 UI 应显示“此预设使用的资源”，不是所有权子目录。

## 引用关系的最小合同

- 预设是运行前置的声明式消费配置，不承担扩展安装、代码生命周期、执行权限或 Transcript 持久化。
- 本地使用配置引用稳定的资源/工具 ID，不用名称或文件路径作为身份。重命名和目录投影变化不应断开引用。
- Settings 优先复用 Setting Mount，工具复用 Preset Tool Mount；正则按现有规则身份增加必要使用配置，不造统一万能绑定表。
- 现有 `SettingMount.source.kind = preset` 表示挂载的消费位置，不表示 Setting 的作者来源或所有者；保留概念区分，不为词名重新造存储。
- 扩展分发使用包内局部贡献 ID，导入通过现有映射解析为安装后的领域 ID；外部引用需要明确的解析合同，不写死另一台机器的数据库 ID。
- 外部引用与包内局部 ID 必须区分；有扩展来源时用包与贡献身份在合法安装上下文中解析。用户自有资源没有可移植来源时保留原身份为未解析引用，不将异机数据库 ID 冒充已解析本地资源，不建设自动依赖安装器。
- 引用不代表归属，也不触发递归打包或自动复制依赖。导出只包含实际纳入扩展文件与贡献清单的资源；外部资源须经显式复制或移动改变归属后才进入包。
- 预设的显式使用配置优先于全局配置，包括排除默认参与的公共正则；未配置项按已确认的公共/角色默认规则处理。
- 配套资源不可用时保留原引用及未解析状态，使用处显示为空并提供可见诊断，不静默替换、删除或默认阻断运行。是否必需由扩展作者决定；预设本身不可用仍拒绝启动。
- 不在预设 JSON 和关系表同时保存同一份成员清单；面板读取持久化使用关系生成列表。
- 编辑资源定义影响其引用者；修改某预设的采用配置只影响该预设。解绑不删除资源，删除预设不级联删除被使用资源。
- 复制预设默认复制使用配置并继续引用原资源，不把内容复制隐含为所有权操作；显式复制资源仍走既有创建新身份流程。
- 采用关系与内容更新分开：后续构建读取当前定义，不为每个 Session 固定一套资源版本；正在运行的输入仍按已有冻结边界处理。

## 后端实施阶段

### B1：使用配置与引用往返

写入边界：`packages/application-data/src/prompt-resource/`、
`packages/application-runtime/src/runtime/extensions-runtime.ts`、`src/transforms/`、
`packages/extension-sdk/src/index.ts`、必要的 Shared 合同与 Server 扩展解析/编解码。

1. 列出 Settings、正则/提取器、工具、宏、脚本现有定义/来源/使用配置的对照表，确定每一项唯一权威字段。
2. 复用 Settings/工具 Mount，为缺少的正则采用关系补必要配置；保留资源原来源，不加 preset 所有者或文件夹嵌套约束。
3. 同包局部 ID 导入时解析为稳定领域 ID，校验预设存在、类型、安装边界；更新/导出/复制时保留或正确重映射。
4. 保留现有共享工具挂载；作者宏继续使用已有预设配置，不拆成新的宏资源库。
5. 预设删除只处理其使用配置；资源删除/扩展更新后保留失效引用与可见诊断，不顺带删除使用者的 Transcript/State。包更新仍遵循既有覆盖策略，不另外保存旧预设副本。
6. 旧 preset-owner 正则和已有 scriptMount 等分别记录迁移/复用方案，不按名称推断、不把现有所有者字段直接视作新使用表。

完成标准：两个预设可采用同一规则并保存独立使用配置；导入/导出再导入引用正确解析；
独立编辑无需改写整包；无重复成员真值，解绑和删预设不删除共享定义。

### B2：统一选择有效资源

写入边界：`packages/application-runtime/src/agents/agent-turn.ts`、
`src/runtime/agents-runtime.ts`、`src/runtime/transforms-runtime.ts`、
现有宏/工具编译消费者、`src/types.ts`、必要 RPC 合同。

1. 基于调用预设的使用配置和合法角色/安装上下文收集资源；不基于当前 UI 选中项或资源“属于某预设”。
2. 接通预设 Settings 的实际消费，合并所配置来源与显式 Mount；按身份去重，保留顺序与来源。
   公共来源只有被显式配置采用后才进入候选集合；角色默认世界书支持取消选入。不要无条件合并全部全局 Mount 或强制合并全部角色 Settings。
3. Preview/Run 使用同一准备路径；资源启用后仍经过 Activation、关键词、宏等已有规则。
4. 正则/提取器按公共规则和当前预设的使用配置参与，不依赖新增预设所有权；预设显式配置优先于全局配置，同一规则被预设禁用时不能因公共来源再次加入。
   子 Agent 默认采用全局公共正则；角色自有正则是否参与取决于明确的角色处理上下文，不因 Session 出现在同一面板就自动纳入。
5. 复用已有工具挂载和逐次 promptAddition，不能新增绕过权限的第二套候选集。
6. 运行开始固定本次资源输入；后续切换不能让旧 Run 的输出改用新预设处理。
7. 历史 Display 与无消费者上下文的处理不能任意套用当前 UI 预设，按下方待定项单独收束。

完成标准：只被 A 选入的资源不自动进入 B；独立后台 C 不受主写作切换影响；
Preview 与 Run 相同输入下收集一致，未触发条目不伪装成已注入。

### B3：事件、调用上下文与扩展自主编排

写入边界：`packages/application-runtime/src/runtime/`、`src/types.ts`、
`packages/extension-sdk/src/index.ts`、`packages/extension-sdk/extension-host/src/`、
`apps/studio-server/src/main.ts` 及必要 host/RPC 接线。

1. 核对已有事件/RPC/调用句柄，记录主选择读取与变更、Prompt Build、Agent Run 结果/失败/取消的覆盖与缺口，优先复用而非重复发明。
2. 只为实际扩展消费者补齐事件和上下文。主选择变更是配置事实，不等于启动 Run；构建和执行的通知也不能混成一个“预设启用”事件。
3. 扩展主动调用总结/整理预设时直接等待返回再解析、存储；观察其他入口发起的运行才消费相应事件，不强制一切结果走全局监听。
4. 事件携带必要的预设、运行和合法上下文标识，明确提交/发出时点、先后顺序和订阅释放；不因订阅事件开放其他安装或用户上下文的私有数据。
5. 区分只读事实通知与可影响 Prompt 的贡献接口。事件监听不能被隐含用作阻塞构建、修改结果或启动计费调用的自动钩子。
6. 专属 UI 与持续监听由扩展依据主选择自行管理；预设切换不自动停用包。平台仅按既有模块作用域清理平台托管注册和取消信号，不接管业务自动化。
7. 不新增预设代码子进程、长期实例管理器或生命周期 SDK；已有 `.loom.js` 渲染合同与直接 Invoke 保持各自边界。

完成标准：扩展能辨认主选择变化与实际调用；主动调用能获取自己的结果，授权订阅能观察所需事实；
切换不会隐式停用扩展或调用模型；订阅释放与现有权限边界不被削弱。
旧版“所有预设都创建使用实例并托管脚本”的任务清单已撤回。

### B4：固定预设 Session 与主写作接收方

写入边界：现有主写作配置实际所有者、`packages/application-data/src/agent/`、
`packages/application-runtime/src/runtime/agents-runtime.ts`、
`src/runtime/narrative-runtime.ts`、`apps/studio-server/src/rpc/handlers/application/`。

1. 移除 Session 更新合同中的预设改绑能力，核对 Store、Runtime、RPC、Client 真实调用者一并调整；保留标题等其他更新。
2. 用 Session 标识主写作接收方，不同时持久化另一个主预设 ID。现有主选择仅为客户端本地选择，没有后端持久路由；本阶段复用客户端本地持久选择模式，按现有 Session.timelineId 恢复合法接收关联，不新增通用配置表或 Timeline 预设偏好。当前查看 Session 与该选择分离。
3. 新建 Session 显式选择预设；选择现有 Session 不修改它的预设。新建不自动复制旧 Transcript/工具执行状态。
4. 生成期间拒绝更换主接收方。暂停后改用其他接收方要显式结束旧任务的恢复资格并提示重新发消息，不能恢复到新的 Session。
5. Narrative 输入只投递指定主 Session；普通 Session 输入只发往该 Session。Timeline 关联和正文写入工具权限仍独立校验。
6. 扩展创建的 Session 复用已有创建/运行/查询合同，保留合法来源与权限边界；展示它不启动新任务，不授予其他角色资源权限。
7. 旧 Run 的异步完成只进入原 Session，不混入新主对话。预设失效时保留 Session 历史并明确拒绝新运行，不静默换预设。

完成标准：临时编排会话不改变主写作、主对话历史和工作台当前集合；
创建失败保留原选择、输入与已提交事实。

## 前端实施阶段

### U1：Session 列表、创建与主写作入口

入口：`apps/studio-client/src/widgets/preset-workbench/`、
`widgets/agent-chat-panel/`、`features/narrative-runtime/`、
`app/studio-resource-panels.tsx`、必要的状态/API 接线。

- 移除预设详情的“设为主写作预设”；可保留“用此预设新建对话”。
- 预设详情保留工具/模型/编排编辑，列出采用的 Settings、正则和现有脚本挂载的编辑入口。
- 2026-10-02 UI 调整：模型配置保留顶部公共区；使用配置分为 Settings、正则 / 提取器、工具三个子 Tab。角色世界书开关放在 Settings 页，资源行与图标操作统一；Tab 切换不卸载草稿所有者，不丢未保存字段或保存中状态。
- 使用配置启用状态与实际运行状态分开显示，不用一个 Toggle 同时表示两者；不为预设另建脚本生命周期。
- Session 列表加号选择预设创建对话，每个对话显示绑定预设，不提供原地更换预设控件。
- 创建界面提供“设为主写作对话”勾选项，创建成功后才按用户选择更换主接收方，失败保留旧接收方。
- 主标记放在 Narrative 接收 Session 上，不与当前查看的选中态混用；设置主接收方复用 Session 入口的明确动作。
- 用户可查看和对话扩展创建的生图/记忆 Session；查看不会修改主接收方，不修改注册表当前集合。
- 暂停后切换主接收方时提示旧任务不能继续，需要重新发消息；生成期间不能切换。
- 不把草稿的“模拟后台调用”按钮直接上线；生产运行状态只能来自真实生命周期。

### U2：注册表与临时打开

入口：`widgets/context-workbench/`、`features/context-assets/`、
`features/text-transforms/`、`features/state-variables/`、
`shared/studio-shell/`、`app/studio-resource-panels.tsx` 及相邻面板接线。

- 注册表不增加预设选择器。“当前使用”跟随主写作，“全部资源”保持稳定、按真实归属展示。
- 预设引用不改写 Settings 来源；在子预设中采用资源不把它挂到主写作。
- 预设的 Settings 使用配置支持手动采用公共来源、取消角色世界书；注册表展示实际选入，不以“全局存在”冒充“所有 Agent 使用”。
- 从预设详情跳到相应编辑器。目标不属于当前集合时临时替换目录，保持原资源身份和可编辑性。
- 复用 Header 历史返回，恢复原预设、节点与页面状态，不新增竖排或局部“回原视图”按钮。
- 临时打开期间不修改主选择、引用关系或全局启用状态；编辑提交走正常版本校验，失败保留草稿。
- Settings、正则、宏按各自已有编辑器接线；宏是预设作者配置，不强行伪造成独立资源。
- 脚本、附件可以留在包/预设详情编辑，不为一致外观强制所有资源跳转。
- 不搬用草稿的内部状态为业务真值，不修改无关 Dock 或重做统一工作台。

## 验证与阶段顺序

顺序：B1 → B2；B3 核对现有事件与消费者，仅补必要缺口，其中主选择通知依赖 B4；B4 核对暂停恢复边界后推进 U1；
U2 可先复用正式临时导航，依赖 B1/B2 的归属与有效资源结果。存在文件重叠时不得并行写入。

每阶段由实施者提供一次最小证据，集成者不机械重跑：

- B1：真实 SQLite 引用往返/版本冲突/跨安装拒绝、共享定义的独立使用配置用例，避免只断言对象形状。
- B2：两个预设、一个公共规则、一个仅由 A 采用的 Settings 的 Preview/Run 与后台隔离用例。
- B3：按真实缺口验证主选择通知/调用结果、权限可见性与订阅释放；无切换自动计费或停包副作用，不为预设实例系统编写测试。
- B4/U1：Session 不能改绑预设；查看子会话不改变主接收方，Narrative 投递只到主会话；换目标不能恢复旧任务，新建不继承工具历史，失败不丢输入。
- U2：跳转编辑未挂载资源、返回恢复、无挂载副作用；既有导航测试优先扩展。
- 官方助手实验：使用 `official/extensions/loom-assistant` 实际文件，预设引用包内知识 Settings 与默认关闭、由预设显式采用的 `assistant-note` Display 正则。验证导入映射、Preview 知识注入、`<LoomNote>` 的 Display 投影，以及其他预设不采用时原文不变；不以仅注册成功代替生效证据。真实模型输出与浏览器 Markdown 观感另行验收。
- 仅公共接口改变时补相关包类型检查；不默认执行全仓测试或构建。
- 视觉与手感由用户验收；自动化不能替代。实际 DOM/事件问题才做定向浏览器诊断。

## 决定修订与剩余问题

2026-10-01 最终修订：取消独立主预设选择，Session 固定绑定预设；Narrative 的输入目标 Session 才叫“主”。替代当日早先保留 Session 改绑的方案。

- **可执行贡献已收束**：平台提供上下文、必要事件与调用能力，扩展自行编排和管理副作用；不建立预设独立实例，不因切换主写作自动停用整个扩展。具体事件名称与载荷按现有合同和真实消费者确定，不预先铺满事件目录。
- **暂停恢复已确认**：改用其他 Session/预设不能继续旧任务，需重新发消息；保留历史与已提交事实，不构造跨预设 continuation。
- **来源选择已收束**：公共 Settings 不默认注入，用户显式配置采用；角色世界书可取消选入。子 Agent 默认使用全局公共正则，角色自有正则不保证继承；不能把来源选择扩大为额外数据访问授权。
- **跨预设保留正则效果**：用户提出未来按规则添加持久化选项，可能覆盖 Display 与提示词处理；本阶段保留现有历史 Display 语义，不建设来源快照、规则副本或删除后保留机制。

配置化后的引用决策已确认：

1. **配置优先级**：预设显式配置优先。全局规则 R 默认参与，但预设禁用 R 时，本次消费排除 R，不修改全局定义或影响其他预设。
2. **引用不可用**：扩展停用、更新移除资源、外部依赖未安装时，保留原引用及未解析状态，显示为空并诊断；不是平台默认的必需项，不自动阻断，作者决定业务上的必需性。不按名称找替代，预设本身不可用仍拒绝启动。
3. **引用与分发归属**：引用外部资源不会将其打包、复制或自动变为依赖。只有显式纳入扩展文件与贡献清单的资源才导出；跨包引用不可解析时按未解析引用处理，不假称可移植。复制或移动归属是独立的显式操作。

## 非目标与停止条件

不重写数据库为整包 JSON，不新增通用资源图/文件系统存储，不恢复 Profile，
不提供任意进程强杀、不扩展安全沙箱、不新增 Preset State、不重做模型网关或多 Agent 调度平台，
不包办扩展业务自动化，不建立独立预设代码生命周期。
不新增预设来源、资源父子所有权或“专属资源”分类。

需要改变权限、包更新/删除策略、数据迁移范围，或引用合同无法按已确认边界实施时，
返回具体事实和选择。不能用静默 fallback、全局 enable 开关或名称推断绕开问题。
保留工作区其他修改；不提交、不做真实模型调用或外部发布。

## 当前交付账目

- [x] 关系模型和 DEV 草稿交互讨论完成。
- [x] 后端/UI 实施入口、阶段、边界和引用决策记录。
- [x] B1 Settings Mount 与 textUses 使用配置、包内映射及外部未解析引用往返。
- [x] B2 预设采用 Settings、取消角色默认 Settings、正则/提取器采用配置与诊断。
- [x] B3 核对现有 Host 订阅释放、Prompt Build 日志及 Run RPC；无确认的新事件消费者，本轮不增加事件系统。
- [x] B4 后端固定预设 Session、暂停任务 abandon 与两条恢复路径拒绝。
- [x] U1/U2 正式 UI 接线及聚焦验证（不代表完整端到端验收）。
- [x] 官方助手实际资源实验（Settings/规则/提取器导入、Preview 和 Display 投影）。
- [ ] 浏览器交互、视觉与真实模型输出人工验收。

后端验证：共享规则 A/B 隔离 1 例、Setting Preview/Run 1 例、取消角色默认 Settings 1 例、
暂停任务 abandon 与双路径拒绝恢复 1 例；规则包内/外部映射 2 例、缺失外部 Setting 往返 1 例通过。
Settings Mount 聚焦 2 例、固定 Session 3 例也已通过；暂停前 Settings Mount 失败已修正，不再作为当前失败。
最后后端修改后 application-data/application-runtime/extension-sdk/studio-server 定向类型检查通过。
Mount v4→v5 真实 SQLite 迁移聚焦 1 例通过，原 ID、来源、顺序、目标和 origin 保留，FK 检查为空。

前端已接固定 Session、主接收与查看态分离、显式首次建主、textUses/useCardSettings 的版本保存与临时编辑；
暂停换主使用 abandon，取消失败保留目标。首用与子会话投递聚焦用例通过；
Settings 空引用接线完成，按 Mount ID 保留、排序和删除缺失项，保存新增本地资源不丢未解析关系，聚焦 1 例通过。
client 类型检查仅剩既有 `preset.panel.views` 翻译键诊断；未把类型检查阻塞称为通过，也未运行完整旧 Narrative 测试文件。

DEV 草稿已移除预设所有权字段和专属目录，使用关系独立于资源归属，演示两个预设共享同一 Settings 且启用配置独立；两处 TSX 语法检查通过。
尚无本轮浏览器或真实模型验收；整体视觉与手感由用户确认。
官方助手实验 2 例通过：测试读取实际 manifest 的全部 Prompt、正则与提取器贡献，证明安装 ID 映射、
知识与展示说明进入 Preview、助手的 `<LoomNote>` 转为 Markdown，而未采用规则的预设保持原文。
官方示例同步修正知识节点命名空间与禁止自行指定 owner 的旧规则/提取器；默认关闭，通过助手预设显式采用。
测试 fixture 未提供 blobStore，跳过 scriptMounts，不能作为 Loom Script 导入或渲染器验收。
手动试用前需更新或重新导入修改后的官方助手包；本轮没有操作用户数据库或调用真实模型。
2026-10-02 配置详情子 Tab 与紧凑列表已实施；Settings 搜索/采用、排序/编辑/移除及工具来源折叠保留。
`preset-text-uses`、`preset-setting-uses` 聚焦 2 例通过，覆盖跨 Tab 草稿与保存中状态、CAS 失败后完整重试、缺失 Mount 身份保留。client 定向类型检查仍仅报既有 `preset.panel.views` 翻译键诊断，未做本轮浏览器视觉验收。
随后按用户反馈改为复用正式 FileTree：Settings 与正则/提取器按来源文件夹折叠，搜索覆盖已采用和候选资源，移除逐行分隔线，缺失引用保留在单独目录。
修复 RPC `replaceSettingMounts` 的旧 `settingResourceIds` 前置检查，统一由共享 Schema 接受 Mount 身份列表或旧资源 ID 列表。
此次三文件聚焦测试共 4 例通过，覆盖来源搜索、折叠、草稿与 Mount 身份保留、新旧 RPC 输入和非法输入拒绝；server 类型检查通过，client 仍仅有既有翻译键错误。未操作用户数据库验证保存，未做浏览器视觉验收。
扩展 ZIP 仍只打包实际磁盘文件，不支持将数据库编辑自动回写 ZIP；引用不会自动变为包内容。
主接收方是客户端本地持久选择，没有跨客户端共享的后端主路由约束。
旧包体系计划维持归档，不重新打开整套重构。
2026-10-02 后续 UI 修订：工具配置也复用 FileTree，保留来源折叠、搜索及工具说明展开，删除旧树和逐行分隔线。
Settings、正则/提取器、工具统一使用 Settings 目录的图标开关；启用资源图标高亮，停用行弱化。
按用户新决定取消 Settings 上下移控件（不改现有持久化顺序合同），取消列表编辑按钮，点击 Settings/规则资源行跳转编辑。
两文件聚焦 3 例通过，覆盖引用身份、开关保存、工具挂载参数保留与说明展开、跨 Tab 草稿和 CAS 失败重试。
client 定向类型检查仍仅报既有 `preset.panel.views` 翻译键诊断；视觉与实际浏览器点击仍由用户验收。
2026-10-02 当前角色 Settings 展示修正：预设配置接入当前角色绑定，角色资源分组置顶、资源使用星号，区分随角色默认采用与显式引用。
显示状态跟随 `useCardSettings` 草稿，不为了展示添加 Mount；默认采用由角色世界书总开关控制，关闭后仍可显式采用，资源触发条件不因此跳过。
两文件聚焦 4 例通过，新增覆盖角色分组排序、星号标记、继承状态及草稿联动；client 类型检查仍仅有既有翻译键错误，未做浏览器人工验收。
2026-10-02 文档收尾：按当前源码同步 Agent、PromptBuild、Data、文本管线、Extension 和导航 Architecture，以及 Client / Server / application-data / application-runtime / shared / extension-sdk README。
移除“允许 Session 改绑”“预设 Settings 仅兼容”等过时描述，补齐消费配置与归属分离、空引用、导出边界及正式 FileTree 交互；现存旧正则 Preset Owner 按实际支持记录，不宣称已删除。本轮只改文档，核对相对链接与标题锚点及 Diff，不重跑代码测试或模型调用。
