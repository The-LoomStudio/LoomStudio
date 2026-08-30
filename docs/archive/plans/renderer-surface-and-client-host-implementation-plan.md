# Renderer Surface 与 Client Extension Host 实施计划

> **状态**：Archived / Phase 0—6 Implemented
>
> **日期**：2026-08-28
>
> **目标**：把现有 Host-owned Renderer Registry 从静态 Artifact Preview 扩展为正式的 Client Renderer Contribution、Surface 冲突仲裁与动态实例生命周期；优先跑通最小官方 Renderer，再接入 Client Extension Module。
>
> **后续目标**：在 Renderer 基建之上补充最小 Human Action Contribution，让 Extension 使用同一个 Client Command 注册行为，再由 Host 将其投影到 Context Menu、Toolbar、Sidebar、Quick Action 或 Command Palette。
>
> **设计来源**：消息内 DisplayPart、Node Render Mount 与持久化边界见 [`../../workbench/discussion/application/ui/narrative-inline-rendering-and-render-mount-v0.md`](../../workbench/discussion/application/ui/narrative-inline-rendering-and-render-mount-v0.md)。

## 1. 实施前基线

以下是计划启动时由代码与 Architecture 确认的基线，用于解释本轮为何需要建设 Renderer Host：

- `RendererDefinition` 已存在，但只支持 `message.inline | studio.sidebar | studio.panel`、`inline | panel | iframe`；
- 当前只有内置 `official/json-artifact` Renderer；
- 当前 iframe 只是 Host 生成的转义文本 Preview，不是第三方 Client Renderer Host；
- `ArtifactSlotHost` 能按 Artifact Type 选择 Renderer，但没有 Extension 注册、Scope Instance、冲突仲裁或动态卸载；
- Extension 已采用 Package / Module / Instance 三层模型；
- Server Module Host、Package Catalog、Client Module desired state 与 Extension Catalog SSE 已存在；
- Client Extension Host、Client Module 加载、UI Runtime Adapter 与正式 Panel Registry 尚未实现；
- Studio 已有 Host-owned Workspace Panel、沉浸模式、资源 List / Detail 容器和窗口尺寸管理，应优先复用，不能另造平行 Shell。

因此本计划不是从零建设 Renderer，也不重写 Extension 数据层。它补齐的是：

```text
Renderer Contribution Registration
  -> Surface Conflict Resolution
  -> Desired Renderer Instances
  -> Host-owned Mount / Update / Dispose
```

## 2. 核心决策

### 2.1 Surface 不是 DOM 插入权限

Extension 在同源 Direct 环境中可以自行操作 DOM，但这种做法不构成正式平台合同。

正式 Surface 必须至少由 Host 提供以下一项能力：

- 稳定的语义位置；
- Scope 与生命周期管理；
- 多 Contribution 冲突仲裁；
- 响应式、焦点、滚动或可访问性处理；
- 隔离容器与 stacking context；
- Renderer Context、Data Source、Action 和 Diagnostic。

如果一个所谓挂载点只提供空 `<div>`，Host 不管理任何上述能力，则不建立该 Surface。

Direct DOM 操作保留为不受支持的 escape hatch：Host 不保证选择器、层级和生命周期兼容，也不能把它描述成安全边界。真正的强隔离只能由 iframe、Worker 或独立页面提供。

### 2.2 注册与实例化分离

静态或运行时注册只表达“这个 Module 能在某个 Surface 提供 Renderer”。它不会直接创建 DOM：

```text
Contribution Registration
  packageId + moduleId + contributionId
  surface + scope + presentation metadata

Runtime Activation
  active Studio scope + open surface + enabled module
  -> desired renderer instance
```

Host 根据以下交集计算当前实例：

```text
Registered Contributions
  x Enabled Client Modules
  x Active Timeline / Agent Session / Workspace Scope
  x Open or Visible Surfaces
  = Desired Renderer Instances
```

每个实例获得稳定 Identity、当前 Scope、`AbortSignal` 和 disposer。Extension disable、reload、Scope 失效或 Surface 关闭时，Host 必须释放实例。

