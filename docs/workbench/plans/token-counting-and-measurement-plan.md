# Token 计数与运行测量计划

> **状态**：Draft / 调研完成，配置归属与持久化合同待确认
> **更新**：2026-09-27
> **授权范围**：本轮只调研、形成 Plan 和更新文档入口，不实施代码、安装依赖或迁移数据。
> **目标**：用单一基础 tokenizer 与系数估算，提供通用文本计数、编辑期逐级统计，以及可追溯的逐次模型调用测量。
> **背景**：[Token 估算调研](../discussion/application/prompt/token-estimation-and-audit-v0.md)、[PromptBuild 正式边界](../../architecture/application/prompt-build/README.md)。

## 1. 对话收束与非目标

本轮设计沿用对话中收束的方向；下文具体包名、配置字段、SDK 接口与 Transcript 类型仍是提案，不因写入 Plan 自动成为已批准公共合同。

- 第一版只使用一个基础 tokenizer；其他模型用显式系数做近似，不同时接入多套词表。
- 编辑器对已加载正文和未保存草稿在客户端计算，不为每次编辑请求后端计数。
- 条目、文件夹与整个 Setting / Preset 的原文统计是派生数据；默认不持久化结果缓存。
- 正式调用前的估算、Provider 实际 usage，以及未来触发裁剪/交接时的测量，属于应保存的历史事实。估算与实际值分开。
- 通用能力不认识 Setting、Preset、Card、Session；领域调用者准备输入和消费结果。
- 不开发彩色分词 UI、token IDs 检查器或公共 encode/decode 协议。

本 Plan 不实现自动裁剪、超窗硬门禁、记忆/交接调度、计费、Dashboard、通用审计数据库、完整 Prompt 快照或远端 token counting。系数估算不能保证请求不超窗；自动策略由[记忆计划](./narrative-memory-and-refresh-policy-plan.md)等消费者另行决定。

## 2. 当前源码事实

下列事实核对于 2026-09-27 工作区，包含已有未提交修改；实施前重查对应入口，不覆盖其他任务。没有运行功能测试，因此这里只证明静态接线。

| 层 | 已核对事实与入口 | 对本 Plan 的约束 |
| --- | --- | --- |
| Prompt 数据 | [PromptResource Store](../../../packages/application-data/src/prompt-resource/types.ts)保存 Header/Node、metadata、正文与版本；[mapper](../../../packages/application-runtime/src/prompt/prompt-resource-mapper.ts)投影成嵌套树 | 不向 Node、Resource 或 Revision 增加 tokenCount |
| Agent 配置 | [PromptResourceContent](../../../packages/application-runtime/src/cards/workspace-types.ts)已把 model、delivery 等配置放在 Preset；Session 引用 agentPresetId | 不沿用旧 Agent Profile 作为新配置所有者 |
| 前端资源 | [usePromptResourceState](../../../apps/studio-client/src/features/prompt-resources/model/use-prompt-resource-state.ts)按 endpoint 使用 Query Cache；Runtime listMappedResources 已完整收集分页并返回正文树 | 当前资源编辑统计无需额外 fetch；不把已有完整树误判成只有标题的分页列表 |
| 未保存草稿 | [useContextAssets](../../../apps/studio-client/src/features/context-assets/model/use-context-assets.ts)维护独立 drafts，向 UI 发布 scope.visible；CAS 冲突保留草稿 | 统计消费可见草稿树，不回写 Query Cache，也不把计数防抖接入保存队列 |
| Preset 视图 | [PresetWorkbench](../../../apps/studio-client/src/widgets/preset-workbench/preset-workbench.tsx)把外部 Setting、Content Tool 注入 mainOrderNodes | 可见投影树不等于 Preset 自身；不得遍历它计算资源自身总量 |
| 编译结果 | [composeAgentTurnPrompt](../../../packages/application-runtime/src/agents/agent-turn.ts)调用 DFS 编译器；[CompiledPrompt](../../../packages/application-runtime/src/prompt/prompt-builder.ts)返回 messages、fragmentIds 和 editorProjection，没有完整的分片正文账本 | 首版可做消息/工具明细，不能假定已有完整 Contribution Token Trace |
| 每次调用 | [Tool Loop](../../../packages/application-runtime/src/agents/tool-loop.ts)在每个 Step 组装 stepMessages、Fresh Context、native toolSpecs；[Preview](../../../packages/application-runtime/src/runtime/agents-runtime.ts)返回 prepared.agentStepMessages 与 Tool Exposure | 不只计首次 PromptBuild；Preview 与执行需要共享实际 Tool Spec 生成逻辑 |
| 历史事实 | [Transcript 类型](../../../packages/application-data/src/agent/types.ts)已有 provider-observation；[Store](../../../packages/application-data/src/agent/store.ts)通过 entry_json 存储并校验 kind，使用 expectedEntryCount 控制并发 | 加可选字段不一定需要改表；新增 kind 必须同步校验、回放过滤和归档消费者 |
| 实际用量 | [Gateway 映射](../../../packages/ai-gateway/src/gateway.ts)只留下 inputTokens/outputTokens；已安装 AI SDK 的 usage 类型还提供缓存、reasoning 等明细 | 统一 DTO 应保留需要的明细，不能依赖 raw 随机兜底，也不能缺失填零 |
| 模型配置 | [useProviderSettings](../../../apps/studio-client/src/features/provider-settings/model/use-provider-settings.ts)把 enabledModelIds 投影成前端 ModelProfile；它不是独立持久化实体 | 不给前端 ModelProfile 增加一个后端读不到的“运行系数” |
| 宿主能力 | [Extension SDK](../../../packages/extension-sdk/src/index.ts)区分 Client/Server Activation Context；[settings RPC](../../../apps/studio-server/src/rpc/handlers/settings-rpc.ts)目前只管理网络设置 | 不假定存在通用 settings KV，也不把 token 配置塞入网络或 UI 布局 Store |

