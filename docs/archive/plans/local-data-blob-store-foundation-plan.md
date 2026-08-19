# 本地数据路径与 Blob Store 基建实施计划

> **状态**：Implemented  
> **日期**：2026-08-15  
> **完成日期**：2026-08-15  
> **范围**：统一 Loom Studio 在用户电脑上的本地数据路径，建立 SQLite 与内容寻址 Blob Store 的持久化边界，并让日志、Extension、导入导出、媒体资产、缓存与备份消费同一套路径合同。  
> **非目标**：本计划不实现多用户 Profile、云同步、Marketplace、在线更新、Asset GC、自动缩略图管线、外部文件实时同步、Branch 资源 Overlay 或完整备份产品。

相关文档：

- [`sqlite-data-engine-domain-stores-kernel-plan.md`](sqlite-data-engine-domain-stores-kernel-plan.md)
- [`card-resource-manifest-migration-plan.md`](card-resource-manifest-migration-plan.md)
- [`agent-session-narrative-timeline-data-layer-plan.md`](agent-session-narrative-timeline-data-layer-plan.md)
- [`../discussion/studio-config-and-local-state-v0.md`](../discussion/studio-config-and-local-state-v0.md)
- [`../discussion/application/asset-import-export-boundary-v0.md`](../discussion/application/asset-import-export-boundary-v0.md)
- [`../adr/ADR-003-asset-store-and-binary-payload-boundary.md`](../adr/ADR-003-asset-store-and-binary-payload-boundary.md)
- [`extension-package-module-foundation-plan.md`](extension-package-module-foundation-plan.md)

---

## 0. 本轮收束决定

Loom Studio 不采用 SillyTavern 式按 `characters/`、`chats/`、`worlds/`、`presets/` 建立运行时权威文件夹的模型，也不把用户数据放在应用源码或安装目录中。

目标持久化由两条权威链组成：

```text
SQLite
  可查询、可修改、需要关系索引或事务语义的结构化数据

Blob Store
  原始且不可变的文件字节，包括 JSON、PNG、音频、视频和导入包
```

判断标准不是“文本还是二进制”，而是：

```text
需要被系统理解、查询、关联、修改
  -> SQLite

需要 byte-perfect 保留、流式读取或按内容去重
  -> Blob Store
```

因此原始 `preset.json`、Worldbook JSON 和 Card PNG 都可以进入 Blob Store；Importer 解析出的 Card、Prompt Resource、Preset 与 Import Bundle 进入 SQLite。原始文件不是 PromptBuild 的实时输入，也不因用户直接修改内部 Blob 而自动生效。

同时确认：

1. 资源在逻辑和 SQL 层保持平铺，使用稳定 ID 引用；
2. Card 是启动、加载、导入和分发包，不是运行时资源目录；
3. Narrative Timeline 是游玩运行根，Branch 是世界线正文 head，并在后续变量阶段承载分支状态和可变资源版本；
4. 当前实现仍把 `promptResourceIds` 保存于 Timeline，Branch 只保存 Narrative head 与 fork 来源；本计划不提前实现 Branch Resource Overlay；
5. 自动生成的 Thumbnail 默认是可删除缓存；作者提供的独立封面或裁切图是正式 Asset；
6. Extension 通过稳定 `assetId` 共享正式媒体，不通过绝对路径或跨 Package 目录互写。

---

## 1. 当前实现事实与失配

### 1.1 当前路径分裂

Studio Server 当前存在三套默认路径：

```text
SQLite:
  .loomstudio-dev/document-store.sqlite

Extension state / installed:
  .loomstudio-dev/extensions/

JSONL logs:
  LOOM_STUDIO_DATA_DIR 或 ~/.loomstudio/logs/
```

这些路径分别由 `apps/studio-server/src/main.ts` 的不同代码片段决定，没有共享路径合同。后续 Asset Store、备份或 Extension 安装如果继续自行拼接路径，会形成更多不一致。

