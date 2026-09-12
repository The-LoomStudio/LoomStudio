# 官方内容

本目录保存正式官方内容的作者源文件。Official 是维护来源，不是权限或自动启用资格。

- `starter/`：官方问答预设、知识 Settings 与不含模型凭据的 Agent 模板。
- `extensions/st-data-compat/`：ST 数据兼容源码，保留 `@loom-studio/sillytavern-importer` 包名。
- [`extensions/the-world/`](extensions/the-world/README.md)：The World 延期迁移骨架，含包内迁移讨论；当前无可执行模块或资源贡献。
- 接口测试扩展位于 `tests/fixtures/extensions/`，正式 Server 默认不扫描该目录。开发者通过已有 dev-link 或显式 `extensionRootDirectory` 加载。

## 当前可用流程

在仓库根目录运行 `pnpm official:pack`。输出 `.artifacts/official.starter-0.1.0.zip`，目标已存在时拒绝覆盖。也可以指定源目录和输出文件：

```sh
pnpm official:pack official/starter /tmp/official.starter-0.1.0.zip
```

Studio 的扩展工作台左侧提供「官方推荐」，选择基础内容后可确认安装、导出官方原始资源包，并选择已有模型创建 Agent。导出的是磁盘上的原始发行内容，不是用户修改过的作者资源；用户资源仍通过原有导出入口导出。

包内 `catalog.json` 保存包身份、版本、文件引用、Preset 对 Setting 的挂载和 Agent 模板。资源文件沿用 `loom.promptResource` Artifact；Agent 模板只含名称和 preset 引用，不保存 Provider、凭据或会话。目录/ZIP 中的源文件可由 Git 和外部编辑器维护，目前没有自动双向同步。

Server 默认从仓库根的 `official/starter` 读取内容。部署时须携带该目录，或通过 `CreateStudioServerOptions.officialContentDirectory` 指向解包后的目录；不能只复制 Server `dist` 并假定资源会存在。当前 ZIP 是交付产物，尚未提供 UI 中上传 ZIP 的安装入口。

## 数据边界

启动不会创建、恢复或重写官方预设/Setting，也不会补回它们的挂载。显式安装只创建缺失身份，保留用户已有内容与 tombstone；不会静默恢复删除。已有资源并不代表与最新发行内容相同，UI 的「已有资源」不是版本一致性证明。

安装是一个正式 Application 事务，非法 Artifact/挂载不能留下部分资源。首次创建的官方预设只挂载包内可用知识 Setting，不自动建立全局知识挂载；创建的 Tool 挂载默认关闭。

## 发布边界

基础内容版本由 `starter/catalog.json` 管理；ST 扩展保留自己的版本。当前同仓维护，但不要求与主应用同版本发布。

尚未完成远程发布/安装：GitHub/NPM 发布主体、可信版本索引和首个来源仍待确定。内容摘要用于确认用户选中的包没有变化，不是独立签名或来源认证。

ST 转换代码只由 Extension Host 加载，Server 不再静态依赖该包。导入入口通过现有 RPC 调用当前启用实例；需先启用 ST 的 server 模块，停用/卸载后不能再转换 ST 格式，重载后使用新实例。原生 Loom 格式不依赖该扩展。这里仍绑定已知转换 RPC 协议，不是通用转换器发现系统；Server 扩展仍为可信同进程代码，不是安全沙箱。远程安装与已有资源显式替换仍属后续工作。

ST 导入的头像只保留图像/动画数据，不保留 PNG 文本块或尾部载荷；世界书只生成一份 Prompt Resource，不再同时复制到旧 settingLayer，也不再创建完整源卡 JSON 附件。未转换的 ST 私有字段不会通过这种原始备份随 Loom 卡分发。已有卡的历史源卡附件不会自动删除或解绑。
