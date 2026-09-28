# CodeAct 与 VFS 工具实施计划

> **2026-09-24 接续**：Narrative 宿主已提供有效范围、加工及历史单次授权合同；本轮补齐官方 CodeAct 历史读取 Yes/No 接线和审批等待超时预算。下方早期“历史权限未实施”的记录保留为历史，不代表当前状态。完整 Plan 仍不归档。

### 历史读取审批接续验收

- 复用 `ToolRuntimeRegistration.approve` 与宿主有界 reader；不改 Memory 指针、采样范围或正文加工实现。
- 历史读取使用独立 Run 事件与 RPC 答复；修改审批不能放行历史读取。弹窗展示目标、范围和字符/节点预算，支持允许、拒绝及可选拒绝原因，不返回未批准正文。
- 官方 Content/JSON 两种 CodeAct 均经宿主处理器授权；无处理器默认拒绝。审批等待通过现有 `waitForUser` 暂停墙钟预算，取消清理待审批请求，不生成永久 grant。
- 验证：`codeact-history-approval.test.ts`、`agent-run-rpc.test.ts`、`narrative-read-access.test.ts` 共 17 项通过；Application Runtime build、Studio Client / Server TypeScript 检查通过。
- 未验证：真实 Provider 交互、弹窗人工视觉与交互验收。保留另一任务的 `codeact-tool-loop.test.ts` 加工夹具，未修改采样与投影模块。

> **状态**：In Progress / 双通道、领域 VFS 读取、引用跳转、replace、Prompt Resource Patch、节点 Metadata、同资源 move/delete/create/copy 与整份 Prompt Resource copy、绑定 Timeline 的 Narrative 只读采样已接入；Pin、Narrative 历史权限与通用资产挂载待接续
> **更新**：2026-09-22
> **归属**：CodeAct 执行与 VFS 工具的唯一实施入口。2026-09-21 用户已授权正式接入，明确要求 Content/freeform 与 JSON 两种入口；按第 6 节实施，不重新开放已经确认的产品方向。
> **来源**：[读取与交互 Discussion](../discussion/application/agent/tool-data-view-interaction-v0.md)、[Playground 记录](../../../apps/playground/CODEACT-EXPERIMENT.md)、[旧综合提案](../../archive/plans/file-backed-resource-agent-script-codeact-plan.md)。

## 1. 目标与归属

让 Agent 通过受控 JavaScript 和面向文件的接口发现、读取与修改授权资源，同时保留领域权限、版本、提交和审计语义。不建立第二套领域 Store、Skill 系统或 Agent 生命周期。

| 计划 | 所有权 |
| --- | --- |
| 本计划 | CodeAct 输入输出、执行边界、VFS 挂载与工具、YAML 投影、Pin 操作接入、即时写入与撤回依据 |
| [上下文骨架与记忆投影](./agent-context-skeleton-and-memory-projection-plan.md) | Skills / Workspace / Notice 锚点、上下文采用时点、Pin 投影与记忆生命周期 |
| [Agent Runtime 总计划](./agent-runtime-session-and-workspace-plan.md) | Run / Step / Transcript、暂停恢复、工具循环接入、统一写入统计与 Diff UI |
| [资源与分发](./workspace-resource-and-distribution-plan.md) | Bundle、来源、更新与开发工作区；不得由本计划顺带重做 |

共享接口：本计划提供读取观察、访问状态，并复用领域层已成功持久化的修改事实；上下文层决定是否及何时投影为 Notice 或固定内容。LS 是主动查当前状态，Notice 是提示值得关注的变化，不各建一份真值。领域事件不由 CodeAct 另行生成。