### 2.3 Surface 按冲突模型分类

第一版只保留四种冲突模型：

| 冲突模型 | Surface 示例 | Host 行为 |
|---|---|---|
| Collection | `narrative.entry.inline`、`narrative.timeline.tail`、`agent.message.inline`、`agent.session.tail` | 多实例共存，由 Host 确定排序和边界 |
| Exclusive | `shell.background`、`composer.sheet`、`shell.focus-surface` | 每个有效 Scope 同时最多一个 Active Instance |
| Navigation | `shell.workspace-panel`、`standalone.page` | 可注册多个入口；每个容器当前只展示一个页面 |
| Anchored Projection | Node 内 Render Mount | 按 Node、Anchor 与稳定 Mount Key 定位和去重 |

`HUD`、`Header`、`Sidebar` 不是第一版 Surface 名称。用途由 Extension 自己决定；Host 只承诺语义所有者与空间位置。

### 2.4 第一版正式 Surface

```text
narrative.entry.inline
narrative.timeline.tail

agent.message.inline
agent.session.tail

composer.sheet
shell.background
shell.workspace-panel
shell.focus-surface
standalone.page
```

边界：

- `shell.background` 是 Studio Stage 最底层的单一 Workspace Surface，覆盖完整应用内容区而不依赖 Narrative Timeline；默认无交互、不可聚焦；第一版不做 Background Layer Stack；
- `narrative.timeline.tail` 与 `agent.session.tail` 是消息列表末尾的真实 Host Container，不是 Node / Message，不参与楼层、Depth、Prompt Build、复制或导出；
- `composer.sheet` 锚定输入面板并向上展开；桌面端为 Sheet，移动端可以降级为 Bottom Sheet 或全屏；
- `shell.workspace-panel` 复用现有 Studio Panel Host、Rail 和资源工作台布局，不创建第二套 Extension Shell；
- `shell.focus-surface` 是 Host 管理的沉浸 / 全屏展示请求，不是 Extension 自行创建的全局 Portal；
- `standalone.page` 表示独立页面能力，不绑定某个浏览器一定使用 tab 还是 window。

### 2.5 Renderer 与 Human Action Contribution 分离

Context Menu、Toolbar、Sidebar、Quick Action 和 Command Palette 不是 Renderer Surface。它们是 Host-owned 原生控件对同一个 Client Command 的不同投影：

```text
Client Command
  -> Context Menu Placement
  -> Toolbar Placement
  -> Sidebar Placement
  -> Quick Action Placement
  -> Command Palette Placement
```

Manifest 声明 Command 元数据与 Action Placement，因此 Catalog、Workbench 和原生入口不需要先执行 Extension 代码就能解释其能力。Client Module 激活后只为自己声明的 Command 注册执行 Handler；用户触发入口时，Host 按需激活 Module、解析 Handler，并传入受控的 Invocation Context。打开一个 Renderer Panel 也只是普通 Client Command 的一种实现，不建立专用按钮协议。

Client Command 必须与以下概念区分：

- Kernel Event 描述已经发生的平台事实，是广播而不是有目标的用户操作；
- Application Query / Command 是服务端领域能力，不等于 Client Extension 的按钮注册表；
- Renderer Contribution 提供持续存在的自定义 UI Instance，不承担原生按钮和菜单布局。

第一版合同只保留必要字段：

```ts
type ClientCommandDeclaration = {
  id: string
  title: string
  icon?: HostIconName
}

type ClientActionPlacement = {
  commandId: string
  surface: ClientActionSurface
  group?: string
  suggestedOrder?: number
  when?: ClientActionCondition
}

type ClientCommandHandler = (
  context: ClientCommandInvocationContext,
) => void | Promise<void>
```

Manifest 使用 `modules[].contributes.commands` 与 `modules[].contributes.actions` 保存上述声明；运行时使用 `ctx.commands.register(commandId, handler)` 绑定实现。运行时不得新增 Manifest 未声明的 Command 或 Placement。声明缺少 Handler、重复注册、跨 Module 引用或 Handler 在执行前被卸载都必须产生可解释 Diagnostic，而不是让入口静默失效。

