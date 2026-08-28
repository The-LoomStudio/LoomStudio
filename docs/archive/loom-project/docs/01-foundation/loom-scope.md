# Loom Scope & Content Binding

## 0. Status

> **2026-05-14 收口说明**：本文是历史设计记录，不作为 Core v0.1 施工依据。
>
> Core v0.1 已由 [`../04-next-steps/loom-core-v0.1-engineering.md`](../04-next-steps/loom-core-v0.1-engineering.md) 与 [`../04-next-steps/adr/ADR-007-remove-resolve-barrier.md`](../04-next-steps/adr/ADR-007-remove-resolve-barrier.md) 收口：Core 不提供 Scope、Thunk content、`meta.thunk`、`ScopeContext` 或 Resolve Barrier；`Fragment.content` 只接受 `string`。模板、变量、宏、late binding 属于 Core 外部的 Source Adapter、领域包、Stdlib 工具或用户态 Pass。

本文档定义 Loom 处理"变量"、"模板"、"宏"这类**延迟绑定值**的架构边界。

**核心主张**：Loom Core 对"模板语言"这一概念**一无所知**。它只提供两个原语 —— Scope 和 Thunk content —— 所有模板系统（ST 宏、EJS、Handlebars、Liquid……）都构建在这两个原语之上，属于用户态。

本文档是 `loom-whitepaper.md §5.2`（lazy content 三态）的细化，并与 `loom-observability.md` 的 `reads/writes` 声明系统共用同一套可观测性基础设施。

---

## 1. 问题陈述

任何严肃的提示词系统都会遇到两类需求：

**替换类**（substitution）
```
{{user}} 的名字是 Alice。
{{char}} 看着 {{user}}。
```
变量在 run 开始时已知，每处出现都替换成同一个值。

**跨 fragment 传参类**（cross-fragment binding）
```
(在世界书条目 A 里)  {{setvar:mood:紧张}}
(在角色介绍里)       当前氛围：{{getvar:mood}}
```
一个 fragment 写，另一个 fragment 读，共享一个运行时变量空间。

**计算类**（rich templating）
```ejs
<% if (user.level > 10) { %>
  <%= char %> 露出了惊讶的表情。
<% } %>
```
条件、循环、函数调用 —— EJS / Handlebars / Liquid 等提供的能力。

这三类需求在 LLM 应用里无处不在。问题是：**谁来处理它们？**

---

## 2. 三个诱人的错误答案

### 2.1 错误答案 A：在 Loom Stdlib 里提供 `ExpandMacrosPass`

把 ST 风格的 `{{var}}` / `{{setvar}}` / `{{getvar}}` 作为一个 Pass 实现，放进 Stdlib。

**为什么错**：
- 这个 Pass 本质上把**一种特定模板语言**固化进了 Loom 的词汇表
- EJS 用户需要另一个 `ExpandEjsPass`；两者的顺序、scope 共享、变量命名冲突都是持久的坑
- 多语言模板的 fragment 混在一起时行为不可预测
- 违反"The Engine Does Less" —— Stdlib 不应该替用户做模板语言选型

### 2.2 错误答案 B：Source 时刻直接渲染好

每个 Source Pass 读入原始数据时就把模板全部展开，产出的 fragment 里 `content` 已经是最终字符串。

**为什么错**：
- **全局变量**（`{{user}}` / `{{char}}`）确实可以这样做
- 但**跨 fragment 变量**根本做不到 —— `{{getvar:mood}}` 引用的 `{{setvar:mood:x}}` 可能在**另一个 Source 产出的 fragment** 里，Source 之间互不感知，pre-resolve 不可能
- DevTool 丢失了"变量什么时候被谁设置成什么"的可见性，Loom 最核心的卖点作废
- 任何"根据编译过程中途状态决定值"的场景（比如"根据世界书是否激活调整人设"）都做不了

### 2.3 错误答案 C：Core 内置通用模板引擎

Core 自己选一种语法（比如 Mustache 或 Handlebars），所有 fragment 的 content 都支持。

**为什么错**：
- 立刻把 Loom 拖进"模板语言选型"的永恒宗教战争
- 用户原有的 ST 数据用 Mustache 跑不通，必须先做语法转换，迁移成本骤增
- Core 膨胀，违反三层架构

---

