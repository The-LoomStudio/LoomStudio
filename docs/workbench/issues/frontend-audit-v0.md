# Studio Client 全面审计台账 v0

> **状态**：Active Audit Ledger
> **最后核对**：2026-08-12
> **审查基线**：`ea7b4c6 Refine frontend panel and sidebar interactions`
> **当前分支**：`codex/frontend-next`
> **适用范围**：`apps/studio-client/src`
> **修改策略**：完成全部审计轮次后统一制定整改批次；审计期间只记录，不修改生产代码

本文收束 Studio Client 的去冗余、代码异位、状态所有权、无效抽象、上帝代码、UI 行为与 CSS/SCSS Modules 审计结果。后续轮次继续追加在本文件中，避免相同问题散落到多份 Issue。

审计只覆盖前端内部已经能够独立判断的逻辑、状态、组件生命周期、布局和 UI。现有 typed API 与 Client Bridge 只作为不可修改的输入边界；不审查或改变后端实现、RPC 方法、Schema、Document Store 与持久化契约。

当前后端数据层、Session、Card Resources、Prompt/Projection 数据关系仍可能大幅调整。依赖这些领域模型最终形态才能判断的问题，不进入当前整改范围；已发现的静态链路只保留为延期复核材料，不能用于推动当前前端重构。

## 审计原则

- 工具输出只作为候选，必须通过正向调用链和反向引用核验后才能立项。
- 300～400 行是人工复核阈值，不是强制拆分规则；字典、声明式映射、内聚编辑器与样式表可以合理超过阈值。
- 只有拆分能够减少职责、状态、分支或生命周期耦合时，才记录为上帝代码问题。
- 删除优先于新增抽象；不为消除少量重复创建 Base Hook、Factory 或新的状态框架。
- 每条正式发现必须说明证据、影响、最小整改方向、关闭条件与验证边界。
- 自动化验证、客观浏览器诊断和人工视觉验收分开记录。

## 审计轮次

| 轮次 | 范围 | 状态 | 结论 |
| --- | --- | --- | --- |
| 0 | 文件、入口、模块依赖和规模基线 | Completed | 101 个非测试 TS/TSX 生产模块全部可从 `main.tsx` 到达；未发现孤儿生产模块或 Client 分层大面积反向依赖 |
| 1 | 死代码、未消费字段、Facade 表面积与 CSS 可达性 | Completed | 记录 6 组确定问题、3 组待决策候选；未发现完全未导入的 CSS Module 或可确认未消费的本地 class |
| 2 | 代码异位与状态数据流 | Completed | 当前保留 7 组纯前端确定问题、1 组待决策候选；8 组依赖 Session、Card Resources 或数据层形态的结论已延期复核 |
| 3 | 上帝组件、无效抽象与重复逻辑 | Completed | 新增 10 组纯前端确定问题与 1 组产品决策候选；确认 Character Panel 与 Studio Page 是职责型上帝组件，同时排除 CodeMirror、Context Menu、Dialog 与 FileTree 主体的机械拆分 |
| 4 | CSS 结构、级联、布局和响应式 | Completed | 最终保留 6 组确定问题与 2 组运行态候选；第六轮反向核验否定了原条目 34 的焦点环结论 |
| 5 | UI 行为、资源生命周期与可访问性 | Completed | 新增 3 组确定问题与 4 组待决策/运行态候选，并为 GroupSheet、Log Anchor、Log Refresh、Profile/Provider Timer 补齐交互与生命周期证据 |
| 6 | 综合复核与整改排序 | Completed | 校准误报与延期边界，将当前整改集合收束为 7 个主批次；3 项实施前置决策已完成，另有 5 项运行态/读屏证据门槛 |

第六轮校准后，仍参与整改排序的第二轮条目为 12、14、15、19、20。条目 8、9、10、11、13、16、17、18 与候选 C 已延期，条目 21 经反向验证后保留现有语义；第一轮条目 2、3 同样不在当前整改范围。`Deferred`、`Rejected` 与 `Decision` 状态优先于文档中的 P2/P3 物理分组。

## 第一轮基线

当前 Client 约 1.8 万行，包含 87 个 `.ts`、39 个 `.tsx`、32 个 `.scss` 与 1 个全局 `.css` 文件。首批规模热点如下，但本轮不因行数直接立项：

| 文件 | 行数 | 后续审查重点 |
| --- | ---: | --- |
| `widgets/character-panel/character-panel.module.scss` | 797 | Gallery、Profile、表单、响应式和媒体样式是否混合多个组件职责 |
| `widgets/character-panel/character-panel.tsx` | 649 | Gallery/Profile、分组、选择、媒体 URL、分页 Observer 与 DEV Fixture |
| `pages/studio/studio-page.module.scss` | 590 | Shell、Dock、Workspace、Resize 和多窗口模式样式边界 |
| `pages/studio/studio-page.tsx` | 544 | Shell 状态、快捷键、Panel、Resize 与 Asset 视图编排 |
| `widgets/log-viewer/log-viewer.module.scss` | 453 | Viewer 布局、时间线、状态和响应式规则 |
| `shared/ui/long-text-editor/code-mirror-editor.tsx` | 397 | 编辑器初始化、扩展装配和 React 生命周期 |

模块依赖基线：

```text
main
└─ app
   ├─ pages
   ├─ widgets
   │  ├─ features
   │  ├─ entities
   │  └─ shared
   ├─ features
   │  ├─ entities
   │  └─ shared
   └─ shared
```

已确认：

- `shared` 未 import `features`、`widgets`、`pages` 或 `app`；
- `features` 未依赖 `widgets`、`pages` 或 `app`；
- `pages` 未依赖具体 Widget，Widget 由 `app/app.tsx` 统一组装；
- 未发现 Widget 裸调用 `bridge.call()`；
- 29 个 CSS Modules 均存在生产代码 import；
- 排除动态 class、`:global`、Lezer 与 CodeMirror 生成的 DOM 后，未发现可确认未消费的本地 class。

## 延期复核：依赖 Session、Card Resources 或数据层最终形态

本节不属于当前整改范围，也不参与优先级排序。只有后端领域模型、Schema 与数据层关系稳定后，才能重新验证这些链路是否仍然成立。

### 8. Session 命令成功与后续只读刷新失败被合并成同一失败语义

- **状态**：Deferred / Out of current scope
- **位置**：`apps/studio-client/src/features/session-runtime/model/use-session-runtime.ts:54-153`、`apps/studio-client/src/shared/hooks/use-async-operations.ts:15-43`
- **相关操作**：`createSessionFromCard`、`submitTurn`、`forkFromEntry`、`switchBranch`
- **完整链路**：以 `submitTurn` 为例，`turns.submit` 已成功 → Client 更新 Branch、删除草稿、清空 Composer 和 Preview → 顺序执行 Timeline、Transcript、Session、Run 刷新 → 任一只读刷新失败 → `runAction` 记录统一的 Session Error，界面对外表现为整次提交失败。
- **实际影响**：服务端已经提交的 Turn 会被前端误报为失败，用户重试可能产生重复输入；部分新状态与部分旧状态还可能组合成不一致视图。`createSessionFromCard` 与 `forkFromEntry` 只有在全部刷新成功后才写入返回给导航的 ID，因此服务端创建成功时，Client 仍可能不导航并显示失败。
- **边界说明**：不需要修改 API。问题在 Client 将“命令是否成功”和“成功后视图是否完整同步”合并成一个不可区分的结果。
- **最小整改方向**：优先应用命令返回的权威实体并完成成功返回；附属刷新作为可独立恢复的同步过程，失败时报告“视图同步失败/可重试”，不能把已成功命令伪装成未执行。
- **关闭条件**：命令成功、任一后续刷新失败时，成功事实和导航 ID 仍被保留；用户不会收到可诱导重复提交的命令失败反馈；刷新存在明确重试入口或恢复路径。
- **验证建议**：对 Submit/Create/Fork 分别构造“命令成功＋某一刷新失败”的定向测试。

### 9. 切换 Card 时旧 Card 的 Context Assets 会继续显示并可编辑

- **状态**：Deferred / Out of current scope
- **位置**：`apps/studio-client/src/app/use-studio-state.ts:47,55-65,84-87,108-118`、`apps/studio-client/src/app/app.tsx:27-31,74-84`
- **完整链路**：`selectedCardId` 切换到 Card B → Resources Effect 启动 `listForCard(B)` → `runLatest` 只阻止旧响应最终写入，不清空当前 Resources → App 已用 B 生成新的 `assetWorkspaceId` → Context/Preset Workbench 在 B 的布局命名空间下继续渲染 Card A 的 Nodes → B 请求返回后才整体替换。
- **可编辑性证据**：`resources` Pending 没有传入两个 Workbench；全局 `mutationBusy` 也不包含资源读取，因此等待窗口内树操作和 Detail 编辑仍可触发。
- **实际影响**：慢请求期间，用户会把 A 的资源误认为 B 的资源，并可能对 A 发起 Mutation；同时 B 的本地选择和展开状态会与 A 的内容临时混合。
- **正确归属**：资源状态必须携带明确的 Card 所有权，不能只保存一份无身份的 `promptResources/nodes`。
- **最小整改方向**：切换 Card 时立即进入显式 Loading/Empty 并禁用编辑；或按 Card 缓存资源，但渲染时只读取与当前 `selectedCardId` 匹配的数据。
- **关闭条件**：B 请求 Pending 时不把 A 的 Nodes 作为 B 的可编辑内容；A 的迟到响应也不能覆盖 B。
- **验证建议**：使用可控 Promise 覆盖 A→B 快速切换、B Pending、A 迟到返回与编辑入口禁用。

### 10. 不同 Session 身份转换没有共享统一的时序防护

- **状态**：Deferred / Out of current scope
- **位置**：`apps/studio-client/src/features/session-runtime/model/use-session-runtime.ts:54-190`、`apps/studio-client/src/app/app.tsx:60-72,108-125`
- **证据**：只有 `activateSession` 使用 `runLatestAction`；Create、Submit、Fork、Switch 使用普通 `runAction`。`runLatest('session')` 的 Epoch 只与其他 `runLatest` 比较，普通 Session 操作不会让它失效，但所有操作都会写同一组 `session/branch/branches/timeline/transcript/runDetails`。
- **可能链路**：旧 Session 的 Switch 或 Submit 正在刷新 → 路由激活新 Session 并先写入状态 → 旧操作的 Timeline/Session 响应稍后返回 → 没有 Session/Branch 身份或 Epoch 校验 → 旧 Session 再次覆盖当前视图。反方向同样可能发生。
- **实际影响**：URL、当前 Session、Branch、Timeline 与 Transcript 可能互相不一致；若用户随后继续操作，前端可能基于错误身份发起请求。
- **边界说明**：`App` 的 `sessionRouteRequestRef` 只保护导航回调，不保护 Session Runtime 内部状态写入。
- **最小整改方向**：所有会切换 Session/Branch 身份的流程共享一个 Runtime Transition Epoch；成组提交状态前检查目标身份仍为 Current。同一 Session 内的补充刷新也应校验目标 `sessionId/branchId`。
- **关闭条件**：Activate 与 Switch/Fork/Submit 交叉完成时，最终状态始终属于最后一次用户意图。
- **验证建议**：可控 Promise 交叉完成测试；浏览器只需客观验证快速路由切换与旧操作返回后的身份一致性。

## P2：明确的职责或功能边界问题

### 1. `LogViewer` 在 Widget 内拥有完整的日志数据流程

