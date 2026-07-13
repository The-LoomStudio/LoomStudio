# Loom-ST Charter

本文件定义 `loom-st` 子项目的战略定位、范围边界和 M0 验收标准。

> **2026-05-14 收口说明**：本文保留 `loom-st` 作为参考应用的战略定位；涉及 Provider-neutral IR、messages[]、`reads/writes/requires/provides` 强约束或 Core 拓扑排序的旧表述只作为 `loom-st` 领域实现背景，不进入 Core v0.1 契约。正式 Core 口径以 [`../04-next-steps/loom-core-v0.1-engineering.md`](../04-next-steps/loom-core-v0.1-engineering.md) 与 ADR-001~007 为准。

它同时承担另一个角色：**替代原计划中"无目标 POC"，作为 Loom Core 的第一次真实压测**。白皮书里所有"我们认为这样设计会更好"的决策，都在 loom-st 的 M0 场景里被检验一次。Core 的演进由 loom-st 的挫折反向驱动，不由作者的想象力驱动。

---

## 1. 为什么是 SillyTavern

SillyTavern（下称 ST）是 LLM 应用生态里现存最复杂、最成熟、也最混乱的提示词编译系统。它的 Prompt Manager + World Info + Preset + Regex + Macros + Depth Injection 加在一起，事实上是一个被硬编码在 UI 里的**非正式编译器**。

选择它作为 Loom 的首个参考应用，有三重收益：

1. **它是一个天然的 self-hosting 测试场**。如果 Loom 的抽象能优雅地重构 ST 的编译链，白皮书的核心命题就被证明了一次；如果不能，问题是 Loom 的，不是 ST 的。
2. **它的用户群对"提示词如何组装"异常敏感**。这是目前 LLM 应用开发者里最接近"编译器用户"心智的人群 —— 他们已经习惯调优先级、算 token 预算、debug 激活条件。Loom 的 DevTool 叙事对他们几乎不需要教育成本。
3. **它的每一个功能都是一个 Pass 的现成需求**。不需要假想使用场景，不需要脑补用户。直接抄 ST 的功能清单就是一份待实现列表。

---

## 2. 定位声明（不可让步）

> **Loom-ST 是 Loom 的参考应用，不是 Loom 的核心功能。**

具体约束：

- loom-st 的代码位于 monorepo 的独立 package（`packages/st`），**不进入 `@loom/stdlib`**。
- loom-st 长期不发布到 npm。它的分发方式是 `git clone` + `examples/` 参考实现。
- loom-st 允许有自己的"次级 Stdlib"（例如 `@loom-st/passes/world-info`），但这些 Pass 的接口必须严格符合 Core 的 `Pass` 契约，不依赖任何 Core 未提供的私有 API。
- **Core 的设计不为 loom-st 妥协**。如果 loom-st 需要某个 Core 未提供的能力，第一反应是"能不能用现有抽象组合出来"，第二反应是"这个能力是否对非 ST 场景也有普适价值"，两个都不成立则 loom-st 自己解决。

这条约束的本质是：**保护 Core 不被单一应用污染**。TypeScript 不为 React 特化 JSX（而是引入通用 JSX 语法），Rust 不为 Servo 特化 borrow checker。Loom 不为 ST 特化 Pass 契约。

---

## 3. 非目标（critical）

loom-st **不是** ST 的重写、仿真器、替代品或兼容层。

具体地：

- **不承诺 byte-level 输出一致**。同一套角色卡 / 预设 / 世界书输入，loom-st 产出的 messages[] 不保证和 ST 完全相同。
- **不承诺功能等价**。ST 有大量历史包袱（sticky/cooldown/delay、placement flag 的交叉效应、group chat 的轮换细节），loom-st 有权砍掉或重新设计。
- **不承诺 UI 等价**。loom-st 没有前端，没有角色管理器，没有对话界面。它只是一个编译器。
- **不支持 ST 的 Extensions 生态**。ST 扩展通过修改全局状态工作，这和 Loom 的 fragment 流水线模型冲突，不值得迁就。

对外叙事采用 **drop-in 数据 / inspired 行为** 原则：

- **Drop-in**：loom-st 读得懂 ST 的角色卡 JSON、世界书 JSON、预设 JSON 文件，用户不需要重整理数据。
- **Inspired**：loom-st 的编译行为灵感来自 ST，但由 Loom 的哲学（每步可见、每步可替换、每步可 diff）重新设计。

