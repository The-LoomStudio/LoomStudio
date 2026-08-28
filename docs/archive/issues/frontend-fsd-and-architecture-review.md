# 前端 FSD 架构与宏观工程结构审查报告 (Frontend FSD & Architecture Review)

> **状态**：Historical Audit Snapshot / Superseded

## 审查目标

全面从宏观工程结构、代码分类、文件夹与文件命名、以及 **FSD (Feature-Sliced Design) 分层架构规范** 角度排查前端工程（`apps/studio-client/`），重点审查：
1. **FSD 层级依赖方向合规性（Layer Hierarchy & Violations）**
2. **同层 Widget / Feature 交叉引用与组件乱窜（Cross-Imports & Misplacement）**
3. **文件夹/文件命名与物理组织一致性**
4. **状态管理归属漂移（Misplaced State Stores）**

---

## 1. 核心问题与架构违规清单

### 🔴 [高] 1. FSD 层级逆向依赖（Lower Layers Importing Higher Layers）

在 FSD 严格分层体系中，依赖箭头**只允许单向由上至下**：
`app` ➔ `pages` ➔ `widgets` ➔ `features` ➔ `entities` ➔ `shared`。
目前代码库中存在 3 处严重的逆向跨层依赖：

```text
[违规 1] shared/api/studio-api.ts   ──(向上依赖)──>  entities/index.js
[违规 2] widgets/context-workbench  ──(向上依赖)──>  pages/studio/model/studio-layout-store.js
[违规 3] widgets/preset-workbench   ──(向上依赖)──>  pages/studio/model/studio-layout-store.js
```

#### 具体分析：
1. **`shared/api/studio-api.ts` 向上依赖 `entities`**：
   - `shared` 是最底层的通用基础设施，而 `studio-api.ts` 从 `entities` 导入了 20 多个业务实体类型（`CreateCardResult`、`ContextAssetNode`、`NarrativeTimeline` 等），破坏了 `shared` 的无业务纯净性。
   - **架构纠偏**：API Client 本质属于传输/契约层，其 DTO 契约应就近放置于 `entities` 或专用 api 模块，避免污染 `shared`。
2. **`widgets` 向上依赖 `pages/studio`**：
   - `context-workbench.tsx` 与 `preset-workbench.tsx` 深度导入了 `pages/studio/model/studio-layout-store.js` 中的 `useStudioLayoutStore` 和 `DEFAULT_ASSET_VIEW_STATE`。
   - 下层 UI Widget 反向依赖顶层 Page 内部实现，埋下了严重的循环引用与耦合隐患。
   - **架构纠偏**：`studio-layout-store` 既然是全局共享的布局状态，应提升至 `app/providers` 或独立的 `features/studio-layout`，绝不能滞留在 `pages` 私有模型中。

---

### 🔴 [高] 2. Widget 违规交叉嵌套引用（Widget Cross-Imports）

在 FSD 规范中，**Widget 之间是严格平级的独立页面组装块，严禁 Widget 直接 import 另一个 Widget**。需要复用的子组件必须下沉至 `features/*/ui` 或 `shared/ui`。

当前扫描发现 2 处违规：

1. **`widgets/agent-composer` 直接引用 `widgets/chat-composer`**：
   - [`apps/studio-client/src/widgets/agent-composer/agent-composer.tsx` L9](../../../apps/studio-client/src/widgets/agent-composer/agent-composer.tsx)
   ```ts
   import { ChatComposer } from '../chat-composer/chat-composer.js'
   ```
   - **问题**：`ChatComposer` 本质上是一个具备输入与提交逻辑的复合表单组件，它被当作基础砖块嵌套在 `AgentComposer` 内部，导致 Widget 产生父子包含关系。
   - **纠偏**：将 `ChatComposer` 下沉归位至 `features/chat-composer/ui` 或公共 `shared/ui`。

2. **`widgets/inspector-panel` 直接引用 `widgets/prompt-build-flow`**：
   - [`apps/studio-client/src/widgets/inspector-panel/inspector-panel.tsx` L4](../../../apps/studio-client/src/widgets/inspector-panel/inspector-panel.tsx)
   ```ts
   import { PromptBuildFlow } from '../prompt-build-flow/prompt-build-flow.js'
   ```
   - **问题**：`InspectorPanel` 将另一个 Widget `PromptBuildFlow` 作为其 Drawer 的子 Tab 渲染。
   - **纠偏**：将 `PromptBuildFlow` 下沉归位至 `features/prompt-build/ui/prompt-build-flow`。

---

### 🟡 [中] 3. 全局布局状态错置于 Page 私有模型（Misplaced Store）

**文件：** [`apps/studio-client/src/pages/studio/model/studio-layout-store.ts`](../../../apps/studio-client/src/pages/studio/model/studio-layout-store.ts)

**现象分析：**
- `pages/studio/model/` 内部定义了 `useStudioPanelStore`（活动面板切换）和 `useStudioLayoutStore`（左侧资源管理器宽度、Asset 详情展开、元数据弹窗等）。
- 这个 Store 目前被整个工程的 6+ 个 Widget（`ContextWorkbench`, `PresetWorkbench`, `InspectorPanel`, `CharacterPanel`, `AgentComposer`, `StudioNavigation`）频繁读写。
- **问题**：将全局应用级 Store 藏在 `pages/studio/model` 内部，既混淆了 Page 路由职责，又直接诱发了上述 Widget 逆向依赖 Page 的违规。

---

### 🟢 [低] 4. 命名与物理目录卫生（Directory Hygiene）

- **幽灵空目录**：`apps/studio-client/src/features/session-runtime/model` 完全为空，没有任何文件与引用，应予物理删除。
- **命名规范执行良好**：全工程所有 `.ts` / `.tsx` / `.module.scss` 均严格遵守了 `kebab-case` 命名规范，无大小写混合或 CamelCase 失误。

---

## 2. 审查与重构收益评估

| 治理项 | 违规位置 | 纠偏方案 | 架构收益 |
|---|---|---|---|
| **消除 Page 逆向依赖** | `widgets/*` ➔ `pages/studio/model/studio-layout-store.js` | 将 Store 提升至 `features/studio-layout` 或 `app/layout` | 恢复 FSD 严格单向依赖，杜绝循环引用隐患 |
| **消除 API 逆向依赖** | `shared/api/studio-api.ts` ➔ `entities/` | 保持底层 shared 纯净，将 API Client DTO 规整到契约层 | 恢复 shared 的底层可复用纯粹性 |
| **消除 Widget 嵌套乱窜** | `agent-composer` ➔ `chat-composer`<br/>`inspector-panel` ➔ `prompt-build-flow` | 将被引用的组件下沉至对应 `features/*/ui` | Widget 职责平级解耦，遵循 FSD 组合模型 |
| **清理空目录** | `features/session-runtime/model` | 物理删除 | 净化源码目录树 |
