# 数据能力与运行内容

> **Status**：Open Design / 已确认原则，实施合同未定
> **日期**：2026-09-09
> **事实入口**：[数据能力与生命周期边界](../../../architecture/application/data-capabilities-and-lifecycle.md)

## 已确认原则

按数据用途和所需保证选择能力，不按作者身份、编辑入口或更新频率制造数据类别。来源、拥有者、绑定目标和消费者是不同维度，不要求角色、预设和扩展具有对称菜单或存储 Scope。

State 服务于游戏引擎式世界模拟：实体及其组件数据可以被 UI、作者程序和 Agent 共同消费和修改。角色卡可以贡献基础模板，参与模拟的扩展可以补充组件或规则；插件私有设置、自由文本记录不因此成为 State。这里明确的是产品用途，不把当前 JSON 合同缩减为只能保存数值。

Preset 通过提示词、工具和编排控制 Agent。消费 State 不构成拥有 State 的理由，目前没有需要建设“Preset State”作者系统的已确认场景，不继续以“随预设初始化还是切换时补装”为实施前提。

Preset Entry 和 Setting 都是具有消费能力的文本单元。关键词或条件触发不应只属于 Setting；State 驱动条件的实际数据接入仍需独立闭合，不能把已有 fact 条件求值当成完整实现。

宏是文本求值机制，不承担结构化节点注入，也不是 State 的同义词。作者文本声明、默认内容、动态规则与它所读取的 State 必须分开；当前尚不制定新的完整宏注册格式或脚本生命周期 API。

## 运行文本与记忆

章节记录、计划、摘要等自由文本可以作为 Agent 接续工作的材料，不需要为了持久化强制转为结构化 State。`Chapter1.md` 是一种可能的展示和寻址方式，不是必须新增一套文件系统的理由。

优先评估复用文本内容模型、编辑器和版本基础。作者资源与运行文本仍需要区分拥有者、写入权限、分支归属及消费策略；新增一份记录不应隐含修改作者原件或自动加入每轮 Prompt。

Memory / Summary 先视为生成、整理、检索和消费内容的行为，不预设独立 Memory Store，也不预设所有记忆都保存到现有 Setting。需要稳定结构和程序消费的事实可以采用 State；自由记录可以采用文本。具体方案必须由场景和历史一致性要求决定。

本次不决定摘要策略、遗忘策略、向量索引、跨 Timeline 共享、通用文件路径或 VFS API。

## 生命周期复用的边界

优先复用已有身份、来源追踪、事务、版本冲突检查与提交记录，不新增一套平行数据库或通用资源管理器。

引用的具体语义仍由领域决定：指向当前作者资源、固定来源版本、生成运行实例不是等价行为。文本注入、模板物化和私有记录绑定也不能因为都叫 Binding 就共用一个无领域语义的执行器。

未来若运行文本需要随 Branch 回退，应明确历史点指向哪些文本版本，而不是回滚跨 Timeline 共享的作者资源。跨类型恢复需要显式协调，不能从 Changeset 自动推导。

## 待场景确认

1. Agent 新增或修改运行文本，归属 Timeline、Branch 还是 Agent Session？正文提交前后的记录怎样随 Fork 保留？
2. 哪些文本默认进入 Prompt，哪些仅在触发或检索时参与？消费策略不作为新增内容的隐式副作用。
3. 作者宏如何携带、如何确定同名来源、何时求值和冻结？宏结果是否需要保存应由重放需求决定。
4. State facts 如何进入 Activation，使用哪个一致快照？在 Agent Step 中修改 State 后，何时重新求值？

这些问题不要求现在设计完整记忆系统，也不授权继续预设 State 或 VFS 实施。

## 与既有文档的关系

- [Memory / Summary v0](memory-summary-v0.md) 中“统一存入 Setting Layer”和专用写 Tool 仍是旧候选，不是已实现合同；存储选择以本次用途与生命周期原则继续讨论。
- [Content Component / Binding v0](prompt/content-component-and-binding-v0.md) 的两层 ECS-like 候选不意味着将所有文本改造成模拟组件。
- [File-backed Resource / CodeAct Plan](../../plans/file-backed-resource-agent-script-codeact-plan.md) 仍是提案；本讨论不否定非 Prompt 附件，但也不以该计划证明 Timeline 文件已经存在。
- [变量作者 UI Plan](../../plans/ui/state-authoring-runtime-separation-plan.md) 暂停实施，保留已有改动；预设 State 的对称入口要求已经撤回，待宏与运行内容合同明确后再修订执行范围。
