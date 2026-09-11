# 文件化角色包

Card 的作者文件、ZIP 包与 PNG 分发共用同一套编解码。SQLite 仍是应用的权威存储；目录和 ZIP 不是新的运行数据库。此次只实现 Card Bundle，不代表独立 Preset / Setting Bundle、通用 VFS 或 Dev Workspace 同步已经完成。

## 内容与容器

```text
Card 与关联领域资源
  -> CardBundleArtifact v4
  -> 可编辑文件集合
  -> .loomcard.zip（ZIP v2）
  -> 可选：ZIP Base64 写入 PNG 的 loom.bundle iTXt
```

新导出的 PNG 不把 ZIP 附加在 IEND 后，而是用未压缩 iTXt 保存 ZIP 的标准 Base64。ZIP 自身已经压缩。PNG 主图用于展示，完整头像和可选背景仍保存在 ZIP 中；非 PNG 头像暂以默认 PNG 作为外层封面，包内保留原图。PNG 和 ZIP 不各自定义一套角色数据。

继续读取旧 `loom` 压缩 iTXt JSON、ZIP v1 与 Polyglot PNG。现存 Polyglot 导出入口仍保留，但正常 PNG 导出使用新元数据载体。损坏的已识别 Loom 包直接报错，不尝试 ST 转换。没有 Loom 载荷的 PNG 才进入启用中的 ST 扩展转换 RPC；ST 扩展不需要适配新的 Loom 容器。

PNG 图像处理仍可能删除元数据；本协议不保证社交平台重编码后保留角色载荷。

## 文件布局

示例路径由导出器生成，名称前缀用于消除同名冲突，不是领域 ID：

```text
manifest.json
card.json
card/description.md
opening/0.md
preset/system.md
macros/card.json
macros/preset.json
prompts/0-世界书/
  index.json
  0-爱丽丝.md
state/
  index.json
  entity-types/0-character.json
  templates/0-vitals.json
  entities/0-alice.json
  component-mounts/0.json
transforms/
  rules/0-隐藏标签.json
  extractors/0-天气.json
scripts/0-demo.loom.js
extensions/<packageId>/<payloadId>/<fileName>
assets/avatar.png
assets/background.webp
```

- `manifest.json` 使用 `schema: "loom.cardBundle.zip.v2"`；`resources` 索引 Card 与领域文件，`media`、`scriptAttachments`、`extensionPayloads` 继续索引独立载荷。所有文件引用相对于包根目录。
- `resources.metadata` 保存 Artifact 版本、身份和包说明，不嵌入 Card 主体或正文树。
- `card.json` 的 `config` 保存名字、用户名字和其他 Card 配置；description、宏、preset system、opening 与旧 settingLayer 正文保存文件引用。
- 每个 Prompt 根拥有一个 `index.json`。节点的 `metadata` 保存原有 ID、kind、label、capabilities、orderList 等；`body` 为 Markdown 路径，`children` 数组保留树结构与顺序。普通条目直接生成 `<名称>.md`；真正的 module / folder / 非空子树才使用目录，其自有正文为 `_content.md`。空正文与缺失正文区分，虚拟节点不强制生成正文文件。旧 `body.md` 路径仍按索引读取。
- 旧 Card 内联 `settingLayer` 有独立内容时写入 `settings/<名称>.md`，不再生成 `settings/legacy`；与资源树同 ID、同正文时复用同一个 Markdown 文件，仍保留双方元数据，不静默修改已有数据库内容。
- `state/index.json` 的 `artifact` 保存 State Artifact 头，`contribution` 保存贡献 ID 及实体类型、模板、实体、挂载、绑定的有序文件引用。读取时恢复并验证完整 `loom.state` Artifact；索引文件本身不是可单独导入的 State Artifact。
- 有统一 State Contribution 时不重复导出旧 `stateTemplates` / `timelineStateBindings` 副本；旧 Card 只有这些字段时仍能单独分文件恢复。运行 State、Revision 与 Timeline 快照不导出。
- Card 自有 Rule / Extractor 保存为独立 JSON，只携带声明字段；不携带 owner、数据库 ID、时间戳、origin 或运行覆盖。导入时在同一业务事务中创建新记录并绑定新 Card，相同 orderIndex 的数组顺序保留。
- `.loom.js` 保留原始 UTF-8 源码，包括换行。导入的脚本 Mount 仍为关闭、空授权，不因文件存在就执行代码。

## 编辑与往返

下载文件名使用 `.loomcard.zip`，可用普通解压工具直接打开。编辑 Markdown、JSON 或脚本后，重新压缩包根下的文件，保证 `manifest.json` 位于 ZIP 根，再导入 Studio。导入接受 `.loomcard.zip`、普通 `.zip` 和旧 `.loomcard`。ZIP 工具生成的显式目录项与流式数据描述符受支持。已有 `/export.loomcard` HTTP 路径保留，下载文件名由 Content-Disposition 与 Client 统一使用新后缀。

移动或重命名文件时，要同步更新对应索引路径；不要为文件重命名改领域 ID。导入仍是现有的创建新 Card 操作，不是覆盖原 Card 的 Apply。Prompt 节点与已有数据发生冲突时继续使用既有导入重映射语义。

PNG 的 ZIP 提取与包装已在同一 Codec 提供；用户级解包/重打包命令、GUI 目录打开、Checkout / Diff / Apply 和文件监听属于后续 CLI / Dev Workspace，尚未提供。现阶段可直接从 Studio 导出 `.loomcard.zip` 来进行目录编辑。

## 校验与限制

ZIP 最多 4096 项，每个文件最多 64 MiB，压缩包与累计解压内容最多 128 MiB。输入按块解压，已知大小预检与实际解压计数同时生效。路径越界、重复路径、非空目录项、缺失引用、非法 UTF-8 / JSON、非法领域声明与超限内容会被拒绝。

PNG 外层上限包含 128 MiB ZIP 对应的 Base64 和 64 MiB 封面预算。导入与导出头像/背景时通用移除 PNG 的 tEXt/iTXt/zTXt 文本块与 IEND 后尾部，避免把原卡元数据当成图片再次装包；保留色彩与 APNG 动画块，不做有损转码。PNG 外层和完整 ZIP 内仍各含一份封面，大动画封面会因此明显增大；当前不使用外部封面引用协议。没有签名或远程来源认证合同。

ST 扩展导入时只将世界书写入 Prompt Resource，不再复制进内联 settingLayer，也不再把完整 ST JSON 生成 Portable Payload。包内 `extensions/` 仅来自 Card 的显式 Portable Payload 绑定，不会扫描或打包当前启用的全局扩展。旧导入产生的源卡附件仍是已有用户记录，不能由核心按 ST 特判删除；需通过正式 API 显式解绑，不能删除其他扩展的合法载荷。

文件解析与领域声明校验在进入应用导入前完成。资源、脚本和文本管线记录复用现有导入事务；媒体 Asset 创建仍先于领域事务，不宣称所有 Asset 与领域写入已具备跨存储原子性。

## 实现位置

- [Card Artifact 与导入导出](../../../packages/application-runtime/src/cards/workspace.ts)
- [Card 文件投影](../../../apps/studio-server/src/codecs/card-bundle-files.ts)
- [ZIP 容器](../../../apps/studio-server/src/codecs/card-bundle-zip.ts)
- [PNG 容器](../../../apps/studio-server/src/codecs/card-png.ts)
- [Server 接线](../../../apps/studio-server/src/main.ts)
