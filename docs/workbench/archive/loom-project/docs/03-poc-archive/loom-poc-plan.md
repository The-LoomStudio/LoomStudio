# Loom Core PoC Plan

> **Status: Sealed**
> 本文件已封存。后续工作见 `loom-poc-hardening-brief.md` → `loom-adr-candidates.md`

文档版本：v0.1-draft
状态：开始执行
前置文档：`docs/loom-whitepaper.md`（v0.2-draft）

---

## 0. 本文档的目的

这不是一个"开发排期"，而是一个**最小可验证原型（Proof of Concept）的范围定义**。目的只有一个：

> **用最少的代码，回答"白皮书里那些设计决策是否真的能落地"。**

POC 不追求功能完备、不追求 API 稳定、不追求发布。它的唯一产出是一份可运行的 demo + 一份 POC 回顾报告，回答一系列具体问题（§5）。如果 POC 回答"是"，我们进入 v0.1 正式开发；如果回答"否"，我们回到白皮书修正。

**POC 阶段的最高原则：宁可少做，不要多做。** 每一个被写进 POC 的功能都会污染我们对"这个设计是否成立"的判断。

---

```

```

## 1. POC 要回答的核心问题

我们在白皮书里做了很多设计决策，其中有一部分只有真的写出来才知道对不对。POC 要回答的是这些：

### Q1：极简 DataFragment 够用吗？

白皮书主张 `DataFragment` 只有 `{ id, content, meta }`。真写起来会不会发现缺字段？缺哪些？是"真的缺"（核心该加），还是"meta 里放一下就好"（Stdlib/插件问题）？

### Q2：Pass 的签名能统一同步和异步吗？

`(fragments) => fragments | Promise<fragments>` 这个联合签名在实际 pipeline 编排、错误处理、快照时机上会不会出现难以调和的麻烦？

### Q3：Lazy content 的三态（`string | Promise<string> | () => Promise<string>`）值得吗？

第三种（thunk）是否真的有价值？只留前两种会不会更简单？

### Q4：Pipeline 的快照机制以什么形态存在？

每个 Pass 结束后持有 IR 的引用就够了吗？要不要 structuredClone？性能影响如何？

### Q5：TS 泛型 `M` 的传播在真实代码里能不能忍？

`Pipeline<M>`、`Pass<M>`、`DataFragment<M>` 这一串泛型在用户代码里会不会刺眼到让人放弃？

### Q6：Stdlib 真的能和 Core 分开吗？

Stdlib 的 `StdMeta` 类型、`DedupById` Pass 和 Core 之间的依赖关系能不能做到"Stdlib 依赖 Core，Core 完全不知道 Stdlib 存在"？

### Q7：最小端到端的开发者体验有多痛？

一个不了解 Loom 的人，看完 README 能否在 10 分钟内跑出一个 demo？如果不能，是文档问题还是 API 问题？

---

## 2. POC 的范围界定

### 2.1 在范围内（In Scope）

| 项目                    | 说明                                                               |
| ----------------------- | ------------------------------------------------------------------ |
| `@loom/core` 最小包   | 类型定义 + Pipeline runtime + ResolutionPass                       |
| `@loom/stdlib` 最小包 | `StdMeta` 类型 + `DedupById` Pass                              |
| 一个最小端到端 example  | 不超过 50 行用户代码，演示从 fragments 到 fragments 的完整一次编译 |
| 一份 POC 回顾报告       | 对 §1 的七个问题逐条作答                                          |
| 最基础的单元测试        | 只覆盖"Pipeline 的确定性"和"Pass 签名的同步/异步"这两件事          |

### 2.2 明确不在范围内（Out of Scope）

这部分是 POC 成败的关键。写进 POC 的每一项都要付代价，所以**默认排除**以下所有内容，除非有明确论证：

- DevTools（任何可视化）
- 快照的持久化（先只在内存里持有）
- 错误的结构化（先用原生 Error 抛出）
- 模板/插值能力（`@loom/template` 不做）
- Token 预算、排序、聚合相关的 Pass（Stdlib v0.1 故意不做）
- 发布相关的一切（npm 包名占位、版本策略、CI）
- 文档站、README 以外的用户文档
- Benchmark 性能评估（POC 不谈性能）
- 和任何 LLM API 的集成

### 2.3 灰色地带的决策

- **Monorepo 还是单包？** POC 阶段用 **pnpm workspace monorepo**，`packages/core` 和 `packages/stdlib` 同仓发布。理由：真正验证"Stdlib 能否独立于 Core 存在"需要两个包的目录分离，单包做不到。
- **要不要 lint？** 只配最小 `tsconfig` 和 `tsup` 构建，不配 ESLint、Prettier、Husky。POC 阶段代码风格分歧容忍。
- **要不要 CI？** 不要。POC 在本地跑通即可。

---

## 3. POC 目录结构

