# `@loom-studio/asset-store`

> **状态**：Active Package Guide / Current Source Is Authority

`@loom-studio/asset-store` 是 Loom Studio 的媒体资产与导入产物元数据管理层。它在共享 SQLite 中维护业务资产关系，并通过稳定 ID 与 `@loom-studio/blob-store` 协同管理底层不可变字节。

## 业务使命与双轨资产模型

系统中的二进制资产分为“原始导入输入”与“运行时媒体资源”，本包将其建模为两个清晰的双轨通道：

1. **Source Artifact (`preserveSourceArtifact`)**：
   - 记录外部格式（如 SillyTavern 角色卡、第三方规范 JSON 或 ZIP 归档）的原始输入副本；
   - 保存导入时间、原始文件名、格式标识（Format）与转换器版本（ImporterVersion），用于后续合规审计与差分对比。
2. **Media Asset (`createMediaAsset`)**：
   - 记录角色头像、背景插图、语音音频等一等公民媒体元数据；
   - 维护媒体类型（MIME）、尺寸规格（width/height）、所属扩展包（ownerPackageId）以及创建者（Actor）。

---

## 架构规约与红线约束 (Rules & Boundaries)

1. **绝对禁止数据库内联大二进制（No Inline Blobs in SQLite）**：
   - SQLite 只保存轻量级的资产元数据；
   - **所有实际二进制字节必须通过 `this.blobs`（即 `@loom-studio/blob-store`）进行内容寻址持久化**，严禁在 SQLite 字段中存储 `Buffer` 或 Base64 字符串。
2. **事务级提交事实（Commit Facts）**：
   - 资产记录的创建与导入属于正式数据事务，必须生成 `DataCommitFact`，确保可追溯性。

---

## 公共入口

Package 主入口为 [`src/index.ts`](./src/index.ts)：

- `createAssetStore(options)`：创建资产管理实例（需注入 `dataEngine` 与 `blobs`）；
- 核心操作方法：
  - `preserveSourceArtifact()`、`getSourceArtifact()`；
  - `createMediaAsset()`、`getMediaAsset()`、`openMediaAsset()`、`readMediaAsset()`；
- 核心类型：`AssetStore`、`MediaAssetRecord`、`SourceArtifactRecord`、`AssetStoreError`。

---

## 构建与验证

```bash
# 编译 TypeScript 产物
pnpm --filter @loom-studio/asset-store build

# 运行资产存储单元测试
pnpm exec vitest run tests/unit/asset-store
```

---

## 正式文档

- [Data Architecture 统一持久化架构](../../docs/architecture/data/README.md)