## 3. 正确答案：两个原语 + 一个模式

### 3.1 原语一：Scope

```ts
interface RunContext {
  scope: Scope  // 跨 fragment 共享的运行时键值存储
  // ...
}

interface Scope {
  get(key: string): unknown
  set(key: string, value: unknown): void
  has(key: string): boolean
  snapshot(): Record<string, unknown>  // 用于 Trace
}
```

- `scope` 在 `pipeline.run()` 开始时创建，贯穿整个 run
- 可以在 `run()` 调用时预填充初始值（作为全局变量的来源）
- **Scope 变更由引擎记录进 Trace**（见 §7），DevTool 可以时间轴回放

### 3.2 原语二：Thunk Content

```ts
type Content =
  | string                                    // 已解析的静态值
  | Promise<string>                           // 异步已解析
  | ((ctx: RunContext) => string)             // 延迟解析（同步）
  | ((ctx: RunContext) => Promise<string>)    // 延迟解析（异步）
```

这是 `loom-whitepaper.md §5.2` lazy content 三态的形式化。

**关键性质**：
- 什么时候求值由引擎决定，不由 Pass 决定
- 求值发生在**专门的 Resolve 阶段**（即 Emit 前的最后一步）
- 求值时 `ctx.scope` 已经被所有前序 sets 填充完毕

### 3.3 原语三（可选元数据）：`sets` 和 `reads`

```ts
interface Fragment {
  id: string
  content: Content
  meta: {
    sets?: Record<string, unknown | Thunk>  // 本 fragment 写入 scope 的键
    reads?: string[]                        // 本 fragment 读取 scope 的键
    // ... 其他
  }
}
```

**`sets` 和 `reads` 是声明性的，不是强制的**：
- 用户可以不声明，内容 thunk 照样能通过 `ctx.scope.set()` 修改 scope
- 但声明了就获得**静态分析 + DevTool 可视化**（见 §6、§7）
- 严格模式下引擎会验证：未声明就写 scope = warning；reads 的 key 无人 sets = warning

---

## 4. 两阶段模式：Source 时刻解析，Emit 时刻执行

这是整个架构的**执行模型**。

```
┌─────────────────────────────────────────────────────────────┐
│  Source 阶段                                                 │
│                                                             │
│    原始数据（ST JSON / EJS 文件 / Markdown + frontmatter）    │
│    → Source Pass 解析模板语言                                │
│    → 提取 sets / reads 元数据                                │
│    → content 变成 Thunk                                     │
│    → 产出 Fragment[]                                        │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│  Compile 阶段（一个或多个 Pass）                              │
│                                                             │
│    操作 fragment 的结构：                                    │
│      - 激活 / 过滤                                           │
│      - 排序                                                  │
│      - 合并 / 拆分                                           │
│      - 预算裁剪                                              │
│    不触碰 content thunk 本身                                 │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│  Resolve Barrier (显式声明的屏障)                                │
│                                                             │
│    按最终顺序遍历 fragment：                                 │
│      1. 应用 meta.sets → scope                              │
│      2. 执行 content thunk(ctx) → 得到字符串                │
│    所有 thunk 求值完毕后，content 全部是 string             │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│  Emit 阶段（用户态 Pass）                                     │
│                                                             │
│    Fragment[] → 目标格式（messages[] / string / ...）       │
└─────────────────────────────────────────────────────────────┘
```

**关键规则**：

1. **只有 Source 和 Resolve 接触模板语义**。Compile Pass 只改结构，不改内容。
2. **Resolve 是显式 phase barrier**。它不再是引擎内建的最后一步，而是可以在流水线中间显式插入的一个屏障，用于强制对懒加载的 content 进行求值。
3. **Resolve 的顺序 = fragment 的求值顺序**。这就是为什么 setvar 语义是"后覆盖前"。

---

## 5. 三个典型场景

### 5.1 ST 宏

loom-st 提供一个 helper：

```ts
// @loom-st/templates
import { stContent } from '@loom-st/templates'

// 用户态 Source Pass 读取角色卡后：
{
  id: 'greeting',
  content: stContent('{{user}} 走进了房间。{{char}} 抬起了头。'),
  meta: {
    reads: ['user', 'char']
  }
}
```

