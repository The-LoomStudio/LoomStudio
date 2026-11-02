# 用户模板、故事玩家资料与背景集合

“我的”中的用户资料是可复用模板。DocumentStore 的单例 `user-profiles:global`（类型 `airp.userProfiles`）保存 `profiles` 和可空的 `currentProfileId`；每份模板包含 ID、名称、描述与可选 `avatarAssetId`。版本来自 Document，所有写操作携带 `expectedVersion`，在 Data Engine 事务中通过 CAS 保存。

新建 Timeline 把启动窗口最终确认的资料复制到 Timeline State。固定 Entity 为 `{ typeId: 'loom-player', entityId: 'User' }`，集合路径为 `$loom.players`，资料组件为 `loom_profile`，完整路径是 `$loom.players.User.components.loom_profile`；组件保存 `name`、`description` 和可选 `avatarAssetId`。声明、Schema 与 State 值进入既有 Runtime Context / Revision 链，不另建用户运行态存储。

## 生命周期

- 首次读取返回空列表、空选择、版本 0；创建模板同时选中。全局选择用于新故事的默认模板、无故事 Agent 和作者预览。
- 无当前选择或名称空白时显示 `User`；无选择时描述为空。当前资料缺失属于错误，不偷偷替换为其他资料。
- 编辑失焦保存；选择、创建、删除之前提交草稿。保存失败保留内容与旧版本，阻止后续切换，不自动重试覆盖；用户可重试或明确放弃草稿刷新。
- 删除当前资料须在界面确认名称，删除后清空选择；其他资料仍可手动选择。删除非当前资料不改变当前选择。
- 启动窗口选择模板只填充本次名称、描述和头像草稿，也可选择空白身份；编辑不回写模板。确认时先建立玩家 State，再展开开场和初始化 Lore，随后执行扩展初始化。直接 Runtime 调用未提供资料时，复制调用时的全局当前模板。
- 已建立副本的故事不跟随模板切换、修改或删除。运行态 State 面板可以编辑名称、描述；修改走 State Mutation、版本校验与 Branch Head，分支、撤销及恢复沿用 State 规则，不重新展开已保存正文或改写已开始 Run 的消息。
- 故事内宏构建、宏检查与消息头读取目标 Branch 的玩家资料；无故事 Agent 使用全局模板。客户端按 endpoint / Timeline / Branch / State 修订读取，State 保存、分支更新和窗口重新聚焦时刷新；模板查询仍按 endpoint 区分。

## 宏与兼容

`{{User}}` / `{{user}}` 和 `{{user.description}}` 分别对应 `computed.user.name` / `computed.user.description`。有内置玩家声明的故事从 State 派生这些值；无故事调用使用全局模板。isolated Agent 与扩展直接构建保持现有隔离上下文的默认值。头像用于 UI，不通过这两个宏隐式发送给 Provider；显式读取完整 State 的工具仍可读到资源引用。

Card.userName 保留为作者字段，不参与玩家名称回退；旧 Timeline 的 fallbackUserName 也不参与解析。没有内置玩家声明的旧 Timeline 保持全局模板语义，本轮不迁移或回填历史 State。显式 `{{global.user.*}}` / `{{timeline.user.*}}` 仍可读取原路径；无前缀的用户宏按上述上下文解析。新故事的内置组件丢失或损坏会明确报错，不回退全局模板。

内置 Entity Type、Entity、资料模板 ID 和资料组件路径由应用声明。Card / State Artifact 的校验允许作者引用内置玩家，作者可精确挂载或按该类型挂载自己的组件，也可另建主角实体；应用不按名称合并实体，不在两个模型间同步字段。重复声明内置实体、占用应用集合、覆盖资料组件或其父对象会被拒绝。Card 导出只带作者声明及引用，不夹带玩家资料值。

默认模板在工具说明与常驻资料之间加入 system 用户块：普通描述 Entry 后接 `@user.context`，供作者已采用的 Lore 补充故事身份。仅新建预设使用更新模板，已有预设不会被重写。

## 媒体与 UI

“我的”页面采用头像、名称 Hero 和“设定 / 资源”子 Tab，多份资料共用原有资源工作台。头像复用 Asset / Blob：先上传，再通过配置 CAS 保存引用；写引用失败保留可重试草稿。服务端要求存在且为支持的光栅图片，客户端上传沿用 PNG / JPEG / WebP / GIF 与 64 MiB 限制。

当前世界线已有玩家资料副本时，“我的”提供“查看当前故事资料”入口，保留当前 Timeline / Branch 并打开运行态变量，定位描述字段、展开祖先及长文本编辑框。模板草稿先按原有保存流程提交，失败时留在原页。无当前故事或仍使用全局模板的旧故事不显示此入口；跳转本身不修改故事 State。

替换、移除头像与删除模板只解除引用，不删除底层 Asset / Blob，不引入垃圾回收。新故事复制头像 Asset ID；模板后续换头像不会改变已有副本。角色包不携带玩家资料；新故事的 Timeline 归档携带 State 资料值及 Runtime Context，导入恢复声明与 Schema。头像媒体字节不因此进入归档，完整备份仍须保留媒体。独立模板导入导出尚未提供。

## 全局背景集合

用户背景目录独立保存在 `user-backgrounds:global`（类型 `airp.userBackgrounds`），不是某份用户资料的子字段，也不是 Timeline State。条目只保存名称与 Media Asset 引用，写入携带读取时的版本；添加前由 Runtime 校验媒体存在及其支持的图片类型。移除条目只更新目录引用，不删除底层媒体。

此目录提供可选背景素材，不自动决定当前界面的背景选择、主题或扩展运行状态。配置形状与操作入口从 [Runtime README](../../../packages/application-runtime/README.md#源码导航)的 Profiles 路由进入；当前实现分别位于 [profiles/user-backgrounds.ts](../../../packages/application-runtime/src/profiles/user-backgrounds.ts) 和 [user-backgrounds-runtime.ts](../../../packages/application-runtime/src/runtime/user-backgrounds-runtime.ts)。资料与背景均依赖 Document 的版本提交和共享 Data Engine；媒体字节仍归 Asset / Blob。

## 验证

`tests/integration/application-runtime/user-profiles.test.ts` 验证模板 CRUD、CAS、数据库重开和媒体失败原子性；`default-preset.test.ts` 验证故事副本、State 编辑后的真实 Runtime 到测试 Gateway 消费、分支隔离与撤销、Timeline 归档往返、旧故事、作者组件引用及角色包往返。`tests/unit/client/new-story-extensions.test.ts` 验证启动草稿与取消无写入；`state-panel-source.test.ts` 验证只读内置候选和作者保存边界；`user-profiles.test.ts` 验证模板保存失败及上传重试。不替代真实浏览器、真实 Provider 与人工 UI 验收。
