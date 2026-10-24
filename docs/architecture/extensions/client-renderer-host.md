# Client Extension Host 与 Renderer Surface

> 状态：Extension Host 与 Loom Script Sandbox 已实现；2026-09-24 补充共享 iframe 基建与受控通知桥。

本文记录 Studio Client 当前已经落地的 Client Extension Module、Loom Script Renderer、Surface 仲裁、实例生命周期与消息内 Render Mount。`runtime: 'client'` 的 Extension Module 仍是受信任同源代码；`client-worker` 通过 Dedicated Worker 与能力桥执行，不直接访问 DOM，也不提供强权限沙箱。不可信单文件 Renderer 使用独立 Loom Script Sandbox，Worker 与脚本合同见 [`loom-script-runtime.md`](loom-script-runtime.md)。

实现入口：

- [`packages/extension-sdk/src/index.ts`](../../../packages/extension-sdk/src/index.ts)
- [`apps/studio-client/src/features/extension-renderers/`](../../../apps/studio-client/src/features/extension-renderers/)
- [`apps/studio-server/src/extensions/extension-manager.ts`](../../../apps/studio-server/src/extensions/extension-manager.ts)
- [`apps/studio-server/src/http/http-server.ts`](../../../apps/studio-server/src/http/http-server.ts)

## 1. 加载与身份

Client Module 继续使用 Package / Module / Instance 身份：

```text
Extension Package
  -> Client Module
       -> Client Module Instance
            -> Renderer Contribution
                 -> Renderer UI Instance @ Scope
```

Server Catalog 为已发现的 Client Module 返回受控 `entryUrl`。浏览器从同源 Extension File Route 加载模块，动态导入时附加 Instance cache-buster；Extension disable、reload、版本、Entry 或 UI 权限声明／授权变化会先 abort 并按注册反序 dispose 旧实例，再按当前权威 Catalog 重建。

Client Module 必须导出 `activate(ctx)`。Manifest 中声明的 Renderer 必须在激活期间通过 `ctx.renderers.register()` 注册；Manifest Command 则通过 `ctx.commands.register(commandId, handler)` 绑定执行实现。未声明注册、声明与运行时合同不一致、激活异常都会使该 Module 降级并产生 Diagnostic，而不会阻塞 Studio Shell。

带 Renderer 的启用模块继续提前激活，以便建立 Surface Contribution；只有 Command / Action 的模块保持惰性，首次执行 Action 时才加载。Manifest Declaration 始终由 Catalog 提供，不需要为了显示入口而执行扩展代码。

`runtime: 'client'` Module 当前是受信任的同源 JavaScript。即使某个 Renderer 使用 sandbox iframe，模块本身仍已在 Studio 主页面执行；iframe 只隔离该 Renderer 的 frame 内容，不能把整个 Client Module 描述成不可信代码沙箱。

### 宿主共享前端模块

同文档 Client Module 可直接导入 `react`、`react-dom`、`react-dom/client`、
`react/jsx-runtime`、`react/jsx-dev-runtime` 与 `@loom-studio/ui`。
扩展构建须将这些模块标记为 external，保留 ESM 裸导入，不把框架打进扩展产物。
宿主在 HTML 中提供 import map：开发环境映射到 Vite facade，发布构建映射到共享 chunk，
两者都使用宿主的 React 实例。扩展采用宿主支持的 React API 版本，不能自行选择不同运行时版本。

宿主为所有 Shadow Renderer 复用一份官方 UI 的 constructed stylesheet；扩展只携带自身样式。
原生 DOM 扩展不必依赖 React。iframe 是独立文档，不继承此 import map 或运行时共享合同。
参考 `official/extensions/story-memory/build.mjs` 与
`apps/studio-client/build/extension-shared-modules.ts`。

### Timeline 参与

Manifest 声明 `participation: "timeline"` 的 Client Module 还须通过当前 Timeline 的采用校验。
Catalog 保留该声明；Client Host 将采用记录与实际安装身份、安装版本、包版本及 Card 范围核对，
未采用、暂停、安装缺失或需要显式恢复时不加载模块，也不展示故事 Action / Renderer。
全局模块开关仍是前置条件，故事采用不改写它。

