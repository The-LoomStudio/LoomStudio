# CodeAct 与 VFS 工具后续

状态：首期执行与领域读写已交付；仅保留挂载、Pin 等未决后续。
更新：2026-11-03。全局角色作者范围已单独交付归档，其余候选不新增实施授权。
引擎选择、实验、权限接线及分批结果见[完整原稿](../../archive/plans/codeact-vfs-tooling-plan.md)。

## 当前已交付

- 正式执行使用 QuickJS，Content/freeform 与 JSON 两个入口共用执行和权限路径；没有生产 node:vm 回退。
- VFS 已提供受限目录、搜索、读取、State 结构化值读取及绑定 Timeline 的 Narrative 采样。
- Prompt Resource 与 State 写入、Prompt Patch、同资源结构操作和整份资源复制已有领域接口接线。
- Narrative 路径读取与受控替换、作者模式、修改审批和历史读取逐次审批已接通。
- 读取身份、版本 / Revision、取消及成功提交回执仍由宿主校验；JS 后续失败不撤销已提交修改。
- 后续使用性修复已交付。当前教程明确没有 pin、commit、后台定时器或任意工具调用能力。

## 真正未完成与未决合同

1. **运行期 Pin / Unpin（仅设想，不是当前欠账）**：原方向为固定引用参与持续投影，不递归复制目录，不删除历史工具结果。
   工具操作、引用有效期、源更新与撤销、投影采用时点尚需共同收束；不能把已有 Script 版本固定当作此能力完成。
2. **通用资产与跨挂载能力**：已批准的 global 作者范围可以访问角色引用的 Preset/Lore；这不代表任意文件、其他 Session 或 State 可跨范围访问。
   若推进，需明确来源、身份、访问锁、预算、目标权限、复制内容和外部引用保留；不按路径猜测授权。
3. **未纳入首期的候选**：Narrative Patch、用户撤回入口及更广结构操作仍须由真实需求单独定界。
   保留未做记录，不把这些候选自动列成新一批已授权施工，也不恢复必需草稿 / 整段提交机制。

## 授权与职责边界

- 原已确认的双传输、即时写入、审批与作用域规则保留；未决权限和生命周期不能由实施者自行补全。
- 工具消费领域 Store、Mutation 和读取观察，不建立 VFS 数据库、独立事务源或资源影子内容。
- 访问授权与操作审批分开；默认作者模式不扩大挂载范围；跨角色 Preset/Lore 必须另行批准 global 范围，不授予宿主磁盘或永久历史读取权限。
- 跨资源复制不能静默复制运行态 Pin、执行授权或 Agent 工作记忆。
- 实施前先核对既有能力及真实调用者，由主 Agent 给出最小写集；本次整理不新增依赖或源码修改授权。

## 接续入口

- [Context 实施记录](../../archive/plans/agent-context-skeleton-and-memory-projection-plan.md)已确认完成；Pin / Notice 只是设想，不再把它们分派给一个活跃 Context 计划。
- [Runtime 实施记录](../../archive/plans/agent-runtime-session-and-workspace-plan.md)已确认完成，历史扩展提案不构成其未完成工作。
- Workspace 文件消费及共同恢复配置归 [Workspace 后续](./timeline-workspace-and-vfs-organization-plan.md)。
- Script 的持久运行与 Workspace 文件执行归 [Script 计划](./loom-script-distribution-and-runtime-plan.md)，不在一次 CodeAct 调用中另建后台运行器。

## 最小关闭条件与验证边界

- 每个继续实施的能力先有明确路径身份、读取基线、权限、审批、提交范围和失败回执合同。
- Pin 工具与投影必须形成同一引用生命周期；通用挂载不能绕过领域预算、CAS 或来源撤销。
- 使用现有 VFS / QuickJS / Tool Loop 路径验证必要风险，不复制核心逻辑或新建工具测试框架。
- 未推进候选明确延期或撤回，保留原授权级别；已交付切片可独立归档。
- 本地引擎与临时数据验证不代表真实模型遵循、任意第三方安全隔离或人工界面验收。

已交付的新增切片见[全局角色作者范围](../../archive/plans/global-character-author-scope-2026-11-03.md)，不再列为当前缺口。
