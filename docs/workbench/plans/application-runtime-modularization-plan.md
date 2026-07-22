# Application Runtime 模块化与命名边界计划

> **状态**：Draft / Discussion
> **目的**：在项目早期阻止 `runtime.ts` 演化为 God Object，并在拆分前先确定领域分类、文件职责和命名规则。
> **当前阶段**：只讨论和记录边界，不实施大规模重构。

---

## 0. 当前结论

`packages/application-runtime/src/runtime.ts` 已同时承载 Card、Provider、Model Profile、Agent Runtime Profile、Session、Workspace、PromptBuild、Turn、Timeline 与 Branch 流程。问题不只是文件超过 1000 行，而是多个领域的状态读写、业务校验和副作用都通过同一个对象继续增长。

当前不应直接按行数或方法数量机械拆文件。先回答“领域如何分组、哪些流程属于跨领域编排、类型与文件如何命名”，再进行渐进迁移。

目标形态只有一条硬约束：

```text
createApplicationRuntime()
  负责创建 ctx、组合领域能力、返回 public API
  不直接实现具体领域的 Document CRUD 或长业务流程
```

## 1. 为什么现在只写 Plan

- Card、Workspace、PromptBuild、Session 和 Agent 的最终领域边界仍在演进；
- 当前已有 `card.ts`、`agent.ts`、`workspace.ts`、`prompt.ts` 等文件，但职责粒度并不统一；
- `types.ts` 同时包含 public operation types 与 Document content types，是否拆分需要先确定 public API 组织方式；
- 过早建立目录、Service class 或 Repository 抽象，可能只是把一个 God Object 变成多个无意义的小文件。

因此，本计划不批准引入 DI 容器、Repository 层、Base Service、Command Bus 或“为未来扩展”的通用框架。

## 2. 当前文件初步判断

| 文件 | 当前性质 | 初步判断 |
|---|---|---|
| `runtime.ts` | 所有 Application public operations 的实现与组装 | 明确需要逐步收缩 |
| `types.ts` | public API、input/result、Document content types | 文件大但不等同于 God Object，是否拆分待讨论 |
| `workspace.ts` | Workspace artifact、节点 CRUD、投影配置与读取 | 基本属于单一领域，但内部子边界需要确认 |
| `card.ts` | Card normalization、snapshot、macro | 职责相对集中 |
| `agent.ts` | Agent binding、transcript、Provider/Profile existence checks | Agent 与 Provider 职责已有混合 |
| `gateway.ts` | Provider 解析与模型调用 | 职责相对集中 |
| `prompt.ts` / `prompt-build-pipeline.ts` / `prompt-builder.ts` | PromptBuild 编排、Core pipeline、纯编译模型 | 命名层级和彼此边界需要统一 |
| `timeline.ts` | Session/Branch/Entry 的读取与定位 | 可能属于 Session/Narrative 领域 |

## 3. 候选领域切片

以下只是讨论起点，不是最终目录方案：

1. **Cards**
   - Card CRUD；
   - normalization；
   - snapshot 与 opening/setting legacy compatibility。

2. **Providers**
   - Provider Account；
   - Model Profile；
   - Gateway 调用与 provider payload。

3. **Agents**
   - Agent Runtime Profile；
   - Agent binding；
   - Agent transcript。

4. **Workspaces / Prompt Sources**
   - Workspace artifact import/export；
   - Context Asset CRUD；
   - Projection Order Profile；
   - PromptBuild 输入读取。

5. **Sessions / Narrative**
   - Session 与 Branch 生命周期；
   - Timeline；
   - Narrative Entry；
   - fork 操作。

6. **Runs / Turn Execution**
   - `previewPrompt`；
   - `submitTurn`；
   - Run、Runtime Entry、Commit Candidate、State Snapshot；
   - Provider 调用前后的跨领域编排。

其中 `submitTurn` 是最需要讨论的边界：它天然横跨 Session、PromptBuild、Provider、Agent Transcript 和 Run 持久化，不能为了“领域纯净”被拆成难以追踪的事件链。更可能的形态是保留一个显式、可测试的 Turn use case，由它调用各领域公开能力。

## 4. 文件与命名待决问题

在编码前需要确认：

1. 继续采用平铺文件，还是当某一领域出现多个实现文件后再升级为目录？
2. 领域入口使用 `cards.ts`、`card-runtime.ts`、`card-service.ts`，还是更朴素的 `card-operations.ts`？
3. `runtime.ts` 返回单一 `ApplicationRuntime` 是否保留，还是内部先组合多个 capability object、外部仍保持同一 public API？
4. `types.ts` 是否按 `operations` 与 `documents` 拆分，还是继续作为稳定 public type surface？
5. `prompt-builder.ts` 的 “Builder” 是否准确，还是它本质上是纯 Compiler？
6. `workspace.ts` 是否同时承担了 Artifact、Tree Mutation 和 Prompt Source Projection 三种子职责？
7. `agent.ts` 中 Provider/Profile existence check 应归 Agent、Provider，还是共享的 Application document guard？

## 5. Core 访问规则需要同步收口

当前 Guide 存在冲突：

- `guide/code-review.md` 表述为只有 `packages/loom-runner` 可以直接访问 `@loom/core`；
- `guide/project-structure.md` 允许 `packages/application-runtime` 的第一方 PromptBuild pipeline 使用 Core public API。

在讨论 PromptBuild 文件边界时，需要确认并统一为一条正式规则。当前实现只允许：

```text
packages/loom-runner
packages/application-runtime 内的第一方 PromptBuild pipeline
```

其他 Kernel、Document Store、Extension Host、Client 与 Extension 仍不得直接依赖 Core。

## 6. 渐进迁移原则

未来获得确认后，按业务改动顺手迁移，不进行一次性全文件重写：

1. 先迁移低耦合 CRUD，例如 Card 或 Provider Profile；
2. 每次迁移只建立一个真实使用的领域入口；
3. 保持 `ApplicationRuntime` public API 和 RPC contract 不变；
4. 迁移前后复用现有合同测试；
5. 最后处理 `submitTurn`，因为它承担真实的跨领域 use case；
6. 每次删除 `runtime.ts` 中已经迁出的实现，禁止保留兼容壳和重复路径。

## 7. 实施门槛

满足以下条件后才进入 Implementation：

- 候选领域切片获得确认；
- 文件/目录命名规则获得确认；
- `submitTurn` 的跨领域编排归属获得确认；
- Core 访问规则完成统一；
- 选定第一个最小迁移切片及对应测试。

## 8. 非目标

- 不追求所有文件低于固定行数；
- 不因为 `types.ts` 或静态数据文件较长就拆分；
- 不引入新的运行时依赖；
- 不改变 RPC 方法名或现有 Document schema；
- 不在本计划阶段修改生产代码。
