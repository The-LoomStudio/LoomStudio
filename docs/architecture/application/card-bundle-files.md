# 文件化角色包

Card 的作者文件、ZIP 包与 PNG 分发共用同一套编解码。SQLite 仍是应用的权威存储；目录和 ZIP 不是新的运行数据库。此次只实现 Card Bundle，不代表独立 Preset / Lore Bundle、通用 VFS 或 Dev Workspace 同步已经完成。

Card Bundle 可携带 `extensionPackages` 中的 Extension Package 归档，与扩展 Portable Payload 分开索引。导入归档不会自动激活其中代码。角色安装的 Client 文件通过带 Card ID、包版本及归档 SHA-256 的私有 URL 提供，读取时校验该 Card 当前安装归档，不以同名全局包回退。安装记录、资源导入、模块启用和授权是分开的生命周期操作。

v4 的可选 `contextAssetSettings` 按 `contextAssets` 根节点 ID 保存资源显示元数据（含可选包图标引用）、宏、宏选项、两个 Lore 开关、历史策略与文本使用配置，文件投影与 ZIP 会保留这些配置。图标仍引用包内文件，不把图像字节嵌入资源设置。旧 v4 未携带该字段时沿用原默认值；机器本地模型绑定和授权策略不随该字段传播。重复导入发生节点 ID 冲突时，导入集合内的隐式 virtual 锚点引用同步重写，显式公共锚名保持不变。

## 全局 Framework 引用

Card v4 的 `card.extensionDependencies` 可声明 `{id, version, target: "global"}`；导入及目录 Apply 校验全局安装与版本，不下载、不自动启用模块。`card.defaultPreset` 使用 `{packageId, contributionId, target: "global"}`，要求对应 dependency，在新建故事时解析并绑定主 Session 的实际 Agent Preset，已有 Session 不变。引用的知识/预设不作为 `contextAssets` 再复制。

扩展目录导入写入 `card.catalogSource: {packageId, characterId, version, digest}`，用于列出用户已添加的角色；角色改名不改变来源，重复导入需明确选择。模板更新不覆盖用户角色，删除角色后可再次导入。头像仍沿用 Card Bundle 媒体物化流程。

## 内容与容器

```text
Card 与关联领域资源
  -> CardBundleArtifact v4
  -> 可编辑文件集合
  -> .loomcard.zip（ZIP v2）
  -> 可选：ZIP Base64 写入 PNG 的 loom.bundle iTXt
```

新导出的 PNG 不把 ZIP 附加在 IEND 后，而是用未压缩 iTXt 保存 ZIP 的标准 Base64。ZIP 自身已经压缩。PNG 主图用于展示，完整头像和可选背景仍保存在 ZIP 中；非 PNG 头像暂以默认 PNG 作为外层封面，包内保留原图。PNG 和 ZIP 不各自定义一套角色数据。

PNG 导入只读取当前 `loom.bundle` Base64 iTXt 中的 ZIP v2 载荷，以及仍支持的 Polyglot PNG；旧压缩 `loom` iTXt JSON 和 ZIP v1 不再读取。Polyglot 导出仍是当前支持的容器能力。损坏的已识别 Loom 包直接报错，不尝试 ST 转换；没有 Loom 载荷的 PNG 才进入启用中的 ST 扩展转换 RPC，ST 扩展不需要适配新的 Loom 容器。

PNG 图像处理仍可能删除元数据；本协议不保证社交平台重编码后保留角色载荷。

## 文件布局

示例路径由导出器生成，名称前缀用于消除同名冲突，不是领域 ID：

