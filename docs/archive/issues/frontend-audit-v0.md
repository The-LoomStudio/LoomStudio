# Studio Client 前端审计台账 v0

> **状态**：Historical Audit Snapshot / Superseded
>
> **当前入口**：本文保留旧前端分支的确认项与实施历史，不再作为当前待办；当前问题以 [`full-repo-code-review-2026-08-27.md`](../../workbench/issues/full-repo-code-review-2026-08-27.md) 和相关活跃 Plan 为准。

## 当前边界

- 基线：`43aa838 Refactor frontend architecture and streamline studio UI flows`，分支 `codex/frontend-next`。
- 范围：前端内部逻辑、状态、数据投影、React UI、CSS Modules 与前端平台适配。
- 排除：后端、RPC、Schema、Document Store，以及尚未稳定的 Session/Card Resources 数据层。
- 不因文件行数、Lint 命中、断点数量或“以后可能不用”直接立项。
- Custom CSS Token、动态 `styles[...]`、`:global`、`data-loom-*` 等外部合同不能机械删除。
- 每项必须给出 Producer → Consumer、实际维护成本、最小整改、关闭条件和反向验证。

## 第一阶段完成摘要

第一阶段以旧基线 `ea7b4c6` 完成六轮审计和八个整改批次。已完成内容包括：

- 删除未消费 Activation Option、无意义 Export、孤儿 Sass 抽象与确定重复声明；
- 接通 Agent Runtime Active State，修复 Provider Copy Timer，并补齐相关 Accessible State；
- 提取 Log Feed、Character Navigation/Media、Studio Rail/Panel Host/Resize 与 FileTree Keyboard Model；
- 收口 Shared Markdown、Long Text Editor、Character Group Picker 和 Studio Shell；
- 完成 UI 对象命名、Radius/Color/Typography/UI Scale/Window Column Layout 等合同迁移；
- 取消 Character 分组拖拽，Group Picker 回到 Character Panel 内的点击式 Modal；
- 完成 FileTree ARIA Tree、Panel Window Resize、Column Layout 与 Custom CSS 兼容边界。

第一阶段的生产实现已包含在 `43aa838`。当前 Ledger 不再重复保存每个 Batch 的命令、Diff、测试数量和人工验收文案。

仍保留的第一阶段边界：

- Character Panel 的 Navigation、Media 和 Overlay 生命周期已拆分，但 Gallery/Profile 继续留在同一 Coordinator；直接拆分会制造二十余个 Props，因此不以物理文件长度继续立项。
- Provider、Session、Card Resources、Projection 持久化语义和移动端布局继续延期，不在本轮前端去冗余中推测后端合同。
- Agent Mock 是已批准的交互原型，正式进入 Agent 模块前再决定 DEV Fixture 或前端 Projection 的所有权。

## 第二阶段 A：确认的代码冗余

本阶段使用三个 `gpt-5.6-terra` 子智能体分别扫描控制流、组件/Props 和 CSS/Markup，再由主线程反向验证。目标不是寻找 Bug，而是删除重复概念、状态、分支和样板代码；预计整体可净减约 180–250 行，实际数值以实施 Diff 为准。

### R1. Context 与 Preset Workbench 复制同一套资产编辑流程

