# 变量作者配置与运行态分离

> **Status**：Paused / 有效范围已转交宏动态值与来源检查计划，等待统一验收
> **日期**：2026-09-09
> **授权**：用户确认资源工作台负责配置、变量面板负责运行态，并授权写 Plan、委派实施。

> **执行结果**：[宏动态值与来源检查](../macro-value-provider-and-inspector-plan.md) 已承接 Card State 作者/运行态分离、宏配置与来源检查，并记录最终验证与人工验收边界。以下暂停描述保留为历史修订背景，不再作为当前执行门禁；不恢复预设 State 或 Workspace 作者 CRUD。

## 目标与决策

### 当前 UI 修订

用户批准手动优化后，作者配置与运行检查收拢到变量 Panel，以底部“初始化配置”页签进入；资源工作台移除 State 页签及单 Card 重复目录。State 入口要求已打开 Timeline，角色页仅允许定位当前 Timeline 对应角色，不提供任意其他 Timeline 浏览。

本轮初始化页明确标为“角色卡源配置”，保存写回 Card，而非修改当前 Timeline 快照。精确挂载采用现有 FileTree 展示实际路径层级，通配挂载独立列出，保留组件定义与完整源码入口。不将 `entities.characters` 路径约定冒充实体类型声明。

完成范围仅为入口收拢、路径树与保存目标标识；初始化装配预览、插件贡献来源整合、实体类型合同尚未实施。既有 Global State 数据能力保留，本轮不迁移或删除。浏览器验收由用户负责，不执行浏览器操作。

验证：Client `tsc --noEmit` 通过；State 编辑模型与面板两个定向测试文件共 8 项通过。SSR 检查不覆盖真实导航、展开与移动端交互，这些仍需人工验收。

后续 UI 回修：挂载路径树从左侧编辑导航移到详情底部，上方保留编辑字段；组件定义详情列出其挂载位置并可添加引用当前组件的挂载。新增挂载不再自动生成 Character 路径，空目标由既有保存解析器拒绝。通配规则标为“初始化批量挂载”，底部仅为路径预览，未实现通配展开后的数据模拟。本次 Client 类型检查通过，未执行浏览器验收。

角色列表仍是启动入口。角色资源工作台的页签放在目录底部，复用预设的纯文字 `loom-page-tabs`，不使用顶部图标按钮。角色界面只编辑角色自身贡献，不混入 Workspace 共享 Definition 管理。变量面板负责 Global / 当前 Timeline、Branch 的运行值查看与修改。宏作者入口仍待合同明确，不再要求预设对称提供 State 页面。

用户在后续场景讨论中撤回了为预设建立 State 的默认前提，并要求先研究架构。当前计划暂停，不继续派发实施；已有代码保留，不自动回退。后续依据 [数据能力与运行内容](../../discussion/application/data-capabilities-and-runtime-content.md) 修订范围，不添加空页签、不实现脚本宿主或 Extension 自动挂载、不擅自修改历史文本语义。

## 2026-09-09 修订与当前执行边界

- 已完成的入口修正：角色页签移到目录底部；角色变量页移除“当前 Card / Workspace”选择；保留 Card 模板、初始值、绑定编辑和版本冲突保护。
- Workspace Definition 是共享作者数据，不等于全局运行作用域；不得把它伪装成角色自动装配结果。Global 运行面板不能跳到一张任意 Card 作为其来源。
- 新查证事实：`createTimelineFromCard` 只接收 Card，不接收 Agent/Preset；Preset 在 `agents-runtime.ts` 通过 AgentProfile 读取。Preset 是 PromptResource，现有独立 artifact 不导出 metadata，不能只把新字段写进 metadata 就声称可移植。
- 已撤回的前提：不再将“预设是否随 Timeline 创建固定，还是切换时补装 State”作为待决阻塞。没有已确认的模拟需求，不建设预设 State。
- 宏作者数据要区别于 State 字符串值；需明确资源归属、同名解析顺序和 Card 周期快照后，闭合存储、导出、Prompt 与前端消费。不能恢复旧 Global 字符串 CRUD 来假装补齐作者宏。
- 原工作包 A/C 中的 Workspace 作者 UI 和顶部视图栏要求已被覆盖。以下工作包保留为首轮实施记录，不是恢复实施的授权。

## 首轮调研基线

- `features/state-variables/ui/state-variables-panel.tsx` 混合运行值、Global 字符串和共享 Definition CRUD；Card 配置回调有传入但没有完整消费入口。
- `runtime/cards-runtime.ts` 支持 Card 内联 `stateTemplates`、共享 `stateDefinitionIds` 与 `timelineStateBindings`；`runtime/narrative-runtime.ts` 支持内联优先及创建时通配装配。
- `cards/workspace.ts` 导出只收集共享 Definition，未收集内联模板。
- State Mutation 已支持 Revision CAS、事务和幂等，不应另造写入服务。
- 工作区存在大量未提交修改，所有 Worker 必须在当前工作树增量修改，不回退或覆盖无关工作。

