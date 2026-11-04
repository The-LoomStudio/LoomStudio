# 全局资源搜索

全局搜索是 Studio Application 的跨资源查询模块，组合前端静态导航与后端定义资源检索。入口位于工作区左上角，支持 `⌘K / Ctrl+K`。它只负责查找和打开目标，不应用预设、挂载资源、安装扩展或触发生成。

## 搜索边界

| 对象 | 检索内容 |
| --- | --- |
| 页面与面板 | 前端 i18n 标题、别名和关键词；旧 Preset 入口归一化到 Agent 面板 |
| Card | 名称和作者描述 |
| Lore / Preset | 已保存节点自身的 label、meta、body |
| Timeline / Agent Session | 名称级入口 |

运行时剧情正文、对话记录、Agent 工作记录、变量、State、日志、扩展源码和附件内容不进入本模块。定义文本不执行宏、模板或 PromptBuild；未保存草稿不进入持久索引。局部编辑器搜索和 Agent 输入框命令由各自功能负责。

世界书名称、角色名称和祖先路径不能使后代节点继承命中。路径仅用于说明位置；容器自身仍可因自己的名称或内容匹配而成为结果。

## 职责与源码入口

| 层 | 职责与入口 |
| --- | --- |
| Shared | [查询 Schema 与结果身份](../../../packages/shared/src/global-search.ts)，不包含前端 Panel ID |
| Application Data | [节点检索与目录浏览](../../../packages/application-data/src/prompt-resource/search.ts)、[索引迁移](../../../packages/application-data/src/prompt-resource/schema.ts)，SQL 由领域 Store 持有 |
| Application Runtime | [search-runtime.ts](../../../packages/application-runtime/src/runtime/search-runtime.ts)：资源可用性、范围关系、排序和跨类型分页 |
| Server | [search.ts](../../../apps/studio-server/src/rpc/trpc/application/search.ts)：typed tRPC 参数校验和转发 |
| Client feature | [global-search/model](../../../apps/studio-client/src/features/global-search/model/)：查询、Token、缓存和持久状态 |
| Client widget / App | [弹窗](../../../apps/studio-client/src/widgets/global-search/global-search-dialog.tsx)负责呈现；[App](../../../apps/studio-client/src/app/app.tsx)组合当前上下文和既有导航 |
| 通用 UI | `loom-ui` 导出 cmdk `CommandMenu` 原语；[匹配工具](../../../apps/studio-client/src/shared/lib/search-match.ts)和[文本高亮](../../../apps/studio-client/src/shared/ui/search-highlight.tsx)由 Client shared 提供 |

```text
输入关键词 / 范围 / 类型
  ├─ Client 静态导航匹配
  └─ typed RPC → Runtime 范围解析 → Store 查询 / 索引
                                  ↓
                       有界结果、来源、目标身份、游标
                                  ↓
                       弹窗 → 既有导航 → 节点定位
```

RPC 为 `application.searchResources` 和 `application.listGlobalSearchScopes`。资源查询接收 `query / scope / kind / limit / cursor`，以及用于浏览排序的当前 Card / Preset 上下文。范围候选同样接收当前上下文。返回稳定目标身份、名称、路径、必要摘要和分页游标，不返回整份资源树或全量正文。来源返回安装与角色的结构化字段，由 Client i18n 生成文案。

## 范围与资源关系

普通输入表示查找内容；`in:` 或范围按钮选择归属，`type:` 或类型按钮选择类别。一个归属范围与一个类型取交集，Token 保存稳定 ID。失效范围明确报错，不静默扩大查询；范围与类型不匹配时返回空集合。

| 范围 | 集合定义 |
| --- | --- |
| 世界书 | 指定 Lore 资源的节点 |
| 角色卡 | 携带和直接静态关联的定义资源，以及携带预设明确引用的 Lore |
| 扩展 | 同一 packageId 在全局和各角色安装来源中的可用定义资源 |

角色携带预设 A，A 引用 Lore B 时，A、B 均纳入；仅外部关联 A 时不继续展开 B，除非 B 自身另有携带或直接关联关系。不做无限递归引用展开，不随 Timeline 临时挂载或运行 lease 改变集合。

扩展资源保留 installationId、resourceId 和所属角色身份，同名资源不合并。安装目录与资源 origin 决定发现可用性；搜索不会激活扩展或取得运行时参与权限。范围过滤发生在排序、截断和分页之前。

## 空关键词浏览与排序

