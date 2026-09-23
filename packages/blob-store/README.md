# `@loom-studio/blob-store`

> **状态**：Active Package Guide / Current Source Is Authority

`@loom-studio/blob-store` 是 Loom Studio 基于 SHA-256 哈希的内容寻址不可变二进制字节存储层。它负责安全暂存、去重、原子化 Finalize 以及受控流式读写。

## 业务使命与两阶段写入模型

在角色卡导入、多媒体资源上传与备份还原过程中，系统需要处理未知大小与来源的外部二进制数据。
`@loom-studio/blob-store` 提供高可靠的底层块存储模型：
- **SHA-256 内容寻址**：相同内容自动天然去重，避免重复文件浪费磁盘；
- **两阶段写入**：
  1. `prepareWrite()`：将传入的 `Uint8Array` 或 `Readable` 流写入临时暂存区，计算校验和与大小，原子重命名至最终哈希路径，再查询已有 Blob metadata；
  2. `participateWrite(tx, prepared)`：在调用者的 SQLite 事务中登记或复用 metadata，不在事务内搬动文件；
  3. 事务失败时 metadata 回滚；`discardPreparedWrite()` 不删除已经 finalize 的共享文件，也不依赖 Engine 仍然可读。同 hash 字节可能被其他在途请求使用，当前允许暂留无引用文件，不实现物理 GC。prepare 自己负责清理 staging 临时文件；
- **流式处理**：通过 `open(blobId)` 返回标准 Node.js `Readable` 流，避免超大文件将主进程内存打爆。

---

## 架构规约与红线约束 (Rules & Boundaries)

1. **绝对剥离业务语义（No Business Semantics）**：
   - 本包**绝不理解任何业务 Asset 含义**（它不知道什么是“头像”、“背景图”、“卡片附件”或“语音”）；
   - 业务资源元数据、归属者关系与类型标记必须上移到 `@loom-studio/asset-store`，严禁在本包添加业务字段。
2. **内容不可变（Immutable）**：
   - 一旦 Blob 写入成功，其对应的内容哈希与物理文件**永久不可修改**；
   - 严禁原地覆写已有 Blob。

---

## 公共入口

Package 主入口为 [`src/index.ts`](./src/index.ts)：

- `createBlobStore(options)`：创建基于本地磁盘与 SQLite 协调的 Blob 存储实例；
- 核心操作方法：`write`、`prepareWrite`、`participateWrite`、`discardPreparedWrite`、`get`、`getBySha256`、`open`、`read`；
- 核心类型：`BlobStore`、`BlobRecord`、`PreparedBlobWrite`、`BlobWriteInput`、`BlobStoreError`。

---

## 构建与验证

```bash
# 编译 TypeScript 产物
pnpm --filter @loom-studio/blob-store build

# 运行 Blob 存储测试套件
pnpm exec vitest run tests/unit/blob-store
```

---

## 正式文档

- [Data Architecture 统一持久化架构](../../docs/architecture/data/README.md)
