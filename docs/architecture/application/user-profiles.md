# 全局用户资料与背景集合

用户资料是配置，不是剧情 State，也不是 Lore 资源。DocumentStore 的单例 `user-profiles:global`（类型 `airp.userProfiles`）保存 `profiles` 和可空的 `currentProfileId`；每份资料包含 ID、名称、描述与可选 `avatarAssetId`。版本来自 Document，所有写操作携带 `expectedVersion`，在 Data Engine 事务中通过 CAS 保存。

## 生命周期

- 首次读取返回空列表、空选择、版本 0；创建同时选中，新选择影响所有故事，没有 Timeline / Branch / Session 绑定。
- 无当前选择或名称空白时显示 `User`；无选择时描述为空。当前资料缺失属于错误，不偷偷替换为其他资料。
- 编辑失焦保存；选择、创建、删除之前提交草稿。保存失败保留内容与旧版本，阻止后续切换，不自动重试覆盖；用户可重试或明确放弃草稿刷新。
- 删除当前资料须在界面确认名称，删除后清空选择；其他资料仍可手动选择。删除非当前资料不改变当前选择。
- 新构建读取当前配置并冻结到宏快照。已保存的开场/正文及已开始 Run 的消息保持原样；Narrative 与 Agent 的用户消息头使用当前名称、头像，不存历史头像快照。
- Query 缓存按 endpoint 区分；窗口重新聚焦、返回页面时重新读取。没有跨客户端实时推送。

## 宏与兼容

`{{User}}` / `{{user}}` 和 `{{user.description}}` 分别对应 `computed.user.name` / `computed.user.description`。普通 Agent、宏检查和开场共用配置解析；isolated Agent 与扩展直接构建保持现有隔离上下文的默认值。头像只用于 UI，不隐式发送给 Provider。

Card.userName 保留为作者字段，退出玩家名称回退；旧 Timeline 的 fallbackUserName 不再参与解析。旧 Global / Timeline State 原文不迁移、不删除；显式 `{{global.user.*}}` / `{{timeline.user.*}}` 仍可读取。旧的无前缀 `{{user.description}}` 现在明确读取配置描述。

默认模板在工具说明与常驻资料之间加入 system 用户块：普通描述 Entry 后接 `@user.context`，供作者已采用的 Lore 补充故事身份。仅新建预设使用更新模板，已有预设不会被重写。

## 媒体与 UI

“我的”页面采用头像、名称 Hero 和“设定 / 资源”子 Tab，多份资料共用原有资源工作台。头像复用 Asset / Blob：先上传，再通过配置 CAS 保存引用；写引用失败保留可重试草稿。服务端要求存在且为支持的光栅图片，客户端上传沿用 PNG / JPEG / WebP / GIF 与 64 MiB 限制。

替换、移除头像与删除资料只解除引用，不删除底层 Asset / Blob，不引入垃圾回收。资料不自动包含在角色或 Timeline 归档中；完整备份须同时保留应用数据库和媒体。独立资料导入导出尚未提供。

## 全局背景集合

用户背景目录独立保存在 `user-backgrounds:global`（类型 `airp.userBackgrounds`），不是某份用户资料的子字段，也不是 Timeline State。条目只保存名称与 Media Asset 引用，写入携带读取时的版本；添加前由 Runtime 校验媒体存在及其支持的图片类型。移除条目只更新目录引用，不删除底层媒体。

此目录提供可选背景素材，不自动决定当前界面的背景选择、主题或扩展运行状态。配置形状与操作入口从 [Runtime README](../../../packages/application-runtime/README.md#源码导航)的 Profiles 路由进入；当前实现分别位于 [profiles/user-backgrounds.ts](../../../packages/application-runtime/src/profiles/user-backgrounds.ts) 和 [user-backgrounds-runtime.ts](../../../packages/application-runtime/src/runtime/user-backgrounds-runtime.ts)。资料与背景均依赖 Document 的版本提交和共享 Data Engine；媒体字节仍归 Asset / Blob。

## 验证

`tests/integration/application-runtime/user-profiles.test.ts` 验证 CRUD、CAS、数据库重开和媒体失败原子性；`default-preset.test.ts` 的用户配置用例验证跨故事切换、真实 Runtime 到测试 Gateway 的宏/锚点顺序、旧正文与隔离调用。`tests/unit/client/user-profiles.test.ts` 验证保存失败、请求中继续编辑和上传后引用失败重试。不替代真实浏览器、真实 Provider 与人工 UI 验收。
