# Dashboard 真实数据、资源清点与统计采集实施方案

> **状态**：首版真实数据接入已实现；定向验证完成，待用户界面与真实 Provider 验收。
> **日期**：2026-10-25
> **当前授权**：用户已授权实施。入口采用工作区「活动」分组的「历史」下方，打开浮层；不放 Header、不新增工作区 Panel。

## 1. 目标与边界

把现有 Dashboard 草稿接成可解释、可核对的实例级数据总览，并增加内部资源清点。默认统计当前连接的 Server 实例；它不是提供商账户账单，也不统计绕过宿主 Gateway 的外部调用。

**已确认**：Dashboard 使用大浮层，临时查看、筛选和下钻；关闭回到原工作位置。真正编辑、游玩和管理跳回已有工作区，不把 Dashboard 注册为持久 Panel，不在浮层内复制管理工作台。

**界面组织建议**：五个视图为「概览 / 模型用量 / 游玩统计 / 资源 / 数据与存储」。概览只取摘要；资源与存储展示当前快照，不跟随用量 / 游玩的日期筛选。「资源」列角色、Lore、预设、扩展、脚本等数量，点击进入已有管理入口。资源视图已加入复用展示组件。

**2026-10-25 已确认的数据口径**：累计指标从上线启用采集后开始，不回填旧数据；累计 Token 不因角色、故事、会话或提供商配置删除而减少或消失；取消游玩时长及相关前台监听、心跳、租约和时间区间存储；原生官方 AI Gateway 调用链首批尽可能完整接入，能够返回标准 Token 数据的路径都计入，未返回的标记未报告。用户发送计数仍在范围内，直接依托发送事务，不新增浏览器活动追踪。

不包含金额估算、提供商账单同步、任意 SQL 执行器、通用埋点系统、可配置 Dashboard 引擎、Blob GC、数据库压缩或批量清除历史。没有可靠数据的项显示未采集 / 未报告 / 不可用，不沿用样例数字。

## 2. 当前已核实的接入基础

| 能力 | 当前事实与入口 | 缺口 / 第一批可展示内容 |
| --- | --- | --- |
| UI | [DashboardDialog / DashboardPanel](../../../apps/studio-client/src/widgets/dashboard/dashboard-panel.tsx)、[展示输入](../../../apps/studio-client/src/widgets/dashboard/dashboard-view.ts)；样例只在 dev preview | 复用组件，增加资源视图与真实加载 / 缺数状态；当前 `DashboardSnapshot` 是展示输入，不是后端合同 |
| 数据查询 | [SqliteDataEngine](../../../packages/data-engine/src/sqlite.ts)已有 `read`、`readSnapshot`、事务与 migration；[定向查询先例](../../../packages/application-data/src/text-transform/queries.ts)已在 Application Data 使用 SQL 聚合所需的读入口 | 不缺 SQL 执行基础，缺领域统计查询；不能让客户端加载全部 Document / Transcript 后计数 |
| 资源 | [Document 类型](../../../packages/application-runtime/src/foundation/document-types.ts)、[Card 列表](../../../packages/application-runtime/src/runtime/cards-runtime.ts)、[Prompt Resource Store](../../../packages/application-data/src/prompt-resource/store.ts)、[扩展安装](../../../packages/application-runtime/src/runtime/extensions-runtime.ts)已有权威身份 | 可直接统计当前非 tombstone 的实体；现有分页 / 全量映射列表不等于计数接口 |
| Agent 用量 | [Transcript 类型](../../../packages/application-data/src/agent/types.ts)有 request-measurement / provider-observation；[tool-loop](../../../packages/application-runtime/src/agents/tool-loop.ts)尽力保存估算和 usage，失败不阻断调用 | 可以只读查看已记录历史，但不足以声称累计实际用量完整；缺独立、结构化、可索引的长期调用事实 |
| 其他模型调用 | [Session 摘要](../../../packages/application-runtime/src/agents/session-summary.ts)、[Provider 测试](../../../packages/application-runtime/src/runtime/providers-runtime.ts)、扩展 chat 使用 Chat Gateway；[Profiled Gateway](../../../packages/application-runtime/src/providers/gateway.ts)另供 `ai.invoke/start` 和扩展能力调用 | 必须覆盖两条入口。能力调用的 [AiGatewayInvokeResult](../../../packages/ai-gateway/src/capability-registry.ts)只有通用 output，没有标准 TokenUsage |
| 模型日志 | [ObservationStore](../../../packages/application-runtime/src/observability/store.ts)默认 24 小时 TTL、1000 条 / 32 MiB；可选磁盘快照仍受保留范围限制；[读取端](../../../packages/application-runtime/src/runtime/observability-runtime.ts)还会隐藏已删除关联对象 | 可作短期下钻证据，不能承担长期统计账本；日志关闭、过期或清理不应改变累计用量 |
| 故事与用户输入 | [Narrative Store](../../../packages/application-data/src/narrative/store.ts)有 Timeline 来源 Card、Branch、Node 与 canonical Transcript 关联；[Agent Store](../../../packages/application-data/src/agent/store.ts)有 round / candidate 身份及会话删除状态 | 可读故事 / 分支数量、当前剧情输入数、最近更新时间。缺“用户实际发送行为”的稳定事实，不能直接拿 entryCount 当消息数 |
| 游玩时长 | 用户已取消该指标 | 不实现采集、RPC、持久化及展示；不以生成耗时或故事时间跨度替代 |
| 存储 | [路径解析](../../../apps/studio-server/src/platform/local-paths.ts)、[Server 组合根](../../../apps/studio-server/src/server.ts)、[Blob Store](../../../packages/asset-store/src/blobs/store.ts)已有路径、文件与 blob size metadata | 缺受控文件快照、数据库空间统计、对应 RPC；数据库 bytes 与文件扫描需分层 |
| RPC / Client | [router](../../../apps/studio-server/src/rpc/trpc/router.ts)、[services context](../../../apps/studio-server/src/rpc/trpc/services-context.ts)、[StudioApi](../../../apps/studio-client/src/shared/api/studio-api.ts)已有接线模式；[全局搜索](../../../apps/studio-client/src/features/global-search/model/use-global-search.ts)有按 open 启用 Query 的先例 | 没有 Dashboard 聚合 RPC；新增窄接口，按 endpoint / 条件缓存，保持现有认证 |

