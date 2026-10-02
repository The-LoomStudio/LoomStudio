# Navigation and Routing

Loom Studio 将应用内导航、资源身份和外部入口分开：导航负责去哪里，资源 URI 负责目标是谁，URL 负责从应用外进入。普通面板操作不再用 Path 替换 Timeline 上下文。

## 状态归属

### URL 与 URI

`/` 和 `/studio` 为统一入口。可分享的实体链接使用 `/studio?target=<编码后的 loom-resource URI>`，正文快照引用仍沿用原有带版本、行范围的引用查看器，不伪装成编辑目标。

现有显式 `/studio/chat/...`、资源和 Panel 路径仍可作为入口，接收后统一解析并 Replace 到 `/studio`。入口列表和 Panel 路径集中定义，不再维护互相遗漏的两份表。

### History State

浏览器 History State 保存当前位置，包括 Timeline、Branch、Panel、选中资源、显式节点和查看条件。面板切换与资源选择 Push 到同一个 `/studio` URL；返回/前进恢复该位置。关闭面板只清理面板定位，不清空当前 Timeline/Branch。

搜索输入和筛选 Replace 当前位置，不逐字创建历史。编辑正文、Hover、拖动尺寸、手风琴与普通滚动不进入导航历史，编辑撤销仍归编辑器负责。

### 工作区恢复

最后工作区位置按 API endpoint 保存在本地；不保存业务正文、凭据或待解析的外部目标。布局和编辑状态仍使用各自已有所有者。

优先级为：显式深链 > 当前标签页有效 History State > 上次持久化工作区 > 默认界面。基础数据就绪后再加载恢复目标；不存在的 Timeline/Branch 显示不可用，不切换到其他分支。启动恢复不是业务数据恢复，也不是浏览器历史的跨重启完整存档。

### Zustand

Zustand 保存 Panel 与目录宽高、文件树展开状态、当前 Asset、编辑器偏好和其他本机布局选择。普通目录节点点击保留局部编辑器选择；明确的资源选择与引用跳转进入导航。Panel Store 仅供布局读取当前 Panel 的单向投影，不再拥有独立历史栈。

## 定位示例

```text
普通启动：/studio
资源身份：loom-resource://entity?type=resource&id=<resource-id>
资源节点：loom-resource://entity?type=resource&id=<resource-id>&nodeId=<node-id>
剧情节点：loom-resource://entity?type=timeline&id=<timeline-id>&branchId=<branch-id>&nodeId=<node-id>
外部链接：/studio?target=<URLSearchParams 编码的资源 URI>
```

URI 按 ID 解析，不按名称或文件路径猜测替代对象。资源链接不会把资源内容传给其他实例，也不会绕过访问权限。Session 暂无直接定位入口；Provider 引用只打开模型管理，并不声称定位到具体行。

## History 规则

- 从 Chat 打开或切换 Panel、选择独立资源：同 URL Push；
- 普通 Asset 节点选择：局部状态；明确的节点引用通过导航定位；
- 外部 URI：解析后 Replace 入口，不留下临时解析页；
- 搜索和筛选：Replace；
- Hover Sidebar、拖动尺寸和展开目录：不写 History。

## 可引用资源

引用查看器由导航传入 URI 和回调，不自行修改地址栏。复制资源/消息链接生成统一入口 URL，不改变当前工作区。正文快照引用打开编辑器时转为明确资源位置，不把历史行号当成当前版本精确位置。

已访问的面板宿主关闭后隐藏，避免普通切换卸载编辑器；不等于所有面板都启动加载，也不等于隐藏组件不需要管理订阅与异步请求。

### 资源浏览与消费配置

角色列表点击只浏览角色包，不切换当前游玩角色；进入游玩是独立动作。包视图中的复杂 Settings / Preset 资源跳到对应专用面板，脚本与附件仍可在包内查看。外部单项资源通过现有临时打开逻辑按原 ID 编辑，未挂载不等于只读；打开不增加安装、挂载、复制或持久工作区成员。Header 返回恢复原查看位置，不另加“回原视图”按钮。

Agent Preset 配置详情以 Settings、正则 / 提取器、工具三个子 Tab 展示来源 FileTree，复用搜索、折叠和图标开关。点击 Settings 或规则行打开定义编辑，开关修改的是预设消费配置，不是原定义的全局启用。启用资源图标高亮、停用行弱化；目录不提供 Settings 上下移按钮，但不改变现有保存顺序合同。

当前角色绑定的 Settings 分组置顶，资源用星号标记。`useCardSettings` 草稿开启时标记“随角色默认采用”，由角色世界书总开关控制，不为显示状态创建额外 Mount；关闭后仍可显式采用。这个状态不表示关键词或 Activation 已触发。工具保留按行展开说明；Anchor / Session / Narrative 的复杂内容放在 Detail，而非目录内实时铺开，静态声明与运行检查结果分开。

## 托管要求

Studio 使用 Browser Router。开发服务器和正式桌面宿主必须将未知 `/studio/*` 路径回退到客户端 `index.html`，再由前端 Router 完成匹配。未匹配的应用路由保留原 URL 并显示统一 404 状态页，由用户明确返回聊天。
