# Client 架构治理与 Hooks 约束 v0

> **状态**：Open Design Method / Client Architecture Guardrails
> **目的**：约束 Studio Client 的目录、hooks、状态、API client、feature / widget / entities 边界，避免前端随着功能增长变成单 hook、单 App、超大 widget 的结构。
> **适用范围**：`apps/studio-client/src` 下的 app、pages、widgets、features、entities、shared、renderer PoC 与客户端 RPC 调用。

---

## 0. 背景

本议题发起时，Client 端已经出现早期架构风险：

```text
useStudioState 变成 client-side 小内核；
app shell 变成所有 panel 的手工装配中心；
widget 文件定义领域类型和领域算法；
RPC raw string 散落在 hook action 中；
Renderer PoC、Application Runtime、Prompt Build、Context Assets 状态混在一个 hook。
```

这些问题短期不一定阻塞功能，但继续增长会导致：

- 新功能默认塞进 `useStudioState`；
- 状态刷新顺序越来越隐式；
- widget 难以复用和测试；
- UI 组件、RPC 调用、领域算法互相引用；
- 未来接入真实 event subscription / capability registry 时需要大规模重构。

本文档用于提前约束这些趋势。

---

## 1. 成功标准

随着 Client 功能增长，仍应满足：

1. 每个 hook 只拥有一个明确领域或 UI concern；
2. API 调用集中在 typed API client，不散落在 UI hook 中；
3. widget 只负责渲染和局部交互，不拥有跨领域业务流程；
4. entities 定义客户端领域类型，但不依赖 widget；
5. app 层只负责组合 providers / shell / feature containers；
6. renderer PoC、Application Runtime、Context Assets、Provider Settings 有独立 feature boundary；
7. 大组件可被拆分和测试，不需要加载整个 Studio state；
8. 新增功能时能判断放在 `shared`、`entities`、`features`、`widgets` 还是 `app`。

---

## 2. 目录边界

推荐结构：

```text
apps/studio-client/src/
  app/
    app.tsx
    use-studio-state.ts
    providers/
    shell/

  shared/
    api/
      studio-api.ts
      renderer-api.ts
    hooks/
    i18n/
    ui/
    utils/

  entities/
    card/
    session/
    provider/
    prompt/
    run/
    context-asset/
    renderer/

  features/
    cards/
      model/
      ui/
    session-runtime/
      model/
      ui/
    provider-settings/
      model/
      ui/
    renderer-poc/
      model/
      ui/
    context-assets/
      model/
      ui/
    prompt-build/
      model/
      ui/

  widgets/
    resource-panel/
    api-panel/
    narrative-canvas/
    inspector/

  pages/
    studio/
```

### 2.1 `app`

`app` 负责：

- 创建全局 providers；
- 装配 page shell；
- 连接 feature containers；
- 放置最顶层 layout glue。

`app` 不负责：

- 直接写 RPC action；
- 维护全部业务状态；
- 定义领域类型；
- 存放树操作、prompt build、provider config 等领域算法。

如果 `app/useXxxState.ts` 超过 250 行，应拆成 feature hooks。

### 2.2 `shared`

`shared` 放跨领域复用能力：

- typed API client；
- 基础 UI；
- i18n；
- 通用 hooks；
- 通用工具函数。

`shared` 不允许 import `features`、`widgets`、`pages`、`app`。

### 2.3 `entities`

`entities` 放客户端领域类型和很薄的纯函数：

- `Card`
- `Session`
- `Branch`
- `ProviderAccount`
- `ModelProfile`
- `PromptProjection`
- `ContextAssetNode`
- `RendererPocState`

`entities` 不允许 import widget。

禁止：

```ts
// entities/renderer.ts
import type { RendererPocState } from '../renderer-sdk'
```

推荐：

```text
entities/renderer/types.ts 定义类型；
shared/api/renderer-api.ts 和 renderer-sdk 都消费这个类型。
```

### 2.4 `features`

`features` 是 Client 端主要业务边界。

每个 feature 可以包含：