当前源码还确认：底层 Chat Gateway 使用 `maxRetries: 0`；不能由此推断第三方 Capability Handler 内部没有自重试。一次宿主调用与一次外部 HTTP 请求必须区分。

## 3. 资源清点：优先直接接真实数据

### 3.1 首批分类与计数单位

| 展示 | 权威来源 / 单位 | 不计入或单独展示 |
| --- | --- | --- |
| 角色 | `documents.type = airp.cardSource`，按活跃 Document ID | 文件化角色目录与数据库是同一角色的不同表示，不相加。未导入、冲突或损坏目录属于目录诊断，不算已安装角色 |
| Lore | `prompt_resources.resource_kind = lore`，包 / 根资源数；另列其节点中 `kind = entry` 的条目数 | 文件夹、挂载、修订、引用不算 Lore 包；未知节点 kind 不强行归类为条目 |
| 预设 | `prompt_resources.resource_kind = preset`，根资源数 | Agent Preset 与这里的 Preset 是同一资源，不重复加总；消息、锚点、工具挂载不是额外预设 |
| 扩展 | 活跃 `airp.extensionInstallation`：`COUNT(DISTINCT packageId)` 个 Package，另列全局安装数、角色安装数 | 一个 Package 装在多个角色上，Package 数仍为 1；版本数、模块数、启用实例数另有单位 |
| Loom Script | `airp.loomScript` 定义 Document 数 | `loomScriptMount` 只代表挂载；扩展生成的脚本仍是脚本定义，但不与 Package 数组成“去重资源总数” |
| 正则规则 / 提取器 | `airp.textTransformRule` / `airp.textExtractor` 活跃定义数 | 文本流水线 override 与消费挂载不增加定义数 |
| 媒体素材 | `media_assets` 的 asset ID 数 | `stored_blobs` 是去重文件数；`source_artifacts` 是原始导入来源数，分别标注，不能合并成素材数 |
| 故事 / 会话 | 非删除 Timeline 数；`agent_sessions.kind = agent` 的独立会话数 | Timeline 自带 `kind = timeline` Session 不再算一份独立会话；分支数放故事细分 |

第一屏以角色、Lore、预设、扩展为主，脚本、规则、素材等为次级列表；不放一个混合不同单位的“总资源数”或占比饼图。Provider 配置、能力配置、内部状态定义可作为后续指定分类，不因所有 Document type 都可 COUNT 就全部暴露。

### 3.2 查询与可用性规则