这个定位的好处是：ST 用户迁移成本低，但 loom-st 不会被"为什么和 ST 差一个 token"的 issue 压死。

---

## 4. 为什么这比"无目标 POC"更有价值

原 POC 计划的失败模式是**用作者自己写的示例验证作者自己设计的 API**。`loom-poc-review.md` 里 Q1–Q7 全部回答"够用 / 能忍 / 流畅"就是这种失败模式的症状。

loom-st M0 把这个风险替换掉：

- **场景不是作者设计的**。ST 的数据结构、功能组合、token 预算压力都是现成的外部约束。
- **成功标准是可证伪的**。"这三个 ST 文件能否编译出合理的 messages[]，且整个 trace 能让人看懂" —— 是就是是，否就是否，没有中间地带。
- **失败有诊断价值**。如果某个 Pass 声明系统表达不了世界书的递归扫描，那就是 `Pass` 契约的缺陷；如果 Trace 协议装不下 fragment 的激活状态，那就是 Trace schema 的缺陷。每一次失败直接对应一个 Core 的改进项。

换句话说：**POC 回答的是"能写出来吗"，loom-st 回答的是"能写好吗"**。只有后者能让白皮书从"推演"落到"经验"。

---

## 5. Package 结构

```
loom/                              
├── packages/
│   ├── core/                      @loom/core
│   ├── stdlib/                    @loom/stdlib
│   ├── observability/             @loom/observability
│   └── st/                        @loom/st          (不发 npm)
├── examples/
│   └── st-demo/                   M0 可运行 demo
├── fixtures/
│   └── st/                        真实 ST 角色卡 / 预设 / 世界书样本
└── pnpm-workspace.yaml
```

- 前三个 package 在 **Trace 协议稳定一个月且有 ≥2 个外部独立开发者使用过** 之后才发 npm。此前全部走 workspace。
- `packages/st` 永久不发 npm。它的价值是"可读的参考实现"，不是"可安装的依赖"。
- `examples/st-demo` 是一个独立的可执行脚本，用来产出 M0 的成功证据（见 §9）。

---

## 6. 三段式架构（仅 loom-st 内部约定）

```
ST JSON 文件 ──[Source Adapters]──▶ 初始 Fragment[] ──[Compile Passes]──▶ 组装后 Fragment[] ──[Emit Pass]──▶ Provider-neutral Prompt IR
```

| 阶段 | 职责 | reads | writes | Core 感知这个分类吗 |
|---|---|---|---|---|
| **Source** | 把外部数据格式转成 fragment | 空（无上游 fragment） | 任意 fragment 字段 | 不感知 |
| **Compile** | fragment → fragment 的转换 | 具体字段 | 具体字段 | 不感知 |
| **Emit** | fragment → 非 fragment 的下游格式 | 具体字段 | 空（产物脱离 fragment 世界） | 不感知 |

**Core 不知道这个三段式的存在**。对 Core 而言三者都只是 `Pass`。三段式是 loom-st 为了让代码结构清晰采用的约定，也是未来其他接入场景（LangChain Document、LlamaIndex Node、OpenAI Threads）可以复用的模式。

---

## 7. M0 场景定义

**精确描述 M0 要跑通的场景（不留解释空间）：**

输入：
- 一张 ST 角色卡（PNG embed 或纯 JSON 均可，M0 先接纯 JSON）
- 一个 ST 预设 JSON（至少包含 Main Prompt、NSFW Prompt、Jailbreak 三条可启用/禁用条目）
- 一本 ST 世界书 JSON（至少 20 条条目，使用关键词激活，无递归、无 sticky/cooldown）
- 一段聊天记录 JSON（5–20 轮 user/assistant 交替）

输出：
- 一份合理的、无特定厂商绑定的中间表示（Provider-neutral IR），供不同下游模型消费。
- 一份 trace.json，CLI printer 渲染后能清晰展示每个 Pass 的输入输出 diff
- 若有诊断（未激活的条目、未命中的关键词、预算裁剪决策），全部以 Diagnostic 形式出现在 trace 里

**不在 M0 范围内：**
- 世界书递归扫描
- Token 预算裁剪（M0 假设输入规模小于任何模型的 context window）
- Macros 展开（{{user}} / {{random}} 等）
- Regex 替换
- Depth Injection
- Group Chat / 多角色
- Persona / Author's Note
- 向量化世界书（绿灯条目）
- Quick Reply / Extensions
- 任何形式的交互、CLI、UI

