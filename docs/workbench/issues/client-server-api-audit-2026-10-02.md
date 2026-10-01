# 前后端 API/IPC 对接设计专题审查

日期：2026-10-02
状态：审查完成 / 4 项优化候选，未实施
基线：当前未提交工作树，沿用[专题计划](../plans/specialized-audits-2026-10-02-plan.md)

## 结论

本轮确认 **4 项有实际消费者与成本证据的优化候选，没有新增确认 Bug**。主要问题不是缺少业务能力，而是读取范围、响应范围和事件失效范围不匹配。

| 编号 | 前端实际需要 | 当前实际供给/成本 | 建议顺序 |
| --- | --- | --- | --- |
| API-001 | 当前已加载 K 条消息的 Display 结果 | 全部 N 条历史读取、投影、响应 | 优先核对输出子集合同 |
| API-002 | 某资源的引用 Card 摘要与相关 Mount | 全 Card 正文、全 Mount、目标资源完整树 | 先复用 Mount 过滤，再决定 Card 定向查询 |
| API-003 | 当前 Card 的规则及绑定 State 定义 | 全局完整规则/定义，Client 本地过滤 | 增加 owner/IDs 子集能力 |
| API-004 | 与当前 Timeline 相关的 Session Header 变化 | 任意 Session 变更都触发当前集合全分页刷新 | 先保留已有 Scope，定向更新 |

这里的“优先”是优化顺序，不把 API 设计代价套成正确性严重度。新增参数/结果语义属于提案，未授权修改公共契约。

## 当前传输边界

Studio Client 使用 typed `shared/api/studio-api.ts` → ClientBridge → HTTP JSON-RPC `/rpc`；数据通知通过 SSE `/extensions/events`。扩展 iframe 使用独立 MessagePort 合同。没有因用户统称 IPC 就假设存在桌面原生 IPC 桥。

ClientBridge 是传输 adapter，不应塞入业务列表筛选；正确的子集边界应由 typed API、RPC 与领域查询共同拥有。范围过滤的作用是减少无关读取，不要求把所有请求改成相同 DTO 或建立万能查询系统。

## API-001 · 显示投影接口只有全历史返回

**调用链**：[use-display-projection.ts](../../../apps/studio-client/src/features/message-content/model/use-display-projection.ts)（71 行）收到当前已加载节点的 ID/text → `textTransforms.project` → `application.projectHistory` → [transforms-runtime.ts](../../../packages/application-runtime/src/runtime/transforms-runtime.ts) 的 `readRuntimeHistoryEntries`（500 行附近）收集 Store 所有页面 → 完整 HistoryProjectionSnapshot。

Client 的 Query key 已包含当前输入节点；RPC 却只携带 source/phase/consumer，不支持目标节点/返回窗口。响应包含全部消息 text、originalText、depth 和规则结果；增加已加载页会再次请求完整投影。这里的 K 是 Client 已加载数据数量，不是可见 DOM 行数。

**本轮规模探针**：当前 Runtime 与真实共享内存 SQLite；每节点约 1,000 字符。

| 总历史 | Store 页读取 | 投影 JSON 字节 |
| --- | --- | --- |
| 20 节点 | 1 页 | 46,549 |
| 220 节点 | 3 页 | 510,753 |

220 节点样本中，Narrative 首页只有 100 节点。字节是 Runtime DTO 的 JSON，不包含 HTTP 信封，不是耗时/heap 指标。

**反证**：规则 depth/position 依赖完整历史，不能把输入裁成局部后重新编号；客户端也会检查 originalText 与当前正文一致。现有 [display-projection.test.ts](../../../tests/unit/client/display-projection.test.ts) 保护匹配与失效语义，不保护响应规模。

**最小方向**：首先支持指定返回子集，保持全历史规则语义；不要把“响应变小”冒充“后端已无需读取全历史”。随后再按证据评估固定 Head、深度元数据或缓存。

**关闭条件与风险**：N 增加但 K 不变时，响应量随 K 而非 N 增长；结果与原完整投影一致，包含规则边界、编辑替换与 originalText 校验。固定 Head/快照一致性需明确；未验证浏览器或真实网络。

## API-002 · 单资源引用查询扫描全部 Card 正文

**调用链**：[resource-bindings.tsx](../../../apps/studio-client/src/features/context-assets/ui/prompt-resource-toolbar/resource-bindings.tsx)（21 行）展开引用 → `promptResources.getBindings` → `application.getPromptResourceBindings` → [prompt-runtime.ts](../../../packages/application-runtime/src/runtime/prompt-runtime.ts)（83 行）读取完整目标资源、全 Card Documents、全部 Setting Mount → 本地筛选 → id/name 与相关 Mount DTO。

**本轮规模探针**：20/220 个 Card，仅一个通过正式 `updateCardPromptResources` 绑定目标资源。

| Card 总数 | Document 页读取 | 解码 Card JSON 字节 | 最终引用 DTO 字节 |
| --- | --- | --- | --- |
| 20 | 1 | 30,097 | 130 |
| 220 | 3 | 330,819 | 130 |

首次夹具未建立实际绑定，已修正后才记录上述数字，不把夹具失误计作产品缺陷。

**已有能力与反证**：[Prompt Resource Store](../../../packages/application-data/src/prompt-resource/types.ts) 已有 `listSettingMounts({settingResourceId})`；当前调用却不传过滤条件。Card 绑定关系仍在 Document JSON 中，不能凭此假设已经有反向关系索引。目标资源读取可能承担存活检查，但不因此需要完整正文树。

