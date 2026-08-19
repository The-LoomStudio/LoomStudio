# Prompt Resource Foundation 实施计划

> **状态**：Foundation Partially Implemented / Preset Binding Model Superseded
> **日期**：2026-08-15
> **主题**：把 Preset 与 Setting Layer 从 Card 附属编辑数据收束为可独立管理、绑定、导入导出的 Prompt Resource，并提供可直接使用的官方问答助手默认资源。
> **概念修正**：本计划已经完成的 Prompt Resource CRUD、默认资源与静态编译能力继续有效；其中将 `AgentPreset` 与 `PromptResource(kind=preset)` 分成两层的绑定方案已被 [`preset-agent-prompt-build-module-plan.md`](preset-agent-prompt-build-module-plan.md) 取代。后续实现以“Preset = Agent PromptBuild Module”为准。

## 1. 当前结论

当前 PromptBuild 已拥有 Composition Skeleton、Zone、Projection、Activation 和确定性排序基础，但产品层仍缺少完整的 Prompt Resource 生命周期：

- `PromptResource(kind=preset)` 才是 Composition Preset；
- `PromptResource(kind=setting)` 才是 Setting Layer；
- `AgentPreset` 继续保存 Agent 指令、历史策略和 `promptResourceIds`，不承担 Composition Skeleton；
- `CardSource.preset` / `CardSource.settingLayer` 是旧导入兼容字段，不再作为新建数据的权威 PromptBuild 来源；
- Preset、Setting Layer 与 Card 都是平铺资源，Card、Timeline、AgentPreset 只保存引用。

本轮目标是把偏静态的 Preset + Setting Layer 闭环补到可用状态。变量、Tool Mount、Mode Gate、Agent Step 和高级冲突合并不在本轮范围。

## 2. 官方默认资源

官方默认体验由两个独立 Prompt Resource 组成。

### 2.1 Loom Studio 问答助手 Preset

职责：

- 提供官方推荐 Composition Skeleton；
- 声明问答助手的基础行为；
- 持有主 Projection Order；
- 作为普通作者可复制、可修改的参考实现。

首版沿用当前已经进入编译器和前端的标准 Zone ID，不在本轮重命名：

```text
preset.system
setting.stable
chat.history
setting.lower
chat.before
chat.inside
chat.after
fresh.tail
```

### 2.2 Loom Studio 基础知识 Setting

职责：

- 保存关于 Loom Studio 的基础概念和使用方式；
- 以多个可独立启用、检索和激活的 Setting Entry 表达；
- 作为 Setting Layer 编辑、Projection、Activation 和导入导出的真实示例。

首版只保存稳定的产品知识，不写入运行时状态、变量、开发进度和可能快速过时的实现细节。

## 3. 资源身份与绑定

```text
AgentProfile
  -> AgentPreset
       -> Composition Preset PromptResource
       -> 可选的全局 Setting PromptResource

NarrativeTimeline
  -> 从 Card 启动时复制 Card.promptResourceIds
       -> Card 自带 Setting / Preset / 其他 Prompt Resource
```

PromptBuild 合并顺序保持显式：

1. `AgentPreset.promptResourceIds`；
2. `NarrativeTimeline.promptResourceIds`；
3. 去重后读取资源；
4. Composition Preset 提供唯一主 Order Profile；
5. Setting 与其他来源只贡献内容，不争夺主 Order Profile。

同一次 Build 中存在多个主 Order Profile 时必须产生明确错误或诊断，不能继续静默采用第一个。

## 4. 顶层 Prompt Resource API

复用一个通用 Prompt Resource API，不为 Preset 和 Setting Layer 分别造平行 CRUD：

- 按 `resourceKind` 列出资源；
- 创建空资源；
- 复制资源；
- 删除资源并检查 Card、AgentPreset、Timeline 引用；
- 更新名称继续复用根 Module 节点的 `label`；
- 独立导入、导出一个 Prompt Resource Artifact。

节点级 `create/update/move/delete` RPC 继续复用现有实现。

## 5. 静态 PromptBuild 合同

本轮必须完成：

- 新建 Entry 的默认 Projection 由后端校验和补齐，前端只提供即时预览；
- Folder `enabled=false` 对后代形成 Effective Enabled 门控；
- Resource 中声明的 lifecycle 不再被强制覆盖为 `always`；
- 缏失或未知 Zone 在编辑/导入时产生 Diagnostic，运行时采用 strict error；
- Editor Projection 区分自身 Enabled、Effective Enabled、Activation Active 与最终 Included；
- Preset Workbench 能展示全部标准 Zone，包括当前没有 Entry 的 Zone。

Resolution、Entry Render 与 Provider capability 降级继续延期；未实现前不把它们描述为可用能力。

## 6. 前端闭环

Preset 与 Setting Layer 都需要资源级入口：

- 列表、选择、新建、复制、删除；
- 独立导入、导出；
- 当前资源名称；
- Preset 的 Zone Detail；
- Setting / Preset Entry 的批量 Enabled、Zone、Slot；
- 静态 Build Preview 与 Projection Diagnostic。

现有 Source Tree、Projection Runlist、正文编辑器和拖拽排序继续复用，不重写第二套编辑器。

## 7. 分阶段施工

### Phase 1：资源与默认数据

- [x] 实现顶层 Prompt Resource CRUD；
- [x] 初始化官方问答助手 Preset 与知识 Setting；
- [x] 后端初始化官方 AgentPreset，并绑定这两个资源；
- [x] 收束唯一主 Order Profile 合同。

### Phase 2：Artifact 与静态编译合同

- [x] 实现单资源导入导出；
- [x] 导入和复制时重建内部节点 ID，避免多个资源绑定时发生节点冲突；
- [x] 完成默认 Projection、Folder Effective Enabled 与 Lifecycle；
- [ ] 补齐编辑器侧 Zone Diagnostic；运行时未知 Zone 已采用 strict error。

### Phase 3：前端资源管理

- [x] 接入 Preset / Setting 列表与资源操作；
- [x] 接入 Zone Detail；
- [ ] 接入批量 Enabled、Zone、Slot 编辑；
- [x] 删除旧 Projection Profile 读取路径与 M0 Slot 映射；
- [ ] 收束仍存于测试数据库或兼容 Artifact 中的旧 Demo Fixture 数据。

### Phase 4：验收与文档晋升

- 从空数据库启动后可直接创建问答 Agent Profile；
- 问答 Agent 能使用官方 Preset 与知识 Setting 生成有效 Prompt；
- Preset / Setting 可以独立创建、编辑、导出、删除和重新导入；
- 普通新建 Card 不再产生无法进入 PromptBuild 的权威嵌入式 Prompt 数据；
- 实现事实更新到 Architecture，旧计划改为已取代或完成。

## 8. 非目标

- 变量系统；
- Prompt Resource 运行时 Diff；
- 多世界线资源实例；
- Tool Mount / Mode Gate / Agent Step；
- Provider-specific Preset；
- 网络社区资源解析与依赖管理。