- 默认统计当前实例全部已存活资源，包括暂未被任何角色采用的资源；同一 ID 被多个角色 / 预设引用只算一次。复制出新 ID 是另一份实体。
- 初版只承诺存在数量，不把“存在”包装成“可正常执行”。损坏 Prompt 资源的 Header 仍计入保存数量；只有已有诊断明确标为无效时才给出无效子计数，不为 Dashboard 全量解析资源树。
- tombstone 不计入当前库存；仍占磁盘的修订、旧 Blob 和已删除数据会继续出现在存储统计，因此资源数量下降不保证文件总大小下降。
- 扩展“安装 / 可发现 / 启用 / 当前 Timeline 参与 / 当前运行实例”各有来源。第一版以安装记录为主，不新增含混的“启用扩展总数”。[Extension Manager](../../../apps/studio-server/src/extensions/extension-manager.ts)的 `listPackages(target)` 按目标返回发现与运行状态，不能只数全局列表来冒充全实例安装数。若需启用状态，新增面向安装目标的摘要读取，并明确取 enabled 的模块还是 Package。
- SQL 可计数部分在一个 `engine.read` / `readSnapshot` 中完成；只 SELECT COUNT / GROUP BY 所需字段，不用当前 `listPromptResources` 的整树 materialize 流程。
- 暂不增加资源明细浏览 RPC；分类点击复用现有角色、Lore、Preset、扩展、Script、规则页面。缺少真正的素材管理入口时先只展示计数，不能用无效“管理”按钮充数。

## 4. 模型用量：新增轻量调用事实，而非汇总日志

### 4.1 最小事实模型与写入位置

建议在 Application Data 增加专用 `usage_requests` 表（独立 migration namespace `application.statistics`）。一行代表一次宿主实际派发调用，不代表整个 Agent Run；只保存统计所需字段：

- 宿主生成的 `requestId` 主键；开始 / 结束时间、状态、调用入口与用途、真实或模拟 Provider 标志。
- 请求当时的 `providerProfileId / providerId / modelId / capabilityId`，可空的 Session / Timeline / Card / Run / providerStep / installation 引用；必要的非敏感显示名快照。配置删除 / 改名不重新归类历史。
- 可空的 `inputTokens / outputTokens / totalTokens / cacheReadTokens / cacheWriteTokens / reasoningTokens`；`providerCallId` 仅作关联，不能作为跨提供商唯一主键。
- 不保存正文、工具参数、账号配置、密钥、请求头或完整 URL；原始证据仍归短期 Observation。

`UsageStore` 只需 `begin / finish / querySummary / querySeries / listRequests`；同一 requestId 的完成写入幂等。时间索引及常用 provider/time、timeline/time 索引按真实查询添加，不建立通用事件总线或预先堆所有索引。

采集放在 [Document-backed Gateway](../../../packages/application-runtime/src/providers/gateway.ts)解析出真实配置、完成校验后，紧邻实际调用的位置：

1. Chat 路径覆盖正常生成、工具循环、Swipe、重试、摘要、Provider 测试、宿主扩展 chat；通过受信宿主上下文传递用途和关联，不从任意外部 metadata 信任 Card / 安装身份。
2. Profiled 路径覆盖 Client `ai.invoke/start`、扩展能力调用；统一拿到已解析的 Provider Profile 和 capability。`createRun` 包装同一 invoke 时只记一次。
3. 沿用现有 Transcript / Observation 记录用于上下文估算与诊断；Dashboard 只读新事实表，不同时累加三种来源。模型未派发即校验失败不记作调用，可在原有诊断里查看。
4. Fake Provider 单独标记，默认从真实消耗中排除；提供明确筛选查看开发调用，不把 fake 的零 Token 当真实零消耗。

统计写入仍不能引发模型调用重试、吞掉模型结果或改变故事恢复流程。写入失败记录诊断与当前采集不完整状态，不宽泛静默忽略；不承诺绝无遗漏的账单。开始行存在而结束行缺失，重启后标为结果未知，不补零、不自行重发请求。

### 4.2 Capability usage 的公共合同缺口

当前 Capability Handler 返回任意 `JsonValue`，`AiGatewayInvokeResult.output` 没有统一用量字段。禁止遍历或猜测所有 output 里的 `usage` 属性。

已确认首批接好原生官方 Gateway 中所有能取得用量的路径，不再把已能返回 Token 的 Capability 固定延期。统一采集边界覆盖 Chat Gateway 与 Profiled Gateway，保留各自调用身份，避免同一底层调用经过两层入口被重复统计。

实施时逐项列出原生能力的返回合同：已有明确 usage 字段的官方协议，在其所属适配器按契约映射到 TokenUsage；不能在 Dashboard 或通用 Gateway 猜测任意 output。对于缺少标准报告通路的 Capability，在同一用量实施闭环中补最小可选 `reportUsage(TokenUsage)` 侧通道，并让 Gateway 结果可选携带归一化 usage，保留既有 output 和无报告 Handler 的行为。涉及 [capability-registry](../../../packages/ai-gateway/src/capability-registry.ts)及实际扩展桥接 / SDK 接缝，需沿调用链确认传递并做定向兼容验证，不仅在服务端类型上加一个不可达字段。

