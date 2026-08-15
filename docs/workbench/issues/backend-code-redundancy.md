# 后端代码冗余与精简总报告 (Backend Code Redundancy)

## 审查覆盖包列表

| 模块类别 | 涉及包 | 核心职责 |
|---|---|---|
| **内核与调度** | `kernel`, `loom-runner`, `core` | RPC 注册/路由、事件总线、Pass 执行管道 |
| **存储底座** | `data-engine`, `blob-store`, `asset-store`, `secret-store` | SQLite 事务队列、CAS 二进制存储、业务资产与密钥管理 |
| **领域存储** | `document-store`, `narrative-store`, `agent-store` | 文档版本变更、链表叙事时间线、Agent 会话与工具状态 |

---

## 1. 核心代码冗余与异味清单

### 🔴 [高] 1. `kernel` 事件总线中丢失 Map Key 导致反向 O(N) 线性遍历

**文件：** [`packages/kernel/src/index.ts` L178-L197, L733-L741](file:///Users/macbookair/Desktop/LoomStudio/packages/kernel/src/index.ts)

```ts
// emit 时使用 subscriptions.values() 丢掉了 subscriptionId (Map Key)
for (const subscription of subscriptions.values()) {
  ...
  try {
    const result = subscription.handler(event)
    if (isPromiseLike(result)) {
      void result.catch(error => options.onSubscriberError?.({
        event,
        // 报错时不得不重新去 Map 里 O(N) 反向查找 Key！
        subscriptionId: findSubscriptionId(subscriptions, subscription),
        error,
      }))
    }
  }
}

function findSubscriptionId(subscriptions, target): string {
  for (const [subscriptionId, subscription] of subscriptions) {
    if (subscription === target) return subscriptionId
  }
  return 'unknown'
}
```

**问题分析：**
- `subscriptions` 本身就是 `Map<string, Subscription>`。
- 循环时直接遍历 `subscriptions.entries()` 即可直接获得 `subscriptionId`，但代码先使用 `.values()` 抛弃了 key，在异步抛错时又专门写了一个 10 行的 `findSubscriptionId` 函数反向线性扫描查找。

**瘦身方案：**
- 将 `subscriptions.values()` 改为 `subscriptions.entries()`，直接解构 `[subscriptionId, subscription]`。
- **直接删除 `findSubscriptionId` 函数（省 10 行）**，消除低效的 O(N) 反向查表。

---

### 🟡 [中] 2. `loom-runner` 中硬编码 Demo/Toy Pass

**文件：** [`packages/loom-runner/src/index.ts` L71-L97](file:///Users/macbookair/Desktop/LoomStudio/packages/loom-runner/src/index.ts)

```ts
function defaultFactories(): PassFactory[] {
  return [
    { name: 'noop', create: () => ({ name: 'noop', run: fragments => fragments }) },
    { name: 'uppercase', create: () => ({ name: 'uppercase', run: fragments => fragments.map(...) }) },
    { name: 'throw', create: () => ({ name: 'throw', run: () => { throw new Error('throw pass failed') } }) },
  ]
}
```

**问题分析：**
- `defaultFactories` 注入了 `noop`、`uppercase`、`throw` 三个测试用桩 Pass。
- 这些属于早期测试时期的玩具代码，在生产运行时中完全无用，增加维护干扰。

**瘦身方案：**
- 将 `defaultFactories` 从生产入口中精简/移除，Pass 工厂由使用者显式配置或移至单元测试 fixture 中，省 **27 行**。

---

### 🟡 [中] 3. `kernel` 中无意义的语句与防御性 try/catch 样板代码

**文件：** [`packages/kernel/src/index.ts` L352, L354-L362](file:///Users/macbookair/Desktop/LoomStudio/packages/kernel/src/index.ts)

```ts
// L352: 未使用的空表达式
void options.loomRunner

// L354-L362: 注册内置单例 RPC 时的过度防御
const register = (method: string, handler: KernelRpcHandler) => {
  try {
    kernel.registerKernelRpc(method, handler)
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('already registered')) {
      throw error
    }
  }
}
```

**问题分析：**
- `void options.loomRunner` 是未完成参数重构遗留的死代码（Dead expression）。
- `registerStageOneHandlers` 注册的所有 RPC 均为系统启动时固定初始化的内置方法，绝无并发或外部注入冲突可能，外层的 `try/catch` 吞 `already registered` 属于形式主义样板代码。

**瘦身方案：**
- 删除 `void options.loomRunner`。
- 简化 `register` 包装函数，去除无意义的 try/catch 吞错逻辑。

---

### 🟡 [中] 4. `application-runtime` 中未使用的幽灵依赖 `@loom/core`

**文件：** `packages/application-runtime/package.json` L23

```json
"dependencies": {
  "@loom/core": "workspace:*",
  ...
}
```

**问题分析：**
- `application-runtime` 的 `src/` 中**没有任何一行代码导入或使用 `@loom/core`**（Prompt 组装由 `prompt-builder.ts` 自行实现）。
- 依赖声明遗留增加了打包与模块解析负担。

**瘦身方案：**
- 从 `package.json` 中移除无用依赖 `"@loom/core"`。

---

### 🟡 [中] 5. 跨模块基础工具与类型高度重复定义（跨 6 个包）

**重复清单：**

| 工具/类型 | 重复出现的包与文件 |
|---|---|
| `isRecord(value)` | `kernel/src/index.ts`, `loom-runner/src/index.ts`, `agent-store/src/store.ts`, `document-store/src/json.ts` |
| `readString(params, key)` | `kernel/src/index.ts`, `asset-store/src/store.ts` |
| `validateId(id, field)` | `narrative-store/src/store.ts`, `agent-store/src/store.ts`, `secret-store/src/store.ts` |
| `validateOptionalText(text, field)` | `narrative-store/src/store.ts`, `agent-store/src/store.ts` |
| `optionalString(value)` | `narrative-store/src/store.ts`, `agent-store/src/store.ts` |
| `operation(kind, entityId, entityType)` | `narrative-store/src/store.ts`, `agent-store/src/store.ts` |
| 自定义 StoreError 类定义模式 | `DocumentStoreError`, `NarrativeStoreError`, `AgentStoreError`, `DataEngineError`, `BlobStoreError`, `AssetStoreError`, `SecretStoreError` |

**瘦身方案：**
- 将这些高频出现的纯断言和数据读取工具收敛至 `@loom-studio/shared` 或 `@loom-studio/data-engine`，消除各个 store 中多达 **80~120 行** 的重复工具函数代码。

---

### 🟡 [中] 6. 链表遍历 N+1 查询与缺少上限保护

**文件：**
- [`narrative-store/store.ts` L349-L357](file:///Users/macbookair/Desktop/LoomStudio/packages/narrative-store/src/store.ts)
- [`agent-store/store.ts` L219-L223](file:///Users/macbookair/Desktop/LoomStudio/packages/agent-store/src/store.ts)

```ts
while (nodeId && reverseNodes.length < limit) {
  const node = requireNode(database, nodeId) // 每次 1 条独立 SQL
  reverseNodes.push(node)
  nodeId = node.parentNodeId
}
```

**问题分析：**
- 每次分页请求（limit 最大 100）会执行多达 100 次单独的 `SELECT ... WHERE id = ?`。
- 缺少显式的防循环与最大遍历安全上限（依赖业务 limit）。

**瘦身方案：**
- 可使用 SQLite `WITH RECURSIVE` CTE 单条 SQL 批量拉取整条链表，消除 N+1 循环查询与应用层遍历样板。

---

### 🟢 [低] 7. `sqlite-store` 分页的冗余 `hasMore` 查询

**文件：** [`document-store/src/sqlite-store.ts` L128-L141](file:///Users/macbookair/Desktop/LoomStudio/packages/document-store/src/sqlite-store.ts)

```ts
const rows = database.prepare(`... LIMIT ? OFFSET ?`).all(..., limit, offset)
const hasMore = rows.length === limit && database.prepare(`SELECT 1 ... LIMIT 1 OFFSET ?`).get(..., nextOffset)
```

**瘦身方案：**
- 主查询直接改用 `LIMIT limit + 1`，用 `rows.length > limit` 判断 `hasMore` 并 `slice(0, limit)`，省去多余的一条 `SELECT 1` SQL。

---

### 🟢 [低] 8. `createDocumentDataCommitSource` 纯透传层

**文件：** [`document-store/src/data-commit.ts` L4-L10](file:///Users/macbookair/Desktop/LoomStudio/packages/document-store/src/data-commit.ts)

```ts
export function createDocumentDataCommitSource(documents: Pick<DocumentStore, 'subscribeCommits'>): DataCommitSource {
  return {
    subscribeCommits: observer => documents.subscribeCommits(commit => observer(commit)),
  }
}
```

**瘦身方案：**
- 简化为 `{ subscribeCommits: documents.subscribeCommits }` 或直接在创建处复用。

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