### 1.2 当前数据形态

当前已经实现：

- 单个共享 SQLite Data Engine；
- Document Store 专用表；
- Narrative Timeline / Branch / Node 专用表；
- Agent Session / Message / Tool Call 索引专用表；
- JSONL 运行日志；
- Extension repository、dev link、installed directory 与 JSON state file。

当前尚未实现：

- 通用本地路径解析器；
- Blob Store；
- 原始 Card PNG、Preset JSON、Worldbook JSON 的 byte-perfect 保存；
- Asset Record 与 Blob 的稳定映射；
- `ctx.assets` Extension capability；
- 一致性备份、Blob GC 和自动 Thumbnail。

### 1.3 旧目录模型已经过时

早期文档曾使用：

```text
.loomstudio-dev/projects/<project-id>/workspace.db
```

该结构建立于 Project / Workspace 承担物理隔离边界的阶段。当前数据模型已经收束为：

```text
一个本地 SQLite
  -> 平铺 Resource Documents
  -> Narrative Timelines / Branches / Nodes
  -> Agent Sessions / Messages
```

Workspace、Card、Timeline 和 Branch 都是 SQL 中的逻辑对象，不映射为独立实体目录。首版不增加 per-project、per-card 或 per-timeline 数据库。

---

## 2. 目标本地路径合同

### 2.1 逻辑路径对象

核心包不得读取环境变量、用户目录或当前工作目录。Studio Server 组合根负责解析并注入：

```ts
type LoomStudioLocalPaths = {
  dataRoot: string
  databaseFile: string
  blobRoot: string
  extensionRoot: string
  extensionInstalledRoot: string
  extensionStateFile: string
  extensionDevLinksFile: string
  configRoot: string
  backupRoot: string
  cacheRoot: string
  extensionCacheRoot: string
  logRoot: string
}
```

字段只表达当前有明确消费者的路径。不要增加每种业务资源的目录字段，也不要把 `LocalPaths` 变成包含 Kernel、Store 或配置对象的上帝对象。

### 2.2 正式应用默认路径

正式应用使用操作系统原生用户数据目录，与应用安装目录和源码目录解耦。

```text
macOS data:
  ~/Library/Application Support/LoomStudio/

macOS cache:
  ~/Library/Caches/LoomStudio/

macOS logs:
  ~/Library/Logs/LoomStudio/
```

Linux 与 Windows 实施时使用对应 XDG / Local App Data 目录，不自行发明全平台统一的 `~/.loomstudio` 默认路径。路径解析使用 Node 标准库和少量显式平台分支；首版不为此增加第三方依赖。

### 2.3 开发、测试与便携覆盖

只保留一个统一覆盖入口：

```text
LOOM_STUDIO_HOME=<absolute-or-resolved-path>
```

设置后映射为：

```text
<LOOM_STUDIO_HOME>/
├── data/
├── cache/
└── logs/
```

开发脚本将其设置为仓库根部 `.loomstudio-dev`。测试直接注入临时 `LoomStudioLocalPaths`，不依赖真实 Home，也不读取开发数据库。

当前只用于日志的 `LOOM_STUDIO_DATA_DIR` 在路径基建实施时删除，不保留两个同义环境变量。项目尚未发布正式稳定版，不为开发测试路径增加兼容迁移层。

### 2.4 目标目录

```text
dataRoot/
├── studio.sqlite
├── blobs/
│   ├── sha256/
│   │   └── ab/cd/<full-hash>
│   └── staging/
├── extensions/
│   ├── installed/
│   ├── state.json
│   └── dev-links.json        # 仅开发模式使用
├── config/
└── backups/

cacheRoot/
├── thumbnails/
├── temporary/
└── extensions/<package-id>/

logRoot/
└── *.jsonl
```

内部 Blob 使用 hash 寻址，不使用用户提供的文件名作为物理路径。原文件名、MIME、来源格式和展示名保存在 SQL metadata 中。