## 3. 最小能力与所有权

### 3.1 跨端基础包

建议新增 `packages/tokenizer`，包名 `@loom-studio/tokenizer`，专门拥有 `gpt-tokenizer` 依赖。理由是已有浏览器 Worker、后端计量和扩展宿主三个真实消费者；它不属于 PromptBuild，也不应让数据库类型导入词表。

公开面只需要 `countText(text, options)` 与静态基础信息/估算预设数据；不创建可注册 tokenizer 的 Manager、插件协议或 listCounters RPC。`options` 只承载当前已需要的系数，未来更换实现不要求现在预建多后端调度。

- 固定 `o200k_base` 为首版提案，并锁定依赖版本；不要依赖包的默认 encoding 或按未知模型名猜词表。
- 输出保留 `baseTokens`、`estimatedTokens`、encoding、实现版本、算法口径版本和实际 multiplier。公式为 `ceil(baseTokens * multiplier)`。
- 普通用户文本中的特殊 token 标记按字面文本处理，不赋予控制 token 语义；通过库支持的选项落实并验证。
- 空串为 0；不 trim、不改换行、不做 Unicode 归一化。用户配置边界拒绝非有限、非正系数及超出可表示范围的结果。
- 同一组输入和基准，浏览器与 Node 的结果必须一致。
- `contracts` 子入口只导出轻量 DTO，供 Application Data、Runtime、SDK 进行 type-only 引用；不从根入口向 UI 主包或 Store 意外加载词表。

库能力只完成官方 README 核对，尚未验证锁定版本、特殊 token 选项、中文长文性能或包体积；这些是工作包 T1 的准入检查，不声称已有基准结果。

### 3.2 系数与选择位置

**配置归属提案，待确认：**