- **状态**：Implemented in Batch 3 / Automated verification passed
- **位置**：`apps/studio-client/src/widgets/log-viewer/log-viewer.tsx:13-118`
- **相关符号**：`LogViewer`、`listLogs`、`refresh`、`poll`
- **证据**：Widget 直接接收 `StudioApi['logs']`；在组件内部选择 Server/Client 数据源，管理游标、读取分页、刷新、加载、错误、两秒轮询、页面可见性监听和增量合并。`app/app.tsx` 只把 API 传入 Widget，没有对应的日志 Feature Hook。
- **边界冲突**：Guide 规定 Widget 只负责页面级组合、布局和局部交互，不拥有 RPC 编排、跨领域 Server State 或复杂领域流程。日志筛选、滚动、展开和渲染属于 Widget；远端读取、轮询和错误状态不属于。
- **实际影响**：日志数据生命周期与 UI 渲染耦合，后续更换刷新策略、增加订阅或复用日志状态时只能继续扩大 Widget；其 332 行 TSX 与 453 行 SCSS 也因此难以独立收敛。
- **最小整改方向**：将数据源选择、刷新、游标、轮询、records/gap/loading/error 状态迁入日志 Feature Model/Hook；Widget 保留本地筛选、滚动跟随、未读提示和视图渲染。不改变 API 契约，不引入通用 Query 框架。
- **关闭条件**：Widget 不再接收或调用 `StudioApi['logs']`；远端数据流程存在可单独测试的 Feature 边界；现有日志分页和最新记录行为保持不变。
- **验证建议**：日志 model 定向测试、Client 类型检查；浏览器仅客观验证轮询、切换数据源和滚动跟随，不将视觉观感计入自动化通过。
- **第三轮拆分边界**：先迁出 `useLogFeed` 一类的本地 Feature Hook，负责 Source、Records、Gap、Truncated、Loading、Error、Refresh 与 Poll。Widget 保留 Filter、Search、Following Latest、Unread、Download 和展示。`LogRecordRow` 与 JSON Renderer 当前仍内聚，不需要继续拆包。

### 2. Composer Hint 已形成未接线功能岛

- **状态**：Deferred / Session UI decision
- **位置**：`apps/studio-client/src/app/utils.ts:20-28`、`apps/studio-client/src/app/use-studio-state.ts:124-130,242`
- **相关符号**：`readComposerHint`、`composerHint`、`composer.hint.*`
- **完整链路**：`readComposerHint()` 根据 Session、Branch、Busy 和 Input 计算提示文案 → `useStudioState` 每次渲染计算 `composerHint` → Facade 返回该字段 → 唯一消费者 `app/app.tsx` 从未读取 → `ChatComposer` 也没有 Hint Prop 或显示位置。
- **关联冗余**：`composer.hint.busy`、`noSession`、`noBranch`、`emptyInput`、`afterHead`、`emptyBranch` 六个 Key 在中英文资源中各一份，共 12 条文案，只被该未接线函数消费。
- **实际影响**：生产渲染持续执行无结果的派生计算，同时保留一组看似已实现、实际不可见的产品文案，容易误导后续开发者。
- **待决策**：如果仍需要 Composer 状态提示，应补齐明确的 UI 接线；如果没有产品需求，应删除函数、计算、Facade 字段和对应双语文案。
- **关闭条件**：Hint 在 UI 中有真实消费并具备必要测试，或整座功能岛被删除；不得只删除某一层后留下新的孤儿字段。

### 11. Prompt Preview 在输入和配置变化后继续冒充当前结果

- **状态**：Deferred / Out of current scope
- **位置**：`apps/studio-client/src/features/session-runtime/model/use-session-runtime.ts:42-45,104-117`、`apps/studio-client/src/app/use-studio-state.ts:131-146`
- **完整链路**：Preview 成功后保存 `promptPreview` → 用户继续修改 Composer Input、Agent Runtime Profile、Activation Facts 或 Context/Projection → 对应 Setter 不清空 Preview → App 继续优先使用旧 Preview 的 Messages、Projection、Trace 与 Provider Payload → `promptBuildSteps` 同时使用新的 Input 和 Activation Facts。
- **实际影响**：Inspector 会展示“旧 Preview 结果＋新输入/新配置”拼合出的流程，却没有 Stale 标记。用户无法判断看到的是当前 Prompt 还是历史结果。
- **正确归属**：Preview 有效性应由 Session Runtime 或独立 Prompt Preview Feature 管理，不能由 App 派生层猜测。
- **最小整改方向**：影响 Preview 请求键的输入变化时清空 Preview；如果产品要保留旧结果，则保存请求快照并明确标记为 Stale，不再作为当前结果优先展示。
- **关闭条件**：文本、Profile、Activation 或 Projection 变化后，旧 Preview 不再被当作当前结果。

### 12. `LogViewer.refresh()` 缺少 Current Guard，旧请求会覆盖新数据源

- **状态**：Implemented in Batch 3 / Automated verification passed
- **位置**：`apps/studio-client/src/widgets/log-viewer/log-viewer.tsx:35-74`
- **完整链路**：Server Refresh 尚未完成 → 用户切换到 Client Source，Effect 触发第二次 Refresh → Client 先返回并写入 Records/Cursor/Gap → 旧 Server 请求稍后返回并再次写入 → Source 控件显示 Client，但内容来自 Server。连续点击刷新也存在较早请求覆盖较新请求的问题。
- **附加影响**：旧请求的 `finally` 可以提前把 `loading` 清为 `false`。轮询 Effect 自身有 `disposed` Guard，本条只针对全量 Refresh。
- **最小整改方向**：Refresh 使用请求序号或 Current Context，只有最新请求可以提交状态和结束 Loading；无需引入请求取消框架。
- **关闭条件**：切换 Source 或重复刷新时，旧请求结果不能覆盖最后一次用户选择。

### 13. 无效 Route Asset ID 会被持久化，并制造“有选择但无节点”的状态

- **状态**：Deferred / Card Resources scope
- **位置**：`widgets/context-workbench/context-workbench.tsx:60-68`、`widgets/preset-workbench/preset-workbench.tsx:67-77`、`pages/studio/model/studio-layout-store.ts:135-148`、`pages/studio/studio-page.tsx:89-93`
- **完整链路**：URL 提供不存在或陈旧的 `assetId` → Workbench Effect 无条件调用 `openAssetDetail` → Store 持久化该 ID 并把 Explorer 升为 Split → `findContextNode()` 找不到真实 Node，Detail 显示空状态 → `StudioPage` 只按 `Boolean(selectedId)` 判断已有选择，仍启用 Split/Editor 控件。
- **触发条件**：手写不存在的深链、Card 内容删除对应 Asset、旧 LocalStorage 恢复。
- **实际影响**：控制层和渲染层对“是否选中资源”得出相反结论；无效 ID 还会跨刷新持续存在。
- **最小整改方向**：写入选择前校验当前 Nodes，或让控制层统一消费“实际 Node 是否存在”的事实；收到无效深链时保持 URL 但不得持久化为有效本地选择。
- **关闭条件**：无效深链和陈旧持久化状态不会启用 Detail/Edit 模式，也不会污染有效选择。

### 14. Agent Runtime Profile 选择状态已更新，但 Preset UI 未接线

- **状态**：Implemented in Batch 2 / Automated verification passed
- **位置**：`apps/studio-client/src/app/app.tsx:128-139`、`widgets/preset-workbench/preset-workbench.tsx:45-48,203-208`、`widgets/preset-workbench/agent-runtime-manager.tsx:24-25,99-105`
- **完整链路**：点击 Profile → `onSelectAgentRuntimeProfile` 更新 Feature State 和 LocalStorage → `PresetWorkbench` 的 Props 定义要求 `selectedAgentRuntimeProfileId` → App 创建组件时漏传该字段 → `AgentRuntimeManager` 永远收到 `undefined` → Active Badge、Active Class 与 `aria-pressed` 不更新。
- **实际影响**：真实选择已改变并会影响后续请求，但用户界面仍显示未选择；刷新后也无法从 UI 确认当前 Runtime Profile。
- **最小整改方向**：把现有 `state.selectedAgentRuntimeProfileId` 传入 Preset Workbench；不新增第二份本地选中状态。
- **关闭条件**：点击、数据刷新和页面重载后，UI 展示与 Feature/LocalStorage 中的选择一致。

### 15. Character Profile 离场 Timer 会清掉后来打开的 Profile

- **状态**：Open / Confirmed
- **位置**：`apps/studio-client/src/widgets/character-panel/character-panel.tsx:126-140,162-178`
- **完整链路**：关闭 Profile A 启动 180ms Timer → 动画结束前打开 Profile B，或路由同步到 B → `openProfile` 和 Route Effect 均不取消旧 Timer → 旧 Timer 到时仍执行 `setProfileCardId(undefined)` → UI 意外返回 Gallery。
- **边界说明**：Timer 在组件卸载时会清理，但在组件存活期间的新导航不会取消。
- **最小整改方向**：所有进入新 Profile 的路径先取消旧离场 Timer，并重置 Leaving 状态；Timer 回调也可校验目标 Profile/Transition Token。
- **关闭条件**：离场动画期间打开或路由切换到另一 Profile，不会被旧 Timer 清除。

### 22. `CharacterPanel` 是职责型上帝组件

- **状态**：Open / Confirmed
- **位置**：`apps/studio-client/src/widgets/character-panel/character-panel.tsx:90-479`
- **规模证据**：组件主体同时持有约 14 个 State、6 个 Ref 与 5 个 Effect；649 行文件本身不是立项原因，只是风险入口。
- **职责证据**：同一组件编排四组生命周期不同的纯 UI 状态：
  - Profile 页面身份与离场动画；
  - Gallery 查询、Grid/List、渐进分页与 IntersectionObserver；
  - 批量选择、Group 拖放、Group 表单与共享 Overlay；
  - 本地媒体校验、Picker、Paste/Drop 与 Object URL 生命周期。
- **结构证据**：Gallery 与 Profile 是两个大型互斥渲染分支，只通过选中项、媒体、删除和 Group Overlay 做少量协调，却共享整组 Render/Effect 生命周期。
- **最小拆分边界**：保留 `CharacterPanel` 作为页面身份与共享 Overlay 协调器；提取 `CharacterGallery`、`CharacterProfile` 与 `useCharacterMedia`。Group 持久状态继续使用现有 Store，不新增 Controller、Service 或 Factory。
- **关闭条件**：Gallery、Profile 与 Media 的局部状态和 Effect 各自拥有明确生命周期；Coordinator 不再直接实现查询分页、文件资源管理和大段页面 JSX。
- **验证建议**：Gallery 查询/切组重置分页、Profile 进出动画、本地媒体校验与 URL 释放的最小组件测试。

### 23. `GroupSheet` 的 Modal 语义与实际交互行为矛盾

- **状态**：Open / Confirmed；Decision resolved: Non-modal Drop Palette
- **位置**：`widgets/character-panel/character-panel.tsx:521-575`、`character-panel.module.scss:350-374`
- **证据**：组件声明 `role="dialog"` 与 `aria-modal="true"`，但 Backdrop 使用 `pointer-events: none`，只有 Sheet 自身恢复 Pointer Events；背景 Gallery/Profile 仍可点击。它也没有 Focus Trap、背景 Inert 和关闭后 Focus Restore，只提供 Auto Focus 与局部 Escape。
- **实际影响**：辅助技术被告知这是阻断式 Modal，但鼠标和键盘合同并不满足 Modal；焦点可以落到背景交互元素。
- **已确认合同**：采用 Non-modal Drop Palette。保留拖卡和背景交互能力，移除错误的 `aria-modal` 与 Modal Role；不复用阻断式 Shared Dialog。
- **第五轮键盘证据**：普通 `<section role="dialog">` 只有关闭按钮 `autoFocus`，没有 Focus Trap、背景 Inert 和关闭后 Focus Restore；Tab 可离开 Sheet，焦点离开后局部 `onKeyDown` 也不再接收 Escape。现有 Shared `Dialog` 已通过 Native `<dialog>.showModal()` 提供这些合同。
- **关闭条件**：组件以非模态 Palette 的语义暴露；背景和拖拽仍可操作，焦点进入、Escape 关闭和关闭后恢复具有明确合同，不再宣称阻断背景。

### 24. `StudioPage` 是职责型 Shell 上帝组件

- **状态**：Open / Confirmed
- **位置**：`apps/studio-client/src/pages/studio/studio-page.tsx:58-510`
- **规模证据**：544 行不是单独立项依据。实际问题是四组独立变化的职责集中在同一 Page：
  - 全局 Escape、Undo、Redo 快捷键生命周期；
  - Dock、Rail、Panel Host 与 Header 结构；
  - 浮动窗口 Bounds、Pointer Capture、Resize Preview 与持久化；
  - Panel 延迟挂载和隐藏生命周期。