由此，通过官方 AI Gateway 的扩展只要按标准返回或报告 Token 就能计入，不要求每个扩展单独接 Dashboard。不能提供 Token 的能力仍显示调用次数与“未报告”；图片张数、音频秒数等非 Token 单位不强行换算。不追踪绕过 Gateway 的 HTTP 调用，也不要求本轮改造所有第三方扩展。

报告按“该宿主调用累计值”覆盖保存，不把多次 usage 通知简单相加；如果一个 Handler 内部派发多次调用，它应报告累计值。缺少报告时不能推断内部请求数或 Token。

### 4.3 计算规则

- 日期按调用开始时间归属；结束后更新同一行。一个跨午夜请求只在一天计数。过滤采用 UTC 半开区间 `[from, to)`；日期标签按明确 IANA 时区生成。
- 每个非空字段独立聚合并返回覆盖计数。只有 total 的记录不能凭空拆输入 / 输出；total 缺失且输入输出均齐全时才可派生总计，并保留来源标记。
- 缓存与 reasoning 是子项，不再加到 input/output/total 上。不同 Provider 对输入、缓存的定义可能不同，未经明确适配不“修正”实际报告。
- 重试、未采用 Swipe、被回滚的写作、生成后应用失败都确实可能消耗 Token，应保留。当前分支是否采纳不影响消耗。
- 没有 usage、请求失败、取消、结果未知分别统计；失败或取消不等于免费。现有 stream 中止通常拿不到最终 usage，不能用输出字符估算冒充报告值；若已收到标准 usage 而后续校验失败，采集点应保留它，不因结果转换失败丢失。
- 调用成功与内容被业务接受是两种状态。首批状态描述 Gateway 执行结果，不暗示剧情已采用。
- 用量按 Provider Profile ID 区分，不能把同名提供商账户合并。未绑定 Timeline 的后台 / 能力请求进入“未关联角色”分组，不硬分配给当前页面角色。
- SDK 下游是否重试与宿主调用数不同；首批显示“宿主调用次数”，不宣称外部 HTTP 请求次数。

### 4.4 历史与删除

已确认从上线启用采集之日开始累计，响应提供 `collectionStartedAt`。不自动扫描 Transcript 灌入新账本：导入归档、复制历史、重新编号、缺少 measurement、重复保存结果等都可能造成二次计数；旧摘要 / 能力调用更无法完整补齐。

“上线起计”只约束累计消耗与发送行为；当前资源库存、现存故事和文件占用仍包含上线前已存在的内容，不把旧资源从快照中排除。

旧 Transcript 和短期日志保留现有查看能力，但不导入统计账本。首次启用时持久记录采集起点，重启、升级不重新归零；不得因为新增指标或应用初始化而清空已有事实。

已确认累计 Token 不因删除角色、故事、会话或提供商配置而减少或消失。用量表不使用业务删除级联，聚合也不能通过“只关联当前存活对象”的 INNER JOIN 隐式丢掉记录；关联已删除时显示已删除 / 不可用，管理跳转禁用。统计不进入 Timeline 归档、导入或恢复流程，重新导入故事不增加消耗。日志过期或关闭不影响账本，不设置会让累计用量缩水的自动统计 TTL。全部记录的累计值与最近 7 / 30 天的筛选小计明确区分；滚动窗口移出旧请求不代表删除历史累计。

当前资源数量仍随新增 / 删除变化。发送次数按上线后实际接受的行为事实统计，不通过现存消息数反算；其展示可以区分当前角色与已删除关联，但不把删除解释为一次负发送。

## 5. 游玩统计：把“库存记录”和“发生过的活动”分开

### 5.1 不新增采集即可接的内容

角色关联的故事数、分支数、最近更新时间可以直接查询。当前分支的剧情输入数可以沿 active branch 的 parent 链读取 `narrative_node_projection.kind = user-input`，按节点身份计数；它只表示当前剧情保存了多少输入，不等于累计发送行为。

Narrative 正文已与 canonical Transcript 关联，不能把 Node 与对应 Entry 相加。分支共享祖先不能按每条分支重复计数；不能用 `agent_sessions.entry_count`，其中还包含推理、工具、状态与计量条目。仅有 `createdAt / updatedAt` 无法证明活跃天数与有效游玩时间。

新增用户发送计数从启用采集后开始，不拿历史消息总量维持草稿里的“用户发送”文案。当前剧情输入数如需展示，应独立标注为当前内容快照。取消时长后不再展示“有效游玩”；如保留日期指标，命名为“发送天数”，只按已有发送事实的本地日期去重，不推断阅读活跃天数。

