# 宏动态值与来源检查

> **Status**：Implemented / 自动化与客观浏览器验收完成，等待用户主观视觉确认
> **日期**：2026-09-09
> **授权范围**：用户授权实施 State 与宏的 UI 和底层改进，包含后续确认的资源静态声明、来源检查和同名选择。保留既有脏工作区。

## 本轮执行合同（覆盖下方旧版门禁和文件分工）

- **2026-09-09 UI 修订（用户确认）**：宏是工作台条目。角色/预设切至宏页签时，直接替换现有外层 `AssetWorkbenchLayout` 的 explorer 为宏名称列表与新增入口，detail 只编辑选中项；禁止在右侧 detail 再嵌完整列表或第二套 Master–Detail。复用外层 mobilePane 点击下钻/返回，切页签回目录。运行宏检查本身是一套 `MasterDetailWorkbench`：左侧名称/状态，右侧单项值/来源/冲突，移动端同样下钻。不改变后端合同。
- Card 增加可选 `macros: Record<string, string>`，走既有 Card 更新、版本 CAS、Bundle 导入导出；创建 Timeline 时把 Card 宏和来源身份固化进 Runtime Context，保持作者修改不暗改既有游玩实例。
- Preset 的同名 `macros` 配置放在已有 PromptResource metadata，经 mapper 投影为资源字段；专用 `application.updatePromptResourceMacros({resourceId,expectedVersion,macros})` 使用既有资源事务，导入、导出、复制携带配置，不建表或 KV 引擎。
- 宏名沿现有 Unicode 点路径语法。原有 `global / timeline / computed` 路径入口与 User/char 等内建别名保持保留，不能被新声明覆盖。非法名称、重复身份、非字符串静态配置必须在写入边界拒绝。
- 配置和代码的贡献按完整公共名分组。唯一候选直接生效；多个候选显示冲突、不静默选胜者。用户通过 `macroSelections: Record<name, sourceId>` 选择一个候选，本轮选择作为 Preview/Invoke 的显式输入，只作用于当前组合，不写回角色或预设；切目标清除选择。不支持隐式拼接。
- 代码入口为 Server Extension `ctx.macros.register({id,name,resolve})`；Host 强制 Package 所有者和 ID 前缀，并把注销 handle 交给既有 scope 清理。回调只接收复制并冻结的 Global/Timeline 数据与当前 Card/Preset 身份，返回 string 或 Promise<string>，不向其传递 Runtime/DB。仍是既有受信 Server Extension，不宣称提供任意脚本隔离。
- Application Runtime 与 Host 共用一份 registry。每次构建收集提供者列表并各执行一次；结果进入现有 computed 快照，公共点名称可精确读取。失败记录来源诊断，不回退旧值；无法解析的宏保留 token 并诊断，与既有缺失值行为一致。
- 新增 `application.inspectMacros({cardId?,presetId?,timelineTarget?,macroSelections?})`，走与 Prompt 相同的快照组装；Timeline 与 Card 不同时指定。独立检查明确为“当前预览”。Preview/Invoke 结果携带本次 `macroInspection`，不能另算一次冒充构建值。
- 纯宏解析和可序列化快照/检查类型移到既有 `@loom-studio/shared`，Runtime 保持旧导出兼容；Client 不导入后端 Runtime。已有名称、标量、别名、State 优先级不变。
- 共享检查合同：`MacroInspection { snapshot, entries, capturedAt }`；每项 `{name, candidates, selectedSourceId?, value?, status:'resolved'|'conflict'|'error'}`；候选 `{sourceId, sourceKind:'card'|'preset'|'provider'|'builtin'|'state', sourceLabel, value?, error?}`。内建别名可列项，State 继续按已有树/路径读取，不给每个叶子创建持久注册记录。
- UI：角色目录底部“设定 / 宏 / State”；预设保留现有页签并增加“宏”，无 Preset State；原运行面板切换 State 与宏检查。静态宏行编辑复用一个组件，State 作者页整理模板与绑定编辑并保留源码入口。用户配置与动态运行结果不混写。
- State 底层保留本轮已有模板保存、导出与版本冲突修复；不新增游戏调度、实体自动补装、Preset State 或 State 条件触发。

### 当前写入所有权

