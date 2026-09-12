# 游玩入口与会话导航整合

> **Status**：Completed / WP1-WP5 已实施，人工视觉验收完成
> **日期**：2026-09-11
> **授权**：用户确认合并 Character 与 Session 根入口，并确认 Timeline、Branch 与 Agent Session 的导航方向。

## 目标

把当前按数据类型分离的 Character / Sessions 根级入口收敛为一个面向运行任务的“游玩”工作台，同时保留角色管理、Narrative Timeline / Branch 管理和 Agent Session 管理能力。

本计划只调整 Studio Client 的信息架构、导航与现有数据接线。它不改变 Narrative Timeline、Narrative Branch、Agent Session 或 Card 的领域所有权，不新增数据库 Schema，不把 Agent Session 变成 Timeline 子对象。

Agent Session Binding、Workspace Context、PromptBuild Target、Tool / CodeAct Capability 与解绑生命周期由 [`agent-session-context-and-workspace-capability-plan.md`](../../workbench/plans/agent-session-context-and-workspace-capability-plan.md) 负责。本计划只消费其稳定 API 展示和切换 Session，不根据 Binding 推导权限。

## 已确认事实

- `StudioPage` 将 Narrative 与 Composer 保持在持久 Base Canvas 中，工作台由 `StudioPanelHost` 作为 Overlay Surface 展示；访问过的 Panel 隐藏后仍保活。
- 当前 Dock 将 `character`、`sessions` 与 `agent` 注册为三个独立根 Panel。
- 当前 `SessionsPanel` 已能同时读取 Narrative Timeline、绑定 Timeline 的 Agent Session 与未绑定 Agent Session，并提供 Master–Detail、搜索、排序、批量管理和正文摘要。
- 当前 Agent Session 只通过可选 `timelineId` 与 Narrative Timeline 建立关系；该关系不是所有权，未绑定 Session 可以独立存在。
- 当前 URL 使用 `/studio/chat/:timelineId/branch/:branchId` 表达活动 Narrative，工作台路由只改变 Overlay，不应拥有 Narrative Canvas 生命周期。

## 已确认决策

### 1. 根级导航

Dock 移除独立的 Character 与 Sessions 入口，合并为单一“游玩”入口。Agent Panel 保留，但只负责 Agent Profile、Preset / Model、Tool、权限和运行策略等配置，不管理历史 Agent Session。

“游玩”工作台包含三个底部纯文字 Tab：

```text
游玩
├── 最近
├── 角色
└── 会话
    ├── 剧情
    └── Agent
```

主 Tab 沿用现有工作台页签语法，不增加新的按钮式导航。`会话` 内的 `剧情 / Agent` 是同一目录区域的二级文本 Tab，右侧复用统一详情语义。

### 2. 最近

“最近”是游玩工作台默认页：

```text
最近角色
  圆形头像横向列表

最近会话
  [剧情] 角色名 / Timeline 标题
  [Agent] Session 标题 / Agent / Binding 摘要
```

最近页提供一个紧凑的日历浮层作为日期筛选器。未筛选时，会话按本地日期分组并显示日期分隔标题；日历日期下显示当天存在会话的标记。筛选只改变当前列表投影，不建立独立的最近集合。

- 最近角色按最近一次实际进入 Narrative 的时间排序，不以 Card 元数据更新时间代替游玩时间。
- 最近会话可以混排 Narrative Timeline 与 Agent Session，但必须用类型图标和 Binding 摘要明确区分。
- 不新增需要双写维护的“最近”集合；它应由现有 Timeline / Session 活动事实或最小的最近打开记录派生。

### 3. 角色点击与初始化

角色列表继续承担启动入口。单击角色即进入，不增加独立“进入”按钮：

```text
存在历史 Timeline
  -> 打开该角色最近一次进入的 Timeline
  -> 恢复该 Timeline 当前活动 Branch

不存在历史 Timeline
  -> 使用现有 createTimelineFromCard 链路初始化 Timeline
  -> 创建 Primary Branch、Opening 与初始运行资源
  -> 进入新 Timeline
```

“最近”头像和“角色”目录使用相同语义。角色查看、编辑、导出、删除和其他管理操作进入 Context Menu；触屏和键盘必须提供等价的显式菜单入口，不能只依赖右键。

### 4. Narrative Timeline 与 Branch

`会话 > 剧情` 使用简单可展开目录：

```text
角色
└── Narrative Timeline
    ├── Branch
    └── Branch
```

- 单击 Timeline 立即把它设为当前 Narrative，并使用其活动 Branch；不再保留额外“进入会话”按钮。
- 单击 Branch 立即切换到该 Branch。
- Timeline 行负责展开 / 收起 Branch；不得把 Branch 平铺为根级会话。
- 右侧详情沿用当前会话详情定位：既是 Timeline 管理界面，也是正文、来源、活动信息和 Branch 概览。
- 从“最近”或“角色”快捷进入时可以关闭游玩工作台；在“会话”目录中切换 Timeline / Branch 时工作台保持打开，便于连续管理。关闭工作台后展示已经切换的 Narrative。

