# History Text Pipeline 上下文装配与 UI

> **Status**：Implemented / 自动化验证完成，等待用户视觉验收
> **2026-09-12 接续说明**：后续 Text Pipeline / Loom Script 集成已承接本计划，当前合同见 [History Text Pipeline](../../architecture/application/history-text-pipeline.md)。Runtime Override 的 `disabledRuleIds` / `orderedRuleIds` 已实现；下文原开放问题不再表示禁用与排序能力缺失。保留原验收记录，不把后续交付等同于本计划所有人工验收通过。
> **日期**：2026-09-10
> **授权范围**：用户已确认文本管线的处理边界、COT 归属、上下文导航、来源展示与多 Agent 隔离，并授权写 Plan 后实施。

## 目标

把现有全局 Rule / Extractor JSON CRUD 面板改为“资源 Owner 内创作 + 当前运行上下文检查”，并让 Preview、Agent PromptBuild 与运行检查共用一套 Effective RuleSet 装配语义。

## 已确认事实

- History Text Pipeline 只处理 Narrative History 与 Agent Session History；Canonical 内容不被投影覆盖。
- `airp.textTransformRule` 当前支持 Workspace、Preset、Card、Extension 与 User Override Owner，Target 为 Narrative / Agent Session，Phase 为 `classify / prompt / display`。
- Card Rule 在创建 Timeline 时进入 Runtime Context 快照；Agent Profile 通过唯一 `presetId` 选择 Preset。
- `projectRuntimeHistory()` 与 Agent PromptBuild 当前分别组合规则。Narrative `projectHistory({phase:'prompt'})` 没有 Agent/Preset 消费者参数，无法表示不同 Agent 对同一 Narrative 的不同 Prompt 投影。
- Client 当前只有 Rail 中的全局 `TextTransformPanel`，一次列出所有 Rule、Extractor 和 Renderer，并直接编辑 JSON；未区分作者来源配置与当前上下文生效结果。
- `promote-reasoning` 已在普通 Assistant Message 与 Content Tool 扫描之前执行，自定义推理可以进入 Agent Session reasoning；Provider-native reasoning 类型已有合同，但真实生产链不在本计划扩展。

## 已确认决策

1. “正则”是 History Text Pipeline 的一种 Matcher，不建立独立于文本管线的第二套生命周期。
2. 自定义 COT 由产生输出的 Agent 所使用的 Preset 显式声明；捕获后进入 Agent Session reasoning，Narrative 只接收清理后的正文。系统模板可以提供，但不默认匹配所有 `think / thinking / thought` 方言。
3. 来源、激活条件、处理对象和处理阶段分离。Preset 与 Extension 即使跨角色，也不等于 Workspace Global。
4. Workspace Rule 保留，用于用户跨项目的通用规则。多 Agent RuleSet 必须隔离；Agent Profile 首版不直接拥有 Rule，只通过 Preset 获得规则。
5. UI 不按 Workspace / Card / Preset / Extension 建立一级来源目录。来源仅作为标签、筛选、详情和 Trace 信息。
6. 静态声明跟随 Owner 编辑：Card 在角色资源工作台，Preset 在预设工作台，Workspace 在全局设置，Extension 在扩展详情中只读检查贡献或进入其配置 / Dev Workspace。
7. 运行检查只绑定当前上下文：Narrative 或具体 Agent Session。角色 A 的运行面板不混入角色 B；检查其他静态声明需要显式切换到其资源工作台。
8. Extension 详情点击 Contribution 时留在扩展工作台就地检查；只有明确的次级动作才跳到当前运行检查器或源码。
9. `classify` 在 Provider Step 内冻结并持久化结果，`prompt` 在 Agent Run 内冻结，`display` 保持可重建投影。正在执行的步骤不接受中途规则变化。
10. 声明式 Extractor 只服务无代码、跨消费者复用、统一 Dry Run / Trace 的需求；插件私有捕获仍由插件消费受控 History Projection 后自行完成。

## 非目标

- 新增脚本宿主、EJS、任意代码正则 Effect、自定义 Matcher Runtime 或新依赖。
- 改写 canonical Narrative / Agent Message，或迁移现有历史数据。
- 为 Agent Profile 增加局部 Rule Override。
- 实现 Extension 工作台、Dev Workspace、Package 安装器或完整 Contribution UI；本轮只保留可承接的数据和导航边界。
- 补齐 Provider-native reasoning 的生产链、Agent Pin、记忆系统或 State Trigger。
- 将所有插件私有提取强制注册为中央 Extractor。
- 浏览器视觉验收；由用户完成。

## 最小设计

### Effective RuleSet

Application Runtime 增加唯一的规则装配路径，输入至少包含：

