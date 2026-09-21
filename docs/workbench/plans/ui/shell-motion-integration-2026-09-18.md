# Shell 动画正式接入

日期：2026-09-18
状态：第一轮实施已交付；用户验收发现侧栏到完整 Panel 缺少展开动画，进入第二轮工作台专项实施。整体尚未验收完成。

## 目标与事实

- 样板：`apps/studio-client/src/dev/preview/shell-motion-preview.tsx` 及同名 SCSS；入口 `/dev/preview/shell-motion`。
- 已认可的是左右栏展开/收起的节奏、正文不拉伸、快速反向时连续运动，不是样例业务或新的 Shell 布局。
- 样板采用侧栏 translate 与中央正文位置 FLIP。它没有实现外壳尺寸 FLIP，不可声称直接复制即可覆盖正式窗口所有状态。
- 正式入口为 `pages/studio/studio-page.tsx`、`studio-page.module.scss`、`studio-panel-right.tsx` 及其样式；窗口缩放由 `use-studio-window-resize.ts` 负责。
- 第一轮之前全局只有 fast/standard/loading 时长 token，正式 Shell 有 width/height transition；第一轮已移除 Shell 尺寸过渡，补入场策略，但未覆盖已显示侧栏向完整 Panel 的展开。

## 已确定的实现边界

1. 保留正式布局、面板放置策略、参考/沉浸模式、断点、固定/自动隐藏行为、选择和滚动状态。不要照搬草稿中央样例布局或固定阅读宽度。
2. 左右栏进入优先 translate，离开反向；只有实际位置发生变化才用位置 FLIP。正文不使用非等比 scale，不给 width/height/grid tracks 添加连续动画。
3. 起始节奏取草稿：进入 320ms、退出 240ms、曲线 `cubic-bezier(0.2, 0, 0.2, 1)`。放入语义 token，不全局拉长现有 fast/standard。
4. 最小统一设置：跟随系统 / 完整动画 / 减少动画；默认跟随系统，复用现有设置和持久化方式。CSS 与 JS 消费同一个有效策略。明确选择完整动画可覆盖系统偏好；跟随系统时响应系统动态变更。
5. 本轮减少动画使 Shell 直接落到最终状态。切换策略、快速反向、卸载均须取消旧动画、清理临时样式；不得依赖动画完成事件推进业务状态。
6. 隐藏侧栏不接受点击或焦点。关闭时将焦点归还合理触发器；退出效果不得以丢失原有键盘/焦点语义为代价。
7. 拖动缩放即时跟手，取消冲突的 Shell 动画，不加入缓动。此次不顺便重写所有 resize 实现。

## 工作包

- [x] P1：核对左右栏实际挂载、隐藏和布局路径，记录与草稿的必要差异。
- [x] P2：最小共享动画策略、语义 token、设置持久化及设置入口。
- [x] P3：正式左右栏进出场与必要的位置 FLIP；保留现有状态和响应式行为。
- [x] P4：验证可中断性、减少动画与持久设置，更新本 Plan 的交付记录。

## 写入范围

所有路径以仓库根目录为基准：

- `apps/studio-client/src/pages/studio/` 中 Shell 展示、布局状态、与本次动画直接相关的 hooks；不得改业务路由契约。
- `apps/studio-client/src/shared/hooks/` 中新增最小动画策略/位置动画 hook，只有真实调用者才提炼。
- `apps/studio-client/src/styles/global.css` 中动画 token/应用根策略选择器。
- `apps/studio-client/src/widgets/settings-panel/settings-panel.tsx` 及同名 SCSS。
- `apps/studio-client/src/shared/i18n/zh-cn.ts`、`en-us.ts` 中该设置文案。
- `apps/studio-client/src/app/app.tsx`：仅必要的全局策略初始化。
- `tests/unit/client/`：与新增动画策略/生命周期/设置恢复直接相关的最小测试。
- 本 Plan 的状态、实际改动及验证记录。