### 5.2 用户发送事实

建议新增 `play_interactions`，字段只包含稳定 action ID、发生时间、类型（剧情 / 沟通 / 独立 Agent）、关联 Card / Timeline / Session；不保存用户文本。

- 在实际接受用户发送并写入首个权威输入的事务里记录一次。与模型最终成功无关，网络 / Provider 失败后重试原发送不再加一次；全新发送和明确编辑后重发是新行为。
- Narrative 使用现有稳定输入身份作为幂等依据；普通 Agent / 沟通如没有等价身份，需在发送请求增加 `interactionId`，同一次传输重试复用。服务端限定该 ID 的目标和类型，拒绝把同一 ID 复用于不同内容 / 会话，不将新的 RPC correlationId 当行为身份。
- 宿主传递明确的用户发送意图，不能在任何 `role=user` 条目写入时自动计数：工具循环、扩展触发、历史导入、归档恢复、复制与内部提示都可能生成这种条目。
- 在 Application Data 内用事务参与者落盘；不得靠提交后事件订阅再写一遍而丢失原子性。Agent Store 的可选接受行为字段由 Runtime 负责构造，不暴露成允许扩展伪造用户活动的接口。
- Timeline 卡归属取当时服务端关系，独立 Agent 会话单列。关联删除后不级联删除行为事实，标签与导航按上一节处理。

### 5.3 已取消的时长范围与 UI 调整

用户明确不要游玩时长。删除原方案中的 `play_activity_intervals`、`dashboard.playActivity`、活跃租约、前台活动 hook、visibility / focus / 键鼠 / 滚动监听、心跳及周期落盘，不保留休眠实现或配置开关。

游玩视图围绕“用户发送次数、发送天数（若展示）、关联故事与最近发送”组织；排序使用发送次数 / 最近发送，不再按时长排名。角色数量与故事数量是当前快照，时间范围只筛选新采集行为。发送天数按服务器保存的发送时间与所选时区去重，可从发送表查询，无额外采集。

已从 `dashboard-view.ts / dashboard-panel.tsx / dashboard-fixtures.ts` 移除时长卡片、排序与样例字段，没有保留未采集占位。

## 6. 数据与存储：两种空间口径

### 6.1 文件快照

建议首批横条改为“应用文件总大小”：使用文件 `stat.size` 的逻辑字节数，按互斥目录归属分类。它不等同于 APFS 压缩、克隆、稀疏文件或文件系统实际分配块数。单位统一：按 1024 换算时使用 MiB / GiB，不能标 MB / GB 却按二进制计算。

由 Server 持有实际路径，包括 `options.sqlitePath` 等覆盖值；不能只根据默认 dataRoot 猜数据库位置。分类至少包括：

| 分类 | 范围 |
| --- | --- |
| 数据库文件 | 实际 SQLite 文件及 WAL / SHM，各自列明；`:memory:` 明示无持久数据库文件 |
| 素材 / 原始 Blob | `blobs/sha256` 实际文件；staging 另列临时项，不直接判作可删 |
| 角色目录 | `data/characters` 实际文件；即使内容也有 Blob 副本，两个独立文件都占逻辑字节 |
| 扩展持久数据 | `data/extensions`，区分全局 / 角色文件数据 |
| 备份 | 配置的 backupRoot |
| 缓存 / 日志 | 实际 cacheRoot / logRoot；不是默认一定在 dataRoot 下 |
| 配置与其他 | config、观测快照、绑定信息等已管理数据根中未落入以上分类的文件，保证总量不漏项 |

扩展代码安装根与数据根分离；初版明确不含程序安装体积与外部 dev-link 源码。需要显示扩展代码体积时另列受管理安装代码项，不递归扫描任意开发链接目标，也不能把数据与程序文件混成一个未说明总量。

扫描要求：规范化已授权根，重叠根按最具体分类归属，一条实际路径只计一次；不跟随符号链接，不接受客户端任意路径。不同文件的内容相同仍按其文件身份统计；Blob 的内容去重由现有存储实现保证，不能再用 asset 数乘 size。

只在展开存储视图 / 明确刷新时扫描；同一次扫描复用 Promise，完成结果短时缓存（建议 60 秒）。限制并发和扫描预算，返回测量起止时间、已完成分类与错误 / 超限状态；扫描中删除的文件、权限失败、不可读目录不能悄悄变成零或完整快照。文件扫描不是跨目录原子快照。