这些全部进入 M1+。**M0 刻意定义得小**，小到一周内能跑通的程度。目的是尽早让 Core 接触真实数据，不是尽早让 loom-st 功能完整。

---

## 8. M0 Pass 清单

下表是 M0 的初始拆分方案。注意：1~4 项为 **Source Adapter**（在 Pipeline 外部执行），5~8 项为真正的 **Compile/Emit Pass**。**列出 reads/writes 是强制要求**，因为 `loom-observability.md` 的冲突检测依赖于它。如果某个 Pass 的 writes 声明不住，说明它的职责划分错了，应该拆成多个 Pass。

| # | 阶段 | 名称（意图） | reads | writes | requires | provides |
|---|---|---|---|---|---|---|
| 1 | Source Adapter | `LoadCharacterCard` | — | * | — | `character-loaded` |
| 2 | Source Adapter | `LoadPreset` | — | * | — | `preset-loaded` |
| 3 | Source Adapter | `LoadWorldInfo` | — | * | — | `worldinfo-loaded` |
| 4 | Source Adapter | `LoadChatHistory` | — | * | — | `chat-loaded` |
| 5 | Compile | `ActivateWorldInfo` | `content, meta.keywords, meta.kind` | `meta.active` | `worldinfo-loaded, chat-loaded` | `worldinfo-activated` |
| 6 | Compile | `FilterInactive` | `meta.active` | (drop fragments) | `worldinfo-activated` | `only-active` |
| 7 | Compile | `OrderByPosition` | `meta.position, meta.order` | `meta.sortKey` | `only-active` | `ordered` |
| 8 | Emit | `FlattenToMessages` | `content, meta.role` | — | `ordered` | — |

**关键的架构决策已经嵌在这张表里：**

- **激活和过滤分离**（Pass 5 与 6）。如果合成一个 Pass，DevTool 就看不到"被淘汰的条目以及淘汰理由"。拆开后，Pass 5 只标记 `meta.active`，Pass 6 才真正 drop，trace 里两步都看得见。
- **Pass 7 不动 `meta.position`，只算 `meta.sortKey`**。原始字段保留给 DevTool 展示，计算字段用于下游 Pass。这是"不可变 + 派生"的基本功。
- **每个 Pass 至少 provide 一个 capability**。这让 Core 的拓扑排序有信息可用，也让新人读 pipeline 时能看懂"为什么 Pass 5 必须在 Pass 4 之后"。

M0 发布时，`ActivateWorldInfo` 的具体激活策略允许偷懒（例如只做大小写不敏感的子串匹配），但 Pass 的**边界划分**必须按上表。策略可以进化，边界一旦错了全部要重写。

---

## 9. 成功标准

M0 通过的判据是以下三条**同时满足**：

**S1. demo 脚本能跑通**
```ts
// examples/st-demo/run.ts
import { pipeline } from './pipeline'

const result = await pipeline.run({
  character: require('../../fixtures/st/alice.card.json'),
  preset:    require('../../fixtures/st/roleplay.preset.json'),
  worldInfo: require('../../fixtures/st/fantasy.lorebook.json'),
  chat:      require('../../fixtures/st/chat-sample.json'),
}, { trace: true, traceSink: new FileSink('./trace.json') })

console.log(JSON.stringify(result.messages, null, 2))
```
这 20 行脚本不报错，产出合法 messages[]。

**S2. 产出的 messages[] 通过人工 review**
找一个 ST 重度用户读这份 messages[]，能看懂它表达的是什么人设、什么场景、哪些世界书条目被激活了、哪些没被激活。**不要求和 ST 一致**，只要求"合理"。

**S3. trace.json 能被 CLI printer 展开并看懂**
`loom-observability.md` 里规划的 CLI pretty-printer 读这份 trace，输出的树形结构能让一个**没读过 pipeline 源码**的人回答三个问题：
1. 哪些世界书条目被激活了？为什么？
2. 最终 messages[] 里的每一条分别来自哪个 fragment？
3. 如果我想让条目 X 也激活，我应该改哪个 Pass 的什么字段？

三条都满足，M0 通过。少一条，回去改。

---

## 10. 反哺 Core 的机制

这是 loom-st 存在的**最重要的理由**。