- **底层 Worker**：`packages/application-runtime/src/`、`packages/shared/src/`；`apps/studio-server/src/rpc/handlers/application/{cards,prompt-resources,agents,states}.ts` 及实际对应 Application handler/router 文件；后端定向测试。不得编辑 Extension SDK/Host、Server main、Client 或文档。
- **UI Worker**：`features/state-variables/ui/`、该 feature 的作者/检查 model（不含现有 `macro-renderer.ts`）；`widgets/context-workbench/`、`widgets/preset-workbench/`、`pages/studio/model/studio-layout-store.ts`、两份 i18n、Client 定向 UI/model 测试。不得编辑 app、API/entities、其他业务 hook。
- **主 Agent**：Extension SDK/Host 与 `apps/studio-server/src/main.ts` 的 registry 接线；Client app/API/entities、Card/资源/Narrative hook、`macro-renderer.ts`；计划、架构和集成验收。
- 共享 UI 接口：`useMacroAuthoring` 接收 `{ownerId,ownerLabel,version,macros,onSave({expectedVersion,macros}):Promise<{version,macros}>,t}`，由 `MacroAuthoringExplorer / Detail` 消费；检查组件接收 `{inspection?,loading,error?,readOnly?,selections,onSelectSource(name,sourceId|undefined),onRefresh,t}`。组件不自行调用猜测的 RPC。
- Client 增加既有 `@loom-studio/shared` 工作区依赖与 TypeScript 引用；共享包暴露纯浏览器入口 `./macros`。主 Agent 同步 package/lockfile 与测试 alias，不新增第三方依赖。
- 新 API、配置导出和冲突为真实回归风险，允许最小定向测试；不新增依赖。Scope 扩大或相同失败两轮后停止报告。

## 目标

保留现有宏求值核心和持久化方式，在现有 VariableSnapshot / computed 上补动态值提供入口、来源信息与前后端一致消费。作者代码通过显式接口贡献值，不直接替换正文；检查界面展示实际取值与来源，不分析脚本源码猜测变量。

## 首轮实施基线（历史）

以下“未查到提供者注册接口”和前端未消费 computed 的描述是实施前状态；当前作者宏、动态提供者、冲突选择与构建快照以本文件执行合同、最终结果及 [State 与变量架构](../../architecture/application/state-and-variables.md) 为准，不重复实施首轮缺口。

- [variables.ts](../../../packages/application-runtime/src/prompt/variables.ts) 已提供 `global / timeline / computed / aliases` 快照、统一标量展开、读取路径和缺失 / 非标量诊断；不是从零建立宏系统。
- [readAgentTurnVariables](../../../packages/application-runtime/src/runtime/narrative-runtime.ts) 提供内建 computed，如时间和可选角色名。目前未查到外部宏提供者注册接口，不能把 `computed` 字段本身当作该接口。
- 持久值主要来自 Global / Timeline State；Card `userName` 在 Global `user.name` 缺失时回退。没有独立宏变量 Store。
- [前端 macro-renderer](../../../apps/studio-client/src/features/state-variables/model/macro-renderer.ts) 另行解析 Global / Timeline / Card，未消费后端 computed 和读取记录。
- 现有 Trace 能区分 Global / Timeline / computed，不包含完整的提供者身份、配置出处或注册冲突信息。
- 以上基线来自当前工作树的静态核对；工作树含用户和其他任务的未提交改动，不以 HEAD 或历史讨论覆盖它们。

## 已确认决策

1. 不搬迁 Global State 中的用户名和其他既有值，不新建“宏变量数据库”、通用 KV Store 或独立宏资源体系。
2. 保留现有宏语法、标量行为、别名和路径解析规则；本计划不顺带重定同名 Global / Timeline 的优先级。
3. 动态文本沿既有 computed 进入本次构建结果，不回写 State，不复制一份持久化派生值。
4. 提供者显式声明名字与来源，由系统收集结果；宏展开不直接执行任意内联脚本、不修改 State、不递归解释输出。
5. 来源检查复用现有读取记录。静态值可通过已有来源入口编辑；动态结果只查看并定位提供者，不能伪装成可直接保存的静态 KV。
6. 前端和 Prompt 必须使用相同取值语义。已构建结果应关联该次快照；单独重新求值的预览必须说明它不是上一轮实际结果。

## 非目标

- 静态值迁移：已有 Global State 和 Card 用户名配置不迁移；新增角色 / 预设宏配置按上方执行合同实施。
- Preset State、State 模板装配、Agent Pin、Timeline 文件、记忆系统。
- State 自动触发 Activation、响应式依赖图、持续监听、跨构建缓存或自动重试。
- EJS、任意 JS 文件导入、Sandbox、CodeAct、新脚本宿主或绕过权限的 Extension 执行。
- 历史 Narrative 文本冻结方式、已保存正文迁移、宏对象默认序列化或结构化 Prompt 注入。
- 顺手修复整套 PromptBuild / Loom Core 架构文档漂移。

## 首版门禁记录（已由上方执行合同收口）

主 Agent 在派发实现前根据当前 API 确定以下事项，并写回本节；Worker 不得自行决定：