用户主动执行“导出”时选择目标目录，例如 Downloads 或作者工作区；导出文件不默认回写内部 Blob Store，也不要求用户进入 Application Support 手工管理文件。

---

## 3. SQLite、Blob、Artifact 与 Asset 边界

### 3.1 Blob

Blob 是不可变字节对象，只回答：

```text
这些字节是什么 hash？
大小是多少？
物理存储键是什么？
```

Blob 不知道 Card、Preset、Timeline、Extension 或 UI Collection。完全相同的字节只保存一次。

最小写入流程：

```text
输入 stream / bytes
  -> 写 staging file，同时计算 SHA-256 和 size
  -> 校验大小与格式边界
  -> hash 已存在则复用
  -> 原子 rename 到最终 storage key
  -> 提交 SQL metadata / domain reference
```

文件先成功落盘，再提交 SQL 引用。失败可能留下无引用 Blob，但不能留下指向缺失文件的已提交记录。首版清理 staging 临时文件；无引用 Blob 的 mark-and-sweep 延后到真实 GC 阶段。

### 3.2 Source Artifact

Source Artifact 表示一次外部输入的原始文件：

```text
card.png
preset.json
worldbook.json
loompack.zip
extension package archive
```

外部导入默认保留原始字节，并记录：

```text
artifactId
blobId
format
originalFileName
importedAt
importerVersion
```

Importer 解析 Artifact 后，在同一次业务导入中创建平铺的 Card、Prompt Resource、Preset、Transform Rule、Asset metadata 与 Import Bundle。运行时读取 SQL canonical state，不反复解析原文件。

同格式导出时可以读取原始 Artifact，保留未知字段，并用当前 SQL canonical state 覆盖已知字段。不同格式导出只依赖 canonical state，不承诺保留目标格式无法表达的未知字段。

### 3.3 Media Asset

Asset 是对 Blob 的业务语义引用，例如：

```text
Card avatar
Card cover
Narrative attachment
generated image
audio track
background image
```

Asset metadata 至少需要稳定 `assetId`、`blobId`、MIME、size、可选 dimensions、创建来源与时间。Blob 可以被多个 Asset 引用；结构化 Resource 默认仍使用独立 Document ID，不因为 JSON 内容相同而自动合并。

### 3.4 Thumbnail

首版不实现自动 Thumbnail pipeline。UI 先直接使用原始 Card 图片并由浏览器缩放。

出现可复现的列表传输、解码或内存问题后，才增加可重建 Thumbnail Cache：

```text
assetId + transform version + target size
  -> cache key
  -> generated thumbnail bytes
```

自动 Thumbnail 不进入权威 Blob 引用和备份。作者显式提供的独立封面、裁切图或像素图不是缓存，按正式 Asset 保存。

---

## 4. 平铺资源、Card 与 Narrative 运行链

### 4.1 导入与编辑

```text
Card Package / Source Artifact
  -> 原始文件写 Blob Store
  -> Importer normalize
  -> SQLite 创建平铺 Resources 与 Card Manifest
  -> Import Bundle 记录来源、成员和推荐关系
```

Card 可以携带多个 Setting Layer、Preset、Transform Rule 和媒体，但导入后这些对象不进入 Card 物理目录，也不被 Card 强拥有。Card 只保存启动建议、资源引用、媒体引用和 Import Bundle provenance。

开发编辑直接修改 SQLite canonical Resource。原始 Artifact 保持不变；Reset / Re-import 是显式操作，Export 从当前 canonical state 生成新 Artifact。

### 4.2 Timeline 与 Branch

当前已实现：

```text
Narrative Timeline
  createdFromCardId / cardVersion
  promptResourceIds
  activeBranchId

Narrative Branch
  timelineId
  headNodeId
  parentBranchId
  forkedFromNodeId
```

因此当前资源链接在 Timeline，Branch 只隔离 Narrative head。后续变量与运行时 Resource 修改出现后，目标再扩展为：

