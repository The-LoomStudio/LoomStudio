# Search and Timeline Indexing Plan

> **状态**：Asset Search Implemented in Frontend / Timeline Search Planned
> **日期**：2026-08-07
> **边界（2026-09-12）**：资产前端搜索与 Narrative Store 分页已存在；Timeline 搜索、命中窗口与索引仍是延期方向。后续复用 Timeline / Branch / Node 合同，不恢复旧 Session / NarrativeEntry Document 链。

## 1. 决策摘要

搜索按数据规模与加载边界分为两层：

1. 当前角色卡或 Preset 的 Prompt Resource 使用已加载节点进行前端搜索；不把早期样本约 800 个节点当作正式容量上限；
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

当前 [Narrative Store](../../../packages/narrative-store/src/store.ts) 的 `getPage` 已支持 `timelineId`、可选 `branchId`、`cursor` 与 `limit`，沿 Branch parent chain 分页并检查 cursor 是否属于该路径。[Narrative Runtime](../../../packages/application-runtime/src/runtime/narrative-runtime.ts) 通过 `getNarrativePage` 转发这一合同。不能再把 Document 全量读取描述为当前数据层实现。

分页存在不等于搜索、以命中 Node 为中心的窗口或前端虚拟化已经完成；这些仍需单独设计和验证。

长会话还会放大以下成本：

- RPC 与 JSON 序列化体积；
- 浏览器内存中的正文、Markdown AST 与语法高亮节点；
- 上千个消息 DOM 的布局成本；
- 每次查询扫描数百万字的延迟与临时字符串分配。

## 4. 后续 Timeline API

复用已有 `getNarrativePage`，后续只补命中定位与搜索合同。以下是候选职责，不是已注册 RPC 名称或冻结 Schema：

```text
现有分页：getNarrativePage
  timelineId
  branchId
  cursor
  limit

候选命中窗口
  timelineId
  branchId
  nodeId
  before
  after

候选 Timeline 搜索
  timelineId
  branchId
  query
  filters
  cursor
  limit
```

建议首次进入会话只加载最新约 50 至 100 楼，具体数量须根据现有分页合同与 UI 负载确认。向上浏览时加载更早页面；点击搜索结果或导航刻度时，以目标 Node 为中心加载消息窗口。

搜索结果只返回消息 ID、楼层或路径位置、角色、时间、命中摘要和必要的定位信息，不返回完整会话正文。

## 5. 搜索投影

Narrative Node 由独立 Narrative Store 管理。后续可评估从该 Store 构建可重建的 SQLite FTS 派生投影，候选字段如下，尚未冻结表名或 Schema：

```text
narrative_node_search
- node_id
- timeline_id
- role
- content
- created_at
```

FTS 投影不是权威数据源。Narrative Store 保存 Node 事实；索引必须能从其权威数据重建，并处理分支路径与提交后的更新。

不得直接将 `content_json LIKE '%query%'` 作为长期方案。它无法稳定提供相关性、摘要、字段约束与可扩展性能。

## 6. Branch Path 约束

Fork 后的 Branch Path 可能包含由其他 Branch 创建的祖先 Node，因此 Timeline 搜索不能简单使用创建时 `branchId = ?` 过滤 Node。

实施前必须确定以下其中一种路径成员关系：

- 复用当前 Head 的 parent chain 语义，将路径成员与搜索命中相交；
- 建立可重建的 Branch Path 投影；
- 使用其他明确支持 Fork 祖先关系的索引结构。

在该合同确定前，不新增似是而非的 `application.searchTimeline`。

## 7. 前端依赖

后续搜索与窗口化接入时，消息容器需要核对并补齐：

- 窗口化或虚拟化渲染；
- 向上加载时保持视觉锚点；
- 围绕搜索结果加载并定位；
- 右侧 Conversation Navigator 表达未加载区间；
- 新消息与输入框动态安全区继续保持现有跟随规则。

## 8. 非目标

当前阶段不实施：

- 后端 Timeline 搜索；
- SQLite FTS Schema；
- 平行的 Timeline 分页 API；
- 跨角色卡全局搜索；
- 聊天消息虚拟化；
- 搜索索引后台维护任务。