- **已有边界**：`window-resize.ts` 已正确提取纯尺寸算法，但浏览器交互生命周期仍全部留在 Page。
- **最小拆分边界**：保留 `StudioPage` 作为 Shell 组合器；提取本地 `StudioRail`、`StudioPanelHost` 与 `useStudioWindowResize` 或 `StudioWindowFrame`。不建立跨项目通用 Dock Framework。
- **排除范围**：Asset View Mode 与 Resource Selection 暂不作为拆分依据。
- **关闭条件**：Page 主要负责顶层组合；快捷键、Rail 结构和 Resize 生命周期各有清晰所有者。

### 25. Page 级 SCSS 穿透并隐式控制所有 Panel Widget 的排版

- **状态**：Open / Confirmed P3 CSS ownership；merge with item 24
- **位置**：`apps/studio-client/src/pages/studio/studio-page.module.scss:479-496`
- **证据**：`.dockPanelHost button/input/select/textarea` 统一改写 Font Size，`.dockPanelHost h1/h2/h3` 改写标题排版。CSS Modules 只隔离 Class Name，不会阻止这些后代元素选择器命中 Character、Logs、Settings 等所有 Widget。
- **实际影响**：Shell 隐式拥有子组件内部控件和标题样式；新 Widget 放入 Dock 会自动改变外观，同一 Widget 离开 Dock 又会产生不同排版。
- **第六轮校准**：当前没有同一 Widget 在 Dock 外复用的生产链，统一密度也可能是宿主意图；因此本条不再作为独立高优先级行为问题，只在 Studio Shell 拆分时收口所有权。
- **最小整改方向**：Shell 只提供明确的容器 Token 或共享排版 Class；具体控件与标题由 Shared UI 基线或 Widget 自己拥有。不引入新的 CSS Framework。
- **关闭条件**：`studio-page.module.scss` 不再使用广泛元素后代选择器覆盖任意 Panel 内容。

### 32. 全局 `em` Reset 让 Markdown 强调失去可见语义

- **状态**：Implemented in Batch 4 / Automated verification passed
- **位置**：`apps/studio-client/src/styles/global.css:208-210`、`widgets/narrative-canvas/narrative-canvas.module.scss:300-303`、`shared/ui/long-text-editor/long-text-editor.module.scss:246-249`、`shared/ui/markdown-content/markdown-content.tsx:9-41`
- **完整链路**：`react-markdown` 将 `*italic*` 等强调渲染为原生 `<em>` → 全局 Reset 与 Narrative/Preview 两个宿主又分别设置 `font-style: normal` → 两个现有 Markdown 消费场景都无法以斜体展示强调内容。
- **实际影响**：作者写入的 Markdown 强调语义仍存在于 DOM，但视觉上与普通正文无法区分；全局 Reset 还会影响未来任何使用原生 `<em>` 的组件。
- **最小整改方向**：删除全局和两个 Markdown 宿主中无产品依据的普通字形覆盖；若某个局部语境确实不使用斜体，再在该语境中表达并记录理由。
- **关闭条件**：Markdown 强调默认具有可见区别，局部特殊样式不再污染全局元素合同。

### 33. 同一个 `MarkdownContent` 由两个宿主重复维护整套排版基线

- **状态**：Implemented in Batch 4 / Automated verification passed；shared baseline with host differences
- **位置**：`widgets/narrative-canvas/narrative-canvas.module.scss:192-305`、`shared/ui/long-text-editor/long-text-editor.module.scss:145-251`、`shared/ui/markdown-content/markdown-content.module.scss:1-83`
- **证据**：Narrative 的 `.messageBody` 与 Editor 的 `.preview` 分别重复定义首尾 Margin、Heading、List、Paragraph、Dialogue、Blockquote、Link、Inline Code、Pre、Table 与 `em`；共享 `MarkdownContent` 自身只拥有 Syntax Token、Semantic Token 与 Code Action 样式。
- **漂移证据**：两套规则的 Heading 尺寸与间距、Blockquote/Code Surface、Pre Padding/Radius、Table Overflow 已经不同；其中 `em` 的普通字形又与条目 32 的全局 Reset 重叠。
- **实际影响**：新增 Markdown 元素或修复排版时必须同步两个远离渲染器的宿主；遗漏会继续制造 Preview 与 Narrative 的非意图差异。
- **已确认合同**：增加共享排版复用，但不强制两个宿主视觉完全一致。首尾 Margin、Paragraph/List、Link、Em、Table 与基础 Inline Code 归 `MarkdownContent`；Surface、Heading Scale、Blockquote、Preview Padding 与 Assistant Justify 等继续由宿主表达。
- **最小整改方向**：把已确认的共享基线收回 `MarkdownContent`，上下文差异使用少量宿主规则或语义 Custom Property 表达，不新增平行 Renderer。
- **关闭条件**：真正共享的规则只有一个 Owner；保留的宿主差异均有明确视觉语境，不以“消除所有重复”为目标。

### 34. 三处按钮覆盖 `outline` 后仍由全局 `box-shadow` 提供焦点环

- **状态**：Rejected / False positive after Round 6 reverse validation
- **位置**：`widgets/narrative-canvas/narrative-canvas.module.scss:181-184`、`shared/ui/markdown-content/markdown-content.module.scss:80-83`、`shared/ui/conversation-navigator/conversation-navigator.module.scss:72-78`
- **相关控件**：Message Action、Code Action、Conversation Tick
- **反向核验证据**：`global.css:227-234` 的 `button:focus-visible` 同时设置 `box-shadow: 0 0 0 2px ...`；三处局部规则只清除 `outline`，没有覆盖 `box-shadow`，因此全局焦点环仍然生效。
- **结论**：原“没有等价焦点环”的核心因果链不成立，不进入整改计划。只有浏览器证明 Shadow 被具体 Overflow 裁剪时，才能按新的运行态证据重新立项。

### 39. `FileTree` 声明 ARIA Tree，却没有实现 Tree 的焦点、选择与键盘合同

- **状态**：Open / Confirmed；Decision resolved: complete ARIA Tree
- **位置**：`apps/studio-client/src/shared/ui/file-tree/file-tree.tsx:72-101,151-260`
- **结构证据**：根节点使用 `role="tree"`，外层 Row 使用不可聚焦的 `role="treeitem"` 与 `aria-level/aria-expanded`；真正承担选择的却是内部 `div role="button" tabIndex={0}`，同一 Row 还包含 Drag、Disclosure 与 More Actions 等多个独立 Tab Stop。
- **缺失合同**：可见 Selected 只进入 CSS Class，没有 `aria-selected`；所有节点进入普通 Tab 顺序，没有 Roving Tabindex，也未实现 Tree 所需的 Arrow Up/Down、Left/Right、Home/End 导航与展开收起。
- **实际影响**：辅助技术接收到 Tree/Treeitem 结构，但焦点和操作目标落在嵌套 Button 上；键盘用户必须逐项 Tab，视觉选择与可访问选择状态也不一致。
- **已确认合同**：实现完整 ARIA Tree，不降级为 List/Button。Treeitem 自身承担主焦点和 `aria-selected`；使用 Roving Tabindex，并实现 Arrow Up/Down/Left/Right、Home/End、Enter/Space、展开收起与父子导航。
- **关闭条件**：DOM Role、焦点目标和选中状态统一；Tab 只进入 Tree 一次，方向键覆盖全部可见节点；Disclosure、DND 与 More Actions 不破坏主 Tree 焦点模型。

### 40. Agent Runtime 创建与模型选择控件缺少稳定可访问名称

- **状态**：Implemented in Batch 2 / Automated verification passed
- **位置**：`apps/studio-client/src/widgets/preset-workbench/agent-runtime-manager.tsx:64-74,108-121`
- **证据**：新 Profile 名称 Input 只有 Placeholder，新模型 Select 只依赖首个 Option；每个已有 Profile 的模型 Select 也没有 `<label>`、`aria-label` 或 `aria-labelledby`。多个 Profile 的下拉框对辅助技术无法区分所属对象。
- **实际影响**：Placeholder 和 Option 不是稳定的控件名称；读屏和语音控制用户无法可靠识别“名称”“新 Profile 模型”以及“某 Profile 的模型”。
- **最小整改方向**：优先复用现有 I18N 文案，以可见 `<label>` 或由字段语义与 `profile.name` 组合的 Accessible Name 接线，不增加表单框架。
- **关闭条件**：三个控件类别在无视觉上下文时均有稳定、唯一且本地化的可访问名称。

### 41. 三组可见 Active 状态没有同步给辅助技术

- **状态**：Implemented in Batch 2 / Automated verification passed
- **位置**：`widgets/context-workbench/context-workbench.tsx:104-115`、`widgets/preset-workbench/preset-workbench.tsx:117-132`、`widgets/character-panel/character-panel.tsx:357-360`
- **证据**：Context Category 与 Preset Assets/Order 只用 `.loom-page-tab-active` 表达当前项，普通 Button 没有 `aria-current` 或 `aria-pressed`；Character Profile 的 Edit Button 只切换 Active Class，也没有 `aria-pressed={editing}`。
- **实际影响**：视觉用户能看到当前 Category、Preset Panel 与 Edit Mode，辅助技术只能读到一组普通按钮，无法获得相同状态事实。
- **最小整改方向**：按真实行为补 `aria-current`/`aria-pressed`；只有产品确认它们是 Tabs 时才建立完整 `tablist/tab/tabpanel` 与键盘模型，不能只加 Role。
- **关闭条件**：可见 Active/Editing 状态与 Accessible State 始终一致。

## P3：确定的低风险去冗余与结构债务

### 3. `useStudioState` Facade 暴露约 19 个唯一消费者从未读取的字段

- **状态**：Deferred / Domain facade scope
- **位置**：`apps/studio-client/src/app/use-studio-state.ts:188-275`
- **消费者**：`apps/studio-client/src/app/app.tsx:24`
- **证据**：`useStudioState()` 只有 `App` 一个运行时调用方；以下返回字段不存在任何 `state.<field>` 读取：

```text
endpoint
setEndpoint
promptPreview
promptProjection
activationControl
activationFacts
setActivationMode
toggleActivationTag
setContextAssets
composerHint
deleteCard
switchBranchById
refreshCards
refreshProviderAccounts
refreshModelProfiles
refreshAgentRuntimeProfiles
updateProviderAccount
updateModelProfile
pingModelProfile
```

- **边界说明**：本条只证明 Facade 返回层冗余，不证明底层实现无用。例如 `endpoint`、`activationFacts` 和 `refreshCards` 在 Hook 内部仍有真实消费；Provider Update/Ping 可能是尚未接入 UI 的 Feature 能力。
- **第二轮更正**：`selectedAgentRuntimeProfileId` 虽然当前没有被 `App` 读取，但条目 14 已证明它是 Preset UI 漏接的必要状态，不属于应删除的 Facade 字段。
- **延期原因**：其余字段大多属于 Session、Card、Prompt、Provider 或 Bridge 的领域 Facade。后端与数据层稳定前，不依据当前消费表面积推动删除或重组。
- **实际影响**：Facade 公开表面积大于真实 App 合同，使已接线能力与未接线能力不可区分，增加上帝 Facade 的错觉与后续误用概率。
- **最小整改方向**：只移除未消费的返回字段；底层函数是否删除由各自完整消费链单独判断。`composerHint` 按条目 2 一并处理。
- **关闭条件**：Facade 返回值与 `App` 的真实消费一一对应；未接线 Feature 能力保留在其所属 Hook 内，不通过 App Facade 暴露。

### 4. 两组纯 Model 与消费者文件形成类型级循环