```text
model/
  useFeatureState.ts
  commands.ts
  queries.ts
  view-model.ts
  tree-ops.ts
ui/
  FeaturePanel.tsx
  FeatureEditor.tsx
```

feature 可以 import：

```text
shared
entities
other feature 的公开 export（谨慎）
```

feature 不应 import：

```text
app
pages
widget 内部文件
```

### 2.5 `widgets`

`widgets` 是页面级组合组件。

它可以组合多个 feature UI，但不拥有领域状态和 RPC 流程。

widget 允许：

- layout；
- panel composition；
- 把 props 转交给子组件；
- 局部 UI 状态，如展开/折叠、active tab。

widget 不应：

- 定义核心领域类型；
- 发 RPC；
- 维护跨 feature 状态；
- 实现复杂领域算法；
- 拥有 500 行以上的业务逻辑。

---

## 3. Hooks 约束

### 3.1 Hook 必须单一职责

推荐 hook 类型：

```text
useStudioApi
useCards
useProviderProfiles
useSessionRuntime
usePromptPreview
useRendererSession
useContextAssets
useRenderingLab
useBusyAction
```

禁止继续扩张这种模式：

```text
useStudioState
  cards
  provider profiles
  session
  timeline
  prompt
  renderer
  context assets
  rendering lab
  form state
  all actions
```

`useStudioState` 可以暂时作为 facade，但应只组合 feature hooks，不直接实现业务逻辑。

### 3.2 Hook 分类

| Hook 类型       | 负责                               | 不负责                |
| --------------- | ---------------------------------- | --------------------- |
| API hook        | 创建 API client、连接状态          | 业务状态              |
| data hook       | 加载/刷新某类资源                  | 复杂 UI 展示          |
| command hook    | 封装用户动作                       | 渲染 JSX              |
| view-model hook | 派生 UI 展示数据                   | 发 RPC                |
| event hook      | 订阅 SSE / WebSocket / postMessage | 修改无关 feature 状态 |

### 3.3 `busy` / `error` 不应全局过度共享

全局 `busy` 适合 MVP，但长期会让任意操作锁住整个 UI。

推荐：

```text
useBusyAction(scope)
```

或：

```ts
type AsyncState = {
  busy: boolean
  error?: string
}
```

按 feature 管理：

```text
cards.busy
providerSettings.busy
sessionRuntime.busy
renderer.busy
```

### 3.4 事件订阅独立成 hook

SSE / WebSocket / `window.message` 不应直接写在大型 state hook 中。

推荐：

```text
useRendererEvents(sessionId)
useRenderingLabMessages()
useStudioEvents(patterns)
```

每个 event hook 必须说明：

- 订阅源；
- 生命周期；
- 事件类型；
- 更新哪个 feature state；
- cleanup 行为。

---

## 4. API Client 约束

### 4.1 禁止 raw RPC string 散落

UI 和 feature hook 不应直接写：

```ts
bridge.call('application.createCard', ...)
bridge.call('renderer.state.set', ...)
```

推荐集中到：

```text
shared/api/studio-api.ts
shared/api/renderer-api.ts
```

示例：

```ts
type StudioApi = {
  cards: {
    list(): Promise<ListCardsResult>
    create(input: CreateCardInput): Promise<CreateCardResult>
  }
  sessions: {
    createFromCard(
      input: CreateSessionFromCardInput,
    ): Promise<CreateSessionResult>
    submitTurn(input: SubmitTurnInput): Promise<SubmitTurnResult>
  }
}
```

feature hook 只调用 typed API：

```ts
const result = await api.cards.list()
```

### 4.2 API client 只做 transport mapping

API client 负责：

- RPC method name；
- request / response 类型；
- transport error normalize；
- optional metadata。

API client 不负责：

- React state；
- optimistic UI；
- form parsing；
- refresh choreography；
- alert / toast。

---

## 5. 状态归属

### 5.1 Server state 与 UI state 分开

Server state：

```text
cards
providerAccounts
modelProfiles
agentRuntimeProfiles
session
branch
timeline
runDetails
promptPreview
```

UI state：

