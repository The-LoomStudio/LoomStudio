# Loom ADR Candidates (post-PoC)

> **Status: 已全部裁决 (2026-04-29)**
> 七个候选已分别 promote 为 ADR-001 ~ ADR-007，详见 [`adr/README.md`](./adr/README.md)。
> 本文件保留作为候选阶段的历史快照与决策溯源；正式决策以 ADR 文件为准。
>
> | 候选 | 最终 ADR | 决策方向 |
> | --- | --- | --- |
> | C-001 | [ADR-001](./adr/ADR-001-stackid-trust-model.md) | A 路线（软标识） |
> | C-002 | [ADR-002](./adr/ADR-002-trace-default-mutation-only.md) | **新增 D+A 组合**（mutation-only 默认开 + snapshot 默认 off） |
> | C-003 | [ADR-003](./adr/ADR-003-rpc-namespace-enforcement.md) | B 精简版（命名空间强制 + 冲突校验，不引入 consumes 鉴权） |
> | C-004 | [ADR-004](./adr/ADR-004-pass-write-soft-ownership.md) | **新增 C 路线**（owner 不阻拦 + 越权写 Diagnostic） |
> | C-005 | [ADR-005](./adr/ADR-005-pass-registry-factory.md) | A 路线（采纳 Spike 工厂化方案） |
> | C-006 | [ADR-006](./adr/ADR-006-capability-validation-as-stdlib-linter.md) | **新增 C 路线**（校验下沉到 Stdlib 作为 lint 工具） |
> | C-007 | [ADR-007](./adr/ADR-007-remove-resolve-barrier.md) | B 路线（移除 barrier，Pipeline 回归纯同步） |

## ADR-C-001: stackId 的信任模型
- **背景**: studio-poc 的 transport 不校验 client 自报的 stackId
- **现象**: trace 里 stackId 是 audit string，但架构文档把它当作 first-class identity
- **候选方向**:
  - A. 保持现状（仅 audit），在 ADR-001 里补一条"stackId 是软标识"
  - B. 引入 stack 注册：每个 client connect 时声明 stackId，kernel 绑定后校验
  - C. 不要 stackId，trace 只记 clientId + extensionId
- **决策窗口**: **正式版前必须裁决**（影响 introspect 权限粒度）
- **相关**: studio-architecture §9 Tenet IV, §14 Open Question #9

## ADR-C-002: Trace 物质成本
- **背景**: snapshot 'boundaries' 默认开，每 Pass 一份 fragments 深拷贝写盘
- **现象**: 1k 次/分钟 + 平均 10 Pass + 平均 fragments 50KB → ~500MB/分钟
- **候选方向**:
  - A. snapshot 默认 'off'，opt-in 才开
  - B. snapshot 改为结构化 diff（mutations 已经有）
  - C. 引入 retention 策略（LRU / 大小上限 / 压缩）
  - D. trace 异步写 + 背压
- **决策窗口**: **正式版前必须裁决**
- **相关**: studio-architecture §14 Open Question #4

## ADR-C-003: Extension 间 RPC 的命名空间与权限
- **背景**: PoC 修复了 `host.rpcs` 裸露的问题，改为 `callRpc` 且记入 trace，但所有 extension 对所有 RPC 可见。
- **现象**: 任何 Extension 都可以调用（例如 `st-mini` 可以无限制调用 `t2i.generate`）。
- **候选方向**:
  - A. 默认开放，只依赖约定和 trace 审计（"软隔离"）。
  - B. 引入 RPC 鉴权：manifest 里需要声明 `consumes: {"rpc": ["t2i.generate"]}`，否则 `callRpc` 拦截。
- **决策窗口**: **正式版前裁决**。

## ADR-C-004: Pass 写权限边界
- **背景**: Rogue Client 测试成功组合了异构 Pass，但也证明了客户端/Pass 可以随意篡改任何 Fragment。
- **现象**: Rogue Client 可以修改系统提示词 Fragment 的内容，而 Kernel 不加阻拦。
- **候选方向**:
  - A. 不加阻拦。Fragment `id` 是不可变但 `content` 可变，责任在编写 Pass 的人。
  - B. 引入 Field-level 冻结或权限校验，与 `reads/writes` 声明挂钩。
- **决策窗口**: **PoC 阶段决（由于信号已饱和，正式版前决即可）**。

## ADR-C-005: 运行时参数与静态 Registry 的冲突
- **背景**: `@loom/st` 合流测试暴露出，真场景下的 Source Pass (如 `LoadChat`) 大多是带参的工厂函数。
- **现象**: 原版 `PassRegistry` 设计为只能静态注册实例化好的 `Pass` 对象，导致依赖运行期数据 (chat/character) 的 Pass 无法作为全局共享组件在 Kernel 注册。
- **Spike 验证结果**: 
  - 我们在 PoC 中进行了一次 Spike，将 `PassRegistry` 改造为支持注册“工厂函数 (`(params) => Pass`)”。
  - 客户端通过传递 `{ name: 'ST.LoadChat', params: { chat: [...] } }` 的形式，成功让 Kernel 在运行时动态实例化了 Pass。
  - **结论**: 这种“配置化”流水线声明方式（Payload + Factory）在架构上是可行的，并且能够将 Source Pass 的数据组装逻辑留在客户端，执行逻辑留在服务端，完美解决了静态注册的冲突。
- **候选方向**:
  - A. **采纳 Spike 方案**：彻底改造正式版 `PassRegistry`，支持注册工厂函数，`loom.run` 接受配置对象。
  - B. 保持现状，让 Source Pass 彻底不进 Registry，全由客户端本地跑完生成 Fragments。
- **决策窗口**: **正式版前必须裁决**。

## ADR-C-006: Capability 链路名存实亡
- **背景**: 合流测试发现 `@loom/st` 的 14 个真实 Pass 中并未定义 `requires/provides`。
- **现象**: 架构设计中的 DAG 依赖分析和检查，在现实实现中并没有被遵守和验证。
- **候选方向**:
  - A. 强制要求：在正式版中通过 TS 类型或运行期断言强制检查 `requires/provides`。
  - B. 承认现实：将 `requires/provides` 降级为单纯的文档/建议字段，或彻底从 `Pass` 接口中删除。
- **决策窗口**: **正式版前裁决**。

## ADR-C-007: Resolve Barrier 设计闲置
- **背景**: 合流测试发现真 14 Pass 均未触发异步/延迟求值（Lazy Content）。
- **现象**: `run()` 皆为同步函数，无 `PipelineResult` 返回，也没有出现 "Resolve Barrier"。
- **候选方向**:
  - A. 维持设计，以备未来复杂场景需要。
  - B. 简化架构，移除 "最多一个 resolve barrier" 的复杂概念，回归纯同步 Fragment 处理，把异步留给 RPC/Client 端。
- **决策窗口**: **正式版前裁决**。