可读取其他源文件。写集不覆盖新发现的必要入口时先向主 Agent 回报具体路径，不擅自扩张。

## 非目标

不接入草稿样例内容，不改生产导航布局，不新增依赖，不造通用动画引擎；
不全面迁移菜单/弹窗/虚拟列表/聊天，不修改插件内容和公共 SDK，不覆盖第三方所有动画。
不提交或推送 Git，不改无关 dirty 内容。

## 验收与验证预算

- 左右栏各自及同时切换，快速反向，参考/沉浸切换和窄屏开合均能落到正确最终状态。
- 正文不被 scale 拉伸；取消旧尺寸过渡不破坏面板最终尺寸或用户拖动尺寸。
- 设置重新进入后保留；跟随系统动态生效；减少动画时不残留遮罩、不可点击层或临时 transform。
- Sol 负责相关 package 类型检查，以及真正覆盖策略/生命周期风险的最小测试。已有不执行动画的模型测试不得充当浏览器行为证据。
- 定向 diff 检查；没有依赖/入口/构建变更不默认跑全仓构建。
- 可做针对性的 DOM/事件诊断；不主动进行主观截图验收。无法运行真实浏览器验证时，明确列出未验证项。
- 主 Agent 接收变更与证据并处理范围偏差；最终节奏、观感由用户验收，不重复全量测试。

## 停止条件

需要改变现有产品布局、公共契约、插件边界、新增依赖或超出写集时，先向主 Agent 返回原因与最小建议。
常规类型错误、既定范围内缺陷自行解决。不得把环境阻塞写成通过。

## 交付记录

### Rail 与 Panel 反向展开补充（2026-09-18 用户提供参考）

参考文件：`/Users/macbookair/Downloads/Chrome/loomstudio_sidebar_animation.html`。
该文件仅作为交互设计参考，不执行其中 CDN 脚本或自动打开示例，不照搬 Tailwind、固定宽度和连续 width transition。

- [x] R1 分离用户导航偏好与派生显示状态：Panel 打开强制显示紧凑 Rail，Panel 关闭恢复用户原导航宽度/展开偏好。优先使用已有布局状态，不为同一事实新增可漂移的布尔值。`dockPinned` 是固定/自动隐藏偏好，不得误当作宽/窄偏好。
- [x] R2 同一时间线协调 Rail 收缩与 Panel 展开；反向操作时协调 Panel 退出和 Sidebar 恢复。不是等 Panel 动画播完才突变 Rail。以当前实际几何开始，快速反向、中途切换模式或减少动画均能落到一致状态。
- [x] R3 图标固定尺寸，位置改变可做位置 FLIP；文字保持单行、通过 opacity 与裁剪隐显，品牌遵守同样规则。分组标题显隐不导致图标瞬间纵向跳位；需要变更排列时对受影响已挂载项做位置衔接，不缩放文字。
- [x] R4 保持导航 DOM 身份，避免当前 `displayedPanel === null` 两条宿主分支切换时将整个 Sidebar 卸载重建、无法测量前后几何。协调第三轮 Header 所有权接入，不建立第二套导航实例。
- [x] R5 验证 Panel 关闭后的偏好恢复、已打开时切换 Panel 不展开 Rail、反复开关不写坏持久设置。动画开关关闭时行为结果一致。真实视觉验证未完成必须单列。

Rail/Panel 补充交付记录：