游玩剧情分支首版采用新建空白 Agent Session、不继承废弃剧情工作记忆的方向；分支与 Session 编排、会话膨胀归 [Session 生命周期章节](./agent-runtime-session-and-workspace-plan.md#游玩分支与-session-生命周期)。CodeAct 只消费当前明确的目标与授权，不负责复制、回滚或清理会话。

分支资源隔离归 Timeline 与静态资源模块，包括 Narrative 版本归属、Setting 的分支覆盖及共享资源修改语义；不作为本计划的设计或实施工作包。CodeAct 依赖这些模块提供明确的目标与隔离合同，不通过 VFS 另建隔离层，也不假定现有存储已满足隔离要求。

## 2. 已确认方向

### 2.1 执行与描述

- CodeAct 是统一执行入口，不把每种资源操作扩展为独立的模型顶层 Tool。
- 能力教程与调用传输分离，复用 Prompt Resource、预设锚点和按需读取。Skills 名称、用途和入口可常驻专门锚点，详细文件不自动全部加载。
- 不新增 Skill 注册器、loadSkill 工具或独立权限体系。教程不是授权，读取教程不代表获得写权限。
- 希望减少代码及长正文的 JSON 转义；旧文中的“必须单一 JSON Tool”不作为新合同。本轮提出的 Content / JSON 双入口及首期传输范围见 5.2，属于新工程建议，不倒记为此前已确认的产品决策。
- 已接受的执行倾向：后端负责执行和权限代理，前端负责展示与控制；使用现成 JS 引擎，不自建语言解析器。每次调用使用新的 JS 上下文，已生效的资源修改与 Pin 独立于 JS 生命周期保存，不建立必需的草稿提交层。具体引擎、进程隔离、资源限制和取消合同仍待验证，QuickJS 等仅为候选。
- 代码通过受控 ctx 桥接领域能力，不获得后端内部对象或任意宿主权限。Agent 继续任务不等于恢复中断的 JS 执行栈。
- CodeAct 的价值是条件判断、循环、计算、批处理和组合调用，不只是 await 的语法包装；JSON Tools 也可以批量调用。独立读取可考虑并行，异步或同一段源码不意味着事务或允许无界并发。

### 2.2 VFS 与读取

- 面向 Agent 使用可推导的路径；平台保留稳定 ID 映射，不要求模型复制内部 UUID。
- 多角色和外部参考使用独立挂载根；跨挂载访问不等于共享同一 Timeline / State。挂载权限由运行时检查。
- LS 默认一层文件树，只附必要运行时状态。说明由 README / doc 负责，不新增每项必填 description。
- Search 定位路径及获准显示的匹配内容；Read 提供正文。模型显示头不得混进脚本拿到的正文。
- EC 按实体和组件提供 YAML 文件表示，复用现有 YAML 依赖和领域 Schema；世界说明与教程用 Markdown。
- 未注入、未 Pin、不在场都不等于不可发现。可见但 locked 与隐藏存在性必须区分，搜索不能绕过读取边界。
- 已注入、当前可读、已固定、内容已变化是不同维度；不要合并成一个互斥枚举或默认禁止重读。
- Pin 固定资源引用用于持续投影，不递归读取整个目录；Unpin 不删除历史 ToolResult。

#### 阅读单位与顺序

- 默认完整资源优先，领域范围其次，行范围兜底。普通人物设定、规则、Skill 读取完整条目；Narrative 以节点及必要相邻节点为单位；State 以组件为单位。搜索命中片段不足以代替完整条件和例外。
- 不把整条 Timeline 拼成巨型文件后用全局行号定位；先按分支和节点范围采样，再按需读取节点局部内容。
- 长 Narrative 正文与历史正文是按行读取的重点场景：节点/分支定位后按行范围读相关段落并保留上下文。其他用途包括超长文件续读、已有完整理解后的局部核对、YAML/脚本错误定位和日志调查；不强迫普通 Setting 按行拆读。
- 行号可以用于定位，不要求默认显示，更不要求按行号修改。局部读取必须标明实际范围与完整性；受预算截断时提供真实续读位置，不静默伪装成完整结果。
- 行号和读取基线对应实际返回的原文或物化文本，不能用物化后的行号直接编辑作者源数据。只有局部读取不能作为已经完整阅读的证据，不能把截断结果直接全量写回。
- LS 优先保留作者维护的资源树顺序，不按创建时间或文件名字母顺序代替领域顺序，也不按注入状态重排。
- 资源树顺序、任务阅读顺序、最终 Prompt 注入顺序是三件事。跨锚点的最终编排应读取指定上下文的组装视图，不由目录隐式拼接产生；该视图入口尚未确定。

#### Narrative 当前范围与历史追溯

- Agent 不开放旧 Session 的搜索和翻阅；工作记忆与保留交互由上下文投影提供，通用 VFS Search 不能成为绕过入口。
- 默认使用已经被动注入的剧情记忆和有效正文，不安排例行重读。更新提醒后的刷新、精确引用定位和写入前检查是主动读取的合理用途。
- 普通 Narrative LS/Search/Read 都限制在当前允许视图，不能通过已知路径穿透到有效区间外。无匹配不自动扩大范围。
- 历史原文追溯是独立受控入口，默认关闭；用户/宿主明确授权节点范围后才可使用，并限制返回量和累计读取预算，不提供无限制 history=true。
- 已总结不等于删除原文，也不等于永远禁止查证；允许追溯不自动允许编辑。真正的权限隐藏仍不可被历史入口绕过，授权范围外不泄露节点内容或存在性。
- Search 首期候选采用字面关键词数组与 all/any，all 在同一资源或节点内匹配，不假装理解“初次”等自然语言意图。找首次事件仍需结合剧情顺序和实际授权范围判断。
- 模型输出采用 rg 式路径、准确行范围与少量原文，重叠上下文合并；明确当前/历史范围、片段上限和仍有未返回结果，不附逐条生成摘要或大型 Metadata JSON。
- 摘要只有覆盖范围时不伪造精确原节点引用；从摘要扩大到原文仍需历史授权。

### 2.3 写入

- 2026-09-21 修正：目标是写入成功即生效并可撤回，不是先存未提交草稿再由 Agent 显式 commit。撤回依赖可核对的历史事实，不等于目前所有资源和副作用都已经可逆。
- 自由叙事可先形成正文，再由 Agent 根据实际事件调整 State；无事件变化不强求 State 更新。这个创作顺序不引入统一草稿/发布系统。
- 单次写入所需的领域事务不等于整个 CodeAct / Run / Turn 一个事务。复用实际 mutation scope；后续调用失败或取消，不暗示之前成功写入自动撤回。
- 平台校验数据、权限和冲突，不替 Agent 判断所有剧情语义。权威战斗结算等规则驱动写作尚不在此闭环中。
- 普通润色与事件改写分开；Agent 根据用户的新方向判断是否以及如何修改当前 State，平台不自动重演全部剧情后果。
- 用户可以选择回滚到某次 State 修改之前，或向 Agent 表达这一意图。它与普通内容编辑不同：已触发的脚本、事件及其他副作用是否能恢复，必须按实际覆盖范围说明；具体授权回滚入口待定。
- Agent 不得回滚自己的 Agent Session 对话/Transcript。Narrative / State 的回滚不自动回滚 Agent 工作记录。
- 成功返回简短路径与结果，不回显完整正文。修改统计以条目数为主，有可靠行数时附带行数。
- LS 可提示修改；独立 Status / Diff 是候选，必须指明比较基准，不能假设已经有完整 Git。

#### 内容编辑语义

- 创建、全量替换、局部编辑、追加必须在语义上区分，不能让含糊的 write 同时默默承担所有行为。创建碰到已有资源如何拒绝、替换如何检查读取基线，须进入正式合同。
- 局部修改优先考虑带上下文的精确替换或成熟 Patch 格式，不建设以行号为核心的修改协议。显示 Diff 与输入 Patch 不必是同一种格式。
- 候选精确替换要求旧文本唯一匹配；候选多块 Patch 先验证整份补丁，再在受支持的单次写入范围内应用，不引入额外暂存阶段，也不默认做模糊匹配。最终格式、是否同时提供两者尚未确认。
- 追加需要处理重复执行；向一个正文节点追加文本与新建 Narrative 节点是不同领域行为，不混为 append。
- Patch 正确修改文本不代表已修正事件后果；正文改写的 State 一致性不能靠文本匹配自动保证。
- Playground 的 write/edit 和先前数字行段 Patch 示例只提供体验依据，不冻结生产签名、匹配容错或覆盖策略。

### 2.4 内容、Metadata 与资源组织

- 内部创作直接通过领域 API 更新权威资源，由前端按现有机制显示；不为内部编辑引入真实目录 Watcher。DEV / 外部 IDE 的 checkout、apply 属于另一条工作面。
- SQL 与 Blob/本地字节可以由同一个 VFS 表示。可主动读的 README 附件不必成为 Prompt Resource；可读脚本不等于允许执行，修改源码不自动增加 Grant。
- 节点 Metadata 在领域模型中随节点保存。DEV/分发索引是序列化形式，不要求内部 Agent 先编辑一个全局大索引，也不新增同步真值。
- 当前 VFS 将节点 Metadata 投影为 `@meta.yaml`（目录节点）或 `.meta.yaml`（正文节点旁）；允许字段为 `label`、`category`、`meta`、`enabled`、`capabilities`、`extra`，仍通过 `ctx.write`、版本检查和审批写回现有 `node.update`。内部 ID、父节点和顺序不伪装成普通 Metadata 字段。
- `ctx.move(path, parentPath, orderIndex)` 与 `ctx.delete(path)` 已接入同一 Prompt Resource 内的节点结构操作。两者要求先读取目标 Metadata，复用资源版本 CAS 和审批预览；不允许跨资源、根节点或 Metadata 文件作为结构目标。创建/复制不在本切片猜测新身份和默认配置。
- `ctx.create(parentPath, spec)` 已接入：父目录 Metadata 必须先读取，内部节点 ID 由宿主生成；模型只能提供 `label`、`kind`、正文和作者 Metadata，不可指定内部 ID，也不复制运行态 Pin。
- 路径用于定位节点，受控句柄可修改作者配置与顺序。`ctx.open(path)`、`entry.configure(patch)`、`entry.moveAfter(otherPath)` 仅是候选，不引入独立模型顶层工具；避免与文件接口无必要地重复。
- 新建节点必须有内部身份和领域必需字段；作者配置可缺省，不因此默认常驻。复制哪些作者配置、跨挂载如何处理失效锚点仍待确认；不得默认复制运行态 Pin 或执行授权。
- 静态资源可考虑用目录表达归属、链接表达复用；路径是现有关系的投影，不是第二套关系数据库。copy/move/link/unlink/delete 的精确签名与影响仍待确认。
- 解除挂载不等于删除目标，移动不应丢失稳定身份，资源重命名不应静默破坏引用。动态 State 不能把移动 inventory 文件直接解释为剧情物品交接。

#### Copy 范围澄清（待确认）

- 用户指出复制对象可能是单个 Setting 条目、整个文件夹，或整份世界书/预设，不能默认缩窄为同资源节点子树复制。
- 对象粒度与目标作用域分开：条目/文件夹与整份 Prompt Resource 是不同领域操作；同资源、跨资源或跨角色卡是另一维度，不把复制自动等同于迁移或解除原挂载。
- 整份资源已有 `duplicatePromptResource` 领域入口；后续接线须复用并核对其配置、挂载与引用处理，不另造复制真值。
- 已撤下未定案的同资源 `ctx.copy` 实现。统一路径式入口还是分方法属于待定 API 设计，不因底层操作不同就预先要求 Agent 使用多套工具。
- 下一步只需明确复制应携带的内容、作者配置与内部引用，以及外部引用/挂载如何保留；不复制运行态 Pin 或执行授权。

#### 通用 Copy 提案（待实施）

`ctx.copy(sourcePath, destinationPath, options?)` 作为一个统一入口，按源路径代表的对象粒度分派到不同领域操作。Agent 不需要知道 Prompt Resource Store 的内部方法，也不需要为“条目、文件夹、世界书、预设”分别学习一套工具。

**参数语义**

```ts
await ctx.copy(sourcePath, destinationPath, {
  name?: string,
})
```

- `sourcePath` 必须来自当前调用的 `ctx.ls`、`ctx.search` 或 `ctx.read` 结果。
- 普通节点的 `destinationPath` 是目标 Prompt Resource 内的目录；复制结果使用源节点名称，`name` 可覆盖新节点名称。
- Prompt Resource 根节点的 `destinationPath` 是资源集合目录；此时执行整份资源复制，`name` 是新资源名称。
- 不提供 `mode`、内部 ID、资源类型或挂载 ID；模式由源路径绑定和目标路径绑定推导。无法唯一判断时明确报错，不猜测。

**三种实际操作**

1. **节点或文件夹复制**：复制源节点及其完整子树到目标资源目录。复制正文、作者 Metadata、启用状态、类别、能力声明、作者扩展字段和相对顺序；为所有新节点生成新内部 ID。源节点不改变，不复制运行态 Pin、读取观察、审批状态、执行授权或 Agent 工作记忆。
2. **整份 Prompt Resource 复制**：源路径指向资源根时调用现有 `duplicatePromptResource`。复制资源级名称、类型、Metadata 和节点树；Preset 复制它声明的 Setting/Tool 挂载配置，但继续引用原有 Setting/Tool，不递归复制被挂载资源，也不复制指向该资源的外部挂载、Card、Agent Profile 或 Timeline 关系。
3. **跨资源节点复制**：源节点和目标目录属于不同 Prompt Resource 时，仍使用同一个入口，但必须额外通过作用域授权。复制规则与节点复制相同；不自动把目标资源变成源资源的挂载，也不自动迁移跨资源关系。

**引用和失败规则**

- 新节点内部身份必然重建。平台拥有类型信息的内部引用，只有在引用目标也位于同一复制闭包内时才重映射；指向复制闭包外的资源、工具、附件或 URI 默认保持原引用。
- 对无法判断是否为内部引用的普通字符串不做猜测式替换；如果资源声明了必须随复制迁移的强引用，复制在缺少迁移规则时失败，而不是产生半正确资源。
- 目标目录、源节点 Metadata 和资源根 Metadata 必须先读取；写入前复核资源版本。复制大子树或整份资源时，审批显示摘要 Diff、对象数量、引用处理和目标位置，不倾倒全部正文。
- 返回面向模型的文本摘要：复制粒度、源路径、创建路径、节点/资源数量、引用处理、Changeset 和未处理警告。内部 ID 映射只在后续确实需要继续操作时通过新路径重新发现，不返回大映射 JSON。

**明确不纳入通用 Copy**

- Narrative、Timeline、State Revision、Agent Session 和运行态 State 不通过 `ctx.copy` 复制；它们分别属于 Timeline、State 和 Session 生命周期合同。
- 复制整个角色卡、世界书包或预设包的导入/导出属于资源分发与 Bundle 能力。`ctx.copy` 只复制当前 VFS 已授权且可定位的资源或节点，不替代打包迁移。
- `copy` 不等于 `move`、`link`、`mount` 或 `commit`；源对象保留，目标对象立即写入并产生独立 Changeset。

首期建议先实现节点/文件夹复制与整份 Prompt Resource 复制；跨资源节点复制可以在作用域授权和引用迁移规则落定后复用同一入口开放。

### 2.5 返回与指导性错误

- 内部可以保留结构化错误供脚本判断，模型侧返回简短的目标、原因、实际影响和下一步，不只说“执行失败”，也不默认倾倒内部堆栈。
- 必须区分本次操作未应用与此前调用已经生效。若组合执行只完成了一部分，应报告实际成功和失败范围；不能通过“执行失败”暗示整体回滚，不自动重放非幂等写入。
- 匹配歧义应提示读取附近内容、增加唯一上下文；基线变化应提示重新读取并合并，不能要求原样重复旧覆盖；权限错误不得指导绕过或泄露隐藏资源。
- 错误码、异常可捕获形态及多模态返回签名待定。文本、图片、结构化值不强制统一成字符串；读图需要进入模型实际可消费的多模态通道，不返回无用途的字节转储。

候选显示示例（不是冻结错误合同）：

```text
EDIT_AMBIGUOUS /alice/personality.md
目标文本匹配多处，本次编辑未应用。
请读取匹配附近内容，补充唯一上下文后重试。
此前成功的其他写入仍然生效。
```

### 2.6 并发与授权

- 用户可能在 Agent 读取后修改同一资源。旧文本匹配失败或读取基线冲突时，本次写入明确失败，Agent 重新读取当前内容后调整操作，不静默覆盖用户改动。
- 唯一文本匹配不替代并发保护：全量覆盖没有旧文本匹配条件，局部匹配也可能漏掉其他依赖变化。应复用适合操作范围的领域版本校验，并将校验与实际写入置于同一受控边界；具体粒度待定。
- 授权模型已确认，分为两个独立维度：作用域决定能操作哪里（当前角色卡/资源、额外挂载、跨角色卡或全局资源）；动作权限区分普通动作与高危动作，决定该动作是否允许、是否需要申请。
- 两个维度同时检查：允许跨角色卡或访问全局资源，不自动允许其中所有高危动作；普通动作也不能因此越过已授权范围。全部申请、仅高危申请或范围内全权限是动作审批策略，不是跨作用域通行证。
- 2026-09-21 用户确认审批交互保持极简：展示此次 Diff / State 更新，用户选择 Yes 或 No，可附拒绝原因。不要求用户为每次 CodeAct 勾选一组能力，也不再将“Invocation 能力集合还是逐操作申请”作为产品阻塞问题。作用域仍由宿主约束；审批展示不取代作用域检查。
- 不再把这两个维度列为需要重新选择的架构方案。后续先核对现有权限能力并映射具体操作；默认策略、具体高危集合和授权期限不能从框架推定已确认，确有影响行为的缺口再定向提问。
- 创建、复制、移动、解除挂载、删除保持不同语义；可定位路径不等于允许操作。Agent 不能自行扩大作用域或授予自己新权限，回滚自己对话的禁令不因模式而解除。

### 2.7 事件、Hooks 与独立 Agent

2026-09-21 确认：平台以不同作者的 Agent / 扩展独立开发为前提，不要求写作预设知道生图 Agent，也不要求生图作者理解主写作流程。采用独立交付、事件消费的方向，不建立主 Agent 必须协调所有消费者的默认工作流。

- 写入成功即生效；平台不强制所有 Agent 调用统一 Commit / Finish 才发布修改。数据库内部事务仍保留，但不等于模型必须执行的提交步骤。
- 事件来自领域数据成功持久化后的事实，不来自 Agent 调用写入工具或宣布完成。Agent、用户命令和其他受支持入口调用同一领域写入能力，产生相同语义的事件；写入失败不能发布成功事实。
- 此处的正文新增触发条件是“新增了一个非 User 输入的 Narrative 节点”，不另设“谁判断正文产出完成”的环节，也不等待 Agent Run 结束。区分节点语义与操作者身份：用户通过命令创建正文也符合条件，不能因创建者是用户就排除；不因此给 Narrative 新增 assistant / user / system 角色体系。
- 区分 Narrative 节点新增、既有正文修改、State 修改和媒体结果更新。一次 Patch 不伪装成节点新增，不自动重推 State 或完全重绘，是否监听修改由消费者明确选择；事件名称及字段对接既有领域合同。
- 其他消费者按各自订阅规则响应，主 Agent 不等待所有订阅者结束。生图失败不撤销正文，也不将已经成功的主 Agent 工作改判失败。数据变化通知不是授权或强制执行命令。
- Agent 之间仍允许受权限约束的显式通信和协作；画图 Agent 可以拥有自己的交互，玩家可直接修改图片，不必经主 Agent 转交。独立通信不意味着可以读取另一 Session 的全部历史。
- 特定作者可以明确选择需要整体图文交付的流程，自行指定编排者、必需产物和失败策略；平台不从“存在订阅者”推断必须等待它，也不把此需求扩成所有资源的草稿系统。
- 剧情脚本可选择提供下一次调用消费的 Notice，或请求启动新的 Agent 工作；自动消息保留来源，不冒充玩家输入，不修改已经发出的 Provider 请求。Notice 的投影生命周期归上下文计划。
- 事件消费需要明确目标 Timeline / 分支 / 节点版本及因果来源。迟到结果不写入用户后来切换的分支；消费者的写入继续经过其自身权限检查。
- 平台需收束重复交付、循环触发、取消和过期结果的处理；不承诺 exactly-once 或不可逆副作用可撤回。审批方式与外部副作用策略另行确认，不把重试和撤回责任隐藏在 Hooks 中。

CodeAct 调用领域能力并返回操作结果，不额外发布一份领域事件，也不在一次 JS 上下文里持有长期监听器。成功持久化与事件发布的具体接线归领域写入和事件模块；此处不指定数据库触发器或新增通用工作流引擎。本计划只核对工具入口正确复用该合同，不将整个事件模块的实现归入 CodeAct。

## 3. 实验与事实边界

证据集中在 [Playground 记录](../../../apps/playground/CODEACT-EXPERIMENT.md)，不复制全部过程：

- 空白上下文 Agent 能从 README 与文件树探索两张卡和参考目录。
- A/B 在场、C/D 离场的 YAML EC 场景中，Agent 主动读取 C 的位置和物品栏，沿地点图得出可通行的 9 公里路线；没有主动 Pin。
- 同一 Agent 后续写出完整 Markdown，先暂存正文、再修改位置和钥匙持有者，最后提交 6 个文件；D、生命和关系未改。
- 早期暂存实验验证精确编辑、失败保留草稿、旧正文保留和 Pin 恢复；该阶段模型未改写正文，后续即时 Patch 实验补充了模型编辑证据。
- 外部衣物教程和角色战斗教程验证了按需读取、深层引用及分别 Pin；未验证模型自主切换文风。
- 2026-09-21 新增独立 Narrative 只读场景，模拟有效区间、限定历史入口、多词搜索、行范围和预算。它不复用旧 commit/discard，不代表已经改造生产采样器或实现即时写入/撤回。
- 随后新增宿主显式启用的单节点即时 Patch 实验：按行读取保存基线，唯一上下文定位，直接生效并保存前后版本；历史仍只读。定向检查覆盖局部修改、多块失败、歧义及并发冲突，具体证据与限制见 Playground 记录，未冻结生产 Patch 格式。
- 即时 Patch 模型体验中，主持人在读取后插入一句；Agent 遭遇基线冲突后重读、修改并回读，保留了用户插句，实际只替换两句。该证据不涵盖历史事件改写或 State 后果修正。

这些不证明生产 Sandbox 安全、真实 PromptBuild 接线、大数据检索或完整历史回退。Playground 的 node:vm 不是安全边界，文件保存方案不是生产数据库事务合同。

特别说明：上述暂存/commit/discard 实验保留为历史证据，已被本节前述“即时生效、支持撤回”的新方向取代，不得原样接入生产。本轮没有改写旧实验日志或迁移 Playground。

此前源码核对已记录 Document / Prompt Resource / State 的部分 Revision 能力，也记录 Narrative 编辑路径缺少独立旧正文版本。实施时须重查当前代码，不把 2026-09-14 的核对当永久事实。

## 4. 当前工程事实

以下为 2026-09-21 源码核对，不以 Playground 或类型声明代替生产支持：

| 现状 | 源码与工程影响 |
| --- | --- |
| 9 个官方结构化工具已经注册 | `packages/application-runtime/src/agents/official-tools/index.ts`；涵盖 Context、State、Narrative、Workspace Prompt Resource。不能直接删除既有 ID、预设挂载和回放记录 |
| 工具定义、预设挂载、执行注册分离 | `agents/tool-registry.ts`、`agents/tool-loop.ts`；复用 Registry、Invocation、Result、审批入口和 Transcript，不新建 CodeAct Run |
| 可执行的传输为 Native Function 与 Content | `agents/tool-loop.ts` 中 `providerCustom: false`；不因类型含 `provider-custom` 就承诺可用 |
| 通用 structured fallback 尚非可直接复用的闭环 | 当前选择优先 Content；Native 分支只生成 `arguments`，而 freeform/hybrid 校验要求 `rawInput`。不能只填 fallback schema 就宣称双传输完成 |
| VFS 目前只是命名辅助 | `vfs/vfs-gateway.ts` 从 label 生成路径和媒体类型，尚无多挂载、重名消歧、读写授权或文件访问实现；`official-tools/context-snapshot.ts` 消费它生成 Context 快照 |
| 领域能力已通过 Scope 注入，但边界较粗 | `runtime/agents-runtime.ts::prepareAgentTurn` 组装 State / Narrative / Prompt Resource 回调；当前全局 State 可访问、Workspace 使用布尔开关。这不是本 Plan 的细粒度授权实现 |
| 超时不等于终止执行 | `agents/tool-loop.ts` 用 AbortSignal 与 Promise 竞争停止等待；不能据此保证模型死循环停止，或已派发写入未提交 |
| 内置工具持久化与安装链存在 | `runtime/runtime.ts` 初始化 Tool Documents，`runtime/official-content-runtime.ts` 为新安装预设挂载工具且默认关闭；新增工具不会自动给已有预设补挂载 |
| 现有 JS Renderer 与 Loom Runner 不是此执行器 | `scripts/loom-script-contracts.ts` 的运行目标为 client-sandbox；`packages/loom-runner` 是 Prompt 编译适配器，不用于运行模型生成的 JS |

正式工具合同参考 [Agent Tool System](../../architecture/application/agent/tool-system.md)。上述路径均相对仓库根；修改前重查当前源码及工作区差异。

## 5. 最小工程设计

本节是本轮工程化建议，区别于第 2 节继承的产品决策。原则为：一套受控领域能力、一个 CodeAct 执行器、可选择的模型入口；不强制迁移用户的旧预设。

2026-09-21 后续确认：产品默认方向为 CodeAct，现有 JSON Tools 保留复用，不将“两套方案”扩成两套同等规模的基础设施。默认创作方向不等于自动开启已有预设的工具或扩大授权。稳定工具教程接入已经落地的预设骨架，具体见 5.6。

### 5.1 放置、目录与命名

CodeAct 放在 `packages/application-runtime/src/agents/codeact/`；VFS 扩展现有 `src/vfs/`。不新增顶层 package，不放进 ai-gateway、kernel 或前端，也不复用名称相似但职责不同的 loom-runner。

```text
packages/application-runtime/src/
  agents/
    codeact/
      execute.ts              # 一次执行、输出预算、结果归一与清理
      sandbox.ts              # 创建/终止 Worker，处理本次执行的桥接请求
      sandbox-worker.ts       # Worker 内的 JS 引擎与 Promise job 执行
      protocol.ts             # Worker 消息及可序列化错误；不形成通用 RPC 框架
      context.ts              # 将受控 VFS 方法暴露为 ctx；不导出 Store
    official-tools/
      codeact.ts              # 两种传输入口的 Definition 与 Registration
      index.ts                # 仍是官方工具统一注册入口
    tool-loop.ts              # 沿用工具循环、取消和结果回放
    tool-registry.ts           # 沿用 Invocation / Result / Scope 合同
  vfs/
    vfs-gateway.ts             # 保留已有导出，接入路径与资源解析
    types.ts                  # 路径绑定、读取观察、领域访问所需最小类型
    read.ts                   # LS / Search / Read 与范围裁剪
    format.ts                 # 文件树、路径/行头、搜索片段与简短错误
    write.ts                  # 后续阶段：基线检查及受控领域 Mutation
  runtime/
    agent-tool-scope.ts        # 从 prepareAgentTurn 提取宿主能力组装
    agents-runtime.ts          # 传入本次 Session、目标、授权与上下文
```

文件名遵循现有 kebab-case，能力称 CodeAct，目录用 `codeact`，不再并用 CodeActor。上表是责任边界，不要求先建空文件；某一资源实现确实使 `read.ts` / `write.ts` 过大时，再按 `prompt-resource`、`narrative`、`state` 拆分，不提前建设 Provider 插件注册体系。

`application-runtime` 负责执行和领域编排；`studio-server` 仅在需要进程级组合/关闭钩子时接入。Worker 入口不作为公共 API 导出，也不能被 client 引入。模块间依赖通过既有 Scope 与普通函数传递，不新增 Service Locator。

### 5.2 两套方案究竟保留什么

分清两件事：

1. **能力入口**：旧的多个结构化工具，与一个执行 JavaScript 的 CodeAct 入口。
2. **代码传输**：CodeAct 源码既可通过 Content 原文传输，也可放在 JSON 的 `code` 字段里。

保留前者不意味着复制领域实现；支持后者不意味着维护两套 JS 引擎。

首期采用两个轻量传输入口，复用现有工具挂载，不增加 Profile 模式字段或全局开关：

| 工程命名 | 定义与输入 | 共用执行 |
| --- | --- | --- |
| `official/codeact`，模型名 `codeact` | freeform：协议 metadata 为 `{}`，canonical Invocation 仅含 `rawInput` 源码；走已有 Content 协议 | 同一 `executeCodeAct`，提取原始源码 |
| `official/codeact_json`，模型名 `codeact_json` | structured：仅 `{ code: string }`；走 Native Function | 同一函数，入口仅提取 `arguments.code` |

新示例预设只启用其中一个入口；两个是传输别名，不是两个业务工具集。源码编译、ctx、授权、结果与错误完全共用。JSON 的转义成本仍存在，不宣称 JSON 模式也无转义。

选择双 Definition 是为了不新增持久化传输偏好和迁移，也不扩大成全工具系统的 fallback 重构。`structuredFallback` 通用路径暂不使用，不留下“配置了但不能跑”的依赖。Provider 原生 Custom/Responses 接入仍在首期之外。

Content 沿用 `loom-content-v1` 的保留结束标签限制；包含冲突字面量时应在调用前选择 JSON 入口或安全构造字符串，不用正则“修复”任意 JS，不在调用失败后自动重放代码。首期保持现有“同一 Step 不混合 Native 与 Content 调用”的限制。

传输适配只解析外层协议；JS 由引擎解析。作者写顶层 `await ctx.read(...)`，不要求作者自行包装 async 函数，也不要求把整段代码再次变成一个 JS 字符串。

### 5.3 共用能力，而非从 CodeAct 调用旧 Tool Handler

```text
旧 JSON Tool Handler ----------------------+
                                          |
Content / JSON CodeAct -> Sandbox -> ctx --+-> 宿主作用域与动作授权
                                             -> VFS 路径解析 / 领域能力
                                             -> 现有领域事务、版本与变化事实
```

- 先从 `prepareAgentTurn` 提取 Scope 组装，保留现有调用行为，再为 VFS 接入精确的资源、目标、读取范围与授权信息。这里只传宿主能力，不把 SQLite、Blob Store、网络或全局 Runtime 对象传入 Sandbox。
- 不实现 `ctx.callTool(name, args)` 来绕过工具生命周期，也不将旧 ToolResult JSON 解析后再包装成 VFS。相同领域动作使用同一受控回调；旧 JSON 字段与 VFS 文本显示各留在自己的入口适配中。
- 旧 `read_context` 通过 Fresh Context Mount 注入内容，新 `ctx.read` 读取正文；两者不是同一种输出合同。共享资源解析与授权，不强行让旧工具改成新返回格式。
- 工具是否挂载不等于领域授权。启用 CodeAct 不代表获得所有旧工具的权限；外层允许运行 JS 也不代表其中每次写入都被批准。每次 ctx 操作由宿主按实际目标与动作检查，不静态扫描源码猜权限。
- 同一次 CodeAct 可有多次 State 写入，不能全部复用当前旧 Handler 的 `invocation.id` 作为同一个幂等键。宿主为每个已接受操作分配子操作标识，并关联父 Invocation；仅对领域已支持的幂等合同使用它，不自动重放整段 JS。
- VFS 路径只表示虚拟资源，不直接拼成宿主文件路径。README、脚本和图片通过已有附件/Blob 归属访问；不能因使用文件名就获得任意磁盘或网络访问。
- Snapshot/版本观察保留在宿主，跨同一 Run 的 CodeAct 调用可复用；Sandbox 每次仍销毁。首期未持久化的读取基线丢失后要求重读，不假装具备跨进程恢复。Pin 的持久化由上下文模块接管。

### 5.4 Sandbox 的首个验证任务

当前依赖中未发现可直接复用的后端不可信 JS 执行器。优先验证 `quickjs-emscripten` 的 WASM 引擎放在独立 Node Worker 内执行；这是候选，不是已经通过验收的安全实现。不同时保留 node:vm 生产后门或第二套引擎。

2026-09-21 核对上游 README：它提供 Runtime 内存/栈限制、中断回调、宿主 Promise 桥接；同时明确项目未经安全审计。资料来源为官方仓库 `https://github.com/justjake/quickjs-emscripten`。本次未安装依赖或测量性能，实施验证时记录确切版本，不将浮动 main 当锁定版本。

验证合同：

- 每次执行创建独立 JS Runtime/Context，完成、异常、取消均释放。Worker 用于隔离执行负载与可终止性，不把 Worker 本身当作 OS 安全沙箱。
- 仅注入 `ctx`、受限 `print` 和实际需要的值转换；不注入 Node `process`、`require`、fs、fetch、宿主函数对象或任意模块加载器。跨边界数据有形状、大小及方法白名单校验。
- `await`、条件、循环与有界并行可用；验证 Promise job 泵、异常及永不完成的 Promise。CPU、墙钟时间、内存、输出和在途操作数均有可执行的上限，而不是只在教程里提示。
- 取消先停止接受新的宿主操作，再终止计算；已派发的领域写入由宿主记录真实提交结果，不能随 Worker 一起丢失。停止等待不能直接报告“没有写入”。
- 生产接入前验证编译后 `.js` Worker 入口和 WASM 资源能加载；只在 tsx / Vitest 中能跑不足以交付。

P0 产出限制、失败样例和成本数据；通过后由主 Agent 给出是否满足本地应用威胁边界的结论。若必须增加子进程/OS 级隔离或改变宿主权限，先向用户确认，不在此悄悄扩大。

### 5.5 迁移与教程

- **添加，不替换**：注册 CodeAct 并让初始化创建缺失 Definition。保留全部旧 Tool ID、运行注册和 Transcript 回放；不覆盖用户修改过的定义。
- **按预设选择**：使用现有 Preset Tool Mount 和 Profile `toolOverrides`。新建 CodeAct 示例只挂载或启用所需入口；已有预设由作者显式切换，不自动批量改数据库。
- **逐项共用**：先抽取确有两个调用者的领域操作。旧 JSON 的返回/兼容参数保持原契约；新能力不要求再新增一整套对应 JSON 工具。涉及收紧旧权限或旧行为时列出影响，不伪装成纯重构。
- **教程随预设交付**：最小工具描述只说明源码入口与结果；完整 ctx 使用教程作为 Prompt Resource/README，在预设指定锚点注入或按需读取，不硬塞进所有 Native Tool description。教程只描述本阶段真实开放的能力。
- **最后才谈删除**：只有旧预设挂载、用户定义和历史回放的兼容方案明确后，才能提出淘汰旧工具。本 Plan 的完成条件不包含强制删除 JSON Tools。

### 5.6 稳定工具锚点与通用说明模板

本轮已核对 [Default 预设骨架](../../architecture/application/prompt-build/default-preset.md) 与 `packages/application-runtime/src/prompt/default-preset.json`：稳定工具区已有 `@chat.tools` 和独立的 `@runtime.skills`，动态能力区已有 `@tools.dynamic`。复用这些位置，不新增 `@codeact.tools`，不修改另一任务拥有的骨架排列。

当前 `tool-prompt-build.ts` 已提供 `description`、`parameterDescriptions`、`guidance` 的模板编译；`tool-loop.ts::createContentToolPromptRuntimeInputs` 已将启用的 Content Tool 说明转为 SourceNode / PromptContribution，默认注入 `@chat.tools`。Native Function 则投影至 Provider `tools[]`。这是现有事实，不需要重建工具提示词系统；但它尚不等于每个 ctx 方法都有独立教程，也不能保证 JSON CodeAct 的教程已经进入稳定锚点。

说明分为两层：

- **CodeAct 公共说明**：一次说明源码提交方式、顶层 await、print/结果显示、调用间不保留 JS 变量、权限和错误处理原则；传输协议由当前入口提供，不给 Content 模式同时注入 JSON 调用教程。
- **各 ctx 方法说明**：每个已实现方法各一段普通 Markdown，使用一致的“用途、调用签名、参数、返回、例子、限制”结构。它们是 CodeAct 能力教程，不是新增的模型顶层 Tool Definition，更不是重新注册一套 JSON Tools。

候选模板示意，具体参数以方法实施后的合同为准：

````markdown
### ctx.read
用途：读取已发现且获准访问的资源正文。
调用：await ctx.read(path, options?)
参数：path 为 LS/Search 返回的路径；options 可指定长正文的行范围。
返回：正文字符串；路径、实际范围与截断信息由工具显示层提供，不混入正文。
示例：
```js
const text = await ctx.read("/alice/settings/personality.md");
print(text);
```
限制：普通设定优先完整读取；局部读取不能用于全量覆盖。
路径不明确时先 LS/Search，不猜测内部 ID，也不穿透历史授权范围。
````

交付与投影规则：

- 默认教程复用既有 Prompt Resource/Entry、Markdown 正文及官方内容交付方式；统一的是编写模板，不新增必须填写的 description KV、教程数据库或模板引擎。不从 JSON Schema 机械生成所有行为限制。
- 公共说明只出现一次，各方法正文各一次。以稳定来源身份去重，不靠比较正文字符串；Content 协议说明和方法教程各自负责自己的内容，不能在 guidance、Setting 和 Provider description 中重复塞入整本教程。
- 基础方法说明默认投影到 `@chat.tools`；作者可以重排或指定其他位置。按条件出现的能力说明可使用 `@tools.dynamic` 或普通资源激活规则；Skills 仍归 `@runtime.skills`，不混为一张大工具清单。
- CodeAct 即使通过 JSON 入口调用，公共与方法教程仍由独立 Contribution 进入相同锚点；Provider `tools[]` 只保留执行入口的必要说明及 schema。不要因当前组装函数只筛选 Content Tools，就让 JSON 模式丢失教程。
- 教程选择与实际方法暴露使用同一能力清单：未实现/不可提供的方法不宣称可调用；需要审批的方法可以说明审批限制，不能把“说明可见”当作已授权。具体资源路径、State 值和本次通知不塞进稳定方法说明。
- 预设没有目标锚点或将其禁用时，在 Preview/诊断中明确呈现说明未注入，不悄悄追加到其他位置绕过作者的骨架选择。工具挂载与教程启用配套检查，不把模型“应该猜到用法”当验收。

P3 负责入口与教程 Contribution 的接线，P5 负责默认教程内容和交付；`ctx` 实现/参数变化时，同一工作包更新对应示例，避免生产 API 与教程漂移。不重复实施骨架、Skills 注册器或动态生命周期。

## 6. 执行工作包

先执行 P0，再落地 P1/P2 的共同合同，之后接 P3。P4 按领域能力成熟度逐项开放，P5 做交付切换。

2026-09-21 执行状态：

| 工作包 | 状态 | 实际交付/剩余 |
| --- | --- | --- |
| P0 | 已验证 | QuickJS 0.32.0 + Worker；异步、隔离、死循环、挂起 Promise、内存/输出上限、取消与已接受宿主操作收尾 |
| P1 | 领域读取基座与引用已接入，部分资源待对接 | 实时 Preset/Setting 源树、State 属性/组件子树、预设脚本 Document/Blob、路径身份/版本观察及 `loom-resource` 引用已接通；Narrative 采样、通用资产及跨角色挂载管理仍未接入 |
| P2 | 已完成首期只读执行器 | 两种入口共用隔离执行、桥接、指导性错误及取消；编译后 Worker/WASM 加载已验证 |
| P3 | 已完成当前 Run 接入 | Content/freeform 与 JSON，稳定教程、Preview/实际请求、结果回传、截断拒绝、正文转换改写代码时拒绝；跨 Run 完整协议回放仍归 Session 模块 |
| P4 | replace、patch、基础结构操作与首期 Copy 已接入并验证 | Prompt Resource 正文和 State 属性支持先读后 replace，Prompt Resource 支持基于唯一上下文的 unified diff patch，节点支持 Metadata、create、move、delete、同资源 copy，资源根支持整份 Prompt Resource copy；版本冲突、局部读取范围、审批、即时 Changeset 和后续失败保留已验证；跨资源节点 copy、Narrative、Pin、撤回及完整授权 UI 仍未完成 |
| P5 | 部分完成 | 官方工具注册、定义初始化和可编辑 guidance 已接入；不改旧预设，新建挂载默认关闭；独立 CodeAct 创作示例与真实 Provider 验收未交付 |

### P0：Sandbox 定向验证

- **写集**：`apps/playground/src/codeact/sandbox-check.ts`（新增）、Playground 的 `package.json`、`pnpm-lock.yaml`、本 Plan 与实验记录。保留现有 `run.ts` 历史实验，不替换它。
- **工作**：按 5.4 验证 QuickJS、异步桥接、资源上限、终止与释放；宿主写入先使用可观测测试替身，不访问用户真实数据。
- **验收**：死循环、Promise 永不完成、输出超限、拒绝访问宿主、两次调用全局变量隔离、取消后无新操作；已经开始的模拟写入仍有确定结果。
- **主要验证**：`pnpm exec tsx apps/playground/src/codeact/sandbox-check.ts`。失败必须归因；禁止降级为直接 eval / node:vm 来宣布通过。
- **停止条件**：候选不能满足安全或资源合同。报告差距并决定替换候选/增加隔离，不能直接放开生产入口。

### P1：宿主 Scope 与只读 VFS

- **写集**：`src/runtime/agent-tool-scope.ts`、`src/runtime/agents-runtime.ts`、`src/agents/tool-registry.ts` 的 Scope 部分、`src/vfs/`、`src/agents/official-tools/context-snapshot.ts`；对应包为 `packages/application-runtime`。
- **工作**：提取 Scope；接实际 Prompt Resource/State 读取；定义无歧义的挂载路径与内部身份绑定；实现 LS/Search/Read、YAML 和有界文本显示。先支持宿主明确提供的范围，不复制整仓到内存、不猜测未授权挂载。
- **交接合同**：在 `vfs/types.ts` 固定宿主提供的挂载、访问检查、读取/版本观察；P2 只依赖这些函数，不依赖 Store。只保留一种原文值与展示信息的协议，模型展示头不得进入可写回的正文。
- **验收**：两个同名条目/挂载不串读；重命名不把旧路径误绑到另一对象；路径越界、隐藏资源、锁定内容、搜索片段都经过同一访问边界；YAML 组件和长文本截断有可验证范围。
- **主要验证**：新增 `tests/unit/application-runtime/vfs-read.test.ts`；Scope 提取另外运行受影响的 `official-agent-tools.test.ts`。只测真实能力，不返回假的 Pin 成功或全部历史。
- **依赖**：Narrative 必须使用上下文计划提供的共用采样合同。合同缺失只阻塞 Narrative 适配，不阻塞 Setting/State；不得把当前固定最近 100 节点当成已确认的有效区间。

### P2：生产执行器与 ctx 桥

- **前提**：P0 通过，P1 最小读取合同固定。
- **写集**：`src/agents/codeact/`、`packages/application-runtime/package.json`、`pnpm-lock.yaml`；必要的公共导出仅限 `src/index.ts`。不新增模型调用 API。
- **工作**：以 P0 结论实现一次性执行器、Worker 消息、ctx 与受限输出；复用 P1 的读取、授权和格式化。先只读，未实现的写入方法明确不可用。
- **验收**：同一源码多次运行不保留 JS 全局变量；正常/异常/超时/取消均清理；桥接错误可指导下一步，不泄露内部堆栈、权限对象或私有路径。
- **主要验证**：新增 `tests/unit/application-runtime/codeact-executor.test.ts`，至少包含一次真实引擎执行，不能全 mock Sandbox。Worker/WASM 加载改变构建边界，因此补相关包 build 和编译产物 smoke check。

### P3：双传输入口与现有 Agent Loop

- **写集**：`src/agents/official-tools/codeact.ts`、`official-tools/index.ts`、`src/agents/tool-loop.ts`、`src/agents/tool-prompt-build.ts` 的必要教程接线、必要的 `tool-registry.ts` 结果合同与 `src/index.ts`；对应 unit/integration 测试。只在初始化测试暴露缺口时修改 `runtime/runtime.ts`，不改默认骨架模板。
- **工作**：注册 5.2 两个入口，归一到同一执行器；按 5.6 将公共说明及已开放方法教程投影至稳定工具锚点，两种传输共用教程。正确保留 Invocation 的传输与调用 ID，沿用 Transcript。处理 outer timeout 先返回导致 CodeAct 结果/释放丢失的路径，不因 CodeAct 改掉其他工具的既有行为。
- **验收**：同一段读取代码经 JSON 与 Content 得到相同资源内容与权限结论；代码作为工具输入，不泄漏成 Narrative；非法/不完整协议不执行，结果按原传输回放。暂停可停止执行，不恢复 JS 栈、不重放已执行操作。
- **主要验证**：新增 `tests/integration/application-runtime/codeact-tool-loop.test.ts`，捕获 Preview 与实际 Gateway 请求，验证教程位于所选骨架锚点、只出现一次、JSON 模式不丢失教程、未开放方法不被宣称可用。对触碰的兼容路径定向运行既有 `agent-tools.test.ts`、`content-tool.test.ts` 或 `native-tool-loop.test.ts`，不默认全跑。
- **范围**：不实现 Provider Custom，不修改 SDK Provider Handler，不引入第三个工具循环。

### P4：受控写入与上下文接入

- **写集**：`src/vfs/write.ts`、相应资源适配、`src/agents/codeact/context.ts`、`src/runtime/agent-tool-scope.ts`，以及确需共用回调的旧官方 Handler；对应测试。领域 Store 的隔离/版本改造不包含在写集中。
- **工作**：按 Prompt Resource、State、Narrative 逐项接真实 Mutation；保留“创建、替换、局部 Patch、追加”的独立语义。首个局部编辑实现优先沿用实验的唯一上下文 Patch，不另实现模糊匹配或数字行号编辑器；最终签名在本切片开始时以小型合同固定。
- **并发与结果**：读取版本与操作级校验处于同一受控写入边界；同一次 CodeAct 的多次写入具有独立子操作标识。返回路径、实际修改范围与领域事实引用，即时生效，不要求 Commit。取消/后续错误仍保留此前成功记录。
- **验收**：用户在读取后修改则明确冲突并能重读；两次 State 写入不被同一个幂等键吞掉；一段代码第二次写入失败不掩盖第一次成功；审批拒绝与跨作用域拒绝不能通过另一入口绕过。
- **主要验证**：新增 `tests/integration/application-runtime/codeact-vfs-write.test.ts`，使用实际 Store/事务验证并发和部分成功，不仅验证 Patch 纯函数。
- **外部依赖**：权限模块提供具体动作审批合同；Timeline/静态资源模块提供隔离与可撤回合同；上下文模块提供 Pin 的持久化与采用时点。缺哪项就明确阻塞对应能力，不在本计划补造它。
- **事件与统计**：关联既有领域变化事实给统一统计/Diff；工具不自行发布正文新增。正文新增语义和事件覆盖由领域模块验收，不能在 CodeAct Handler 内补一份事件假装补齐。

### P5：预设交付与渐进迁移

- **写集**：`official/starter/` 内独立 CodeAct 示例及教程、`apps/studio-server/src/official/official-content.ts` 与 `runtime/official-content-runtime.ts` 的必要安装接线、既有 `official-content.test.ts`，本 Plan 与工具架构文档。
- **工作**：使用既有分发/安装格式交付以 CodeAct 为默认方向的创作示例及 5.6 的方法教程；只启用本阶段可用的方法和一种传输入口。不悄悄改变 `assistant.json` 或用户已有预设的默认，不创建新的模板系统。
- **验收**：新示例可完成已授权的读取/写入闭环；已有用户定义、预设挂载与 Profile overrides 不变；关闭 CodeAct 后旧工具仍可用，旧 Session 工具结果仍能回放。
- **主要验证**：定向扩展 `tests/unit/application-runtime/official-content.test.ts`，检查安装前后持久配置差异；再做一次真实 Provider 的最小工具往返。无可用账号时明确记录未验证，不能用假 Provider 冒充。
- **完成记录**：逐项写回通过/阻塞/延期及实际验证；有未接入的 Pin、历史或领域写入时不将整个 Plan 归档。

### 并行与验证预算

默认主 Agent 执行。确需并行时，P1 的 VFS 读取与 P0 Sandbox 验证可独立进行；P1 合同固定后，P2 执行器与 P3 的入口适配可分开实现，最终集成仍依赖 P2。`tool-registry.ts`、`agents-runtime.ts`、锁文件由主 Agent 单点合并，不能让多个任务同时修改。

测试命令统一使用 `pnpm exec vitest run <本切片的测试文件> --passWithNoTests=false`，并确认目标测试确实执行。只有公开类型变化补相关包类型检查，Worker/依赖/打包入口变化补相关 build；本轮文档工程化不运行业务测试。

## 7. 依赖与未决边界

不再保留一整页笼统“全部待讨论”；按阻塞阶段登记：

| 项目 | 处理人/归属 | 阻塞范围 |
| --- | --- | --- |
| Sandbox 候选是否满足资源与安全合同 | P0 验证；改变安全边界时由用户决定 | P2 生产执行，非 P1 只读资源接入 |
| 具体资源授权、危险动作与审批等待合同 | Runtime 权限边界；沿用已确认的作用域 + 动作双维度 | 相应跨范围访问及 P4 写入；不允许静默默认全权限 |
| Narrative 当前范围、有限历史追溯与加工 | 上下文计划的共用采样能力 | Narrative LS/Search/Read；不允许另造一个采样器 |
| Pin 保存范围、采用时点与 Notice 生命周期 | 上下文计划 | Pin/Notice 接线；不以 JS 内存替代持久化 |
| Narrative 版本、Setting 分支覆盖及可撤回范围 | Timeline 与静态资源模块 | 对应写入、撤回与 Diff 基准；不扩大 CodeAct 范围 |
| 非 User 输入节点的领域标识及事件发布覆盖 | Narrative 与事件模块；当前 Node 类型不能仅靠创建者推定该语义 | 自动消费验收；不增加 Agent Finish/Commit |
| 元数据字段、复制默认值、相对排序与工具最终签名 | P4 按现有领域 Schema 列出最小操作合同 | 仅对应工具；涉及产品行为的缺口定向提问 |

多模态读图的实际模型通道、任意插件能力接入、长期脚本、Provider Custom 不作为首个文本读写切片的隐含工作。用户发起的世界回滚和历史副作用撤回归所属模块，CodeAct 不实现回滚自己的对话。

## 8. 整体验收与停止条件

- Agent 不用内部 ID 即可从多挂载发现并读取资源；隐藏/锁定不能从列表、搜索、Pin 或通知泄露。
- YAML 投影往返符合领域 Schema，文本输出不会污染正文；文件引用可解析，截断明确可见。
- 完整与局部读取不可混淆，资源树与注入顺序不可混淆；匹配失败、冲突和取消后的返回足以指导下一步且不诱发重复副作用。
- 写入成功即生效且记录实际范围及撤回依据；失败明确区分未写入与此前已生效修改，不伪装全局回滚。撤回不覆盖用户后续修改，不宣称能抹去不可逆外部副作用。
- Agent 的审批策略和作用域均由运行时强制执行；不存在回滚自身 Transcript 的 Agent 能力。
- Agent 工具和用户命令创建同类正文节点，均复用成功持久化后的领域事件；User 输入节点不进入此正文新增触发条件，既有节点修改不冒充新增。CodeAct 不重复发布事件。
- 主 Agent 不依赖某个指定下游才可完成；修改事件不隐式触发新增节点的消费流程，下游失败不回滚已保存正文。异步结果的目标与版本沿用所属模块的合同，不由 CodeAct 自建分支隔离。
- 状态变化与上下文投影可追溯；不把“模型读过”作为“必然会 Pin 或遵守”的验收保证。
- 自动验证、模型体验、未验证项分别记录。无需为文档迁移重跑已记录的业务实验。
- 涉及尚未确认的权限、持久化、迁移、事务或公共接口决策时停止相应切片并提问，不扩展为通用脚本平台。

## 9. 延期与迁移记录

持久 Agent Script、源码 Blob 分发、Script Mount、任意插件 Handler、开发工作区同步、跨进程 JS continuation 保留为延期参考，不阻塞首期只读 VFS。

定时、条件触发与长期后台行为暂不纳入首期 CodeAct。未来可以讨论 Timeline / Session 下的 tmp 或 Script 资源，不预先确定常驻 JS 进程、调度器或新规则系统。

2026-09-20：本计划接管旧 Agent 总计划及 File-backed 综合提案里的 CodeAct 实施归属；旧路径保留以免破坏引用，历史详细候选不自动继承为本计划决策。上下文骨架仍独立，不合并记忆算法。

本次只完成文档拆分与互链；生产实现未开始，已记录实验结果不因此变成生产验收。

2026-09-21：补入执行倾向、混合存储与内部创作边界、节点 Metadata 和排序、完整条目优先读取、编辑语义与指导性错误。只更新本 Plan，不改 Playground 或生产代码；参数示例、复制默认值和 Patch 格式仍为候选。

2026-09-21 后续修正：用户明确要求可撤回而非未提交。删除生产方案中的必需草稿/显式提交前提，保留历史实验事实；补入审批与作用域两个授权维度、用户选择回滚与 Agent 对话不可自回滚的边界，以及长 Narrative 的按行读取场景。

2026-09-21 事件讨论收束：独立作者的 Agent 通过事件与显式通信协作，不要求主写作 Agent 编排下游或统一 Commit；补入 CodeAct 与事件模块的职责及未决技术合同。本次只更新文档，不实现事件调度器或改变生产写入。

2026-09-21 归属修正：分支资源隔离移出 CodeAct 待讨论与实施范围，归 Timeline 与静态资源模块。正文新增事件以非 User 输入的 Narrative 节点成功持久化为依据，与创建者和调用入口解耦；删除“产出完成判定”，不增加 Agent 完成声明或提交工具。

2026-09-21 工程化：核对 Registry/Tool Loop、9 个官方工具、Scope、VFS 辅助层和内置安装链；补入目录与命名、双传输共用执行器、保留旧工具的迁移步骤、P0-P5 写集和最小验收。源码与依赖未修改；没有运行 Sandbox、生产工具或 Provider 验证。工程方案不代表依赖模块的未决合同已经实现。

2026-09-21 骨架对接：核对并复用已落地的 `@chat.tools`、`@runtime.skills`、`@tools.dynamic`；记录 CodeAct 为默认产品方向，补入公共说明与各方法统一 Markdown 教程模板、跨传输锚点投影及去重验收。仅更新本 Plan，不修改另一任务的骨架或宣称教程生产者已接入。

### 2026-09-21 正式接入记录

- 采用 `quickjs-emscripten@0.32.0`。P0 检查直接调用待接入的同一 Sandbox，而非复制一套 Playground 引擎；候选通过后接注册。源码校验和 JS 解析使用实际引擎，不使用 node:vm 生产回退。
- Content 采用真正的 freeform，替代工程草案中空 metadata 的 hybrid。已有 Tool Loop 对 freeform `{}` metadata 的处理直接复用；JSON 使用独立的 structured 别名，两者共用执行器。
- 当前只读直接复用现有 ToolExecutionScope，并在 Context Snapshot 中增加有界的 VFS 视图，没有为尚未开放的写入搬动 `prepareAgentTurn` 的全部领域回调。P1 的 `agent-tool-scope.ts` 抽取留给真实第二个写入调用者，不做形式上的拆文件。
- 方法教程复用现有 Tool Definition `prompt.guidance` 和模板编译，而非再创建教程资源/数据库；作为独立 Contribution 进入稳定锚点。JSON 描述与 Content 协议说明均不重复整本教程。作者修改和重初始化保留通过实际 SQLite 测试。
- `/context` 明确是本次已供给的文本视图，不能冒充实时作者源数据；`/state/current.yaml` 只读当前授权目标。没有偷接固定 100 节点 Narrative 窗口、旧 Session、任意磁盘或跨卡写入。
- 自动验证：P0 检查通过；真实 Sandbox 8 项、VFS 5 项、CodeAct 完整工具循环 9 项通过；既有官方工具、Content 协议和 Native Tool Loop 共 28 项通过，共 50 项独立用例。相关包 build 与编译产物 `.js` Worker/WASM smoke check 通过。
- 测试使用临时 SQLite、真实 QuickJS 与可控 Gateway 捕获实际请求；没有使用真实外部模型账号，不宣称模型遵循、Provider 兼容矩阵或缓存效果已经验收。
- 未验证：OS 级隔离、第三方安全审计、跨进程恢复、P4 领域写入/副作用、独立创作预设和 UI 人工体验。本计划保持 In Progress，不归档。

### 2026-09-21 VFS 基座接续

用户要求先建 VFS，再推进写入。本轮将只读快照提升为独立的 `vfs/resource-filesystem.ts` 宿主能力，CodeAct 只调用它的 LS/Search/Read：

- `/resources` 从本次已选 resource IDs 接实时领域 Store，内部保留节点身份与资源版本，不从 Contribution 反推作者原文。`/context` 保留为独立的提示词快照，没有写回权限。
- `/state/data` 根据真实属性树展开，`@value.yaml` 读取子树/组件，数组不拆成大量路径；每次读取绑定当前目标、Pointer、Revision。不新增 EC 模型，不假定 collectionPath。
- `/attachments` 复用既有预设脚本所有权与 Mount，Document 提供 Blob 引用和版本，读取按需获取真实字节。未建不存在的通用 README/图片资产索引，也未允许宿主磁盘路径。
- 读取观察与路径身份保留在 ToolExecutionScope，可跨本次运行中的多次 CodeAct 调用使用。旧路径重绑到新节点拒绝；这是写入前置证据，不是已经实现 CAS 写回或跨进程恢复。
- 文件系统接收明确挂载和宿主访问判断，隐藏不列出，锁定不返回正文，停用注入不等同于不可读；当前运行时仅提供已选资源的读取范围，跨角色授权 UI 不在本轮扩建。
- 遍历/搜索有明确预算；超限明确报错。没有新增数据表、影子内容存储、文件 Watcher 或 VFS 自有事务/事件源。

验证：`resource-vfs.test.ts` 7 项、`vfs-script-attachments.test.ts` 1 项、CodeAct 双通道集成 11 项、既有 VFS 读取 5 项，共 24 项通过；相关 Runtime build 通过。SQLite 验证实时更新、版本、路径替换、同名挂载、隐藏与锁定；真实临时 Blob 验证延迟读取、版本固定与所有权过滤。未运行全仓测试。

### 2026-09-22 Narrative 只读采样接入

- 上下文计划新增共用 `NarrativeSampler`，支持绑定分支的最近 N 个节点和 `afterNodeId`（不包含）至 `throughNodeId`（包含）区间。
- 当前 Agent Session 的 CodeAct Scope 暴露 `ctx["readNarrative"]({ selection, maxNodes?, maxCharacters? })`；Timeline 和 Branch 由宿主绑定，脚本不能传入其他目标。
- 返回正文、节点来源、读取时的 Timeline Head、实际终点、完整性和 `nextBeforeNodeId`；预算截断不会伪装成完整读取，也不会推进 Memory 指针或默认有效 Head。
- 定向验证：Narrative 采样与 CodeAct 真实 Sandbox 单测、既有 CodeAct 工具循环及 VFS 方法面共 26 项通过；覆盖对象返回（`story.text`）、无 Narrative 绑定时的指导性错误、范围预算与续读信息。Application Runtime build、Studio Client TypeScript 与 `git diff --check` 通过。

剩余依赖：默认 Prompt 的有效 Narrative 组合、Memory 摘要贡献、历史正文加工和历史追溯权限仍由上下文计划提供；通用附件需所属资源索引与权限合同；跨角色需要显式挂载授权；写入仍需操作级授权、读取基线校验与领域 Mutation。当前不宣称整个资源生态或写入 Plan 已完成。

### 2026-09-21 引用与跳转接入

- 新增共享 `ResourceReference` 编解码，使用 `loom-resource://` 表达 Prompt Resource、State Revision 和 Script 文档的身份、版本与行范围；不把 URI 当作前端路由，也不把 VFS 路径当作稳定身份。
- CodeAct 的 Read/Search 返回真实绑定时附带 Markdown `Reference`。教程要求 Agent 复用引用，不编造 URI；`/context` 投影不生成源正文引用。
- Studio Markdown 识别该 URI，打开可复制、按身份读取的引用查看器；版本一致才定位旧行，版本变化时显示当前内容并取消精确定位。正文资源可以进入编辑器，State 只读目标，不切换分支。
- 测试覆盖 URI 编解码/恶意参数、资源节点版本变化与同名替换、State 目标读取、Script 版本变化、Markdown 保留和资源路由，共 33 项相关用例通过；Runtime 与 Studio Client TypeScript 构建通过。未做浏览器人工视觉验收。

### 2026-09-21 首个受控写入接入

- `ctx.write(path, value, { mode: "replace" })` 已接入 Prompt Resource 正文与 State 属性。两者都必须先完整读取同一路径，宿主随后复核路径身份与资源版本/State Revision；冲突时返回指导性错误，不静默覆盖。
- Prompt Resource 写入复用现有 `mutateResource` 和 `node.update`，State 写入复用现有 Revision/CAS Mutation。每次 CodeAct 写入使用独立幂等键，成功立即生效并返回版本/Revision 与 Changeset。
- 当前明确拒绝 `/context`、完整 `/state/current.yaml`、附件、脚本、Narrative 和 metadata 之外的资源级结构操作；Copy 仅开放同资源节点/文件夹复制与整份 Prompt Resource 复制，没有新增提交层或绕过事件链。
- 定向验证已通过：`pnpm --filter @loom-studio/application-runtime build`；`pnpm exec vitest run tests/integration/application-runtime/resource-vfs.test.ts tests/integration/application-runtime/codeact-tool-loop.test.ts --passWithNoTests=false`，共 23 项通过；覆盖真实 Prompt Resource mutation、State 属性 CAS、完整读取前置、用户并发修改冲突，以及 Content/JSON 两种 CodeAct 入口。
- `ctx.patch(path, unifiedDiff)` 已接入 Prompt Resource。实现沿用 Playground 已验证的单文件 unified diff：唯一旧文本上下文定位，行号只作提示，支持偏移，所有修改块先完整校验后统一写入；不支持插入-only、模糊匹配、多文件、创建/删除/移动。
- Patch 定向验证已通过：三组 VFS/CodeAct/Sandbox 测试共 42 项通过；覆盖多块原子失败、歧义、未读范围、基线冲突、偏移行号、换行保留，以及先写入成功后后续调用失败仍报告已保存修改。
- 当前边界：审批交互已经是变更预览 + Yes/No，未提供 Run 回调的直接 Runtime 调用才保持默认放行；Copy 已按首期合同接入，跨资源节点复制、引用迁移、Narrative 写入、撤回入口、Pin 和统一 UI 写入统计仍属于后续模块。当前不扩大结构操作范围，也未运行全仓测试或真实 Provider 验证。

### 2026-09-21 通用 Copy 接入

- `ctx.copy(sourcePath, destinationPath, { name? })` 已接入 CodeAct 教程、Content/JSON 共用上下文和官方工具描述。
- 源路径为普通 Prompt Resource 节点时，复制完整节点子树、作者 Metadata、正文和顺序，并由宿主为所有新节点生成身份；目标目录必须先读取完整 Metadata。
- 源路径为 Prompt Resource 根节点时，目标必须是 `/resources`，复用 `duplicatePromptResource` 复制整份资源及其领域允许的资源级配置；不复制运行态 Pin、执行授权、Profile/Card/Timeline 关系。
- 两种 Copy 都复用审批预览、资源版本 CAS 和即时 Changeset。跨资源节点复制、引用迁移和 Bundle 级角色卡/世界书导入仍未开放。
- 定向验证：`resource-vfs.test.ts`、`codeact-tool-loop.test.ts`、`default-preset.test.ts` 共 53 项通过；Application Runtime build 与 `git diff --check` 通过。

### 2026-09-21 审批交互收敛

- 用户否定复杂的能力配置交互，确认变更预览 + Yes/No + 可选拒绝原因；前述审批模式选择不再阻塞实施。不能把这个结论理解为取消作用域隔离或对所有资源自动授权。
- VFS 的 replace / patch 在写入前可提供 `VfsMutationPreview`，包含路径、动作、前后正文；State 使用 YAML 前后值并携带目标与 Pointer。宿主回调返回 allow 或 deny/reason，拒绝不写入。
- 审批传递 AbortSignal，审批后取消检查阻止新写入；真正落盘仍使用原版本 CAS，等待期间用户修改导致冲突，不覆盖新内容。
- Run 级事件、RPC 答复和 Agent Panel 弹窗已经接入：`mutation-approval-requested` 携带预览，客户端回传 allow/deny/reason，CodeAct 在原调用点等待；不引入持久化草稿或新的提交层。未提供 Run 回调的直接 Runtime 调用仍保持默认放行，这是无 UI 宿主的明确行为。
- 定向验证：VFS/CodeAct 结构操作接入后的相关测试共 58 项通过，Runtime build 与 Studio Client TypeScript 通过；覆盖允许/拒绝、State 预览、Metadata YAML、replace/patch、同资源 move/delete/create、Metadata Patch 拒绝、等待期间取消和审批期间用户编辑。没有完成浏览器人工视觉验收、真实 Provider 验收；Studio Server 全量 build 被工作区既有三个无关类型错误阻塞。

### 2026-09-24 共用 Narrative 加工接线

- `ctx.readNarrative` 增加可选 `view: 'raw' | 'prompt'`，默认 raw。prompt 使用宿主当前有效规则，不接受脚本自行指定 Timeline、Branch、Preset 或规则。读取期间取消传入共用采样器。
- `nodes[].body.raw` 始终是原文，`nodes[].text` / `text` 是所选视图；processing 附带规则版本与诊断。原文引用与加工后文本的行号不可混用；本轮没有新增 Narrative 可点击引用或编辑授权。
- 默认 Prompt、Runtime 单次消费者和 CodeAct 复用 Narrative 采样 / 正则能力。固定 Head、范围及续读语义详见[Context Plan 第 16 节](./agent-context-skeleton-and-memory-projection-plan.md#16-共用采样与正文加工交付2026-09-24)。
- 36 项定向测试及 Runtime build 通过，包括真实 SQLite 分页和 Content / JSON 两种 Sandbox 工具循环。未验证真实 Provider、完整 Session 生命周期或前端视觉。
- 历史访问政策仍未实施：当前工具只有 Timeline / Branch 绑定，合法的同分支历史范围也可读取。此前“没有权限的历史不会扩大”的目标说明不构成实现证据；本轮没有自行扩大或收紧授权，默认视图 / 历史追溯的宿主授权边界仍须接续。
