# i18n 国际化与 ARIA 无障碍审查报告 (i18n & Accessibility Review)

## 审查目标

全面排查 Loom Studio 前端（`apps/studio-client/`）中的 **i18n 双语字典质量、死 Key 冗余、中英文硬编码** 以及 **ARIA 无障碍可访问性（Accessibility）支持**。

---

## 1. i18n 国际化审查结果

### ✅ 亮点：双语字典 100% 对称
- `zh-CN` 共 409 个 Key，`en-US` 共 409 个 Key。
- 双向对比检查结果：`zhMissingInEn = []`，`enMissingInZh = []`。没有出现单边漏译的情况。

---

### 🔴 [高] 废弃死 Key 泛滥（51 个未使用的废弃词条，冗余度 > 12%）

**文件：**
- [`apps/studio-client/src/shared/i18n/zh-cn.ts`](file:///Users/macbookair/Desktop/LoomStudio/apps/studio-client/src/shared/i18n/zh-cn.ts)
- [`apps/studio-client/src/shared/i18n/en-us.ts`](file:///Users/macbookair/Desktop/LoomStudio/apps/studio-client/src/shared/i18n/en-us.ts)

**现象分析：**
经代码全局引用扫描，双语字典中共有 **51 个 Key 在整个前端代码库中已无任何引用**。主要是由于历史版本重构（如 Session 迁移为 Timeline、旧 Branch 概念重构、Workbench 布局调整）后未同步清理旧词条所致：

| 废弃词条类别 | 具体死 Key 清单 (共 51 个) |
|---|---|
| **旧 Session 体系残留** | `session.title`, `session.new`, `session.card`, `session.session`, `session.branch`, `session.head`, `session.agent`, `session.none`, `session.empty` |
| **旧 Branch 概念残留** | `branch.main`, `branch.head`, `branch.emptyHead`, `branch.fork`, `branch.active`, `agent.branchLabel`, `agent.branchNumber`, `agent.fork` |
| **旧 Context 工作台残留** | `context.title`, `context.collapseExplorer`, `context.expandExplorer`, `context.projectionLabel`, `context.projectionTitle`, `context.zoneEmpty`, `context.projectionMeta`, `context.sortMeta`, `context.reasonDefault`, `context.actionConfig` |
| **旧 Timeline 废弃字段** | `timeline.titleFallback`, `timeline.createSessionHint`, `timeline.activeBranch`, `timeline.role.user` |
| **旧 Composer 废弃字段** | `composer.activation.label`, `composer.activation.mode`, `composer.activation.mode.draft`, `composer.activation.mode.finalize`, `composer.activation.tags` |
| **其他未引用 Key** | `app.title`, `app.subtitle`, `logs.namespace`, `logs.namespacePlaceholder`, `character.refresh`, `character.sessionAgoMinutes`, `character.sessionAgoHours`, `character.sessionYesterday`, `preset.rename`, `provider.apiKeyKeepPlaceholder`, `provider.keys`, `provider.keyConfigured`, `agent.toolCompleted`, `agent.toolArguments`, `error.expectedNumber` |

**瘦身建议：**
- 批量从 `zh-cn.ts` 和 `en-us.ts` 中删除这 51 个死 Key，直接精简约 **100 行** 字典文件体积。

---

## 2. ARIA 无障碍（Accessibility）审查结果

### ✅ 亮点：公共组件无障碍基础扎实
- **`<Dialog />`**（`shared/ui/dialog/dialog.tsx`）：
  - 基于原生 HTML5 `<dialog>` 实现；
  - 正确绑定 `aria-labelledby={titleId}` 与 `aria-describedby={descriptionId}`；
  - 具备 `restoreFocus` 焦点恢复与 `Escape` 监听。
- **`<FileTree />`**（`shared/ui/file-tree/file-tree.tsx`）：
  - 实现了标准 Roving Tabindex 键盘导航（上下左右键折叠展开）；
  - 提供了 `getDisclosureLabel` 与 `getDragLabel` 用于读屏器播报。

---

### 🟡 [中] 关键无障碍缺陷清单

#### 1. 纯图标按钮缺少 `aria-label`（屏幕阅读器无法识别按钮动作）
- **文件：** [`widgets/chat-composer/chat-composer.tsx`](file:///Users/macbookair/Desktop/LoomStudio/apps/studio-client/src/widgets/chat-composer/chat-composer.tsx)
  ```tsx
  <button className={styles.previewButton} onClick={props.onPreviewPrompt}>
    <Sparkles size={14} />
  </button>
  ```
  - **问题**：该按钮仅包含 `<Sparkles />` SVG 图标，既无文本内容，也缺少 `aria-label` 或 `title`，视障用户通过读屏器无法得知此按钮为“预览 Prompt”。
  - **修复**：添加 `aria-label={props.t('chat.previewPrompt')}` 及 `title` 提示。

#### 2. 手写弹窗破坏模态语义（`CharacterGroupDialog`）
- **文件：** [`widgets/character-panel/character-panel.tsx` L478](file:///Users/macbookair/Desktop/LoomStudio/apps/studio-client/src/widgets/character-panel/character-panel.tsx)
  - **问题**：未复用公共的 `<Dialog />`，使用普通 `<div>` 模拟弹窗，缺少 `role="dialog"`、`aria-modal="true"` 和 `aria-labelledby`，屏幕阅读器无法将其识别为对话框，且键盘焦点容易逃逸至背景页面。
  - **修复**：迁移至公共 `<Dialog />`。

#### 3. 动态通知（Toast / 状态变化）缺少可访问性播报
- **文件：** 异步操作完成与剪贴板复制提示（如 `copyState === 'copied'`）。
  - **问题**：复制成功仅通过局部图标变化（Checkmark）表达，缺少带 `role="status"` 或 `aria-live="polite"` 的隐式文本区域，视障用户无法感知复制是否成功。

---

## 3. 审查收益汇总

| 优化维度 | 问题描述 | 预期收益 |
|---|---|---|
| **i18n 冗余清理** | 51 个无用死 Key 滞留双语字典 | 消除双语字典中 100+ 行死代码 |
| **按钮可访问性** | 图标按钮缺少 `aria-label` | 修复视障读屏器无法识别按钮动作问题 |
| **弹窗语义规范** | `CharacterGroupDialog` 手写 div 弹窗 | 恢复标准模态对话框 ARIA 契约 |
| **动态反馈** | 复制与 Toast 缺少 `aria-live` | 提升异步操作与剪贴板反馈的可感知度 |