目录可能位于不同卷；磁盘剩余按卷显示，不把多个路径上的同一磁盘 free 重复相加。若只显示一个磁盘，必须标明“数据目录所在磁盘”，不暗示覆盖所有根。

### 6.2 数据库内部内容与空间

数据层提供只读 `readSqliteSpaceUsage(engine)`：`page_size / page_count / freelist_count` 与 `dbstat` 的表、索引页占用。按 `sqlite_schema` 的所属表归并索引；FTS shadow tables 和内部元数据明确归组，不能忽略自动索引或把同一页重复分配。

2026-10-25 在当前 Node v24.22.0 的独立 `:memory:` 数据库执行 `SELECT count(*) FROM dbstat` 成功，确认本地具备能力；没有打开或修改用户数据库。这不证明所有发行环境都有该扩展；不支持时显示表空间不可用，仍可显示数据库文件大小，不以 JSON 长度冒充页占用。

数据库内部视图建议展示「故事 / 会话、状态 / Workspace、角色 / Prompt、统计数据、修订 / 提交记录、索引 / 内部空间」的记录数及逻辑页占用。其当前逻辑页大小可能包含 WAL 中尚未 checkpoint 的页面，不要求与 SQLite 主文件 `stat.size` 完全相等。

**严禁**把 dbstat 页合计再加进横条的数据库文件大小。WAL / SHM 是文件快照中的独立字节，数据库空闲页已经包含于文件，不再叠加；“空闲页”也不是承诺可立即释放的字节。

统计操作不能执行 VACUUM、checkpoint、删除孤儿 Blob、改文件权限或触发目录导入。删除与空间回收继续留在各自的管理合同中。

## 7. 模块所有权与接口建议

以下名称是建议新增入口，不表示当前已经存在。保持现有 packages / Runtime / Server / Client 分工，不新增 package、ORM、分析服务或统一指标插件协议。

| 所有者 | 建议改动 | 暴露的窄能力 |
| --- | --- | --- |
| `packages/application-data/src/statistics/`（新增） | `types.ts`、`queries.ts`、`usage-store.ts`、`play-store.ts`；更新 package 现有导出 | 静态库存 / 故事聚合，调用事实与用户发送事实的查询和事务参与；不读取 Home、文件路径或当前 UI |
| `packages/data-engine/src/storage-statistics.ts`（新增） | 只读 SQLite 页 / 索引信息工具，复用 Engine 队列 | 数据库空间原语；不识别角色等产品分类，不扩大 Engine 成资源管理器 |
| `packages/application-runtime/src/runtime/statistics-runtime.ts`（新增） | 组合查询、业务关系与可导航标签，接入 `runtime.ts / types.ts / foundation/application-context.ts` | `getResourceStatistics / getUsageStatistics / listPlayStatistics` 等明确读方法；核对发送行为的业务关联 |
| `packages/application-runtime/src/providers/gateway.ts` | 给现有两个真实调用路径注入统计写入能力；关联摘要 / tool-loop 等宿主用途 | 不依赖 Observation 开关；既有 Gateway 返回值与调用失败传播保持 |
| `packages/ai-gateway/src/gateway.ts / types.ts` | 在已收到 SDK usage、尚未做内容合法性校验的位置提供可选宿主计量回调，复用现有 TokenUsage 归一化 | 保留“模型返回 usage，但正文校验失败”的事实；不推断尚未收到的流中止用量。只传计量字段，不把业务 Store 注入底层 Gateway |
| `apps/studio-server/src/statistics/`（新增） | `storage-snapshot.ts`、`dashboard-service.ts` | 持有受管理路径和文件快照缓存；组合 Runtime 与存储结果，不承担前台活动接收 |
| `apps/studio-server/src/server.ts` | 创建 Stats Store，注入 Gateway / Runtime / Server 服务；关闭时完成已接收写入 | 一个持久事实所有者，不给每个调用者各建一份计数器 |
| `apps/studio-server/src/rpc/trpc/dashboard.ts`（新增） | 注册受现有认证保护的 `dashboard` router，更新 `router.ts / services-context.ts` | 只暴露特定统计查询；不开放 SQL、任意路径和任意表内容 |
| `apps/studio-client/src/features/dashboard/model/`（新增） | Query keys / options、结果到展示输入的映射 | Server state 由 TanStack Query 持有；无前台活动监听；Gateway 计量与发送事实写入不依赖浮层打开 |
| `apps/studio-client/src/widgets/dashboard/` | 复用现有 Dialog / Panel，补资源视图、缺数、加载、错误、分页与语义导航意图 | 仅展示和局部交互，不导入 RPC，不持有第二份业务真值 |
| `apps/studio-client/src/app/` | 在 `app.tsx` 或局部 `studio-dashboard.tsx` 组合入口与跳转；沿用现有壳层按钮 | 浮层 open 状态；不新增 `StudioPanelId`；快捷管理关闭浮层后走现有 navigation |