`stContent()` 返回的是一个 thunk：
```ts
function stContent(template: string): Thunk {
  return (ctx) => template
    .replace(/\{\{(\w+)\}\}/g, (_, key) => String(ctx.scope.get(key) ?? `{{${key}}}`))
}
```

带 setvar 的情况：
```ts
// 原始 ST 模板: '紧张氛围。{{setvar:mood:tense}}{{user}} 握紧了拳头。'
// Source Pass 解析后产出：
{
  id: 'scene-x',
  content: stContent('紧张氛围。{{user}} 握紧了拳头。'),  // setvar 已被移除
  meta: {
    sets: { mood: 'tense' },   // 提取为声明性元数据
    reads: ['user']
  }
}
```

**要点**：setvar 这种"副作用"语法，在 Source 解析时被**提升**为声明性的 `meta.sets`，不再藏在 content 里。这让：
- 引擎可以按顺序应用 sets，顺序变化时行为一致
- DevTool 能在 fragment 节点上直接显示"这个 fragment 设置了 mood = 'tense'"
- 静态分析能检测"如果 scene-x 被预算砍掉，所有依赖 mood 的 fragment 会失败"

### 5.2 EJS

完全对称的做法，只是解析器换成 EJS：

```ts
// @loom-ejs/templates
import ejs from 'ejs'

function ejsContent(template: string): Thunk {
  return (ctx) => ejs.render(template, Object.fromEntries(ctx.scope.entries()))
}

// 用户用起来：
{
  id: 'greeting',
  content: ejsContent('<% if (user.level > 10) { %>欢迎，<%= user.name %>大人。<% } else { %>欢迎。<% } %>'),
  meta: {
    reads: ['user']
  }
}
```

**EJS 和 ST 完全无冲突**，因为 Loom 不知道哪个是哪个。两者都是"返回字符串的函数"。

### 5.3 混合 pipeline

```ts
const fragments = [
  // 来自 ST 角色卡
  { id: 'char-info', content: stContent('{{char}} 是一位 {{getvar:class}}。'), meta: { reads: ['char', 'class'] } },

  // 来自配置文件（JS 原生）
  { id: 'class-setup', content: '', meta: { sets: { class: '法师' } } },

  // 来自 EJS 模板
  { id: 'stats', content: ejsContent('HP: <%= char %> 满血'), meta: { reads: ['char'] } },

  // 来自 Markdown（无模板）
  { id: 'note', content: '---\n\n战斗开始\n\n---' }
]
```

一次 run 里四种来源无缝共存。Resolve 阶段逐个调用 thunk，scope 按顺序累积。

---

## 6. 这套模型解锁的静态分析

`meta.sets` / `meta.reads` 的声明性让引擎可以在 Resolve 之前做**静态诊断**（`loom-observability.md §3` Diagnostic 系统的直接消费者）。

| Diagnostic code | 含义 |
|---|---|
| `loom/read-without-set` | fragment 声明 reads `x`，但最终顺序里没有任何前序 fragment sets `x` |
| `loom/orphan-set` | fragment sets `x`，但没有任何后续 fragment reads `x`（info 级别，提示可能是死代码） |
| `loom/read-after-removal` | fragment B reads `x`，唯一 sets `x` 的 fragment A 被之前的 Pass 移除了（error 级别） |
| `loom/undeclared-scope-write` | 严格模式下，content thunk 调用了 `ctx.scope.set()` 但未在 meta.sets 声明 |
| `loom/undeclared-scope-read` | 严格模式下，content thunk 调用了 `ctx.scope.get()` 但未在 meta.reads 声明 |
| `loom/scope-write-override` | 多个 fragment sets 同一个 key，info 级别提示覆盖行为 |

**举例**：用户的 `BudgetTrim` 砍掉了一个有 `sets: {mood: 'tense'}` 的低优先级 fragment，而 prompt 尾部有一个 `reads: ['mood']` 的 fragment。引擎在 Resolve 前触发 `loom/read-after-removal`，DevTool 画一条红线连接这两个 fragment，指出"这里缺了 mood 的定义"。

**这是 ST 从来做不到的事**。ST 运行时遇到未定义变量只能静默返回空字符串或字面量 `{{getvar:mood}}`，没有线索。Loom 把运行时错误提前为编译期诊断。

---

## 7. 与 Observability 的衔接

Scope 的变化本身是 Trace 里的一类事件：

