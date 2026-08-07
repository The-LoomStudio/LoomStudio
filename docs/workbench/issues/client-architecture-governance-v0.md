# Client 架构债务清单 v1

> **状态**：Open Issues
> **最后核对**：2026-08-07
> **审查基线**：`d71840e Add scoped async operation tracking and notifications`
> **适用范围**：`apps/studio-client/src`

本文是 Studio Client 当前待处理问题的唯一收束台账。只记录已有可复现链路、明确的重复实现或已与 Guide 冲突的事实；产品取舍和尚未落地的能力不在此重复立项。

## 本轮审查结论

- 未发现 P0，未发现 Client 绕过 Transport、跨层反向依赖或需要新状态框架的证据。
- `useStudioState` 仍只组合 feature hooks；`StudioPanelStage` 对 inactive panel 的 memo 策略、拖拽宽度的 ref/state 配合、两处独立 localStorage adapter 均有明确责任，暂不抽象。
- `lint`、`test`（25 files / 72 tests）与 `build` 在本轮修复后通过。build 的主 chunk 约 565 kB 警告仍存在，但本轮没有证据表明由以下问题引入，暂不立项。

## 本轮修复状态

1. **已关闭**：条目 3、4、6、7、11、12、13、14。
2. **审计更正**：条目 5 的原实现已经正确，仅补回归测试后撤销问题结论。
3. **继续开放**：条目 1、2、8、9、10；这些需要领域或产品讨论，不在本轮批量改动。

## 已从旧议题关闭

旧版文档中的以下工作已经完成，因此不再作为待办保留：

- raw `bridge.call()` 已收口到 typed API client；
- `useStudioState` 已拆出 Cards、Session Runtime、Provider Settings、Context Assets、Renderer 等 feature hooks；
- Context Assets 的 tree、normalization、projection order、projection view 等算法已迁出 widget；
- `ApiPanel` 已拆出 Provider Account 与 Model Profile 列表；
- 测试目录和对应 Guide 路由已经建立。

上述边界现在由以下文档维护：

- `docs/guide/project-structure.md`
- `docs/guide/code-review.md`
- `docs/guide/code-style.md`
- `docs/guide/ui-design.md`

## P1：领域归属需要先定名

### 1. `context-assets` 已超出 Context Asset CRUD

当前目录同时承载：

- Context Asset 树与持久化编辑；
- Projection Order / Projection View；
- Activation 与 lifecycle capability 编辑；
- Context Workbench 和 Preset Workbench 共用的 prompt composition view-model。

这不一定需要拆成更多目录，但 `context-assets` 已不足以准确描述全部职责。需要先决定这些能力属于：

1. 更上层的 Prompt Workspace / Prompt Composition feature；或
2. Context Asset 的完整编辑能力，继续保留现名；或
3. Context Asset 与 Projection / Activation 两个边界。

在术语确定前，不做批量移动。关闭条件是目录名、公开入口和两个 Workbench 的依赖方向能用一句话解释清楚。

### 2. Provider、Model 与 Agent Runtime Profile 边界混合

当前证据：

- `features/provider-settings/model/use-provider-settings.ts` 同时管理 Provider Account、Model Profile 和 Agent Runtime Profile；
- `entities/provider.ts` 定义了 `AgentRuntimeProfile`；
- `widgets/preset-workbench/agent-runtime-manager.tsx` 管理 Agent Runtime Profile UI。

需要先决定 Agent Runtime Profile 更接近 Provider Settings、Preset，还是独立的 Agent Runtime feature。关闭条件是 entity、state hook 和 UI 三处使用同一领域归属，不再靠跨目录位置暗示不同答案。

## 本轮已关闭的 P1

### 3. 源码文件大小写在大小写敏感文件系统失效