## 首轮设计记录（已被上述修订覆盖）

1. 资源工作台受控切换“设定 / 变量”。变量作者界面以当前 Card 为目标，提供模板 / Binding 配置编辑与共享 Definition 管理入口。没有 Card 时仍可管理 Workspace 共享 Definition，不能保存 Card 配置。
2. Card 编辑沿用现有 YAML parser 和 API；保存包含明确 `cardId` 与加载时的 `expectedVersion`，异步切换 Card 不得把草稿写入另一个 Card，版本冲突保留草稿并明确报错。可复用已有模板引用；修改 Card 内联模板不能暗中改共享 Definition。
3. 运行态界面保留 State 树和批量修改、宏复制；移除“文本宏变量”伪分类与 Definition CRUD。不得取消现有字符串值的编辑能力。来源入口按当前 scope 分别打开来源 Card 或 Workspace Definition；Card 入口明确是来源配置，不声称修改它会更新旧 Timeline。
4. UI 请求和业务编排放在 `features/state-variables/model`；Widget 仅组合。新增文案进中英字典；使用现有 CSS tokens、Lucide 与布局原语。
5. 后端按现有 Timeline 的内联优先规则收集 Card 模板用于导出。卡保存时验证引用、模板身份与版本、初始值/Binding；失败不保存无效配置。保持当前 Bundle V4，不保留测试期 V2/V3 兼容路径，不新增依赖。

## 首轮工作包与文件边界（已暂停）

### A：变量界面（Luna）

- 写入：`apps/studio-client/src/features/state-variables/`；`shared/i18n/en-us.ts`、`zh-cn.ts`；`tests/unit/client/state-variables-panel.test.ts`、`state-variable-editor.test.ts`；允许新增紧邻的作者面板定向测试。
- 新建 `StateAuthoringPanel`：props 为 `api: StudioApi['states']`、`card?: Card`、`t: Translator`、`onSaveCard(input: { cardId: string; expectedVersion: number; stateTemplates?: Card['stateTemplates']; stateDefinitionIds: string[]; timelineStateBindings: NonNullable<Card['timelineStateBindings']> }): Promise<Card>`。成功返回的 Card 用于更新草稿基线版本；其他位置刷新版本不能给旧草稿自动赋新版本。
- 修改 `StateVariablesPanel`：props 保留 `api`、`timelineTarget`、`refreshToken`、`onStateMutated`，新增 `t`、`onOpenSource?(scope: 'global' | 'timeline'): void`；移除 `card`、`onUpdateCardConfig`、`initialMainTab`。范围变动请求过期结果不得写回另一个目标。
- 验收：运行态没有定义创建；作者可以读取/保存 Card 模板及绑定，保留共享 Definition CRUD；失败不显示成功，切目标不复用旧草稿。
- 验证：仅运行 `pnpm exec vitest run tests/unit/client/state-variables-panel.test.ts tests/unit/client/state-variable-editor.test.ts` 及本包新增的定向测试。允许为目标切换/保存语义新增最小测试，不加测试框架。

### B：Card 模板保存与导出（Luna）

- 写入：`packages/application-runtime/src/runtime/cards-runtime.ts`、`cards/workspace.ts`、`types.ts`、`apps/studio-server/src/rpc/handlers/application/cards.ts`；若确有共享逻辑需要可在 `state/state-definition.ts` 增加小 helper；`tests/integration/application-runtime/workspace-artifact.test.ts`、`narrative-timeline.test.ts`。
- 不修改 Client、SDK、SQL Schema 或 Macro。
- `UpdateCardInput` 增加可选 `expectedVersion`，新作者入口必填；原有调用者保持现有行为。由 Document Store 的版本检查拒绝过期编辑，不进行自动覆盖/重试。
- 验收：Card 内联模板可保存、初始化、导出与重新导入；共享引用继续可用；重名内联优先与现有运行语义一致；无效模板/Binding 保存明确失败；旧 Timeline 不被更新。
- 验证：上述两个集成测试文件；允许在其中新增覆盖内联导出与非法配置的回归测试。

### C：集成（主 Agent）

- 写入：`app/app.tsx`、`app/use-studio-state.ts`、`features/cards/model/use-cards.ts`、`shared/api/studio-api.ts`、`widgets/context-workbench/context-workbench.tsx` 及其 SCSS，必要的资源视图参数与当前 Plan / 索引。
- 接入作者面板、受控视图和来源跳转。目标 Card 必须取 Timeline 来源，而非随意使用当前选中的另一张 Card；缺失来源不提供误导入口。
- Card 保存由 `useCards` 所有，facade 只转发；传明确 cardId，传播失败，由作者面板显示错误及 pending。保留编辑历史，保存返回值更新同一 Card 的详情，不能仅刷新列表后继续展示旧模板。
- 只做一次 Client 定向类型检查覆盖集成 props，Worker 测试不机械重跑。
- 同步 `docs/architecture/application/state-and-variables.md` 中的 Card 内联模板优先与导出事实，不将未实施的脚本/插件提案写成正式合同。

