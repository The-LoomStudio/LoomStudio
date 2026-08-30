# Client Extension Host 与 Renderer Surface

> 状态：Phase 0—6 已实现（2026-08-29）

本文记录 Studio Client 当前已经落地的 Client Extension Module、Renderer Contribution、Surface 仲裁、实例生命周期与消息内 Render Mount。它描述的是当前代码合同，不包含未来的通用样式注入、网络权限或不可信代码沙箱。

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

Server Catalog 为已发现的 Client Module 返回受控 `entryUrl`。浏览器从同源 Extension File Route 加载模块，动态导入时附加 Instance cache-buster；Extension disable、reload、版本或 Entry 变化会先 abort 并按注册反序 dispose 旧实例，再按当前权威 Catalog 重建。

Client Module 必须导出 `activate(ctx)`。Manifest 中声明的 Renderer 必须在激活期间通过 `ctx.renderers.register()` 注册；Manifest Command 则通过 `ctx.commands.register(commandId, handler)` 绑定执行实现。未声明注册、声明与运行时合同不一致、激活异常都会使该 Module 降级并产生 Diagnostic，而不会阻塞 Studio Shell。

带 Renderer 的启用模块继续提前激活，以便建立 Surface Contribution；只有 Command / Action 的模块保持惰性，首次执行 Action 时才加载。Manifest Declaration 始终由 Catalog 提供，不需要为了显示入口而执行扩展代码。

Client Module 当前是受信任的同源 JavaScript。即使某个 Renderer 使用 sandbox iframe，模块本身仍已在 Studio 主页面执行；iframe 只隔离该 Renderer 的 frame 内容，不能把整个 Client Module 描述成不可信代码沙箱。

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

Contribution 的稳定身份为：

```text
packageId / moduleId / contributionId
```

UI Instance 再附加 `scopeKey`。注册不等于立即创建 DOM；Host 根据当前 Workspace、Timeline、Agent Session Scope、Surface 可见性和显式占用状态决定实际实例。

Renderer 实例获得：

- 当前 Contribution Identity、Surface 与 typed Scope；
- `AbortSignal` 和 `close()`；
- `compact`、`prefersReducedMotion` 与主题继承提示；
- 可选 `DisplayPart`；
- `mount(root, context)`、可选 `update(context)` 与 disposer。

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
- `sandbox-iframe`：Host 创建 `sandbox="allow-scripts"` iframe，不授予 `allow-same-origin`，通过 `postMessage` 发送 Renderer Context。

每个 Surface Host 建立独立 Root 和 stacking context。Extension 在 Root 外修改宿主 DOM 或注入全局 CSS 属于 Direct DOM escape hatch，不是稳定平台合同，也不享受兼容保证。

## 5. Client Extension Context

Client Module 当前可使用：

```text
ctx.renderers.register/open/close/openStandalone
ctx.commands.register
ctx.records.list/get
ctx.state.get
ctx.history.project/extract
ctx.rpc.call
ctx.assets.url
ctx.files.url
ctx.logger / ctx.signal / ctx.extension
```

约束：

- Record 读取始终绑定当前 `packageId`；
- Client RPC 只能调用当前 Package namespace；
- State 与 History 通过 Application RPC 读取，不暴露 Store；
- Asset 和 Package File 只获得受控 URL，不获得物理路径；
- Data commit 会产生 `extensions.data.changed` SSE，Client Host 收到后使 Renderer Projection 失效重建；
- 当前没有 Client Config 读写、State mutation、任意 Application RPC 或通用 Event Subscription。

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

当前 Host 已实现 literal selector；`match-ref` 与 `marker` 类型已经进入 SDK，但只有调用方提供对应解析表时才能解析，现有消息宿主尚未接入正式 Match / Marker 数据源。

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

Workbench 解释的是 Manifest declaration、Runtime registration 和当前实例状态，不把“已声明但未注册”伪装成可用能力。

## 10. 真实扩展验证与剩余边界

忽略目录 `.loomstudio-dev/test-extensions/renderer-background-demo/` 中的测试扩展用于真实作者路径验证。自动证据已经覆盖：

- Client Package 安装与启用；
- Catalog 返回受控同源 Entry URL；
- Manifest 暴露 `shell.workspace-panel`、`shell.background`、一个 Command 与两个 Action Placement；
- Client Entry 通过 JavaScript 语法检查。

扩展源码实际使用了面板设置 / 切换、Background open / update / close、Command Handler、Composer / Workbench 双入口、dispose 清理、CSS Token 和宿主毛玻璃 escape hatch；这些浏览器内行为尚未完成本轮人工视觉和点击验收，不能由安装测试替代。

测试同时暴露出当前尚未解决的边界：

- 没有正式 Host Appearance / Style Contribution；修改 Narrative 消息毛玻璃只能使用不受支持的全局 CSS escape hatch；
- Background 与前景样式没有语义联动；
- Client Context 没有 Config 读写，测试设置 reload 后重置；
- 第三方网络图片没有权限声明、隐私提示、加载失败或离线合同；
- Client Module 仍是受信任同源代码；
- Collection 用户排序尚未持久化；
- `match-ref` / `marker` Anchor 尚未接入正式 History Match / Narrative Marker 数据源。

在出现第二个真实用例前，不建立通用 CSS 注入系统、Background Stack、任意 HUD / Sidebar 或完整 UI DSL。
