# Historical Architecture Baseline · Loom Core 边界与执行模型基线

状态：Historical / Superseded by Core v0.1 ADRs
前置文档：`loom-whitepaper.md`、`loom-scope.md`、`loom-observability.md`、`loom-st-charter.md`
来源：由《Loom 架构问题答复》冻结整理而来，作为首次对齐的决策快照

> **2026-05-14 收口说明**：本文保留早期架构讨论语境，不再属于正式 `ADR-001~ADR-007` 编号序列。正式 ADR-001 是 [`../04-next-steps/adr/ADR-001-stackid-trust-model.md`](../04-next-steps/adr/ADR-001-stackid-trust-model.md)。
>
> 本文中关于 Resolve Barrier、Thunk、Core Scope、Promise content、Core capability validation 的结论已被 [`../04-next-steps/loom-core-v0.1-engineering.md`](../04-next-steps/loom-core-v0.1-engineering.md) 与 ADR-001~007 覆盖。正式 v0.1 口径：Core 全同步、`Fragment.content` 为 `string`、无 Resolve Barrier、无 Core Scope、capability validation 由 Stdlib / DevTool lint 处理。

---

## 0. 本文档的目的

这份文档不是继续罗列问题，而是对当前最关键的 18 个问题给出**可执行的基线答案**。

目标只有三个：

1. 让 Core 能开工，而不是继续停在抽象层拉扯。
2. 让 `loom-st` 的 M0 不再建立在模糊前提上。
3. 让以后会出现的问题被提前放进正确的层级，而不是临时塞进 Core。

本文的裁决标准遵循三条原则：

- **单一真相来源**：一个语义只能有一个最终权威，不能双轨并存。
- **Core 尽量少做**：能放到领域层、Stdlib、工具层解决的，不放进 Core。
- **先要可解释，再要可优化**：v0.1 先追求语义清楚和调试清楚，性能优化不反过来绑架模型。

本文已作为 ADR-001 被采纳。它的职责是保留这次对齐时的决策语境，而不是立即原地覆盖其他主文档。

---

## 1. 先给结论

下面 8 条建议应作为动工前的锁定项：

1. **顺序的唯一真相是当前 `fragments[]` 的物理顺序。**
   `meta.order`、`meta.position`、`meta.sortKey` 都只是排序 Pass 的输入或派生字段，不与数组顺序竞争。

2. **Source / Compile 抛错默认致命；Thunk 抛错单独配置。**
   引擎主循环保持 fail-fast，只有 Resolve 层允许做 per-fragment 降级策略。

3. **Core 不自动生成 fragment id。**
   进入 Core 的 fragment 必须已有稳定 id；Core 只负责校验非空与唯一。

4. **Core 不自动并行 Pass。**
   Pass 串行；Pass 内部是否并发由 Pass 自己决定；Thunk 默认 lazy，不做隐式预热。

5. **Tokenizer 不进 Core。**
   Token 计数器通过显式接口注入到预算类 Pass。

6. **多 Source 合并不属于 Core。**
   由 `loom-st` 的 source adapter 层把外部输入整理成初始 `Fragment[]`，再交给 Core。

7. **Resolve 应该是显式 barrier，而不是“整个 run 的最后一步”。**
   这样才能容纳 ST 的 `after macro` regex、resolved text transform 等场景。

8. **Response 生命周期不进入 loom-st M0。**
   未来如要支持，做成与 prompt compile 对称的第二条 pipeline，而不是把两者揉进一条 run。

本轮补充再锁 5 条二阶裁决：

9. **Resolve barrier 在 v0.1 中是单次、显式、最多一个。**
   它不是普通 Pass；一旦越过 barrier，后续 Pass 不得重新引入 thunk 或新的 scope 写入语义。

10. **Source adapter 接入 Core 采用“外部先产 `Fragment[]`，再调用 `pipeline.run()`”的手动编排形态。**
    `loom-st` 可以提供 helper，但 Core 不扩展为 `runWithSources(...)`。

11. **`createDerivedId()` 这类 helper 应存在，但归属独立 utility 包，而不是 Core 或 Stdlib 语义层。**
    它提供约定，不接管 id 策略。

12. **受控 thunk 的白名单扩展点放在中立 utility 层。**
    Core 不感知宏名；领域包自己注册宏与行为。