### 5. Agent Session

`会话 > Agent` 管理全部 Agent Session，包括绑定 Narrative 的 Session 和 Workspace 独立 Session。

- 列表至少显示 Session 标题、Agent Profile、最后活动时间、Run 状态，以及 `Workspace` 或 Timeline Binding 摘要。
- 支持 `当前 Timeline / Workspace / 全部`过滤；过滤只影响投影，不建立三套数据集合。
- 单击 Agent Session 即打开到 Agent 对话区域，不增加“打开到侧栏”或“进入”二次动作。
- 打开带 `timelineId` 的 Agent Session 时，同步切换到其绑定 Timeline 的当前活动 Branch，避免 Agent 与底部 Narrative 指向不同世界。
- 打开未绑定 Agent Session 时只切换 Agent 工作上下文，Narrative 保持原样；界面必须明确标记其为 Workspace Session，不能暗示它拥有当前 Timeline 权限。
- Agent 配置页可以提供“开始会话”命令；创建成功后进入“游玩 > 会话 > Agent”的对应 Session，历史列表仍只在游玩工作台管理。

当前合同没有在 Agent Session Header 中持久化 `branchId`。本计划第一版不擅自增加 Branch Binding Schema：绑定 Session 打开 Timeline 的当前活动 Branch。是否需要稳定绑定具体 Branch，另行进入 Agent Runtime 架构讨论。

### 6. Shell 与路由边界

Narrative Base Canvas 继续拥有最高生命周期优先级：

> Studio 子路由表达导航状态；Narrative Canvas 属于持久 Shell；游玩工作台属于其上的 Overlay Surface。切换 Tab、角色目录、Timeline、Branch 或 Agent Session 不得因为工作台组件替换而重建整个 Studio App。

Timeline / Branch 切换允许 Narrative 数据源变化，但不能把 Character、Session 或 Agent Session 管理重新实现为独立 React Route Page，并借此卸载 Base Canvas。

现有 Character 与 History 深链接必须在路由修改前完成调用点清单。可以映射到新的游玩 Panel 与对应 Tab，但不得同时维护两个独立 Panel 实例。是否保留旧 URL alias 由实施时依据真实外部调用者决定，不为假设兼容提前双轨。

## 非目标

- 不合并 Card、Narrative Timeline 与 Agent Session 的 Store 或领域类型。
- 不把 Agent Session 结构性嵌套进 Timeline 或 Branch。
- 不实现 Agent Session 的 Branch-stable Binding、Fork 或迁移。
- 不重做现有 Timeline / Agent Session 详情内容和批量管理能力。
- 不修改 State、Text Pipeline、Renderer、Extension 或 PromptBuild 行为。
- 不新增依赖，不迁移持久化数据。

## 工作包

### WP1：导航身份与路由收敛

**主要文件**：

- `apps/studio-client/src/pages/studio/model/studio-layout-store.ts`
- `apps/studio-client/src/pages/studio/model/studio-panel-presentation.ts`
- `apps/studio-client/src/pages/studio/model/studio-route.ts`
- `apps/studio-client/src/pages/studio/model/use-studio-navigation.ts`
- `apps/studio-client/src/app/app.tsx`
- 相邻 i18n 与定向导航测试

**完成条件**：Dock 只保留一个游玩入口；旧 Character / Sessions 不再生成两个 Panel 实例；显式 Character / Timeline / Branch 链接仍能定位正确视图；工作台切换不卸载 Studio Base Canvas。

### WP2：游玩工作台与最近页

**主要文件**：

- 新的 `apps/studio-client/src/widgets/play-panel/`
- `apps/studio-client/src/widgets/character-panel/`
- `apps/studio-client/src/widgets/sessions-panel/`
- `apps/studio-client/src/shared/i18n/en-us.ts`
- `apps/studio-client/src/shared/i18n/zh-cn.ts`

优先组合现有 `CharacterPanel`、`SessionsPanel` 和 Master–Detail 原语。先抽取可复用目录 / 详情内容，再删除被合并后失去调用者的旧 Panel 壳；不得先复制一套平行实现。

**完成条件**：三个主 Tab 与最近页成立；点击角色直接打开或初始化 Timeline；桌面端支持 Master–Detail，窄屏保持目录到详情下钻；角色管理具有鼠标、触屏和键盘等价入口。

### WP3：Narrative 树与直接切换

**主要文件**：

- `apps/studio-client/src/widgets/sessions-panel/sessions-panel.tsx`
- `apps/studio-client/src/widgets/sessions-panel/sessions-panel-model.ts`
- `apps/studio-client/src/widgets/sessions-panel/sessions-panel.module.scss`
- Narrative Runtime 的现有 Client hook / facade，仅在接线需要时修改

