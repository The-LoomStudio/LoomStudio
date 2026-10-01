# 前端 UI 组件与 TSX/SCSS 复用专题审查

日期：2026-10-02
状态：审查完成 / 优化候选，未实施
基线：当前未提交工作树，沿用[专题计划](../plans/specialized-audits-2026-10-02-plan.md)的只读边界

## 结论

存在 **4 个可由现有公共 API 承载的复用家族、17 个源码候选实例**，涉及 **12 个 TSX 文件、13 个组件定义、8 个 SCSS 文件**。这不是 17 个功能缺陷，也不意味着替换没有交互或外观风险。

原生标签命中 382 处，不能把它们全部当重复组件。库不存在的控件、领域树行、非模态 Surface、代码编辑语义差异均排除。建议先收敛普通命令 Button 和业务 Dialog 壳，搜索清空及表单外观需要明确取舍。

## 扫描账目

| 范围 | 数量 | 含义 |
| --- | --- | --- |
| `app/pages/widgets/features` 的 TSX | 74 文件 | 生产层目录口径，排除 dev/archive/shared；未逐分支运行证明可达 |
| 原生 JSX AST | button 235、input 93、textarea 24、select 27、dialog 3 | 共 382 个源码调用点；循环中的一个调用点只计一次 |
| 已有公共组件 JSX AST | Button 16、IconButton 25、SearchField 6、Dialog 13、PanelTabs 12、FileTree 15、MasterDetailWorkbench 10、AssetWorkbenchLayout 2、ConversationMessageChrome 2 | 证明已有实际复用，不是完整组件使用总数 |
| 上述生产层与 `shared/ui` 的 SCSS | 55 文件、2052 个规则节点 | 另读全局 CSS、UI 库 CSS 与 shared mixin |
| 跨文件完全相同的直接声明序列 | 12 组，每组至少 5 条声明 | 未展开嵌套、未计算级联；不等于 12 个重复组件 |
| 省略三声明组合 | 42 处、17 文件 | 既有 mixin 还设置 min-width，不是全部可无差别机械替换 |
| 人工语义核对后的候选 | 4 家族、17 实例 | 以下明确子集，不外推到全部标签或所有样式 |

统计使用 TypeScript JSX AST 与已安装 PostCSS 的规则/声明节点，仅仅读取。没有运行 lint、build、测试或浏览器；对本专题而言，静态语义和样式所有者核对是主要证据。

## 当前能力

[loom-ui public API](../../../packages/loom-ui/src/index.ts) 提供 Button、IconButton、TextInput、Textarea、Checkbox、Toggle、SearchField、Field、Dialog、Radix Menu、SkeletonText、StatusIndicator；统一基础样式在 [styles.css](../../../packages/loom-ui/src/styles.css)。

Client `shared/ui` 已有 PanelTabs、FileTree、LongTextEditor/CodeMirrorEditor、MasterDetailWorkbench、AssetWorkbenchLayout、WindowColumnLayout、ConversationMessageChrome。shared 样式有 `text-ellipsis` 和 `loom-underlined-field(s)`。

当前没有通用 Select、Popover、EmptyState。TextInput 固定 text 类型，不能替代 password/file/date/range 等原生输入。

## 复用候选

### UI-001 · 搜索组合重复：4 实例

完整候选范围：

- [preset-workbench.tsx](../../../apps/studio-client/src/widgets/preset-workbench/preset-workbench.tsx) 工具搜索，991 行。
- [preset-anchor-picker.tsx](../../../apps/studio-client/src/features/context-assets/ui/context-asset-detail/preset-anchor-picker.tsx) 锚点搜索，48 行。
- [macro-authoring-panel.tsx](../../../apps/studio-client/src/features/state-variables/ui/macro-authoring-panel.tsx) 宏作者搜索，236 行。
- [macro-inspector-panel.tsx](../../../apps/studio-client/src/features/state-variables/ui/macro-inspector-panel.tsx) 宏检查搜索，84 行。