Host 负责实际按钮或菜单的样式、Tooltip、键盘导航、移动端降级、排序、折叠、启用状态、错误反馈和 Extension 卸载清理。Extension 不注入 JSX、HTML、任意 SVG、CSS 或原始 DOM Event；图标首版只引用 Host 图标集合。Invocation Context 只暴露当前 Workspace、Timeline、Node、Agent Session、Message、选中文本与来源 Surface 等稳定业务身份。

`when` 首版只覆盖有真实入口需求的少量结构化条件，不提前建设完整表达式语言。低频或复杂交互默认进入 Context Menu 或 Extension 自己的 Panel；原生 Toolbar 只开放少量语义位置并限制 Contribution 数量。

## 3. 冲突与排序合同

### 3.1 Collection Surface

多个 Extension 可以同时贡献 Tail 或 Inline Renderer。Host 为每个实例提供独立 Root：

```text
Timeline Tail Host
  -> Extension A Root
  -> Extension B Root
  -> Extension C Root
```

第一版排序规则：

```text
user override order
  -> author suggested default order
  -> packageId + moduleId + contributionId stable tie-break
```

注册和异步激活顺序不能决定最终 UI 顺序。作者建议顺序不是全局抢占权；用户顺序拥有最终决定权。

每个 Contribution 在同一 Instance Scope 默认最多一个 Root。需要重复项时，由 Extension 在自己的 Root 内渲染列表，或使用 Node-bound Anchored Projection，不能通过重复注册制造不受控实例。

### 3.2 Exclusive Surface

Background、Composer Sheet 与 Focus Surface 每个有效 Scope 同时只允许一个 Active Instance。

第一版不实现自动排队或隐式抢占：

- Surface 空闲：打开；
- 已被占用：返回 typed occupied result；
- 用户明确选择替换：Host 先关闭旧实例，再打开新实例；
- Extension disable / reload：Host 强制释放自己持有的实例。

`shell.focus-surface` 由 Host 负责 Portal、焦点锁定、Escape 退出、返回焦点和系统层级。系统 Modal、Permission、Notification 与 Composer 紧急状态始终高于 Extension Focus Surface。

### 3.3 Navigation Surface

多个 Extension 可以注册 Workspace Panel 或 Standalone Page 入口。注册入口不等于立即激活代码：

- Extension Workbench 可以仅凭 Manifest Metadata 展示入口；
- 用户打开 View 时再激活对应 Client Module；
- Workspace Panel 隐藏后第一版保留已访问实例，和当前 Studio Panel 行为一致；
- Extension disable、reload、Studio 页面卸载时必须 dispose；
- Standalone Page 通过 Renderer Session 连接，Host revoke 后页面进入断开状态；不承诺强制关闭浏览器标签页。

### 3.4 Host Container 边界

每个 Host Container 建立独立 stacking context，例如 `isolation: isolate`。Extension 可以在自己的 Root 内使用 `z-index`，但不能参与 Studio 全局层级竞争。

Direct / Shadow DOM 只能提供逻辑和样式边界，不能构成恶意代码隔离。需要强隔离或重型自定义页面时使用 sandbox iframe 或 Standalone Page。

## 4. 最小 Renderer 合同方向

Phase 0 只固定必要字段，不提前设计完整 SDK：

```ts
type RendererContributionDefinition = {
  id: string
  name: string
  surface: RendererSurface
  instanceScope: 'workspace' | 'timeline' | 'agent-session' | 'node' | 'message'
  suggestedOrder?: number
}

type RendererInstanceIdentity = {
  packageId: string
  moduleId: string
  contributionId: string
  scopeKey: string
}
```

运行时至少需要：

```text
mount(root, context)
update(context)
dispose()
context.signal
```

具体 Direct、Shadow DOM、iframe 和 Standalone Adapter 不进入 Definition 的用途分类；它们是 Host 承载与隔离策略。Extension 不需要声明自己是“HUD 插件”“状态栏插件”或“文生图插件”。