- **实际调用者**：首个动态提供者通过哪条现有受支持的 Runtime / Extension 通道接入。只有内部 helper 或测试注入不算完成作者代码接入；若需要新增 Extension SDK / Host 公共能力，先确认权限与文件边界，不把新脚本宿主混入本任务。
- **贡献合同**：公共名字、提供者身份、可读取的冻结上下文、同步或异步返回约束，以及加载 / 释放时机。读取应限制在本次允许的上下文，不暴露整个 ApplicationRuntimeContext。
- **冲突与失败**：提供者之间、提供者与内建 computed / alias 的冲突如何诊断；缺失、异常、非法返回如何呈现。不得静默覆盖、回退到旧结果或无限重试；不得顺带改变已有 State 路径优先级。
- **快照交付**：怎样将本次 computed 与来源交给 Client，以及如何区分构建结果和独立预览。优先复用现有响应；新增 RPC 仅在没有合适消费通道时采用，参数和权限需明确。

本 Plan 不把上述未定接口伪装成已批准 Schema。静态值迁移不属于任何门禁选项。

## 工作包

### A. Runtime 动态值与来源合同

- **职责**：在现有 VariableSnapshot / computed 周边接入已确认的代码提供者，保留既有展开与诊断，补提供者来源信息。每次构建对同一提供者求值一次，同名多处引用读取同一结果。
- **文件范围**：`packages/application-runtime/src/prompt/variables.ts`、相邻新增的提供者模块、`runtime/narrative-runtime.ts`、`runtime/agents-runtime.ts`、`agents/agent-turn.ts`、`types.ts`、`index.ts`。
- **门禁后的追加范围**：具体 RPC handler 或 Extension SDK / Host 文件必须在接口收口时逐项列出，未列出前不能修改。
- **验收**：至少一个受支持代码调用者通过正式入口提供动态字句，Prompt 实际消费它；重复引用一致，来源可定位，失败可解释，不写回 State。

### B. 前后端消费一致性

- **职责**：使 Client 消费同一数据合同和求值语义，不再独立猜测后端 computed；保留现有 Card / User 回退行为。不要通过展示时重新调用提供者来冒充实际构建结果。
- **文件范围**：`apps/studio-client/src/features/state-variables/model/macro-renderer.ts`、`app/use-studio-state.ts`、`shared/api/studio-api.ts`；A 中的 Runtime types / response 由 A 所有，B 不并行改写。
- **复用约束**：若前后端都需要本地解析，先检查既有共享导出；需要提取纯解析逻辑时，由主 Agent 明确共享文件及导出范围，不新增 package，不让 Browser 引入整个后端 Runtime。
- **验收**：相同输入快照下，Client 与 Prompt 对内建别名、State 路径、自定义动态值、缺失值和非标量值表现一致；异步切换 Card / Timeline 后不写回旧目标结果。

### C. 宏结果与来源检查

- **职责**：在现有变量检查入口区分 State 原值与宏解析结果，展示名字、当前结果、来源和诊断；明确运行结果 / 独立预览的区别。
- **文件范围**：`apps/studio-client/src/features/state-variables/ui/`、检查视图所需的新增 model 文件、`shared/i18n/en-us.ts`、`zh-cn.ts`。`app/app.tsx` 的组合由主 Agent 负责。
- **约束**：不混入角色模板编辑、Workspace Definition CRUD 或尚未实现的作者宏表单；不解析代码内部字符串，不把动态结果直接保存为 State。已有工作台底部纯文字页签约定保持不变。
- **验收**：用户能定位一次取值来自 Global / Timeline / 内建计算 / 代码提供者，能分辨“未提供”与“计算失败”；动态值不可被当作静态配置提交。

### D. 主 Agent 集成

- 先完成接口门禁，执行顺序 A → B → C；只有实际写集互不重叠且合同已固定时才并行。
- 保留前序 State / UI 的所有未提交改动，不重新实现已完成部分。跨包导出、RPC 和必要架构文档由主 Agent 最终核对。
- 实施完成后更新本 Plan 的结果与正式文档；开放问题只在明确解决后移除。

## 验证预算

- A 优先复用 `tests/unit/application-runtime/variables.test.ts`；允许新增一个紧邻的提供者定向测试文件，覆盖真实调用入口、重复读取一致性、失败和冲突的已确认合同。
- B 复用 `tests/unit/client/macro-renderer.test.ts`；测试应让同一组输入经过实际 Client / Prompt 消费路径，不能各自断言一套不相交的样例。
- C 只对真实异步切换或编辑行为增加最小验证；静态 SSR 不作为异步正确性的证明。改公共 props / 类型后运行 Client 定向 `tsc --noEmit`。
- 新增 RPC 时才补覆盖该 handler 的定向验证；新增共享导出时才补相关 package 的类型 / 构建检查，不默认运行全仓检查。
- 提供者读取的值不得无选择地写入日志、Trace Audit 或导出包；Client 只在现有授权上下文内检查值。
- 主 Agent 不重跑 Worker 已提供充分证据的相同测试。UI 视觉验收由用户完成，未验收不得宣称完成。

