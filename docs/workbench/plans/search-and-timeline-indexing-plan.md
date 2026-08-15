# Search and Timeline Indexing Plan

> **状态**：Asset Search Implemented in Frontend / Timeline Search Planned
> **日期**：2026-08-07
> **边界**：记录资产搜索与长会话搜索的分层决策。本文的旧 `Session` / `NarrativeEntry Document` API 示例已经被 Narrative Store 数据层取代；后续 Timeline Search 必须基于新的 Timeline / Branch / Node 分页合同重新收束，不能照抄旧示例实施。

## 1. 决策摘要

搜索按数据规模与加载边界分为两层：

1. 当前角色卡或 Preset 的 Prompt Resource 已由 `application.listCardPromptResources` 整体加载到前端，通常不超过约 800 个节点，因此使用纯前端搜索；
2. 长会话可能超过 1000 楼和数百万字，不应为了搜索完整加载到浏览器，后续采用 Timeline 分页、后端搜索与消息窗口加载。

两层可以共享搜索框、结果摘要和跳转语义，但不强求共享执行器。

## 2. 当前资产搜索

当前资产搜索只扫描已加载的 Prompt Resource 节点，匹配：

- 名称；
- 目录路径；
- 正文；
- 简单元信息。

查询为空时展示原文件树；查询存在时展示扁平结果。搜索不得修改文件树展开状态、选中状态或持久化布局。点击结果沿用现有资产选择流程打开 Detail。

首版不引入 SQL、全文索引、Web Worker、第三方模糊搜索库或查询 DSL。高级筛选以后可基于现有扁平记录逐步增加 `kind`、`enabled` 与 `lifecycle` 条件。

## 3. 当前 Timeline 限制

当前 `application.getTimeline` 返回当前 Branch 的完整路径。`readBranchPath` 会先读取 NarrativeEntry 文档集合，再在 Application Runtime 中构造路径。该实现适合当前开发规模，但不适合作为千楼会话的长期读取与搜索边界。

长会话还会放大以下成本：

- RPC 与 JSON 序列化体积；
- 浏览器内存中的正文、Markdown AST 与语法高亮节点；
- 上千个消息 DOM 的布局成本；
- 每次查询扫描数百万字的延迟与临时字符串分配。

## 4. 后续 Timeline API

后续应先确定分页与定位合同，再实现搜索：

```text
application.getTimelinePage
  sessionId
  branchId
  cursor
  direction
  limit

application.getTimelineWindow
  sessionId
  branchId
  entryId
  before
  after

application.searchTimeline
  sessionId
  branchId
  query
  filters
  cursor
  limit
```

首次进入会话只加载最新约 50 至 100 楼。向上浏览时加载更早页面；点击搜索结果或导航刻度时，以目标 Entry 为中心加载消息窗口。

搜索结果只返回消息 ID、楼层或路径位置、角色、时间、命中摘要和必要的定位信息，不返回完整会话正文。

## 5. 搜索投影

NarrativeEntry 是独立 Document，后续适合建立可重建的 SQLite FTS 派生投影，例如：

```text
narrative_entry_search
- entry_id
- session_id
- role
- content
- created_at
```

FTS 投影不是权威数据源。Document Store 仍保存 NarrativeEntry 事实；搜索投影可以从现有文档重新构建。

不得直接将 `content_json LIKE '%query%'` 作为长期方案。它无法稳定提供相关性、摘要、字段约束与可扩展性能。

## 6. Branch Path 约束

Fork 后的 Branch Path 可能包含由其他 Branch 创建的祖先 Entry，因此 Timeline 搜索不能简单使用 `branchId = ?` 过滤 NarrativeEntry。

实施前必须确定以下其中一种路径成员关系：

- 查询时从当前 Head 构造 Entry ID 集合，再与搜索命中相交；
- 建立可重建的 Branch Path 投影；
- 使用其他明确支持 Fork 祖先关系的索引结构。

在该合同确定前，不新增似是而非的 `application.searchTimeline`。

## 7. 前端依赖

Timeline 分页落地时，消息容器需要同步支持：

- 窗口化或虚拟化渲染；
- 向上加载时保持视觉锚点；
- 围绕搜索结果加载并定位；
- 右侧 Conversation Navigator 表达未加载区间；
- 新消息与输入框动态安全区继续保持现有跟随规则。

## 8. 非目标

当前阶段不实施：

- 后端 Timeline 搜索；
- SQLite FTS Schema；
- Timeline 分页 RPC；
- 跨角色卡全局搜索；
- 聊天消息虚拟化；
- 搜索索引后台维护任务。
