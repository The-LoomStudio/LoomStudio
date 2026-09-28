# 资源包、作用域与 Agent 预设底层改造

> **状态**：实施中 / Agent 单一身份与调用链已切换 / Q2 当前资源解析已接通 / Q3 已确认内嵌角色私有扩展
> **日期**：2026-09-27
> **范围**：存储、资源归属、安装与生效、Agent 调用链、导入导出、RPC/SDK 和迁移
> **配套前端计划**：[资源工作台与 Agent 预设 UI](ui/resource-workbench-and-agent-presets-plan.md)

## 1. 目标与已确认决定

将此前通过不同来源面板表达的关系，落实为可查询、可验证的领域关系，而不是靠 UI 文件夹推断。

1. 包只保留角色卡包、扩展包两类；不新增独立预设包。共享必要的包资源索引、依赖与校验机制，不要求立即把两种现有磁盘格式改成一个全新格式。
2. 扩展允许零代码、零 Module。衣物世界书等纯 Settings 集合就是资源型扩展，不必创建空脚本或新的底层包种类。
3. 彻底取消 Profile 这一层，Agent Preset 是完整、可直接调用的执行定义，不是资源所有者包。定义预设时就定义其提示词编排、上下文/历史策略、工具使用配置和本地模型槽；不保留“先选 Profile，再为它选 Preset”的模型。
4. 复杂助手通过扩展组合 Agent 预设、Settings、正则、工具实现等；不再由预设包含扩展、正则或脚本。
5. 单独导出编排或 Setting 是资源导出，不递归携带依赖。组合分发走包；外部引用不等于一起打包。
6. 角色依赖扩展默认在角色边界内生效，不要求或自动替用户全局启用。共享已下载包不等于共享配置、启用状态或运行数据。
7. 全局启用由用户决定。角色来源、扩展来源、工作区自有与生效范围分开；提升为全局使用不抹掉原来源或转移所有权。
8. State 实际值仍是 Global / Timeline 运行数据；包提供定义或初始内容，不拥有每个 Agent 各一份“世界 State”。扩展私有记录不统一塞进 State。
9. 浏览外部包只是只读预览，不安装、不挂载、不启用、不执行模块。
10. 用户选择更新角色卡或扩展后，已有 Timeline 立即追随当前资源与依赖变化，包括 Settings、代码的新增、修改与移除；不为每个 Timeline 锁定旧包或追加一次 Apply。用户可以选择不更新，平台不承诺新版兼容全部旧运行数据。
11. State 等运行数据的兼容与迁移由作者负责；平台不因资源更新自动重置、删除或猜测性修补数据。作者实施迁移仍须使用正常授权、版本检查和事务入口，不能绕过数据安全合同。
12. 是否按 Timeline 独立取决于具体能力、数据或任务是否与 Timeline 强关联，不取决于代码来自角色扩展、独立脚本还是全局扩展。包归属、安装范围与运行生命周期是不同关系，不统一为每个 Timeline 复制整个 Module。
13. 角色私有扩展随角色包携带实际文件，支持离线完整分发；导入后仍属于角色安装，不自动执行、联网或提升为全局。
14. 外部资源链接和更新来源不是扩展专属能力，角色卡本身也可拥有。后续更新检测面向角色包与扩展包；普通外部资源引用、包更新来源和安装依赖分别表达，不把任意链接视为可执行依赖或自动更新指令。当前不提前实现网络轮询、下载或远程依赖求解。

本计划不把“无代码扩展合法”当作新能力，也不把草稿的数组与本地 state 当作持久化设计。

## 2. 当前事实与证据

以下为 2026-09-27 当前工作树源码核对，不代表相关测试已在本轮执行。工作树有大量既有改动，实施时重新核对触及文件，不覆盖其他任务。

| 编号 | 当前事实 | 证据入口 |
| --- | --- | --- |
| E1 | Manifest v2 的 `modules` 可缺省；包已经支持声明式 Prompt Resource、工具定义、正则和提取器。还没有独立 Agent 预设贡献项。`contributes.settings` 是扩展配置表单，不是提示词 Settings | [SDK 类型](../../../packages/extension-sdk/src/index.ts)、[Manifest 校验](../../../packages/extension-sdk/extension-host/src/manifest.ts) |
| E2 | 包发现、Module 启用和资源导入是分开的；资源需显式导入。同版本重导入不覆盖用户编辑；跨版本资源迁移未完成 | [Manager](../../../apps/studio-server/src/extensions/extension-manager.ts)、[资源导入](../../../packages/application-runtime/src/runtime/extensions-runtime.ts) |
| E3 | Catalog 按 `packageId`，desired state 与 Host 按 `packageId + moduleId`，没有角色安装身份。Host 的 Instance Scope 是激活清理范围，不能视为角色作用域 | [状态存储](../../../apps/studio-server/src/extensions/extension-state-store.ts)、[Host](../../../packages/extension-sdk/extension-host/src/host.ts) |
| E4 | Profile 是 Document，含 `presetId`、模型与 `toolOverrides`；Preset 是 PromptResource，含有序树、宏与历史策略；工具 Mount 在 PromptResourceStore。Session 保存 `agentProfileId` | [运行类型](../../../packages/application-runtime/src/types.ts)、[资源类型](../../../packages/application-data/src/prompt-resource/types.ts)、[Session 类型](../../../packages/application-data/src/agent/types.ts) |
| E5 | 每轮运行读 Session → Profile → Preset，工具使用 Mount 默认值与 Profile override；预览与执行通过同一准备链。多个 Profile 在合同上可引用同一 Preset | [Agent Runtime](../../../packages/application-runtime/src/runtime/agents-runtime.ts)、[RPC](../../../apps/studio-server/src/rpc/handlers/application/agents.ts) |
| E6 | PromptBuild 收集主 Preset、`manual/global` Setting Mount、Timeline Setting IDs；旧 Preset Setting Mount 可存储但不参与此消费链 | [Agent Turn](../../../packages/application-runtime/src/agents/agent-turn.ts)、[定向测试](../../../tests/integration/application-runtime/prompt-resource-runtime.test.ts) 的 `resolves global mounts and ignores legacy preset mounts` |
| E7 | PromptResourceArtifact v1/v2 reader 仍接受宏、正则和旧脚本附件；正式单资源 exporter 已改为只输出树与作者宏，不读取或携带脚本、正则、模型绑定或关联 Settings。ZIP 只是该 artifact 的容器 | [Artifact 类型](../../../packages/application-runtime/src/cards/workspace-types.ts)、[导入导出](../../../packages/application-runtime/src/runtime/prompt-runtime.ts)、[ZIP](../../../apps/studio-server/src/codecs/prompt-resource-zip.ts) |
| E8 | 正则与 Loom Script 有 `preset` owner；正则 owner 还包括 workspace/card/extension。当前正则解析对非 preset/card owner 不做角色安装范围过滤 | [规则类型](../../../packages/application-runtime/src/transforms/history-text.ts)、[解析](../../../packages/application-runtime/src/runtime/transforms-runtime.ts)、[脚本合同](../../../packages/application-runtime/src/scripts/loom-script-contracts.ts) |
| E9 | Card Bundle v4 带 Prompt 资源、State、脚本、规则和 Portable Payload；后者是扩展私有数据，不是嵌套扩展程序或完整依赖安装合同。`card.preset.system` 也不是 Agent Profile 指向的编排资源 | [Card 类型](../../../packages/application-runtime/src/cards/workspace-types.ts)、[Card 编解码与落库](../../../packages/application-runtime/src/cards/workspace.ts) |
| E10 | Config/Record 已有 global/card/timeline/agent-session 存储范围，但 Host 主要按 Package owner 隔离；范围存在性校验不等于限制某角色实例只能访问该角色 | [Storage](../../../packages/extension-sdk/extension-host/src/storage.ts)、[数据合同](../../architecture/application/extension/data-and-portable-payload.md) |
| E11 | 宏默认值在 Card/Preset；同名候选已有来源、冲突和显式选择，选择按 Timeline + Preset 保存。State Contribution 有注册与组装，但 Manifest 没有对应的纯资源声明项 | [宏解析](../../../packages/application-runtime/src/prompt/macro-provider-registry.ts)、[宏配置](../../../packages/application-runtime/src/runtime/macros-runtime.ts)、[State 注册](../../../packages/application-runtime/src/state/state-contribution-registry.ts) |
| E12 | Prompt/Classify 使用角色快照，Display 读当前角色规则；Timeline 引用的提示词正文不是完整版本冻结。VFS 已按授权资源 IDs 构建，附件入口目前是文本读取 | [运行数据边界](../../architecture/application/data-capabilities-and-lifecycle.md)、[规则解析](../../../packages/application-runtime/src/runtime/transforms-runtime.ts)、[VFS](../../../packages/application-runtime/src/vfs/resource-filesystem.ts) |

因此现状不是“缺一个包格式”。主要缺口是安装身份、资源归属和使用关系、Agent 单一身份，以及这些关系在所有消费者中的一致执行。

## 3. 目标关系与最小实现建议

以下结构按已确认边界实施；旧 Agent 数据兼容范围以第 5 节最新决定为准，角色依赖分发的 Q3 不阻挡 Agent 合并。

```text
包内容 / 版本                 安装到哪个上下文
角色卡包或扩展包 -----------> 全局或指定角色的安装记录
  资源的包内身份                 本地资源身份、启用、授权、版本
                                  |
工作区自有资源 -------------------+--> 使用关系 --> 本次 Agent 构建
                                                        |
                                              Timeline / Session 运行数据
```

### 3.1 归属、来源与使用

- 归属表示谁管理资源生命周期：工作区、角色或扩展安装。来源记录原包、版本、贡献 ID、复制来源，不用可变名称定位。
- 使用关系单独表达全局默认、角色引用、Agent 的 Settings/规则选择与顺序。Agent 是消费者，不新增第三种“Agent State 作用域”。
- 不建立覆盖所有数据的新通用 Resource Store。提示词仍用 PromptResourceStore，规则/配置沿用 Document，二进制沿用 Asset/Blob；增加这些消费者确实需要的归属与安装关系。
- 原包内 ID 在多个角色安装中可相同，本地资源与安装身份不可冲突；复制生成新身份并保留 provenance，引用不复制。
- 全局引用不得悄悄扩大角色私有资源或代码的访问范围。能引用的资源保留来源；不能跨范围使用时，要求显式复制到工作区或建立全局安装，UI 显示不可用原因。
- 设置某 Agent 不使用某组 Settings，不应把其他 Agent 或所有角色的同一资源禁用。必须区分资源作者 `enabled`、使用关系的开关与本轮 Activation。

### 3.2 Agent 单一身份

- 领域模型只保留 Agent 预设身份，不只是把 Profile 从 UI 隐藏。内部可以复用有序 PromptResource 树和一对一配置记录，但这些是存储实现，不得继续暴露独立 Profile 身份、CRUD 或 Profile → Preset 的选择关系。
- 树、工具配置、宏作者配置、上下文/历史策略归入同一 Agent 编辑聚合。编排单独导入是修改/创建 Agent 的编排内容，不自动创建一对相互引用的用户对象；编排资源可单独导出，不意味着运行时需要独立 Profile 包装它。
- 工具配置只有一个权威集合。工具定义和执行器仍独立存在，可被多个 Agent 使用；取消双重配置不等于把工具实现复制到每个 Agent。
- 模型是本地可空绑定：可以创建、导入和编辑未绑定模型的 Agent；需要模型的预览/执行明确提示缺失，不自动选默认模型。Provider 凭据和本地账号不进入分发。
- Provider/model 管理继续拥有模型能力与参数。此计划不顺带重建模型目录；`delivery`、历史策略等现有 Agent 行为不能被合并时丢弃。
- Session、默认 Agent、工具配置、宏选择、规则 consumer、脚本挂载、VFS 与归档的当前调用合同一起切换到新身份。旧 Profile 的引用不要求无损重绑定；失效引用明确失败，不静默选择另一 Agent，不删除历史正文或 State。

#### 功能与调用入口

Agent 预设按调用者需要完成的功能理解，例如叙事、画面整理或摘要。功能说明表达“它能做什么、适合接什么任务”，不是另建一个功能 Profile 再绑定某份 Preset。

```text
用户在输入框选择 --------+
扩展按事件/程序触发 -----+--> Agent 预设 --> 本次 Run / Session
主 Agent 分派任务（未来）+
```