```
loom/
├── package.json                 # 根 workspace
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── packages/
│   ├── core/
│   │   ├── package.json         # name: "@loom/core"
│   │   ├── src/
│   │   │   ├── index.ts         # 公开 API 出口
│   │   │   ├── types.ts         # DataFragment / Pass / Pipeline 类型
│   │   │   ├── pipeline.ts      # Pipeline 实现
│   │   │   ├── resolution.ts    # ResolutionPass 实现
│   │   │   └── errors.ts        # 最小错误类型
│   │   └── test/
│   │       ├── pipeline.test.ts
│   │       └── resolution.test.ts
│   └── stdlib/
│       ├── package.json         # name: "@loom/stdlib"
│       ├── src/
│       │   ├── index.ts
│       │   ├── meta.ts          # StdMeta 类型
│       │   └── dedup-by-id.ts   # DedupById Pass
│       └── test/
│           └── dedup-by-id.test.ts
└── examples/
    └── basic/
        ├── package.json
        └── index.ts             # 端到端 demo（< 50 行）
```

**目录结构的设计要点**：

1. `core` 和 `stdlib` 物理隔离，`stdlib/package.json` 里 `@loom/core` 是 dependency。这让 Q6 的答案真实可信。
2. `examples/basic` 是独立 package，`import` Loom 必须走包名而不是相对路径——这模拟真实用户体验。
3. 不做 `docs/`、`website/`、`CHANGELOG.md`——这些是发布期的产物。

---

## 4. 技术选型（POC 阶段）

这里只是 POC 的选择，不是长期承诺。

| 领域     | 选择                  | 理由                                                 |
| -------- | --------------------- | ---------------------------------------------------- |
| 包管理器 | pnpm                  | workspace 能力好；用户未必都用 pnpm，但 POC 阶段足够 |
| 构建     | tsup                  | 零配置、输出 ESM+CJS、适合库                         |
| 测试     | vitest                | 和 tsup 搭配无痛；不用 jest 是为了少一层配置         |
| 语言     | TypeScript 5.x        | strict 模式开启，`noUncheckedIndexedAccess` 开启   |
| Runtime  | Node 20+ / 现代浏览器 | 直接依赖 `structuredClone`，不做 polyfill          |

---

## 5. POC 的最小 API 形态

下面是我们要在 POC 里实现的全部公开 API。**任何超出这个清单的 API 都必须被挑战后再加入。**

### 5.1 `@loom/core`

```ts
// 类型
export interface DataFragment<M = unknown> {
  readonly id: string
  readonly content: string | Promise<string> | (() => Promise<string>)
  readonly meta: M
}

export interface ResolvedFragment<M = unknown> {
  readonly id: string
  readonly content: string
  readonly meta: M
}

export interface Pass<M = unknown> {
  readonly name: string
  run(
    fragments: ReadonlyArray<ResolvedFragment<M>>,
    ctx: PassContext
  ): ResolvedFragment<M>[] | Promise<ResolvedFragment<M>[]>
}

export interface PassContext {
  readonly signal?: AbortSignal
  // POC 阶段仅此两个字段，未来扩展
  readonly snapshots: ReadonlyArray<PipelineSnapshot>
}

export interface PipelineSnapshot<M = unknown> {
  readonly passName: string
  readonly fragments: ReadonlyArray<ResolvedFragment<M>>
  readonly durationMs: number
}

export interface PipelineResult<M = unknown> {
  readonly fragments: ReadonlyArray<ResolvedFragment<M>>
  readonly snapshots: ReadonlyArray<PipelineSnapshot<M>>
}

// 函数
export function pipeline<M = unknown>(
  passes: ReadonlyArray<Pass<M>>
): {
  run(
    input: ReadonlyArray<DataFragment<M>>,
    options?: { signal?: AbortSignal }
  ): Promise<PipelineResult<M>>
}
```

POC 中的 `pipeline` 永远 async（因为要 resolve lazy content），但 pipeline **内部不强制每个 Pass 都 async**——同步 Pass 直接返回数组即可，runtime 用 `await Promise.resolve(...)` 统一处理。

### 5.2 `@loom/stdlib`

```ts
// meta.ts
export interface StdMeta {
  subject?: string
  kind?: string
  source?: string
  volatility?: number
  priority?: number
  tokens?: number
  createdAt?: number
}

// dedup-by-id.ts
export function DedupById<M = unknown>(options?: {
  strategy?: 'keep-first' | 'keep-last'
}): Pass<M>
```

就这么多。真的只有这么多。

---

## 6. POC 里故意留下的坑

这些是 POC 不解决、但要**写进回顾报告的已知问题**，让 v0.1 正式开发能直接继承：

`ResolutionPass` 的并发控制（`Promise.all` 全量并发够不够？能不能 opt-in 限流？）

Pass 内部抛错时，已完成的 snapshots 是否返回给调用方（POC 里先全部丢弃）

`AbortSignal` 在 Pass 内部的传递语义（POC 只做"pipeline 级别 abort"，不强制 Pass 响应）

`structuredClone` 的开销：POC 里**每个 Pass 之间不 clone**，由 TypeScript `readonly` 保证约定，不保证运行时不可变——这是有意识的权衡，要验证是否足够

错误信息里"哪个 Pass / 哪个 fragment"的定位（POC 只做基础包装，不做漂亮的堆栈）

---

## 7. POC 的交付物