- **状态**：Partially confirmed；FileTree current / Projection deferred
- **循环 A**：`projection-order.ts` → `projection-slot.ts` → `projection-order.ts`
- **循环 B**：`file-tree.tsx` → `file-tree-model.ts` → `file-tree.tsx`
- **证据 A**：`projection-order.ts:2` 运行时 import Slot Helper；`projection-slot.ts:2` 为 `readSlotEntrySummary()` 反向 import `ProjectionOrderEntry` 类型。
- **证据 B**：`file-tree.tsx:7` import Model Helper；`file-tree-model.ts:1` 从 React 组件文件反向 import `FileTreeNode` 类型。
- **风险边界**：两条反向边均为 `import type`，编译后消除，当前不构成运行时初始化故障；问题是纯 Model 的类型所有权反向落在消费者或上游实现文件，污染依赖图并提高未来转为运行时 import 的风险。
- **第六轮范围校准**：循环 A 属于 Projection 数据模型，随当前数据层范围延期；循环 B 是纯前端 Shared FileTree 类型所有权，可进入 FileTree 整改批次。
- **最小整改方向**：当前只把 `FileTreeNode` 移入 Model 或相邻最小类型文件，消除 `file-tree-model.ts → file-tree.tsx`；Projection 循环不在本轮处理。
- **关闭条件**：FileTree 模块组恢复单向依赖；Projection 部分保持原样并继续标记 Deferred。
- **第三轮补充**：`FileTreeNode` 定义在 React 组件文件，使纯 Model 反向 Type Import；同时公共 Callback 把具体节点擦除成 `FileTreeNode`，两个消费者累计需要约 10 次 `as ContextAssetNode`。优先移动基础类型消除循环；是否把组件改为 Generic 必须证明能减少断言且不会显著扩大 API 复杂度。

### 5. Activation Option 配置完全未消费

- **状态**：Implemented in Batch 1 / Static verification passed
- **位置**：`apps/studio-client/src/features/prompt-build/model/activation-control.ts:11-22`
- **相关符号**：`ActivationTagOption`、`activationModeOptions`、`activationTagOptions`
- **证据**：三个符号全仓只有定义，没有 import、读取或测试消费；同文件的 `ActivationControlState`、`createActivationFacts()` 与 `toggleActivationTag()` 仍有真实调用，不能整文件删除。
- **实际影响**：保留了一套带颜色和 I18N Key 的虚假 UI 配置，使代码看起来存在 Activation 控件，但当前 UI 没有消费这些选项。
- **最小整改方向**：仅删除第 11～22 行的类型和常量；是否恢复 Activation UI 属于独立产品决策。
- **关闭条件**：无未消费 Option 配置；保留的 Activation Runtime 逻辑继续通过现有定向测试。

### 6. 多个文件内部类型或 Helper 被无意义地导出

- **状态**：Implemented in Batch 1 / Static verification passed
- **性质**：公共表面积噪声，不是死逻辑
- **证据**：下列符号只在定义文件内部作为参数、返回类型或实现 Helper 使用，全仓没有外部 import：

```text
ContextAssetNodeInfo
ContextAssetSearchResult
ConversationMarkerKind
DialogRect
EditOperationAnchor
LogStreamItem
ModelCatalogItem
StudioRoute
LongTextEditorAction
AsyncOperationEvent
AsyncOperationStatus
CharacterGroup
```

- **实施期更正**：全仓复核发现 `chooseAgentRuntimeProfileId` 被 `tests/unit/client/provider-settings.test.ts` 直接测试，`normalizeKeywords` 被 `tests/unit/client/activation-editor.test.ts` 直接测试；两者继续导出，不属于公共表面积噪声。其余 12 个符号确认没有定义文件外消费者。
- **最小整改方向**：仅对上述 12 个内部类型移除 `export`，不删除实现；两个测试合同需要的函数保持导出。
- **关闭条件**：文件公共表面积只包含真实跨文件消费者需要的符号。

### 7. 两个 SCSS 编译期抽象完全未使用

- **状态**：Implemented in Batch 1 / Static verification passed
- **位置**：`apps/studio-client/src/styles/abstracts/_variables.scss:5`、`apps/studio-client/src/styles/abstracts/_mixins.scss:10-14`
- **相关符号**：`$breakpoint-mobile`、`flex-center`
- **证据**：两者全仓只有定义，没有变量引用或 `@include`；Vite 会把 abstracts 自动注入全部 SCSS，因此不是遗漏手动 import 导致的假阴性。
- **最小整改方向**：删除两个未消费定义；不创建新的调用方来证明抽象存在价值。
- **关闭条件**：SCSS abstracts 中只保留有真实消费的编译期工具，Sass 编译通过。

### 16. Card Bootstrap 存在两套互相覆盖的默认选择策略

- **状态**：Deferred / Card scope
- **位置**：`features/cards/model/use-cards.ts:37-45`、`app/use-studio-state.ts:89-105`
- **完整链路**：`refreshCards()` 已按“当前有效 ID → Demo Card 名称 → 第一张 Card”选择默认项 → Bootstrap 再读取返回数组并强制把 `selectedCardId` 设置为 `cards[0].id`。
- **实际影响**：Feature 中明确实现的 Demo Card 优先策略会被 App Facade 覆盖；默认选择事实有两个所有者，单独阅读任一处都无法得出最终行为。
- **最小整改方向**：默认选择只留在 `useCards`；Bootstrap 只触发刷新。若 App 有额外要求，应作为显式输入传给 Feature，而不是刷新后再次覆盖。
- **关闭条件**：当前选择有效、当前选择已删除、Demo Card 非第一项和空列表场景都由一个策略决定。

### 17. `studio-layout-store` 混合多个生命周期，并形成 `widgets → pages` 反向依赖

- **状态**：Deferred / Confirmed dependency debt, scope crosses Asset Workspace
- **位置**：`pages/studio/model/studio-layout-store.ts:26-58,123-238`
- **消费者**：`app/app.tsx`、`pages/studio/studio-page.tsx`、`widgets/context-workbench/context-workbench.tsx`、`widgets/preset-workbench/preset-workbench.tsx`
- **证据**：同一文件同时承载 Shell Dock/窗口尺寸与模式、路由投影 Active Panel、Asset Workbench 的选择/展开/宽度/视图、Context/Preset 专属偏好以及编辑器偏好。两个 Widget 直接 import `pages/studio/model`，与分层方向相反。
- **当前判断**：第一轮的“位置候选”已被字段级消费者图确认。问题不是简单路径命名，而是多个状态生命周期共享一个持久化容器。
- **第六轮范围校准**：反向依赖事实成立，但完整整改会同时重组 Asset Workspace 与 Context/Preset 偏好，跨入当前延期的 Card Resources 邻接范围。现在只记录 Owner Map，不迁移状态形态或持久化 Schema。
- **恢复条件**：Asset Workspace 前端身份与持久化范围稳定后，先明确 Shell、Asset Workspace、Panel Preference 三组 Owner 与迁移策略，再消除 Widget 对 Page 内部 Store 的反向依赖。

### 18. Asset Workspace 持久化表只增不清，长期保留已删除 Card 的状态

- **状态**：Deferred / Card Resources scope
- **位置**：`pages/studio/model/studio-layout-store.ts:21-35,135-205,226-235`
- **证据**：`assetLayouts.*.views` 使用 `Record<workspaceId, AssetViewState>` 并整体持久化；所有 Action 只添加或覆盖 Key，全仓没有删除 Workspace View 的 Action。Card 删除后，其 Expanded IDs、Selected ID 与 View Mode 仍留在 LocalStorage。
- **实际影响**：长期使用会积累陈旧引用和存储体积；旧 Card ID 被复用或导入时还可能恢复不相关选择。
- **最小整改方向**：先明确产品是否要求永久记忆每张 Card 的布局。若否，在 Card 集合更新或删除成功后清理未知 Workspace，或设置有依据的容量上限。
- **关闭条件**：存在明确保留策略；非活跃且不可恢复的 Workspace 状态不会无限增长。若确认永久保留是需求，应记录接受的容量限制和升级路径。

### 19. Character Media 在 Card 删除后保留孤儿 Blob URL 与状态

- **状态**：Open / Confirmed
- **位置**：`widgets/character-panel/character-panel.tsx:138-146,180-200,276-286`
- **完整链路**：上传本地图片 → 创建 Blob URL 并写入 `mediaObjectUrlsRef/mediaByCardId` → 删除 Card → 集合变化 Effect 只清理 Selected IDs → 对应 Media State 和 Blob URL 保留到整个 Panel 卸载。
- **实际影响**：反复“上传预览→删除 Card”会持续占用 Blob 内存并积累孤儿 State。替换同一媒体和组件卸载时的清理逻辑是正确的，本条只针对 Card 被移除。
- **最小整改方向**：Cards 集合变化或删除确认后，删除不存在 Card 的 Media State，并立即 `revokeObjectURL`。
- **关闭条件**：Card 从生产集合移除后，不再存在对应 Blob URL 或媒体记录。

### 20. Provider Base URL 复制反馈 Timer 存在重复点击竞态

- **状态**：Implemented in Batch 2 / Automated verification passed
- **位置**：`widgets/model-panel/provider-account-list.tsx:51-75`
- **完整链路**：每次复制成功都创建新的 1200ms Timer，但不保存或取消旧 Timer → 第二次复制发生后，第一次 Timer 可以很快把 `copied` 清除 → 新反馈提前消失；账户行卸载后 Timer 仍会执行 State Setter。
- **最小整改方向**：使用 Timer Ref 或 Effect Cleanup，重复复制时先取消旧 Timer。相邻的 LongTextEditor、Markdown Code Block 与 Narrative Canvas 已有可复用的生命周期模式，无需抽象通用 Timer Hook。
- **关闭条件**：连续复制从最后一次操作重新计时；组件卸载后无待执行反馈回调。

### 21. `canSend` 与 `canPreviewPrompt` 是完全相同的派生事实

- **状态**：Rejected / Keep distinct capability names
- **位置**：`apps/studio-client/src/app/use-studio-state.ts:120-123`
- **证据**：两个变量拥有逐字相同的条件，只使用不同名称暴露。
- **第六轮反向判断**：Send 与 Preview 是两个真实不同的用户能力；当前条件相同不证明它们共享永久产品合同。合并只节省一行派生，却会把两个未来可能独立演化的语义绑在一起。
- **结论**：保留两个命名清晰的能力事实，不为物理去重建立 `composerReady` 中间概念。只有条件出现大段复杂重复时再复核。

### 26. Rail 已有配置表，但七组 Tab 仍手写重复实现

- **状态**：Open / Confirmed
- **位置**：`apps/studio-client/src/pages/studio/studio-page.tsx:32-40,294-394`
- **证据**：`PANEL_DEFINITIONS` 已声明 Icon 与 Label Mapping，但 Model、Character、Preset、Resource、Inspector、Logs、Settings 仍分别手写相同的 `aria-controls`、`aria-expanded`、Active Class、Title、Icon、Label 与 `togglePanel`。
- **真实差异**：Model 的 Incomplete 状态和 Rail 分隔线属于真实差异，不需要为了映射而消失。
- **最小整改方向**：增加仅服务本文件的 `StudioRailTab`，特殊状态以少量 Props 传入；分组与 Divider 继续由 Rail 显式组织。不要创建全局 Navigation 配置系统。
- **关闭条件**：单个 Panel Tab 的结构、ARIA 与 Active 判定只有一份实现。

### 27. Window Resize 的 DOM Bounds 计算和 Handle 事件结构重复

- **状态**：Open / Confirmed
- **位置**：`apps/studio-client/src/pages/studio/studio-page.tsx:148-225,468-510`
- **证据**：Pointer 与 Keyboard Resize 分别读取 Stage/Dock Bounds、Available Height 与 CSS Max Height；Horizontal、Vertical、Both 三个 Handle 又重复相同的 Pointer Down/Move/Up/Cancel/Lost Capture 绑定。
- **最小整改方向**：提取本文件私有的 `readWindowResizeBounds(stage,dock)`，并用局部 `WindowResizeHandle` 或三项映射复用事件绑定。保留现有 `resizeWindow()` 纯函数和持久化合同。
- **关闭条件**：Bounds 计算和 Handle 事件绑定各只维护一份，不增加通用 Resize Framework。

### 28. `GroupSheet` 在 Gallery 与 Profile 两个分支重复完整装配

- **状态**：Open / Confirmed
- **位置**：`apps/studio-client/src/widgets/character-panel/character-panel.tsx:392,450-474`
- **证据**：同一 `GroupSheet` 的 Open、Draft、Editing、Close、Delete、Rename、Select Handler 在两个互斥页面分支分别装配；一处已压成单行，另一处展开，出现维护形态漂移。
- **最小整改方向**：在拆分 Gallery/Profile 后，由 Character Panel Coordinator 只渲染一次共享 Overlay；短期也可以只提一个局部 JSX 变量。不要创建 Props Factory。
- **关闭条件**：Group Overlay 的状态和 Handler 只有一个装配位置。