```text
Branch
  -> state head / checkpoint
  -> mutable resource revision refs
  -> narrative head
```

本计划只保证本地存储布局不会妨碍这个演进，不在 Blob Store 基建中提前创建 Branch Overlay、Diff、Snapshot 或 Event Sourcing。

---

## 5. Extension 文件与 Asset 共享边界

### 5.1 Package 安装位置

正式安装的 Extension Package 解包到：

```text
dataRoot/extensions/installed/<package-id>/<version>/
```

安装目录保存 Manifest、编译代码和 Package 静态资源。它不是插件的持久业务数据目录，也不允许 sibling Package 写入。

Extension 的数据按性质分流：

```text
Package-owned typed user data
  -> Host Document capability -> studio.sqlite

可删除索引和中间产物
  -> cacheRoot/extensions/<package-id>/

正式发布给平台的媒体
  -> Asset capability -> Blob Store + Asset metadata
```

### 5.2 Extension Asset capability 目标

Blob Store 基座完成后，为 Server Host 增加窄能力，而不是暴露文件系统根目录：

```text
ctx.assets.publish(...)
  -> 返回 assetId

ctx.assets.read(assetId)
  -> 返回受控 bytes

ctx.assets.materialize(assetId)
  -> 返回当前 Instance scratch 中的临时路径
```

首版边界：

- Extension 不能获得 Blob Store 根路径；
- Extension 不能向其他 Package 安装目录或 scratch 目录写入；
- Extension 默认不能枚举全部 Asset；
- 调用方只消费参数、可读 Document 或受控 RPC 明确交给它的 `assetId`；
- Event payload 只广播 `assetId` 和小型 metadata，不广播字节；
- 需要实体路径的外部工具由 Host 在当前 Package scratch 中临时 materialize；
- 中间结果留在 private scratch，只有显式 publish 才进入正式 Asset Store。

具体 capability grant 名称、Client Asset API 和跨 Package Asset 授权不在路径阶段提前冻结；实现 `ctx.assets` 前单独完成权限合同评审。

---

## 6. 备份、恢复与删除边界

### 6.1 权威备份集合

未来备份至少覆盖：

```text
studio.sqlite 的一致性快照
被权威记录引用的 Blob
Extension desired state / grants
必要的非秘密 config
```

默认不覆盖：

```text
logs
cache / thumbnails
temporary / staging
dev-links
Extension scratch
```

运行中的 SQLite 不能通过普通文件复制承诺一致性。备份实现必须使用 SQLite Backup API、`VACUUM INTO` 或停机快照，再根据数据库中的 Blob 引用生成 manifest。

### 6.2 删除与 GC

删除 Card、Timeline、Asset Record 或 Import Bundle 时不立即物理删除 Blob。相同 Blob 可能被其他 Asset、Artifact、Extension 或备份引用。

Blob GC 必须等待以下能力稳定后再实施：

- 权威引用扫描；
- backup retention；
- import/export provenance；
- Extension Asset ownership；
- 恢复失败诊断。

当前阶段只清理超时 staging 文件，不实现通用引用计数或 mark-and-sweep。

---

## 7. 分阶段实施

### Phase 1：Local Paths 基座

**状态：Completed**

目标：消除各模块独立硬编码路径。

任务：

1. 在 Studio Server 相邻基础设施中实现 `resolveLoomStudioLocalPaths()`；
2. 支持 OS-native 默认路径和 `LOOM_STUDIO_HOME` 覆盖；
3. 开发脚本显式指向 `.loomstudio-dev`；
4. SQLite、Logging 与 Extension Manager 改为消费注入路径；
5. 测试全部注入临时目录；
6. 删除仅日志使用的 `LOOM_STUDIO_DATA_DIR`。

验证检查点：

- macOS 默认解析结果正确；
- `LOOM_STUDIO_HOME` 下 data/cache/logs 完全收拢；
- Server 启动不再在三个位置写数据；
- 测试不会接触真实用户目录；
- 不修改 Client 代码。