- 用户直接选择预设；程序性/被动调用可直接引用确定的预设身份，不要求先申请某类 Profile。
- 未来主 Agent 分派子任务同样以完整 Agent 预设为目标。这里固定调用边界，不把多 Agent 调度器纳入本轮实施。
- 功能分类/说明服务于发现与选择，不默认要求每种功能存在多个候选，不提前建设按功能动态求解实现的注册层或额外绑定层。
- Agent 预设是执行定义，Run/Session 是执行实例。同一预设可多次调用，不因此新增 Profile，也不意味着各次调用共享私有会话数据；共享 State 仍按明确目标与授权访问。

### 3.3 包安装与角色边界

- 缓存/下载包、安装到上下文、启用资源、授权代码是不同动作。角色作者声明依赖不能自动全局启用或提升权限。
- 为角色依赖记录目标上下文、确定版本与安装身份；资源型扩展不需要运行实例。代码型扩展的安装可用范围与具体贡献的运行生命周期分别处理，不由包来源推导统一的实例单位。
- 不能只给 Store 加 `cardId`：Module desired state、RPC/Event 路由、工具执行器、Macro/State provider、Client Renderer 与文件访问必须遵守安装授权与具体调用目标；这不要求每个调用目标各加载一份 Module。
- 与 Timeline 强关联的状态、任务、监听或 Renderer 按该 Timeline 归属和隔离；无此关联的通用计算、共享服务等不因角色来源被强制拆分。全局扩展同样可以提供 Timeline 关联能力，角色扩展也不意味着所有内存变量都是 Timeline 私有数据。
- 依据现有贡献合同、明确的目标参数与真实生命周期实现关联，不猜测任意 JavaScript 内存变量的含义，不新增逐变量作用域标记或通用生命周期管理器。具体能力确有未定义且影响行为的关联时再提问，不重开整个扩展统一按 Card/Timeline 实例化的二选一。
- 同包出现在两个角色时，固定的全局 RPC 名称或单个 `toolId` 注册 Map 不能让后注册者覆盖前者。外部稳定贡献 ID 与宿主内部路由身份分开。
- SDK 请求范围须受宿主授予的上下文约束，不能只验证调用者提供的目标存在。普通角色依赖不得借 `ctx.storage` 等入口写另一角色或全局。
- 全局 Provider 等平台服务仍可由用户配置并供角色调用；“调用已授权的宿主服务”不等于角色包要求安装全局扩展。
- 首切片支持角色包携带的私有扩展与确定版本，不建设远程依赖求解；版本不满足明确报错，不偷偷使用另一个全局版本。内嵌内容通过既有 installer 的文件校验边界，不复用扩展私有数据 Payload 来装程序包。
- 安装记录中的版本表示当前采用的包版本，不是每个 Timeline 的版本锁。用户确认更新并成功提交后，已有 Timeline 的后续资源解析使用更新结果；被移除的资源不从旧快照静默补回。缺失的可选贡献或必要依赖分别按已有诊断/失败合同处理。
- 立即追随不等于半完成安装也可见，不自动扩大新代码的授权，也不要求正在执行的调用中途混用新旧代码。运行中更新按具体能力已有的 abort/dispose 与调用边界处理；出现真实契约缺口再确认，不得借此重新引入逐 Timeline 更新确认。
- Server Module 目前是同进程受信任 Node.js，Client Module 也不是统一强沙箱。上下文隔离仅能约束正式 API，不能宣称可安全运行任意不可信角色附带代码；是否支持其自动激活必须单独确认。

### 3.4 导出与旧格式

| 操作 | 目标内容 | 不允许的隐式行为 |
| --- | --- | --- |
| 导出编排资源 | 正文、有序树、消息/锚点及自身声明式条件；字段白名单在 B0 固定 | 递归加入正则、脚本、Settings、工具实现或模型账号 |
| 导出 Setting | 自身正文与必要的树、启用和条件数据 | 把引用目标打成附件；把整包当作一个 Setting |
| 打包 Agent 方案 | 扩展包内的 Agent 定义及用户选择携带的配套资源，包内引用可重绑定 | 把全部工作区资源打入包；导出后改变本地归属 |
| 导出角色卡 | 角色资源、明确的角色依赖描述及其私有扩展实际文件；保留已有外部资源引用，不递归抓取网络 | 自动执行代码、联网抓取或提升为全局 |

旧 `loom.promptResource` 不能按新白名单直接截断。读取后识别资源本体与配套内容，提供明确转换为扩展包/包内并列资源的路径；无法无损转换时拒绝并说明，不悄悄丢失宏、正则、脚本或设置。

ZIP 是容器，不凭后缀判断业务上是否为包。保留现有旧格式 reader 的范围由真实输入决定，不新增无消费者的永久双写兼容层。

### 3.5 运行解析与检查合同

- 以明确的 Global/Card、Timeline/Branch、Agent/Session、处理阶段为输入，解析候选与有效使用关系；预览与真实运行共用解析，不让 UI 自己计算生效集合。
- Settings 返回为何可用、为何启用/禁用、条件结果与使用顺序；允许扩展为不同 Agent 显式指定 Settings。现有 legacy Preset Mount 不得因迁移被全部自动激活。
- 正则/提取器保留 phase、范围、顺序、override 与输入输出诊断；去掉 `preset` 资源所有权后，原“随某预设使用”的选择性必须通过关系保留，不能全部变成全局规则。
- 宏复用候选/显式选择/冲突诊断，新增安装身份后修正 source ID 映射；作者配置与本轮计算结果分开，不把冲突改为按目录顺序覆盖。
- State 沿用已有定义、组装、Revision、Head CAS 和提交后通知。安装、预览或修改模板不重置既有 State；跨 Agent 访问同一 Timeline State 仍遵循授权与冲突语义。
- README/附件与 Settings 是不同内容来源。能被 AI 读取不等于自动注入；包预览可见不等于 Agent VFS 可见。通用二进制/图片 VFS 消费交由 CodeAct/VFS 计划，不在此轮重建文件系统。
- 查询需能返回资源身份、归属、provenance、使用关系、失效原因与编辑权限；包视图和类型视图查询相同实体，不互相复制。

## 4. 分阶段工作包

路径表示改动边界，实施前按该切片核对调用者；不是授权清理整个目录。

| 阶段 | 工作与主要文件 | 可观察完成标准 |
| --- | --- | --- |
| B0 合同收口 | 本 Plan、`application-runtime/src/types.ts`、`workspace-types.ts`、SDK 类型；确认 Q3、资源导出字段白名单，按具体能力核对 Q4 已定原则 | 旧 Agent 迁移仅保障通用默认预设与官方问答助手；不建设旧 Profile 共享引用、模型配置与会话的无损映射 |
| B1 归属与安装关系 | `packages/application-data/src/` 对应 Store；Runtime `foundation/`、`runtime/extensions-runtime.ts`、`cards/`；共享合同 `packages/shared/src/` | 纯 Settings 扩展分别安装到 A/B，两边使用选择可不同；工作区自有可列出；包源码不因安装被修改 |
| B2 Agent 聚合与消费 | Runtime `agents/`、`runtime/agents-runtime.ts`、`runtime/prompt-runtime.ts`、`prompt/`、`runtime/macros-runtime.ts`、`transforms/`、`scripts/`、`vfs/`；Data Agent/Prompt Store | 用户选择与程序调用直接定位完整 Agent 预设；无 Profile 选择层或双层工具开关；迁移前后选定样例输出与暴露工具一致 |
| B3 角色扩展执行上下文 | `packages/extension-sdk/src/`、`extension-host/src/`；Server `extensions/`、`main.ts`；Client `features/extension-renderers/` 与 `shared/extension-renderer-runtime/` 的宿主接线 | 与 Timeline 关联的能力在 A/B 不串状态或任务，释放 A 不误释放 B；非 Timeline 服务不被强制复制；安装范围与越界访问正确受限，不把此结果描述为强沙箱 |
| B4 分发与迁移 | Runtime `cards/workspace-codec.ts`、`workspace.ts`、`runtime/prompt-runtime.ts`、`runtime/official-content-runtime.ts`、`archive/`；Server `codecs/` 与 installer；`scripts/pack/`、相关官方资源 | 单资源导出不带配套资源；资源型扩展无 Module 可往返；旧带附件预设无损转换；角色依赖不全局激活；失败无可见半成品 |
| B5 查询与调用层交付 | Server `rpc/handlers/application/`、Extension RPC；Runtime inspection；Client `shared/api/studio-api.ts`、entities、对应 feature hooks；受影响的官方扩展/测试 | 类型/包入口和运行检查获得真实身份与原因；旧正式 UI 的必要调用适配可编译运行，不提前进行导航重做 |

顺序：B0 → B1；B2/B3 在所需合同确认后推进；B4 消费稳定身份；B5 随各领域提交最小接线。资源型扩展切片可先验收，但 B3 未完成不能声称角色代码扩展已完成。

后端计划包括 Client API、entities 与 Host 的必要联动，否则不能形成可运行切片。Dock 布局、资源树组织与编辑体验属于前端计划。

## 5. 迁移与失败底线

### 执行优先级调整（2026-09-27）

按用户要求，优先完成可用流程，不再扩展外围测试矩阵。先补 B5 目录查询和正式 UI 必要接线，再继续安装、更新、分发闭环；B3 的权限与持久化底线不因此取消。完整 UI 导航与编辑器改造仍由独立前端 Plan 承接。

- 已补 `application.listExtensionInstallations`，从现有安装文档返回安装 ID、文档版本、包 ID/版本及 Global/Card 目标；Runtime、Server RPC、StudioApi 均已接通。
- 该查询是安装目录，不代表模块已启用、资源已挂载或本次运行已生效。原有资源来源中的 installationId 可关联此目录；不另建 Registry 存储。
- 最小验证：复用全局及 A/B 两个角色的资源安装用例，确认目录返回三个独立身份及各自版本/目标；单用例通过，Server 定向类型检查通过。
- 待继续：前端目录消费、资源使用关系与运行检查原因查询。没有进行浏览器验收，B5 尚未完成。

本轮接线进展：
- 客户端实体补齐扩展资源来源和安装目录 DTO，沿用现有客户端类型边界，不引入后端运行时依赖。
- `usePromptResourceState` 按 endpoint 缓存安装目录，资源刷新/失效同步更新目录；错误纳入现有查询错误出口。
- 正式 Settings/预设工作台接入目录，资源工具栏显示包 ID、资源来源版本和安装目标；未解析的安装不冒充全局安装。仅接线，不改变导航或新增归属下拉框。
- Client 定向类型检查通过；未执行浏览器或人工视觉验收。资源使用关系、运行生效原因以及完整文件夹双入口仍待实现。

资源绑定查询进展：
- 新增 `application.getPromptResourceBindings`，贯通 Runtime/RPC/StudioApi，按当前 Card 文档及 SettingMount 返回直接角色引用、全局手动挂载和预设挂载，不另存引用索引。
- 这是配置引用关系，不包括历史 Timeline 快照、Session 调用历史，也不代表 Activation 通过或实际注入。完整运行检查仍消费真实 PromptBuild/Macro/文本处理结果。
- 复用现有 A/B Settings 用例验证角色引用与全局/预设挂载能同时返回，并保持运行期跨角色过滤；单用例通过，Server 与 Client 定向类型检查通过。
- 该查询尚未接入详情视图；B5 继续进行。

引用位置前端接线：
- 正式 Settings/预设资源工具栏增加原生可展开的“引用位置”，读取真实角色与 Settings 挂载，显示角色名、预设名和全局 Settings；没有新增 Tab、弹窗或写操作。
- 仅展开时查询，按 endpoint/resourceId 隔离缓存；角色资源选择和 Settings 挂载修改会使引用查询失效。加载、错误与空结果分别呈现，不以空列表掩盖查询失败。
- Client 定向类型检查通过；未做浏览器诊断或人工视觉验收。完整文件夹双入口与运行生效原因仍未完成，不以此接线宣称整个 B5 或前端 Plan 完成。