### 29. Log Viewer 的“返回最新”链接污染 Studio URL Hash 与历史记录

- **状态**：Implemented in Batch 3 / Automated verification passed
- **位置**：`apps/studio-client/src/widgets/log-viewer/log-viewer.tsx:241-246`
- **证据**：操作使用 `<a href="#loom-log-latest">` 依赖浏览器默认 Anchor Scroll。点击后会把地址栏改为非 Studio 路由合同的 Hash，并创建浏览历史项。
- **实际影响**：一个 Widget 内部滚动动作污染全局 URL；返回操作需要额外穿过无业务含义的 History Entry。Studio Hash 正式合同只用于 `#entry-*`。
- **第五轮语义证据**：该元素只执行当前视图内滚动，不代表可导航资源；使用 `<a>` 除了污染 URL，也向键盘和辅助技术暴露了错误的 Link 合同。
- **最小整改方向**：改用 Button，调用 `latestRef.current?.scrollIntoView({ block: 'end' })`，并清空 Unread/恢复 Following 状态，不写 URL。
- **关闭条件**：返回最新行为不改变地址栏或浏览历史。

### 30. `FileTree` 公共 Props 保留两组没有生产消费者的能力

- **状态**：Open / Confirmed
- **位置**：`apps/studio-client/src/shared/ui/file-tree/file-tree.tsx:20,33,39-50`
- **相关 Props**：`defaultExpandedIds`、`renderTrailing`
- **证据**：两个生产调用方都使用受控的 `expandedIds/onExpandedIdsChange`；非受控展开分支没有生产消费者。`renderTrailing` 也只有定义、递归透传和渲染位置，没有调用方传入。
- **最小整改方向**：删除未消费 Props、Local Expansion State 与递归透传；未来出现真实调用方再按需求加回。
- **关闭条件**：FileTree 公共合同只包含当前真实使用能力。

### 31. `LongTextEditor` 的 `sourceOnly` 模式仍强制传入不可达文案

- **状态**：Implemented in Batch 4 / Automated verification passed
- **位置**：`apps/studio-client/src/shared/ui/long-text-editor/long-text-editor.tsx:21-50`、`widgets/narrative-canvas/narrative-canvas.tsx:214-240`
- **证据**：Narrative Canvas 使用 `sourceOnly`，但仍必须传 `disableCodeWrapLabel`、`enableCodeWrapLabel`、`previewEmptyLabel`、`previewModeLabel`、`sourceModeLabel`；这些分支在 Source-only 模式永远不会渲染。
- **实际影响**：调用点包含大量虚假必填 Props，无法从接口区分 Source-only 与双模式 Editor 的真实合同。
- **最小整改方向**：使用轻量的 Discriminated Props，或只让非 Source-only 分支要求这些 Labels。不要建立 Editor 配置系统。
- **关闭条件**：Source-only 调用方只需提供实际可达的文案与行为。

### 35. 全局滚动条规则与 SCSS Mixin 重复维护同一实现

- **状态**：Implemented in Batch 1 / Static verification passed
- **位置**：`apps/studio-client/src/styles/global.css:177-198`、`styles/abstracts/_mixins.scss:17-35`、`shared/ui/json-block/json-block.module.scss:1-14`
- **证据**：全局 `*` 与 WebKit Scrollbar 已应用完整的 Color、Track、Thumb 和 Hover 规则；`custom-scrollbar` Mixin 基本逐项复制同一实现，唯一调用方是 Json Block。
- **实施期级联更正**：Json Block 位于 Dock 时，原 Mixin 的局部 `12px` Width/Height 可能覆盖 Shell 的 `6px` 滚动条规则，因此不能把整个 Include 描述为无效。批次 1 删除重复 Mixin，但在 Json Block Module 中保留明确的 `12px` 尺寸差异。
- **最小整改方向**：删除重复的 Include/Mixin，只让 Json Block 声明真实尺寸差异；Studio Dock 其他滚动条继续使用 `6px`。
- **关闭条件**：默认滚动条只有全局实现，局部 Module 只声明真实差异。

### 36. `FileTree` 用两个无必要的 `!important` 固化普通状态覆盖

- **状态**：Open / Confirmed
- **位置**：`apps/studio-client/src/shared/ui/file-tree/file-tree.module.scss:116-135`
- **证据**：`.dragOver` 位于 `.row:hover, .selected` 之后且当前同为单 Class Specificity，Background 自然能够覆盖；`.draggingOverlay` 之后也没有 Inline Cursor 或更高优先级声明与 `cursor: grabbing` 竞争。
- **边界说明**：DND 运行时只通过 Inline Custom Property 传入树深度，没有为这两个属性写 Inline Style；因此不能用第三方库样式作为保留理由。
- **最小整改方向**：直接移除两个 `!important`；若未来出现真实状态竞争，再通过明确的组合状态 Selector 表达。
- **关闭条件**：Drag Over 与 Overlay 行为保持不变，普通视觉覆盖不再依赖 `!important`。

### 37. Agent Runtime 列表使用范围过宽的 `transition: all`

- **状态**：Implemented in Batch 2 / Automated verification passed
- **位置**：`apps/studio-client/src/widgets/preset-workbench/agent-runtime-manager.module.scss:178-190`
- **证据**：`.agentItem` 对所有可动画属性应用 `transition: all 0.15s ease`，而 Hover/Active 当前只改变 Border 与 Background。
- **第六轮校准**：收窄属性的维护性证据成立；但 150ms 颜色过渡不等同于必须由 Reduced Motion 关闭的空间运动，现有项目规范也没有要求禁用所有颜色 Transition。
- **最小整改方向**：只声明实际变化的 `border-color` 与 `background-color`；不强制新增 Reduced Motion 分支，也不建立 Motion 抽象。
- **关闭条件**：未来尺寸或位置属性不会被 `all` 意外纳入动画，当前视觉反馈保持不变。

### 38. 大样式文件中保留数处完全等价的重复声明

- **状态**：Implemented in Batch 1 / Static verification passed
- **位置**：`widgets/narrative-canvas/narrative-canvas.module.scss:39-43,118-121,192-198,308-316`、`widgets/model-panel/model-panel.module.scss:153-161`
- **证据**：Narrative 的 `.assistant` 重复基础 `.message` 的透明背景，`.user .messageBody` 完整重复 `.messageBody` 的 Font/Size/Line Height，移动端 `.timelinePane` 重复基础 `min-height: 0`；Model Panel 先把 `.warning` 与 `.hint` 同设为 Subtle，紧接着又把 Warning 改为 Danger。
- **最小整改方向**：作为统一机械清理批次删除被后续或基础规则完全覆盖的声明，不创建 Mixin 或新的共享 Class。
- **关闭条件**：最终 Computed Style 不变，相关 Module 不再保留等价重复声明。

## 待决策候选：当前不进入确定整改项

### A. 九个 `--loom-*` Token 当前无内部消费

- **状态**：Open / Contract decision
- **位置**：`apps/studio-client/src/styles/global.css:38,43-44,48,51,84-85,88-89`
- **候选 Token**：

```text
--loom-accent-soft
--loom-role-user
--loom-role-assistant
--loom-danger-foreground
--loom-warning-foreground
--loom-rail-width
--loom-overlay-width
--loom-radius-message
--loom-shadow-panel
```

- **事实**：当前仓库没有任何 `var()` 消费，文档搜索也未发现明确使用说明。
- **暂不删除原因**：Settings 允许把用户 Custom CSS 直接注入页面，`--loom-*` 可能已经被视为外部主题覆盖契约。静态未消费不能证明外部无消费者。
- **决策条件**：CSS/Theming 轮次核对正式公共 Token 边界后，再决定删除、补消费或标记为兼容保留。

### B. Provider Settings Bootstrap 是否需要严格的全量一致快照

- **状态**：Open / Design decision
- **位置**：`features/provider-settings/model/use-provider-settings.ts:30-59`、`app/use-studio-state.ts:89-105`
- **事实**：Provider Accounts、Model Profiles、Agent Runtime Profiles 是三份独立前端状态，但 `refreshProviderSettings()` 串行读取；任一较早请求失败会阻止后续列表加载，并把三段网络延迟相加。
- **可能影响**：一个列表暂时不可用时，其他可用设置也不会加载；第一项成功、后续失败时还会形成部分加载状态。
- **暂不判缺陷原因**：如果产品要求三份列表必须来自严格一致的快照，串行全有或全无可能是有意选择，但当前文档与代码没有表达这一合同。
- **决策条件**：确认是否存在严格一致性要求。若没有，三份读取应并行或独立表达 Loaded/Error，不需要引入 Query 框架。

### C. Workbench 对整个 Asset Layout 分支的订阅可能过宽

- **状态**：Deferred / Card Resources scope
- **位置**：`widgets/context-workbench/context-workbench.tsx:49-50`、`widgets/preset-workbench/preset-workbench.tsx:58-59`
- **事实**：两个 Workbench 订阅整个 `assetLayouts.resources/preset`；任一 Workspace 更新都会重建对应 AssetLayout。访问过的 Panel 会保持挂载，因此隐藏 Workbench 也可能响应无关 Workspace 更新。
- **暂不立项原因**：存在额外 Render 的静态证据，但当前没有 Profiler 数据证明实际代价。为减少理论 Render 引入复杂 Selector 或 Shallow 比较不符合本次审计原则。
- **升级条件**：Profiler 证明修改其他 Workspace 会造成可见或高成本 Commit，再将 Selector 收窄到当前 Workspace View 与 Explorer Width。

### D. Character 批量选择是否应跨 Group Filter 保留

- **状态**：Open / Product decision
- **位置**：`widgets/character-panel/character-panel.tsx:101-102,134-146,255-258`
- **事实**：切换 Group 只重置分页，不清空 `selectedCardIds`；Toolbar 可能继续计入并操作当前不可见的已选 Card。
- **两种合理合同**：跨 Group 批处理需要保留隐藏选择；如果选择只应作用于当前视图，则隐藏选择会造成误删除或误分组风险。
- **决策条件**：明确选择作用域。确定后补充可见 Selection Count 或在 Filter 切换时清理，不依据猜测修改。

### E. Dock 内组件仍按 Viewport 断点判断，可能晚于真实容器宽度降级

- **状态**：Needs browser evidence
- **位置**：`pages/studio/studio-page.module.scss:19-47,567-589`、`shared/ui/asset-workbench-layout/asset-workbench-layout.module.scss:136-164`、`features/context-assets/ui/context-asset-detail/context-asset-detail.module.scss:155-181`
- **结构事实**：浮动 Dock Active 时左侧 Rail 固定占用约 `160px`，Panel 内容显著窄于 Viewport；Asset Workbench 与 Detail 却分别只在 Viewport `720px`、`760px` 以下切换窄布局。Viewport 为 `721～820px` 时，宿主内容可能已不足约 `560～650px`，组件仍保持桌面 Split/Metadata 布局。
- **不能直接确认原因**：CSS Grid 的 `minmax(0, ...)` 可能只造成紧凑显示，也可能产生实际不可用的控件拥挤；缺少运行态尺寸和命中证据，不能仅凭断点不同立项。
- **验证条件**：在 `721～820px` Viewport 下打开 Dock 内 Asset Explorer/Split/Editor，记录各 Pane `getBoundingClientRect()`、横向 Overflow 与控件可操作性。确认影响后再决定使用 Container Query 或宿主尺寸状态。

### F. `stagePanel` 与多个 Widget 同时声明 Scroll Owner