| 条件 | 行为 |
| --- | --- |
| 无范围、无类型、无关键词 | 常用导航及本次应用会话内从搜索打开的最近 8 项，不请求资源 RPC |
| 角色或扩展范围，无关键词 | 每份定义资源展示一个根入口 |
| 世界书范围，无关键词 | 按目录顺序分页展示条目和路径，排除 module / folder / slot 容器，不读取正文 |
| 仅类型，无关键词 | 展示对应资源或名称级入口 |
| 有关键词 | 导航匹配与资源检索；指定范围或类型时不混入全局导航 |

资源根入口按当前启用优先，其余按名称和稳定身份排序。启用集合来自当前角色资源（遵守预设 `useCardLore`）、当前预设、预设 Lore 声明及全局手动采用，只影响顺序。范围候选按当前角色、已启用世界书、其他候选排序，组内按匹配度和身份排序。

关键词检索中，名称精确匹配优先于名称包含、元信息和正文。Runtime 稳定归并目录标题与节点结果，分别保留续页边界，不把未消费摘要塞进游标。游标绑定查询、筛选及相关资源集合；空关键词浏览和范围排序还绑定当前上下文与采用集合。

## 索引与一致性

当前 Prompt Resource schema 在 `application.prompt-resource@9` 的最终 DDL 中建立 FTS5 trigram 和 `label / meta / body` 三列；节点及 Header 变化通过触发器维护索引。此前 v7→v8 的字段与索引调整属于历史 schema 演进，不代表当前 Store 会升级 v7 数据库；namespace 版本不匹配时拒绝打开。

节点增删改及资源类别变化由 SQL 触发器随领域事务维护索引。整树替换、恢复和 Changeset revert 沿相同写入路径；事务回滚不发布部分索引。资源墓碑由查询排除，展示路径沿当前树关系计算。

至少三个 Unicode 字符的词使用字面引用的 MATCH 缩小候选；一到两个字符的中文短词在允许范围内使用转义 LIKE，多词取 AND。无原生分词扩展。查询上限 256 字符、16 个去重词，每页最多 100 项；节点摘要最多 180 个 Unicode 字符。短词扫描已有合成一万节点探针，不能据此承诺真实大库延迟。

Timeline 使用轻量标题目录，避免普通列表加载正文预览；Session 读取名称目录。Card 当前仍通过 DocumentStore 分页读取文档，仅名称与描述参与匹配。

## 状态、缓存与打开结果

关键词、范围和类型由 Zustand persist / safeLocalStorage 按 endpoint 保存。候选输入、候选模式和弹窗开关不随刷新恢复；最近访问只存在本次应用会话。持久状态不保存搜索结果正文。

TanStack Query 按 endpoint、查询、筛选和当前上下文隔离结果，输入防抖 150ms。搜索 `staleTime` 为 0，重新打开时刷新；资源保存、目录及 Lore 挂载变更使搜索缓存失效。旧查询响应不能替换新查询，追加分页不改变仍有效的键盘选中身份。

cmdk 关闭内置过滤和排序，防止正文命中被标题过滤掉。错误与无结果分别呈现；输入法确认不触发打开，候选模式 Escape 返回结果。弹窗固定高度并按小屏视口收缩，结果内部滚动，开合动画尊重减少动态效果偏好。

打开节点前按 ID 刷新资源缓存并确认节点存在，保留编辑草稿，随后调用既有导航。匹配正文时定位并高亮，不写入文档或编辑撤销历史。目录仅高亮自身名称，不因全局关键词过滤或自动展开；刷新后详情高亮可由关键词和当前节点路由重建。

入口胶囊显示当前关键词，清空时同步移除目录与详情高亮，保留范围与类型。共享 SearchReveal 请求身份包含编号和关键词，清空后允许再次定位；CodeMirror 清理时只移除自己拥有的查询，避免覆盖用户另建的局部查询。

## 验证与历史

Store 测试覆盖搜索、中文、目录分页与事务内索引维护；Runtime 测试覆盖携带 / 关联边界、扩展多安装、范围与排序；Client 定向测试覆盖 Token、缓存、键盘 / IME、持久恢复和高亮生命周期。真实大型资源库性能不属于这些测试的证明范围。

实现过程和各轮检查记录保留于[已归档计划](../../archive/plans/global-resource-search-plan.md)。导航状态合同见[Navigation and Routing](../ui/navigation-and-routing.md)。