无需给每个 Store 都加万能 `getStats()`：具体统计查询放在上述专用 Data 模块，沿用已有定向 SQL Query 模式。跨域拼装只在 Runtime / Server 完成。素材元数据的分组读取由 Asset Store 的窄读接口承载，Blob 私有表归其所有者；不把任意表名作为公开参数。

### 7.1 RPC 草案

| RPC | 输入 / 输出要点 |
| --- | --- |
| `dashboard.overview` | range → 小型用量 / 游玩摘要、当前资源计数；只带已有存储缓存摘要，不触发递归磁盘扫描 |
| `dashboard.usage` | range、provider/model/purpose 筛选 → 同筛选下总计、日期序列、提供商分组、字段覆盖与采集起点；可按天 / 周 / 月聚合，限制桶数 |
| `dashboard.usageRequests` | range、同上筛选、keyset cursor / limit → 小型调用事实分页；不返回请求正文；日志已过期仍能显示事实，日志跳转标记不可用 |
| `dashboard.play` | range、搜索 / 排序、cursor / limit，可选 cardId → 全筛选总计、角色分页、选定角色摘要；不能把当前页合计当全量 |
| `dashboard.resources` | 无时间范围 → 当前分类数量、明确单位与独立库存快照时间；不默认读取全部资源正文 |
| `dashboard.storage` | 明确刷新选项 → 受控快照、分类与卷信息、测量时间、完整性；不接受 filesystem path |
| `dashboard.database` | 固定逻辑分类 → 数据库内容计数与页空间，不返回表内容 / 密钥信息 |

不增加 Dashboard 专用 create/delete 管理 RPC。上报“用户发送”复用原发送事务，不开一个可让 Client 任意上报 sends 增量的接口。

range 采用验证后的 UTC 起止与 IANA timezone；服务端负责桶边界与归组。默认最近 30 天；“全部记录”根据跨度选周 / 月桶，不返回无限日点或全量请求。Query key 必须含 endpoint、范围、时区、筛选、分页；过时请求不能覆盖新条件。不同视图共享同一份指标计算函数，概览不能另算一套。

结果保留 `asOf / collectionStartedAt / availability / missingCoverage` 的必要信息；数据库资源快照与文件快照分别标时。后端没有 Engine、Asset Store 或某类采集能力时返回明确不可用原因，不回退成伪零值。

首版打开浮层时拉取当前视图；详情按需读取，关闭停轮询。对已完成资源管理或用量写入，用已存在的刷新 / 提交事实失效对应 Query，不因每个 Token delta 刷新。现有 DTO 字符串 action label 改为确定的导航意图，文案走现有四语言 i18n。

## 8. 实施顺序与验收

用户已授权执行以下闭环。接口表为设计草案；最终首版组织与限制见第 10 节。

| 步骤 | 交付闭环与主要写入范围 | 验收风险 |
| --- | --- | --- |
| A：只读资源与存储 | Data 定向 queries、Engine 空间读取、Server storage service / RPC、Client 浮层正式入口与资源视图；游玩先显示现有故事信息，其余缺数如实呈现 | > 一页的资源总计正确；引用 / 挂载不重复；删除库存与磁盘不混；路径覆盖、重叠根、权限错误与多卷可解释 |
| B：原生 Gateway 用量完整接入 | Stats migration / usage store、两个 Gateway 路径及必要标准 usage 传递、官方能力适配、实际 SDK 桥接、Runtime / RPC / Client 用量视图 | 原生路径有 Token 均可采集；同一调用只记一次；重试 / Swipe / 摘要 / 能力调用覆盖；删对象与日志过期不抹掉统计；旧 Handler output 保持，缺失 / partial usage 无伪零 |
| C：用户发送统计与 UI 收束 | play store、原生发送事务接缝、查询 RPC 与游玩视图；移除草稿时长字段 / 卡片 / 排序 | 同一次发送重试不加计；导入 / 回滚 / 程序触发不伪装用户发送；日期去重正确；没有新增时长监听与心跳 |

验证使用现有 SQLite / Runtime / Gateway / Client 测试设施，按上述完整闭环完成后集中进行。仅为新引入且缺乏更便宜验证手段的重要合同补必要用例：分支 / 导入去重、调用幂等和缺数、路径统计不重复、发送幂等与跨日 / DST 归组边界。无须建设新的测试框架、通用 Fixture 仓库或先重构旧测试。