- **状态**：Needs browser evidence
- **位置**：`pages/studio/studio-page.module.scss:506-510`、`widgets/character-panel/character-panel.module.scss:1-5`、`widgets/log-viewer/log-viewer.module.scss:1-14,138-147`、`widgets/inspector-panel/inspector-panel.module.scss:1-6`
- **结构事实**：Page 对所有 Stage Panel 统一设置 `overflow: auto`；Character、Log Viewer Records、Inspector 与 Agent Runtime Manager 又各自拥有内部 `overflow: auto`。当前多数场景可能因 `height: 100%` 让外层 Scrollbar 保持闲置，但所有权并不唯一。
- **不能直接确认原因**：静态声明无法证明现有内容一定产生双滚动、滚轮切换或 Sticky 失效；批量删除外层 Overflow 也可能破坏尚未自带 Scroll Owner 的 Widget。
- **验证条件**：逐个 Panel 在正常高度与窄屏下读取 `scrollHeight/clientHeight`，确认实际可滚动祖先数量、Sticky Toolbar 与滚轮归属后，再按 Widget 明确唯一 Owner。

### G. Studio Shell 的 Escape 是否应优先关闭 Panel，当前合同自相矛盾

- **状态**：Open / Product decision
- **位置**：`pages/studio/studio-page.tsx:109-140`、`features/context-assets/ui/context-asset-detail/context-asset-detail.tsx:48-62`、`shared/ui/long-text-editor/code-mirror-editor.tsx:305-319`
- **结构事实**：全局 Handler 在 `isEditableTarget(event.target)` 之前依次处理 Metadata、Immersive 与 Panel Escape；因此 Settings Textarea、Provider Input、Log Search/Select、Character Form 等普通编辑控件内按 Escape 会直接关闭 Shell 层。Context Metadata 与 CodeMirror 又分别通过 `preventDefault/stopPropagation` 消费 Escape，表现并不统一。
- **冲突证据**：同一 Handler 对 Undo/Redo 明确在 Editable Target 时退出，但 Escape 被刻意或意外放在保护之前，代码无法表达统一优先级。
- **决策条件**：明确采用“编辑控件先消费 Escape，第二层才关闭 Shell”，还是“任何 Escape 都按 Metadata → Immersive → Panel 关闭”。确定后统一实现并覆盖普通 Input、Textarea、Select 和 CodeMirror。

### H. Conversation Navigator 改变 Active Item 后没有主动移动焦点

- **状态**：Needs browser evidence
- **位置**：`shared/ui/conversation-navigator/conversation-navigator.tsx:83-93,124-140`
- **结构事实**：Arrow/Home/End 调用 `onNavigate()` 改变 Active ID；Roving Tabindex 随 Props 把新 Active Button 设为 `0`、旧 Button 设为 `-1`，但代码没有对新 Button 调用 `focus()`。长列表移动可视窗口时，旧 Focused Button 还可能被卸载。
- **可能影响**：DOM Focus、视觉 Active、`aria-current` 和 Preview 可能指向不同条目；旧节点卸载后焦点可能回到 Body。
- **验证条件**：用键盘连续移动短列表和超过可视容量的长列表，读取 `document.activeElement`、`aria-current` 与 Preview Entry；只有确认错位后才升级为缺陷。

### I. Narrative 复制 Promise 可能让旧条目覆盖较新的反馈状态

- **状态**：Needs browser evidence
- **位置**：`widgets/narrative-canvas/narrative-canvas.tsx:124-144`
- **结构事实**：复制 Entry A 的 `clipboard.writeText()` Pending 时可以继续复制 B；两次 Promise 没有 Request Identity。若 B 先完成、A 后完成，A 会重新写入旧 `copyState.id` 并替换 Feedback Timer；Copy Link 存在同类链路。
- **不能直接确认原因**：静态顺序允许乱序，但目标浏览器的 Clipboard Permission/调度是否能稳定产生交叉完成仍需实测；剪贴板最终内容本身也由浏览器写入完成顺序决定。
- **验证条件**：在浏览器中用可控 Clipboard Stub 交叉完成 A/B，确认错误条目是否显示 Copied/Failed。成立后使用轻量 Epoch，只允许最后一次意图提交反馈。

### J. 动态复制与搜索反馈是否需要统一 Live Region 合同

- **状态**：Needs screen-reader evidence / Product decision
- **位置**：`shared/ui/long-text-editor/long-text-editor.tsx:249`、`shared/ui/markdown-content/markdown-code-block.tsx:47-63`、`widgets/model-panel/provider-account-list.tsx:94-96`、`features/context-assets/ui/context-asset-search/context-asset-search.tsx:39-60`
- **结构事实**：Long Text Editor 使用独立 `aria-live="polite"` 宣布复制/清空结果；Markdown Code 与 Provider Base URL 只动态修改当前按钮 Accessible Name；Context Search 动态替换结果列表或 Empty 文案，但没有 Status/Live Region。
- **不能直接确认原因**：不同读屏器是否朗读 Focused Button 的 Name 变化并不一致；搜索结果是否必须主动播报数量也属于产品可访问性合同。
- **验证条件**：使用项目目标读屏器验证成功、失败、空结果和连续输入；若现状不可感知，再复用轻量 Visually Hidden Live Region，不为每个组件建立独立通知系统。

## 第一轮排除项

以下工具或静态扫描候选已反向核验，不作为问题：

- `log-viewer` 的 `latest*` 与日志等级 class 通过 `styles[...]` 动态读取；
- Markdown 的 `tok-*` 由 Lezer `classHighlighter` 生成；
- `.cm-*` 与 `.cm-editor` 对应 CodeMirror 生成的第三方 DOM；
- 测试文件作为 Vitest 入口，不因没有生产 import 认定为孤儿；
- `entities/index.ts` 和 `shared/i18n/index.ts` 虽扇入较高，但符合实体聚合与 I18N 公共入口职责；
- `app/app.tsx` 和 `app/use-studio-state.ts` 的高扇出本身不能证明是上帝模块；
- deep import 数量本身不是缺陷，当前 Guide 没有要求每个 Slice 必须提供公共 Barrel。

## 第一轮工具与验证边界

本轮执行了：

- `rg` 全仓正向与反向引用搜索；
- 从 `main.tsx` 出发的静态相对 import/dynamic import 可达性检查；
- Client 文件数量与行数统计；
- CSS Modules import、静态 `styles.foo`、动态 `styles[...]`、`:global`、第三方 DOM 与 Token 消费交叉核验；
- 当前分支、提交与工作区状态检查。

当前仓库没有安装 `node_modules`，因此未执行 TypeScript `noUnusedLocals` / `noUnusedParameters`、Knip、Client Build、Lint 或测试。临时 Knip 也无法在缺少 Vite 插件依赖的情况下正确加载项目配置。本轮没有安装依赖，所有结论均保留这一验证限制。

## 第二轮排除项

以下状态重复或生命周期候选已有明确职责，不作为问题：

- `useContextAssets` 的 `nodes`、`nodesRef` 与 `persistedNodesRef` 分别承担 React 渲染草稿、同步读取和最后持久快照，不是三份无意义的 Source of Truth；
- Context Mutation Queue 为同一资源的写入提供 FIFO 顺序，具有实际并发保护价值；
- `useCards.cardDraft` 是独立表单草稿，选中 Card 变化时重置符合当前编辑合同；
- Agent Runtime Profile 的 LocalStorage 与 React State 分别承担持久选择和响应式状态；问题位于 Props 断链，不应删除任一层；
- Edit History 的 State 与 Ref 用于异步回调读取最新栈，当前没有失效闭包证据；
- URL → Active Panel 是刻意的单向初始化。Panel 本地切换不反写 URL，符合当前导航文档和测试；
- Search Query → Workbench Local State 是深链初始化和外部变化同步，用户普通输入不回写 URL，不是循环同步；
- `assetMetadataOpen` 与 `textEditorMode` 当前由测试明确为跨 Preset/Resource 的全局偏好，不能仅因多个 Workbench 消费就判定所有权错误；
- Narrative Canvas 的 Timer 和 Animation Frame、Context Menu 的 Listener/Long Press Timer、CodeMirror、ResizeObserver、IntersectionObserver 与 Log Poll 均找到对称清理；
- 多处 Clipboard Promise 在组件卸载后完成只会造成无效 State Update，当前没有可复现产品影响，暂不单独立项；
- Endpoint/Bridge 变化时旧 Bootstrap 可能迟到写入，但 `setEndpoint` 当前没有 App 消费，缺少可达交互链，暂不升级为正式问题。

## 第二轮工具与验证边界

本轮执行了：

- App、Feature Hook、Router、Zustand Store、Page 与 Widget 的字段级消费者追踪；
- 所有 `useEffect/useLayoutEffect`、Timer、Observer、Event Listener、Object URL 与异步 Clipboard 链路的静态生命周期核验；
- Session、Card、Resources、Prompt Preview、Provider Settings 与 Layout 状态的完整上游/下游调用链检查；
- 对 Latest-Wins、Mutation Queue、持久化 Store 与局部 UI State 的反向验证，排除仅因 Ref/State 并存产生的误报。

第二轮仍未安装依赖，也未执行 Build、Lint、测试、浏览器操作或 React Profiler。当前保留为 `Open / Confirmed` 的纯前端项目均有静态可达触发链；所有 `Deferred` 条目不再视为当前确认缺陷，候选 C 也不再安排 Profiler，直到 Card Resources 范围重新开放。

## 第三轮排除项

以下大文件或抽象经过职责核验后应当保留，不因行数或文件数量继续拆分：

- `code-mirror-editor.tsx` 虽有 397 行，但 Theme、Extension、Change Tracking 与 React Lifecycle 共同构成单一 CodeMirror Adapter；Compartment 与 Callback Ref 都有明确动态 Props 用途。Change Tracking 已拆为纯函数并有测试；移动 Theme 只属于可读性选择，不是审计缺陷；
- `context-menu.tsx` 与 `use-context-menu-trigger.ts` 已分别承担 Portal/Focus/Position/Dismiss 和 Mouse/Keyboard/Long Press，Listener 与 Timer 有对称清理；
- `dialog.tsx` 以原生 `<dialog>` 统一 Top Layer、Cancel、Backdrop 与 Focus Restore，模型 Helper 用于纯测试，不是无收益 Wrapper；
- `long-text-editor-model.ts` 的小 Reducer 同时约束 Copy、Clear、Undo 与两个 Timer 状态，并有直接测试；
- `markdown-preview.tsx` 虽然很短，但承担 Lazy Chunk 边界，不属于无意义透传组件；
- `file-tree.tsx` 的递归、DND、Context Menu、Keyboard 和 Row Slot 当前共同服务同一个 Tree Row 交互。除条目 4、30 外，没有证据支持继续拆文件；
- `CharacterCard`、`GroupSheet`、`DeleteConfirmation` 已是合理的文件内 UI 单元；问题是父级装配和状态所有权，不是这些子组件存在；
- `character-gallery-store.ts` 的 Persisted Groups/Assignments、Transient Sheet State、Sanitize 与 Safe Storage 边界明确；
- Character Media 的 Avatar/Background Handler 存在相似代码，但不同 DOM 事件与 Stop Propagation 行为真实，不建立通用 Handler Factory；
- `studio-page.module.scss` 和 `log-viewer.module.scss` 虽然超过建议行数，但规则区块与组件状态矩阵相符。样式应随组件职责自然迁移，不单独为了行数拆文件；
- `StudioPanelStage` 的 Visited 延迟挂载与 Inactive Memo 有明确性能目的；`window-resize.ts` 是有独立测试价值的纯算法，不应内联回 Page；
- `LogRecordRow` 与递归 JSON Renderer 当前只服务日志展示，职责集中；先迁出日志数据流，不进行二次过度拆分。

## 第三轮工具与验证边界

本轮执行了：

- 大文件的 State、Ref、Effect、内部组件、Helper 与样式区块职责统计；
- Gallery/Profile、Shell/Rail/Resize、Log Feed/Presentation、Shared UI Contract 的消费者和生命周期追踪；
- 重复 JSX、重复事件绑定、公共 Props 与类型擦除的反向引用核验；
- 对超过 300～400 行文件逐项判断其职责是否具有不同变化原因，而不是用行数直接定性。

本轮仍未安装依赖，也未执行 Build、Lint、测试或浏览器视觉验收。第六轮已确认 GroupSheet 采用 Non-modal Drop Palette；Character Selection 是否跨 Group 保留仍属于独立产品决策。其余 `Confirmed` 项均有静态可达的纯前端证据。

## 第四轮排除项

以下 CSS 候选经过级联、DOM 消费和组件边界核验后不作为问题：