- 正式运行的自定义系数按 `providerProfileId + modelId` 保存，复用 Provider Profile Document，在 `config` 之外增加模型估算覆盖字段。`config` 是 Provider Adapter 校验并消费的连接参数，不混入本地估算设置。
- 不建立独立 Model Store、不把系数复制进每个 Setting/Preset、不创建用户预设 CRUD 系统。官方预设是静态数据，应用到某个模型时保存实际数值与来源版本。
- 未配置的模型采用明确标识的“基础计数，系数 1”，不显示为已校准的目标模型计数。不按厂商名、代理地址或模糊模型名静默套系数。
- 无模型上下文的资源编辑器默认基础方案，允许临时选择已有模型方案或输入系数；首版不持久化这份编辑器临时选择，也不修改模型配置。
- Preview 和正式 Run 在准备阶段解析同一配置；Run 内冻结数值，设置变更从下一 Run 生效。最终测量记录保存展开后的基准，不只保存可变配置 ID。
- 更新配置必须携带调用者看到的 Provider Document 版本。当前 updateProviderProfile 只有读取后的 CAS，不能保护陈旧客户端表单；本次仅为新估算配置写入补齐明确基线，不顺手重构所有 Provider 编辑行为。

官方预设先只交付基础方案。DeepSeek/Claude 等具体系数须以固定基础 tokenizer、具体模型和中文叙事/英文/代码/工具 JSON 样本校准后再发布。`DeepSeek ≈ Claude × 0.6` 不是 `DeepSeek ≈ o200k_base × 0.6` 的证据。

### 3.3 扩展消费

建议在正式 Client/Server Extension Activation Context 增加 `ctx.tokens.countText({ text, multiplier? })`，两端都返回 Promise 和相同结果 DTO：

- Client Host 使用同一 Worker；Server Host 使用同一基础包的按需加载实现。
- 输入必须是调用者已经拥有的文本；接口不接受 Resource ID，不代读数据，不获取秘密，不访问远端 Provider。
- SDK 不暴露修改全局系数、注册分词器或读取其他扩展内容的能力；调用者提供什么文本，只计算什么文本。
- 不建立单独 HTTP 计数路由。第一方前端也不为计数绕到 `ctx.rpc`。
- 扩展是实际资源消耗边界：复用宿主生命周期，销毁时拒绝未完成任务；公开前明确单次输入与待处理任务上限，不能由扩展无限堆积 Worker 队列或长期阻塞 Server。
- 本 Plan 首批暴露只覆盖 Activation Context。iframe Renderer、Loom Script、QuickJS/CodeAct 各有独立桥和权限边界，不因增加一个 SDK 类型就宣称全部已接入；这几个表面的接入另行确认，不复制接口到所有 ctx。

## 4. 前端计算与逐级统计

### 4.1 数据流与缓存

```text
Query 已加载资源 + useContextAssets 草稿覆盖
  -> 当前资源的计数条目集合
  -> 300ms trailing debounce / IME 组合结束
  -> 懒加载共享 Worker，计算变化正文
  -> 基础计数内存缓存
  -> 系数换算、条目/文件夹/资源汇总
  -> 现有工具栏、树行与详情
```

通用 Worker 客户端与 `useTextTokenCount` 放在 Client `shared/tokenizer/`，不含资源类型。树汇总 hook 放在 `features/context-assets/model/`，消费现有可见草稿，不建立第二份 canonical resource state。Widget 只传参和排版。

缓存只保存基础整数，键为文本内容摘要与基础计数版本；摘要也在 Worker 中计算，不在每次按键时同步扫描全文。修改系数只重新换算，不重新 tokenize。这修正了早期“系数变更全部缓存失效”的粗略说法：失效的是展示结果，不是基础分词结果。

一个受容量约束的 Worker 缓存即可，不为第一版引入 IndexedDB、localStorage Token 缓存或通用多级缓存。缓存不保存 token IDs；不长期保留每次编辑的全文。退出应用可丢弃，endpoint/登录生命周期结束时清除所属工作与展示映射。

- 首次完整统计计算当前资源未命中的正文，不在应用启动时遍历所有资源。
- 同一条目只保留最新待处理版本；正在执行的旧任务可能无法中断，但结果不得覆盖新草稿。
- 结果关联 endpoint、资源/节点身份、草稿代次与测量基准。防抖等待期保留旧数并标记待更新；错误、尚未加载和真正的 0 分开。
- 单条修改只重新分词该正文；树级汇总可用一次廉价遍历，不为 O(height) 更新再维护可写祖先索引。移动、启停、系数修改不触发正文重新分词。
- 显式刷新本地统计可 flush 当前草稿；后端 Build Preview 当前只消费已保存资源，不能通过自动保存草稿来伪装“草稿构建预览”。
- IME 组合状态需从 CodeMirror 向计数消费者暴露最小可选通知；不改变已有 onChange/onCommit 语义，不把整套编辑状态搬出编辑器。