### Phase 2：Blob Store 最小内核

**状态：Completed**

目标：提供不可变内容寻址字节存储，不加入 Asset 业务语义。

任务：

1. 定义 Blob identity、metadata 与写入结果；
2. 使用 Node `fs`、`crypto`、stream 实现 staging、hash、去重和原子 rename；
3. 增加最小 SQL metadata / lookup；
4. 限制单次输入大小并清理失败 staging；
5. 提供按 `blobId` 读取 stream，不公开绝对物理路径。

验证检查点：

- 相同字节只保存一次；
- 并发写同一内容不会损坏文件；
- 写入失败不会提交悬空 SQL 引用；
- 重启后仍可按 ID 读取；
- 路径穿越和用户文件名不能影响最终 storage key。

### Phase 3：Source Artifact 保留

**状态：Completed**

目标：让 Card、Preset、Worldbook 与 Bundle 导入保存原始文件。

任务：

1. Importer 接受原始 bytes/stream 与来源 metadata；
2. 写入 Blob Store 后在 Source Artifact reference 记录 `sourceArtifactId / blobId / sha256 / sizeBytes`；
3. Import Bundle 继续记录导入成员与 Binding，不把原文件当运行态数据源；
4. 同格式导出优先保留未知字段；
5. 明确 Reset / Re-import 的显式行为。

验证检查点：

- 原始 JSON 与 PNG 可 byte-perfect 读回；
- 编辑 canonical Resource 不修改原始 Artifact；
- 导出使用当前 SQL 已知字段，同时保留支持的未知字段；
- PromptBuild 不读取原始 Blob。

### Phase 4：Media Asset

**状态：Completed**

目标：为 Card 媒体、Narrative attachment 和生成内容提供稳定 `assetId`。

任务：

1. 定义最小 Asset metadata 与 provenance；
2. Card / Import Bundle 使用 asset ID 引用媒体；
3. 增加受控读取 endpoint / stream；
4. 保持原图优先，不实现自动 Thumbnail；
5. 删除仍将 base64 媒体放进普通 Document JSON 的新路径。

验证检查点：

- 同一 Blob 可被多个 Asset 引用；
- 删除一个引用不会删除仍被使用的 Blob；
- JSON-RPC 不承载大型 base64；
- HTTP / local data plane 正确返回 MIME 与长度。

### Phase 5：Server Extension Asset capability

**状态：Completed**

目标：让生成型和处理型 Extension 通过平台 Asset ID 协作。

任务：

1. 评审并定义最小 `ctx.assets` 权限合同；
2. 支持 publish 与受控 read；
3. 支持 Package scratch 临时 materialization；
4. Logger、Event 与 Diagnostic 只记录稳定 ID 和 metadata；
5. 示例 Extension 验证 A 生成、B 按 ID 读取，不共享目录。

验证检查点：

- Extension 不能获取 Blob 根路径；
- 没有授权或来源的 Asset 读取被拒绝；
- reload / uninstall 不破坏已发布 Asset；
- scratch 清理不影响正式 Asset。

### Phase 6：继续 Extension Install MVP

**状态：Completed（本地目录安装 MVP）**

路径与 Blob 基座稳定后已恢复 Package Install 工作。当前首版采用本地目录来源，不为尚未使用的 Archive 格式引入解包依赖：

```text
Local Package directory
  -> staging validate
  -> safe copy
  -> dataRoot/extensions/installed/<package-id>/<version>
  -> Catalog / desired state
```

Installer 拒绝 symlink、特殊文件、越界 entry、非法路径 token、重复版本和超限 Package；失败清理 staging。卸载只允许 installed 来源，先释放 Module，再删除目标版本代码，不删除 Package-owned Document 或已发布 Asset。Archive、Marketplace、在线更新、签名和依赖求解继续后置。