```text
manifest.json
card.json
card/description.md
opening/0.md
opening/alternatives/0.md
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
- `mediaTypes` 按媒体相对路径记录原 MIME。已知媒体使用对应后缀，未知 MIME 使用 `.bin` 而不是伪装成 PNG；未声明 MIME 的已有标准图片路径仍可按后缀读取。GIF、APNG、SVG 和视频等内部素材不改变 ZIP/PNG 外层协议，保存媒体不等于已提供播放器或允许执行内容。
- `resources.metadata` 保存 Artifact 版本、身份和包说明，不嵌入 Card 主体或正文树。
- `card.json` 的 `config` 保存名字、用户名字和其他 Card 配置；description、宏、preset system、opening 与旧 lore 正文保存文件引用。
- `opening` 与 `opening.alternatives[]` 各包含一个 `content` 正文，以及稳定的 `id` 和可选 `title`。默认正文存于 `opening/0.md`，备选正文存于 `opening/alternatives/<candidate>.md`；文件下标仅用于路径，不是运行时身份。写入归一化为缺失 ID 生成并保存标识，同卡显式重复 ID 被拒绝，读取不重生有效 ID。不支持旧 `entries` 或 `role` 格式；单字符串可作为创建简写。候选在创建 Timeline 及尚未锁定的初始化窗口内选择，不导出运行时 Swipe 状态。窗口合同见 [Narrative 数据生命周期](../data/README.md)。
- 每个 Prompt 根拥有一个 `index.json`。节点的 `metadata` 保存原有 ID、kind、label、capabilities、orderList 等；`body` 为 Markdown 路径，`children` 数组保留树结构与顺序。普通条目直接生成 `<名称>.md`；真正的 module / folder / 非空子树才使用目录，其自有正文为 `_content.md`。空正文与缺失正文区分，虚拟节点不强制生成正文文件。旧 `body.md` 路径仍按索引读取。
- 旧 Card 内联 `lore` 有独立内容时写入 `lore/<名称>.md`，不再生成 `lore/legacy`；与资源树同 ID、同正文时复用同一个 Markdown 文件，仍保留双方元数据，不静默修改已有数据库内容。
- `state/index.json` 的 `artifact` 保存 State Artifact 头，`contribution` 保存贡献 ID 及实体类型、模板、实体、挂载、绑定的有序文件引用。读取时恢复并验证完整 `loom.state` Artifact；索引文件本身不是可单独导入的 State Artifact。
- 有统一 State Contribution 时不重复导出旧 `stateTemplates` / `timelineStateBindings` 副本；旧 Card 只有这些字段时仍能单独分文件恢复。运行 State、Revision 与 Timeline 快照不导出。
- Card 自有 Rule / Extractor 保存为独立 JSON，只携带声明字段；不携带 owner、数据库 ID、时间戳、origin 或运行覆盖。导入时在同一业务事务中创建新记录并绑定新 Card，相同 orderIndex 的数组顺序保留。
- `.loom.js` 保留原始 UTF-8 源码，包括换行。导入的脚本 Mount 仍为关闭、空授权，不因文件存在就执行代码。
- Card Bundle 附带的扩展程序归档写入独立 `extension-packages/` 条目；Portable Payload 只承载扩展私有数据，不承载可执行扩展包。

## 编辑与往返

`artifactId` 是作品的公共身份，持久化在 Card Source 并由 Card 查询、列表和导出返回；本地 `cardId` 仅标识当前工作区中的记录。同一包再次导入会创建新的本地 Card，但保留 `artifactId`，因此作品 ID 不具有本地唯一性。普通编辑和目录 Apply 不改变作品身份。

角色面板的“派生为新作品”通过 `application.forkCard` 检查源 Card 版本，再复用导出/导入链路创建新 Card、新 `artifactId` 和 `derivedFrom.artifactId`。它不修改原卡、不复制 Timeline 运行数据，也不承诺所有资源获得独立身份；资源沿用现有导入规则。派生来源随目录、ZIP、PNG 往返，不能指向自己的作品 ID。这些字段不是作者认证，首版不提供签名或身份注册中心。派生与普通导入一样暂不接入界面撤销历史。

本轮开发不迁移此前缺少源 `artifactId` 的开发数据库记录；此类记录导出明确报错，不使用本地 `cardId` 伪造公共身份。

下载文件名使用 `.loomcard.zip`，可用普通解压工具直接打开。编辑 Markdown、JSON 或脚本后，重新压缩包根下的文件，保证 `manifest.json` 位于 ZIP 根，再导入 Studio。导入接受 `.loomcard.zip`、普通 `.zip` 和旧 `.loomcard`。ZIP 工具生成的显式目录项与流式数据描述符受支持。已有 `/export.loomcard` HTTP 路径保留，下载文件名由 Content-Disposition 与 Client 统一使用新后缀。

移动或重命名文件时，要同步更新对应索引路径；不要为文件重命名改领域 ID。导入仍是现有的创建新 Card 操作，不是覆盖原 Card 的 Apply。Prompt 节点与已有数据发生冲突时继续使用既有导入重映射语义。

PNG 的 ZIP 提取与包装已在同一 Codec 提供。Card Directory 已提供保存、差异预览及 `directories.previewApply` / `directories.apply`，通过 baseline token、领域版本检查与恢复日志显式更新原 Card；这不同于导入 ZIP 创建新 Card。通用用户级解包/重打包命令、GUI 目录打开、Checkout 和文件监听仍属于后续 CLI / Dev Workspace。目录 Apply 不承诺 IDE 全程锁或断电原子性。

## 校验与限制

ZIP 最多 4096 项，每个文件最多 64 MiB，压缩包与累计解压内容最多 128 MiB。输入按块解压，已知大小预检与实际解压计数同时生效。路径越界、重复路径、非空目录项、缺失引用、非法 UTF-8 / JSON、非法领域声明与超限内容会被拒绝。

fflate 继续负责解压；单独的完整性元数据读取核对中央目录、本地头或数据描述符中的 CRC，Node 原生 CRC32 对实际解压数据增量计算。同长度正文损坏、CRC 不一致和不完整中央目录会在领域导入前失败；合法存储、deflate、流式数据描述符和预算内 ZIP64 仍可读取。CRC 只检测损坏，不构成签名、可信来源或恶意篡改认证。

目录导出按媒体声明读取原始素材；目录 HTTP 预览仍限制为经过签名检查的栅格图片，不因 MIME 往返修复放开 SVG/视频内容执行。APNG 是 PNG 图像字节路径，不进行转码；动画视觉效果仍需客户端验收。

PNG 外层上限包含 128 MiB ZIP 对应的 Base64 和 64 MiB 封面预算。导入与导出头像/背景时通用移除 PNG 的 tEXt/iTXt/zTXt 文本块与 IEND 后尾部，避免把原卡元数据当成图片再次装包；保留色彩与 APNG 动画块，不做有损转码。PNG 外层和完整 ZIP 内仍各含一份封面，大动画封面会因此明显增大；当前不使用外部封面引用协议。没有签名或远程来源认证合同。

ST 扩展导入时只将世界书写入 Prompt Resource，不再复制进内联 lore，也不再把完整 ST JSON 生成 Portable Payload。包内 `extensions/` 仅来自 Card 的显式 Portable Payload 绑定，不会扫描或打包当前启用的全局扩展。旧导入产生的源卡附件仍是已有用户记录，不能由核心按 ST 特判删除；需通过正式 API 显式解绑，不能删除其他扩展的合法载荷。

文件解析与领域声明校验在进入应用导入前完成。资源、脚本和文本管线记录复用现有导入事务；媒体 Asset 创建仍先于领域事务，不宣称所有 Asset 与领域写入已具备跨存储原子性。

单独导出的 Prompt Resource 是白名单 Artifact，允许携带可选的包图标引用，但不递归携带图标文件、脚本、规则、模型绑定、工具实现或关联 Lore。旧 Artifact reader 仍接受历史附件字段，但旧附件迁移为 Extension Package 或并列资源的完整、无损转换流程尚未完成。

## 实现位置

- [Card Artifact 与导入导出](../../../packages/application-runtime/src/cards/card-bundle.ts)
- [Card 文件投影](../../../apps/studio-server/src/codecs/card-bundle-files.ts)
- [ZIP 容器](../../../apps/studio-server/src/codecs/card-bundle-zip.ts)
- [ZIP 完整性元数据](../../../apps/studio-server/src/codecs/zip-checksums.ts)
- [PNG 容器](../../../apps/studio-server/src/codecs/card-png.ts)
- [Server 接线](../../../apps/studio-server/src/main.ts)
- [角色扩展安装与私有文件路由](../../../apps/studio-server/src/extensions/extension-manager.ts)


远程下载的原生 Card 另有 `resourceDownloads.previewCardUpdate/applyCardUpdate` 路径，执行包与 SQL 的一次性比较。内部导入映射维护作者节点、脚本 metadataId 与归档身份；它不是逐项审阅历史。该路径可更新文字资源、可证明归属的脚本／载荷／内嵌扩展归档和媒体，保留玩家选择及挂载设置；新声明不自动授权，归档不自动安装。State 和缺乏稳定源身份的旧规则仍拒绝隐式覆盖。合同与范围见[资源下载服务](../../../apps/studio-server/src/resource-downloads/README.md)。