### 4.2 统计口径与 UI

| 视图 | 输入与显示口径 |
| --- | --- |
| 任意文本 / 单条详情 | countText 接受当前正文；不要求文本来自 Prompt Resource |
| Setting/Preset 自身 | 仅遍历选中资源原始 rootNode 的 Entry 正文，显示原文合计与已启用原文合计；原文宏按字面计算 |
| 文件夹/MessageBlock | 汇总其 Entry 后代；不把容器备注当成注入正文；启用小计继承祖先 enabled，不求运行时 Activation |
| Script 等非 Prompt 正文 | 单独文本计数可以显示，但不混入提示词 Entry 总量；脚本产出以实际构建为准 |
| Preset 主树中的外部 Setting/Tool | 标明外部来源，不累加进 Preset 自身计数；不把同一贡献的多处 UI 镜像重复统计 |
| 实际 Build Preview | 后端有效消息与 Native Tool Spec 的估算；不使用前端静态启用结果代替运行时 Activation |

所有树级合计从未乘系数的基础整数求和，再乘一次系数并向上取整。不能把每行已取整展示值再累加；各行独立取整造成的小差异应在统计口径说明中明确，不分摊成虚假 Token。

原文合计是“独立 Entry 计数之和”，不是拼接后请求的精确分词。资源名称、标签、meta、未展开宏字典、未启用工具注册表不进入正文总量。

UI 复用现有 `PromptResourceToolbar`、`ContextAssetExplorer`、`ContextAssetDetailHeader` 和 Inspector。提供资源总量、文件夹小计、单条正文计数及可查看的基准；不增加独立 Dashboard 或分词页面。按需显示明细，不让每个隐藏面板订阅并计算所有资源。

## 5. PromptBuild、请求估算与持久化

### 5.1 首版请求口径

基础包只计文本。Provider-neutral 请求适配函数放在 `packages/ai-gateway`，输入明确的 messages/tools 和已解析计数基准，不接收 Session 或 Preset。

建议首版口径命名为 `canonical-content-v1`：

- 每条消息正文，包括当前输入、展开后的设置、历史、工具结果和 Fresh Context；
- Assistant Native Tool Call 的函数名和实际 arguments 字符串；
- Native Tool Spec 的 name、description，以及发送前 inputSchema 的确定性文本表示；
- Content Tools 已经包含在消息里，不再按注册定义额外累加。

分别计数上述文本部件，汇总基础整数后应用系数。返回消息/工具级明细以及口径版本；不把完整 HTTP JSON、metadata、鉴权、stream 参数或 UI 标签拿来 tokenize。

首版明确不覆盖服务端 role framing、隐藏特殊 token、多模态、隐藏 reasoning 和私有协议附加输入。结果应命名/展示为“请求内容估算”，不能称为“精确输入总量”。缺失开销标为未计入，不伪造 0 或固定常数。后续若改变计数文本表示，必须升级口径版本。

`previewAgentTurn` 使用 prepared.agentStepMessages；Native Tool Spec 必须复用 Tool Loop 当前的描述/schema 构造 helper，不能直接计原始 Tool Exposure。实际调用则对每次已组装的 stepMessages + toolSpecs 计量，覆盖后续工具结果、Fresh Context 及 continuation，不重复执行 PromptBuild。

首版 Preview 提供“总览 -> 消息/工具 -> 正文”的解释。现有 fragmentIds 可用于定位来源，但不据此平均分摊 Token。完整 Contribution 出现次数、宏归属和拼接差值留给专业 Trace 计划；不借本 Plan 重构 DFS 或创建第二套编译器。

### 5.2 历史测量

**新增 Transcript 事实的提案，待确认：**