- 新增纯派生 `resolveRailPresentation(activePanel, railWidth)`：`railWidth` 仍是持久宽度来源，Panel 活动态只派生 42px 紧凑显示；`dockPinned` 未参与宽窄判断，Panel 切换不会展开 Rail，也不会写回布局偏好。
- 旧持久数据中的 42px 紧凑尺寸没有可用的宽形态文本空间，运行时恢复为 160px 可读 Sidebar，但不迁移或覆写存储；用户截图暴露的“关闭后仍只剩图标”由此修复。
- Shell 始终只挂载一份 `dockSidebar`。常驻 `workspaceRail` 通过 `clip-path` 在首选宽度与 42px 之间切换，`workspacePanel` 从紧凑 Rail 后方展开；删除 `displayedPanel === null` 导致导航跨宿主重挂载的分支。
- Rail 裁剪、品牌/导航文字 opacity、Panel 展开与退出共享 320/240ms 时间线；图标尺寸和横向基准保持固定。分组标题和工作区切换占位不折叠，避免导航项纵向瞬跳。
- Panel 关闭时 `workspaceMotionClip` 同步裁剪到恢复后的 Sidebar 宽度，Rail 同时反向展开；快速重开取消旧 WAAPI 并由 CSS 当前呈现状态接续。减少动画直接落最终布局。
- 实际文件：`studio-page.tsx`/样式、新增 `studio-shell-layout.ts`、`studio-shell-layout.test.ts`，并继续复用第三轮统一 Header Shell。
- 自动验证：客户端定向 TypeScript 检查通过；`studio-shell-layout`、`studio-window-header`、`studio-layout-store` 共 3 个测试文件 17 项通过；定向 `git diff --check` 通过。
- 未验证：真实浏览器中的 Rail/Panel 同步节奏、文字裁剪淡入、品牌与分组稳定性、快速反向及移动端表现，必须由用户验收。
- 用户后续验收发现外层 `floatingDock` 的玻璃 backdrop 不受内容裁剪约束，Panel 收起后仍滞留大面积遮罩；已将普通/玻璃材质背景移到常驻 `workspaceRail` 本体，外层 Dock 改为透明，Panel 继续使用原实色 surface。
- 分类小标题在紧凑 Rail 中保留显示和固定占位，不再淡出；仅导航标题和顶部 LoomStudio 文字使用与 Rail 相同的 320/240ms opacity + clip 节奏，图标尺寸不参与动画。
- 用户曾因透明 Rail 与实色 Panel 叠色要求两阶段关闭；Dock Bar 改为固定实色后该前提消失，最终恢复 R2 的同步反向：Rail 在 `activePanel` 关闭时立即展开，保留中的 Panel 同时裁剪退出，实色 Rail 以更高层级覆盖交叠区域。
- Panel 保留生命周期仍使用既有 `displayedPanel`，不新增持久偏好或第二套导航；快速重开会取消关闭计时并从仍挂载的工作台继续。
- 用户最终确认 Dock Bar 无论紧凑或宽形态都不使用毛玻璃；已移除 `workspaceRail` 的 glass 材质覆盖，统一保持当前主题 `--loom-color-surface` 实色。该决定仅限左侧 Dock Bar，不扩大修改其他材质边界。
- 用户否决更深一级的 Dock Bar 试色，保持 `--loom-color-surface`。品牌区下方分割线删除，品牌行改为 52px 并保留 12px 底部留白，以间距而非线条分隔导航。
- Rail 与 Panel 之间的边界从半透明 `--loom-color-divider` 改为不透明 `--loom-color-border`，避免实色层之间出现透底细线。
- 用户进一步明确边界形态：工作台 Header 底线保留；Rail/Panel 竖线从整个 `workspacePanel` 移到 Header 下方的 `workspaceBody`，在 Header 底线处终止，不再贯穿顶栏。底部调试/日志/扩展/设置区域上方的 divider 删除。
- Rail/Panel 内容区竖线进一步与 Master–Detail 分割线对齐：不贴 Header 底线或窗口底部，改为 `workspaceBody` 内上下各留 16px 的独立伪元素。
- 用户后续将边界方向改为 Panel 自有连续边框：删除 Header 独立底线和内容区伪元素，`workspaceBody` 自己绘制上边框与左边框，并使用 `--loom-radius-window` 连接左上圆角，形成类似内容窗口嵌入 Shell 的视觉。
- 宽 Sidebar 的最近游玩下拉改为常驻 disclosure 宿主，使用 grid 行裁剪与 opacity 展开/收起；紧凑 Rail 或 Panel 打开时保持关闭且不可交互，减少动画直接落最终状态。