本地实现分别组合 Search 图标、input，部分还写清空按钮；已有 [SearchField](../../../packages/loom-ui/src/component/search-field.tsx) 支持 value/onChange/onClear/clearLabel/containerClassName 与原生属性、ref。

相关 SCSS：[preset-workbench.module.scss](../../../apps/studio-client/src/widgets/preset-workbench/preset-workbench.module.scss) 的 `.toolSearch`（219 行）、[context-asset-detail.module.scss](../../../apps/studio-client/src/features/context-assets/ui/context-asset-detail/context-asset-detail.module.scss) 的 `.anchorSearch`、[state-variables-panel.module.scss](../../../apps/studio-client/src/features/state-variables/ui/state-variables-panel.module.scss) 的 `.macroInspectorSearch`。`.toolSearch` 还独立维护图标、input、清空按钮与 focus 状态。

**最小方向**：保留容器定位/间距，复用 SearchField，删除内部控件重绘；保留原 placeholder、ARIA、autofocus 和查询语义，不新增搜索状态层。

**取舍与验收**：工具搜索原本有清空行为；其余三处将新增显式清空入口，不能称作完全等价替换。SearchField 固定空值占位，也可能改变宽度、高度和 focus 色。需先确认该交互变化，验收键盘、清空、焦点和窄布局；未做视觉验收。

### UI-002 · 普通命令 Button 重写：6 实例

完整候选范围：

- [macro-entry-detail.tsx](../../../apps/studio-client/src/features/state-variables/ui/macro-entry-detail.tsx) 删除与保存，38 行附近，共 2 处。
- [state-authoring-panel.tsx](../../../apps/studio-client/src/features/state-variables/ui/state-authoring-panel.tsx) 保存（126 行）与删除（364 行），共 2 处、两个组件定义。
- [state-variables-panel.tsx](../../../apps/studio-client/src/features/state-variables/ui/state-variables-panel.tsx) 保存，418 行。
- [text-transform-panel.tsx](../../../apps/studio-client/src/features/text-transforms/ui/text-transform-panel.tsx) 刷新，572 行。

共 4 文件、5 组件定义、6 调用点。可以由已有 Button 的 size/variant/children/disabled/原生事件承载，明确保留原 type，避免提交行为改变。

相关 SCSS：[state-variables-panel.module.scss](../../../apps/studio-client/src/features/state-variables/ui/state-variables-panel.module.scss) 的 `.primaryActionBtn/.dangerActionBtn`（86 行）、[text-transform-panel.module.scss](../../../apps/studio-client/src/features/text-transforms/ui/text-transform-panel.module.scss) 的 `.refreshButton`（42 行），重复 hover、disabled、svg 尺寸与基础按钮外观。

**最小方向**：使用 Button small 的现有 variant，只保留定位类，删除替代后无消费者的控件状态规则；不改命令流程、不统一领域树行或所有图标按钮。

**验收**：disabled、focus-visible、提交/普通点击和错误路径保持，danger 常态颜色及尺寸由人工核对。收益是减少重复状态所有者，不承诺像素完全不变。

### UI-003 · 普通表单控件绕开库：5 实例

- [model-panel.tsx](../../../apps/studio-client/src/widgets/model-panel/model-panel.tsx) 名称（53 行）、Base URL（65 行）；两者当前都是默认 text input。
- [character-panel.tsx](../../../apps/studio-client/src/widgets/character-panel/character-panel.tsx) 名称、作者（104–105 行）与描述（106 行）。

四个输入可以用 [TextInput](../../../packages/loom-ui/src/component/text-input.tsx)，描述可用已有 Textarea；required/name/autocomplete/disabled/onBlur/onChange 均保留。已有外层 label 关联有效，不把复用说成自动修复无障碍问题。