每个活动模块实例获得固定的 `ctx.timeline.target`（Timeline + Branch）。切换目标或采用 generation、
安装版本变化时先 abort 旧实例，再清理并重建；Branch 仍不拥有采用配置。
共享扩展的 `ctx.timeline.target` 为空，不因故事切换重复激活。Focus Surface 仍是 Workspace 容器，
故事模块的注册随实例撤销，不借此增加第二个 Focus Surface 或占用跨故事的实例。

采用与 State 更新复用 `/extensions/events`。数据事件先重新核对当前采用资格，再刷新订阅；
不重新读取全部扩展目录。断线立即撤销故事实例，重连后重新读取权威 Catalog 和采用关系。
页面导航尚未得到同一 Timeline 的有效 Branch 时，不提供故事目标。

## 2. Renderer Contribution 合同

Manifest 与运行时共享 `RendererContributionDefinition`：

```ts
type RendererContributionDefinition = {
  id: string
  name: string
  surface: RendererSurface
  instanceScope: 'workspace' | 'timeline' | 'agent-session' | 'node' | 'message'
  suggestedOrder?: number
  artifactType?: string
  fallback?: 'json' | 'text' | 'hidden'
  adapter?: 'direct' | 'shadow' | 'sandbox-iframe'
}
```

Extension Contribution 的稳定身份为：

```text
packageId / moduleId / contributionId
```

Loom Script Contribution 的稳定身份为：

```text
scriptDocumentId / documentVersion / contributionId
```

UI Instance 再附加 `scopeKey`。注册不等于立即创建 DOM；Host 根据当前 Workspace、Timeline、Agent Session Scope、Surface 可见性和显式占用状态决定实际实例。

Renderer 实例获得：

- 当前 Contribution Identity、Surface 与 typed Scope；
- `AbortSignal` 和 `close()`；
- `compact`、`prefersReducedMotion` 与主题继承提示；
- 可选 `DisplayPart`；
- `mount(root, context)`、可选 `update(context)` 与 disposer。

消息内 `narrative.entry.inline` Renderer 是轻量、可重建的节点视图。正文虚拟化允许消息离屏后卸载，此时 abort signal、执行 disposer，并销毁该实例的 DOM/iframe；重新进入挂载范围时重新投影和 mount，不承诺保留表单输入或媒体播放进度。复杂、长期存活的界面应选择独立 Surface，不能把节点视图作为通用界面容器。编辑中的正文暂时保留挂载；Timeline tail 不属于正文虚拟窗口。正文上下缓冲消息数是客户端外观设置，不等于扩展“仅渲染最近几层”的业务规则。

## 3. Surface 与冲突策略

| Surface | Scope | 冲突策略 | 当前宿主位置 |
|---|---|---|---|
| `shell.background` | Workspace | Exclusive | Studio Stage 最底层，覆盖完整应用内容区 |
| `narrative.entry.inline` | Node | Anchored Projection | Narrative Node 前、后或正文锚点 |
| `narrative.timeline.tail` | Timeline | Collection | Narrative 列表末尾，不是楼层 |
| `agent.message.inline` | Message | Anchored Projection | Agent Message 前、后或正文锚点 |
| `agent.session.tail` | Agent Session | Collection | Agent Transcript 末尾，不是消息 |
| `composer.sheet` | Workspace / Timeline / Agent Session | Exclusive | Composer 上方 Sheet |
| `shell.workspace-panel` | Workspace | Navigation | Studio 现有扩展工作台容器 |
| `shell.focus-surface` | Workspace | Exclusive | Host 管理的 `<dialog>` Focus Surface；当前 App 只挂载 Workspace Scope |
| `standalone.page` | 声明 Scope | Navigation | 新浏览器页面与 Renderer Session |

Collection 排序为：用户内存态顺序 → `suggestedOrder` → 稳定 Contribution Key。当前用户顺序尚未持久化，刷新后恢复作者建议顺序。

Exclusive Surface 不隐式抢占：空闲时允许打开；被其他 Contribution 占用时返回 typed rejection；只有显式 `replace` 才替换。Timeline 或 Agent Session Scope 切换、Module disable / reload 与 Contribution dispose 都会回收旧 Claim 和实例。

Navigation Surface 可以注册多个入口，但同一宿主容器只展示当前选择项。Standalone Page 不承诺强制关闭浏览器页面；Host revoke 后只撤销 Session 数据通道。

