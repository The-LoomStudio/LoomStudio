# 前端代码冗余与精简审查报告 (Frontend Code Redundancy)

## 审查目标

本轮审查专注排查前端（`apps/studio-client`）中的**代码冗余、重复造轮子、样板代码（Boilerplate）、样式重复、组件克隆与过度工程**，以“缩减代码物理体积、提升架构优雅度、降低维护成本”为核心准则。

---

## 1. 核心代码冗余与瘦身清单

### 🔴 [高] 1. `toClientJsonObject` 包装器泛滥（30+ 处手工包裹）

**现状：**
在各个 feature hooks（cards, provider-settings, narrative-runtime, context-assets, agent-profiles, agent-runtime）中，每次调用 `api.*` 前都必须显式调用 `toClientJsonObject({...})`，甚至出现多层嵌套：
```ts
// 30+ 处类似写法
const result = await input.api.agentProfiles.create(toClientJsonObject({
  ...profileInput,
  model: toClientJsonObject(profileInput.model),
}))
```
**根因：**
`studio-api.ts` 的参数签名大多被声明为裸 `JsonObject`，且 `ClientBridge.call` 默认未自动剔除 payload 中的 `undefined` 字段，导致业务代码在每一处调用时都要做防御性清洗。

**瘦身方案：**
- 在 `createClientBridge` 或 `createStudioApi` 内部统一做一次浅层/深层 `undefined` 过滤，或在 API 客户端方法内部做转换。
- 将 `studio-api.ts` 的方法签名升级为强类型入参，直接移除各 feature hook 中 30+ 处冗余的 `toClientJsonObject` 导入与包裹调用，预计减少 **50~80 行**纯样板代码。

---

### 🔴 [高] 2. `ContextWorkbench` 与 `PresetWorkbench` 高度重复（重合度 > 70%）

