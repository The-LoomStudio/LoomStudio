# Navigation and Routing

Loom Studio 使用 URL 表达可恢复、可分享且适合浏览器前进后退的导航状态。Router 是导航事实来源；Zustand 继续保存本机 UI 偏好，两者不得维护同一份事实。

## 状态归属

### Path

Path 保存页面与实体身份：

- 当前工作区 Panel；
- Character Gallery 与 Character Profile；
- Card、Session、Branch 与 Asset 标识；
- Logs、Debug、Models 与 Settings 页面。

### Query Parameters

Query 保存可分享的查看条件，例如搜索词 `q`、资源筛选以及后续 Diff 或 Revision 查看参数。

搜索从空变为非空时创建一个 History Entry；后续逐字输入使用 Replace。这样返回一次即可退出整次搜索，不会逐字回退。

### Hash

Hash 只用于消息、Agent 执行节点或文档内部锚点，例如 `#entry-<id>`。它不保存业务正文，也不表示当前滚动位置。

锚点是显式定位协议：复制节点链接、点击对话刻度、从搜索结果或日志跳转时可以写入；普通滚动、自动回底、虚拟列表更新和流式输出不得修改 URL。渲染层只依赖统一节点 ID，不根据剧情消息、Agent 步骤或工具调用类型建立不同路由。

### History State

History State 保存无需分享、但应由返回关闭的临时导航层级，例如移动端抽屉或模态页。Hover 状态不得进入 History。

### Zustand

Zustand 保存 Panel 与目录宽高、文件树展开状态、编辑器偏好和其他本机布局选择。输入草稿、API Key、长正文和秘密信息不得写入 URL。

## 路由表

```text
/studio/chat
/studio/chat/:sessionId
/studio/chat/:sessionId/branch/:branchId

/studio/characters
/studio/characters/:cardId

/studio/resources/:cardId?
/studio/resources/:cardId/:assetId

/studio/presets/:cardId?
/studio/presets/:cardId/:assetId

/studio/models
/studio/debug
/studio/logs
/studio/settings
```

工作区在桌面端可以表现为 Chat 上方的浮动 Panel，在移动端可以表现为全屏页面，但二者使用同一路由和返回语义。

## History 规则

- 从 Chat 打开 Panel：Push；
- 从目录进入第一个 Detail：Push；
- 已在 Detail 中切换其他资产：Replace；
- Gallery 进入 Character Profile：Push；
- 搜索首次产生查询：Push；
- 修改现有查询、筛选或 Tab：Replace；
- Hover Sidebar、拖动尺寸和展开目录：不写 History。

## 可引用资源

URL 同时是用户与 Agent 共用的资源引用格式。Agent 报告修改结果时应返回已有的 canonical URL，而不是再定义一套前端定位对象：

```text
/studio/resources/<cardId>/<assetId>
/studio/presets/<cardId>/<assetId>
/studio/characters/<cardId>
/studio/chat/<sessionId>/branch/<branchId>#entry-<entryId>
```

复制链接不要求先改变当前 URL。收到带 Entry Hash 的地址后，聊天容器在对应 Timeline 加载完成时执行一次定位；此后滚动仍由容器自身管理。

Session 路径中的 Branch 不存在时规范化到该 Session 的 active branch；Session 本身不存在或无法加载时回退到 `/studio/chat`，并通过既有错误状态保留失败原因。

明确 URL 始终优先于持久化布局。应用不得通过 URL 与 Zustand 双向同步同一导航字段。

## 托管要求

Studio 使用 Browser Router。开发服务器和正式桌面宿主必须将未知 `/studio/*` 路径回退到客户端 `index.html`，再由前端 Router 完成匹配。未知应用路由规范化到 `/studio/chat`。
