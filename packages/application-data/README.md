# `@loom-studio/application-data`

> **状态**：Active Package Guide / Current Source Is Authority

`@loom-studio/application-data` 是 Loom Studio 统一的领域存储核心包。在架构简化演进中，它将原本分散的 `agent-store`、`narrative-store`、`state-store` 与 `prompt-resource-store` 深度整合为一个高内聚的持久化模块。

## 业务使命与四大领域存储

本包负责将 AIRP（AI Role-Play）四项核心业务实体的生命周期、状态迁移与快照安全持久化到共享的 SQLite 存储中：

1. **Agent 存储 (`src/agent/`)**：
   - 管理独立 Agent 运行会话（`AgentSession`）与 Append-only 的消息历史（`AgentMessage`）；
   - 保留 Agent Turn 的状态迁移轨迹。
2. **Narrative 存储 (`src/narrative/`)**：
   - 管理非线性交互叙事的时间线（`NarrativeTimeline`）、分支（`NarrativeBranch`）与内容节点（`NarrativeNode`）；
   - 支持多分支时间旅行、段落重演与祖先节点路径回溯。
3. **State 存储 (`src/state/`)**：
   - 维护结构化游戏与世界状态定义（`StateDefinition`）、当前状态值（`StateValue`）与版本修订记录；
   - 记录每次状态变更的操作者（Actor）与因果提交事实。
4. **Prompt Resource 存储 (`src/prompt-resource/`)**：
   - 持久化树形层级的提示词资源（Preset、Setting、Logic、Runtime 节点）；
   - 维护预设对设定（SettingMount）的动态挂载关系、版本快照与细粒度变更高频投影。

---

## 架构规约与外部依赖所有权 (Rules & Boundaries)

1. **共享 SQLite 事务管道**：
   - 本包**强依赖 `@loom-studio/data-engine`**，所有 SQLite 查询、表结构迁移与写事务必须接入 Data Engine 的统一 FIFO 队列；
   - **严禁私自建立第二套 SQLite 连接**，所有写操作必须通过 `transact()` 执行并触发对应的 `DataCommitFact` 提交通知。
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

- [`src/agent/`](./src/agent/)：导出 `createAgentStore` 及会话与消息类型；
- [`src/narrative/`](./src/narrative/)：导出 `createNarrativeStore` 及时间线/分支类型；
- [`src/state/`](./src/state/)：导出 `createStateStore` 及状态变更类型；
- [`src/prompt-resource/`](./src/prompt-resource/)：导出 `createPromptResourceStore` 及资源树操作类型。

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
