# Local Storage and Asset Architecture

Studio Server 是本地路径的唯一组合根。领域 Package 不读取 Home、环境变量或当前工作目录，而是消费 Server 注入的 SQLite Engine、Store 或明确路径。

## 1. 本地路径合同

`resolveLoomStudioLocalPaths()` 默认使用操作系统原生用户目录：macOS 的 Application Support / Caches / Logs、Linux 的 XDG data / cache / state、Windows 的 LocalAppData。`LOOM_STUDIO_HOME` 将三个根收拢为其下的 `data/`、`cache/`、`logs/`；`LOOM_STUDIO_DATA_ROOT` 独立覆盖持久数据根，优先于 HOME 推导出的 data 路径，不改变 cache/log 路径。对应 options 分别优先于同名环境变量，见 [路径解析器](../../../apps/studio-server/src/platform/local-paths.ts)。

```text
data/
├── studio.sqlite
├── blobs/
│   ├── sha256/ab/cd/<full-sha256>
│   └── staging/
├── extensions/
│   └── <package-id>/
│       ├── global/
│       └── card-<card-id-sha256>/
├── config/
│   ├── extensions-state.json
│   └── extensions-dev-links.json
└── backups/

cache/
└── extensions/<package-id>/<instance-id>/

logs/
└── *.jsonl

<installationRoot>/
└── extensions/
    ├── <package-id>/
    └── .card-installed/<archive-sha256>/<package-id>/<version>/
```

正式运行的 data/cache/log 默认使用用户目录。扩展代码安装根默认是发行安装根 `installationRoot` 下的 `extensions/`，与 `data/extensions/` 中按 Package / 安装目标隔离的扩展文件数据分开。Server 的 `extensionInstalledDirectory` 可覆盖代码安装根；`extensionStateDirectory` 可将状态和开发链接改放到指定目录的 `state.json` / `dev-links.json`，默认仍使用上述 data/config 路径，见 [Server 组合根](../../../apps/studio-server/src/server.ts)。

根开发命令通过 [开发路径配置](../../../scripts/lib/development-data-paths.mjs) 将持久数据放在仓库 `data/`，cache/log 放在 `.loomstudio-dev/`；显式设置 HOME 时保留 `<HOME>/data` 语义，显式 DATA_ROOT 仍优先。启动器不迁移或恢复其他目录中的旧数据库；Store namespace 版本必须匹配当前代码。测试使用注入的临时目录。

## 2. SQLite 与 Blob 的权威边界

SQLite 保存需要查询、关联、事务和业务修改的结构化状态。Blob Store 保存原始且不可变的字节。两者的公共工厂 `createAssetStore` / `createBlobStore` 均由 `@loom-studio/asset-store` 导出；字节实现位于本包 `src/blobs/`，合包不改变文件路径、Blob 身份或 `platform.blob-store` schema namespace。判断依据不是文本或二进制：原始 JSON 也可以是 Blob，解析后的 Card / Prompt Resource 则是 SQL canonical state。

Blob 写入使用 Node stream、staging file、同步计算 SHA-256、按 hash 原子 finalize，再在调用者事务中提交 `stored_blobs` metadata。同 hash 的两个 prepared 写入中，一方失败/丢弃绝不删除另一方已提交或共用的 finalized 字节。公开 API 只接受 `blobId`，不返回物理路径。当前允许暂留无引用的孤儿文件，不实现全量物理 GC。

```text
stored_blobs
  id, sha256 UNIQUE, size_bytes, media_type, created_at

source_artifacts
  id, blob_id, format, original_file_name, media_type,
  imported_at, importer_version

media_assets
  id, blob_id, kind, label, media_type, size_bytes,
  width, height, owner_package_id, created_by_json, created_at
```

一个 Blob 可以被多个 Source Artifact 或 Media Asset 引用。当前不做引用计数和物理 GC；删除一个业务引用不会顺手删除 Blob。

## 3. Source Artifact 与 canonical state