- **优先级 / 状态**：P2 / Completed；ESLint、Typecheck、测试与 Build 通过，交互待人工验收。
- **位置**：`widgets/context-workbench/context-workbench.tsx:30-43,65-72,118-222`；`widgets/preset-workbench/preset-workbench.tsx:33-46,74-81,136-249`；共同输入来自 `app/app.tsx:77-88,133-152`。
- **Producer → Consumer**：App 先构造同一组 `contextAssetEditorProps`，再分别传给两个 Workbench；两个消费者又各自装配 Search → FileTree → Add/Duplicate/Delete/Enabled → Detail Header → Detail Editor 流程。
- **冗余量**：公共 Props、Route Effect、Search/FileTree JSX、四组 CRUD Handler、Enabled Commit 和 Detail 装配约有 100 行同构维护点。
- **最小整改**：只在 `features/context-assets/ui/` 建立领域内 `ContextAssetWorkbench` Shell，收口共同树、搜索和详情流程。Preset/Resource 保留薄 Wrapper，继续拥有 Toolbar、Layout ID、Display Nodes、Projection Move、Preset Agent Runtime 和 `variant="flat"`。
- **禁止扩大**：不能做成“任意资源工作台”框架，也不能把 Preset/Resource 的 Projection 语义强行参数化成庞大配置对象。
- **关闭条件**：新增、删除、Tree Interaction、Detail Header 与 Editor Props 各只有一个装配点；两个页面的专属逻辑仍在本地可读。
- **反向验证**：分别验证 Add、Duplicate、Delete、启停 Entry、Explorer/Split/Editor、普通节点和 Projection 节点拖拽；状态仍隔离写入 `preset/resources` Namespace。

### R2. Narrative 与 Agent 重复整套 Message Footer / Action Chrome

- **优先级 / 状态**：P2 / Completed；自动检查通过，视觉待人工验收。
- **位置**：`widgets/agent-composer/agent-composer.tsx:209-226,264-281`、`agent-composer.module.scss:146-212`；`widgets/narrative-timeline/narrative-timeline.tsx:295-329,350-367`、`narrative-timeline.module.scss:123-191`。
- **Producer → Consumer**：两个消息宿主各自实现 Timestamp、Action Container、23px Button、SVG、Hover/Focus、Action 显隐，并复制 `MessageAction`、`formatTimestamp` 与 `formatFullTimestamp`。
- **冗余量**：扣除 Narrative Editing、Agent User 对齐和少量 Margin 差异后，预计可净删 35–50 行 TSX/SCSS。
- **最小整改**：增加窄的 `conversation-message-chrome` Shared UI，只拥有时间格式、Action Button 和公共基础样式；两个宿主继续装配自己的 Action Children 和差异 Class。
- **关闭条件**：Action 尺寸、Focus/Hover 和时间格式只有一个 Owner，宿主差异不被塞入大量 Boolean Props。
- **反向验证**：Narrative Editing 仍强制显示 Actions，Disabled Save 不可点击；Agent User Footer 仍靠右；Copy/Fork Title、键盘焦点和时间文本不变。

### R3. 安全 LocalStorage 边界被复制三次

- **优先级 / 状态**：P2 / Completed；平台失败路径测试通过。
- **位置**：`pages/studio/model/studio-layout-store.ts:75-97`；`widgets/character-panel/character-gallery-store.ts:29-51`；`features/provider-settings/model/use-provider-settings.ts:191-209`。
- **Producer → Consumer**：两个 Zustand Store 各自复制 `getItem/setItem/removeItem` 的 Try/Catch Adapter；Provider 又用两个函数重复“Storage 不可用时读 Undefined、写入静默失败”的同一平台边界。
- **冗余量**：三份独立防御分支可收为一处，预计净删 30–35 行。
- **最小整改**：新增无 Zustand 依赖的 `shared/browser/safe-local-storage.ts`，暴露原生 Storage 形状的安全 Adapter；Store 继续使用 `createJSONStorage`，Provider 只保留 Key、Trim 和空值语义。
- **关闭条件**：Storage 失败策略只有一个实现，两个业务 Store 仍保持独立，不建立 Persist Factory。
- **反向验证**：令 `getItem/setItem/removeItem` 分别抛错，Layout、Character Gallery 与 Provider 初始化/更新均不抛；正常 Stub 下 Rehydrate、分组持久化和 Provider 值保持原样。

### R4. Clipboard Promise 的成功/失败映射重复五处