- 数据库 schema migration 与 Document 内容迁移分别列账，使用既有 Data Engine/Store，不用启动时扫描重写替代可恢复迁移。
- 最新用户决定：旧 Agent Profile 没有重要数据，不要求无损保留其配置、共享 Preset 关系、选择记录或 Session 重绑定。取消为此准备通用映射、节点复制、逐引用修复和永久兼容层；不是取消新数据的事务与版本检查。
- 预设迁移只要求两个官方默认模板进入统一 Agent Preset：`packages/application-runtime/src/prompt/default-preset.json`（通用默认）与 `official/starter/presets/assistant.json`（官方问答助手）。保留其正文、树顺序、锚点、宏及工具使用配置；本地模型槽可空，不输出 Provider 账号。
- 不将旧 Profile 兼容豁免扩大成删除 Timeline/Branch/State Revision 或历史正文的授权。旧 Session 可因旧 Agent 引用而不可继续执行，但历史保留且明确报错，不自动绑到另一个 Agent。
- 节点 ID、Anchor 引用、Tool Content placement、Setting Mount、宏候选 source ID 一起映射；不能只替换 `presetId` 字符串。
- 凭据留在 Secret/Provider；本地模型绑定不打包，缺失绑定显式处理。
- 包文件准备与数据库提交沿用 prepared write 清理；失败不得自动重试非幂等写入，也不得留下部分导入的可见配置。
- 区分解除安装、停用 Module、删除来源资源、删除工作区副本。物理包仍被别的上下文引用时不得误删；旧引用缺失仍保留诊断。
- 角色卡/扩展更新改变已有 Timeline 后续使用的资源集合与内容，但不改写已提交故事、历史执行事实或已有 State。现有 Timeline Runtime Context 的规则/脚本等资源快照须逐项核对并调整解析路径，不能让旧快照使已移除的资源继续生效；这不等于重算历史记录。
- 平台基础数据模型迁移与作者内容更新迁移是两件事：前者由本计划实现，后者由作者负责。未提供作者迁移或迁移失败时如实暴露不兼容，不以默认初始值覆盖已有运行数据。

## 6. 场景验收与最小证据

| 场景 | 必须证明的结果 | 优先扩展的现有测试 |
| --- | --- | --- |
| 衣物世界书，无代码 | 两套 Settings 可分别选择，同包分别用于 A/B 不互相改变，未挂载不注入 | `tests/integration/studio-server/extension-package-resources.test.ts`、`tests/integration/application-runtime/prompt-resource-runtime.test.ts` |
| 叙事/生图两个 Agent | 各自编排、Settings、工具独立；共有工具定义不被复制；共享 State 按同一目标读写 | `tests/integration/application-runtime/agent-session.test.ts`、`tests/unit/application-runtime/tool-prompt-build.test.ts` |
| 角色私有代码依赖 | 同包按真实目标路由，Timeline 关联任务在 A/B 隔离，无关服务不强制复制；解除 A 的使用关系不破坏 B，越界调用失败，重启后授权与启用正确恢复 | `tests/contract/extension-host/storage.test.ts`、`rpc-registration.test.ts`、`tests/integration/studio-server/extension-state-restart.test.ts` |
| 官方预设迁移 | 两个官方默认模板可成为完整 Agent Preset；不依赖 Profile，正文/锚点/宏与工具配置保留，未绑模型明确提示，预览与运行使用同一份定义 | `default-preset.test.ts`、`official-content.test.ts`、`agent-preset.test.ts`；不新增旧 Profile 共享迁移 fixture |
| 导出/导入分流 | 新单资源无配套附件；旧附件转换不丢；无代码扩展往返；失败可恢复 | `tests/unit/studio-server/prompt-resource-zip.test.ts`、`card-bundle-zip.test.ts`、`tests/integration/studio-server/extension-install.test.ts` |
| 角色/扩展更新与旧 Timeline | 不更新时仍使用当前已安装版本；成功更新后已有 Timeline 使用新资源，移除的 Settings/代码不再参与后续消费；不另行 Apply，不自动重置 State，失败更新不暴露半成品 | B1/B3/B4 的更新集成用例，包含已有 Timeline、删除资源和保留 State 的最小 fixture |
| 运行检查一致性 | inspection 与真实 PromptBuild 取相同上下文；宏冲突、正则来源、State 目标可追踪 | 对应 runtime integration 与 `tests/integration/studio-server/agent-turn-rpc.test.ts` |

实施时每个切片先运行覆盖主要风险的单个测试文件，再按实际跨包合同补相关类型检查；不默认串行运行全仓 lint/test/build。发布切换前才组合上述回归并检查旧格式兼容。本轮仅源码与现有测试内容调研，没有执行这些验收。

## 7. 尚待确认的决策

原 Q1 已收口：目标彻底取消 Profile，不保留多个 Profile 共用 Preset 的产品能力。最新用户决定也免除旧 Profile 共享引用的迁移兼容要求。以下保留原编号以便追踪。

Q2 已收口：用户选择更新后，已有 Timeline 立即追随资源与依赖变化；取消逐 Timeline 版本锁定与显式 Apply 方案。State 等运行数据由作者负责兼容与迁移，平台不自动重置。资源消失是新版本的实际结果，不用旧资源兜底隐藏。

Q4 的生命周期原则已收口：以具体能力是否与 Timeline 强关联决定隔离和生命周期，不按包来源统一实例化。撤销“整个角色扩展按 Timeline 复制”的建议及前置阻断；沿用现有代码信任与授权边界，不默认引入沙箱或通用实例体系。后续只对实际遇到的具体公共契约缺口提问。

| 问题 | 建议 | 阻断点 |
| --- | --- | --- |
| Q3 角色包内嵌扩展文件，还是仅携带依赖引用？ | 已确认：角色私有扩展随角色包携带实际文件，支持离线完整分发。外部资源链接和后续自动检测更新同时适用于角色卡，不限定为扩展能力；发现更新不等于自动采用更新 | 已解除；继续 B1/B3/B4 |
| Q5 更新包时如何处理安装资源上的本地编辑？ | 已确认：默认新版覆盖，执行前弹窗指出内容会变化及本地编辑会被覆盖；不做自动字段合并。Diff 与保存副本留作后续增强。Agent 本地模型绑定与运行 State/历史不属于覆盖内容 | 决策已解除；覆盖入口必须先接确认流程，不将普通重复导入改为静默覆盖 |

2026-09-27 更新入口核对：`importExtensionPackageResourcesInternal` 对已有安装及资源执行版本一致性检查；同版本导入跳过已有资源，跨版本抛出 explicit migration 错误。正式编辑入口未将扩展来源设为只读，因此本地编辑冲突是真实可达情况。Q5 已由用户确认；在确认入口接通之前仍保留普通导入的拒绝行为。不得把当前/新版差异宣称为准确识别了用户修改，后者需要旧版原始基线。

用户已确认 Q3，分发决策阻断解除。联网获取与自动检测更新留在 Workspace 分发计划，当前只落实本地包、归属与安装合同，不为未来能力提前添加无消费者的配置系统。Agent 单一身份切片已交付，后台计划整体未完成。

用户负责上述产品、持久化与权限决定；实施者可以自主选择已确认边界内的字段命名、文件拆分与最小测试。不能因问题未定而虚构迁移成功，也不需要为普通编译或测试失败反复审批。

## 8. 与其他计划的关系及本轮记录

### 扩展包沙箱脚本贡献与生命周期

- Manifest 新增独立 `contributes.loomScripts` 源文件声明，Preset 的 `scriptMounts` 只引用声明 ID/顺序。校验重复、缺失引用、Preset 类型、顺序与文件存在性；不把沙箱脚本当成可信 Extension Module。
- Manager 读取 UTF-8 源码后交给 Runtime，复用 Metadata parser、Blob prepared write 和同一资源导入事务。安装生成独立安装级 Script/Mount ID，Source 归属于安装；新挂载默认停用且授权为空。
- 更新覆盖包源码，保留能力声明未变时的启用状态及仍有效的授权；声明变化时停用，移除贡献清理包持有源码/挂载，重新加入不恢复墓碑中的旧授权。资源移除/卸载同步清理这些实体，不删除共享 Blob 历史。
- 包内脚本随采用的包版本前进，禁止为其新建旧 revision pin。规则匹配输入在解析时由包内 contributionId 映射到本安装规则 ID，不改写作者源码，也不以同名全局规则兜底。
- 包持有的 Script Mount 变更按其 origin 加入现有安装事件投影；普通用户创建的挂载不因此被改成扩展私有文档或获得自动授权。
- 验证：真实 Server/ZIP/Blob 的定向流程 1 项通过，覆盖 A/B 独立安装、默认停用/无授权、拒绝 pin、规则 ID 解析、A 更新保留有效授权而 B 不变、移除及重新加入重置授权。Server/Client 类型检查通过。
- 尚未完成旧 Preset 文件到该 Manifest 的转换入口；脚本贡献的完整编辑/浏览体验仍需与前端计划衔接。没有新增脚本引擎或在测试中执行浏览器沙箱代码。

### 扩展持有沙箱脚本的实施设计与首步

- **Goal（目标）**：旧预设附件转为扩展资源后，脚本仍由原 `client-sandbox` 执行，归属不再隐含为一个预设包。
- **Verified facts（已核实）**：现有脚本有 Blob 源码、Metadata、独立 Mount 与授权，Owner/Target 原来共用解析器；包导入目前尚无沙箱脚本贡献。直接转换成可信 Client Module 会改变执行权限，不采用。
- **Inherited decisions（既定边界）**：扩展可以无代码；资源持有与挂载关系分开；导入不自动授权/执行；Card 私有资源按实际运行角色可用，不用全局来源兜底。
- **Minimal design（最小设计）**：复用 Script Document/Blob/Mount 与原沙箱。新增 extension Owner（packageId/installationId），不把安装身份变成 Mount Target；包资源入口随后负责创建这些实体和相应 Preset 挂载，不增加新脚本引擎。
- **Work packages（实施顺序）**：本步已完成 Owner 类型、RPC Owner/Target 分离、导入/更新时校验安装、Source Document Meta 归属，以及按实际 Timeline Card 过滤源码解析。下一步接 Manifest 贡献、Manager 读取源码和 Runtime 同事务导入/更新/卸载；最后接旧文件转扩展入口。
- **Acceptance and validation（验收）**：定向真实 Runtime/Blob 检查 1 项通过，错误安装身份不留下脚本，导入仍为 client-sandbox；公共挂载中角色 A 的脚本只在 A Timeline 解析，B 和无 Timeline 不返回源码。Server/Client 类型检查通过。挂载授权保持独立，未改全局脚本行为。
- **Open questions or blockers（开放项）**：暂无产品阻断。包生命周期尚未消费新 Owner，不能把本步视为旧附件转换完成；缺失安装明确报错，不回退执行遗留脚本。不在此处引入跨 Store 的动态 owner 推断或额外事务系统。

### 旧文件导入调查与事务收口

- 源码确认：现有单 Prompt 导入仍接受旧 Preset 的 scriptAttachments/textTransformRules，并创建 preset-owned 资源。它不能作为目标包模型的最终实现；两个官方预设的数据库迁移豁免，也不能解释为允许此导入器静默丢附件。
- `.loom.js` 当前明确为 `client-sandbox`，带受限能力和独立挂载授权。后续旧附件转扩展必须保留此执行边界，不能把脚本包装成可信 Client Module 来冒充无损转换；需要扩展分发承载现有脚本资源，而非升级其权限。
- 先修复现存导入的半成品风险：单资源、旧规则/脚本/Blob 与默认工具挂载复用同一 Data Engine 事务，移除原来无脚本分支的分步写入。没有附件时不要求 Blob Store，也不平白要求文档事务参与者。
- 验证：真实 Runtime 的定向失败注入 1 项通过，工具挂载写入失败后资源和挂载均为空，重试正常导入成功；Server 类型检查通过。没有据此声明旧附件转包完成，该转换仍是 B4 剩余项。

### 平台通知投递矩阵收口

当前内置通知已按实际发布载荷核对，以下“不投递”是无资源范围的工作区通知边界，不再作为待实现的角色广播功能：

| 通知 | 角色安装的投递规则 |
| --- | --- |
| 扩展自定义事件 | Kernel 按注册目标与 visibility/capability 路由 |
| `state.changed` | Host 按真实 Timeline 来源 Card 校验 |
| `data.changed` | 按提交版本投影文档、Prompt/挂载、Narrative、Agent、State 操作 |
| `docs.changed` / `docs.rollback.completed` | 按提交版本与安装归属裁剪 |
| `extensions.changed` | 仅同包、同 Card 安装；缺少目标的旧全局通知不推测为角色通知 |
| `entity.lifecycle.changed` | root 为所属 Card 时投递 |
| `system.ready` / `system.stopping` | 无角色数据的宿主生命周期通知 |
| `diagnostics.updated` / `docs.rollback.failed` / `extensions.data.changed` / `directories.media.changed` | 保留工作区通知，不向角色扩展广播；载荷只有汇总或失效提示，没有可核验资源范围 |