```text
activePanel
selectedCardId
selectedContextNodeId
gatewayForm
cardJson
input
expandedSection
editingModelId
customCss
renderingMode
```

不要把两者都塞进同一个 mega hook。

### 5.2 表单状态靠近表单

短期表单状态可以提升到 feature hook。

长期规则：

- 只有多个组件共同需要的表单状态才上提；
- 单个 panel 内部使用的编辑状态留在 panel 或 feature-local hook；
- 提交时转成 command input，不要让 server DTO 直接驱动表单结构。

### 5.3 派生数据不持久化

例如：

```text
canSend
composerHint
emptyTimelineText
promptBuildSteps
renderingSample
```

应放在 view-model hook 或 selector 中。

---

## 6. Context Assets 约束

Context Assets 当前混合了：

- tree 数据结构；
- projection order；
- read-only 规则；
- drag/drop mutation；
- prompt slot normalization；
- UI 展示节点。

应拆为：

```text
features/context-assets/
  model/
    types.ts
    tree-ops.ts
    projection-order.ts
    useContextAssets.ts
    selectors.ts
  ui/
    context-asset-detail/
      context-asset-detail.tsx
    projection-order-editor/
      projection-order-editor.tsx
```

规则：

- tree mutation 必须是纯函数；
- UI 组件不能直接维护 projection normalization；
- `ContextAssetNode` 类型不能定义在 widget 文件中；
- demo id 生成器不能隐藏在 hook 文件里；
- slot key 转换规则必须单独测试。

---

## 7. Component / Widget 体积约束

### 7.1 文件行数信号

这些不是硬失败，但触发 review：

```text
component > 300 行：检查是否混入 model / algorithm
component > 500 行：必须拆分
hook > 200 行：检查是否承担多个 concern
hook > 300 行：必须拆分
app/app.tsx > 250 行：检查是否需要 feature container
```

### 7.2 组件拆分原则

优先按职责拆：

```text
Panel shell
List
Editor
Toolbar
EmptyState
Item
```

不要只为了减少行数做无意义拆分。

### 7.3 组件不拥有领域算法

组件中允许：

- event handler；
- local UI state；
- lightweight formatting；
- conditional rendering。

组件中不应出现：

- 树递归修改；
- prompt slot 排序；
- RPC choreography；
- provider config normalization；
- 跨 feature 状态同步。

---

## 8. Client Event 约束

Client 事件来源包括：

```text
Studio transport events
Renderer SSE events
window.postMessage
DOM events
local feature events
```

必须分开处理。

### 8.1 Event hook 命名

```text
useStudioEvents
useRendererEvents
useRenderingLabMessages
```

### 8.2 不要在一个 listener 里更新多个无关 feature

如果一个事件会影响多个 feature：

```text
event hook -> event store / callback
feature hook -> 订阅自己关心的事件
```

不要直接在 root hook 中散落多个 `setXxx`。

---

## 9. 推荐落地顺序

### P0：立边界，不大重构

- `docs/guide/` 作为当前施工入口，本文档保留议题背景、边界说明和关闭条件；
- 新增 Client 功能时按 Guide 与本文 checklist review；
- 禁止继续往 `useStudioState` 塞新领域。

### P1：抽 typed API client

新增：

```text
shared/api/studio-api.ts
shared/api/renderer-api.ts
```

把 `application.*` / `renderer.*` raw string 收口。

### P2：拆 feature hooks

从 `useStudioState` 中拆：

```text
useCards
useProviderProfiles
useSessionRuntime
useRendererSession
useContextAssets
useRenderingLab
```

`useStudioState` 暂时保留为 facade。

### P3：迁移 Context Assets model

把以下内容迁出 hook / widget：

```text
ContextAssetNode
tree mutation
projection order selectors
slot normalization
read-only rules
```

### P4：拆大 widgets

优先拆：

```text
ContextWorkbench
PresetWorkbench
ApiPanel
```

拆分后组件只负责 UI，model 放到 feature。

### 9.1 Open Issue：Widget 内 model / view-model 边界继续收敛