Source Artifact 保存一次外部输入的原始字节和来源 metadata。Card Bundle JSON 导入会先保留原始文本，再把解析出的 Card、Prompt Resources、Binding 与 Import Bundle 写入 canonical SQL/Document state。后续编辑只修改 canonical state，不改原始 Blob，PromptBuild 也不读取原始 Blob。

Card Bundle 导出以当前 canonical 字段覆盖原值，同时透传导入对象中未识别的顶层、Card 和 metadata 字段。Source Artifact Store 本身不限定 JSON，可 byte-perfect 保存 PNG 等格式；具体第三方 Card PNG 解析器不属于本地存储层。

## 4. Media Asset 数据面与容器解耦

正式媒体使用稳定 `assetId`。`POST /assets` 接受 raw HTTP body，创建 Blob 与 Media Asset；`GET /assets/:assetId` 和 `HEAD /assets/:assetId` 返回正确 MIME、长度、immutable cache 与 `nosniff`。大型媒体通过上述独立 HTTP 路径传输，不放入 tRPC JSON 请求体进行 base64 编码。

Card 资产模型已将**容器与内部素材解耦**：
- 媒体素材不限于静态头像或封面，支持保存 GIF、APNG、WebP、音频与视频等测试/业务素材；
- Blob Store 保存收到的原始字节，Card 打包保留媒体类型、未知 MIME 使用 `.bin` 而不伪装为 PNG；Card 导入/导出的 PNG 素材会按[容器规则](../application/card-bundle-files.md#校验与限制)移除文本元数据和 IEND 后尾部，避免嵌套携带旧角色包。这是明确的 PNG 容器处理，不是 Blob Store 转码或对所有素材作任意清洗；
- 静态 PNG 外层封面仅用于平台可读展示，包内完整保留原始媒体与 APNG 动画块。当前自动缩略图生成与客户端视频播放器单独演进。

## 5. Extension 文件边界

Server Extension 通过 `ctx.assets.publish/read/materialize` 使用媒体：

- `publish` 需要 `assets.publish` grant，Host 强制写入当前 `packageId` owner；
- Package 可读取自己的 Asset；读取其他 owner 或用户 Asset 需要 `assets.read` grant；
- Host 不提供全局 list、Blob root 或任意输出目录；
- `materialize` 只把已授权 Asset 写入当前 Instance 的 cache scratch，reload / dispose 会删除 scratch，不影响正式 Asset；
- Extension 通过 `assetId` 协作，不写 sibling Package 目录。

本地全局 Package 安装接受目录与 ZIP 来源。目录安装拒绝 symlink、特殊文件与超限内容；ZIP 先校验路径、重复项和解压预算，再复用目录安装流程。Installer 校验 ID/version、Manifest 与声明资源，经安装根下的 `.staging` 原子 rename 到 `<installationRoot>/extensions/<package-id>`（默认路径）；同名已有来源会拒绝安装，不静默覆盖。安装时校验已安装依赖，不提供自动依赖求解。

Card 内置 Extension Package 从角色归档安装到代码安装根下的 `.card-installed/<archive-sha256>/<package-id>/<version>`，不进入全局发现；安装、资源导入、模块启用与授权保持独立边界。归档文件与当前 Card 安装身份的校验见[文件化角色包](../application/card-bundle-files.md)。

受管理的远程来源支持显式检查更新、预览更新或 Git 回退，再提交安装变更。更新与回退仍需调用方发起，不是后台自动更新；Marketplace、签名、自动依赖求解和 Media Asset 引用安全删除尚未实现。

全局卸载接受 installed 与 dev-link：前者删除复制后的安装目录，后者只移除开发链接；两者都释放并 forget Module、删除 Package 的 enabled/grant 状态。默认保留 Package-owned Documents、扩展文件数据、已导入资源与已发布 Media Assets；显式传入 `deleteData: true` 时，删除该 Package 全局安装所属的 Config / Record、声明 Document 类型及 `data/extensions/<package-id>/global` 文件数据，不删除 Card-owned 数据或公共媒体。Card 安装按自身目标卸载，共享归档缓存保留。