- 角色 Server 扩展需要资源变更时使用已投影的 `data.changed` / `docs.changed` 或 State 订阅，并取得相应 grant。Client 配置订阅仍由应用层 SSE 驱动宿主重新查询各自安装的数据，不把工作区通知正文直接提供给私有模块。
- 验证：平台事件集成 5 项通过，新增覆盖安装状态通知的 A/B/其他包/无目标边界，及工作区汇总继续对全局可见、对角色不可见。当前事件目录核对完成；未来新增带实体载荷的通知必须单独定义范围，不能继承默认广播。
- 后续工作转回分发/迁移和运行检查交付，不再为上述无范围汇总通知增加独立的归属索引。

### Runtime 文档型资源事件归属

- 在提交版本上识别工具定义、正则、提取器的 extension-package origin，Portable Payload 的 ownerInstallationId，以及安装文档的 ID/target。没有给所有文档开放正文 origin 推断；已有 Meta 所有权仍优先，冲突内容不能覆盖它。
- 所有查询继续读取事件对应的文档版本与墓碑，因此删除资源后原提交仍可正确投影，不改写或复制原资源。
- 验证：平台事件集成 4 项通过，覆盖同包 A/B 的五类 Runtime 文档、删除后旧提交、任意正文伪造 origin 与冲突 Meta 不投递；Server 类型检查通过。
- 其余平台事件的投递语义仍须逐项收口，不能把未知通知默认广播给所有角色安装。

### Prompt 资源与挂载提交投影

- Prompt Store 通过已有 Header Revision 提供按版本读取 metadata 的轻量查询，不重建整棵资源树。Server 用事件中的资源版本核对 extension-package origin 与安装 ID，不用当前归属解释旧提交。
- Setting/Tool 挂载的创建和删除操作记录当时所属 Preset 的 ID/version；删除挂载后仍能判定事件归属。DataCommitOperation.scope 增加可选 version，沿已有 Kernel 摘要传递，不建立新归属历史表。
- 私有扩展只收到本安装的 Prompt 资源及其 Preset 挂载变更；全局 manual 挂载保持不向角色投递。旧无 scope/version 的挂载提交没有可靠归属时不猜测。
- 验证：真实 SQLite 平台事件集成 3 项通过，新增用例覆盖资源 A→B 转移、删除资源及挂载后重读旧事件、Settings/Tools 两种挂载、全局挂载和其他包不投递；Server 类型检查通过。
- 剩余：其他平台通知及 Runtime 文档型资源的归属仍需逐类核对；本次只补齐 Prompt Store 的提交投影，不宣布整个事件矩阵或 B3 完成。

### 正式扩展面板的角色安装入口

- 现有随包文件行改接角色包安装和完整更新生命周期；安装只登记资源/包，不自动启用模块。更新确认说明代码与资源覆盖、模块重启、能力变化需重新启用及失败可能停用的边界。
- 增加独立的“当前运行角色 · 已安装”区域，不依赖附件仍在角色包中；因此移出归档后仍可进入模块详情和卸载。复用原 MasterDetail 模块详情，选择携带 cardId，不把同包的全局模块当成角色模块处理。
- 启用角色代码前确认可信代码边界；模块详情消费 Server 下发的能力声明，提供现有事件/资产/通知授权勾选，所有启停、授权、重载都传安装目标。移除资源与卸载安装仍是不同操作，卸载确认说明失效引用及保留数据。
- 修正 Client 激活失败时的显示：没有运行实例的 degraded 摘要不视为运行中，并在详情呈现失败原因。已移除被新入口替代且无消费者的资源型 Hook 包装与旧文案，底层资源型 API 保留。
- 验证：Client/Server 类型检查通过；真实 Server 角色安装/升级/授权/恢复/卸载用例 1 项通过。未执行浏览器按钮与弹窗交互验收，也未做人工视觉验收；这只是 B5 必要接线，不代表独立前端 Plan 的文件夹双入口和运行检查工作台完成。

### 角色 Client 激活与背景作用域

- 已移除 Manager/Client Host 的角色 Client 总禁用 gate。目录只加载当前 Card 的模块，加载前后核对角色；切换后旧实例、命令、背景和 Renderer 注册释放，全局实例继续运行。普通工作台布局未改，正式角色模块管理入口仍待接通。
- SDK 命令上下文包含实际 cardId，输入框和舞台动作同时消费全局与当前角色包，按安装身份查找命令。被移除安装的 summary 在 stop 后清理，避免残留为当前模块。
- 背景注册使用安装级键、固定来源字段，列表按角色过滤；捕获的旧上下文不能再次激活。角色模块或角色背景的激活只写非持久化 scopedBackground，按 ownerKey 清理，不覆盖玩家全局背景偏好；外观面板选择角色背景也走同一临时覆盖。角色切换、停用/卸载时恢复全局背景。
- 非命令型 Client 模块启用后正常执行，可直接注册背景，不要求伪造 Renderer；纯命令模块保留已有按需加载。代码包更新可恢复能力声明未变的原已启用 Client 模块，由浏览器 Host 消费新版目录，不在 Server 执行 Client 代码。
- 验证：Client Host 22 项和 Hook 生命周期 5 项通过，包含实际执行注入的 Client Module、同包 Global/A/B、目标化 Config 调用、私有命令身份、切换后的拒绝/释放、背景不改全局偏好及纯背景模块启动。真实 Server 生命周期 1 项通过，包含角色 Client 启用状态、升级/恢复/卸载；Server/Client 类型检查通过。
- 验证边界：Client Module 通过测试 loadModule 注入执行，不等于真实浏览器动态 import 或视觉验收。浏览器模块文件/跨窗口运行、正式安装授权 UI、其余未分类平台事件等仍待交付；B3/B5 不据此标记整体完成。

### 角色模块的归档级文件地址

- Manager 下发角色包的 `archiveDigest`，模块入口、包图标与 SDK files.url 统一使用 `/card-extensions/<card>/<package>/<version>/<digest>/files/...`。摘要位于目录路径，因此相对 import、CSS/图片引用也自然包含同一归档身份，不只刷新入口查询参数。
- 服务端只允许读取当前安装绑定的版本与摘要；归档更新后旧摘要地址返回 404，不用旧 URL 返回新文件。未发布的无摘要角色路由已删除；全局文件地址保持原样。
- 同版本更新也改变入口 URL，现有 Client Host reconcile 可以识别并重新加载。代码实际加载 gate 尚未解除，不据此声称浏览器模块链已完整运行。
- 验证：沿现有真实 Server 生命周期测试校验同版本更新前后的入口与相对依赖 URL 均变化、依赖返回对应源码、旧入口/依赖拒绝读取；资源型安装文件用例一并通过，共 2 项、其余 5 项未运行。Server/Client 类型检查通过。未进行浏览器 import 执行验收。

### 当前角色 Client 目录下发

- Client Runtime 分别取得全局与当前 Card 的安装列表，合并给 Host，向现有 UI 仍分别返回 `packages` / `cardPackages`，不把同名安装混入旧的全局选择器。作用域取现有 Renderer Host 的实际 Card 快照。
- 切换 Card 立即清除旧角色目录并让 Host 保留全局模块，随后加载新角色目录。请求序号与作用域检查拒绝迟到响应；新角色目录失败不保留旧角色安装。生命周期重建清空目录缓存，避免旧 endpoint 缓存送入新 Host。
- 模块启停和重载携带安装目标，SSE 重载键也使用安装级身份。规则/提取器的“已导入”状态按 origin.installationId 匹配，旧未标记来源只视为全局。
- 验证：现有 Hook 生命周期与资源映射共 6 项定向通过，覆盖 A 请求晚于 B 返回、切换后目录失败、旧 Effect 清理、同 Host Effect 重放、全局实例不重启以及全局/角色导入状态分离；Client 类型检查通过。
- 尚未解除 Client 代码 gate，角色目录用例验证停用模块下发而非私有代码运行。背景注册/选择的作用域、同版本代码更新的浏览器模块缓存，以及正式角色模块操作入口仍待闭环；未进行浏览器视觉验收。

### Client 命令身份与扩展日志归属

- Client 命令注册保留结构化的 package/module/command/target，不再从编码键拆解身份。输入框、舞台动作和工作台命令调用传递目标；诊断去重和注册详情也按安装区分。执行前固定请求，并在队列内及激活等待后核对当前 Card，拒绝切换角色后残留入口的调用。
- Server/Client 的扩展日志、生命周期日志携带角色安装 ID；SDK 查询由宿主固定包及安装，拒绝请求自行设置 installationId。Memory/JSONL 共用安装过滤，未标记的旧全局日志仍归全局，不推测历史归属。
- 日志写入额度改为每个安装共享于其模块/重载，A 的日志不会耗尽同包 B 的额度；不另建日志存储或复制历史。普通工作台日志读取不指定安装时仍可总览，SDK 扩展查询不能使用这种无范围模式。
- 验证：Client 命令相关 5 项通过；日志历史与 Host 合同共 11 项最终通过，覆盖 Global/A/B 的真实模块记录/查询、生命周期归属、拒绝伪造安装和历史按安装过滤。Host 新测试首轮传错 Logger，修正测试为项目既有 child Logger 后 4 项复验通过。Server/Client 类型检查通过。
- Client 激活限制尚未解除：背景注册/选择、包列表下发和正式角色入口仍未闭环。本轮仅接命令身份和日志边界，不把已有 gate 下的命令验证描述为私有 Client 模块端到端验收。

### 角色代码包显式更新

- `extensions.updateCardPackage` 校验当前 Card 归档版本和安装文档版本，先停止旧安装的模块，再沿既有事务替换资源与归档引用；不建立第二套资源更新存储。成功后清理旧注册，发现新版本并恢复符合条件的模块。
- 只自动恢复原已启用、ID/runtime 相同且能力声明未变的 Server 模块。新增模块、runtime 改变或任何能力声明变化均保持停用；原授权仅保留新版仍声明的部分，不自动授予新权限。角色 Client 激活限制仍保留。
- 资源提交失败时，旧资源保留、旧模块停用，错误明确提示停用状态；资源已经提交后若恢复流程抛错，明确告知新版已采用，不自动回滚资源或重新执行旧代码。Host 激活失败状态仍随返回的模块 runtime/诊断提供，不将 desired.enabled 当作实际运行成功。
- Client StudioApi 已接角色安装/更新/卸载、目标化列表与模块控制，旧调用省略 target 时仍明确使用全局。正式确认弹窗和角色模块管理入口尚未消费这些新代码包 API；既有资源型操作入口未偷换语义。
- 验证：扩展现有真实 Server 生命周期用例，覆盖旧安装版本请求拒绝且旧模块仍工作、A 升级后 B 不变、新模块默认停用、同版本内容更新及能力变化要求重新启用、新版重启恢复与后续卸载。定向 1 项通过，Server/Client 类型检查通过。未做进程中途崩溃或持久化写失败注入。
- 剩余边界：模块期望状态目前仍在独立 JSON 中，资源在数据库事务中；更新中途进程退出可能留下停用状态，需要用户重新启用，不宣称两者跨存储原子提交。Client 生命周期、正式 UI 入口和其他 B3/B4/B5 项继续推进。

### Manager 角色 Server 模块生命周期

- 新增 `extensions.installCardPackage` / `uninstallCardPackage`；安装读取角色随包归档并导入资源、绑定来源，不自动执行代码。模块启用、停用、重载与包列表接受 Global/Card 目标；默认列表仍仅显示全局包，避免旧 UI 按 packageId 混合安装。
- 私有包按归档内容摘要解包到全局扫描目录之外，同内容可共享不可变文件，Host 实例、授权和注册仍按安装身份区分。文件请求复用该持久目录，移除之前逐请求临时解包路径。
- 启动时从安装文档及绑定归档恢复角色目录，只恢复该安装明确启用的 Server 模块及其授权；来源不可读时报告诊断，不猜测新版附件或全局包。
- 卸载先持久停用并释放所属模块，再原子移除资源及安装文档，最后清理对应授权和 Host 记录。释放失败保留停用安装以供重试。角色删除通过已有删除回调先停止模块，安装文档随 Card 删除事务移除，提交后清理注册与授权；其他角色不受影响。
- 角色 Client 模块仍明确拒绝启用；代码包更新现由上方独立生命周期入口处理，资源型更新入口不能绕过代码生命周期替换已有代码包。`installCardPackage` 不承担更新，普通重装不覆盖。正式 UI 的安装/授权控件仍待接线。
- 验证：真实 Server 角色生命周期、既有全局恢复、包资源与卸载失败恢复共 3 文件 / 10 项通过，覆盖 A/B 独立授权、显式启停重载、移出随包附件后的重启恢复、卸载 A 不影响 B、删除 B 后不恢复，Server 类型检查通过。删除临时解包路径后复验角色生命周期与资源型归档两项。
- 限制：共享解包目录当前保留，不在单安装卸载时删除以免影响其他引用；尚无缓存回收。未验收角色代码更新、Client 激活、全部平台事件、异常归档安装的 UI 恢复与人工体验，B3/B4/B5 仍未整体完成。