- **状态**：Closed（2026-08-07）
- **证据**：Git 曾跟踪 `App.tsx`、`en-US.ts`、`zh-CN.ts`，但对应 import 使用小写；本仓库要求所有源码文件使用 kebab-case。
- **影响**：macOS 默认大小写不敏感，因此本机 build 可以通过；Linux CI、容器或其他大小写敏感文件系统会无法解析入口模块。现有“统一 kebab-case”结论也被该文件反证。
- **关闭证据**：三个文件均通过临时文件名完成 case-only rename；Git 索引不再含大写源码文件，Client build 通过。

## P2：随下一次相关功能收敛

### 4. Asset 选择事实没有收口，Undo/Redo 的定位可能停留在错误 Detail

- **状态**：Closed（2026-08-07）
- **证据**：Context / Preset Workbench 从 Zustand `assetLayouts.*.views[workspaceId].selectedId` 读取当前选择；但 `use-context-assets.ts` 仍持有另一份 `selectedId` state。`use-studio-state.ts` 的 `refreshHistoryAnchor()` 只更新旧 hook 的 `setSelectedId()`。
- **触发链路**：编辑 Asset A → 在树中选中 B → Undo A → 数据已恢复 A，但 UI 的 Detail 仍由 Zustand 选择 B。
- **最小处理**：以 Zustand 为唯一选择事实；Undo/Redo 按节点类别写入对应 `preset` / `resources` workspace 的 selectedId，并删除不再消费的 hook state。
- **文档同步**：`docs/architecture/ui/workspace-shell.md` 的持久化状态说明需要补写 `selectedId`，使其与 store 实现和测试一致。
- **关闭条件**：上述链路会把 Detail 回到 A；无第二份未消费的 Asset 选择 state；持久化文档与 store 相符。

### 5. 审计更正：分域异步状态原本已经会清除旧错误

- **状态**：撤销问题结论（2026-08-07）
- **更正证据**：finish 分支没有展开旧的 scoped status；最新成功计算出 `undefined` 后返回的新 status 不含 error，因此旧错误会被移除。原审计误读了对象展开层级。
- **处理**：实现无需修改；新增“失败后同域最新成功会清错”回归测试，连同既有“旧成功不能清除较新失败”测试锁定语义。

### 6. Shared `FileTree` 的可访问性语义相互冲突

- **状态**：Closed（2026-08-07）
- **证据**：拖拽 handle 展开 dnd-kit 的 attributes/listeners 后又标记 `aria-hidden="true"`；展开按钮可聚焦却同样 `aria-hidden`，没有本地化名称且遗漏 `type="button"`。此外 treeitem 没有按 Tree 约定提供完整的 level/expanded 语义。
- **影响**：键盘与辅助技术用户会遇到隐藏但可操作的控制项，或无法得知节点是否可展开。这与 UI 无障碍约定冲突。
- **最小处理**：保留原生 disclosure button，补“展开/收起”本地化 label、`type` 与 `aria-expanded`；drag handle 要么成为有正确键盘说明的可访问控件，要么禁用其键盘拖拽语义，不能同时暴露 listeners 与 `aria-hidden`。
- **关闭条件**：键盘可进入并操作展开控件，读屏可获知状态；drag handle 的可访问树与实际交互一致。

### 7. 对话刻度只裁剪可视区，仍为整段会话创建全部 tick

- **状态**：Closed（2026-08-07）
- **证据**：`ConversationNavigator` 将 `visibleCapacity` 限制为最多 100，但 JSX 仍对全部 `props.items.map()`；CSS 仅通过 overflow 裁剪视觉结果。
- **影响**：1000 楼会话仍创建 1000 个 button，hover、active 与浏览索引变动均重算全部 tick，和“右侧一次约展示 100 条”的产品目标不符。
- **最小处理**：只映射围绕当前浏览中心的可见窗口，并保留很小 overscan；不引入虚拟列表依赖。
- **关闭条件**：1000 条输入时 DOM tick 数受可见窗口上限约束，鼠标/滚轮/键盘导航仍可到达首尾和 marker。