调用前 append 一个本地 `request-measurement` 事实，记录唯一 `measurementId`、runId/可用 buildId、providerStep、请求的 Provider/Model 选择、冻结的计数基准、请求内容 digest、基础数与估算数及未覆盖项。`runId` 沿用外层 Transcript 字段，不在内外层重复保存。

- 这条事实只证明输入已准备并测量，不证明网络请求已发出。持久化后再次检查取消；请求没有终态时标为未确认，不推断成功。
- append 失败则不发起该 Step 的 Provider 请求；没有偷偷降级为“只打日志”的第二条路径。该持久化门禁是待确认行为。
- 成功返回的 provider-observation 用 measurementId/providerStep 关联实际 usage；失败、取消由现有 Runtime 终态记录关联该测量，不伪造 Provider usage。
- Provider 响应已到达后，应在工具参数解析等可能失败的处理之前保存 observation，避免工具解析失败导致已知 usage 丢失。不要在保存失败时静默重试非幂等调用。
- 每次执行实例有唯一 measurementId；不能只用 runId + 从 1 开始的 step 当唯一键，继续执行时可能重用步号。
- 本地估算不挂到假装 Provider 返回的数据里；临时 Preview 不 append Transcript。
- 新 kind 不进入 Session 回放文本、最新用户输入判定或工具配对，不改变消息的业务语义。同步检查归档、UI、TypeScript 穷尽分支和 Store 校验。
- `entry_json` 可容纳新增事实，无需单独建 Token 表；旧记录没有测量就是缺失，禁止回填 0 或把今天重算的结果当作历史。

Gateway/Runtime/Store 的统一 usage DTO 增补当前 SDK 已提供且确有审计用途的 cache read/write、reasoning 等明细。由 Gateway 完成规范化，Store 只做持久化边界校验；缺失保持缺失，明细是否属于总数必须按 SDK 合同处理，不重复相加。Fake Provider 的 0 只代表模拟，不参与官方系数校准。

常规日志只保留数字、身份与摘要；不保存正文、密钥或完整 wire payload。全文快照、保留期与可重放性由审计计划另行决定。内容 digest 本身不能复原 Prompt，也不是脱敏或完整可重放的保证。

未来压缩/交接消费者调用同一基础能力，并在自身事件中保存前后值及来源范围；本 Plan 不修改其调度或自动创建摘要。

## 6. 工作包、写集与验收

当前全部为未实施。默认单 Agent 按依赖执行，不因表格分包就创建多 Agent。配置与历史事实合同确认后再开始触及 T2/T4。

| 包 | 限定写集与工作 | 最小验收证据 |
| --- | --- | --- |
| T1 基础能力 | 新增 `packages/tokenizer/{package.json,tsconfig.json,README.md,src/}`；必要的根 TS references、workspace 配置和 lockfile；增加依赖所有权记录 | `tests/unit/tokenizer/tokenizer.test.ts`：中英混排、代码、空串、特殊标记字面量、系数与取整；锁定库版本并验证 Node/浏览器一致性；记录代表性长文耗时与 Worker 产物大小 |
| T2 配置 | `application-runtime/src/{types.ts,runtime/providers-runtime.ts}`、相关 Document Schema/RPC parser、Client `entities/provider.ts`、`features/provider-settings/model/use-provider-settings.ts`、`widgets/model-panel/` 与 typed API | 仅更新一个模型覆盖；数据库重开可读；旧配置缺字段默认基准；冲突不覆盖草稿；连接 config/凭据不混入系数；新配置不作用于进行中的 Run |
| T3 编辑统计 | 新增 Client `shared/tokenizer/`、`features/context-assets/model/use-resource-token-counts.ts`；连接 Context Asset toolbar/tree/detail 与 Preset/Setting Workbench；LongTextEditor/CodeMirror 最小 IME 通知；对应 i18n/SCSS | `tests/unit/client/token-counting.test.ts`：防抖、旧结果拒绝、系数仅换算、移动/启停不分词、草稿冲突/endpoint 隔离、外部投影不重复、未加载不报零；浏览器探针验证没有计数 HTTP、Worker 实际执行与 IME |
| T4 请求与历史 | `ai-gateway/src/{types.ts,gateway.ts,index.ts}`及新的请求计量 helper；`application-runtime/src/{types.ts,runtime/agents-runtime.ts,agents/tool-loop.ts}`与最小 Tool Spec helper；`application-data/src/agent/{types.ts,store.ts}`；必要的归档/回放消费者、Inspector | 扩展 `tests/integration/application-runtime/default-preset-lifecycle.test.ts` 或独立 `token-measurement.test.ts`，用真实 Runtime + SQLite + 脚本 Gateway 覆盖多 Step、Fresh Context、Native/Content Tool、响应后解析失败、网络失败、取消、续接与数据库重开；检查每次测量与 observation 关联 |
| T5 SDK | `extension-sdk/src/index.ts`、Server Host `extension-host/src/instance.ts`及 options 装配、Client `features/extension-renderers/model/client-extension-host.ts`与已有 Host 组装调用点 | `tests/contract/extension-host/token-counting.test.ts` 加 Client Host 定向测试：任意文本一致、非法系数拒绝、生命周期释放、输入/队列限额、无 Provider HTTP/无资源代读；不顺手开放 iframe/CodeAct |