- `:global` 均有明确消费者：App 使用稳定 `data-loom-component` 协调 Narrative/Composer 层叠，Long Text Editor 命中 CodeMirror DOM，Markdown 命中高亮器生成的 `tok-*`，Narrative 命中共享 Editor 边界；未发现无目标的全局 Selector；
- 全局 `.loom-divider`、`.loom-page-header`、`.loom-page-tabs` 是刻意的共享 Primitive，并且 Custom CSS 需要稳定覆盖入口，不能仅因不是 Module 删除；
- `additionalData: @use abstracts as *` 只注入 Sass 编译期符号，不会为每个 Module 重复产出 CSS；
- `560/720/760/820` 分别服务 Status Page、Asset 布局和 Studio Shell，不能仅因阈值不统一机械收束；只有候选 E 的宿主宽度错配需要运行态验证；
- `z-index` 已形成 Canvas `5/10`、Navigator `20`、Dock `30`、Group Sheet `50`、Context Menu/Status Page `1000` 的局部层级，Shared Dialog 使用 Native Top Layer；未发现静态可证的冲突；
- 37 处 `overflow: hidden` 与 18 处 `overflow: auto` 多数服务 Grid `min-height: 0`、局部 Scroller、Clipping 与 Sticky；除候选 F 外不批量清理；
- Character Panel 与 Studio Page 的样式应随条目 22、24 的组件职责拆分自然迁移；Log Viewer、Model Panel、FileTree 与 LongTextEditor 主体样式仍内聚，不按 300～400 行阈值单独拆文件；
- 复核动态 Severity Class、第三方 DOM、稳定 Hook 后，仍未发现确认未消费的 CSS Module Class；
- Notification、Dialog、Conversation Mask 与 FileTree Shadow 中少量 `rgb/rgba/#000` 分别表达 Shadow、Backdrop 或 Mask 实现，现有文档不要求每个 Alpha/Mask 色都升级为全局主题 Token，暂不单独立项。

第一轮候选 A 继续保留为 Token Contract Decision。正式文档明确现有全部变量尚未形成永久 SDK，但 Custom CSS 已能覆盖 `--loom-*`；在未决定兼容范围前，九个内部零消费 Token 仍不能仅靠静态搜索删除。

## 第四轮工具与验证边界

本轮执行了：

- 全局 CSS、正式 CSS/Theming 文档、Sass Abstracts 与 Vite 自动注入边界核验；
- 29 个 CSS Modules 的静态 Class、动态 `styles[...]`、`:global`、第三方 DOM 和 Stable Hook 交叉复核；
- Character、Studio Page、Log Viewer、Model Panel、Long Text Editor、Markdown 与 FileTree 大样式文件的规则所有权和重复声明检查；
- `!important`、Hard-coded Color、Transition、Reduced Motion、Breakpoint、Z-index、Overflow、Sticky 与 Scroll Owner 映射；
- 对每个候选执行正向命中与反向级联检查，排除只因数字多、文件大或规则相似产生的误报。

本轮仍未安装依赖，也未执行 Sass/Build/Lint/Test、浏览器布局诊断或人工视觉验收。条目 32、33、35～38 的结构事实可由静态 DOM 与级联关系确认；第六轮已通过反向级联验证否定条目 34。候选 E、F 必须经过客观浏览器诊断后才能升级，当前不参与确定整改排序。

## 第五轮排除项

以下交互、语义或资源候选经过完整生命周期和原生平台合同核验后不作为问题：

- Shared `Dialog` 使用 Native `<dialog>.showModal()`，浏览器负责 Modal Focus Containment；Cancel、Backdrop、Props Close、Unmount 与 Return Focus 路径完整，不需要手写 Focus Trap；
- Context Menu 拥有首个 Enabled Item 初始焦点、Escape/Tab/Home/End/Arrow 循环、ContextMenu/Shift+F10 Trigger、Outside Pointer/Blur/Resize/Scroll Dismiss 与 Return Focus，Listener 和 Long Press/Suppression Timer 均对称清理；
- Studio 非活动 Panel 同时使用 HTML `hidden` 与 `aria-hidden`，Asset Workbench 隐藏 Pane 使用 `visibility: hidden` 和 `pointer-events: none`；未发现隐藏但仍进入 Tab 顺序的控件；
- Window Resize Button 与 Asset Splitter 分别提供 Accessible Name、Keyboard Handler 以及 Separator 的 Value/Orientation 状态，合同完整；
- Chat Composer、Asset Workbench 与 Conversation Navigator 的 ResizeObserver 均 Disconnect；Character IntersectionObserver、Narrative RAF、Studio Keydown 和应用根 Listener 均有对称清理；
- Character Media Object URL 在替换和 Panel Unmount 时 Revoke；删除 Card 后按 Card 清理的缺口继续由条目 19 记录，不在本轮重复立项；
- Log Viewer Poll 的 Interval、Visibility Listener、Disposed 与 Polling Guard 完整；主动 Refresh 的 Request Identity 缺口继续由条目 12 记录；
- Long Text Editor 与 Markdown Code Block 的 Copy/Undo Timer 由 Effect 管理，状态变化和 Unmount 都会清理；
- Character Profile 离场 Timer 与 Provider Copy Timer 的缺口已分别由条目 15、20 完整记录，本轮只确认其仍属于纯前端生命周期问题；
- Studio Rail 的 `aria-expanded/aria-controls` 与真实 Panel ID 对齐，View Mode、Immersive、Gallery Mode、Character Selection 和 Agent Runtime Active 状态已使用 `aria-pressed`；
- 主要表单使用 Native Form/Submit，普通图标 Button 基本具备 Accessible Name；未发现完全依赖 `div onClick` 且没有 Enter/Space 兜底的独立控件。

Context Menu 在 Tab 时关闭并把焦点恢复到 Trigger，而不是继续到页面下一个控件，属于可接受但可讨论的 Menu 退出策略；在没有产品交互要求或用户影响证据前不单独立项。

## 第五轮工具与验证边界

本轮执行了：

- 所有 `role`、`aria-*`、`tabIndex`、Disabled/Busy/Selected/Expanded、Form Label 与 Live Region 的 JSX 消费核验；
- Button、Link、Form、Dialog、Menu、Tree、Navigator、Splitter 与 Window Resize 的键盘事件和焦点路径追踪；
- Timer、Interval、Animation Frame、Observer、Global Listener、Object URL、Clipboard Promise、Portal 与 Microtask 的建立、替换、取消和 Unmount 清理检查；
- 对 Shared Dialog、Context Menu、Long Text Editor、FileTree、Studio Shell、Character Panel、Log Viewer 与 Agent Runtime 执行正向交互链和反向平台能力核验；
- 将条目 12、15、20、23、29 与第四轮条目 37 做根因归并；条目 34 在第六轮被判定为误报，不进入整改。

本轮仍未安装依赖，也未执行 Build/Lint/Test、浏览器键盘诊断、读屏器验收或人工视觉验收。条目 39～41 可由当前 DOM/ARIA/事件结构确认；候选 G 需要产品明确 Escape 合同，H～J 必须经过客观浏览器或读屏器诊断后才能升级。

## 第六轮综合复盘

第六轮没有继续增加问题编号，而是对前五轮执行反向验证、范围校准和共同根因合并。当前没有需要按 P1 紧急处理的纯前端问题；整改重点是可见行为正确性、可访问合同、职责所有权和确定的低风险去冗余。

### 最终状态校准

| 集合 | 数量 | 条目 | 当前处理方式 |
| --- | ---: | --- | --- |
| 可直接进入整改批次 | 29 | 1、4B、5、6、7、12、14、15、19、20、22～33、35～41（排除 34） | 三项实施决策已完成，按共同根因合并实施 |
| 已完成实施前置决策 | 3 | 23、33、39 | Non-modal Group Palette、共享 Markdown 基线、完整 ARIA Tree |
| 当前范围延期 | 12 | 2、3、4A、8～11、13、16～18、候选 C | Session、Card Resources、Projection 或 Asset Workspace 形态稳定后复核 |
| 反向验证后否定 | 2 | 21、34 | 保留审计更正记录，不进入整改 |
| 独立产品/合同决策 | 4 | 候选 A、B、D、G | 不与确定整改混合 |
| 需要浏览器或读屏证据 | 5 | 候选 E、F、H、I、J | 取得客观证据后再决定是否升级 |

关键校准：

- 条目 34 是误报：局部只清除了 Outline，全局 Focus `box-shadow` 仍生效；
- 条目 21 的两个名称表达 Send 与 Preview 两种真实能力，不为了少一行派生强行合并；
- 条目 33 只确认 Markdown 排版重复与漂移，不预设所有排版必须由共享组件拥有；
- 条目 37 只收窄 `transition: all`，不把轻微颜色过渡夸大为必然的 Reduced Motion 缺陷；
- 条目 25 降为随 Studio Shell 拆分处理的 CSS Ownership 债务；
- 条目 4 只保留 FileTree 类型循环，Projection 循环延期；条目 17 整体延期，避免当前重组 Asset Workspace 状态和持久化语义。

### 已确认的三个实施决定

1. **GroupSheet 采用 Non-modal Drop Palette（条目 23）**  
   保留拖卡和背景交互，移除错误的 Modal Role/`aria-modal`，建立非模态焦点进入、Escape 关闭和 Return Focus 合同，不接入阻断式 Shared Dialog。

2. **FileTree 实现完整 ARIA Tree（条目 39）**  
   Treeitem 统一承担焦点和选中状态，补齐 Roving Tabindex、方向键、Home/End、父子导航、展开收起与 Enter/Space；不再考虑降级为普通 List。

3. **Markdown 采用共享基线与宿主差异（条目 33）**  
   共享首尾 Margin、Paragraph/List、Link、Em、Table 和基础 Inline Code；Heading Scale、Surface、Blockquote、Preview Padding 与 Assistant Justify 保留为 Narrative/Preview 的上下文差异。

候选 A、B、D、G 仍是独立决策，但不会阻塞当前七个批次；未触及对应行为时保持现状。

## 统一整改计划

整改按文件热点和共同根因组织为七个主批次。每批独立 Review、独立 Commit、可整体回滚；不把低风险删除、行为修复和大规模组件迁移混进同一提交。

### 批次 1：确定删除与公共表面积收缩

- **实施状态**：Completed on 2026-08-12；20 个生产文件，新增 21 行、删除 80 行。
- **条目**：5、6、7、35、38。
- **目标**：删除未消费 Activation Option、无意义 Export、无消费者 Sass 抽象、重复 Scrollbar Mixin 与等价 CSS 声明。
- **非目标**：不删除仍被内部消费的 Activation Runtime；不建立新 Sass 工具体系；不改变默认滚动条和现有视觉。
- **风险**：低。
- **最小验证**：`rg` 反向引用清零、相关 Diff、Client Typecheck；Sass 文件变化由 Client Build 或最小 Sass 编译覆盖。无需仓库全量测试和浏览器验收，仅对 Narrative/Model 的 Computed Style 做抽查。
- **实际改动**：删除 Activation Option 与其两组孤儿双语 Tag 文案；收窄 12 个文件内部类型的 Export；删除 `$breakpoint-mobile`、空 `_variables.scss` Forward、`flex-center`、`custom-scrollbar` 与 Json Block Include；Json Block 保留真实的 `12px` 滚动条尺寸；清理 Narrative/Model 的等价声明。
- **实施期保护**：`chooseAgentRuntimeProfileId` 与 `normalizeKeywords` 被仓库级单元测试直接导入，已从删除集合移除并保持 Export。
- **依赖环境**：已在当前独立前端 Worktree 执行 `pnpm install --frozen-lockfile`，恢复 18 个 Workspace Project、295 个 Package；Lockfile 未变化，可直接用于后续 Vite HMR。
- **已完成验证**：全仓反向引用、目标符号消费者、级联等价与 `git diff --check`；Studio Client 25 个 Test File / 73 个 Test 全部通过；补充定向集合中 11 个文件 / 31 项通过；注入现有缺失的 `vite/client` 类型后 Client Typecheck 通过；Vite/Sass Production Build 成功，转换 493 个 Module。
- **既有验证限制**：标准 `pnpm --filter @loom-studio/studio-client build` 因 Client `tsconfig` 缺少 Vite 的 `ImportMeta`、CSS Module 与 SVG 类型声明而在 `tsc -b` 阶段失败；仓库级 `tests/unit/client/provider-settings.test.ts` 还引用已不存在的 `model-profile-config.js`。两项均在本批改动之前的配置/测试基线中，不属于批次 1 回归，本批未顺手修复。
- **验收标准**：自动化部分已经满足本批 TypeScript、Sass/Vite 与 Client Test 风险；人工只需在后续 HMR 使用时确认 Inspector Json Block 继续使用 `12px` 滚动条、Dock 其他滚动区保持 `6px`，Narrative Assistant/User 排版及 Model Hint/Warning 视觉未变化。

