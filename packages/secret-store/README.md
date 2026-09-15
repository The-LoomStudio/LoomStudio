# `@loom-studio/secret-store`

> **状态**：Active Package Guide / Current Source Is Authority

`@loom-studio/secret-store` 是 Loom Studio 敏感凭据（如大模型 API Key、第三方授权 Token）的安全托管与受控使用层。它实现了 SQLite 元数据管理与真实密钥后端的严格物理隔离。

## 业务使命与受控使用模式

在本地多模型工作台中，用户需要配置 OpenAI、Anthropic、Google 等各类供应商的 API 凭据。这些凭据既需要跨重启持久化，又必须受到严格的安全与权限保护。
`@loom-studio/secret-store` 采用双层隔离架构：
- **元数据层 (Metadata)**：在共享 SQLite 中维护凭据引用（`secret:${uuid}`）、所属主体（Owner）、用途（Purpose）及生命周期状态（`active` / `pending-delete`）；
- **凭据后端 (Backend)**：真实明文（`SecretPlaintext`）保存在可插拔后端：
  - `createKeyringSecretBackend()`：生产环境基于操作系统原生凭据链（Keyring/Keychain）；
  - `createMemorySecretBackend()`：开发、无头 CI 与单元测试专用的纯内存凭据后端；
- **受控闭包借用 (`withSecret`)**：
  外部业务模块严禁直接“读取”明文并随意传递，必须通过受控闭包临时借用：
  ```ts
  await secretStore.withSecret(secretRef, { caller: 'ai-gateway', owner, purpose: 'llm_invoke' }, async (plaintext) => {
    // 仅在闭包内部短暂使用 plaintext.values.apiKey 发起网络调用
  })
  ```

---

## 架构规约与安全红线 (Security Rules & Boundaries)

1. **绝对禁止在 SQLite 中持久化明文（No Plaintext in SQLite）**：
   - SQLite 数据库表只允许保存 `SecretMetadata`，**严禁向数据库写入任何 API Key 或密码明文**；
2. **严防凭据外泄（No Leakage）**：
   - 严禁将明文 Secret 序列化输出到日志（`@loom-studio/logging` 会严格过滤）；
   - 严禁将明文 Secret 通过 RPC 或 HTTP 接口直接返回给前端 Web Client；
3. **两阶段删除与清理重试**：
   - 删除凭据时采用先标记 `pending-delete`，再清理系统 Keyring，最后确认持久化事实的机制，防止外部 Keyring 状态不一致。

---

## 公共入口

Package 主入口为 [`src/index.ts`](./src/index.ts)：

- `createSecretStore(options)`：创建 Secret 存储实例（注入 `dataEngine` 与 `backend`）；
- `createKeyringSecretBackend()`：操作系统安全凭据后端工厂；
- `createMemorySecretBackend()`：内存凭据后端工厂；
- 核心类型：`SecretStore`、`SecretBackend`、`SecretMetadata`、`SecretPlaintext`、`SecretRef`、`SecretStoreError`。

---

## 构建与验证

```bash
# 编译 TypeScript 产物
pnpm --filter @loom-studio/secret-store build

# 运行凭据存储单元测试
pnpm exec vitest run tests/unit/secret-store
```

---

## 正式文档

- [Data Architecture 统一持久化架构](../../docs/architecture/data/README.md)
- [External Dependency Ownership 依赖所有权](../../docs/architecture/platform/external-dependency-ownership.md)