### 已安装角色扩展的归档来源

- 安装文档记录 `archiveBlobId`；角色资源安装/更新与该引用在同一事务提交，并核对 Card 版本与归档包身份。仅修改随包归档不切换已安装来源，用户显式更新后才采用新版；这不是 Timeline 版本固定。
- 角色扩展文件 URL 只读取安装记录对应的归档，不再读取当前随包附件。附件被替换或移出角色包后，已有安装继续读取原归档；未安装或旧记录缺少归档引用时明确失败，不猜测来源或回退全局。
- 同版本但不同归档内容也要求显式更新。旧资源型安装可通过重新导入绑定归档；普通重复导入仍不覆盖已编辑资源。已有归档绑定的更新必须提供当前 Card 归档，不能只改版本而保留旧代码文件。
- 验证：复用真实 Server 的 offline resource-only 用例，覆盖未安装拒绝读取、替换附件后仍读旧版、显式更新切换、同版本替换拒绝普通导入、移除附件后安装文件仍可读。1 项通过、其余 4 项未运行；Server 定向类型检查通过。
- 尚未完成：私有代码模块的持久解包目录、启用/授权、重启恢复、卸载和 Card 删除清理。本次不开放角色代码执行，也未做浏览器或重启验收。

### 角色包文件 URL

- Client files.url 在角色安装中生成 `/card-extensions/<card>/<package>/<version>/<digest>/files/...`，服务端读取该 Card 的安装归档（见上方最新来源记录），不回退全局目录。
- Manager 资源导入与文件读取复用归档准备流程，核对包身份/版本，复用安装器解包预算和文件路径/真实路径校验，响应仍为 no-store。读取文件不发现或激活模块。
- 此处最初逐请求临时解包；现已由上方 Manager 生命周期切片替换为持久目录复用。
- 真实 Server 单用例通过：无全局安装时读取角色包文件、错误版本拒绝、目录逃逸拒绝，并保留既有角色安装/更新/移除行为；Server/Client 类型检查通过。
- 尚未完成：Manager 私有代码模块的安装/授权/重启恢复/卸载与 Client 下发，实际加载/渲染验收。角色 Client 显式加载限制保持。

### 独立 Renderer 窗口生命周期

- Session Host 复用 Renderer Host 的安装/范围判断；打开前检查范围，角色或 Timeline 切换使贡献不再适用时撤销通道并关闭对应窗口，注册被移除也会撤销窗口。
- Client 模块打开的独立窗口加入模块释放句柄，卸载时不遗留窗口；订阅在打开时建立、dispose 时释放，支持宿主清理后重建。
- Renderer/Session 两份相关测试共 9 项通过，覆盖角色/Timeline 切换、全局窗口保留与移除注册后的清理；Client 类型检查通过。窗口关闭通过测试替身验证，未做真实浏览器窗口验收。
- 包文件 URL、Manager 私有代码包安装/下发和真实挂载验收仍待完成，角色 Client 加载限制尚未解除。

### Renderer 安装身份与当前角色

- Renderer owner 可带安装 target，贡献 key 按 Card 安装区分，既有全局 key 不变；Host 注册和自有贡献查找使用同一身份。
- 工作台作用域快照带当前运行角色（优先 Timeline 来源），注册表 list/find 过滤其他角色，私有 claim 与实例追踪核对 Workspace/Timeline/Session 或节点实体范围。角色切换释放不可见私有贡献的占用及追踪记录。
- Client Renderer Host 现有测试文件 7 项通过，包括 Global/A/B 同名共存、越界占用拒绝和角色切换记录清理；Client 类型检查通过。
- 尚未验收真实 DOM 挂载销毁、独立 Renderer 窗口的跨角色清理，也未完成包文件 URL 和 Manager 私有模块下发；角色 Client 加载限制不解除。

### Client 角色资产 URL

- Host 为资产 URL 固定包、模块和角色安装身份；角色请求使用独立 `/extension-assets/...` 路径，普通工作台和既有全局资产 URL 保持不变。
- Server 检查角色及安装真实存在，自有资产按安装识别；其他资产要求 assets.read 且处于同角色/全局可见范围。与 Server SDK 共用安装可见性函数，不另建资产存储。
- 两个聚焦用例通过：Client URL 携带目标、普通资产 HTTP 仍可读、伪造/不存在的角色安装路径返回 403；Server/Client 类型检查通过。成功的私有模块资产展示尚未端到端验收，不能用拒绝用例代替该验收。
- 本边界约束 SDK 路由，不将同源可信 Client 代码描述为浏览器沙箱。包文件 URL、Renderer 和 Manager 私有模块生命周期仍待完成，角色 Client 激活限制保持。

### Client RPC 安装路由

- Client Host 调用包 RPC 时附带固定包 ID 和安装 target，经 `extensions.callPackageRpc` 转发到 Kernel 已有安装级注册表；业务 params 中伪造 target 不改变路由。
- 转发校验方法命名空间及实际注册所有者，不能借包 RPC 入口调用 Kernel 方法。私有方法缺失明确失败，不回退全局同名方法。
- 复用同名 Global/A/B RPC 用例验证安装路由、业务参数不能换目标、全局回退拒绝和 Kernel 命名空间拒绝；该用例与 4 个 Client 聚焦用例通过，Server/Client 类型检查通过。
- 仍待 Client 文件/资产 URL、Renderer 范围、Manager 私有模块下发与生命周期；角色 Client 加载限制尚未解除。

### Client State / History 范围接线

- Host 为 State 与 History 请求固定 extensionTarget，客户端适配器覆盖查询中同名字段；RPC 解析复用安装 target 校验。
- Runtime 按真实 Timeline.createdFrom.cardId 校验 State、Narrative 历史及 Session 历史。角色请求不能读 Global State、其他角色 Timeline 或其他角色 Session；consumerAgentSessionId 也校验，不能借它选择越界消费上下文。
- 校验前复制输入，防止跨 await 后更换读取目标；未改变 State 存储、Revision、作者迁移或历史正文。
- 真实 Server 单用例通过，覆盖自有 State/历史读取、Global/其他角色拒绝、Session 和 consumer 越界拒绝；Server/Client 类型检查通过。未执行浏览器诊断。
- Client RPC、文件/资产 URL、Renderer 及 Manager 下发仍未闭环，角色 Client 模块加载限制保持。

### Client Host 配置/记录调用接线

- Client 数据适配器接入安装 target，Host 从激活包描述固定安装身份，配置读取/写入、记录查询和配置订阅刷新都携带该身份。
- 请求构造在扩展查询字段之后写入宿主 packageId/target，扩展不能用查询对象额外字段覆盖归属；缺省 target 明确为 Global。
- Client Host 现有测试文件 21 项通过，包含宿主范围覆盖伪造查询字段与既有订阅/生命周期行为；Client 类型检查通过。没有开放角色 Client 激活。
- State、History、RPC、文件 URL、Renderer 范围和 Manager 下发仍待接线，不能将 Config/Record 完成扩大成 Client 私有模块完整支持。

### Client 数据入口：Config / Record 安装参数

- Runtime、应用 RPC 与 StudioApi 的配置/记录查询支持安装 target；缺省明确查询全局安装，不再将同包私有安装记录混入全局列表。配置 ID 与 Document 归属复用 SDK 既有安装规则。
- 私有配置写入、查询及记录读取核对 Card/Timeline/Session 的实际范围，拒绝 Global 和其他 Card；返回前保留既有版本检查，不创建平行存储。
- 真实 Server 单用例验证同包同 Card scope 的全局/私有配置 ID 分离、列表隔离、精确读取、更新，以及越界写入拒绝；Server/Client 类型检查通过。记录接口仅完成同构接线，未据此宣称完整 Client 运行链路已验收。
- Client Host 尚未向这些调用自动注入 target，State/History/RPC/文件和 Renderer 仍需接续；角色 Client 加载限制保持。

### Client Host 安装身份前置

- Client 包描述可携带安装 target，实例/目录/命令定位键按 Card 安装区分，全局既有键不变。实例摘要、诊断和诊断清理保留 target，不因同包另一安装失败覆盖全局状态。
- 核对发现 Client Config/Record/State/RPC/文件 API 仍直接连接全局数据入口，Renderer 也尚未携带安装范围。因此角色 Client 模块在 import/activate 前明确拒绝，动作入口不展示；不能以实例键分开冒充执行范围已接通。
- 单个聚焦用例通过：Global/A/B 同包并存时只有全局模块被加载，角色实例分别报错，移除 A 不影响全局；Client 类型检查通过。
- 下一步仍需接通 Client 的真实安装数据上下文与 Renderer 作用域，再移除显式限制。此项不是 Client 私有扩展可用性的完成证明。

### 角色代码前置：Portable Payload 安装归属

- Payload 内容增加可选 ownerInstallationId，Host 发布强制写入自身安装，listOwn/readOwn/updateOwn/deleteOwn 按包及安装判断；私有安装只能修改自身角色的 Payload 绑定。
- Server 替换包内绑定时只移除当前安装拥有的旧引用，保留同包其他安装的引用。Runtime 更新和目录 Apply 保留安装归属；用户工作区 API 仍可列出全部数据。
- 新导入角色 Payload 归属于新 Card 对应的安装身份；分发 Artifact 不输出本地安装 ID，再导入按新角色重建归属。已有未标记 Payload 保持原有全局语义，不猜测改归属。
- Host 写请求在跨 await 之前复制输入，避免检查后换 payloadId/cardId 绕过范围检查。
- 两份直接相关测试共 6 项通过，覆盖同包跨安装拒绝、跨角色绑定拒绝、归属列表、角色导入/导出及更新保留归属；Server 类型检查通过。公开角色代码入口仍关闭，Client 与完整 Manager 生命周期仍待完成。

### 角色代码前置：媒体资产安装归属

- AssetStore schema v2 为媒体资产增加可空 ownerInstallationId，历史记录保持无安装归属；复用现有 Blob，不复制二进制。
- Host 发布时强制写入当前角色安装身份，同包但不同安装不再享受“自有资产”免授权读取。read/materialize 共用检查，外部资产仍需 assets.read；角色安装读取其他安装资产还须通过 Server 的同角色/全局可见性判断。
- Server 依据真实安装文档核对包身份和目标；全局宿主既有显式 assets.read 能力不变。此边界针对 SDK，不将可信同进程 Node 扩展描述成强沙箱。
- 两份直接相关测试共 9 项通过，覆盖资产安装身份存储、A 自读、B 即使获 assets.read 也不能通过缺失范围授权读取/物化 A 文件、既有全局能力行为；Server 类型检查通过。未验证公开角色代码安装，因为该入口仍关闭。
- B3 尚余 Portable Payload、Client Host/Renderer、平台事件缺口及 Manager 代码生命周期。

### 角色包内嵌扩展文件

- Card Bundle 增加可选 `extensionPackages` 传输项，JSON 使用归档 base64，角色 ZIP/目录使用独立 `extension-packages/<index>.zip` 文件；不复用文本 Portable Payload，也不递归解包。
- 导入通过现有 Blob prepared write 和 DataEngine 事务保存归档，Card 持有包 ID、版本与 blobId；导出读取同一 Blob，角色内容规范化保留引用。准备或事务失败清理本次 prepared write。
- 这是未启用的归档内容，不创建安装记录、不发现模块、不授权、不执行；声明包 ID/版本尚不作为已验证 Manifest 身份。实际安装时仍需校验归档与 Manifest、路径和权限。
- 设置了归档数量和传输体积预算，拒绝重复包 ID 与非规范 base64；目录 Apply 当前明确拒绝改变内嵌包，不能静默丢弃外部修改。
- 验证：两个聚焦用例通过，覆盖 ZIP/目录二进制原样往返、真实 Server import → Blob → export，以及导入没有安装或发现代码；Server 类型检查通过。
- 尚未完成：从现有安装收集归档、角色私有安装生命周期和依赖接线；因此只是离线持有/分发基础，不宣称角色附带扩展已可启用。