> **状态**：Open Issue / Client 审计后续项
> **触发**：2026-06-22 Client / Application Layer 审计与首轮 facade 拆分后，`useStudioState` 已降到 200 行以下，但部分 widget 仍承载 view-model 和排序交互逻辑。
> **2026-06-23 更新**：首轮拆分和源码文件命名统一已完成；本议题只跟踪剩余 widget / model 边界，不再包含大改名任务。

当前具体信号：

```text
初始审计：
apps/studio-client/src/widgets/api-panel/ApiPanel.tsx                 309 行
apps/studio-client/src/widgets/context-workbench/ContextWorkbench.tsx 248 行
apps/studio-client/src/widgets/preset-workbench/PresetWorkbench.tsx   289 行

2026-06-23 小步拆分后：
apps/studio-client/src/widgets/api-panel/api-panel.tsx                 169 行
apps/studio-client/src/widgets/context-workbench/context-workbench.tsx 216 行
apps/studio-client/src/widgets/preset-workbench/preset-workbench.tsx   229 行
```

边界问题：

- `context-workbench.tsx` / `preset-workbench.tsx` 仍在组件内组合 detail node 选择、tree action 渲染和局部 projection view 切换；
- `api-panel.tsx` 已拆出 provider account / model profile list，但 gateway profile 表单仍留在 panel 内；
- `app.tsx` 已不直接操作 context tree mutation，但 widget 内仍有轻量 view-model 拼装；
- 后续继续小步拆分时，只处理真实边界问题，不再混入全局 rename/import 任务。

建议顺序：

1. 只有当 `context-workbench.tsx` / `preset-workbench.tsx` 的剩余局部逻辑需要复用或测试时，才继续抽到 `features/context-assets/model`；
2. 如果 gateway profile 表单继续增长，再拆成 `features/provider-settings/ui` 或 `widgets/api-panel` 子组件；
3. 新增 Client 文件必须直接使用 kebab-case，不再另起全局改名批次。

已完成：

- `ContextWorkbench` / `PresetWorkbench` 的 projection workbench model、拖拽 patch 生成已迁到 `features/context-assets/model/projection-workbench.ts`；
- `ApiPanel` 已拆出 provider account list 与 model profile list；
- model profile YAML config 映射已迁到 `features/provider-settings/model/model-profile-config.ts`；
- `tree-ops.ts` 已拆出 normalization、tree query、default projection、projection order profile、projection view / slot helpers，避免 Context Assets model 单文件继续膨胀。
- Client 源码文件命名已统一迁移为 kebab-case，React 组件内部标识仍保持 PascalCase。

暂不继续拆：

- `tree-ops.ts` 保留 add / duplicate / delete / move / update mutation 聚合；
- `projection-order.ts` 保留 projection order sorting / rows / rank 生成；
- widget 内的局部 tab、展开状态、action icon 渲染保留在组件内，除非出现复用或测试需求。

---

## 10. Review Checklist

新增 Client 功能前检查：

### 放置位置

- 这是 shared、entity、feature、widget、page 还是 app concern？
- 是否把领域类型定义在 widget 中？
- 是否让 `useStudioState` 继续变大？

### Hook

- hook 是否只有一个领域或 concern？
- 是否把 SSE / postMessage / RPC / form / derived data 混在一起？
- `busy` / `error` 是否应该是 feature-local？

### API

- 是否直接写了 `bridge.call('xxx')`？
- 是否应该进入 typed API client？
- request / response 类型是否靠近 API client？

### Component

- 组件是否超过 300 行？
- 是否包含递归数据算法？
- 是否包含跨 feature refresh choreography？
- 是否能用普通 props 测试？

### Event

- 事件来源是哪一种？
- cleanup 是否明确？
- 是否更新了无关 feature state？
- 是否需要独立 event hook？

---

## 11. 判断原则

遇到不确定时，优先选择：

```text
feature hook > mega hook
typed API client > raw bridge.call
entity type > widget type
pure model function > component 内算法
feature-local busy > global busy
event hook > root useEffect
facade 组合 > facade 实现所有逻辑
```

目标不是把 Client 做复杂，而是让每个复杂度有自己的归属。