```ts
type TraceEvent =
  | { kind: 'pass-start' | 'pass-end'; ... }
  | { kind: 'mutation'; ... }
  | { kind: 'diagnostic'; ... }
  | { kind: 'scope-set';    key: string; value: unknown; byFragment: string }
  | { kind: 'scope-read';   key: string; value: unknown; byFragment: string }
  | { kind: 'thunk-resolve'; fragmentId: string; durationMs: number; result: string }
```

DevTool 的呈现：
- 每个 fragment 节点旁显示它的 `sets` / `reads` badge
- 悬停 `sets: {mood}` 时高亮所有 `reads: ['mood']` 的 fragment
- 时间轴可以回放 scope 演化过程（像 Redux DevTools 的 state diff）
- Thunk 求值耗时单独展示（方便发现慢的模板渲染，比如 EJS 里做了 IO）

---

## 8. Loom Core 提供什么，不提供什么

### Core 提供

- `RunContext.scope` 的接口与实现
- `Content` 类型的四种形态（string / Promise / thunk / async thunk）
- Resolve 阶段的固定执行语义（按 fragment 最终顺序，先 apply sets 再调 thunk）
- `meta.sets` / `meta.reads` 字段的读取和静态诊断
- Scope 变更进入 Trace

### Core **不**提供

- 任何具体的模板语法（`{{...}}` / `<%= %>` / 等等）
- 任何模板解析器
- 任何内建的 `ExpandMacrosPass` / `EvalEjsPass`
- Scope 的类型系统（值就是 `unknown`，用户自己约定语义）
- Scope 的序列化（但 Trace 会用 JSON 尽力 snapshot）
- Scope 的作用域嵌套（v0.1 只有全局单一 scope，见 §10）

### Stdlib **可以**提供（不是必须）

- 严格模式开关（未声明写入 → 报错）
- Scope 的冻结 / 浅只读包装器（防止某些 Pass 修改）
- Scope 序列化 helper（把 thunk 值展开以便调试）

### 用户态库提供

- **模板解析器**：`@loom-st/templates`、`@loom-ejs/templates`、`@loom-handlebars/templates` 等等
- **Source Pass**：把第三方格式转成 Fragment + thunk + meta
- **Scope 初始值约定**：比如 loom-st 约定 scope 里有 `user`、`char`、`time` 等

这条边界的意义：**Loom 从不会因为某种模板语言的流行与否而过时**。TS 的 JSX、Rust 的宏、LLM 领域的新模板语言出现时，Loom 都不需要改 Core。

---

## 9. API 形态草案

### 9.1 Scope API

```ts
interface Scope {
  get<T = unknown>(key: string): T | undefined
  set(key: string, value: unknown): void
  has(key: string): boolean
  delete(key: string): boolean
  keys(): IterableIterator<string>
  entries(): IterableIterator<[string, unknown]>
  snapshot(): Record<string, unknown>
}
```

### 9.2 Pipeline 入口

```ts
const result = await pipeline.run(
  { /* 输入 */ },
  {
    scope: {              // 初始 scope
      user: 'Alice',
      char: 'Bob',
    },
    trace: true,
  }
)
```

### 9.3 Content thunk 的 ctx

```ts
type Thunk = (ctx: ResolveContext) => string | Promise<string>

interface ResolveContext {
  scope: Scope
  fragmentId: string
  // 故意不暴露其他 fragment，保持 thunk 的局部性
}
```

**刻意的限制**：`ResolveContext` 不暴露 `fragments[]`。理由是 thunk 应该是"局部函数"，只依赖 scope 里已经声明过的值。需要跨 fragment 引用时，就用 scope。如果要打破这条限制，必须是一个显式 Pass（比如某个"交叉引用 Pass"），而不是在 thunk 里偷偷摸其他 fragment。

---

## 10. Open Questions

### Q1. Scope 是扁平的还是嵌套的？

v0.1 提案：**扁平**。`scope.get('char.name')` 是一个字符串 key，用户自己约定是否用点号表示层次。

理由：嵌套 scope 会立刻引入作用域栈、词法作用域、闭包这些问题，应该由用户态库（比如 `@loom-st/templates`）在自己的语义里处理，不应该进 Core。

### Q2. 多个 fragment `sets` 同一个 key，语义是什么？