实际文件收集已接线：
- Manager / `extensions.exportPackage` / StudioApi 按已发现包的 ID 和版本导出实际目录 ZIP，不接受任意文件路径；版本变化明确拒绝。
- 安装复制与导出复用同一文件遍历，沿用文件预算、拒绝符号链接及特殊文件，保留二进制和空目录；导出核对归档 Manifest 身份与声明入口文件。
- 真实 Server 用例已验证已发现包 → 归档 → Card 导入/Blob → Card 导出字节一致，模块仍未启用。该单用例、安装器现有 8 项测试及 Server/Client 类型检查通过。
- 尚未完成：现有角色编辑器的归档选择操作、角色私有安装生命周期和依赖接线。文件导出能力不等于整个角色安装链路完成。

现有角色附加归档已接线：
- 新增 `application.attachCardExtensionPackage`，按角色 expectedVersion 保存/替换同 packageId 归档，Blob 与 Card 文档共同事务提交，失败清理 prepared write；校验总归档数量和累计导出体积，避免附加成功却无法导出。
- 正式扩展面板在有当前角色时提供“加入当前角色包”，确认后收集选中包的真实文件并附加；通过既有 Card 编辑命令更新详情与编辑历史，不安装、不启用模块。
- 复用真实 Server 文件收集用例验证已有 Card 附加 → 导出一致、过期角色版本拒绝；Server/Client 类型检查通过。尚未做浏览器或人工视觉验收。
- 角色私有安装生命周期、依赖接线和独立归档列表/移除入口仍待完成；当前附加操作只是离线分发内容管理。

归档移除与列表：
- 扩展面板目录底部增加当前角色的“随包文件”折叠分组；直接读取 Card 归档引用，因此即使全局包目录没有此扩展，也能列出并移除。
- 新增版本检查的 `application.detachCardExtensionPackage`，仅移除 Card 引用，保留 Blob 供历史恢复，不调用卸载或删除运行数据；客户端接入既有编辑历史。
- 同一真实 Server 用例验证附加/导出/过期版本拒绝/移除/再次导出，并确认已发现包仍在；Server/Client 类型检查通过。人工视觉未验收。
- 角色私有安装、授权与生命周期仍未完成，归档列表不是已安装模块列表。

无代码角色安装已接通：
- `extensions.importCardPackageResources` 从指定 Card 的 Blob 引用读取归档，复用安装器解包/路径/预算/Manifest 校验，核对引用中的包 ID/版本，再按 Card target 导入资源。临时文件不加入全局包目录，导入后清理。
- 入口携带 expectedCardVersion，读取和资源事务提交均检查角色版本，避免从已替换的归档提交安装。客户端随包文件行提供“导入资源到此角色”，刷新资源及安装目录。
- 当前明确拒绝含 Module 的包，未绕过 B3 代码执行限制；无代码包可以独立安装到 A/B，不要求全局安装，也不自动替用户挂载全部 Settings。
- 两个真实 Server 聚焦用例通过：离线无代码包在 A/B 生成独立资源/安装、全局目录无此包、过期版本拒绝、代码包拒绝；Server/Client 类型检查通过。未进行人工视觉验收。
- 尚未完成：角色安装的显式更新/移除、代码 Module 的 Manager/Client/文件能力及授权生命周期。此处只关闭资源型角色安装的导入入口，不代表 B3 全部完成。

角色资源更新/移除：
- 增加显式角色资源更新和移除 RPC，限定指定 Card 安装；更新同时核对归档所属 Card 版本、目标包版本和当前安装版本，移除在资源事务内再次检查安装版本。
- 随包文件行接入更新/移除已导入资源，操作前确认覆盖或缺失引用风险；与“移出角色包”的归档操作区分。保留归档、State、历史和安装描述，移除不是卸载代码。
- 扩展同一真实 Server 用例验证 A/B 离线安装后，只更新其中一个到 v2，再移除其资源；另一安装仍保留 v1，过期移除请求拒绝。单用例与 Server/Client 类型检查通过。
- 尚未完成：归档已移出但安装资源仍保留时的独立安装管理视图，以及代码 Module 的运行/授权/卸载生命周期。上述成果仍限定无代码资源安装，不宣称整个包系统或 B3 完成。

### Q5 实施：事务资源替换基础

- PromptResourceStore 增加整树替换 mutation，保持资源 ID，允许新版根节点变化；Header Revision 记录根节点身份，单资源回滚恢复旧树。已有历史 revision 没有根 ID 时仍沿用其原有根节点。
- Runtime 导入增加显式 `update.expectedInstallationVersion`：校验安装版本，在同一 DataEngine 事务内替换作者资源、重建预设挂载、删除新版不再贡献的资源及推进安装版本。普通导入仍拒绝跨版本，不隐式触发覆盖。
- 同贡献保留本地资源 ID；模型绑定保留，作者宏/选项采用新版（新版移除则清空）；其他安装不修改。代码不写 State 或故事历史。
- 验证：整树替换/根节点回滚、安装更新与版本冲突、资源移除、保留模型、其他角色安装不受影响、失败不推进版本；两份直接相关测试文件共 31 项通过，Server 定向类型检查通过。
- 尚未交付：Manager/RPC 的更新确认入口、变化清单与客户端弹窗；包文件/代码更新仍待分发接线。当前只有内部 Runtime 能显式更新，不将此结果描述为用户已经可以更新扩展。

后续接线完成：
- Manager 与 `extensions.updatePackageResources` 已接显式更新；校验用户看到的包版本和安装文档版本。普通导入不覆盖，角色目标继续拒绝，未放开未完成的角色代码安装。
- 正式扩展面板接入全局安装目录与“更新资源”按钮；确认框显示新旧版本、覆盖/删除范围、本地修改风险和保留项，取消不调用更新。成功后刷新依赖资源。
- 更新使用当前发现的包文件，不负责下载、替换物理包或代码热更新。逐资源变化清单、Diff/备份仍未接入；当前确认框没有声称识别用户修改冲突。
- 验证：真实 Server 单集成用例通过，覆盖普通导入仍拒绝跨版本、包版本变化拒绝、安装版本参数校验、资源更新/旧贡献移除、重复旧请求拒绝；Server/Client 类型检查通过。未做浏览器点击或人工视觉验收。

- 本计划接管 [Workspace 分发计划](workspace-resource-and-distribution-plan.md) 中 Preset/Setting 附件分发的旧方向；在线来源、Git 更新与开发模式仍留原计划。
- [Agent Runtime 计划](agent-runtime-session-and-workspace-plan.md) 保留 Run/Session 执行生命周期；这里只迁移它消费的 Agent 身份与资源解析。
- [CodeAct/VFS 计划](codeact-vfs-tooling-plan.md) 保留资产读取与工具安全；包预览不自动扩大其授权集合。
- Architecture 继续记录当前实现，不在本轮将目标模型写成已实现事实。

任务状态：

- [x] 核对 Manifest、安装、存储、运行消费、导出与 UI 调用入口。
- [x] 记录已确认边界、现状差异、工作包和验收场景。
- [x] 收口 Q1：取消 Profile；完整 Agent 预设按功能供用户或程序直接调用，Run/Session 保持执行实例身份。
- [x] 收口 Q2：已有 Timeline 跟随用户采用的资源更新，运行数据兼容与迁移归作者。
- [x] 收口 Q4 生命周期原则：按具体能力与 Timeline 的关联处理，不统一复制整个扩展实例。
- [x] 收口 Q3：角色包内嵌私有扩展；角色卡亦可拥有外部资源链接和后续更新来源。
- [x] 固定单资源导出白名单：format、schemaVersion、resourceKind、rootNode、macros、macroOptions。
- [ ] 完成包分发实现与旧附件转包路径。
- [ ] 实施 B1-B5、执行迁移与场景验收。

计划编写阶段只新增计划及更新计划索引/冲突说明，未修改业务代码、数据库或草稿；当时检查的 5 个文档共 95 个本地链接、状态标记与空白检查通过。该记录不代表后续实现已验收。

### 当前实施切片：Q2 资源解析

- [x] 将规则/提取器、脚本、Settings 使用清单及作者宏的运行读取改为当前角色资源，不从 Timeline 快照补回已移除内容。
- [x] 保留 State 定义的运行约束与已有 Revision，不重算历史正文；旧快照字段仅保留在既有存储中，不再写入新 Runtime Context 或作为动态资源权威。角色名称/User 的缺失来源历史展示信息仍保留，不作为宏候选。
- [x] 最小验证使用现有 `narrative-projection.test.ts`、`loom-script.test.ts`、Prompt/宏集成测试覆盖真实变更，按实际接口变化补类型检查。

本切片复用现有解析与领域 Store，不建立平行资源 Registry；属于 B2/B5 的已确认前置工作，不代表 B1-B5 或完整扩展更新已经交付。其后继续 Agent 单一身份；Q3 到分发合同边界时收口，Q4 按已确认的具体能力关联原则落实。

验证记录：

- `pnpm exec vitest run tests/integration/application-runtime/narrative-projection.test.ts tests/integration/application-runtime/prompt-resource-runtime.test.ts tests/integration/application-runtime/macro-provider.test.ts tests/integration/application-runtime/macro-configuration.test.ts tests/unit/application-runtime/loom-script.test.ts tests/integration/application-runtime/default-preset.test.ts tests/integration/application-runtime/narrative-timeline.test.ts`：7 文件 / 47 测试通过。
- `pnpm exec tsc --project packages/application-runtime/tsconfig.json --noEmit --incremental --tsBuildInfoFile /tmp/loom-agent-presets-runtime.tsbuildinfo`：通过；相关改动 `git diff --check` 通过。
- 归档导入当前不自动恢复来源 Card 绑定，保留该边界：已存宏选择在来源缺失时报告错误，不猜测重绑。本轮未增加归档资源恢复。
- 未执行真实 Provider、浏览器、扩展包更新/安装和全量迁移验收。正式 Profile/Preset 合并尚未开始；不能以本切片通过宣称整体完成。

用户已纠正此前的 Q4 提问：不能将整个扩展的所有变量、任务和监听视为同一生命周期。该阻断已撤销；继续实施时核对具体能力与 Timeline 的关联，不提前扩建 Host 实例体系。

### 当前实施切片：Agent 预设存储

- [x] 现有 Prompt Resource 的预设 metadata 可保存模型绑定与 delivery，读取及列表保留这些字段；Settings 不承载这两个执行字段。不新增 Document 类型或并行配置对象。
- [x] 单资源提示词导出继续使用字段白名单，不输出本地模型绑定与 delivery。
- [x] Runtime 与 RPC 增加直接读写预设的 Agent CRUD。创建只生成同一个 Prompt Resource，模型允许未绑定；工具挂载与资源在同一事务创建。更新要求 expectedVersion，重命名同步树根与列表名称，model: null 解除本地绑定但保留其他 metadata。
- [x] 将 Agent CRUD、Session 引用和运行调用收敛到预设身份，移除旧 Profile API 与双层工具配置；按最新决定不迁移旧 Profile 配置。

验证：`prompt-resource-runtime.test.ts` 9 个测试通过，覆盖预设执行配置存储往返、列表读取以及导出不泄露本地绑定；application-runtime 定向类型检查通过。未运行数据库迁移、真实 Provider 或浏览器验收。

Agent CRUD 验证：`agent-preset.test.ts` 2 个测试、`agent-preset-rpc.test.ts` 1 个测试通过；覆盖无 Profile 文档创建、单份资源读取、模型解绑、工具挂载保留、名称同步、过期写入拒绝、非法输入与非预设拒绝、删除。application-runtime 定向类型检查及相关 diff 空白检查通过。测试中的 Provider 使用 official.fake，不代表真实模型执行验收。

上述存储/CRUD 验证是阶段记录。后续身份切换已完成以下内容，替代先前双入口过渡状态：