13. **`version` 字段从 v0.1 就进入 Pass 契约。**
    未声明版本的 Pass 允许兼容运行，但应视为不可缓存，并暴露显式 diagnostic。

---

## 第一层 · 阻塞 Core 实现

### 1. Fragment 的顺序语义由谁承载

**结论**

顺序的唯一权威是 **当前 snapshot 中 `fragments[]` 的数组顺序**。

- Emit 按数组顺序消费
- DevTool 按数组顺序展示
- Diff / Mutation 里的 `move` 也按数组 index 计算

`meta.order`、`meta.position`、`meta.sortKey` 的角色是：

- 输入字段：供排序 Pass 读取
- 派生字段：供 DevTool 展示“为什么会排成这样”
- 非权威字段：不会在引擎里自动覆盖数组顺序

**理由**

如果同时承认“数组顺序”和“逻辑顺序字段”都是真相，那么会立刻出现三套问题：

- Emit 到底按哪个走
- DevTool 展示的“当前顺序”到底是哪一个
- 排序 Pass 是真的改变了结果，还是只改了 metadata

这会把一个本来机械的问题变成双账本系统，后面几乎所有 Pass 都会跟着变脆弱。

**直接影响**

- `OrderByPosition` 这类 Pass 的职责是：读 `meta.position` / `meta.order`，产出**重排后的数组**
- 如果需要保留排序依据，Pass 可以额外写 `meta.sortKey`
- DevTool 可以同时显示“当前位置 index”和“排序依据字段”，但只有 index 参与真实执行

---

### 2. 错误边界的三层行为

**结论**

采用“**主循环 fail-fast，Resolve 单独给策略**”的模型。

- **Source 层错误**：默认致命，终止整个 run
- **Compile Pass 错误**：默认致命，终止整个 run
- **Thunk / Resolve 错误**：默认致命，但允许通过 Resolve policy 改成非致命降级

建议的最小策略面：

```ts
type ResolveErrorPolicy =
  | 'throw'
  | 'empty'
  | 'placeholder'
```

默认值：`'throw'`

**理由**

Source 和 Compile 的错误是“结构错误”：

- Source 错了，输入 IR 本身就没立住
- Compile 错了，后续所有 Pass 都可能建立在坏状态上

Thunk 错误不同。它是 per-fragment、per-resolution 的错误，天然更适合局部降级。

如果把三层都做成“可继续 / 可中止 / 可配置”的总开关，引擎主循环会立刻变复杂，而且 DevTool 也更难解释。

**直接影响**

- `PipelineError` 仍然是 Pass 级和结构级错误的主渠道
- Resolve 层额外产出 `Diagnostic`，例如 `loom/thunk-error`
- 若用户想让 Source 或 Compile “软失败”，应由该 Pass 自己 try/catch 并显式产出降级 fragment，而不是让 Core 自动帮他继续

---

### 3. Fragment ID 的来源

**结论**

Core 不负责自动生成 id。
**谁创建 fragment，谁负责给出稳定 id。**

稳定性要求分两层：

1. **单次 run 内必须唯一**
2. **跨 run 应尽量稳定**，前提是该 fragment 的语义身份没有变化

推荐规则：

- Source adapter 生成的 fragment：按外部数据路径或业务主键派生
- Compile Pass 新建的 fragment：按 `passName + upstream ids + stable local key` 派生
- 禁止默认随机 id 作为正式语义 id

**理由**

id 一旦不稳定，后面三件事都会垮：

- Trace 跨 run diff
- Pass / Fragment 级缓存
- DevTool 里的来源追踪

如果 Core 自己偷偷生成随机 id，看似省事，实际上会把“暂时没想清楚 identity”伪装成“系统已经有 identity”。

**直接影响**

- Core 需要做的不是生成，而是验证：空 id、重复 id 直接报错
- 为避免各 adapter 各自发明哈希风格，后续应提供独立 utility 包级 helper，例如 `createDerivedId(namespace, ...parts)`
- 该 helper 提供统一约定，不改变“谁创建 fragment，谁拥有 id 决策权”
- `loom-st` 的各类 source adapter 需要尽早定义 id 规则，例如角色卡字段路径、世界书条目 id、聊天消息 turn index

---

### 4. Pass 的异步并发模型

**结论**

v0.1 锁定为：