## 4. Adapter 边界

当前提供三种 Renderer Mount Adapter：

- `direct`：直接挂载到 Host-owned Root，继承 Studio CSS Token；不是样式或 DOM 隔离；
- `shadow`：Host 创建 open Shadow Root，并注入最小 box-sizing、字体和颜色桥接；提供样式边界，不提供恶意代码隔离；
- `sandbox-iframe`：Host 创建 `sandbox="allow-scripts"` iframe，不授予 `allow-same-origin`。Extension iframe 使用受信任 Client Module 提供的 frame URL；Loom Script 在 srcdoc 内创建 Blob module，使用受限 CSP 与专用 `MessageChannel`。IFrame 不继承父 Document 的 CSS，Host 会随 Context 发送公共 Theme Token Snapshot，并在主题变化时发送 `loom:renderer-theme`。

三条 iframe 渲染路径复用 [`iframe-runtime`](../ui/iframe-runtime.md) 的生命周期、通信或尺寸模块。Extension iframe 后续导航会撤销通道，不重新发送 Context。Loom Script update 绑定到实际 UI Instance；不能把注册级 update 当作 sandbox 实例更新。

每个 Surface Host 建立独立 Root 和 stacking context。Extension 在 Root 外修改宿主 DOM 或注入全局 CSS 属于 Direct DOM escape hatch，不是稳定平台合同，也不享受兼容保证。

## 5. Client Extension Context

Client Module 当前可使用：

```text
ctx.renderers.register/open/close/openStandalone
ctx.commands.register
ctx.records.list/get
ctx.configs.list/get/upsert/subscribe
ctx.timeline.target
ctx.state.get/subscribe
ctx.history.project/extract
ctx.rpc.call
ctx.imports.commit
ctx.assets.url
ctx.files.url
ctx.notifications.show
ctx.logger / ctx.signal / ctx.extension
```

约束：

- Record 读取始终绑定当前 `packageId`；
- Client RPC 只能调用当前 Package namespace；
- State 与 History 通过 Application RPC 读取，不暴露 Store；
- `state.subscribe(target, handler, onError?)` 立即读取一次，后续数据事件和重连触发复核；同一 revision 不重复通知，不承诺逐个历史 revision 投递。失败交给 `onError` 或日志，再次成功可重新投递相同 revision；
- Timeline 实例只能读取/订阅自己的固定目标；目标切换、暂停或释放订阅后忽略迟到结果。State 订阅和 Config 订阅在模块 abort 时解除。宿主不能撤销已开始执行的任意 JS 回调，扩展的异步处理仍须遵守 `ctx.signal`；
- Asset 和 Package File 只获得受控 URL，不获得物理路径；
- Data commit 会产生 `extensions.data.changed` SSE，Client Host 收到后使 Renderer Projection 失效重建；
- Client Config 始终绑定当前 `packageId`，更新使用 Document Version 乐观并发；订阅只在服务端提交成功并产生数据事件后读取新的权威快照；
- 当前没有 Client State mutation、任意 Application RPC 或通用 Event Subscription。
- `notifications.show` 需要 `ui.notify` 声明与用户授权，只允许有限流的站内纯文本；iframe 使用 `connectIframeContext()`，不会直接获得整个 Client Context。普通消息 HTML 不接入这条业务桥。

## 6. Client Command 与 Action Placement

Command 元数据与 Placement 静态声明在 Client Module Manifest：

```text
contributes.commands[]
contributes.actions[] -> commandId + ClientActionSurface
```

当前正式 Action Surface 只有：

```text
composer.quick-actions
extension.workbench.actions
```

Host 在调用时从当前 Renderer Scope Snapshot 构造 `workspaceId`、可选 `timelineId`、可选 `agentSessionId` 与 `sourceSurface`，不向 Extension 暴露 DOM Event 或内部 Store。`when.active` 当前只支持 `timeline | agent-session`。

运行时 Handler 只能注册当前 Module Manifest 已声明的 Command。未声明 Placement、Module disabled、按需激活失败、Handler 缺失和执行异常都会返回 typed failure；执行异常只影响当前 Command 并产生 Diagnostic，不会卸载整个 Studio Shell。

