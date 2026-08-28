# Loom PoC Hardening Brief

> **Status**: Superseded historical draft
> **替代关系**: 不替代 `loom-poc-plan.md` / `loom-studio-poc-plan.md`，是它们的**收口工作**。
> **后继关系**: 完成后产出 `loom-adr-candidates.md`，正式版以那份文件为输入。
>
> **2026-05-14 收口说明**：本文是根目录遗留 draft，已被 [`03-poc-archive/loom-poc-hardening-brief.md`](03-poc-archive/loom-poc-hardening-brief.md)、[`04-next-steps/loom-adr-candidates.md`](04-next-steps/loom-adr-candidates.md) 与 [`04-next-steps/adr/`](04-next-steps/adr/) 取代。仅作历史参考，不作为正式版施工依据。

---

## 0. 这份文件存在的理由

两个 PoC 已分别证伪了"机械可行性"。但在源码审视中浮现了 6 条与文档不一致的现实形态（详见 §App-A）。其中：

- **观察 #3 (rpcs map 全局可见)** 一旦进正式版会被 extension 锁定为依赖，**必须现在改**。
- **观察 #6 (`@loom/st` 与 studio-poc 没合流)** 是两个 PoC 之间唯一缺失的接口验证，**做一次性价比最高**。
- 其余 4 条 (#1 #2 #4 #5) 信号已饱和，应当**归档**而非继续 PoC。

本文件的总目标：**用最小代价把两个 PoC 的"可信度"从 60% 拉到决策线，然后封存。**

---

## 1. 退出条件 (Exit Criterion)

> 当下一个 PoC 测试无论通过还是失败，都不会改变任何 ADR 候选清单时，PoC 阶段结束。

按这个判据，本文件定义的 4 项工作完成后就该停。**不接受**"再多做一两个测试更稳妥"的诱惑——稳妥是正式版的事。

---

## 2. Scope（包含什么）

### S1. 修复观察 #3：ExtensionHost 的 rpcs map 不能整张暴露
- **背景**：`plugin-loader.ts:9-15` 把 `rpcs: Map` 整张挂在 `host` 上；`st-mini/server/index.ts:24` 直接 `host.rpcs.get('t2i.generate')` 调用。
- **本质**：H5 "跨栈拼接" 的 PoC 通过姿势是**靠全局可见 rpcs map**，这跟架构 §9.6 "extensions communicate through RPCs" 矛盾。
- **目标姿势**：extension 只能通过 `host.callRpc(name, params)` 调用，且调用要进 trace。

### S2. 合流测试：让 `@loom/st` 的真 Pass 跑在 studio-poc kernel 下
- **背景**：现在 `extensions-bundled/st-mini` 的 2 个 stub Pass 跟 `packages/st` 14 个真 Pass 没有任何代码关系，charter §10 "loom-st 反哺 Core" 与 studio §13 "Concept Stack #1" 之间的链路在源码层未闭合。
- **目标姿势**：新建 `extensions-bundled/loom-st-real/`，server 端 `import { ... } from '@loom/st'` 重新导出 14 个 Pass，注册成 Pass Registry 条目；用一个 keystone-test 风格的脚本端到端跑通"加载真 chat fixture → compile → emit → flatten 出 OpenAI messages"。
- **明确接受**：合流测试**会**暴露问题。暴露的问题不在本文件 scope 内修，进 ADR 候选清单。

### S3. 归档：把 6 条观察转成 ADR 候选清单
- 输出 `docs/loom-adr-candidates.md`，每条带：背景 / 现象 / 候选方向 / 决策窗口（"PoC 阶段决"或"正式版前决"）。
- 见 §App-B 的初稿。

### S4. 收集：把已识别的问题/场景/边界条件冻结成测试目录
- 输出 `docs/loom-poc-questions.md`（详见 §App-C, §App-D, §App-E）。
- **不要**为了让它们通过去改 PoC，**只**做归档。它们是正式版的回归测试种子。

---

## 3. Non-Goals（明确不做什么）

| 不做 | 理由 |
|---|---|
| 优化 PoC 代码风格、加 lint、补 jsdoc | PoC 是一次性件 |
| 给 H1–H5 加更多覆盖率 | 信号已饱和 |
| 修复观察 #2（trace 物质代价：snapshot 默认开 + 无 retention） | 进正式版前裁决，不在 PoC 修 |
| 修复观察 #4（fire-and-forget trace） | 同上 |
| 引入新的 H6+ 假设 | 假设清单已封冻 |
| 把 studio-poc 升格成 studio | Stage-Pause 决策点，本文件不做 |
| 重写 `extensions-bundled/st-mini` | 让它跟 loom-st-real 并存，作为"假 stub"的反例存在 |

---

## 4. 工作分解（按依赖顺序）

### Step 1 — S1 rpcs 解耦（先做，不阻塞别的）
- [ ] 把 `ExtensionHost.rpcs: Map` 改成 `host.callRpc(name, params): Promise<any>`
- [ ] kernel 内部记录"extension X 调了 rpc Y"进 trace（这条本身就是观察 #3 的物质修复）
- [ ] 修改 `st-mini/server/index.ts` 适配新接口
- [ ] 跑一遍 `t2i-test` / `data-sharing-test` / `client-c-rogue` 全绿
- [ ] **完工标志**：grep 整个 studio-poc src，找不到任何 `host.rpcs` 直接访问

### Step 2 — S2 合流测试
- [ ] `pnpm --filter @loom/studio-poc add @loom/st@workspace:*`
- [ ] 新建 `extensions-bundled/loom-st-real/` + `manifest.json` + `server/index.ts`
- [ ] server 注册 14 个 Pass，并提供一个 `loom-st.compose(scenario)` rpc 返回 Pass 数组（仿照 `st-mini.compose`）
- [ ] 准备 1 份最小 fixture：1 character + 1 worldbook (2 entries) + 1 chat (3 turns)
- [ ] 写 `test/convergence-test.ts`：端到端跑通 compose → kernel.loom.run → 拿到 messages
- [ ] **观察并记录**（不修复！）：
  - capability `requires/provides` 链路是否在真 14 Pass 上仍然合法？
  - lazy content 三态在 trace snapshot 边界发生什么？(深 vs 浅 clone 副作用)
  - resolve barrier 在 14 Pass 中**到底有没有出现过一次**？没有的话整套 barrier 设计是不是 over-engineering？
  - Pass 抛错（手工注入一个故意失败的 Pass）trace 是什么形态？
- [ ] **完工标志**：convergence-test 跑完输出一段 console，包含上面 4 个问题的实际答案；不要求测试本身全绿。

### Step 3 — S3 ADR 候选清单
- [ ] 复制 §App-B 模板，填充每条
- [ ] 将 Step 2 暴露的新问题追加进去
- [ ] 标注决策窗口

### Step 4 — S4 问题/场景/边界条件归档
- [ ] 复制 §App-C/D/E 到 `docs/loom-poc-questions.md`
- [ ] 在每条上加一个 owner（loom-core / loom-studio / loom-st / 跨）
- [ ] 加一列"是否已被现有测试覆盖"

### Step 5 — 封存
- [ ] 在 `loom-poc-plan.md` 顶部加一行：`> 本文件已封存。后续工作见 loom-poc-hardening-brief.md → loom-adr-candidates.md`
- [ ] 在 `loom-studio-poc-plan.md` 顶部加同样的封存声明
- [ ] 在 `loom-poc-hardening-brief.md` 顶部把 status 从 draft 改成 sealed

---

## 5. 工作量与节奏

不给小时数。给**信号阶段**：

```
Step 1 (rpcs 解耦)        ─→ 半天，不通过不进 Step 2
Step 2 (合流)              ─→ 一天，是这次冲刺的产出主体
Step 3+4 (归档)            ─→ 半天
Step 5 (封存)              ─→ 一次提交
```

**节奏判据**：如果 Step 2 在合理时间内跑不通，**先停下追问"为什么跑不通"**——这个"为什么"本身就是要进 ADR 清单的信号，比让测试通过更有价值。

---

## Appendix A — 6 条观察（速查）

| # | 现象 | 处理 |
|---|---|---|
| 1 | trace 里 stackId 由客户端自报，kernel 不校验 | 进 ADR，正式版裁决 |
| 2 | `snapshot: 'boundaries'` 默认开 + SQLite 同步写 + 无 retention | 进 ADR，正式版前裁决 |
| 3 | ExtensionHost.rpcs 整张 Map 暴露给 extension | **本文件 S1 修复** |
| 4 | trace 写入 fire-and-forget 但实际靠 better-sqlite3 同步特性掩盖 | 进 ADR，正式版统一处理 |
| 5 | Pass 写权限无边界（rogue test 通过的代价是 system fragment 也被改） | 进 ADR，**等合流测试自然暴露后再裁决** |
| 6 | `@loom/st` 14 Pass 与 studio-poc 没合流 | **本文件 S2 修复** |

---

## Appendix B — ADR 候选清单（初稿模板）

```md
# Loom ADR Candidates (post-PoC)

## ADR-C-001: stackId 的信任模型
- 背景: studio-poc 的 transport 不校验 client 自报的 stackId
- 现象: trace 里 stackId 是 audit string，但架构文档把它当作 first-class identity
- 候选方向:
  A. 保持现状（仅 audit），在 ADR-001 里补一条"stackId 是软标识"
  B. 引入 stack 注册：每个 client connect 时声明 stackId，kernel 绑定后校验
  C. 不要 stackId，trace 只记 clientId + extensionId
- 决策窗口: **正式版前必须裁决**（影响 introspect 权限粒度）
- 相关: studio-architecture §9 Tenet IV, §14 Open Question #9

## ADR-C-002: Trace 物质成本
- 背景: snapshot 'boundaries' 默认开，每 Pass 一份 fragments 深拷贝写盘
- 现象: 1k 次/分钟 + 平均 10 Pass + 平均 fragments 50KB → ~500MB/分钟
- 候选方向:
  A. snapshot 默认 'off'，opt-in 才开
  B. snapshot 改为结构化 diff（mutations 已经有）
  C. 引入 retention 策略（LRU / 大小上限 / 压缩）
  D. trace 异步写 + 背压
- 决策窗口: **正式版前必须裁决**
- 相关: studio-architecture §14 Open Question #4

## ADR-C-003: Extension 间 RPC 的命名空间与权限
- (待 S1 修复后填充)

## ADR-C-004: Pass 写权限边界
- (待 S2 合流测试后填充)

## ADR-C-005: ...
```

---

## Appendix C — 问题集（带回答优先级）

> 所有问题都**没有**期望在 PoC 阶段解决；这是给正式版的输入。

### C.1 Core 层

1. **Pass.version 的语义**：semver？字符串相等？版本递增？
   - 影响：缓存 key、trace replay、Pass 演化兼容性
2. **`reads/writes: FieldPath[]` 是死字段还是策略字段？**
   - 现状：types 里有，运行期不读
   - 决策点：是要给 Studio 做依赖分析（动态 DAG），还是删掉
3. **Pass 抛错时 partial mutation 的语义**
   - 现在：抛了就停，已发生的修改还在 fragments[] 里
   - 替代：transactional Pass（要 deep clone，跟 #C2 抵触）
4. **resolve barrier "最多一个" 是真的吗？**
   - 真实场景：emit 前 resolve、传 LLM 前再 resolve（流式响应的合并）
   - 跟 ADR-001 §"最多一个 barrier" 抵触
5. **Pass 是不是真的纯函数**
   - 反例：`LoadChat` 要读文件系统/数据库，注定不纯
   - 现在 Core 没区分 source vs compile vs emit Pass 的副作用模型

### C.2 Studio 层

6. **trace 里看到的 `Pass[i]` 跟 invocation 时的 `Pass[i]` 是同一个吗？**
   - 反例：Pass instance 跨 invocation 共享，闭包里有状态
   - 检测姿势：Pass 实例化时让 kernel 强制 clone or freeze
7. **Extension 卸载时正在跑的 invocation 怎么办？**
   - 现在：没处理，直接 throw 还是悬挂未知
8. **多 client 同时写 docStore 同一 path**
   - 现在：DocumentStore 是裸 SQLite，没有事务隔离
9. **rpc 调用计入 trace 吗？**
   - S1 修完后必须计入，否则 H3 trace 自包含会破
10. **`system.introspect` 是否泄露其它栈的 Pass？**
    - 当前实现：会全列出。这跟 §9.5 "栈隔离" 矛盾

### C.3 跨层

11. **`@loom/st` 的 Pass 一旦进 extension，能不能直接 `import 'fs'`？**
    - 影响：Pass 纯函数承诺、能否在 client 端复用
12. **Concept Stack 的"私有词汇"在 trace 里如何脱敏？**
    - 例：character card 含成人内容；trace 转储时谁负责 redact
13. **Pass 跨栈复用的命名空间约定（§10.6 "事后引导"）够不够？**
    - rogue test 已经证明：不够
14. **Extension 的 `engines.loom` 语义是 semver 还是 capability set？**
15. **`@loom/st` 自己升级 → extension 重发布 → kernel 兼容旧 trace 吗？**

---

## Appendix D — 场景集

按"两个主体的交互模式"列：

### D.1 单 client × 单 stack（基本盘，已覆盖）
- 顺序 invoke 多次
- compose 后 splice Pass 再 invoke

### D.2 单 client × 多 stack
- 同时持有 st-mini + loom-st-real session
- 两栈共用一个 Pass（如未来的 `passext-upper`），trace 是否归到正确 stack

### D.3 多 client × 单 stack
- 两 client 都连同一 stack
- 同时 invoke：交错 trace 是否仍可重放
- 同时写 docStore 同一 path

### D.4 多 client × 多 stack（最坏情况）
- A 连 st-mini，B 连 loom-st-real
- A 调 introspect 时是否看见 B 的 Pass

### D.5 时间维度
- Extension 热重载时正在跑的 invocation
- Kernel 重启后 docStore 持久化数据是否仍可用
- Trace 跨 Pass 版本升级后的可读性

### D.6 失败模式
- Pass 抛同步错
- Pass 抛异步错（reject in awaited promise）
- Pass 内部死循环（kernel 怎么知道？）
- Pass 返回不合法的 fragments（id 重复、null content）
- rpc 超时 / network split
- SQLite 写盘失败（磁盘满）

---

## Appendix E — 边界条件

> "最小可观测边界"——给正式版做表驱动测试用。

### E.1 Fragment 形态
- `fragments = []`（空数组）
- `fragments = [{id: '', content: ''}]`（空 id 空 content）
- `id` 含特殊字符：`":"  "/"  "."  " "  "\n"  "\u0000"`
- `id` 重复（数组里两条同 id）
- `content` 是 `undefined` / `null` / `0` / `false` / `""`
- `content` 是 lazy function 但抛错
- `content` 是 lazy function 返回 Promise，Promise reject
- `content` 是 lazy function 返回另一个 lazy function（递归）
- `meta` 是 `null` vs 缺失 vs `{}`
- `meta` 含循环引用（JSON.stringify 会炸）
- `meta` 含 BigInt / Symbol / Date（JSON 不能序列化）

### E.2 Pass 形态
- `pass.run` 是 sync 函数（不是 async）
- `pass.run` 返回 `undefined`（隐式 mutation）
- `pass.run` 返回新数组（替换语义）
- `pass.run` 返回原数组同一引用（identity）
- `pass.version` 是 `0` / `""` / `undefined` / `null` / 浮点数
- `pass.requires/provides` 含重复条目
- `pass.reads/writes` 与实际行为不一致（声明读 A 实际改 B）

### E.3 Pipeline 形态
- 同一 Pass 实例出现两次
- Pass 顺序导致 capability 链断裂
- 多个 resolve barrier
- 没有任何 source Pass 直接进 compile
- Pipeline 长度 1 / 100 / 10000

### E.4 Mutation / Trace
- `snapshot: 'off'` + Pass 修改了 fragments 的同时 mutations 期望非空（应为空）
- `snapshot: 'full'` + 1MB content（内存）
- 跨 Pass 边界 fragments 数组长度变化（add / remove）
- Pass 修改 `fragments[i].id`（id 是不可变还是可变？）
- Trace 写入时 SQLite 锁竞争

### E.5 Studio 多体
- 1 client + 100 stack（client 持有 100 个 sessions）
- 100 client + 1 stack
- Extension manifest 有但 server 文件缺失
- 两 extension 注册同名 Pass

---

## 6. 验收

完工时本文件 §4 的所有 checkbox 打勾。**不**要求 §App-C/D/E 的任何一条被解决——它们是正式版的输入，不是 PoC 的产出。

封存后，正式版工作的第一份输入是：
1. `loom-adr-candidates.md`（决策清单）
2. `loom-poc-questions.md`（回归测试种子）
3. `extensions-bundled/loom-st-real/`（活的 reference extension）