- **Pass 之间串行**
- **Pass 内部如何并发由 Pass 自己决定**
- **Thunk 默认 lazy**
- **Resolve 按最终顺序执行，不做隐式预热**

`reads/writes/requires/provides` 在 v0.1 只用于：

- 诊断
- 可视化
- 未来调度优化的预留

**不**用于自动并行执行 Pass。

**理由**

自动并行 Pass 会同时引入三类复杂度：

- 冲突检测是否可信
- Trace 时间线怎么展示才不误导
- 同一输入在不同机器上的执行顺序是否稳定

这些都不是 v0.1 该先吃下的复杂度。

同时，`scope` 一旦进入模型，Resolve 默认就应当是顺序敏感的：
前一个 fragment 的 `sets` 可能影响后一个 fragment 的 thunk。

**直接影响**

- 想并发处理 N 个 fragment 的 Pass，自己在 `run()` 内部做 `Promise.all` 或限流
- 想做预热，只能通过显式 Pass 或未来缓存层实现，不能由 Core 静默代劳
- 未来如果真的要做 Pass 级并行，必须建立在已经稳定的 `reads/writes` 与 capability 模型之上，而不是现在就偷跑

---

## 第二层 · 阻塞 loom-st M0

### 5. Tokenizer 从哪来

**结论**

Tokenizer 不进 Core。
预算类 Pass 通过一个显式接口接收 token counter。

建议接口：

```ts
interface TokenCounter {
  count(text: string): number | Promise<number>
}
```

预算 Pass 形态：

```ts
BudgetTrim({ maxTokens, counter })
```

**理由**

一旦把 tokenizer 内置进 Core，就等于把 Core 绑定到具体 provider 或具体实现。

这和白皮书里“Core 不做 provider 绑定”的原则冲突。

**直接影响**

- `@loom/stdlib` 可以定义 `TokenCounter` 接口，但不带任何实现
- `@loom/tokenizer-openai`、`@loom/tokenizer-claude`、`@loom/tokenizer-llama` 这类包各自提供实现
- `loom-st` M0 不被此事阻塞，因为 M0 本来就不做预算裁剪

---

### 6. 多 Source 的合并策略

**结论**

多 Source 合并是 **`loom-st` 的责任，不是 Core 的责任**。

推荐把 `Source Pass` 改称为 **Source Adapter / Source Stage**，放在 Core pipeline 之前：

```text
external inputs
  -> source adapters
  -> initial Fragment[]
  -> core pipeline
```

**理由**

白皮书已经明确 Core 不做数据源接入。
如果让 Core pipeline 直接接 `character / preset / worldInfo / chat` 这种命名输入对象，Core 就开始感知外部输入形态了。

这会让本来很窄的 Fragment 管线被“输入编排”污染。

**推荐的最小规则**

- `loom-st` 入口层负责调用 4 个 source adapter
- adapter 各自产出 `Fragment[]`
- `loom-st` 入口按显式约定顺序拼接为一个初始数组
- 然后交给 Core

**ID 冲突**

- source adapter 之间发生 id 冲突，不应静默覆盖
- 进入 Core 边界后由 Core 的 duplicate-id 校验直接报错

**直接影响**

如果采纳此结论，`loom-st-charter.md` 中把 Source 当成 Core Pass 的表述应同步修正。

**补充裁决：接入 API 形态**

v0.1 锁定为：

```ts
const fragments = await buildInitialFragments(input)
const result = await pipeline.run(fragments)
```

这意味着：

- Core 只接受 `Fragment[]`
- `loom-st` 可以在自己包内提供 `buildInitialFragments()` 一类 helper，封装 adapter 编排
- 不引入 `runWithSources(...)`
- 不把 Source adapter 重新包装成 Core 的第 0 类 Pass

---

### 7. 正则与模板的交叉顺序

**结论**

采用“**Resolve 作为 barrier，不是 run 的最后一步**”的模型。

然后把 ST 的 regex placement 映射为两类：

1. **`before macro` regex**
   在 source adapter 中对原始模板文本执行，发生在 thunk 生成之前

2. **`after macro` regex**
   在 Resolve 之后执行，作为需要 `resolved` capability 的 text transform pass

因此，完整顺序应允许是：

```text
source adapters
  -> pre-resolve compile passes
  -> resolve barrier
  -> post-resolve text passes
  -> emit
```