**完成条件**：剧情目录按角色 → Timeline → Branch 展开；点击 Timeline / Branch 直接更新当前 Narrative；详情与目录指向同一选择；移除冗余进入按钮但保留管理菜单。

### WP4：Agent Session 导航接线

**主要文件**：

- `apps/studio-client/src/widgets/sessions-panel/`
- `apps/studio-client/src/widgets/agent-chat-panel/`
- `apps/studio-client/src/app/app.tsx`
- Agent Session Client hook / facade 与相邻定向测试

**完成条件**：Agent 历史只在游玩工作台管理；Agent 对话标题区能够打开 Session 切换列表；绑定 Session 与其 Timeline 同步激活，Workspace Session 不错误绑定当前 Narrative；Agent 配置页只保留配置与开始会话命令。

### WP5：清理与文档晋升

删除本次合并产生的孤儿 Panel ID、路由分支、事件名、i18n 和样式。人工交互确认后，将稳定的 Shell、游玩导航和直接切换规则写入 `docs/architecture/ui/`；本 Plan 在验证账目完整后改为 Completed。

## 验证预算

主要风险是“导航整合后活动 Timeline / Branch / Agent Session 不一致”，不是纯视觉样式。

1. 定向模型测试：最近排序、角色到最近 Timeline 解析、Timeline / Branch 树构造、Agent Session 过滤。
2. Client 定向类型检查：Panel ID、路由与 App 组合变化属于跨模块接口修改。
3. 客观交互检查：切换工作台时 Narrative DOM 不因 Panel Route 被卸载；点击绑定 Agent Session 后 Agent 与 Narrative 指向同一 Timeline。
4. 人工视觉验收由用户负责：最近头像栏、混合会话识别、桌面 Master–Detail、窄屏下钻、右键与显式菜单体验。

不默认运行全仓测试或 Build。只有公共路由入口、跨包导出或构建入口发生变化时才升级验证。

## 当前进度

- 已新增 `play` 根 Panel，并从 Utility Rail 移除独立 Character / Sessions 入口。
- 已接入 `最近 / 角色 / 会话` 三个底部文字 Tab；角色和会话暂时复用现有 Panel 内容，避免复制领域逻辑。
- 最近页已接入现有 Cards、Timeline 和 Agent Session 数据；角色、剧情和 Agent 会话条目可直接打开对应运行上下文。
- 最近角色在没有历史 Timeline 时使用显式 `cardId` 创建，避免依赖异步选中状态造成误创建。
- 会话目录现有过滤 Tab 已按运行语义显示为“全部 / 剧情 / Agent”，继续复用 Timeline 与 Workspace Session 的同一数据投影。
- 旧 `/studio/characters` 与 `/studio/history` 深链接暂时保留为兼容入口，但不再出现在 Rail；最终是否转发到 Play Tab 需在人工验收后收尾。
- 已补齐 Play 路由、Panel presentation、布局类型、i18n 和窄屏可复用的基础容器。
- Client TypeScript 与 `git diff --check` 已通过。
- Studio route 定向测试已覆盖 `/studio/play` 的读取与生成。
- 最近列表的真实 Timeline / Session 投影、旧深链接兼容和工作台内直接切换仍待 WP2-WP4 接续。
- 最近页日期日历筛选、会话按日期分组和紧凑浮层已接入；人工视觉验收已完成。
- 最近会话头像与摘要排版已调整为自然垂直居中，移除头像顶部对齐约束，避免摘要把头像区域撑高。

## 停止条件

- 需要新增或迁移 Agent Session / Narrative Store Schema；
- 需要改变 Agent Session 与 Narrative Timeline 的所有权；
- 当前 API 无法原子协调绑定 Agent Session 与 Timeline 激活，且修复需要改变公共 Runtime 合同；
- 发现现有外部深链接要求长期双轨兼容；
- 实现需要修改 State、PromptBuild、Text Pipeline 或 Extension 生命周期。

遇到以上情况时停止受影响工作包，补充已知调用链与互斥方案，由主 Agent重新确认范围。

## 开放问题

- 根入口最终显示名使用“游玩”还是更宽泛的“会话 / 活动”；当前按讨论暂用“游玩”。
- Agent Session 不绑定具体 Narrative Branch；只绑定 `timelineId`，进入 Session 时使用该 Timeline 当前活动 Branch。
- 切换时未完成 Agent Run 继续在后台运行；结果写回原 Agent Session 与其绑定 Timeline，不因为工作台切换而取消、迁移或写入新的 Narrative。

## 最终结果

- WP1-WP4 的导航、最近页、Timeline / Branch 树和 Agent Session 接线均已完成。
- WP5 的清理、路由兼容和架构文档晋升已完成；旧 `/studio/characters` 与 `/studio/history` 作为兼容深链接保留，不再生成独立 Rail 入口。
- 定向 Studio Client TypeScript 检查、Narrative Store 测试和 `git diff --check` 已通过。
- 浏览器视觉验收由用户完成；本计划不再新增工作包，后续对游玩 UI 的局部美化另开任务处理。