### 7.1 实施证据

- Local Paths：平台默认路径、`LOOM_STUDIO_HOME` 与测试隔离单测；
- Blob / Asset：去重、并发写、重启读取、大小限制、PNG 原字节、共享 Blob 单测；
- Import / Export：raw JSON 保存、unknown field passthrough 与 canonical edit 导出集成测试；
- Media HTTP：raw upload、GET / HEAD、MIME、长度与 Card Asset 引用集成测试；
- Extension Asset：publish/read grant、Package owner、跨 Package 读取、scratch 与 reload 清理契约测试；
- Extension Install：安全目录安装单测，以及安装、重启恢复、卸载后 Document / Asset 保留的 Server 集成测试。

---

## 8. 模块应用矩阵

| 模块 | 本计划后的路径或数据责任 |
|---|---|
| `apps/studio-server` | 唯一路径解析与组合根注入 |
| Data Engine / Domain Stores | `databaseFile`，继续单 SQLite |
| Logging | `logRoot`，只保存运行日志 JSONL |
| Card / Importer / Exporter | 保存 Source Artifact Blob，生成平铺 SQL Resources |
| Narrative Store | 保持专用 SQL 表，不写 Timeline JSONL 或实体目录 |
| Agent Store | 保持专用 SQL 表，不写 Agent Session JSONL |
| Media / Asset API | Blob Store + Asset metadata，不进普通 Document base64 |
| Extension Manager | `extensionInstalledRoot`、state 与 dev links |
| Extension Host | Package-owned Document、Asset capability 与 private scratch |
| Cache / Thumbnail | `cacheRoot`，可完全删除重建 |
| Backup | SQLite 一致性快照 + referenced Blob manifest |

---

## 9. 明确非目标与升级触发条件

当前不做：

- `default-user/` 或其他多用户目录；
- per-Card、per-Timeline、per-Workspace 数据库或文件夹；
- 把内部 Blob Store 暴露为作者手工编辑目录；
- 监听原始 JSON 文件并自动覆盖 SQL；
- 自动 Thumbnail、视频转码或媒体管线；
- Blob 引用计数、GC 和跨备份去重；
- Extension 任意 filesystem grant；
- Client Extension Asset API；
- 云端 Object Store adapter。

升级触发条件：

| 能力 | 触发条件 |
|---|---|
| Thumbnail Cache | 资源列表出现可复现的传输、解码或内存问题 |
| Blob GC | 引用模型、备份和 Extension Asset ownership 已稳定 |
| External Authoring Workspace | 用户确实需要文件编辑器与 Studio 双向同步 |
| Portable Mode | 有真实免安装或 U 盘迁移需求 |
| Branch Resource Snapshot | 变量系统与多世界线运行时修改进入实施 |
| Cloud Blob Backend | 本地文件系统不再满足同步或多人协作需求 |

---

## 10. 完成定义

本计划完成时应满足：

1. 所有后端本地路径来自同一 Resolver 与注入合同；
2. 正式数据不再写入源码或应用安装目录；
3. SQLite、日志、Extension 和 Blob 不再各自选择 Home；
4. 原始 JSON / PNG 可保留，但不成为运行时第二事实源；
5. Card 导入后仍形成平铺 Resource 与 Timeline 启动链；
6. Media 通过 `assetId` 引用，字节通过 Blob Store 读取；
7. Extension 不通过跨目录写文件协作；
8. Cache / Log / Backup 的生命周期和权威性明确区分；
9. 旧 `.loomstudio-dev` 测试数据是否删除在实施阶段单独确认，不执行静默破坏性迁移；
10. Architecture 只在相应代码和测试落地后再晋升当前事实。

以上十项均已满足。旧 `.loomstudio-dev` 数据未执行静默删除或迁移；开发者可在确认无价值后自行清理。Archive Package 安装、Blob GC、备份产品、自动 Thumbnail 与 Client Extension API 保持为明确非目标。