**理由**

这件事实际上暴露了一个更深的问题：
“Resolve 是否只能发生在 Emit 前一瞬间？”

答案应该是 **不能**。
否则所有“必须基于最终字符串但又还没到 provider emit”的处理都会变得别扭，不只是 regex。

**这三种选项里应明确拒绝**

- 拒绝“Compile 期间偷偷提前 resolve 受影响 thunk”
- 拒绝“让 regex 去猜 thunk 的字符串”
- 拒绝“把所有 regex 都塞到 emit 之后”

**直接影响**

- `loom-scope.md` 中“Resolve 是引擎固定最终阶段”的说法应调整为“Resolve 是显式 phase barrier”
- `loom-observability.md` 的 capability 模型正好可以承接这个语义：
  Resolve 提供 `resolved`，后续 Pass 可以 `requires: ['resolved']`

**补充裁决：Resolve barrier 的次数**

v0.1 只允许 **单次、显式、最多一个** Resolve barrier。

原因不是“多次永远不可能”，而是多次会立刻引入以下问题：

- Resolve 之后是否允许重新变回 unresolved
- 第二次 Resolve 是否还能继续读写 scope
- Trace 里 capability 的阶段语义是否还清楚

因此 v0.1 明确锁定：

- Resolve barrier 不是普通 Pass
- 一个 pipeline 最多一个 Resolve barrier
- barrier 之后的 Pass 不得重新产出 thunk
- barrier 之后的 Pass 不得再引入新的 `meta.sets` / scope 写入语义

---

### 8. Post-emit / 生命周期钩子

**结论**

`loom-st` M0 不处理 response 生命周期。
如果未来要支持，做成**对称的第二条 pipeline**，而不是把 prompt compile 和 response processing 混进一条 run。

**理由**

“生成 prompt”和“处理模型响应”虽然都叫“文本处理”，但它们的语义边界完全不同：

- 输入对象不同
- 错误语义不同
- DevTool 关注点不同
- 扩展生态的挂点也不同

现在就把 response 钩子塞进 loom-st，只会让 M0 范围失控。

**推荐方向**

- `PromptPipeline`：负责把外部输入编译成 prompt payload
- `ResponsePipeline`：负责对 provider response 做后处理
- 两者共用同一套 Trace / Diagnostic 协议

---

## 第三层 · 现在不做，但要提前画边界

### 9. Sub-pipeline / 作用域嵌套

**结论**

v0.1 不实现。
但未来首选方向应是 **forked child scope**，不是全局共享，也不是完全隔离。

推荐语义：

- child scope 读取时可向上穿透 parent
- child scope 写入默认只落在本地
- 是否导出回 parent 由显式 export 规则决定

**理由**

- 全局共享最省事，但 group chat 一来就会产生 key 污染
- 完全隔离最干净，但跨子流程传值过于笨重
- forked child scope 是最像“词法作用域”的中间解

**现在需要做的预留**

- `Scope` 必须是接口，不要退化成裸对象
- Trace 需要预留 `childTraceIds` / `parentTraceId`
- 任何依赖“全局唯一 scope 对象引用”的 API 都不要现在写死

---

### 10. 增量编译 / Watch 模式

**结论**

v0.1 不做增量编译引擎。
但必须保证未来能做，因此现在要守住三个前提：

1. fragment id 稳定
2. pass fingerprint 可计算
3. trace / mutation 可用于失效分析

**理由**

Watch 模式的本质不是“多跑几次”，而是“知道什么可以不重跑”。

没有稳定 id 和可比较 trace，所谓增量编译只能退化成全量重跑外加侥幸缓存。

**层级归属**

- Cache 协议预留：Core / Observability
- Watch UX：DevTools / CLI
- 具体缓存策略：v0.2+

---

### 11. 多 Provider 输出格式

**结论**

不应该把 `FlattenToMessages` 当成普遍契约。
应拆成：

- provider-neutral 的中间 prompt IR
- provider-specific 的 emit adapter

推荐命名方向：

- `ToOpenAI`
- `ToAnthropic`
- `ToGemini`

`loom-st` 的真实契约应当是“产出 provider-neutral prompt IR”，而不是“永远产 OpenAI messages[]”。

**理由**

OpenAI 的 `{ role, content }[]` 只是某一个 provider 的便利形态，不是普遍事实。