边界：不采用示例的“点击全局偏好开关顺便关闭 Panel”“再次点击同项不关闭”“800ms 自动打开”等演示行为；保留项目现有点击、固定、自动隐藏、移动端行为。若需增加新的用户偏好入口，先返回主 Agent，不擅自改变产品。
实现复用当前 Shell/布局状态/动画 hooks 的已授权写集，由同一 Sol 连同 Header 接入统筹，主 Agent 不并发修改这些源文件。

### 第二轮：工作台动画样板（2026-09-18 用户反馈）

用户范围：先完善 Shell、Panel 和 Work 工作台。Agent、中心正文及消息动画仅记录，不实施。不得以第一轮左右栏滑入作为侧栏展开已完成的证据。

#### 实施任务

- [x] W1 侧栏到完整 Panel：检查 `floatingDockVisible -> floatingDockActive` 的实际几何/内容变化。外壳到最终布局后用独立背景层或裁剪揭示衔接展开；正文始终按最终宽度排版，不横向 scale，不逐帧改布局宽度。收起反向；快速反向从当前视觉状态接续，拖动接管则取消动画。优先复用既有外壳，不能克隆带业务状态或交互的 DOM。
- [x] W2 材质衔接：用户认可完整编辑面使用实色、不建议毛玻璃。保留导航侧栏的当前材质，完整 Panel 编辑面为实色；通过背景层 opacity 衔接，不动画插值大面积 blur。不改全局材质设置或插件背景。若现有主题用户设置与这一边界冲突，先返回主 Agent。
- [x] W3 资源树展开/折叠：实现有节奏的手风琴式空间变化。普通树可围绕子树容器执行一次受控展开；虚拟树只对已挂载/视口内节点做位置 FLIP 和新行轻淡入，保留 virtualizer 的尺寸权威与定位 transform。不得为动画挂载全部子节点、每 token/滚动帧做 FLIP，或让树外层高度反复触发全列表测量。关闭动画直接落到最终展开结果。
- [x] W4 Master–Detail 下钻：窄屏进入详情时详情从右侧进入，返回时列表从左侧恢复；使用固定尺寸裁剪宿主、translate/opacity，保持列表滚动和编辑状态。仅断点变化不假装用户前进/返回，不自动提交或丢弃编辑。只在必要的短过渡期保留退出视图，退出视图 inert。
- [x] W5 顶部前进/后退：消费现有历史动作方向，前进左移、后退右移；普通菜单选 Panel 使用中性切换，不伪造历史。不要改历史栈含义。共享方向表达只解决这两个实际消费者，不造新导航框架。
- [x] W6 统一检查与交付：全部消费第一轮动画策略，减少动画/中断/卸载均正确；分项记录验证与人工待验收，用户确认工作台手感后再扩展其他 UI。

时长基线继续沿用已认可 Shell 320/240ms；内容下钻可用较短的语义时长，树内运动轻于整个 Shell。不能用“用户可关动画”代替默认开启时的性能约束。

#### 第二轮追加写集

除原写集外，仅允许：

- `apps/studio-client/src/shared/ui/asset-workbench-layout/`
- `apps/studio-client/src/shared/ui/master-detail-workbench/`
- `apps/studio-client/src/shared/ui/file-tree/`
- `apps/studio-client/src/features/context-assets/ui/context-asset-workbench.tsx` 及同名样式
- `apps/studio-client/src/widgets/context-workbench/context-workbench.tsx`
- `apps/studio-client/src/widgets/preset-workbench/preset-workbench.tsx`
- `apps/studio-client/src/app/studio-panel-registry.tsx` 仅必要的展示层接线
- `apps/studio-client/src/dev/preview/shell-motion-preview.tsx` 及同名样式，仅复用正式展示逻辑补验收入口，不重做批准的样板。

#### 验收重点