相关 SCSS：[model-panel.module.scss](../../../apps/studio-client/src/widgets/model-panel/model-panel.module.scss) 的 `.createAccountForm input`、[character-panel.module.scss](../../../apps/studio-client/src/widgets/character-panel/character-panel.module.scss) 的 `.profileEditor`，并受 [global.css](../../../apps/studio-client/src/styles/global.css) 的下划线字段规则（262 行）影响。

**最小方向与风险**：先统一控件所有者；保留下划线还是采用库外观需要明确，随后才判断可删除样式。仅更换 JSX 不会自动消除级联覆盖，净删样式收益有限。Provider password 等特殊输入不在本组。

**验收**：名称/描述保存、Base URL blur 规范化、disabled/required 与标签保持；需计算样式/人工外观核对，不能把 TSX 减少当作 CSS 已收敛。

### UI-004 · 业务 Dialog 基础壳重复：2 实例

- [log-viewer.tsx](../../../apps/studio-client/src/widgets/log-viewer/log-viewer.tsx) 日志报告，253 行。
- [resource-reference-dialog.tsx](../../../apps/studio-client/src/features/resource-references/resource-reference-dialog.tsx) 资源引用，46 行。

本地维护 showModal/close/cancel、标题/动作壳，可用 [Dialog](../../../packages/loom-ui/src/component/dialog.tsx) 的 open/onClose/title/headerActions/actions/className。业务读取、复制、定位、隐私提示和内容状态不迁入库。

相关 SCSS：[log-viewer.module.scss](../../../apps/studio-client/src/widgets/log-viewer/log-viewer.module.scss) 的 `.report`（27 行）、[resource-reference-dialog.module.scss](../../../apps/studio-client/src/features/resource-references/resource-reference-dialog.module.scss) 的 `.dialog/.header/.actions`。

**最小方向与风险**：统一 modal 开闭和标题关联，保留业务宽高、正文样式和默认 backdrop 不关闭。当前已经使用原生 modal，不是缺失焦点陷阱。公共 Dialog 新增包裹层与滚动布局，path/status 应放业务内容，不为维持旧 DOM 而扩展公共 API。

**验收**：Escape/关闭、动态标题、引用行定位、报告复制、焦点恢复和窄屏滚动正常；视觉未验收。

## 不直接替换的边界

- 外观设置 Tabs 确有局部键盘与样式实现，但 [background-materials-view.tsx](../../../apps/studio-client/src/widgets/settings-panel/background-materials-view.tsx) 的 tabpanel 关联需要每项 id/aria-controls；现有 PanelTabs 不提供这些能力。列为 1 组能力差异，不纳入 17 个候选。
- [state-variables-panel.tsx](../../../apps/studio-client/src/features/state-variables/ui/state-variables-panel.tsx) 的布尔行（216 行）包含 switch、true/false 文字与整行点击，Toggle 无 children，不能原样替代；当前已有 switch/aria-checked。
- 现有编辑器根语言为 Markdown，JS/YAML 能力在围栏内；没有根语言参数。不能将所有裸 JS/JSON/YAML textarea 无差别换成 LongTextEditor。
- 非模态 Extension Focus Surface、锚定日历 Popover 不等价于业务 Dialog；Select、特殊输入和 EmptyState 没有对应公共 API，原生实现不构成绕开库。
- Workbench、FileTree、消息 chrome 已经有实际消费者。领域视图相似不等于适合万能组件。
- 12 组声明序列重复与省略三声明命中仅作统计线索；无计算样式、继承与实际消费者证据，不提出批量 CSS 合并。dev/archive 的样例不计生产重复。

## 验证与完成边界

完成静态 AST/SCSS 统计、现有公共 API 与候选交互核对。主 Agent 定向复核了 SearchField 的清空行为、TextInput 固定类型、普通表单属性及 Dialog 包裹/开闭语义，未重复全量扫描。

没有修改实现，未证明全部候选像素/DOM 等价；未运行浏览器、交互测试、计算样式或人工视觉验收。以上为有明确范围的整合候选，不是新组件开发授权。后续若需要扩展 PanelTabs/编辑器公共契约，应单独确认，不混入本轮简单替换。