### 8. `app/utils.ts` 混合三个 UI concern

文件同时包含 Composer 提示、Timeline 空状态和 Run Inspection 数据读取。当前只有少量纯函数，不值得立刻增加文件；下一次任一 concern 增长时，应把函数移到对应 feature model，而不是继续向 `app/utils.ts` 追加。

### 9. Renderer PoC 的最终归属未定

当前同时存在 renderer entry、SDK、typed API、feature hook、resource widget 和 rendering lab。PoC 阶段允许这种形态；进入正式 Renderer 产品化前，需要决定哪些是平台 SDK、哪些是 Studio 调试工具、哪些是最终用户功能。

### 10. 交互元素的语义与可访问性未统一

当前仍有 `<header onClick>`、`<div onClick>`、`<span onClick>`。这会缺少键盘操作、焦点语义和默认可访问性。

处理顺序：

1. 新代码优先使用原生 `button`；
2. 修改相关组件时顺手替换现有非语义交互元素；
3. 形成稳定模式后再引入 `jsx-a11y` 门禁，避免一次性噪声改造。

## P3：同批清理，不增加通用框架

### 11. Context / Preset Workbench 复制同一套 Context Asset 树逻辑与 Detail 样式

- **状态**：Closed（2026-08-07）
- **证据**：两个 widget 均定义 `renderTreeIcon`、`renderLifecycleIndicator`、`canToggleEnabled`、`isReadOnlyTreeNode`，`readTreeActions` 也只有少量 projection view 差异；两个 SCSS Module 还复制了完全一致的 `.detailColumn`、`.emptyState` 与移动端规则。
- **最小处理**：仅抽 Context Asset 专属 tree helper 和共享 Detail 容器样式；保持两个 Workbench 各自的 projection、toolbar 与 detail composition，不创建 Workbench Factory。
- **关闭条件**：相同节点类型、lifecycle、可编辑性与基础 action 的渲染规则只维护一处。

### 12. RPC 可选字段过滤 `jsonObject()` 在四个 feature hook 中重复

- **状态**：Closed（2026-08-07）
- **证据**：`use-cards`、`use-session-runtime`、`use-context-assets`、`use-provider-settings` 均保有等价的 `Object.entries(...).filter(... !== undefined)` helper。
- **最小处理**：在 `shared/api` 提供一个仅做 undefined 过滤的 typed helper；不做通用 RPC builder。
- **关闭条件**：四处只剩调用，边界上的 `ClientJsonValue` 类型不变。

### 13. `useStudioNavigation.openAsset()` 没有调用方

- **状态**：Closed（2026-08-07）
- **证据**：仅定义并从 hook 返回，无 UI 或测试调用；当前 Asset 选择刻意只更新 Zustand，不会逐项改 URL。
- **最小处理**：删除未使用 API，待真正需要“主动生成 Asset 深链”的交互时再加回。
- **关闭条件**：navigation hook 的公开返回值不含无调用的 `openAsset`。

### 14. 文档台账有两处陈旧结论

- **状态**：Closed（2026-08-07）
- **证据**：本文件旧版声称源码已统一 kebab-case，但 P1-3 反证；`periodic-code-review.md` 仍保留“日志超过 500 条无法查看最新日志”的 Open P1，而现有 `log-viewer-model.ts` 已沿 cursor 读取，`log-viewer.test.ts` 覆盖多页读取。
- **最小处理**：本条已修正 kebab-case 表述；同步在周期审查台账关闭过时的 Logs Viewer P1，并保留历史审查记录。
- **关闭条件**：不再有把已修复日志缺陷标为 Open 的文档，也不再有与代码冲突的命名结论。

## 本轮明确不做

- 不因文件行数单独拆组件；
- 不创建 Base Hook、通用 Feature Factory 或新的状态框架；
- 不在领域术语未确定时批量重命名目录；
- 不把 widget 的局部 tab、展开状态和轻量渲染映射强行抽离。