- History Target：Narrative 或 Agent Session；
- Phase：`classify / prompt / display`；
- 当前 Card Runtime Context；
- 可选消费 Agent Session / Preset；
- Workspace、Extension、User Override 当前可用规则。

输出按现有 `orderIndex + stable id` 稳定排序的 Rule 条目，并保留 Owner / Version。PromptBuild、History Projection 和 Inspector 不得各自重新实现来源筛选。

Narrative 的 `display` 不需要 Agent；Narrative 的 `prompt` 必须携带消费它的 Agent Session，从而选择该 Agent Profile 的 Preset。Agent Session 则根据自身 Profile 解析 Preset。

### Inspection Contract

新增 `application.inspectTextPipeline`：

```ts
type InspectTextPipelineInput = {
  source: HistorySource
  phase: TextTransformPhase
  consumerAgentSessionId?: string
}

type TextPipelineInspection = {
  source: HistorySource
  phase: TextTransformPhase
  consumer?: {
    agentSessionId: string
    agentProfileId: string
    presetId: string
  }
  rules: TextTransformRuleEntry[]
  extractors: TextExtractorEntry[]
  snapshot: HistoryProjectionSnapshot
}
```

Narrative `prompt` 必须提供 `consumerAgentSessionId`；Agent Session Source 直接以自身 Session / Profile / Preset 为消费者。Narrative `display` 默认不绑定 Agent；显式提供消费者时可检查该 Agent 看到的 Narrative 投影。

返回：

- 当前 Source、Phase 和可选消费 Agent 身份；
- Effective Rule 条目及稳定顺序；
- 使用同一 RuleSet 生成的 `HistoryProjectionSnapshot`；
- 已有 Match 与 Diagnostic。

不新增第二份持久化 Inspection Store。检查结果是当前上下文的瞬时投影。

Card-owned Extractor 与 Rule 一样随 Timeline Runtime Context 固化；`TimelineRuntimeContextContent.textExtractors` 对既有数据保持可选，缺失时只代表旧 Timeline 未冻结 Extractor，不静默混入其他 Card。Preset / Workspace / Extension / User Override Extractor 根据当前检查上下文解析。

### Authoring 与 Runtime UI

- Card / Preset 作者入口复用各自外层资源工作台；Master 只列该 Owner 的 Rule / Extractor，Detail 编辑单项。
- Workspace 作者入口保留在文本管线全局设置中，只列 Workspace / User Override，不展示所有来源 CRUD。
- Runtime Inspector 的 Master 按当前执行对象与阶段组织，Detail 展示有效顺序、来源、Matcher / Effect 摘要、Match、Diagnostic 和 Dry Run。
- 多 Agent 不合并；切换 Agent Session 后重新读取对应 Effective RuleSet。
- 输入控件遵守现有视觉规范：短文本底部细线，长文本与代码内容使用 `surface-subtle` 色块。移动端复用 Master–Detail 下钻。
- Renderer Catalog 不再与 Rule / Extractor 作者 CRUD 混在同一目录；保留现有能力入口，但不把它伪装成正则来源。

## 工作包

### A. Runtime Effective RuleSet 与检查合同

- **职责**：集中规则装配；让 Agent PromptBuild 与 History Inspection 共用；补 Narrative Prompt 的消费 Agent 上下文；暴露最小检查 RPC。
- **写入范围**：`packages/application-runtime/src/transforms/`、`packages/application-runtime/src/runtime/transforms-runtime.ts`、必要的 `runtime/agents-runtime.ts` / `runtime/narrative-runtime.ts` / `runtime/cards-runtime.ts` / `agents/agent-turn.ts`、`packages/application-runtime/src/types.ts` / `index.ts`、`apps/studio-server/src/rpc/handlers/application/text-transforms.ts`、后端直接相关测试。
- **禁止修改**：Studio Client、Extension SDK / Host、文档、State / Macro、Provider gateway。
- **完成条件**：同一上下文下 Inspector 与 PromptBuild 使用相同有序 Rule ID；两个绑定不同 Preset 的 Agent 对同一 Narrative 可得到隔离的 Prompt RuleSet；Narrative Display 不要求 Agent。
- **验证**：复用并扩展 `tests/unit/application-runtime/history-text.test.ts`，以及一项覆盖 Runtime 上下文解析的最小测试；只运行这些定向测试和受公共类型影响的 Application Runtime 类型检查。

### B. Client 作者视图与运行检查器