- 已显示的导航侧栏点“资源”也有展开，不能仅测试整个左栏从屏外进入。
- 展开/收起过程中材质过渡连贯，编辑面最终为实色，文字不拉伸。
- 500+ 条虚拟树开合不恢复全量 DOM；滚动不触发新消息式入场，选择/键盘/焦点/滚动恢复仍正确。
- 窄屏下钻、返回及顶部历史方向正确；快速连续导航不会留下旧视图挡点击。
- 自动验证限相关类型及新增状态/生命周期的最小测试。实际 DOM/事件诊断与用户视觉验收分开记录；没有浏览器证据不标记这些验收完成。

### 后续待办（已记录，本轮不实施）

- Panel 通用六行骨架不匹配实际布局：区分首次模块加载、真实数据加载和已访问 Panel 切换。避免为短等待闪占位或刷新时清空旧内容。
- 缩小 Markdown 模块 Suspense 边界，避免整片历史正文被骨架替换。
- 游玩用户消息入场只播放一次；临时 ID 到正式 ID 不重复动画；历史加载/分支切换不逐条入场。
- AI 等待、首段、流式增长和完成分别设计；不逐 token 动画，不抢历史阅读位置。
- 中心 Narrative 是否展示未提交流式草稿需要另行确定产品语义。
- 菜单/弹窗等全面策略接入，待工作台样板验收后处理。

### 第三轮：Window Shell 统一 Header 所有权

状态：2026-09-18 用户批准；Sol 已完成代码迁移，待浏览器与用户验收。

当前 `StudioPanelHost` 的 Header 同时承担窗口历史导航、参考/沉浸模式、Panel 标题与路径、视图模式和右侧业务操作；不同 Panel 通过 `panelHeaders` 提供整段内容，`PlayPanel` 还通过固定 DOM id `studio-panel-header-actions` 反向查找并 Portal。这使窗口级结构、Panel 数据和业务操作的所有权混杂，也容易让各 Panel 重复实现或形成不一致的 Header。

实施边界：

- Window Shell 固定拥有 Header 的结构、尺寸、布局、响应式、动画、焦点、历史导航、窗口模式与关闭行为。
- Panel 不再实现完整 Header，只向 Shell 的语义槽贡献 `main` 和 `actions`；默认图标和标题继续来自 `STUDIO_PANEL_PRESENTATION`。
- `main` 用于标题、资源选择、路径和面包屑；`actions` 用于新增、导入、筛选、刷新等当前 Panel 独有操作。
- 路径计算、选择状态、弹窗状态和业务回调仍由 Panel 所有，不提升到全局 Store。Shell 只提供渲染槽，不读取或复制 Panel 业务数据。
- 优先使用显式 `main` / `actions` 插槽。只有深层业务组件确实需要贡献内容时，使用带 `panelId`/活动态约束的 Header Context/受控 Portal，替代全局 DOM id。已访问但隐藏的 Panel 不得向当前 Header 注入内容。
- `ContextWorkbenchHeader`、`PresetWorkbenchHeader` 等现有组件优先收窄为 Header 主内容贡献，不推倒其路径计算；普通 Panel 无自定义内容时只使用注册表默认标题。

预期结构：

```text
StudioWindowShell
├── Rail
├── WindowHeader
│   ├── HistoryNavigation       # Shell 固定
│   ├── PanelHeaderMain         # 当前 Panel 贡献
│   ├── PanelHeaderActions      # 当前 Panel 贡献
│   └── WindowModeControls      # Shell 固定
└── PanelViewport
    └── ActivePanel
```

已确定决策：