实施顺序：T1 -> T2/T3 -> T4 -> T5。T3 的原文基准计数不依赖 T4 持久化；T5 不依赖专业 Inspector。官方系数校准不是阻塞基础方案的前置任务，但未经校准不得发布厂商命名默认系数。

新建包、Worker 和依赖会改变构建入口：实施 T1/T3 时运行相关 Package 与 Client build，确认词表不落入主入口；不因此跑整个仓库测试。T2/T4/T5 只增加受影响包的定向类型检查与上表行为测试。测试文件名属于拟新增位置，不代表这些测试已经存在或通过。

需要外部模型校准时先确认样本可外发、目标模型、端点与调用费用；本轮不使用真实凭据、不发送用户正文。主观视觉与编辑手感由用户验收，自动化不能替代。

## 7. 待确认项与停止条件

1. **系数归属**：推荐 Provider Profile 下按 modelId 保存，资源编辑器仅临时选用；是否接受？它使同模型跨 Preset 共用配置，不随 Preset 导出。若要求随 Preset 分发，应先改变合同，不由实施者偷偷增加两级覆盖。
2. **持久化门禁**：是否接受新增本地 request-measurement Transcript 事实，以及“该事实写入失败就不发送”的行为？只在成功 observation 附带估算更省事，但不满足失败/取消路径的审计目标，因此不作为等价实现。

其余可在既定边界内选择：具体文件拆分、Worker 有界缓存规模、300ms 防抖微调、静态预设命名、UI 文案。SDK 输入/队列限额须在 T5 用代表性负载确定并记录；如果需要进程隔离、额外运行时或不同权限模型，暂停而非自行扩建。

遇到在途 Agent/Preset 重构改变上述入口时，更新本 Plan 的事实和写集，不恢复旧 Profile 或对当前工作区做回滚。若需扩展多模态、远程计数、自动记忆策略、完整快照或新数据表，返回独立决策，不借“补完整”扩范围。

## 8. 本轮交付与验证账目

- 已完成：数据层、Provider 配置、PromptBuild/Step、前端草稿/投影、SDK 宿主入口的只读核对；形成本文。
- 已完成：在 Plans 索引和旧 Token 调研稿添加接续入口。
- 未实施：T1-T5、任何依赖安装、数据/Schema 变更、计数界面、官方系数发布。
- 文档验证：`pnpm check:docs` 通过，333 份 Markdown 的内部路径/大小写/锚点有效，Plan 索引与生命周期检查通过；两份既有文档的定向 `git diff --check` 通过。既有 Plans 索引包含其他未提交修改，本轮只新增本计划的一行，不将整个文件 Diff 算作本轮成果。
- 未验证：实际分词性能、跨端一致性、模型误差、Worker 浏览器行为、人工视觉。未调用模型，也未运行业务测试或构建。
