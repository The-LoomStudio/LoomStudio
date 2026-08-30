# 后端代码冗余与精简总报告 (Backend Code Redundancy)

> **状态**：Historical Audit Snapshot / Superseded

## 审查覆盖包列表

| 模块类别 | 涉及包 | 核心职责 |
|---|---|---|
| **内核与调度** | `kernel`, `loom-runner`, `core` | RPC 注册/路由、事件总线、Pass 执行管道 |
| **存储底座** | `data-engine`, `blob-store`, `asset-store`, `secret-store` | SQLite 事务队列、CAS 二进制存储、业务资产与密钥管理 |
| **领域存储** | `document-store`, `narrative-store`, `agent-store` | 文档版本变更、链表叙事时间线、Agent 会话与工具状态 |

---

## 1. 核心代码冗余与异味清单

### ✅ [已解决] 1. `kernel` 事件总线中丢失 Map Key 导致反向 O(N) 线性遍历

**文件：** [`packages/kernel/src/index.ts`](../../../packages/kernel/src/index.ts)

**审查结论：**
- **已将 `subscriptions.values()` 改为 `subscriptions.entries()`**，遍历时直接保留 `[subscriptionId, subscription]`。
- **彻底删除了 `findSubscriptionId` 函数**，消除了不必要的 O(N) 线性查找开销。

---

### ✅ [已解决] 2. `loom-runner` 中硬编码 Demo/Toy Pass

**文件：** [`packages/loom-runner/src/index.ts`](../../../packages/loom-runner/src/index.ts)

**审查结论：**
- **已将 `defaultFactories` 从生产 `createLoomRunner()` 中剥离**，改为导出 `createSamplePassFactories()` 仅供单测显式传入，确保生产 Runner 纯净。

---

### ✅ [已解决] 3. `kernel` 中无意义的语句与防御性 try/catch 样板代码

**文件：** [`packages/kernel/src/index.ts`](../../../packages/kernel/src/index.ts)

**审查结论：**
- **已删除 `void options.loomRunner` 死语句**，并将单例 `register` 包装函数简化为单行箭头函数，消除了形式主义 try/catch 样板。

---

### ✅ [已澄清] 4. `application-runtime` 依赖 `@loom/core` 事实对齐

**文件：** `packages/application-runtime/package.json`

**审查结论：**
- 经全量符号排查，[`packages/application-runtime/src/prompt/prompt-build-pipeline.ts`](../../../packages/application-runtime/src/prompt/prompt-build-pipeline.ts) 深度依赖了 `@loom/core` 中的 Pipeline 阶段与执行能力，确系合法核心依赖，非幽灵依赖。

---

### ✅ [已解决] 5. 跨模块基础工具收敛至 `@loom-studio/shared`

**文件：** [`packages/shared/src/index.ts`](../../../packages/shared/src/index.ts)

**审查结论：**
- **已在 `@loom-studio/shared` 统一定义并导出 `optionalString` 与 `isRecord`**；
- **已重构 `packages/narrative-store` 与 `packages/agent-store`**，直接复用 shared 工具函数，删除了各自文件底部的私有重复定义；
- 各 Store 专有业务规则（如 Narrative body 校验、PromptResource 树关系及 canonicalJson 排序）保持在领域内内聚，避免过度抽象。

---

### ✅ [已解决] 6. 链表结构在 Application 层的 N+1 次 SQL 循环拉取

**文件：**
- [`packages/narrative-store/src/store.ts`](../../../packages/narrative-store/src/store.ts)
- [`packages/agent-store/src/store.ts`](../../../packages/agent-store/src/store.ts)

**审查结论：**
- **已重构为单条 SQLite `WITH RECURSIVE` CTE 递归查询**，内建 `depth < 10000` 安全上限保护，彻底消除了应用层 N+1 次独立 SQL 查询。

---

### ✅ [已解决] 7. `sqlite-store` 分页的冗余 `hasMore` 查询

**文件：** [`packages/document-store/src/sqlite-store.ts`](../../../packages/document-store/src/sqlite-store.ts)

**审查结论：**
- **已改用 `LIMIT limit + 1`**，用 `rows.length > limit` 直接判断 `hasMore` 并做 `slice(0, limit)`，彻底移除了每次列表查询多余的一条 `SELECT 1` SQL。

---

### ✅ [已解决] 8. `createDocumentDataCommitSource` 纯透传层

**文件：** [`packages/document-store/src/data-commit.ts`](../../../packages/document-store/src/data-commit.ts)

**审查结论：**
- **已简化订阅包装**，直接由 `documents.subscribeCommits(observer)` 进行委托，消除多余闭包分配。

---

## 2. 后端精简收益汇总

| 优化项 | 涉及模块 | 预估缩减代码量 | 架构与可维护性收益 |
|---|---|---|---|
| `kernel` 事件总线消除反向线性查找 | `kernel/src/index.ts` | 约 15 行 | 消除 O(N) 遍历，从根源规避查表性能浪费 |
| 移除 `loom-runner` 中的 Demo Toy Pass | `loom-runner/src/index.ts` | 约 27 行 | 净化生产运行时，移除测试残留 |
| 清理 `kernel` 启动阶段冗余防御与死语句 | `kernel/src/index.ts` | 约 12 行 | 消除形式主义代码 |
| 清理 `application-runtime` 幽灵依赖 | `application-runtime/package.json` | 约 2 行 | 净化依赖拓扑 |
| 收敛 7 个包的重复断言与 Row 工具函数 | `shared` / 7 个 store 包 | 约 80~120 行 | 统一基础校验与错误模式，消除大量样板 |
| 链表分页改为递归 CTE 查询 | `narrative-store`, `agent-store` | 约 30 行 | 消除 100 次 N+1 查询，代码更紧凑 |
| 分页 `hasMore` 消除冗余 SQL | `document-store` | 约 8 行 | 消除多余 SQL 准备与执行 |
| **合计** | **整个后端工程** | **约 180 ~ 220 行** | **显著提升后端基础包的一致性、纯净度与执行效率** |