1. Header 结构与窗口级控制归 Shell；优先在已有宿主上拆清职责，不新造第二套 Shell。
2. 品牌 Logo + LoomStudio 归 Shell，位于 Rail 顶部品牌区域，不随 Panel 标题切换。保留现有关闭/固定行为。
3. 品牌区域和工作台顶栏保持统一上沿，形成左侧导航与顶部上下文的半包围框架。Rail / 目录 / 详情三列只用于需要它的工作台，不强迫所有 Panel 三列。
4. Panel 通过 main/actions 贡献内容，业务状态仍局部持有，ReactNode 不写入全局 Store。局部编辑工具栏不全部搬到顶栏。
5. 当前 Header 消费者与 PlayPanel 操作一次迁移，删除旧 panelHeaders 和固定 DOM id Portal 路径，不保留双轨兼容。
6. 固定品牌和窗口控制不随内容过渡重新挂载；继续消费既有动画策略，保留下钻返回、历史前后退和窗口模式语义。

第三轮追加写集：

- 原 pages/studio、app/studio-panel-registry.tsx 和相关 hooks 写集。
- `apps/studio-client/src/app/app.tsx`：必要的 Header 注册/装配接线。
- `apps/studio-client/src/widgets/context-workbench/`、`widgets/preset-workbench/`、`widgets/play-panel/`：仅已有 Header 贡献及操作迁移。
- `apps/studio-client/src/features/context-assets/ui/context-asset-header/`：仅顶栏展示职责收敛。
- `tests/unit/client/`：Header 活动态隔离、默认标题及卸载清理的定向检查。

任务与验收：

- [x] H1 Shell 拥有统一 Header 结构，品牌保持 Rail 顶部。
- [x] H2 迁移全部现有 panelHeaders 消费者和 PlayPanel 操作，删除旧注入路径；发现写集外消费者先回报路径。
- [x] H3 隐藏/卸载 Panel 不污染当前顶栏；默认标题、业务操作、历史和下钻返回保持正确。
- [x] H4 相关类型检查及风险匹配的最小验证；更新实际修改、偏差和未验证项。真实窄屏/动画手感由用户验收，不能以类型检查替代。

第三轮交付记录：

- `StudioPage` 现持有固定 `StudioWindowHeader`，Header 与 Panel viewport 为同一既有工作台 Shell 的兄弟层；切换 Panel 只替换 main/actions 与内容，不重新创建品牌、历史和窗口控制。
- `StudioPanelHost` 已收窄为 Panel viewport 与访问后保留逻辑，不再拥有 Header、窗口模式、历史导航或资产视图控制。
- 原 `panelHeaders` 一次迁移为显式 `panelHeaderMain`：角色、预设、资源继续复用原 Header 内容组件及其局部/布局状态，没有复制路径数据到 Shell 或全局 Store。
- 新增活动态隔离的 `PanelHeaderActions` 受控 Portal；PlayPanel 日历按钮保留原局部状态，删除固定 DOM id `studio-panel-header-actions`、`getElementById` 与组件内裸 `createPortal` 路径。
- 默认 Panel 标题继续读取 `STUDIO_PANEL_PRESENTATION`；Rail 顶部 Logo、LoomStudio、关闭与固定交互未迁移或改写。未强制普通 Panel 使用资源工作台三列，也未移动局部编辑工具栏。
- 实际文件：`studio-page.tsx`/样式、`studio-panel-host.tsx`、新增 `studio-window-header.tsx` 与 context、`app.tsx`、`play-panel.tsx`、`studio-window-header.test.ts`。
- 自动验证：客户端定向 TypeScript 检查通过；`studio-window-header`、`studio-layout-store`、`master-detail-workbench` 共 3 个测试文件 17 项通过；定向 `git diff --check` 与旧路径残留扫描通过。
- 未验证：真实浏览器中的 Header 对齐、窄屏压缩、PlayPanel Portal 按钮交互、Panel 切换与窗口动画手感，仍由用户验收。
- 偏差：无写集外消费者、无新增依赖、无公共业务契约或全局业务状态变更。

### 2026-09-18 Sol 交付