POC 完成的判定标准是以下四项都达成：

1. `pnpm -r build` 成功构建两个包
2. `pnpm -r test` 两个包的单元测试全通过
3. `pnpm --filter basic start` 运行 example，能看到两条预期输出：
   - 一次正常 pipeline 运行的最终 fragments
   - 每个 Pass 的 snapshot 摘要（name + fragment count + durationMs）
4. 一份 `docs/loom-poc-review.md`，对 §1 的 Q1–Q7 逐条作答，并给出 v0.1 调整建议

---

## 8. POC 的例子长什么样

这是白皮书附录 A 的极简版本——为了验证"用户代码能多干净"。

```ts
// examples/basic/index.ts
import { pipeline, type Pass } from '@loom/core'
import { DedupById, type StdMeta } from '@loom/stdlib'

// 一个极简自定义 Pass：按 meta.priority 降序
const SortByPriority: Pass<StdMeta> = {
  name: 'SortByPriority',
  run: (fragments) =>
    [...fragments].sort(
      (a, b) => (b.meta.priority ?? 0) - (a.meta.priority ?? 0)
    ),
}

const result = await pipeline<StdMeta>([
  DedupById({ strategy: 'keep-last' }),
  SortByPriority,
]).run([
  { id: 'sys:1',     content: 'You are a helpful assistant.', meta: { priority: 100 } },
  { id: 'user:hint', content: 'Be concise.',                   meta: { priority: 50 } },
  { id: 'user:hint', content: 'Be very concise.',              meta: { priority: 50 } }, // 同 id
  { id: 'ctx:1',     content: Promise.resolve('Context A'),    meta: { priority: 80 } },
])

console.log('final fragments:')
for (const f of result.fragments) console.log(`  [${f.id}] ${f.content}`)

console.log('\nsnapshots:')
for (const s of result.snapshots) {
  console.log(`  ${s.passName}: ${s.fragments.length} fragments in ${s.durationMs.toFixed(2)}ms`)
}
```

预期输出（顺序稳定）：

```
final fragments:
  [sys:1]     You are a helpful assistant.
  [ctx:1]     Context A
  [user:hint] Be very concise.

snapshots:
  ResolutionPass:   4 fragments in 0.XX ms
  DedupById:        3 fragments in 0.XX ms
  SortByPriority:   3 fragments in 0.XX ms
```

**这段例子的信号量极高**：

- 用户代码 20 行，导入 2 行，pipeline 4 行，fragment 数据 6 行
- 没有任何配置对象、没有 builder pattern、没有类
- 同步和异步 Pass 在写法上完全一样
- `StdMeta` 通过泛型传播，`f.meta.priority` 有 TS 类型提示

如果这段例子让你或我感到"哪里别扭"，就是 POC 告诉我们白皮书哪里需要修。

---

## 9. 我建议的推进节奏

这不是时间表，是**顺序**。每一步完成后再走下一步，避免回头改。

1. 建仓、装依赖、配 workspace 和 tsconfig
2. 写 `@loom/core` 的类型（`types.ts`），**先只写类型，不写实现**，让类型本身可编译
3. 写 `@loom/core` 的 pipeline 实现（`pipeline.ts` + `resolution.ts`）
4. 写 core 的两个测试：`pipeline.test.ts`（验证 snapshot 顺序和同步/异步混用）、`resolution.test.ts`（验证三态 content）
5. 写 `@loom/stdlib` 的 `StdMeta` 和 `DedupById`
6. 写 example
7. 跑通后，写 POC 回顾报告

每一步结束先口头 review 再进下一步，不是边写边改。

---

## 10. 开工前决议（已锁定）

以下四项在开工前已对齐，之后如需变更需同等正式地走一遍讨论。

1. **包名前缀：`@loom/`**。POC 阶段不考虑 npm publish 和 scope 抢占，本地 workspace 内直接以 `@loom/core`、`@loom/stdlib` 命名即可。未来真要发布时再处理 scope 归属问题。
2. **不写 README，不写文档**。白皮书就是当前阶段的 README；POC 只产出代码和 example。example 的可读性是 API 的最终试金石。
3. **POC 代码就落在当前这个仓库**。这不是要发布的产品，只是本地测试。文档（`docs/`）和代码（`packages/`）并存在一棵树里对当前阶段最省心，未来真正发布时再考虑拆分。
4. **POC 回顾报告可以推翻白皮书的任何决策**。POC 的职责是"验证白皮书"而非"实现白皮书"。如果验证过程中发现某个决策落地后很别扭或很复杂，那就是白皮书要改的信号——我们对这个方向有信心，所以不怕路上修正。

---

## 11. 附：POC 成功的真正判据

POC 不是"跑通了"就成功。POC 成功的判据是：

> **POC 结束后，我们对白皮书的信心增加或减少——总之不再是含糊的"感觉挺好"。**

如果 POC 跑通了但我们仍然说不清楚"极简 DataFragment 是否够用"，那 POC 就失败了——哪怕代码一行没报错。

所以 POC 的产出**不是代码，是答案**。代码只是获得答案的手段。这一点我希望在开工前就对齐。