- **职责**：重构 `features/text-transforms`；接入 Card / Preset 作者工作台和当前上下文 Runtime Inspector；来源只作标签 / 筛选；保持移动端下钻。
- **写入范围**：`apps/studio-client/src/features/text-transforms/`、`apps/studio-client/src/entities/text-transform.ts`、`apps/studio-client/src/shared/api/studio-api.ts`、`apps/studio-client/src/app/`、`apps/studio-client/src/pages/studio/`、`apps/studio-client/src/widgets/context-workbench/`、`apps/studio-client/src/widgets/preset-workbench/`、两份 Client i18n、直接相关 Client 测试。
- **禁止修改**：Application Runtime、Server、Extension SDK / Host、State / Macro 业务、文档。
- **依赖合同**：以本 Plan 的 Inspection Contract 和 Worker A 的实际导出为准；不得在 Client 重写 Effective RuleSet。
- **完成条件**：Card / Preset 只编辑自身声明；Workspace 入口不再罗列其他 Owner；Runtime Inspector 可按 Narrative / 当前 Agent Session 与 Phase 查看有效顺序、来源和 Dry Run；窄屏能列表到详情再返回。
- **验证**：相关 Client 定向测试；公共 Props / API 类型变化后运行 Client 定向 `tsc --noEmit`。不启动浏览器。

### C. 主 Agent 集成与架构晋升

- 审查真实 Diff，处理 A/B 公共合同接线和重复路径。
- 运行一项跨前后端最小类型检查或现有定向集成检查，只覆盖 API 漂移风险。
- 更新本 Plan 的实际结果，并将稳定合同写入 `docs/architecture/application/history-text-pipeline.md`；同步 Workbench Plan 索引。

## 验证预算

- Runtime：History Text 纯逻辑测试 + 一项上下文装配测试；公共 Runtime 类型检查。
- Client：文本管线相关测试 + Client 类型检查。
- 集成：只在 RPC / DTO 改变后补 Studio Server 或 Client 的最小类型检查。
- 不运行全仓测试、全仓 lint 或 Build；除非跨包导出或入口变化使定向类型检查不足。
- 不启动浏览器。主观布局、颜色、响应式和交互手感由用户验收。

## 停止条件

- 需要新增依赖、迁移持久化数据、改变 canonical History、引入任意代码执行或扩大 Extension 权限时停止。
- 同一失败连续两轮仍未解决时停止并报告。
- 当前 API 无法表达消费 Agent 且修复需要改变 Agent / Narrative 所有权时，由主 Agent重新确认，不由 Worker 猜测。

## 开放问题

- User Override 如何显式禁用某一来源 Rule、以及重叠 `promote-reasoning` 的冲突策略尚未确认；本轮保持现有有序执行语义，不新增覆盖 DSL。
- Extension Contribution 的完整静态清单 UI 延后到 Extension UI 模块；本轮 Runtime Inspector 仅展示当前已经存在的 Extension-owned Rule。

## 最终结果

- Runtime 新增统一 `resolveEffectiveTextPipeline`，Agent PromptBuild、Reasoning Classification、History Projection、Extractor 与 Inspector 共用 Owner / Preset / Card Runtime Context 解析；删除 Agent Runtime 内重复来源筛选。
- 新增 `application.inspectTextPipeline`，返回 Consumer、有效 Rule / Extractor 和同一次 Projection Snapshot。Narrative Prompt 没有消费 Agent 时明确拒绝；Agent Session 使用自身 Profile / Preset。
- Card Rule 与 Extractor 均随 Timeline Runtime Context 冻结；旧 Runtime Context 缺少 `textExtractors` 时不读取当前 Card 的 live Extractor 冒充冻结结果。
- `extractHistory` 只接受当前上下文中有效、启用且 Target 匹配的 Extractor，关闭跨 Card / Preset ID 旁路。
- Client 将文本管线拆成可复用 Controller / Explorer / Detail。Card 与 Preset 直接使用外层 Asset Workbench 的 Master / Detail；Workspace 作者入口位于系统设置；Rail 文本管线是纯 Runtime Inspector。
- Runtime Explorer 可在当前 Narrative 与当前 Agent Session 间切换；来源只显示为详情标签。Owner 或运行上下文切换会清空旧草稿 / Inspection，并用请求身份阻止旧异步结果覆盖新目标。
- UI 输入遵守短文本底部细线、长文本与 JSON 使用 `surface-subtle` 色块；补齐中英文文案。未启动浏览器，移动端下钻和主观视觉仍由用户验收。
- Runtime Worker 验证：Application Runtime build PASS、Studio Server build PASS、`history-text.test.ts` 5/5 PASS、`agent-session.test.ts` 11/11 PASS；新增测试证明两个不同 Preset Agent 对同一 Narrative 的 Prompt Rule 隔离。
- Client 验证：`pnpm exec tsc -p apps/studio-client/tsconfig.json --noEmit --pretty false` PASS；全工作区 `git diff --check` PASS。未运行全仓测试、全仓 lint 或浏览器验收。
- 已知限制：Extension-owned Rule / Extractor 尚未根据 Package / Module runtime enable 状态动态门控；当前沿用持久化 Contribution 可用语义，后续由 Extension UI / Host 计划收口。