如果把它写进 loom-st 的核心契约，后面 Anthropic / Gemini 都会变成“适配 OpenAI 残留假设”的工作。

**落地建议**

- M0 demo 可以只带 `ToOpenAI`
- 但 `loom-st-charter.md` 应避免把 OpenAI `messages[]` 写成长期唯一输出

---

### 12. 流式输出

**结论**

采用 `(a) + (b)`：

- **Loom 不负责模型 response streaming**
- **Trace / Observability 可以是流式的**
- `pipeline.run()` 仍然返回 `Promise<RunResult>`，不改成 `AsyncIterable`

**理由**

把 `pipeline.run()` 直接改成 `AsyncIterable` 看似前卫，实则会把：

- 中断语义
- 错误语义
- 资源回收
- Trace 汇总

全部复杂化。

而 DevTool 需要的“边跑边看”其实已经可以由 `TraceSink` 解决，不需要改变主 API。

---

## 第四层 · 战略级长期问题

### 13. Pass 间的类型精化

**结论**

v0.1 不在 Core 里追求“整条 pipeline 自动类型精化”。

短期策略：

- 运行时契约以 capability 和 diagnostics 为准
- 领域包自己提供收窄后的 fragment type alias 与 assertion helper
- 先不把 Core 变成高阶 TypeScript 体操场

**理由**

这个问题如果现在硬上，会迅速把 `Pass` 从一个清楚的执行抽象变成一个非常重的类型系统实验。

在没有真实场景压测之前，很容易把复杂度花在错误方向上。

**未来方向**

如果 M0 之后证明确实有强需求，优先考虑：

- `Pass<I, O>` 这种显式输入输出类型

而不是：

- 靠神秘 branded type 自动串起整条 pipeline

---

### 14. Pass 的版本化

**结论**

缓存可用的 pass instance 必须显式暴露两样东西：

1. `version`：算法版本
2. `configKey`：参数指纹

建议缓存键：

```text
inputHash + pass.name + pass.version + pass.configKey
```

如果某个 Pass 没有 `version`，默认视为**不可缓存**。

**理由**

源码 hash 看起来自动，实际上会把构建环境和打包策略带进 Core。

手写 semver 虽然土，但边界清楚：
“你不声明版本，我就不给你缓存正确性承诺。”

**参数要不要进版本**

参数不该塞进 `version` 本身，但必须进入 `configKey`。
例如 `DedupById({ strategy: 'keep-first' })` 和 `DedupById({ strategy: 'keep-last' })` 必须是两个不同 instance fingerprint。

**补充裁决：version 从哪一版开始出现**

`version` 不应等到 v0.2 缓存落地时才突然引入。
v0.1 就应把它放进 Pass 契约与一方包示例中。

推荐过渡语义：

- 一方 Pass 和示例代码必须显式声明 `version`
- 运行时允许旧 Pass 省略 `version`，以避免硬中断
- 但省略 `version` 的 Pass 应被视为不可缓存
- 如开启 observability，应产出类似 `loom/unversioned-pass` 的 diagnostic

---

### 15. Thunk 沙箱

**结论**

Loom 不执行来自用户文件的任意 JS。
`vm` 不是本项目要依赖的安全边界。

正确方向是：

- 用户文件是**声明式数据**
- 受信 loader 把声明式数据编译成受限 thunk
- thunk 只能调用白名单能力

**理由**

如果允许“下载一个角色卡，里面直接带可执行 thunk”，那不是模板系统问题，是代码执行安全问题。

这个问题不应该被伪装成“模板灵活性”。

**直接影响**

- `{{random}}`、`{{user}}` 这类能力由 loader 解析成受控 thunk
- 不支持“把 JS 代码字符串塞进 JSON 再执行”
- 不支持时应产出明确 Diagnostic，而不是静默忽略

**补充裁决：白名单住在哪里**

白名单扩展点不放在 Core，也不直接放进 Stdlib 词汇层。

更干净的分层是：

- Core：不知道任何宏名，也不知道任何模板方言
- 中立 utility 层：提供“受控 thunk 编译器 + 白名单 registry”
- 领域包：注册自己的宏名、参数规则与运行行为

这样可以同时避免两种污染：

- 避免 Core 被 `{{user}}`、`{{random}}` 之类具体语义污染
- 避免 Stdlib 从“公共词汇表”膨胀成“模板行为总仓库”