Renderer 不直接获得 Kernel、SQL、内部 Store 或全局 DOM。持久修改继续通过 typed Application Capability、Extension RPC、State Mutation、Agent Input 或 Job 完成。

## 5. 动态加载与卸载

生命周期分为三层：

```text
Client Module Code
  -> Contribution Registration
       -> Renderer UI Instance
```

- 关闭一个 Renderer Instance 不必卸载整个 Client Module Code；
- Module reload 必须 dispose 该 Module 的全部 Contribution 与 Instance；
- Scope 切换只销毁失效 Scope 的实例；
- Tail 随 Timeline 或 Session Scope 激活；Shell Background 随 Workspace 生命周期存在；
- Workspace Panel 隐藏时保留实例，禁用或 reload 时销毁；
- Focus Surface 关闭时销毁该 View Instance；
- 所有异步 Data Source、事件订阅和任务必须响应 `AbortSignal`。

Host 以稳定 Instance Identity 做差分，不依赖 React 组件偶然 mount 次数或 Extension 自己扫描 DOM。

## 6. 分阶段实施

### Phase 0：合同、冲突解析与兼容迁移（已完成）

目标：先把 Surface、Identity、Scope 与 Conflict Policy 固定为可测试的纯合同，不加载第三方代码。

任务：

1. 将现有 `RendererDefinition` 演进为统一 Renderer Contribution 合同，不保留平行 Registry；
2. 固定第一版 Surface Union 与四类 Conflict Policy；
3. 实现纯函数式 Collection 排序、Exclusive 占用和稳定 Instance Key；
4. 保留 `official/json-artifact` 的兼容投影，不中断现有 Text Transform Workbench；
5. 为非法 Surface、重复 ID、Scope 不匹配和 Exclusive 冲突生成 Diagnostic。

验收：相同注册集合与用户顺序得到确定结果；异步注册顺序不改变结果；Exclusive 冲突不会隐式覆盖现有实例。

### Phase 1：Host-owned Surface Coordinator 与官方 Fake Renderer（已完成）

目标：不接 Extension 动态代码，先证明 Host 能正确管理多实例、独占实例和导航实例。

任务：

1. 实现统一 Surface Registry 与 Desired Instance Coordinator；
2. 在现有 Narrative / Agent UI 中接入 `timeline.tail` 与 `session.tail` Host Container；
3. 复用现有 Studio Panel Host 接入一个官方 Fake Workspace Panel；
4. 接入一个官方 Fake Focus Surface，验证打开、占用、替换、Escape 与焦点恢复；
5. 实现 mount / update / dispose、AbortSignal 与 Instance Diagnostic；
6. Host Container 建立独立 stacking context。

验收：两个 Fake Tail Renderer 可以稳定排序并同时显示；切换 Scope 后旧实例释放；两个 Focus 请求不会重叠；Panel 隐藏后状态保留、禁用后释放。

### Phase 2：Client Extension Module Host 与 Renderer 注册（已完成）

目标：让已启用的 Client Module 能通过正式 Context 注册 Renderer Contribution。

任务：

1. 为 Catalog 中的 Client Module 提供受控 Entry URL，不向浏览器暴露物理目录；
2. 实现 Client Module discover、load、activate、reload 与 dispose；
3. 提供最小 `ctx.renderers.register()`、Logger、Diagnostic、Identity 与 `AbortSignal`；
4. 消费 Extension Catalog SSE，在 enabled / disabled / reloaded 后刷新权威快照；
5. Module 激活失败只降级该 Module，不阻塞 Studio Shell；
6. 用一个仓库内 Test Extension 注册 Tail、Panel 与 Focus Contribution。

验收：启用 Client Module 后出现入口并可挂载；reload 不留下重复 Root、事件监听或旧实例；禁用后 Contribution 和 UI 全部消失。

### Phase 3：Data Source、Action 与 Node Render Mount 接缝（已完成）

目标：让 Renderer 消费正式 Projection 和 Extension-owned Record，而不是自行读取 Host DOM。

任务：

