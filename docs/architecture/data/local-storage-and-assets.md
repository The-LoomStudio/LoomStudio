# Local Storage and Asset Architecture

Studio Server 是本地路径的唯一组合根。领域 Package 不读取 Home、环境变量或当前工作目录，而是消费 Server 注入的 SQLite Engine、Store 或明确路径。

## 1. 本地路径合同

`resolveLoomStudioLocalPaths()` 默认使用操作系统原生用户目录：macOS 的 Application Support / Caches / Logs、Linux 的 XDG data / cache / state、Windows 的 LocalAppData。开发和测试可用唯一覆盖 `LOOM_STUDIO_HOME`，其下固定收拢为 `data/`、`cache/`、`logs/`。

```text
data/
├── studio.sqlite
├── blobs/
│   ├── sha256/ab/cd/<full-sha256>
│   └── staging/
├── extensions/
│   ├── installed/<package-id>/<version>/
│   ├── state.json
│   └── dev-links.json
├── config/
└── backups/

cache/
└── extensions/<package-id>/<instance-id>/

logs/
└── *.jsonl
```

正式数据不写入源码或应用安装目录。开发命令显式把 `LOOM_STUDIO_HOME` 指向仓库 `.loomstudio-dev`；测试注入临时目录。

## 2. SQLite 与 Blob 的权威边界

SQLite 保存需要查询、关联、事务和业务修改的结构化状态。Blob Store 保存原始且不可变的字节。判断依据不是文本或二进制：原始 JSON 也可以是 Blob，解析后的 Card / Prompt Resource 则是 SQL canonical state。

Blob 写入使用 Node stream、staging file、同步计算 SHA-256、按 hash 原子 finalize，再提交 `stored_blobs` metadata。相同内容复用同一 Blob；公开 API 只接受 `blobId`，不返回物理路径。文件成功但 SQL 失败时允许留下未引用文件，SQL 不会提交指向缺失字节的新引用。

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

## 4. Media Asset 数据面

正式媒体使用稳定 `assetId`。`POST /assets` 接受 raw HTTP body，创建 Blob 与 Media Asset；`GET /assets/:assetId` 和 `HEAD /assets/:assetId` 返回正确 MIME、长度、immutable cache 与 `nosniff`。大型媒体不经过 JSON-RPC base64。

Card 当前通过 `media.avatarAssetId` / `media.coverAssetId` 引用媒体。自动 Thumbnail 尚未实现；前端直接使用原图缩放，作者显式提供的封面仍是正式 Media Asset。

## 5. Extension 文件边界

Server Extension 通过 `ctx.assets.publish/read/materialize` 使用媒体：

- `publish` 需要 `assets.publish` grant，Host 强制写入当前 `packageId` owner；
- Package 可读取自己的 Asset；读取其他 owner 或用户 Asset 需要 `assets.read` grant；
- Host 不提供全局 list、Blob root 或任意输出目录；
- `materialize` 只把已授权 Asset 写入当前 Instance 的 cache scratch，reload / dispose 会删除 scratch，不影响正式 Asset；
- Extension 通过 `assetId` 协作，不写 sibling Package 目录。

本地 Package 安装首版只接受目录来源。Installer 拒绝 symlink、特殊文件、越界 entry、非法 ID/version 与超限 Package，先复制到 `.staging`，验证 Manifest v2 后原子 rename 到 `installed/<package-id>/<version>`。卸载只允许 installed 来源，先释放 Module，再删除该版本代码；Package-owned Documents 与已发布 Media Assets 保留。Archive、Marketplace、签名、在线更新和依赖求解尚未实现。