- **优先级 / 状态**：P3 / Completed；平台成功/拒绝测试通过。
- **位置**：`widgets/agent-composer/agent-composer.tsx:91-100`；`widgets/narrative-timeline/narrative-timeline.tsx:158-177`；`shared/ui/long-text-editor/long-text-editor.tsx:86-93`；`shared/ui/markdown-content/markdown-code-block.tsx:29-36`；`widgets/model-panel/provider-account-list.tsx:81-96`。
- **Producer → Consumer**：五处都调用 `navigator.clipboard.writeText`，再用同构 Try/Catch 把 Promise 结果映射为成功、失败或静默失败；真正不同的只是各宿主自己的 UI State 和 Timer。
- **冗余量**：预计净删 18–25 行异常控制流。
- **最小整改**：增加无 React 依赖的 `tryWriteClipboardText(value): Promise<boolean>`；各组件继续拥有自己的 Copied/Failed State 与 1200/1600ms Timer。
- **关闭条件**：浏览器 Clipboard 失败边界只有一个实现，不抽取跨组件 UI State 或 Timer Hook。
- **反向验证**：Helper 覆盖 Fulfilled/Rejected；Agent、Narrative、Long Text 与 Markdown Block 保持原反馈，Provider 失败继续静默。

### R5. Asset View 三个 Setter 重复构造同一 Immutable Update Tree

- **优先级 / 状态**：P3 / Completed；Layout Store 定向测试通过。
- **位置**：`pages/studio/model/studio-layout-store.ts:170-220`。
- **Producer → Consumer**：`setAssetExpandedIds`、`setAssetSelectedId`、`setAssetViewMode` 都重复展开 `assetLayouts → layoutId → views → workspaceId`，只改变最后一个字段。
- **冗余量**：三份约 14 行的 Nested Update 可收为一个本文件私有 Helper，预计净删 25–30 行。
- **最小整改**：增加 `updateAssetView(state, layoutId, workspaceId, partial)`；三个公开 Setter 的签名与语义保持不变。
- **关闭条件**：Asset View Tree 的拷贝策略只有一个 Owner，三个 Setter 仍只允许更新自己的字段。
- **反向验证**：现有 Store Test 继续覆盖 Expanded ID 去重、Selected ID、View Mode、两个 Layout 和多个 Workspace 的隔离。

### R6. “底部描边字段”基础样式至少重复六次

- **优先级 / 状态**：P3 / Completed；Build 通过，视觉待人工验收。
- **位置**：`widgets/model-panel/model-panel.module.scss:25-42`；`widgets/character-panel/character-panel.module.scss:457-474,649-672`；`features/context-assets/ui/context-asset-detail/context-asset-detail.module.scss:106-123`；`widgets/preset-workbench/agent-runtime-manager.module.scss:96-113,230-238`。
- **Producer → Consumer**：这些 Input/Select/Textarea 重复声明 Transparent Background、无四周 Border、Divider Bottom Border、Radius 0、Text/Font，以及 Focus Accent/No Shadow；差异主要是 Height、Padding、Font Size 和 Disabled State。
- **冗余量**：约 60 行基础规则可变成一处约 12 行加局部差异，预计净删 25–35 行。
- **最小整改**：建立一个有六个真实消费者的全局 `.loom-underlined-field` Primitive，与现有 Page Header/Divider Primitive 同级；不使用 Sass Mixin，因为它不会减少编译后重复 CSS。
- **关闭条件**：基础 Border/Color/Focus 规则只有一个 Owner，各模块只保留真实尺寸与布局差异。
- **反向验证**：Input/Select/Textarea 在默认、Focus、Disabled 和窄 Panel 下的 Computed Border/Color/Shadow 与现状一致；旧模块 Selector 与 Custom CSS 仍可覆盖。

### R7. Layout SCSS 保留同值重申和无对应 Transition 的 Reduced Motion 规则