**最小方向**：Mount 分支先复用现有过滤；Card 分支另行选择定向 JSON 查询或关系索引，按真实规模决定，不先建立索引体系。

**关闭条件与风险**：不读取无关 Card 正文、不扫描无关 Mount，结果与当前引用语义一致；删除/失效引用和权限边界保留。新增索引会引入一致性维护，不能作为无需决策的顺手修复。

## API-003 · Card 目录下载全局规则和 State 定义后过滤

**调用链**：[card-resource-directory.tsx](../../../apps/studio-client/src/widgets/character-panel/card-resource-directory.tsx)（45 行）创建按 Card 区分的 Query → `textTransforms.listRules()` / `states.listDefinitions()` → [transforms-runtime.ts](../../../packages/application-runtime/src/runtime/transforms-runtime.ts)（89 行）/[state-runtime.ts](../../../packages/application-runtime/src/runtime/state-runtime.ts)（54 行）全分页 Document 读取 → Client filter。

实际筛选是 `owner.kind === 'card' && owner.cardId === cardId`，以及 `id ∈ card.stateDefinitionIds`。完整响应却包括无关 Card 的 matcher/effect/schema/initial。按 Card 区分的 Query key 还可能各自缓存相同全局集合。

**成本证据**：当前调用与筛选表达式静态确认，传输和解码随全局规则 R/定义 D 增长；未做本项规模探针，不给虚构的节省比例。

**反证**：当前 Card 编辑确实需要完整的相关对象；全局工作台或全局搜索需要全集合，不纳入此候选。已有脚本 list 按 owner 读取，说明目录不是天然需要所有领域全量对象。

**最小方向**：定义规则 owner 与 State IDs 子集合同；只在实际收益成立时拆摘要/详情。不要机械改成每个 ID 一个请求，造成 K 次 N+1。

**关闭条件与风险**：增加无关规则/定义时，本 Card 的读取和响应量不增长；编辑所需字段、失效引用提示和顺序完整。IDs/owner 空值含义、分页和跨 Card 隔离需同步 typed API 与 Runtime，未授权实施。

## API-004 · Session 通知丢弃已有 Scope，触发全列表重读

**调用链**：Transcript append → [Agent Store](../../../packages/application-data/src/agent/store.ts) 的 agent.session operation（164 行）→ Kernel data.changed/SSE → [data-commit-events.ts](../../../apps/studio-client/src/shared/api/data-commit-events.ts)（22 行）只保留 entityType/entityId → [use-narrative-runtime.ts](../../../apps/studio-client/src/features/narrative-runtime/model/use-narrative-runtime.ts)（222 行）任意 agent.session 变更触发当前 Session 集合全分页刷新。

Kernel 的 [handlers.ts](../../../packages/kernel/src/handlers.ts)（516 行）已经保留 Scope 等元数据，typed API 也已有 `agentSessions.get`。前端丢掉了可用于归属判断的信息，因此其他 Timeline 的 Run 提交也会重读当前列表。

**成本模型**：Q 次相关类型提交、当前集合 S 项，列表请求量可达约 `Q × ceil(S/100)`；这是由调用链推导的量级，不是实测吞吐。请求代际守卫阻止旧结果发布，但不取消已发出的读取。

**反证**：创建/删除和断线重连仍需集合同步；只做定向 get 不能覆盖这些语义。现有 [data-commit-events.test.ts](../../../tests/unit/client/data-commit-events.test.ts) 验证解析/重连，不验证跨 Scope 请求量。

**最小方向**：保留已有 Scope/操作类型，相关更新定向 get，创建/删除处理集合，重连继续完整同步。不要把 Commit Fact 当作 Run 完成通知，不增加正文领域事件。

**关闭条件与风险**：其他 Timeline 的提交不触发当前列表读取；当前更新、创建/删除、重连与缺失 Scope 的正式处理保持正确。字段保留可先局部完成，事件消费策略需定向回归；未动态验证真实 SSE 请求量。

## 去重、覆盖与验证

完整定向追链覆盖上述四项。另核对 Card summary/detail、Provider/Preset 分页与 mutation、Prompt Resource/Mount 缓存、Run subscribe/Transcript、Bridge/HTTP 取消及 iframe MessagePort 合同，但不宣称所有 API 家族穷尽审查。

没有新增计数：完整编辑树和真实全局搜索；旧全仓 O-001 的终态全 Transcript 重读；当前 OCT-003/005/006/007 正确性问题。Card/Preset mutation 已返回实体，不能将客户端所有全刷新都归因于响应粒度不足。

Bridge 丢失 RPC error code、typed API 大部分未暴露取消参数仅记录为协议观察；尚未证明具体业务失败，未升级成新 Bug。目录文件、Extension 私有 RPC、资产二进制路由和所有 mutation 家族没有穷尽追踪。

本轮执行两类真实内存 SQLite 规模探针，未写文件、未运行测试/build/全套门禁/浏览器。主 Agent 核对投影参数、全历史收集、引用查询与已有过滤参数、Card 目录筛选及事件 Scope 丢弃接缝，未重跑可信探针。真实 HTTP 字节/耗时、堆峰值与浏览器行为未验收；内存留存的独立候选见[内存专题](./memory-retention-audit-2026-10-02.md)。