- 正式 Shell 左栏原本常驻并覆盖正文，右栏原本条件挂载；两者均不改变正文几何位置，因此未增加无效的正文 FLIP，也未改变布局语义。
- 新增持久化动画策略 `system | full | reduce`；App 将同一有效策略写入 `html[data-loom-motion]`，`system` 会监听系统偏好动态变化，显式 `full` 可覆盖系统减少动画。
- 左栏移除 width/height 连续过渡，仅保留 320ms 进入、240ms 退出的 transform/opacity；右栏改为常驻外壳的同节奏 transform/opacity，隐藏态 `inert`、`aria-hidden` 且不接受命中。
- 右栏关闭时若焦点仍在面板内，归还顶部触发按钮；窗口拖动仍即时更新尺寸，左侧窗口 resize 状态继续取消 Shell transition。
- 实际改动：`app.tsx`、`global.css`、动画策略 hook、设置面板与中英文文案、Studio 左右栏组件及样式、定向单元测试。
- 计划偏差：无。未新增依赖，未修改业务路由、面板放置、参考/沉浸及移动端下钻语义。
- 自动验证：`pnpm --filter @loom-studio/studio-client exec tsc -b --pretty false` 通过；`pnpm exec vitest run tests/unit/client/motion-preference.test.ts` 执行 1 个测试并通过；定向 `git diff --check` 通过。
- 客观浏览器验证：未执行；模型测试不作为真实动画证明。
- 用户验收：左右栏各自/同时开合、快速反向、参考/沉浸、窄屏与最终节奏手感。

### 2026-09-18 Sol 第二轮交付

- W1/W2：工作台外壳先落最终几何，再以 `clip-path` 揭示；关闭反向且快速重开从当前呈现值接续。实色编辑面由独立背景层淡入，未插值 blur，拖动时取消揭示过渡。
- W3：普通树使用常驻子树容器的 grid 手风琴；虚拟树只测量已挂载行，在内层执行位置 FLIP/新增行淡入，virtualizer 外层 `translateY` 未被覆盖，减少动画切换与卸载会取消 WAAPI。
- W4：两个 Master–Detail 宿主在窄屏固定裁剪层内保留列表和详情，进入详情从右侧、返回列表从左侧；非活动视图 `inert`，滚动与编辑组件不因下钻卸载。
- W5：仅顶部历史 back/forward 给下一次目标 Panel 附方向动画；普通 Rail 切换保持中性，历史栈实现未改。
- 自动验证：客户端定向 TypeScript 检查通过；`motion-preference`、`file-tree`、`master-detail-workbench`、`studio-layout-store` 共 4 个文件 19 项测试通过；定向 `git diff --check` 通过。
- 客观浏览器验证：未执行。侧栏到 Panel 快速反向、材质衔接、真实虚拟滚动、窄屏下钻与历史方向仍需浏览器诊断和用户手感验收，不能由上述模型测试替代。
- 偏差：无新增依赖、无公共契约或历史语义修改；本轮暂缓的 Agent、正文、消息与骨架任务未实施。

### 2026-09-18 用户验收纠偏

- 用户指出第二轮把完整工作面背景误改为最深层 `--loom-color-background`，且 Sidebar→Panel、Panel→Window 展开仍无有效动画，收起裁剪观感异常。
- 已删除工作区最深色背景层，恢复内部 Header/Panel 的 `--loom-color-surface` 色阶；Rail 与外层 Header 继续由原透明/玻璃外壳承载，不修改全局材质策略。
- 展开改为读取 Dock 前后真实矩形，在独立裁剪宿主上执行 320ms `clip-path` 揭示；覆盖 Sidebar→Panel 与 Panel→Window，不 scale 文字、不连续动画 width。
- 收起裁剪终点从错误的 42px 活动态 Rail 改为真实 160px Sidebar 宽度，避免动画结束后再次跳宽；快速反向会取消旧 WAAPI 并从当前 CSS clip 状态接续。
- 自动验证：客户端定向 TypeScript 检查通过；4 个相关测试文件 19 项通过；定向 `git diff --check` 通过。
- 未验证：真实浏览器中的透明层级、两段展开、沉浸退出与快速连续反向手感，仍由用户验收。