1. 向实例提供当前 Workspace / Timeline / Session / Node / Message Scope Context；
2. 接入 State、Text Projection、Extension Record 与 Asset 的受控订阅；
3. 接入 Node-bound Extension Record 到 Render Mount / DisplayPart 的消息内主链；
4. Renderer Action 只通过 typed Capability / RPC 发起，不直接修改 canonical data；
5. 对失效 Anchor、缺失 Asset、无权限 Data Source 生成安全 Fallback 与 Diagnostic。

验收：文生图 Test Extension 可以把 Node-bound Record 动态投影到消息内，并在 Record / Asset 更新后重建显示；不修改 Narrative 原文，不注册一次性 Regex Rule。

### Phase 4：其余 Surface 与隔离 Adapter（已完成）

目标：在主链稳定后补充真实使用价值已经明确的 Surface 与承载方式。

任务：

1. 接入 `shell.background`、`composer.sheet` 与正式 `shell.focus-surface`；
2. 接入 Shadow DOM 与 sandbox iframe Adapter；
3. 建立 Standalone Page Renderer Session、revoke 与断线状态；
4. 实现尺寸、焦点、可访问性、主题 Token 和移动端降级合同；
5. 不建立 Background Stack、任意 Sidebar 或全局 HUD。

验收：同一 Scope 不会同时出现两个 Background / Sheet / Focus Instance；iframe CSS 与异常不影响 Host；Renderer Session revoke 后独立页面停止获得数据。

### Phase 5：Extension Workbench 与诊断（已完成）

目标：让用户能看见 Extension 提供了什么、当前为什么显示或没有显示。

任务：

1. 在现有 Extension Workbench List / Detail 中展示 Renderer Contributions；
2. 展示 Surface、Scope、当前实例、来源、启用状态、占用与 Diagnostic；
3. 为 Collection Surface 提供用户排序；
4. 为 Exclusive Surface 提供当前占用者和显式替换入口；
5. 提供最小 Renderer 开发日志与 reload 操作。

验收：用户可以从 UI 解释一个 Renderer 的注册、激活、排序、占用和卸载状态；排序修改后不需要重装 Extension。

### Phase 6：Client Command 与 Human Action Placement（已完成）

目标：让 Extension 将同一个面向用户的行为投影到多个 Host-owned 原生入口，不把 Context Menu、Toolbar、Sidebar Button 或 Quick Action 错建成 Renderer Surface，也不引入跨领域通用 Command Bus。

任务：

1. 在 Client Module Manifest 的 `contributes` 中增加静态 `commands` 与 `actions` 声明，让 Catalog 和 Workbench 在 Module 激活前即可展示能力；
2. 在 Client Extension Host 中增加随 Module 生命周期注册和释放的 `ctx.commands.register(commandId, handler)`；Host 只接受当前 Module Manifest 已声明的 Command；
3. Action Placement 只来自 Manifest 并引用同一 Module 声明的 Command；Host 校验 Surface、Command ownership、重复 ID 与数量上限，不提供运行时 `ctx.actions.contribute()`；
4. 首批只接入已经存在真实 Host Container 的入口，不为了合同预建空 Toolbar 或 Command Palette；
5. 用户触发声明入口时，Host 按需激活对应 Module；Module 未注册 Handler、激活失败或已被禁用时返回明确失败状态；
6. Host 在调用时构造 typed Invocation Context，不暴露原始 DOM Event、内部 Store 或整套 Studio API；
7. 同一个 Command 可被多个 Placement 引用；打开 Workspace Panel、Composer Sheet、Focus Surface 或 Standalone Page 继续调用现有 Renderer API，不建立专用打开协议；
8. Host 统一处理图标、标题、Tooltip、可访问性、排序、移动端降级、pending / disabled / error 状态和 Extension unload 清理；
9. 在 Extension Workbench 分别展示 Manifest Declaration、Runtime Handler 注册状态与 Diagnostic；
10. 用最小 Test Extension 验证普通操作与打开 Renderer Panel 两类 Command。

首批 `ClientActionSurface` 只从以下候选中选择有现成 UI 所有者的最小集合：