Module reload 会释放旧 Handler，再由新 Instance 注册；Manifest Command 与 Placement 仍由 Catalog 保持可解释。Host 只渲染标题和受控图标集合，Extension 不能借 Action Placement 注入 JSX、HTML、CSS 或任意 SVG。

## 7. Node Render Mount

`narrative.entry.inline` 与 `agent.message.inline` 必须实现 `projectNode(context)`，返回瞬时 `ClientNodeRenderMount[]`。Mount 不写回 Narrative 正文，也不持久化 Renderer DOM 或 `DisplayPart`。

当前目标位置：

```text
node.before
node.after
node.inline + literal / match-ref / marker selector
```

Host 已实现 literal selector。Loom Script Runtime 会把 Text Pipeline 的稳定 `matchId` 与 `displayRange` 作为正式 Match 数据源，Node Host 按解析后的 UTF-16 范围插入 Renderer；范围无法映射到实际渲染文本时明确失败并报告 Diagnostic。普通 Extension `projectNode()` 仍需使用自身可解释的 Literal Anchor；Marker 尚无正式数据源。

Host 对重复 Mount Key、缺失或多义 Anchor、重叠 replace、Projection 异常生成 Diagnostic。每个 Node 第一版限制为 64 个 Mount、20 万字符；超出后截断并报告。这是资源预算，不是正文大小合同。

## 8. Standalone Renderer Session

`standalone.page` 要求 Renderer 提供独立 `frame.src`。Host 打开页面后通过 `BroadcastChannel` 维护：

```text
opening -> connected -> disconnected -> revoked
```

页面发送 ready 后获得 Session ID、Contribution Key 与 Scope。Extension disable、reload 或 Studio 卸载会 revoke 通道；浏览器页面可以继续存在，但不再获得有效 Host Session。

## 9. Extension Workbench

Studio 的扩展面板当前展示：

- Package / Module 与 desired state；
- Module enable、disable、reload；
- Renderer Surface、Scope、Adapter 与注册状态；
- 当前实例、Exclusive Claim 与显式替换；
- Collection 上下排序；
- Client、Renderer 与 Server Diagnostic；
- Standalone Page 打开入口。
- Manifest Command、Action Placement、Runtime Handler 注册状态与 Workbench Action 执行入口。
- 当前 Text Pipeline Runtime 中实际注册的 Extension / Loom Script Renderer、Scope Claim 与 Diagnostic。

Workbench 解释的是 Manifest declaration、Runtime registration 和当前实例状态，不把“已声明但未注册”伪装成可用能力。

## 10. 真实扩展验证与剩余边界

忽略目录 `.loomstudio-dev/test-extensions/renderer-background-demo/` 中的测试扩展用于真实作者路径验证。自动证据已经覆盖：

- Client Package 安装与启用；
- Catalog 返回受控同源 Entry URL；
- Manifest 暴露 `shell.workspace-panel`、`shell.background`、一个 Command 与两个 Action Placement；
- Client Entry 通过 JavaScript 语法检查。

扩展源码实际使用了面板设置 / 切换、Background open / update / close、Command Handler、Composer / Workbench 双入口、dispose 清理、CSS Token 和宿主毛玻璃 escape hatch；这些浏览器内行为尚未完成本轮人工视觉和点击验收，不能由安装测试替代。

该测试扩展的历史实现不代表当前能力上限：Host 已提供 `contributes.themes/styles` 与 `ctx.styles.register`，正式外观扩展应遵循[主题与样式合同](../ui/extension-themes.md)。Client Context 已提供 Package 绑定的 `ctx.configs.list/get/upsert/subscribe`，更新使用已有 Document Version，详见[Scoped Storage](../application/extension/data-and-portable-payload.md#21-scoped-storage)；旧测试的内存设置重置不表示宿主缺少持久配置能力。

当前仍保留的边界：

- Background 与前景样式没有语义联动；
- 第三方网络图片没有权限声明、隐私提示、加载失败或离线合同；
- `runtime: 'client'` Module 仍是受信任同源代码；
- Collection 用户排序尚未持久化；
- Marker Anchor 尚未接入正式 Narrative Marker 数据源；Match Anchor 已由 Loom Script Runtime 接入 Text Pipeline Match。

在出现第二个真实用例前，不建立通用 CSS 注入系统、Background Stack、任意 HUD / Sidebar 或完整 UI DSL。