## 验证预算与停止条件

- 代码检查与定向测试不是人工视觉验收。默认不启动浏览器；最终告知用户人工检查设定/变量切换、来源跳转、窄面板及保存交互。
- 修改文档后使用 `pnpm check:docs` 检查索引、链接与生命周期。
- Worker 同一失败最多两轮；需要新增依赖、Schema 迁移、改动未决宏规则、执行导入 JS、扩展权限时立即停止报告主 Agent。
- 若既有失败阻塞检查，记录具体命令与范围，不宣称通过。

## 开放问题与后续范围

- 参与模拟的 Extension State typed capability、贡献启用规则；不预设 Preset State 需求。
- 宏同名覆盖、统一前后端求值、历史文本是否冻结、受控 JS 生命周期。
- 运行文本与分支历史如何关联；以上由架构讨论收口，不能由 Worker 自行补全。

## State 完成后的作者工程入口

> **Status**：已确认方向，未实施。本节只约束后续 Dev Workspace 接入边界，不冻结目录、后缀或源文件 Schema。

State 不建立平行的文件运行时。它应接入 [`ADR-001`](../../adr/ADR-001-data-layer-workspace-sync.md) 已定义的 Dev Workspace 链路：

```text
State authoring files
  -> Workspace Adapter / CLI parse + validate
  -> SQL last valid snapshot
  -> existing Card State contracts
  -> Timeline materialization and State Revision
```

作者源文件至少区分两种语义：

| 作者语义 | 编译目标 | 边界 |
| --- | --- | --- |
| State Template Source | `stateTemplates[]` 或共享 `airp.stateDefinition` | 保存 Schema、版本与模板默认值 |
| State Seed Source | `timelineStateBindings[]` | 保存实体路径、模板引用与实例初始覆盖 |

创建 Timeline 时仍由现有物化器执行 `template.initial + binding.initial`，生成完整 Snapshot 并写入 `state_revisions`。Timeline 运行值与后续 Mutation 不得回写作者初始化文件。

小型单角色项目可在 Studio 中以组合视图展示；多角色、大世界项目可在作者工作区按模板与实体拆分文件。两者必须编译回同一套现有 State 合同，不新增 State Store、Entity Store 或 Runtime 直读作者目录的分支。

Studio 中的作者面板主要服务于查看、审阅、定位诊断、少量局部修改和内置 Agent 操作，不以在表单中手写几十个 NPC 为主要优化目标。Dev Workspace 开启时，UI 与内置 Agent 应经 Workspace Adapter 修改作者源；关闭时仍直接编辑 SQL canonical state。

## 最终结果

当前为部分完成并暂停，不能作为宏作者能力完整闭环验收：

- 2026-09-09 后续 UI 收口：State 作者面板改为真正的 Master–Detail，以“组件定义 / 组件挂载 / 完整源码”表达现有 Template / Binding 合同；组件挂载再明确区分精确挂载与通配挂载，同一时间只展示一个详情。窄宽度使用列表→详情→返回的下钻。宏检查增加按解析状态分组与名称 / 值 / 来源搜索。
- 本轮定向验证：Client TypeScript 检查通过，State 两个定向测试文件 8 项通过，文档链接与生命周期检查通过。在 `390×844` 客观浏览器诊断中，宏检查与 State 作者面板均只显示当前 master 或 detail，无横向溢出；主观视觉验收仍由用户完成。
- 角色资源页签已移入 `AssetWorkbenchLayout.footer`，复用预设的目录底部纯文字样式；变量编辑器只面向当前 Card，移除 Workspace CRUD 与其孤儿代码。Global 运行值不再误跳角色配置。
- Card 内联模板保存、共享模板合并导出、版本冲突检查已接入；作者草稿不跟随同 Card 的后台版本更新重置，保存成功才更新基线。已有 Timeline 不受 Card 模板修改影响。
- 教程样本采用 `entities.characters.<id>.components.<component>` 作者约定：精确挂载先创建 `archive_keeper` 与 `night_conductor`，`entities.characters.*.components.vitals` 再为已有实体批量补充生命状态。真实 Snapshot 与 Example Echo 宏均已验证；该路径是推荐约定，不是底层硬编码的 Character 类型，也不代表完整 ECS 查询系统。
- 后端首轮两个定向集成文件 23 用例通过；追加过期 Card 保存用例后 `narrative-timeline.test.ts` 10 用例通过。UI 修订后两个定向单测文件 7 用例通过；主 Agent 的 Client `tsc --noEmit` 通过。
- 上述 UI 单测不覆盖真实异步交互；未运行浏览器诊断或人工视觉验收。预览服务 `http://127.0.0.1:5174/` HTTP 200。
- 文档检查有既有阻塞：根 README 两处 LICENSE 链接缺失；既有 extension-dev-hot-reload issue 与 st-data-compatibility plan 索引不可达。本轮未修改这些无关文件。
- 未完成：作者宏数据与消费、运行内容的生命周期合同。预设 State 装配和对称页签已从默认需求中撤回，不再列为欠缺功能。