实现 M0 的过程中遇到的每一个"Core 表达不了这件事"的瞬间，必须按以下流程处理：

1. **先确认是不是组合问题**。能用现有 Pass 契约 + Fragment schema 组合出来吗？能，就不是 Core 的问题，是 loom-st 的问题。
2. **如果确实是 Core 缺陷**，写一条 issue，标签 `core-gap`，内容包括：
   - 具体是哪个 ST 功能触发的
   - 现有抽象为什么不够
   - 猜测的最小改动方案（可以错，重要的是暴露问题）
3. **不在 loom-st 里绕过**。不要用 `any`、不要读私有字段、不要给 Fragment 加 ST 专属的 `meta.__st_*` 字段。绕过一次就是永久的技术债，后面所有 Pass 作者都会模仿。
4. **Core 改完后，loom-st 对应位置回来用新抽象重写**。这是 loom-st 对 Core 的唯一"付费义务"。

M0 结束时应该产出一份 `loom-st-m0-retrospective.md`，列出所有 `core-gap` issue 的最终归宿。这份文档比 M0 本身更有价值，它是白皮书第一次接触现实的伤口记录。

---

## 11. 明确不做的事（M0 范围外，防止 scope creep）

| 诱惑 | 为什么 M0 不做 |
|---|---|
| CLI / REPL / HTTP 接入 | 用 fixture JSON 足够，交互层纯属噪声 |
| 角色卡 PNG embed 解析 | 只是格式适配，价值低，用纯 JSON 先跑通 |
| Token 计数 | tokenizer 绑定是深水区，M0 假设"不会爆" |
| 多模型适配（Claude / Gemini messages 格式） | Emit Pass 产出中立 IR，在业务层转译 |
| 性能测试 | 没跑通之前谈性能是自我欺骗 |
| Web UI / VS Code 扩展 | 参见 `loom-observability.md` §8 的 v0.2+ 计划 |
| 把 M0 的 Pass 抽成通用的 `@loom/stdlib` 条目 | M0 通过后再回头判断哪些足够通用 |
| 写 M1 / M2 / M3 的详细计划 | M0 会改变你对 Fragment schema 和 Pass 边界的认知，提前规划是空气规划 |

---

## 12. Open Questions（M0 动工前需要拍板）

这些问题在写代码之前必须有初步答案，即使答案是"先选 A，跑完 M0 再评估"：

**Q1. `meta.role` 是 Fragment 的一等字段，还是 meta 里的普通字段？**
ST 的 Prompt Manager 允许一个条目标注为 system / user / assistant。这个信息在整个编译链里都要用。提到一等字段会让 Emit Pass 更简单，但会让 Fragment schema 绑定到"对话"语义。

**Q2. 世界书条目和普通条目在 Fragment 上如何区分？**
用 `meta.kind: 'worldinfo-entry' | 'preset-entry' | 'chat-message' | 'character-card'`？还是用独立字段？`ActivateWorldInfo` 只想处理 worldinfo-entry，怎么表达这个筛选最自然？

**Q3. `ActivateWorldInfo` 是否应该读聊天历史？**
聊天历史也是 fragment。激活逻辑应该在 fragment 池里全局扫描，还是只扫聊天历史？"只扫聊天历史"需要 Pass 有能力按 kind 筛选输入。

**Q4. `FlattenToMessages` 合并同 role 连续 fragment 时，用什么分隔符？**
ST 的做法是 `\n\n`，但这是"行为 inspired"的范畴。loom-st 应该提供合理默认还是强制用户显式选择？

**Q5. Source Pass 的输入从哪来？**
目前脚本里用 `pipeline.run({ character, preset, ... })`。这意味着 pipeline 的 `run` 接受一个命名输入对象，而不是单个 input。Core 当前契约支持吗？如果不支持，这是不是一个 `core-gap`？

**Q6. Diagnostic 的关联粒度：`ActivateWorldInfo` 发现某关键词在所有 fragment 里都没命中，Diagnostic 关联到哪个 fragment？**
关联到世界书条目 fragment 本身？关联到聊天历史的末尾？还是产生一个没有 fragmentId 的全局 Diagnostic？这个选择影响 DevTool 的渲染策略。

这六个问题建议在开始写 Pass 之前做一次专门的 ADR 评审，产出 `loom-st-adr-001.md` 到 `loom-st-adr-006.md`。每个 ADR 一页纸，记录选择和理由。