v0.1 提案：**后写覆盖前写**。按 fragment 的最终顺序，最后一次 set 胜出。

提示 Diagnostic `loom/scope-write-override`（info 级别），让用户有机会察觉。

### Q3. `sets` 的值可以是 thunk 吗？

v0.1 提案：**可以**，而且推荐。

```ts
meta: {
  sets: {
    mood: (ctx) => ctx.scope.get('user') === 'Alice' ? 'happy' : 'neutral'
  }
}
```

这样避免了 "我想设置的值本身依赖于其他 scope 变量" 的死局。求值时机：apply sets 的那一刻。

### Q4. Scope 应不应该支持"作用域"（比如 sub-pipeline 有自己的 scope）？

v0.1 提案：**不支持**。单一全局 scope。

当 sub-pipeline 成为正式概念（对应 `loom-observability.md §10` Q1）时再讨论作用域栈。在此之前，多 pipeline 之间如需隔离，各自创建独立的 run。

### Q5. Thunk 抛异常怎么办？

v0.1 提案：**Diagnostic `loom/thunk-error`**，级别 error。

策略（run options 决定）：
- `throwOnResolveError: true`（默认）—— 整个 run 失败
- `throwOnResolveError: false` —— fragment 的 content 被替换为空字符串或一个特殊占位符，run 继续，但 diagnostic 记录

### Q6. Scope 能不能存非字符串的复杂对象？

v0.1 提案：**可以存任意 `unknown`**。但 Trace 序列化时会用 `JSON.stringify` 尽力，不可序列化的对象（函数、循环引用）在 Trace 里显示为 `[non-serializable]`。

这保证了运行时的灵活性（可以在 scope 里存一个数据库连接给 thunk 用），同时不污染 Trace 的可传输性。

---

## 11. 对 loom-st 的直接影响

loom-st 的 Pass 列表（`loom-st-charter.md §8`）里原本的 `ExpandMacros` Pass 在本文档的架构下**不存在**。它被彻底拆解为：

| 原 ExpandMacros 的职责 | 新架构下谁做 |
|---|---|
| 解析 `{{user}}` / `{{char}}` 等替换 | `LoadCharacterCard` Source Pass 在产出 fragment 时用 `stContent()` 包装，内嵌到 thunk 里 |
| 解析 `{{setvar:k:v}}` | `LoadXxx` Source Pass 提取为 `meta.sets` 声明性元数据 |
| 解析 `{{getvar:k}}` | `LoadXxx` Source Pass 提取为 `meta.reads` 声明性元数据，thunk 内部读 scope |
| 替换时机的实际执行 | **引擎 Resolve 阶段**自动完成，loom-st 不需要任何 Pass |
| 运行期变量注入（比如 `{{time}}`） | `run({ scope: { time: new Date().toISOString() } })` 在入口注入 |

换句话说：**loom-st 里不需要任何 Pass 懂 ST 宏语法**，除了 Source Pass。这是一个重大的架构简化。

同理，未来任何"loom-xxx"的 Source 层都是这个模式：
- `@loom-ejs`：EJS 文件 → ejsContent thunk
- `@loom-handlebars`：Handlebars → handlebarsContent thunk
- `@loom-markdown-frontmatter`：解析 YAML frontmatter → scope + thunk

它们全部可以在同一个 pipeline 里混用。

---

## 12. 小结

Loom 对"模板"问题的回答不是"我们怎么做模板"，而是"**我们不做模板，我们提供使所有模板语言得以运行的两个原语**"。

这两个原语是：

1. **Scope**（运行时共享的键值空间）
2. **Thunk content**（延迟到 Resolve 阶段才求值的函数式 content）

加上两个声明性元数据（`sets` / `reads`），它们让：

- 任何模板语言都能作为用户态库存在，互不冲突
- 跨 fragment 变量传递成为一等概念，可被静态分析
- DevTool 能看到变量的写、读、覆盖、丢失
- loom-st 的设计被大幅简化（只需要 Source 层懂 ST 语法）
- EJS 和 ST 能在同一 pipeline 里混用

这一章和 `loom-observability.md` 是 Loom v0.1 的两块地基。前者定义运行时的数据形状，后者定义观察运行时的协议。模板、变量、宏、late binding 这些名词此后都不再是 Core 的概念。