### 批次 2：Agent Runtime、Provider 与 Active State 接线

- **实施状态**：Completed / Automated verification passed
- **条目**：14、20、37、40，以及条目 41 中各组件自己的 Accessible State。
- **目标**：接通已有 Selected ID；修复 Copy Timer 替换/卸载；收窄 Transition；补齐 Agent 表单 Accessible Name 与可见 Active/Editing 状态。
- **非目标**：不新增第二份 Selected State，不改 Provider/API/Schema，不建立表单、Timer 或 Motion 框架。
- **风险**：低到中。
- **最小验证**：Client Typecheck；Fake Timer 或最小可执行检查覆盖连续复制；浏览器读取 Active Class、`aria-pressed/aria-current`、唯一 Accessible Name 与 LocalStorage 恢复。视觉只确认 Active 样式未改变。
- **实际改动**：把 `selectedAgentRuntimeProfileId` 从 App 接入 Preset Workbench 和 Agent Runtime Manager，恢复 Active Badge、Class 与 `aria-pressed` 的真实状态；为新配置名称、新配置模型及每个已有 Profile 的模型 Select 补齐唯一且本地化的 Accessible Name；Context/Preset 当前导航项使用 `aria-current="page"`，Character Edit 使用 `aria-pressed`；Provider Base URL 复制成功后从最后一次有效请求重新计时，并阻止过期 Promise 或卸载后回调写入状态；Agent Item Transition 收窄为 Border/Background Color。
- **已完成验证**：目标 TS/TSX 与 I18N 文件 ESLint 通过；注入现有缺失的 `vite/client` 类型后 Client Typecheck 通过；Studio Client 25 个 Test File / 73 个 Test 全部通过；Vite/Sass Production Build 成功，转换 493 个 Module；`git diff --check` 通过。
- **验证环境说明**：首次 Client Test 被聚焦 Typecheck 产生的 `apps/studio-client/dist` 重复测试入口干扰，将该产物移出源码树后 25/73 全部通过，不是生产源码失败。标准 Client Build 仍因既有 `tsconfig` 缺失 Vite Type Declaration 而阻塞，不属于本批回归，未顺手修复。
- **人工验收标准**：Preset 切换 Agent Profile 后 Header Badge、Active Class 与 `aria-pressed` 同步，刷新后仍显示当前 Profile；三类 Agent 表单控件在无视觉上下文时有唯一名称；连续复制 Base URL 时 Copied 从最后一次成功复制保持约 1200ms；Context/Preset 当前项和 Character Edit 状态可被辅助技术感知；Agent Item Hover/Active 视觉过渡与之前一致。

### 批次 3：Log Viewer 数据流与交互一次归位

- **实施状态**：Completed / Automated verification passed
- **条目**：1、12、29。
- **目标**：迁出最小 Log Feed Model/Hook；在同一边界实现 Refresh Latest-Wins；把“返回最新”改为不写 URL 的 Button。
- **非目标**：不改日志 API，不引入 Query 框架，不拆 `LogRecordRow`/JSON Renderer，不重写筛选与滚动展示。
- **风险**：中高。
- **最小验证**：扩展 `log-viewer.test.ts`，用可控 Promise 覆盖 Server→Client 与连续 Refresh 乱序、旧 `finally` 不得清 Loading、Poll 增量合并；Client Typecheck。浏览器客观验证 Source、Refresh、Visibility Poll、Unread、Scroll-to-latest，以及 `location.hash/history.length` 不变。
- **实际改动**：新增局部 `useLogFeed` 和 `log-feed-model`，迁入 Server/Client Reader、分页、Cursor、Loading/Error、Visibility Poll 与增量合并；Widget 仍拥有 Source 选择、筛选、滚动、Unread 呈现和 Record/JSON 渲染。Refresh 使用单一 Latest Request Guard，只允许最后一个请求提交数据、错误和 Loading Finish；Source/Active 变更或卸载会立即使旧请求失效。“返回最新”改为 Button，直接调用 `scrollIntoView()` 并恢复 Following/Unread，删除 Widget Hash Anchor。
- **已完成验证**：目标 Feature/Widget 文件 ESLint 通过；注入现有缺失的 `vite/client` 类型后 Client Typecheck 通过；Log Viewer 定向 1 个 Test File / 6 个 Test 通过，其中新增可控 Promise 乱序请求与 Poll Reset/Merge 覆盖；Studio Client 25 个 Test File / 75 个 Test 全部通过；Vite/Sass Production Build 成功，转换 495 个 Module；`git diff --check` 通过。Build 仅有既有的 500 kB Chunk Warning。
- **人工验收标准**：Server/Client 快速切换时内容始终属于最后选中的 Source；连续 Refresh 不会被旧结果覆盖，Loading 不会被旧 `finally` 提前结束；页面隐藏时不 Poll，重新可见后恢复增量读取；离开底部后新日志正确累计 Unread/Severity，返回最新后滚到底部并清空 Unread；该操作前后 `location.hash` 与 `history.length` 不变。

### 批次 4：Shared Markdown 与 Long Text Editor 合同收口

- **实施状态**：Completed / Automated verification passed
- **条目**：31、32、33；条目 38 的 Narrative 部分可随同清理。
- **目标**：恢复 `<em>` 可见强调；收窄 `sourceOnly` Props；只迁移已确认的共享排版基线。
- **非目标**：不新增第二个 Markdown Renderer，不强制统一所有视觉差异，不重写 CodeMirror，不顺带处理候选 H、I、J。
- **风险**：中。
- **最小验证**：现有 Markdown、LongText、Narrative 定向测试与 Client Typecheck；浏览器读取 Narrative/Preview 的 `em` Computed Style，并对 Heading、List、Code、Table 做客观对照。最终排版观感由人工验收。
- **实际改动**：删除全局、Narrative 与 Preview 的 `font-style: normal`，使 Markdown `<em>` 恢复可见斜体强调，同时保留 Muted Color。把首尾 Margin、Paragraph/Dialogue Margin、List Padding、Link、Em、Table 基线与 Inline Code 基线收回 `MarkdownContent`；Narrative 和 Preview 通过两个语义 Custom Property 保留原有 Inline Code Background/Size 差异。Heading Scale、Blockquote、Pre Surface、Preview Padding 和 Narrative Table Overflow 继续归宿主所有。`LongTextEditorProps` 改为轻量判别联合，Narrative `sourceOnly` 调用点删除五个不可达 Preview/Code Wrap 文案。
- **已完成验证**：目标 TSX 文件 ESLint 通过；注入现有缺失的 `vite/client` 类型后 Client Typecheck 通过；Markdown/Long Text/Narrative 定向 5 个 Test File / 13 个 Test 通过；Studio Client 25 个 Test File / 75 个 Test 全部通过；Vite/Sass Production Build 成功，转换 495 个 Module；反向搜索确认目标宿主不再覆盖 `font-style: normal`，Narrative 不再传入不可达 Labels；`git diff --check` 通过。Build 仅有既有的 500 kB Chunk Warning。
- **人工验收标准**：Narrative 和 Long Text Preview 中 `*emphasis*` 显示为可辨识斜体；两个宿主的 Paragraph、List、Link、Inline Code 和 Table 基线与原观感一致；Narrative/Preview 各自的 Heading 尺度、Blockquote、Code Block Surface、Padding 和 Table Overflow 差异仍保留；Narrative 本地编辑仍只显示 Source 模式，Context Asset Editor 仍可正常切换 Source/Preview。

### 批次 5：FileTree 公共合同一次完成

- **条目**：4B、30、36、39。
- **目标**：消除 Model 对组件文件的反向 Type Import；删除无消费者 Props；移除无必要 `!important`；完成已确认的完整 ARIA Tree 合同。
- **非目标**：不泛型化所有 Tree，不重写 DND/Context Menu，不恢复无消费者扩展点。
- **风险**：高。完整 Tree 会同时改变 DOM Role、Tab 顺序和方向键行为。
- **最小验证**：单向 Import 与 Typecheck；为 Visible Order、Arrow/Home/End/Left/Right、Expand/Select 提取最小纯 Model 测试。浏览器检查 `role`、Active Element、`aria-selected` 与 DND Computed Style；拖放手感由人工验收。

### 批次 6：Character UI 按真实生命周期拆分

- **条目**：15、19、22、23、28；条目 41 的 Edit State 随所属组件处理。
- **目标**：让 Gallery、Profile、Media 与 Shared Overlay 各自拥有生命周期；一次解决离场 Timer、Blob URL 清理和 GroupSheet 重复装配，并把 GroupSheet 收口为 Non-modal Drop Palette。
- **非目标**：不改 Session/Branch/Card Resource Schema，不建立 Controller/Service/Factory，不重新设计 Gallery 视觉。
- **风险**：高。
- **最小验证**：扩展 Character 定向测试，Fake Timer 覆盖 A 离场后打开 B；Mock `createObjectURL/revokeObjectURL` 覆盖替换、删除和 Unmount；保留 Gallery Store 测试。完成 TSX/SCSS 迁移后运行一次 Client Build。浏览器客观验证切换、粘贴/拖放和最终 GroupSheet 合同；动画与手感由人工验收。

### 批次 7：Studio Shell、Rail 与 Resize 收口

- **条目**：24、25、26、27。条目 17 保持延期，不在本批重组 Asset Workspace Store。
- **目标**：保留 `StudioPage` 作为组合器，提取局部 Rail、Panel Host 与 Window Resize 生命周期；在同批移除 Shell 对未知 Widget 的裸元素样式穿透。
- **非目标**：不改 Asset Selection、Session、Card、Schema；不建立通用 Dock Framework；不改变 URL→Panel 单向初始化；不删除现有 `window-resize.ts` 纯算法；不顺带实现候选 E、F、G。
- **风险**：高。
- **最小验证**：现有 `window-resize.test.ts`、相关 Layout Store 测试与 Client Typecheck；完成 TSX/SCSS 文件迁移后运行一次 Client Build。浏览器客观验证 Rail ARIA、Panel Hidden/Lazy Mount、三方向 Pointer/Keyboard Resize、持久化恢复和 Widget Computed Font；Dock 密度与窄屏观感由人工验收。

## 证据门槛与统一验收

候选 E、F、H、I、J 不进入上述批次，先分别完成：

- E：在 `721～820px` 读取 Dock/Panes Bounds、`scrollWidth/clientWidth`；
- F：逐 Panel 读取全部可滚动祖先、`scrollHeight/clientHeight` 与 Sticky 行为；
- H：每次方向键后对比 `document.activeElement`、`aria-current`，覆盖长列表节点卸载；
- I：使用可控 Clipboard Stub 交叉完成 A/B Promise；
- J：用目标读屏器验证 Copy 成功/失败和 Search 空结果/数量是否可感知。

验证强度按风险匹配：

- 纯删除、Export/Props 收窄、ARIA 属性、Timer Guard 和简单 CSS 不默认跑完整 Build；
- Character、Studio Shell 与完整 FileTree 重构在模块/SCSS 迁移后各运行一次 Client Build；
- 当前没有任何批次默认需要根目录全量 Test 或全仓 Build；只有跨包公共导出、入口、Vite 配置或发布验收变化时才升级；
- 自动化通过、客观浏览器诊断、读屏器结果和人工视觉验收必须分开记录，未执行项不得描述为通过。

## 下一步

三个实施前置决策和批次 1 已完成。下一步进入批次 2：Agent Runtime、Provider 与 Active State 接线；Character 与 Studio Shell 两个高风险批次仍放在 Shared Contract 和局部行为稳定之后。
