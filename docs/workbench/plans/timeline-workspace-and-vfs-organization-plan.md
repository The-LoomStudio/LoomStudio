# Timeline Workspace 消费与恢复配置后续

状态：文件、共同恢复、楼号和文件 UI 已交付；任意文件被动消费仍待收束。
更新：2026-10-25。本页收窄原入口，不新增持久化、权限或执行授权。
目录讨论及交付分层见[完整原稿](../../archive/plans/timeline-workspace-and-vfs-organization-plan.md)。

## 当前已交付

- Timeline 拥有持久目录、文本和二进制引用、不可变工作树版本与默认 `MEMORY.md`。
- 正文、State、Workspace 在分支/候选恢复中共同采用；归档携带材料及必要历史引用。
- CodeAct 复用受限文件读写和审批；文件管理 UI 已有树、编辑、上传下载及安全图片预览。
- 共享 MEMORY 归 Timeline；Session 自有摘要独立保存，固定注入和安全采用已有实现，不维护相同正文镜像。
- 持久楼号和特殊 Timeline Session 的工作采用路径已有基础；不重开“分支新建空白主 Session”旧方案。

## 真正未完成与未决合同

1. **任意 Workspace 文件的被动消费**：文件存在不代表自动进入 Prompt；需明确选择、来源、触发与注入位置。
   树中已有 injection 元数据不等于消费入口、作者配置和完整生命周期已经接通。
2. **消费配置随材料恢复**：从共同恢复计划迁入。文件内容、目录与其被动消费配置须属于同一可解释版本。
   不能在恢复旧文件后继续应用废弃未来的注入选择，也不能让旧配置偷读当前作者资源。
3. **世界演进默认文件**：名称、职责及注入位置尚未最终确定；不能把共享 MEMORY 的既有消费扩大为所有文件默认注入。
4. **目录视图与稳定引用**：若继续推进跨来源目录轴或视图组合，先明确来源/种类/包身份的显示关系与重名、移动规则。
   不因 UI 需要统一树就把作者资源、包文件、Assets 与 Timeline 文件变成第二份目录权威。

## 授权与职责边界

- 原已确认的 Timeline 所有权、CAS、材料版本和共同恢复合同保持；本次整理不授权新的消费默认值。
- 共享作者 Lore 使用当前作者资源，不随剧情回退；运行材料随对应恢复点采用，两者不合并编辑历史。
- 文件保存不授予执行权限；二进制内容不因可预览而可执行，Blob 历史保留不等于物理 GC 已实现。
- 来源、引用、过期写入及失败采用须从领域事实解释，不建立通用回滚框架、路径 KV 或影子文件系统。
- 被动消费、默认文件及目录语义中的产品未决项由用户与主 Agent 收束；技术字段由实施切片定稿。

## 接续入口

- 基础施工见[归档实施记录](../../archive/plans/timeline-foundation-implementation-plan.md)；现行采用合同见[Runtime 与 Session](../../architecture/application/agent/runtime-and-session.md)。
- Session 摘要与文件 UI 已完成，见[总结交付记录](../../archive/plans/session-summary-implementation-plan.md)；不再将文件管理列为未做。
- Workspace 文件执行、采用及脚本重建由 [Script 计划](./loom-script-distribution-and-runtime-plan.md)承接，本页不另建执行器。
- [Context](../../archive/plans/agent-context-skeleton-and-memory-projection-plan.md)已确认完成，Notice / Pin 仅为设想；作者开发源与显式 Apply 归[资源分发后续](./workspace-resource-and-distribution-plan.md)。

## 最小关闭条件与验证边界

- 继续实施的文件消费有明确配置与版本归属；保存、移位、恢复、导入后能解释实际注入的内容和来源。
- 定向验证共同恢复不混合正文/State/文件/配置，旧任务不能写入新采用状态，失败不发布半份配置。
- 世界演进文件与目录视图若不推进，明确延期或撤回并保留去向，不把建议记为已交付。
- 基础定向检查不能替代真实脚本、模型消费及人工文件操作验收；这些按各自已授权场景执行。
