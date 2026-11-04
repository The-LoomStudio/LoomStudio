# 官方内容

本目录保存正式官方内容的作者源文件。Official 是维护来源，不是权限或自动启用资格。

- `extensions/loom-assistant/`：本地维护的助手预设、角色与表情资源，已从主仓库停止追踪；独立仓库：[LS_Nom_Assistant](https://github.com/The-LoomStudio/LS_Nom_Assistant)。运行诺姆专属集成测试前需克隆仓库到此本地目录，主仓库不携带其图片。
- ST 数据兼容、The World 等具有独立发布周期的扩展，在根目录 `extensions/` 安装和开发，不纳入主仓库跟踪；本地开发副本由 `.gitignore` 排除。
- `official/extensions/` 只保留随主程序发行的轻量官方内容。“官方”表示维护来源，不决定独立扩展的安装目录。
- 接口测试扩展位于 `tests/fixtures/extensions/`，正式 Server 默认不扫描该目录。开发者通过已有 dev-link 或显式 `extensionRootDirectory` 加载。

## 内容来源与安装

诺姆助手通过 `extensions/loom-assistant/` 扩展提供预设与知识。作者目录、构建与安装说明见 [诺姆助手](extensions/loom-assistant/NOM-ASSISTANT.md)。其他官方内容沿用各自扩展 manifest 和安装流程。

旧 `official.starter` 已退出产品目录、默认启动安装与发行包；历史样本仅保留在 `tests/fixtures/legacy-official-starter/` 验证兼容行为。Server 不再自动创建或恢复旧助手和知识。用户数据库中的旧资源及其来源标识、引用保持不变，可以通过普通删除确认流程移除，不自动替换为诺姆扩展的资源。

旧 catalog 服务只在显式配置 `officialContentDirectory` 时提供手动导入／导出，默认列表为空且不会在启动时安装。`pnpm official:pack` 仅作为旧格式工具，必须提供显式目录，没有默认 starter 内容。

Official 是维护来源，不是只读、自动启用或自动授权资格。资源更新和删除继续保留原有确认及引用边界，不借此次退役覆盖用户编辑。

ST 导入的头像只保留图像/动画数据，不保留 PNG 文本块或尾部载荷；世界书只生成一份 Prompt Resource，不再同时复制到旧 lore，也不再创建完整源卡 JSON 附件。未转换的 ST 私有字段不会通过这种原始备份随 Loom 卡分发。已有卡的历史源卡附件不会自动删除或解绑。

官方背景仓库：[LS_Background](https://github.com/The-LoomStudio/LS_Background)。两个包均可从官方可选安装列表安装，也可在扩展安装页使用仓库 URL。主仓库不携带图片；本地开发可将各仓库克隆至对应的 `official/extensions/` 子目录。