- Runtime、RPC 与 Client API 已移除 Profile CRUD，Session 使用 `agentPresetId`；预览、真实 Tool Loop 和文本规则 consumer 直接使用该预设。Provider Profile/Capability Profile 不受此更名影响。
- Agent Store v6 仅重命名引用列，保留旧引用值、Transcript、时间戳与 Timeline 绑定。不读取旧 Profile 文档，不回填默认预设，也不重绑旧 Session。
- `toolOverrides` 已从正式代码移除；工具使用只由 Preset Tool Mount 的持久开关及本轮 Activation 决定。
- 客户端只做合同适配：移除二次预设选择器、允许模型空绑定、显示失效模型身份、工具开关直接修改挂载；Agent/资源双入口在写入后刷新同一资源。未重做 Dock/文件夹布局。
- 通用默认模板与官方问答助手均能作为 Agent Preset 直接创建 Session、绑定模型、预览与运行。官方目录移除单独的 Agent 模板别名，不再保存第二个 Agent ID。
- 文档同步到 `docs/architecture/application/agent/`、Data/Extension/规则说明与官方内容说明；测试夹具改为直接配置同一预设，不新增旧格式兼容层。

验证记录：

- `agent-preset.test.ts` 与 `official-content.test.ts`：2 文件 / 8 测试通过，含两份官方模板的无模型拒绝、绑定后预览/请求一致、正文/宏保持。
- Session/引用删除/宏配置/扩展 Storage/Agent Store 聚焦复验：5 文件 / 45 测试通过。早期大组中的旧夹具失败已分别修正并复验，不把失败批次记作全绿。
- RPC/Agent 面板/Session 列表聚焦复验：3 文件 / 19 测试通过；扩展资源移除与 mutation context 已在相邻 RPC 组通过。
- v5 → v6 原数据保留、选择器和 RPC 路由验证：5 文件 / 58 测试通过。
- 官方内容目录与安装/导出/客户端对话框：2 文件 / 7 测试通过。
- Application Runtime、Studio Server、Studio Client 定向类型检查通过；`git diff --check` 通过。根 solution 的空检查不作为测试文件类型验收证据。

尚未完成：B1 包归属/安装关系、B3 角色扩展上下文、B4 新分发实现、B5 完整运行检查查询；Q3 已获确认。未做真实模型、浏览器或人工视觉验收，也未为验证主动打开用户实际数据库或重启其服务。不能以 Agent 合并切片验收代替整体后台计划完成。

### 当前实施切片：单资源导出边界

- 正式 `exportPromptResource` 只输出上面的显式白名单；JSON 与 ZIP RPC 都消费该出口。不扫描脚本挂载，不读取附件 Blob，不递归携带配套内容。
- 删除仅供旧单资源导出的 `exportPresetScriptAttachments`。旧附件 reader 和持久化行为保留，导出不会删除本地脚本或挂载；组合分发仍须后续扩展包导出，不将这个切片描述为旧包转换已经完成。
- `pnpm exec vitest run tests/unit/application-runtime/workspace-artifact-boundary.test.ts`：14 项通过。新增边界覆盖先导入带脚本的旧预设，再用未配置 Blob Store 的 Runtime 导出纯提示词，验证原挂载未变；同文件的角色包脚本往返仍通过。
- 本轮未改变角色包格式或 installer。已核对 `card-bundle-zip.ts` 与 `extension-package-installer.ts`：Portable Payload 是私有数据而非程序包；角色内嵌扩展必须独立建索引并复用现有安装校验，不能将它塞进 Payload 或在解包时自动启用。

### 扩展资源导入修复

- `extensions-runtime.ts` 创建 Prompt Resource 时已保留作者 `macros` 与 `macroOptions`，同版本重导入继续保留用户编辑，不重建资源。
- 扩展声明的 Prompt Resource 不允许夹带旧式脚本或正则附件，必须通过包的正式贡献入口表达；现在在任何写入前明确拒绝，不再悄悄忽略。旧单资源 Artifact reader 仍可读取合法附件，旧附件转包尚未实现。
- Prompt Artifact 校验复用现有声明式规则校验，拒绝错误类型的 `textTransformRules`，避免 malformed JSON 被误判为合法且空的资源。
- 验证：`extension-resource-import.test.ts`、`workspace-artifact-boundary.test.ts`、Server `extension-package-resources.test.ts` 共 3 文件 / 21 测试通过，覆盖宏保存、重导入保留编辑、嵌套资源/非法规则拒绝且无部分提交，以及现有扩展资源安装和移除。

### B1/B3 最小实施定位

**目标**：同一扩展可分别安装到全局、角色 A、角色 B；资源身份、授权和启用不串用，不将整个 Module 按 Timeline 复制。

**已核实事实（本切片实施前）**：
- Runtime `extensions-runtime.ts` 的 origin 索引、版本检查、移除目前按 packageId 聚合；Tool Document ID 直接使用包贡献 ID。
- `extension-state-store.ts` v3 将模块启用和授权保存在 `packages[packageId].modules`；不能用同一个键表示多个角色安装。
- Prompt Store 节点 ID 为全局主键；重复安装同一份带包内节点 ID 的树会冲突。不能只改资源根 ID，也不能对正文任意做字符串替换。

**继承决策**：安装目标只有 Global/Card；Timeline 是能力运行关联，不是安装身份。下载文件可共享；角色私有文件随包携带；导入不等于启用或授权执行。

**最小实现**：在既有领域存储中记录包的本地安装身份与目标，保留 authored package/contribution 身份。资源映射和模块授权均使用同一安装身份；外部引用仍定位本地资源 ID。运行消费以当前 Card/Timeline 解析可用安装，不能让声明角色归属的资源仍被全局注册表无条件消费。不开第二套通用 Resource Store。

**工作包**：
1. 数据合同与安装资源映射：`application-runtime/src/types.ts`、`cards/workspace-types.ts`、`foundation/document-types.ts`、`runtime/extensions-runtime.ts`。先覆盖同包 A/B 安装、重导入与移除的隔离；全局现有资源按其真实全局归属处理。
2. 安装身份贯通 Module 与运行消费：Server `extensions/extension-manager.ts`、`extension-state-store.ts` 及 Host 注册/Storage 边界；Runtime 规则、PromptBuild 和工具解析。与第一包一起接通后才对外开放角色安装，不能先暴露可绕过归属的参数。
3. 内嵌分发：`codecs/card-bundle-zip.ts`、`card-bundle-files.ts`、`extension-package-installer.ts` 及 Card 导入事务。消费前两包的安装合同，不另建 ZIP 专用身份。

**验收与验证**：真实 A/B 卡与全局同包夹具验证资源 ID 不碰撞、启用/授权不互用、卸载 A 不影响 B、越界调用失败；之后补一份含扩展文件的角色包离线往返。沿用现有 Runtime/Host/Server 测试，不新增测试框架。

**开放问题**：Q3 已确认，无需再次提问。上述作用域链路尚未实现；本节是按源码定位的实施顺序，不是完成证据。

### 当前实施切片：安装资源身份

- 新增 `airp.extensionInstallation` 领域记录：packageId、packageVersion、Global/Card 目标与时间戳。复用 Document Store，与 Prompt/Tool/规则资源导入共享事务；不建通用资源注册表。
- 安装身份由包及安装目标确定，不包含 Timeline 或版本。资源 origin 保留包内 contributionId，并关联 installationId；同一目标的更新仍须后续明确版本更新合同，现有“显式迁移”校验暂未移除。
- Runtime 内部导入/移除支持目标，按 installationId 去重和移除。不同角色的节点与工具生成独立本地 ID，Settings/工具挂载引用同一安装内资源；树排序引用随节点 ID 改写，正文不替换。不同安装可采用不同包版本。
- 已有不带 installationId 的扩展资源仅视为旧全局资源，首次登记安装不重写其 ID、正文或用户配置，不归入任何角色。移除资源不等于卸载包，安装记录暂保留供同目标重导入。
- Kernel 对公开资源导入/移除中的 target 参数明确拒绝，防止把角色请求静默当成全局操作。Server Manager、模块授权与运行消费未切换前，不开放角色安装。当前 `ExtensionStateStore` 仍按包保存全局模块状态，不能将这次数据隔离当成代码运行隔离。

验证：Runtime 导入单测、Server 扩展资源集成、RPC 路由共 3 文件 / 23 测试通过；扩展导入单测随后补充不同安装使用不同版本的场景，7 项复验通过。覆盖 Global/A/B 的资源、工具、规则、提取器 ID 隔离，删除 A 不影响 B/Global，恢复保留本地身份，旧全局 origin 保留，缺失 Card 写入前拒绝，以及公开接口拒绝尚不支持的 target。Application Runtime 与 Studio Server 定向类型检查通过。

下一步是 B3 的安装身份贯通，不是继续添加另一层资源模型：模块启用/授权、Host Storage/RPC/Tool 路由、当前 Card/Timeline 的消费过滤需要使用同一安装身份；之后才接通角色包内嵌文件的实际安装路径。

### 当前实施切片：运行消费的安装过滤

- 当前 Card 上下文解析可用安装集合；全局安装可用，角色安装仅在所属 Card 可用。旧无 installationId 的全局资源保持原有归属。
- Agent Turn 准备阶段拒绝越界 Agent Preset；Prompt 读取过滤越界 Settings，并仅将已读取且可用的资源加入 VFS。工具挂载、规则和提取器消费增加同一安装检查。
- 官方 Prompt Resource 搜索和精确读取使用安装集合；搜索过滤后继续读取后续页，避免私有资源占满页面导致公开资源不可见。运行时 Prompt Resource 修改入口同样检查归属。
- 已验证：`extension-resource-import.test.ts` 与 `official-agent-tools.test.ts` 共 2 文件 / 18 测试通过。新增真实 Runtime 用例证明私有 Agent 在所属 Card 可预览，在其他 Card 与独立 Session 中预览/执行均被拒绝，且无 Gateway 调用、无对话写入；官方工具搜索不返回私有资源，精确读取拒绝越界并允许所属安装。Runtime 类型检查通过。
- 后续验证：扩展导入测试现为 12 项通过。新增 Global/A/B 规则与提取器集合验证，覆盖 Narrative 和绑定 Session；Settings 即使被全局挂载或显式传入，也只注入所属 Card 的内容，VFS 资源集合排除其他 Card；挂载越界工具的预设在预览和执行时均失败，无模型调用与对话写入。
- 尚未验证：VFS 集合已有直接断言，但尚未用 QuickJS 执行越界读写；Prompt Resource 修改入口仍需直接行为测试。Server 模块启用/授权与 Host 路由尚未贯通，不能据此宣称代码执行权限隔离完成；公开 Card 安装仍保持关闭。

### 当前实施切片：模块状态按安装持久化

- 将安装 ID 算法提取为 Runtime 的纯函数导出，资源导入与 Server 状态存储共享同一 Global/Card 身份，不包含版本或 Timeline。
- `ExtensionStateStore` 改为 v4 `installations`，启用和授权读取、写入、删除都按安装身份操作；现有 Manager 调用未传目标时明确保留全局行为。v2/v3 状态仅迁入全局安装，首次后续写入保存 v4，不复制旧授权到 Card。
- 删除操作的存在性检查放入已有写入队列，保证紧随创建排队的删除不会提前判定“不存在”而漏删。
- 验证：State Store 单测 12 项、Server 重启集成 1 项通过；卸载单测同步既有空 UI 授权预期和 v4 文件预期后 3 项通过。覆盖 A/B/Global 的启用授权隔离、重启保留、仅删除指定安装、旧版本迁移、队列创建后删除。Runtime 构建与 Server 定向类型检查通过。
- 未完成：Manager 的 Card 安装生命周期和 Host 实例、Storage、RPC、工具路由仍需使用此安装身份；此切片只是持久化基础，不是公开 Card 模块执行功能已完成。

### 当前实施切片：Host 安装实例身份

- 安装目标类型与 ID 算法下沉至既有 Extension SDK，Runtime 继续提供同名出口；Host 不反向依赖 Application Runtime，不重复身份算法。
- Host 的 discover/activate/reload/dispose/forget 按安装身份与 moduleId 查找记录，未传目标仍为全局。Module Summary 返回 installationId 与 target；生命周期不按 Timeline 复制实例。
- 授权回调接收安装目标，Server 经 Manager 从对应安装状态读取授权。旧全局调用不继承任何 Card 授权；Manager 当前的全局目录视图明确过滤 Card Host 记录。
- 日志继续使用作者的 packageId/moduleId 可读名称，内部 Map 键不直接展示为日志标题。
- 验证：Host 安装合同证明 Global/A/B 同包三实例独立激活、授权、停止、重载、遗忘，并禁止重新发现仍活跃的安装。Host 合同及状态/卸载检查首轮 16 文件 / 88 项中 86 项通过，2 项日志回归已修复并定向复验（日志与安装合同共 4 项通过）。随后 Server 卸载与重启共 4 项通过。Host、Runtime 构建以及 Server 定向类型检查通过。
- 未完成：这还不是 Card 执行权限闭环。Storage 目前仍以 packageId 认领数据；RPC/Event、Tool/Macro/State/Renderer 和文件路径仍需安装级路由/目标约束。Manager 未提供公开 Card 代码安装与启用，不能将 Host 内部可建多实例等同于用户可安全启用角色附带代码。
- 下一步依据当前源码：`extension-host/src/storage.ts` 的 Config/Record 列表、按 ID 读取和写入均需约束安装身份，Server `validateStorageScope` 需由“目标存在”扩展为“目标属于授予的 Card”，并覆盖 Timeline 和 Session 的真实归属；原始 documents 等旁路需一起审视，不能只修表面列表。