## 停止条件

未通过接口门禁、需要数据迁移、新依赖、新执行宿主、权限扩大或改动既有宏解析语义时停止上报。相同失败最多修复两轮，不扩大为全仓重构。不得以“提供者接口存在”替代真实消费闭环，也不得把所有剩余工作包装成 UI 已完成。

## 关联与结果

- 当前事实：[数据能力与生命周期](../../architecture/application/data-capabilities-and-lifecycle.md)、[State 与变量](../../architecture/application/state-and-variables.md)。
- 讨论边界：[数据能力与运行内容](../discussion/application/data-capabilities-and-runtime-content.md)。
- [State 作者与运行态 UI Plan](ui/state-authoring-runtime-separation-plan.md) 的有效范围已被本轮承接；旧 Preset State、Workspace 作者管理与对称配置要求不恢复。
- **实际结果**：Card / Preset 静态配置、CAS 与可移植数据、Timeline Card 快照、Host 注册/注销、统一解析器、冲突选择、当前预览与实际构建检查已接通。角色/预设作者宏直接使用外层目录与单项详情，运行检查使用独立 Master–Detail；均复用现有移动端下钻。State 模板/Binding 与源码编辑保留版本基线、草稿校验和运行态分离。
- **自动化验证**：后端 variables / narrative-timeline / workspace-artifact 三组 30 项通过；macro-provider 集成与 Client macro-renderer 共 12 项通过，覆盖真实 Preview / Invoke、Timeline 快照、一次求值、冲突与安全键名；Extension Host 注册生命周期 4 项通过；Client State 编辑/面板 8 项通过。相关 SDK/Host、shared/runtime/server 和 Client 类型检查通过；Client Vite build 通过，仅余大 chunk 提示。
- **集成修正**：冲突/错误通过 `snapshot.macroDiagnostics` 阻断同名 State 回退；公共名使用 flat own-property 写入，大小写统一分组；浏览器通过纯 `shared/macros` 子入口加载。保存直接采用成功回执，不因后续列表刷新失败丢失已保存版本。
- **文档验证**：`pnpm run check:docs` 通过。全工作区 `git diff --check` 被其他任务的 file-tree SCSS、transform-rule 讨论、sessions-panel 测试空白问题阻塞，未改动这些文件。
- **真实交互验收**：在隔离数据目录 `.loomstudio-dev/macro-ui-test` 启动 Server `http://127.0.0.1:4174` 与 Client `http://127.0.0.1:5175`，未触碰用户现有 `4173/5173`。测试 Card 现包含“角色身份”和“生命状态”两个组件定义；两个精确挂载创建 `archive_keeper`、`night_conductor` 实体，`entities.characters.*.components.vitals` 再为已有角色批量挂载生命状态。新建 Timeline 的 Snapshot 已确认两个角色均拥有 `identity` 与 `vitals` 组件，`hp = 100`。
- **浏览器客观诊断**：桌面端完成作者宏新增、改名、多行值保存与版本推进；输入框计算样式为 `surface-subtle` 对应的 `rgb(60, 61, 80)`、`border: 0`、`4px` 圆角，聚焦为 `1px` accent outline。移动端 `390×844` 下，角色宏、State 作者配置与宏检查均完成列表→详情→返回下钻；宏检查和 State 面板 `scrollWidth === clientWidth`，未发现横向溢出。测试后已恢复默认 `1280×720` 视口。
- **2026-09-09 UI 回修**：按现有字段规范改为“短文本透明背景 + 底部 1px 细线，长文本 `surface-subtle` 色块”；角色宏作者页和宏检查详情增加复制 `{{macro.name}}` 的图标入口。修正运行态变量面板错误的三行 Grid，使 Master–Detail 占满标题栏以下剩余高度；浏览器测得面板高 `654px`、工作台高 `597px`、底部间隙 `0px`。
- **Example Echo 实例**：正式 Server Extension 入口注册 `example.echo.greeting` 与 `example.echo.timeline_state`。后者读取 `entities.characters.archive_keeper.components.vitals.hp`；无对应 State 时返回 `Archive Keeper HP: unavailable`，在上述 Timeline 中返回 `Archive Keeper HP: 100`。通过 `extensions.reloadModule` 重载运行实例后，宏检查确认新实现生效。
- **未验证与剩余风险**：未运行全仓测试；用户仍需确认桌面与移动端的主观观感、间距和手感。未建设 Preset State、Pin、记忆、VFS、脚本沙箱或自动 State 触发。