```text
narrative.node.context-menu
agent.message.context-menu
narrative.toolbar
composer.quick-actions
shell.sidebar
extension.workbench.actions
workspace.command-palette
```

候选名称不等于第一轮全部实现。没有稳定 Host Container、业务 Context 或冲突规则的入口继续保持未开放。

验收：未激活 Module 的 Command 与 Placement 仍可从 Catalog / Workbench 被解释；一个 Command 可以同时出现在两个已接入入口，并分别收到正确的 `sourceSurface` 与当前业务身份；首次触发可以按需激活 Module 并解析 Handler；执行失败只产生该 Command 的错误反馈和 Diagnostic；Module disable 后入口不可执行，reload 时 Manifest 声明保持而旧 Handler 被释放并重新注册；打开 Renderer Panel 不需要第二套按钮执行机制。

### 实施结果与真实扩展验证

当前实现已经接通：

- Client Module discover、同源 Entry 加载、activate、disable、reload、abort 与 dispose；
- 九种正式 Surface、四类冲突策略、稳定 Contribution / Instance Identity；
- Direct、Shadow DOM、sandbox iframe 与 Standalone Renderer Session；
- Workspace / Timeline / Agent Session Scope、Tail、Shell Background、Composer Sheet、Workspace Panel 与 Focus Surface；
- Package-owned Record、State、History、Package namespace RPC、Asset / Package File URL；
- Narrative Node / Agent Message Render Mount 与 Projection Diagnostic；
- Extension Workbench 的 Package / Module / Contribution / Instance / Claim / 排序 / Diagnostic 视图。
- Manifest `commands` / `actions`、`ctx.commands.register()`、Command-only Module 按需激活与 typed execution failure；
- `composer.quick-actions` 与 `extension.workbench.actions` 两个 Host-owned Action Surface；
- Workbench 的 Command Declaration、Placement、Handler 注册状态与执行入口。

忽略目录 `.loomstudio-dev/test-extensions/renderer-background-demo/` 中的真实测试扩展使用固定 Unsplash CDN 图片注册了 `shell.background`、`shell.workspace-panel` 和 `toggle-background` Command；同一 Command 被投影到 Composer Quick Actions 与 Extension Workbench。扩展仍通过 Direct DOM escape hatch 把 Narrative 消息容器改为毛玻璃。自动测试证明了安装、启用、受控 Entry URL、Declaration、Handler 生命周期与按需激活合同；在线图片、下拉菜单和最终视觉效果仍属于人工验收边界。

测试扩展暴露但本轮不继续扩建的议题：

- Host Appearance / Style Contribution；
- Client Config 读写；
- 第三方网络权限、隐私与加载失败合同；
- Background 与消息前景样式的语义联动；
- Collection 用户排序持久化；
- `match-ref` / `marker` Anchor 的正式数据源。

真实开发环境接入阶段还发现并修复了三项实现缺陷：Vite 缺少 `/extensions` 代理、Extension File Route 未剥离 dynamic import query string，以及成功重试后旧 `activation_failed` Diagnostic 未清理。这些属于现有合同的正确性修复，不扩展 Renderer Surface 或插件能力范围。

## 7. 最小验证矩阵

| 风险 | 最小自动证据 | 不替代的验收 |
|---|---|---|
| Collection 顺序 | Conflict Resolver 单元测试 | 不等于实际布局观感 |
| Exclusive 冲突 | 占用、拒绝、显式替换测试 | 不等于完整交互手感 |
| Scope 生命周期 | Timeline / Session 切换组件测试 | 不等于长时间运行无泄漏 |
| Module reload | 注册、Abort、dispose 集成测试 | 不等于不可信代码隔离 |
| iframe 隔离 | CSS / Exception smoke | 不等于浏览器安全审计 |
| Node Render Mount | Record / Asset 更新投影测试 | 不等于复杂 Anchor 均可靠 |
| Command / Action | Manifest 校验、惰性激活、双 Placement、reload / disable Handler 清理测试 | 不等于实际菜单点击与操作反馈手感 |
| 响应式与焦点 | DOM、ARIA、Focus Trap 测试 | 仍需人工视觉与键盘验收 |