**现状：**
对比 [`widgets/context-workbench/context-workbench.tsx`](file:///Users/macbookair/Desktop/LoomStudio/apps/studio-client/src/widgets/context-workbench/context-workbench.tsx) 与 [`widgets/preset-workbench/preset-workbench.tsx`](file:///Users/macbookair/Desktop/LoomStudio/apps/studio-client/src/widgets/preset-workbench/preset-workbench.tsx)：
- 两个组件的 Props 声明有 **16 个字段完全一样**。
- 内部对 `useStudioLayoutStore` 的状态订阅与更新（`openAssetDetail`、`setExplorerWidth`、`setMetadataOpen`、`setTextEditorMode`）完全相同。
- 外层 `AssetWorkbenchLayout`、顶部 `PromptResourceToolbar`、右侧 `ContextAssetEditor`、搜索框联动、以及 `buildProjectionWorkbenchModel` 的计算结构几乎 100% 同构。
- 两者差异仅仅是左侧 Explorer 是支持分类 Tab 还是固定 Preset 模式。

**瘦身方案：**
- 抽取统一的 `<AssetWorkbench />` 布局容器，将共享的 LayoutStore 绑定和右侧编辑器固化，左侧仅插拔不同的 Explorer。
- 直接将两份各 220 行的组件合并瘦身为 1 个 ~110 行的通用工作台，立减 **120~150 行** 代码。

---

### 🔴 [高] 3. 组件内重复手写低劣弹窗轮子（80 行手写 vs 现成 `<Dialog />`）

**现状：**
在 [`character-panel.tsx` L478-L564](file:///Users/macbookair/Desktop/LoomStudio/apps/studio-client/src/widgets/character-panel/character-panel.tsx)，`CharacterGroupDialog` 独立实现了：
- 手写 `div.dialogBackdrop + section.groupDialog`
- 手动监听 `Escape` 和键盘 `Tab` 焦点陷阱（Focus Trap 算法）
- 手动维护 `returnFocusRef` 和微任务焦点还原
- 在 `character-panel.module.scss` 中手写了 40 多行 `.dialogBackdrop`、`.groupDialog` 及动画样式

而同文件内的 `DeleteConfirmation` 却直接复用了 [`shared/ui/dialog/dialog.tsx`](file:///Users/macbookair/Desktop/LoomStudio/apps/studio-client/src/shared/ui/dialog/dialog.tsx)（基于原生 HTML5 `<dialog>` 实现）。

**瘦身方案：**
- 将 `CharacterGroupDialog` 改用公共的 `<Dialog>` 组件实现。
- 直接删除 `character-panel.tsx` 中约 **60 行**复杂的焦点陷阱与 DOM 逻辑，并删除 `character-panel.module.scss` 中约 **40 行**样式，立减 **100+ 行**冗余代码。

---

### 🟡 [中] 4. 树操作内部辅助函数双重重复（`tree-ops.ts`）

**现状：**
在 [`features/context-assets/model/tree-ops.ts`](file:///Users/macbookair/Desktop/LoomStudio/apps/studio-client/src/features/context-assets/model/tree-ops.ts)：
- `moveContextAssetNode` 内部闭包重新写了一遍 `removeNode` 和 `insertNode`（L94-L115）。
- 文件外部又单独定义了 `insertContextAssetChild`、`insertContextAssetSiblingAfter`、`removeContextAssetNode`（L143-L165）。
- 两套递归逻辑 90% 重合。

**瘦身方案：**
- 让 `moveContextAssetNode` 直接复用外部纯函数，删除内部重复的闭包实现，瘦身 **25 行**。

---

### 🟡 [中] 5. 消息复制反馈与 CodeBlock Labels 逐字复制

**现状：**
在 `widgets/narrative-timeline/narrative-timeline.tsx` 和 `widgets/agent-composer/agent-composer.tsx`：
- 两边各自手写了 `copyTimerRef`、`copyState`、`setTimeout(..., 1600)` 和 `tryWriteClipboardText`。
- 两边各自手写了 `codeBlockLabels` 的 i18n 字典组装。
- 两边各自写了 `const ConversationMarkdown = lazy(async () => import(...))`。

**瘦身方案：**
- 抽象单个 `useClipboardCopy(timeoutMs = 1600)` Hook。
- 在 `shared/ui/conversation-markdown` 统一导出 Lazy 组件。
- 减少两个组件各 **20 行** 样板代码。

---

### 🟡 [中] 6. 重复实现并发防竞态逻辑（`runLatestRequest` vs `useAsyncOperations.runLatest`）

**现状：**
在 [`features/log-viewer/model/log-feed-model.ts` L32-L68](file:///Users/macbookair/Desktop/LoomStudio/apps/studio-client/src/features/log-viewer/model/log-feed-model.ts)，为了实现日志拉取的并发防竞态，私自手写了一套 `createLatestRequestGuard` + `runLatestRequest`（36 行）。

而全局早已在 [`shared/hooks/use-async-operations.ts`](file:///Users/macbookair/Desktop/LoomStudio/apps/studio-client/src/shared/hooks/use-async-operations.ts) 中提供了标准且支持状态追踪的 `runLatest(scope, async context => ...)`。

**瘦身方案：**
- 将 `useLogFeed` 接入公共的 `useAsyncOperations`。
- 删除 `log-feed-model.ts` 中自建的 `LatestRequestGuard` 与 `runLatestRequest`，立减 **36 行**重复逻辑。

---

### 🟡 [中] 7. 浏览器文件下载样板代码 3 处逐字复制

**现状：**
以下 3 个文件逐字复制粘贴了相同的 6 行 DOM 文件下载样板代码：
1. `features/cards/model/use-cards.ts` L202-L210 (`exportCardPng`)
2. `app/use-studio-state.ts` L273-L278 (`exportPromptResource`)
3. `widgets/log-viewer/log-viewer.tsx` L96-L101 (`exportLogs`)

```ts
const url = URL.createObjectURL(blob)
const anchor = document.createElement('a')
anchor.href = url
anchor.download = filename
anchor.click()
URL.revokeObjectURL(url)
```

**瘦身方案：**
- 在 `shared/browser/download.ts` 封装一个通用的 `downloadFile(blobOrUrl: Blob | string, filename: string): void`。
- 3 处调用直接替换为单行函数调用。

---

### 🟡 [中] 8. 跨模块类型重复定义（Copy-Paste Types）

**现状：**
- **`ProviderAccountDraft`**：在 `features/provider-settings/model/use-provider-settings.ts` L8 和 `widgets/model-panel/model-panel.tsx` L9 重复定义了 2 次完全相同的对象结构。
- **`JsonObject`**：在 `entities/common.ts`、`shared/api/studio-api.ts` 和 `features/narrative-runtime/model/use-narrative-runtime.ts` 中重复定义了 3 次（`type JsonObject = { [key: string]: ClientJsonValue }`）。
- **`CharacterCardSummary`**：在 `character-panel.tsx` 内部重新定义了一套 `CardSummary`，且把字段弱化为 `unknown[]`。

**瘦身方案：**
- 严格遵守“业务类型唯一源”原则，公共 DTO/Draft/Entity 统一由 `entities/` 或对应 feature 的 `model` 导出，禁止在 Widget 内部私自重复声明。

---

### 🟡 [中] 9. 上帝 Hook（`useStudioState`）与巨型 Props 钻取中继站

**现状：**
- `use-studio-state.ts`（430 行）将 cards, provider-settings, agent-profiles, agent-chat, narrative-runtime, context-assets, edit-history 全部引入并聚合成包含近 60 个属性的大对象。
- `app.tsx` 充当巨型分发中继站，把这 60 个属性一行行解构并包装成各 Panel 的 Props（如 `contextAssetEditorProps`、`ModelPanelProps`、`AgentPanelProps` 等）。
- 导致新增任意一个小功能，必须在 `feature hook` → `use-studio-state.ts` → `App.tsx` → `Widget.tsx` 四处同步增改声明。

**瘦身方案：**
- 结合项目中已有的 Zustand（如 `useStudioLayoutStore`），让各 Panel/Widget 直接就近消费各自对应的 Feature Hook 或细粒度 Store。
- `use-studio-state.ts` 只保留全局级别的初始化（如 locale、bootstrap、全局 bridge），消除百行级别的属性透传中继代码。

---

### 🟢 [低] 10. SCSS / CSS 样式系统缺少高频 Mixin / 原子类抽象

**现状：**
- `src/styles/abstracts/_mixins.scss` 全文只有 8 行（仅包含一个 `text-ellipsis`）。
- 导致在十几个 `.module.scss` 文件中，高频重复书写：
  - 弹性水平/垂直居中（`display: flex; align-items: center; justify-content: space-between;`）
  - 图标按钮（`width: 26px; height: 26px; border: 0; background: transparent; display: grid; place-items: center...`）
  - 隐藏滚动条（`scrollbar-width: none; &::-webkit-scrollbar { display: none; }`）
  - 面板通用容器（`position: relative; width: 100%; height: 100%; min-height: 0; overflow: hidden;`）

**瘦身方案：**
- 在 `_mixins.scss` 中补充 `@mixin icon-button`、`@mixin flex-between`、`@mixin hide-scrollbar`，或在 `global.css` 中增加通用的 `.loom-icon-button` 类，减少几十处冗余 SCSS 规则。

---

### 🟢 [低] 11. 幽灵空目录与死包装函数

**现状：**
- `apps/studio-client/src/features/session-runtime/model` 为完全空的目录，代码库中已无任何引用。
- `use-cards.ts` 中的 `deleteCard()` 是对 `deleteCards([id])` 的多余封装，导出后在 Widget 里未被使用。

**瘦身方案：**
- 物理删除空目录及无用包装函数。

---

## 2. 预计精简收益评估

| 优化项 | 涉及模块 | 预估缩减代码量 | 优雅度与架构收益 |
|---|---|---|---|
| 统一入参过滤，消除 `toClientJsonObject` | 7 个 Feature Hook | 约 50~80 行 | 移除 30+ 处无意义包裹，代码清爽 |
| 合并 `ContextWorkbench` 与 `PresetWorkbench` | `context-workbench` / `preset-workbench` | 约 120~150 行 | 消除工作台组件 70% 的克隆复制 |
| 重构 `CharacterGroupDialog` 为 `<Dialog>` | `character-panel.tsx/.module.scss` | 约 100+ 行 | 消除低劣手写轮子，统一可访问性与键盘交互 |
| 消除自建 `LatestRequestGuard` | `log-feed-model.ts` | 约 35 行 | 复用全局标准异步调度体系 |
| 树操作算法去重 (`tree-ops.ts`) | `context-assets/model/tree-ops.ts` | 约 25 行 | 消除内部闭包与外部纯函数的重叠 |
| 提取 `useClipboardCopy` 与通用 Lazy 导出 | `narrative-timeline`, `agent-composer` | 约 40 行 | 统一剪贴板反馈与懒加载导出 |
| 提取公共 `downloadFile` 工具 | 3 个组件/Hook | 约 15 行 | 消除 3 处 DOM 下载复制粘贴 |
| 收敛重复类型声明与 DTO | 5 个文件 | 约 30 行 | 强化 TS 类型单一真相源 |
| 精简 `useStudioState` Props 钻取中继 | `app.tsx`, `use-studio-state.ts` | 约 120~180 行 | 降低组件树层级耦合，提升模块独立性 |
| SCSS Mixin 抽象复用 | 10+ 个 SCSS 模块 | 约 80~120 行 | 样式代码高度收敛，主题与视觉调整更敏捷 |
| **合计** | — | **约 600 ~ 800 行** | **极其显著精简前端物理行数与维护负担** |