---

### 16. 测试策略

**结论**

采用三层测试金字塔：

1. **Pass-level fixture tests**
   输入 fragment fixture，断言输出 fragment 和 diagnostics

2. **Pipeline-level trace snapshot tests**
   跑完整 pipeline，断言标准化后的 Trace JSON

3. **Golden output diff tests**
   对少量代表性 fixture，断言最终 provider payload 的 diff

**理由**

只有 pass-level 测试，不足以发现交互问题。
只有 end-to-end golden，又会太脆弱、定位困难。

这三层组合起来刚好覆盖：

- 单个 Pass 的局部正确性
- 整条 pipeline 的结构因果
- 最终用户可感知产物

**`@loom/testing` 要不要现在做**

不要。
先在仓库内部积累帮助函数，等至少两个 package 出现重复需求，再考虑提炼成 `@loom/testing`。

---

## 附加 · 非技术但会反过来决定技术

### 17. loom-st 的兼容性声明放在哪里

**结论**

同时做两层：

1. **静态 compatibility 文档 / 矩阵**
2. **运行时 compatibility diagnostics / report**

两者缺一不可。

**推荐形态**

- 文档：列出支持的 ST 版本范围、已知不兼容字段、行为差异
- 运行时：source adapter 在加载时产出
  - `loom-st/unsupported-field`
  - `loom-st/ignored-field`
  - `loom-st/behavior-change`

并附带：

- JSON path
- 原字段名
- 处理方式（忽略 / 降级 / 改写）

**理由**

只写文档，用户看不到自己这次为什么不对。
只打 Diagnostic，用户也看不到整体支持边界。

---

### 18. 谁拥有 Fragment Schema

**结论**

所有权分三层：

- **Core**：只拥有结构外壳
  `id`、`content`、`meta`

- **`@loom/stdlib`**：拥有跨场景、弱共识的公共词汇
  例如 `subject`、`priority`、`source`

- **`@loom/st`**：拥有 ST 领域字段
  例如 `depth`、`position`、`lorebook_constant`

判断某字段能不能上移到更底层，只看三个条件：

1. 是否机械
2. 是否跨领域
3. 是否已经被多个非 ST 场景重复证明

三个条件有一个不满足，就不要进更底层。

**理由**

字段一旦进 Core，就几乎永远下不来。
因此默认策略必须是：**先待在更高层，等被现实反复证明后再下沉。**

---

## 5. 后续主文档的处理方式

本 ADR 本轮**不直接改写** `whitepaper / scope / st-charter` 正文。

原因很简单：
它首先是一次“首次对齐时如何下决策”的历史记录，其次才是主文档未来修订的依据。

因此更好的处理顺序是：

1. 保留本文作为 ADR-001，不抹掉首次对齐的语境
2. 在主文档后续版本中引用 ADR-001
3. 把真正的正文修订写成对应文档的 `v2`，而不是静默原地覆盖

后续需要进入主文档的内容，至少包括：

1. **`loom-scope.md`**
   - Resolve 从“固定最终阶段”改为“显式 barrier”
   - 明确 Resolve 之后允许存在 `requires: ['resolved']` 的 Pass
   - 明确 v0.1 为单次、最多一个 Resolve barrier

2. **`loom-st-charter.md`**
   - Source 从“Core Pass”收束为 source adapter / source stage
   - M0 的输出契约从“OpenAI messages[]”收束为“provider-neutral IR + 首个 OpenAI adapter demo”
   - Source 接入形态明确为外部先产 `Fragment[]` 再调用 Core

3. **`loom-whitepaper.md`**
   - 补充 id 所有权与稳定性原则
   - 补充顺序唯一真相是数组顺序
   - 对 Resolve 在 Core 中的身位做一次统一表述
   - 提前引入 Pass `version` 的长期地位

---

## 6. 最后一句话

当前最危险的不是“还有很多问题没回答”，而是**不同文档已经在悄悄回答成了不同版本**。

所以现在最该做的，不是继续扩张设计面，而是先把下面四件事锁死：

1. 顺序真相
2. 错误边界
3. id 归属
4. Resolve 的身位

这四件事一旦定了，Core 才有真正可以持续推进的骨架；
它们不定，后面的 `loom-st`、DevTools、缓存、兼容层都会反复返工。
