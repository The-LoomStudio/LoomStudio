# `@loom-studio/application-data`

> **状态**：Active Package Guide / Current Source Is Authority

`@loom-studio/application-data` 是 Loom Studio 统一的领域存储核心包。在架构简化演进中，它将原本分散的 `agent-store`、`narrative-store`、`state-store` 与 `prompt-resource-store` 深度整合为一个高内聚的持久化模块。

## 业务使命与四大领域存储

本包负责将 AIRP（AI Role-Play）四项核心业务实体的生命周期、状态迁移与快照安全持久化到共享的 SQLite 存储中：

1. **Agent 存储 (`src/agent/`)**：
   - 管理独立 Agent 运行会话（`AgentSession`）与 Append-only 的 canonical Transcript（`AgentTranscriptEntry`），不以 Provider wire message 为持久化模型；
   - 保存 Message、Observation、Tool Invocation/Result 与 Run 状态；`appendEntries()` 使用 `expectedEntryCount` 校验并发基线，校验工具调用与结果的配对。
2. **Narrative 存储 (`src/narrative/`)**：
   - 管理非线性交互叙事的时间线（`NarrativeTimeline`）、分支（`NarrativeBranch`）与内容节点（`NarrativeNode`）；
   - 支持分支创建/切换、沿 parent 链分页与 `editBranchNode()` 路径复制；不负责模型重演或 Agent 执行。
3. **State 存储 (`src/state/`)**：
   - 维护 `StateScope` 与包含 JSON snapshot、operations 的 `StateRevision`，提供全局状态 Head 的版本校验；
   - 记录每次状态变更的操作者（Actor）与因果提交事实。
4. **Prompt Resource 存储 (`src/prompt-resource/`)**：
   - 持久化树形层级的提示词资源（Preset、Setting、Logic、Runtime 节点）；
   - 管理独立的 Setting Mount Registry 与 Preset Tool Mount，以及资源 Header/Node 的版本修订；嵌套资源树是消费投影，不是整份 Document 权威存储。

---

## 架构规约与外部依赖所有权 (Rules & Boundaries)

1. **共享 SQLite 事务管道**：
   - 本包**强依赖 `@loom-studio/data-engine`**，运行期公开读写进入统一 FIFO；Store 创建时同步注册 namespace migration，不把迁移当作运行期排队操作；
   - **严禁私自建立第二套 SQLite 连接**。跨 Store 写入通过各 Store 的 `transaction(tx)` 参与同一 Engine 事务，共享 Changeset；只有成功且非空的提交才通知 `DataCommitFact`。
2. **拒绝 ORM 抽象**：
   - 坚持使用原生 SQL 查询与 Data Engine 命名空间迁移（Namespaced Migrations），**严禁引入 Prisma、TypeORM 或复杂实体映射框架**。
3. **领域界限清晰**：
   - 本包仅负责数据实体的持久化、版本校验与结构化查询；
   - **严禁编写提示词编译、模型调用循环（Tool Loop）或前端交互逻辑**（这些全部归属于 `application-runtime`）。

---

## 公共入口

Package 主入口为 [`src/index.ts`](./src/index.ts)，统一重导出四大领域模块：

```ts
import {
  createAgentStore,
  createNarrativeStore,
  createStateStore,
  createPromptResourceStore,
} from '@loom-studio/application-data'
```

- [`src/agent/`](./src/agent/)：导出 `createAgentStore` 及会话与 Transcript 类型；
- [`src/narrative/`](./src/narrative/)：导出 `createNarrativeStore` 及时间线/分支类型（沿 parent 链游标读取，为 Narrative Sampling 提供底层支撑）；
- [`src/state/`](./src/state/)：导出 `createStateStore` 及状态变更类型（State Delta 支持合法空键重放与合并保真）；
- [`src/prompt-resource/`](./src/prompt-resource/)：导出 `createPromptResourceStore` 及资源树操作类型；

内部 [`src/json.ts`](./src/json.ts) 提供数据持久化 JSON 保真断言，显式拒绝 `NaN`、`Infinity` 等非有限数字，保护合法空键、`null`、`0` 与 `false`；它不是 package public export。

### 写入与重试边界

- [`NarrativeStore.appendInput()`](./src/narrative/store.ts) 以固定 `nodeId`、`expectedHeadNodeId` 和正文提交用户输入。同一输入重试返回原节点与原 Changeset；正文、原 parent 或归属不一致返回 `narrative.input_conflict`，不生成第二条正文。调用方在成功落库后另行投递 Agent Session；本 Store 不启动 Agent，也不把两次调用合成一个事务。
- [`PromptResourceStore.mutateResource()`](./src/prompt-resource/mutations.ts) 必须携带资源级 `expectedVersion`；不匹配返回 `prompt_resource.conflict`，没有自动合并或改用最新版本重试。一次 mutations 列表在同一事务内提交，Header/Node 修订与提交事实一起生效。
- 四个 Store 仅执行各自注册的连续版本 migration；数据库 namespace 高于当前支持版本时由 Engine 拒绝，不尝试降级或兼容读取。版本注册以各 `store.ts` 为准。

### 统一游标分页与数据保真底线

- **Prompt Resource Keyset 分页**：`listResources()` 默认按 `updated_at DESC, id DESC`，cursor 保存读取时边界；`order: 'id'` 按稳定 ID 降序，供 Runtime 全量收集与导入冲突扫描使用。cursor 绑定排序、resourceKind 与 includeTombstone，不能当数字 OFFSET 或换筛选复用。默认页长 100，上限 500。
- **并发与一致性**：更新时间排序允许更新跨越边界；稳定 ID 遍历不会因更新时间变动重复或跳过已有身份，但新建 ID 在已读边界之前时不会补读。需要一致集合的写入、删除、Apply 继续依赖其事务、版本与提交事实保护。
- **持久化 JSON 保真**：在入库与变更边界严格校验 JSON，杜绝把不可序列化数字洗成 `null`，确保领域扩展属性和空键原样往返。

---

## 构建与验证

```bash
# 编译 TypeScript 产物
pnpm --filter @loom-studio/application-data build

# 运行四大领域存储的单元测试套件
pnpm exec vitest run tests/unit/agent-store tests/unit/narrative-store tests/unit/state-store tests/unit/prompt-resource-store
```

---

## 正式文档

- [Data Architecture 统一持久化架构](../../docs/architecture/data/README.md)
- [Application 核心领域架构](../../docs/architecture/application/README.md)
- [Prompt Resource 树形存储设计](../../docs/architecture/application/prompt-build/README.md)