- **优先级 / 状态**：P3 / Completed；Sass/Vite Build 通过。
- **位置**：`pages/studio/studio-page.module.scss:43-57,133-156,487-518`；`shared/ui/window-column-layout/window-column-layout.module.scss:57-61`；`shared/ui/asset-workbench-layout/asset-workbench-layout.module.scss:4,61-80`。
- **Producer → Consumer**：Floating Dock 状态重复基础 Height/Border/Radius/Background；窄规则再次写相同 Width/Border；多个 Reduced Motion Selector 对应元素根本没有 Transition；Asset Workbench 的专用 Explorer Width Selector 又被前一条通用 Selector 完全覆盖。
- **冗余量**：可纯删约 25–30 行或 9–12 条声明，不增加任何抽象。
- **最小整改**：删除同值重申、无 Transition 的 Reduced Motion Selector 和被完全覆盖的 Selector；保留真实 `.floatingDock` 与 `.workbench` Transition 的 Reduced Motion 覆盖。
- **关闭条件**：编译 CSS 不再输出这些无效声明，现有状态仍从基础规则获得相同 Computed Value。
- **反向验证**：对比整改前后 Dock 与 Workbench 各状态的 Width/Height/Border/Radius/Background；Reduced Motion 下真实动画仍被关闭，Column Layout 仍保持当前无动画行为。

### R8. Agent Markdown Code Block Labels 重复装配

- **优先级 / 状态**：P3 / Completed；反向引用与 ESLint 通过。
- **位置**：`widgets/agent-composer/agent-composer.tsx:102-108,145-156,185-207,231-257`。
- **Producer → Consumer**：父组件已有五个 I18N Label 的对象供 Tool Call 使用，`AgentMessage` 又从同一 Translator 重建完全相同对象。
- **最小整改**：同一对象传给 `AgentMessage` 与 `AgentToolCall`，不建立全局 Markdown 配置层。
- **关闭条件 / 反向验证**：五个 Key 在 Agent Composer 内只剩一个装配点；两类 Code Block Header 文案保持一致。

### 明确不立项

- 不删除 `clsx`、`@dnd-kit/sortable`、`@dnd-kit/utilities` 或 `diff`。项目仍处早期，未消费依赖不等于当前代码冗余；`diff` 还是已批准的后续能力。
- 不合并 `useAsyncOperations.run/runLatest`，二者的 Epoch 与错误记录语义不同，强合只会增加分支。
- 不把 Context/Preset Workbench 提升为跨领域通用框架；只允许 Context Assets 域内的窄收口。
- 不为时间格式以外的小于十行相似 JSX 建立 Shared Component。
- 不把 Character Group Picker 替换成全局 Dialog；其 Panel-local Modal 定位与焦点合同不同。
- 不因 CharacterPanel、CodeMirror、Narrative Timeline 或大 SCSS 文件的物理行数机械拆分。

## 第二阶段 B：独立的正确性复查

以下项目是 Bug 或 UI 合同遗漏，不计入“代码去冗余”的收益。它们保留在 Ledger，但实施时不得与纯删除批次混合。

### C1. Log Poll 与 Refresh 缺少共同 Current Guard

- **优先级 / 状态**：P1 / Completed；共享 Guard Snapshot 与乱序测试通过。
- **位置**：`features/log-viewer/model/use-log-feed.ts:23-24,40-56,70-102`。
- **因果链**：Refresh 受 `refreshGuardRef` 保护，Poll 只受局部 `disposed/polling` 保护，却写入同一 Cursor、Records、Gap 与 Truncated；同 Source Refresh 不会销毁在途 Poll。
- **影响**：旧 Poll 可在新 Refresh 后回退 Cursor、重复 Merge 或恢复旧 Gap/Truncated。
- **最小整改**：Refresh、Source/Active 与 Poll 共享 Feed Epoch；Poll 提交前校验 Epoch、Source 和 Cursor。
- **反向验证**：`Poll(logs:4) → Refresh(logs:6) → 旧 Poll 返回` 后 Records 不重复、Cursor 保持 `logs:6`、Unread 不增加。

### C2. 切换 Log Source 时仍展示并可导出旧 Source 数据