### 当前实施切片：Storage 与原始文档安装归属

- Document 元数据增加 `ownerInstallationId`，沿用现有 JSON 元数据持久化，不新增表或通用资源模型。未标记安装的旧文档仍属于全局安装；Card 文档携带稳定安装 ID。Memory/SQLite 的列表均支持安装过滤，分页游标绑定同一过滤条件；省略过滤仍可用于宿主跨安装管理。
- Host 强制设置 Config、Record 和原始 documents 的安装归属，读取、更新、删除均验证安装；SDK 类型不允许模块自行指定归属。Card Config ID 带安装身份，全局旧 Config ID 不改变，同包同 scope 不再互相覆盖。
- Card 安装不得请求 global 或其他 Card 的 Storage Scope。Timeline/Session 及实体引用的真实归属由 Server 验证；无绑定 Timeline 的 Session 不归入任意 Card。Config/Record 列表亦使用安装过滤，Card 列表和按 ID 操作进一步校验 scope。
- 验证：安装合同、既有 Storage/文档归属合同和两种 Document Store 共 4 文件 / 88 项通过。覆盖同包 Global/A/B 的 Config/Record/raw documents、安装元数据伪造、越界读改删、更新和回滚保留归属、游标不能跨安装复用。随后补强更新与伪造断言，安装合同加既有扩展存储生命周期共 3 项通过。Host 构建和 Server 定向类型检查通过。
- 修复本次检查发现的回归：游标长度从固定值改为对应过滤字段长度，并保留未指定安装过滤时的旧游标形态；直接构造 ModuleRecord 的测试夹具显式声明 global，不增加运行时缺失目标的静默回退。
- 尚未验证：Server 的真实 Card/Timeline/Session 归属回调需在公开角色安装路径接通后补集成验收。此切片不覆盖 RPC 调用、事件订阅、State/Macro provider、工具注册、附件及 Portable Payload 等其他宿主 API 的完整安装隔离；不能宣称角色代码执行已经安全开放。

### 当前实施切片：RPC 与工具执行器路由

- Kernel 将角色私有 RPC 与公开全局方法分开索引。作者方法名保持不变，Host 注册与调用携带安装目标；默认只查当前安装，不以同名全局方法作缺失回退。停止/重载只清理对应安装的注册。
- Server SDK 的 `ctx.rpc.call(method, params, { scope: 'global' })` 显式调用已启用的全局扩展服务；默认 `installation` 使用当前安装，不能指定其他 Card。保留拒绝 Kernel/Studio namespace 的原有边界。普通外部 Kernel 调用及 introspect 不暴露私有路由。
- 工具定义导入、包内节点和 Tool Handler 注册共享 SDK `installedExtensionContributionId`，角色安装使用独立执行器 ID；Manifest 声明及贡献匹配仍使用作者 ID。无需另建工具注册系统。
- 验证：RPC 注册、Scope 清理和 Server 重启共 3 文件 / 12 项通过，覆盖 A/B/Global 同名调用、安装内嵌套调用、业务 params 不能改变路由、显式全局调用、缺失不回退及停止 A 不影响 B。工具安装合同 3 项复验通过，证明三份同名工具分别执行且 disposer 仅移除所属执行器；Runtime 资源导入 12 项通过。Kernel 构建与 Server 定向类型检查通过。
- 尚未完成：Event 路由与订阅目标过滤、Macro/State/Narrative Provider、Client Renderer、附件与 Portable Payload，以及 Manager 公开角色安装生命周期和分发接线。整个 B3 未完成，不据此开放角色附带代码。

### 当前实施切片：自定义事件安装路由

- Host 的事件注册、发布和订阅身份携带安装目标。Kernel 自定义事件定义按目标与作者事件名查找；同包 Global/A/B 可声明同名事件，不发生覆盖或误清理。
- 扩展订阅只接收相同安装目标的自定义事件，授权仍按事件 visibility/capability 检查。注册订阅时跳过其他安装的定义，发布时再次检查，避免订阅早于事件定义时绕过授权。
- 事件对作者保留原名；Card 自定义事件增加 `meta.installationId` 来源，宿主观察者可分辨。事件名称目录去重展示作者名称，不显示内部编码键。
- 验证：新事件合同、既有 State 订阅、Kernel RPC 合同首轮共 3 文件 / 23 项通过；补充跨安装不同 visibility 与迟注册授权用例后，新事件合同 2 项复验通过。Kernel 构建通过。
- 未完成：这只覆盖扩展自定义事件，不覆盖平台事件的 Card/Timeline/Session 目标过滤。平台级 State、Document、DataCommit 等仍须由各自真实领域事实确定可见范围，不能仅凭 event name 或订阅 grant 放行。下一步连同 State read/write/subscribe 的宿主边界推进；公开 Card 执行继续关闭。

### 当前实施切片：State 访问与订阅目标

- Host 增加由 Server 提供的 State 目标可访问性查询。角色安装的 read/write 在调用 Runtime 前检查 Timeline 真实归属，拒绝 Global、其他 Card 和未知 Timeline；全局扩展保持现有行为。未接入角色校验的宿主明确失败，不降级放行。
- `ctx.state.subscribe` 与通用事件订阅里的 `state.changed` 共用过滤，不能换一个订阅入口获取其他角色通知。归属查询完成后再次确认订阅与实例仍活跃，取消期间不交付迟到事件。
- State 请求在异步边界前复制，防止通过修改目标或操作内容绕过已经完成的检查；EventBus 每个订阅者获得独立事件副本，避免前一个回调改写后一个回调的事件与校验目标。
- 验证：使用真实 SQLite、Narrative Store、State Runtime 和 Server 归属查询的集成检查，加 State 取消合同与事件副本合同，共 3 文件 / 14 项通过。覆盖 A 正常读写、B/Global 读写拒绝且状态未变、两种订阅 API 仅接收 A、异步校验后修改输入仍使用原请求、取消订阅/实例后不交付、事件副本不串改。Server 定向类型检查及 Kernel 构建通过。
- 尚未完成：State 定义贡献注册仍待安装化；其他平台 Document/DataCommit/生命周期事件的目标过滤、其他 Provider、Client 与文件/Payload 边界仍未完成。本集成不是 Server 公开角色安装端到端验收，公开入口继续关闭。

### 当前实施切片：State 贡献与动态宏

- State Contribution Registry 用安装级本地 contributionId 索引，并记录安装目标与身份；贡献内部的作者模板/实体 ID 保持不变。角色继续引用确定 ID，不引入自动选择或缺失时的全局回退。
- 创建 Timeline 时验证所选私有贡献属于当前 Card；验证在持久化之前完成。删除注册不修改已有 Timeline State，也不影响同包其他安装。
- Macro Provider 由 Host 转换为安装级本地 ID，Registry 按当前 cardId 过滤后才调用 resolver。私有 Provider 的 global 上下文投影为空对象，保留所属 Timeline 数据；全局 Provider 保持原有上下文。用户显式选择的失效来源仍报告 macro.error。
- 验证：Timeline 生命周期与 Host State 贡献共 2 文件 / 16 项通过，覆盖不同安装的不同初始值、越界贡献拒绝且不创建 Timeline、注册移除不重置实际值。Host 宏注册与 Runtime 宏配置共 2 文件 / 10 项通过，覆盖同名多安装、外部 Provider 不被调用、私有上下文无 Global State、失效选择不回退。Server 类型检查与 Runtime 构建通过。
- 尚未完成：Narrative Context Provider、其他平台事件、Client/文件/Payload 与 Manager 生命周期仍待接通；角色销毁/卸载时清理 Provider 注册的端到端路径还需 Manager 集成验收。公开角色代码执行仍未开放，B3 不标记完成。

### 当前实施切片：Narrative Context Provider

- Host 将作者 Provider ID 映射为安装级本地 ID，Registry 保存安装目标。Runtime 从实际 Timeline 读取来源 Card，并在 Preview/Run 准备及 Session 工作交接中传入同一归属，不接受业务参数自行指定角色。
- Registry 只调用全局与当前 Card 可用的 Provider；其他 Card 的注册不会触发“无人选择”错误。多个可用来源同时返回投影仍报冲突，不增加优先级或自动覆盖策略；交接只通知选中的可用来源。
- 验证：Host Narrative 合同与 Runtime Narrative 集成共 2 文件 / 9 项通过。覆盖同包 A/B 的独立记忆版本、交接只更新 B、停止 A 不影响 B、无关注册不阻塞 C、全局来源冲突仍明确失败，以及真实 Timeline 的预览与交接只触达所属 Provider。Server 定向类型检查通过。
- 尚未完成：其余平台事件过滤、Client Renderer 与 Client Host、文件/Payload、Manager 公开安装与依赖/版本路径和 Card 内嵌分发。上述单项通过不代表 B3 或整个后台计划完成。

### 当前实施切片：平台文档事件裁剪

- Server 对角色订阅裁剪 `docs.changed`、`docs.rollback.completed` 和 `data.changed` 中的文档操作。依据该操作的提交版本（包含墓碑）读取 package/installation 归属，不以当前文档版本猜测旧事件归属；混合提交只保留本安装的操作与文档摘要。
- 同角色的实体生命周期事件可交付；State 事件继续由 Host 的真实 Timeline 归属检查过滤。自定义事件由 EventBus 安装路由保障。未提供可信范围的平台通知不向角色扩展广播；全局订阅保持原有同步行为。
- 异步投影完成后，Host 仍检查订阅及实例是否活跃，已停止的监听不消费迟到事件。
- 验证：平台事件投影、Server State 重启及取消订阅合同共 3 文件 / 12 项通过；补充真实删除回滚与非文档操作不交付断言后，投影集成再次通过。覆盖同提交 Global/A/B/其他包、提交后发生归属转移、墓碑/恢复版本、跨角色生命周期与无范围通知拒绝。Server 定向类型检查通过。
- 明确限制：角色 `data.changed` 暂只支持归属明确的文档操作；其他 Store 的原始操作与其余平台事件尚未实现目标解析，代码有 ponytail 标记。不能以“不泄露”代替这些能力最终可用性的验收。B3 和公开角色安装仍未完成。

### 当前实施切片：Narrative、Agent、State 提交归属

- 平台事件投影沿领域关系解析 Narrative 的 Timeline/Branch/Node、Agent Session/Transcript 与 State Scope/Revision，再核对 Timeline 的来源 Card。全局 State 与独立 Session 不归入任意角色。
- Narrative Store 的只读查询增加显式 includeDeleted，默认仍隐藏已删除 Timeline/节点/分支；仅用于宿主解析迟到提交与删除事件。State Store 增加 Revision 到 Scope 的元数据查询，避免仅为事件归属重建整份 State snapshot。
- Agent 提交在 DataCommitOperation.scope 中记录当时的所属实体引用，Kernel 摘要保留该引用。Session 解绑前的提交与解绑操作保留原 Timeline 归属；解绑后的新消息不携带旧范围。不以当前可变 Session 绑定推断过去提交，也不额外建立 Session 归属历史表。
- 验证：真实 Runtime/SQLite 事件投影 2 项通过，覆盖创建时的所有相关记录、跨 Card 拒绝、Timeline 删除后原提交与删除通知仍可判定、普通读取仍隐藏墓碑、Session 解绑前后不同归属。Narrative/Agent/State Store 与 Kernel 合同共 4 文件 / 52 项通过。Server 类型检查和 Kernel 构建通过。
- 尚未完成：Prompt Resource/挂载及其他未分类平台事件仍不向角色订阅交付，代码保留 ponytail 标记；Client/文件/Payload、Manager 生命周期和包分发仍待推进。B3 不标记完成。