---

## 13. 核心系统调研结论与实施建议 (Research Addendum)

在对 SillyTavern (ST) 源码进行深度调研后，针对 M0 的开发补充以下关键结论与实施建议：

### 13.1 世界书系统 (World Info)

**调研结论：**
- **扫描机制 (Scanning Buffer)**：ST 并不是只扫描聊天记录。它会构造一个包含 `Persona`、`Character Description`、`Scenario`、`Author's Note` 以及 `Chat History` 的组合缓冲区。
- **逻辑复杂度**：支持 `AND_ANY` (满足任一)、`AND_ALL` (满足全部) 等逻辑，且支持正则表达式。
- **时序控制**：拥有 `sticky` (激活后持续轮数)、`cooldown` (冷却期)、`delay` (初始延迟) 三个状态维度。
- **多位点注入**：激活结果会分发到 `before` (Prompt 开头)、`after` (Prompt 末尾)、`depth` (聊天中间)、`examples` (例子区) 等多个槽位。

**实施建议：**
- **归一化 Source**：将 lorebook 的每一条 entry 转换为 `DataFragment`，并在 `meta` 中完整保留其原始触发配置（keywords, depth, recursive 等）。
- **原子化 Pass**：
    - `WorldInfoActivationPass`：仅负责基于当前 Buffer 计算激活状态，写入 `meta.active: boolean`。
    - `WorldInfoTimingPass`：处理 sticky/cooldown 的状态迁移（M1 范围，但 M0 需预留 `meta.status`）。
    - `WorldInfoInsertionPass`：根据条目的 `meta.slot` 决定其在最终序列中的初始位置。

### 13.2 预设系统 (Preset & Prompt Manager)

**调研结论：**
- **双轨制聚合**：OpenAI 路径走 `PromptManager` 的对象列表（带 depth/order）；非 OpenAI 路径走 `story_string` 模板（Handlebars 风格）。
- **排序语义**：`injection_depth` 决定片段在聊天历史中的相对位置，`injection_order` 决定在同一位置下的先后顺序。
- **Marker 机制**：ST 使用 Marker 作为占位符，允许动态替换内容而不改变结构顺序。

**实施建议：**
- **统一排序协议**：在 Loom 的 `meta` 中定义 `st.depth` 和 `st.order`。
    - `st.depth = 0` 表示绝对头部（System/Global）。
    - `st.depth > 0` 表示插在聊天记录倒数第 N 条的位置。
    - `st.order` 默认为 100，用于同深度下的二次排序。
- **模板片段化**：对于 `story_string`，M0 建议将其拆解为多个逻辑片段，而不是作为一个整体字符串处理，以便于 DevTools 观察“哪个人设字段贡献了哪些 token”。

### 13.3 宏与正则 (Macros & Regex)

**实施建议：**
- **延迟解析原则**：`content` 初始保持为带宏的原始字符串（或 lazy thunk）。
- **Resolve 阶段**：宏解析（{{user}} -> "哥哥"）应作为 `Compile` 阶段的最后一个环节。这样在 Trace 中，用户可以看到“原始模板”到“填充后文本”的清晰对比。

---

## 附录 A. 与其他文档的关系

- `loom-whitepaper.md`：定义 Loom 的哲学和抽象。loom-st 验证它。
- `loom-devtools.md`：定义投影虚拟树的 UI 抽象。loom-st 的 trace 是它的第一个数据源。
- `loom-observability.md`：定义 Trace 协议、Diagnostic、Pass 冲突声明。**loom-st 严格遵守这个协议，不自创扩展字段**。
- `loom-poc-plan.md` / `loom-poc-review.md`：**本文件替代这两份**。原 POC 的目标（验证 Core 抽象）由 loom-st M0 承担，且验证标准更严苛。

## 附录 B. Charter 修改原则

本文件是"契约"性质，不应频繁修改。允许的修改：

- §11（明确不做的事）可以因 M0 过程中的新发现增补，但不能放宽。
- §12（Open Questions）应随着 ADR 通过而移除对应条目，并在文件底部记录 ADR 编号。

不允许的修改：

- §2（定位声明）任何条款的放宽，需要独立的 RFC 流程。
- §9（成功标准）任何条款的放宽，等同于承认 M0 失败。失败不羞耻，但不能通过修改标准把失败包装成成功。