- **优先级 / 状态**：P2 / Completed；Source Projection 与下载状态已绑定。
- **位置**：`widgets/log-viewer/log-viewer.tsx:19,44-66,94-102,145-166`；`features/log-viewer/model/use-log-feed.ts:40-68`。
- **因果链**：Source 已更新，但新 Refresh 的 `onStart` 不清旧 Records/Gap/Truncated；Filter、Count、Stream 与 Download 继续消费旧 Projection。
- **最小整改**：Source 变化立即清旧 Projection 并禁用下载；同 Source Refresh 可保留当前内容。
- **反向验证**：Server 切到延迟 Client 时不再展示或下载 Server 数据，晚返回的 Server 请求也不能重新提交。

### C3. UI Scale 漏掉七处固定 Lucide Size

- **优先级 / 状态**：P2 / Completed；固定 Size 反向引用清零，视觉待人工验收。
- **位置**：`widgets/chat-composer/chat-composer.tsx:85,89,92,121`；`widgets/preset-workbench/agent-runtime-manager.tsx:38,57`；`features/context-assets/ui/projection-order-editor/projection-order-editor.tsx:49`。
- **最小整改**：14/16px 映射既有 Icon Token；单个 17px 使用局部 Scale 或经视觉确认归入 16px 等级，不新增全局 Token。
- **反向验证**：80% 与 125% 下目标 SVG Bounding Box 比例约为 `1.5625`，中心与 Hit Area 不漂移；最终观感由人工验收。

### C4. Logs Panel 的窄布局错误依赖 Viewport Width

- **优先级 / 状态**：P2 / Completed；已迁移至 `studio-panel` Container Query，视觉待人工验收。
- **位置**：`widgets/log-viewer/log-viewer.module.scss:423-449`；Panel Host 已提供 `studio-panel` Container。
- **最小整改**：规则内容不变，只迁到 `@container studio-panel (max-width: 820px)`。
- **反向验证**：固定 Viewport 时由 Logs Panel 自身宽度触发降级；保持 Panel Width 时改变 Viewport 不应无故切换布局。

## Agent Mock 边界决定

- **状态**：Decision / Pre-Agent Cleanup，不是当前缺陷。
- **当前事实**：Agent Composer 自持 Mock Branch、Draft 与 Fork State，`INITIAL_AGENT_BRANCHES` 不受 DEV 限制；真实 `state.agentTranscript` 当前只供 Inspector 消费。
- **待决定**：正式进入 Agent 实施前，将原型限制为 DEV Fixture，或由 App 显式注入以 Agent/Session Instance 为 Key 的前端 Projection。
- **边界**：两种方案都不能提前设计后端 Schema/RPC，也不能复制一套前端 Session 真相。

## 收尾完成项

- 删除 Model Picker 无消费者的 `fetchVersion` State、Focus Update 与 Data Attribute。
- 新增 Studio Shell 内部 `STUDIO_PANEL_PRESENTATION`，Rail 与 Panel Host 共享唯一 Icon/Label Definition。
- 补齐标准 `vite/client` 类型入口，并调整 `.gitignore` 允许提交该声明；正式 `tsc -b && vite build` 已恢复通过。
- 生产源码本轮实际净减约 134 行；另新增 59 行平台边界测试。文档压缩不计入代码收益。

## 建议实施顺序

1. **纯删除与私有收口**：R5、R7、R8。风险最低，先建立可读的净删除基线。
2. **平台小边界**：R3、R4。只抽取 Storage 与 Clipboard 的失败适配，不抽业务 State。
3. **共享视觉 Primitive**：R2、R6。保留宿主差异，人工验收 Message Chrome 与 Field 视觉。
4. **资产工作台收口**：R1。收益最大，但必须防止演化成通用配置框架。
5. **正确性修复**：C1、C2、C3、C4 独立实施，不混入去冗余收益统计。

以上五批均已完成。自动化验证、客观浏览器诊断和人工视觉验收继续分开报告；本轮未进行浏览器客观诊断和人工视觉验收。