## 8. 明确非目标

本轮不实施：

- 阻止同源受信任 Extension 使用原生 DOM API；
- 不可信 Client JavaScript 的完整安全沙箱；
- 任意 HUD、Header、Sidebar、Toolbar Renderer；
- 接管原生 Narrative 消息列表的 `narrative.viewport` Replacement Surface；仅改变背景或前景样式继续使用现有 Renderer / 后续 Style Contribution，彻底重做阅读交互优先使用 `standalone.page`；
- Background Layer Stack；
- Exclusive Surface 自动排队、优先级抢占或复杂调度；
- 通用 UI DSL；
- 把 DisplayPart、Renderer DOM 或 View State 写进 Narrative 正文；
- 为文生图、记忆、商店或状态栏建立 Core 专用 Schema；
- 用注册顺序、激活时序或全局 `z-index` 解决冲突。

## 9. 完成定义

Phase 0—5 完成后，Client Renderer 基建满足：

1. Renderer 使用统一 Contribution 合同、Surface、Scope 与 Instance Identity；Client Extension 使用一个运行时 Registry，内置 JSON Artifact Catalog 保留为兼容投影；
2. Tail 多实例由 Host 稳定排序，不互相覆盖；
3. Focus Surface 同一 Scope 只存在一个 Active Instance；
4. Workspace Panel 复用现有 Studio Shell，并按需激活 Client Module；
5. Extension disable / reload / Scope 切换会释放对应实例和订阅；
6. Client Module 可以通过正式 Context 注册 Renderer，不需要扫描或修改 Host DOM；
7. 注册失败、Surface 冲突和实例异常都有 Diagnostic；
8. Data commit 能使 Renderer Projection 失效重建；
9. Node-bound Record 可以通过瞬时 Render Mount 进入消息显示，而不修改 Narrative 原文；
10. Direct / Shadow / sandbox iframe / Standalone Adapter 与状态可被 Workbench 解释；
11. 现有 JSON Artifact Renderer 与 Text Transform Workbench 不回归；
12. 一个位于 Git 忽略开发目录的真实背景扩展可以完成安装、启用与 Contribution 暴露；其源码覆盖挂载、更新、关闭与 reload 清理路径，浏览器运行验收另行完成。

这一定义不包含不可信 Client JavaScript 沙箱、通用 CSS 注入、Client Config mutation、第三方网络权限或 Narrative Attachment。它们只有在真实需求证明后才进入下一份计划。

Phase 6 当前已满足：Client Command 与 Placement 分离；一个 Command 可被多个 Host 入口复用；Invocation Context 只包含稳定业务身份；Host 拥有控件呈现和生命周期；Extension 不能通过 Action Placement 注入任意 UI。

## 10. 最终审计（2026-08-29）

已通过：

- Renderer / Extension 定向测试：10 个文件、28 项；
- Phase 6 Command / Action 定向测试：4 个文件、20 项；
- 忽略目录真实测试扩展：1 个安装与 Catalog 集成测试；
- 测试扩展入口 `node --check`；
- Extension SDK 与 Extension Host `tsc -b`；
- Application Runtime 与 Studio Server `tsc -b`；
- Studio Client `tsc -b` 与 Vite production build；
- 本轮 Renderer / Extension 文件的定向 ESLint；
- `git diff --check`；
- 文档内部路径、大小写和 Anchor 检查：260 个 Markdown 文件通过。

环境外或非本轮阻塞：

- 完整 `pnpm check:docs` 的 lifecycle 阶段被其他工作区文件 `docs/workbench/reference/ecosystem-audit-improvement-summary.md` 缺少 Status 阻塞；本轮新增链接检查已通过；
- 未启动浏览器，因此 Composer Quick Actions 下拉菜单、Workbench Command 按钮、Unsplash 在线加载、毛玻璃视觉效果、Focus 键盘手感、iframe / Standalone 浏览器级隔离与响应式观感仍需人工验收。