UI 验收由用户完成：浮层大小、资源分类和单位、日期作用范围、缺数提示、管理跳转与返回位置。类型和定向测试只能证明所覆盖合同，真实 Provider usage 与远程 Server 存储需单独记录实际证据，不能以 fake 通过替代。

## 9. 已确认决策与执行边界

| 事项 | 2026-10-25 用户决定 | 实施约束 |
| --- | --- | --- |
| 历史 | 不管旧数据，上线开始计数 | 不自动回填；持久记录采集起点，重启升级不清零 |
| 累计 Token | 不减少、不消失 | 删除 / 回滚 / 日志清理不级联删除，不过滤掉已删除关联的事实，不自动 TTL 淘汰 |
| 游玩时长 | 不做，避免增加监听和复杂度 | 不保留时长采集、heartbeat、租约与活动区间表；正式 UI 删除相关项 |
| 官方 AI Gateway | 原生可接的尽量全部接好，能返回 Token 就统计 | Chat / Profiled 两路同时覆盖；需要时补标准用量传递，缺失显示未报告，不猜测任意 output |

上述产品取舍已收束，不再作为重复审批节点。A → B → C 是实现顺序，不是允许最终交付时只完成 A 的理由。用户随后已授权业务实现。内部查询组织、标准 usage 传递细节及定向兼容修复由主 Agent 依据当前源码负责，不为普通工程选择重复提问。若实施中发现必须改变既有权限、扩展返回语义或其他超出本目标的公共行为，再以具体冲突升级讨论。

## 10. 实施结果与验证边界（2026-10-25）

已实现：

- `application-data/statistics/store.ts` 集中承载迁移、不可级联删除的调用事实、事务内用户发送事实及聚合查询；不回填旧数据、不设置事实 TTL。重启时将遗留进行中调用标为结果未知。
- Server 组合并注入 Chat / Profiled 两路 Gateway。标准 `onUsage / reportUsage` 传递 Token，不改变既有 Handler output。SDK 已返回用量但正文校验失败时仍保留计量；没有收到 usage 的取消/失败不猜测消耗。缓存/推理子项不重复加到总量。
- Narrative 接受输入与独立 Agent 接受用户消息处写发送事实，保持原事务原子性；重放、续跑、重试、普通导入路径不另加发送。
- `dashboard.usage / usageRequests / play / resources / storage / database` 通过现有认证和 tRPC 提供窄查询。调用事实按时间和 ID 游标分页，不返回正文、凭据或文件路径。调用记录不依赖短期日志。
- 资源库存覆盖角色、Lore 与条目、预设、扩展 Package/安装目标、Script、正则、提取器、媒体、故事与独立会话。文件快照按受管理根分类；SQLite 主文件和 sidecar 计实际逻辑字节，表/索引页及空闲页独立展示。
- 正式入口位于工作区「活动」的历史下方，点击打开通用 Dialog；移动端先关闭导航抽屉。概览、用量、游玩、资源、存储共五个视图，保留加载、错误、缺数和刷新；管理动作复用已有入口。Dev Preview 继续使用模拟数据。

采用较小的首版组织：没有另建 overview RPC、Runtime 统计管理器或通用指标协议。概览复用三类聚合查询；角色分组与当前故事摘要一次返回，客户端搜索/排序；调用事实分页。数据库直接列实际表及所属索引，不伪造不可准确归类的业务记录总数。存储扫描只在展开存储或在该视图刷新时运行，60 秒缓存并合并并发请求；不清理文件、不执行 checkpoint/VACUUM。

当前限制：Dashboard 内容沿用中文草稿文案，入口已接四语言；完整四语言内容、本地化服务端快照提示、超大角色集合的服务端分页尚未完成。管理入口可用但不自动定位所有具体资源/配置项。文件扫描不是原子快照，遇到链接、预算或 IO 问题明确显示不完整。已删除角色保留发送事实，但禁止跳转；已删除提供商保留用量及名称快照。

验证：7 个定向测试文件 44 项通过，覆盖真实 SQLite 迁移/重启、无历史回填、缺失/部分 Token、失败后已报告用量、总量不重复相加、调用事实分页、删除 Provider 后保留用量、Narrative 输入重放/普通写入隔离、资源 SQL 与受控目录重叠/符号链接/缓存；另有 Narrative/Swipe 回归文件通过。Data Engine、Application Data、AI Gateway、Runtime、Server、Client 的 TypeScript 项目构建通过，Client 生产打包通过（保留既有的大 chunk 提示）。真实模型网络请求、真实用户目录的完整扫描、浏览器交互与用户视觉验收不在这些证据之内。
