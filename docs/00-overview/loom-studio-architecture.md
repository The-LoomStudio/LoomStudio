# Loom Studio Architecture

> *A workshop for prompt looms.*

**Status**: Draft v0.4 — discussion document, not implementation spec.
**Audience**: Loom 引擎维护者、Studio 设计者、未来的 Extension 作者、独立前端作者。
**Companion documents**: `loom-whitepaper.md`, `loom-scope.md`, `loom-architecture-answers.md`（ADR-001）。

> **2026-05-20 方向修正**：本文早期版本大量使用 `Concept Stack Extension` 表达默认上层体验。该方向已经被后续讨论修正：默认完整 AIRP 体验应作为 Studio 第一方内建 `Studio AIRP Layer` / package layer，而不是 ordinary extension；但它仍不进入 Kernel。本文中关于 Kernel 不理解 chat / message / character / worldbook 的约束仍有效，关于 `Concept Stack` 可安装、可卸载、多个并存的表述应视为历史设计草案，后续需按 Studio AIRP Layer 重写。

---

## 0. Intent

本文档回答一个问题：**如果 Loom 引擎是织机，那么"用织机做事的工坊"长什么样？**

Loom Studio 是一个**本地优先、平台化的 LLM 工作台**。它面向当前 SillyTavern 用户群体——本地部署、重度自定义、生态驱动——但它不试图做"更好的 SillyTavern"，而是做**让"更好的 SillyTavern"成为众多可能形态之一**的那个底座。

Studio 不是一个 App。Studio 是一个 **Node.js 应用 + 一组协议**，它的官方 Web UI 只是这个协议的第一个客户端。Studio 与 Loom 引擎的气质一脉相承：**克制、显式、不替用户决定**。

### 五个核心承诺（hero）

1. **Extension 前后端分离 / Protocol-Shaped, Not Application-Shaped**  
   一个 Extension 的"服务端能力"与"客户端 UI"是两个独立的可分发部分，通过协议而不是组件库连接。后端大佬只发后端、前端大佬只发 UI、二者能被任意组合。Server Part 不知道自己在为哪个 UI 服务。

2. **Transport API 是平台对外的真正契约**  
   官方 Web UI 没有任何走后门的能力。第三方客户端、独立角色卡前端、CLI、bot 通过 Transport 看到的世界与官方客户端完全相同。

3. **一切已注册之物皆可发现**  
   Extension 注册到 Kernel 的所有东西（document types、passes、commands、rpc、events、schemas）在运行时可枚举。生态作者写的不只是代码，还是**自描述**的代码。

4. **Pipeline 是 per-invocation 的，不是 per-session 的**  
   Kernel 不知道"会话"是什么。Session / Chat / Card 属于 Studio AIRP Layer 或其他上层体验层；Kernel 只运行调用方提交的 pipeline。

5. **Runtime 是 Extension Pattern，不是 Kernel Service**  
   Chat Runtime、Agent Runtime、Provider Gateway、Tool Loop、MCP Bridge 都不是 Kernel 内置层。Kernel 只提供 Document / Event / RPC / Capability / Loom Runner / Introspection 这些正交能力，让 Extension 自己把它们组合成运行图。

### Studio 不做的事（先于做的事说）

- Studio 不内置任何 LLM provider
- Kernel 不内置 chat / message / character / worldbook 概念；Studio 默认 AIRP 体验由 Studio AIRP Layer 提供，但不进入 Kernel
- Studio 不把 Studio AIRP Layer 做成 ordinary extension；第三方完全不同的体验后续应通过隔离进程 / 数据根 / namespace 等方式讨论
- Studio 不提供云端同步、用户系统、多租户、SaaS 形态
- Studio 不维护中央插件市场
- Studio 不做插件自动更新
- Studio 不做内置全文搜索、向量检索
- Studio 不假设"官方 Web UI"必然存在
- Studio 不抹平 LLM provider 差异（"AI Gateway"是 Extension 的事）
- Studio 不内置 Chat Runtime / Agent Runtime / Tool Loop / MCP Bridge；这些是 Extension 通过开放接口组合出来的运行时模式
- Studio 不把 `messages[]` 或任何 provider-neutral invocation schema 作为 Kernel contract；官方 Provider / Runtime 可以发布推荐 RPC 约定，但 Kernel 不认识它们
- Studio 不替 Extension 决定 UI 形态、UI 框架、UI 挂载方式

这些"不做"不是延后清单，而是**架构承诺**。它们越多，平台属性越强。

### 架构隐喻：借用 OS 的边界观，而不是 OS 的产品承诺

Studio 不是操作系统，也不继承操作系统的功能清单。OS 隐喻只用于帮助划分架构边界：Kernel 保持小，Extension 构成用户态，Transport / RPC 提供稳定接口，Document Store 提供持久化底座，Capability Broker 提供权限边界，Trace / Audit 提供系统级可观测性，官方 Web UI 则是 shell，而不是平台本身。

> **Studio 是工作台，不是操作系统；但它用 OS 的边界纪律来组织 Extension 生态。**

---

## 1. Tenets

Studio 有五条不可动摇的信条，与 Loom 引擎的 *The Engine Does Less* 形成两层一致的克制风格：

### Tenet I — The Kernel Does Less

Studio 的 Kernel 只承担六件事（见 §6）。任何"看起来很有用、但有任何一个 Extension 能做"的功能都不进 Kernel。每多一个 Kernel 内置功能，平台属性就削弱一分。

### Tenet II — Transport API is the Contract

Studio 对外的真正契约是 Transport API，**不是**官方 Web UI、**不是**官方 SDK、**不是**任何具体客户端实现。

- 官方 Web UI 没有任何走后门的能力
- 第三方客户端通过 Transport 看到的世界与官方客户端完全相同
- "Studio 是平台"这句话的工程含义就是这一条

如同 Loom 引擎不假设"有一个 App 在使用它"，Studio Kernel 不假设"有一个官方 UI 在使用它"。两层克制相互独立、相互见证。

### Tenet III — Everything Registered is Discoverable

Extension 注册到 Kernel 的一切都必须**运行时可枚举、可自描述**：

- Document Types 必须附带 schema
- RPC 必须有签名（参数 / 返回 / 流式特征）
- Events 必须声明命名空间与 payload 形状
- Passes 必须暴露 `provides` / `requires` 契约与 `version` 字段
- Commands 必须可被命令面板列出

Kernel 暴露统一的 `system.introspect` RPC（见 §6.6）。任何客户端、任何 Extension、任何调试器都能拿到平台的完整能力图。

这条信条解决三类开发者的同一个痛点："我看不见别人提供了什么"——

- Server Part 作者：知道别的 Extension 暴露了哪些 RPC 可调
- Client Part 作者：知道宿主里装了哪些 Extension、它们的 schema 长什么样
- 独立前端作者：通过纯协议 introspect 后端能力，不读源码

平台是否真的"对所有人友好"，最便宜的检验就是这条。

### Tenet IV — The Kernel Runs Pipelines, Not Sessions

Kernel 的 Loom Runner 是**纯函数化、可重入、无状态**的：每次 `kernel.loom.run` 调用都是独立的，自带它需要的全部上下文（passes / fragments / invoker / options）。Kernel 不知道：

- "当前会话"是什么
- "当前激活的概念栈"是什么
- 上一次 invoke 跟这一次 invoke 之间是什么关系
- "用户"、"角色"、"对话历史"是什么

这些都是**调用方**（某个 Concept Stack、独立前端、Card Script、其他 Extension）在自己那一边维护的状态。它们在调 `loom.run` 时把所需的一切打包传入，运行结束即散。

这条信条带来的直接结果：

- **多个 Concept Stack 天然共存于同一 Studio 进程**——`loom-studio-st` 与某新栈可以同时被装，互不冲突
- **客户端在不同栈之间切换零成本**——无须重启、无须显式"切换"操作；切换 = 调不同栈的 RPC
- **Kernel 内部没有"全局编排器"或"主导栈"的隐式单例**
- **invoke 自然并发可重入**——不同栈、不同会话的 invoke 同时跑，互不感知

这条信条与 Tenet I 互文：Kernel 做得少，少到连"是谁在用我"都不知道。"会话"是 Concept Stack 的概念，不是平台的概念。

### Tenet V — Runtimes Are Extensions

Studio Kernel 是**能力底座**，不是运行时框架。它不提供内置 Chat Runtime、Agent Runtime、Provider Gateway、Tool Loop 或 MCP Bridge；这些都应当作为 Extension 通过 Kernel 的六个正交服务组合出来。

这条信条的工程含义是：

- Kernel 只认识 Document、Event、RPC、Capability、Loom Invocation、Trace / Audit；不认识 message、provider、tool call、MCP、ReAct step
- Provider 是普通 Server Extension，暴露 `*.invoke` / `*.stream` / `*.listModels` 之类 RPC；Kernel 只把它当 RPC
- Agent / Chat Runtime 是普通 Extension，自己维护状态、决定循环、调用 `kernel.loom.run`、调用 provider / tool RPC、把结果写回 Document Store
- `messages[]` 不是平台终点，只是某些 Runtime Extension 调某些 Provider Extension 时采用的 payload 形态
- 工具调用结果、模型响应、外部观察值可以在下一轮被 Runtime Extension 转成 Fragment，再次送入 `kernel.loom.run`

> **Loom Core 是一次可重复调用的编译步骤，不是模型调用流程的固定前半段。Studio Kernel 是能力底座，不是运行时。运行时由 Extension 构建。**

这避免两个极端：一端是 Kernel 膨胀成 AI Gateway / Agent Framework，另一端是生态完全无共识。Kernel contract 保持极小；官方 Extension 可以发布推荐 RPC 约定，供生态选择性兼容。

---

## 2. Vocabulary

| 词 | 定义 |
|---|---|
| **Loom Engine** | 提示词组装引擎，发布为 npm 包（`@loom/core` 等），与 Studio 解耦 |
| **Loom Studio** | 平台/工作台，独立 Node.js 应用，本文档主体对象 |
| **Kernel** | Studio 内部最小运行时，由六个服务构成 |
| **Workspace** | 一个 Studio 进程对应的资料目录，含全部内容库与已装 Extension |
| **Document** | Workspace 内的最小数据单元，typed JSON，由 Kernel 统一管理 |
| **Document Store** | Kernel 的存储服务，默认后端 SQLite，可换 |
| **Scratch Space** | 每个 Extension 一个独立目录，用于其私有持久化数据（向量索引、缓存等） |
| **Transport API** | Studio 对外的协议层，所有客户端通过它访问 Studio |
| **Extension** | 用户/开发者安装的扩展物。可包含 Server Part、Client Part 之一或两者 |
| **Server Part** | Extension 的服务端部分，运行在 Kernel 内 |
| **Client Part** | Extension 的客户端部分，运行在 UI 宿主内；Kernel 不感知其形态 |
| **Concept Stack** | 一种特殊的 Extension，定义一组 Document type、Pass、RPC，让用户能在某种"概念哲学"（如 ST 风格、纯依赖图风格、LARP 风格）下工作。Studio 不内置任何 Concept Stack |
| **Invocation** | 一次完整的 `loom.run` 调用，从初始 Fragment 到最终 Fragment 的过程，自带 invocation id |
| **Trace** | 一次 invocation 的完整、不可变、自包含快照，存为 `system.trace` Document |
| **Official Web UI** | 官方维护的"玩 + 开发一体"客户端，享受与第三方客户端完全相同的接口 |
| **Dock** | 官方 Web UI 提供的、可独立 npm 引入的 Extension 默认挂载位组件。是生态级 convention，非平台级 contract |
| **Card Script** | 角色卡自带的前端脚本，以 sandboxed iframe 加载（架构第一版只承认这一种形态，详见 §8） |
| **Runtime Extension** | 一类 Extension 设计模式：维护某种运行时循环或会话状态，如 Chat Runtime、Agent Runtime、Workflow Runtime。Kernel 不注册这个概念，只通过 RPC / Event / Document / Loom Runner 支撑它 |
| **Provider Extension** | 一类 Server Extension 设计模式：封装某个 LLM provider 或 provider-compatible API，暴露模型调用 RPC。Kernel 不认识 provider，只认识 Extension RPC |
| **Tool / MCP Extension** | 一类 Server Extension 设计模式：封装本地工具、远程工具或 MCP server，暴露工具调用 RPC / Event。Kernel 不内置 MCP 客户端 |

---

## 3. Repository Boundary

Studio 与 Loom 引擎是两个独立的物理仓库与发布物。

```
loom-engine/                            ← 当前 monorepo
  packages/core                         ← @loom/core，npm
  packages/stdlib                       ← @loom/stdlib，npm
  packages/devtool
  packages/st-compat-lib (optional)     ← 纯逻辑库，不依赖 Studio

loom-studio/                            ← 独立仓库
  apps/                                 ← Studio 主程序
  packages/extension-sdk                ← Extension 作者用的 SDK
  packages/client-bridge                ← Client Host Bridge / sandbox activation
  extensions/official-*                 ← 官方 Extension，包括官方 Web UI
```

**两条铁律**：

1. `loom-engine` 仓库永远不出现 Studio 的概念。Studio 引用 `@loom/core`，反向不存在。
2. Studio 的 Extension SDK 是 Studio 生态的产物，不是 Loom 引擎的一部分。`@loom/core` 永远只承诺"提示词组装"。

这条边界让 Loom 引擎能服务 Studio 之外的世界（别人用 `@loom/core` 写 CLI、服务端管线、其他应用），同时 Studio 也可以在不修改引擎的前提下野蛮生长。

### Engine ABI Lifecycle

- Extension manifest 必须声明 `engines.studio`
- 只有直接贡献 Loom Pass / 依赖 Loom Core ABI 的 Extension 才声明 `engines.loom`
- Studio 启动时校验适用的 engine range
- `@loom/core` 大版本变更 → Studio 大版本变更 → 所有 Extension 至少要刷 manifest 的 `engines` 字段
- Studio 团队内部先验证新 Core 无回归后，才在某个 Studio 大版本里 bump `@loom/core` 依赖

---

## 4. The Four Layers

```
┌─────────────────────────────────────────────────┐
│  L4  Surface Layer                              │
│  Transport 客户端、官方 Web UI、独立前端、CLI…    │
├─────────────────────────────────────────────────┤
│  L3  Domain Layer                               │
│  以 Extension 形式存在的领域模型；Kernel 不认识它们│
├─────────────────────────────────────────────────┤
│  L2  Kernel Layer                               │
│  Document Store · Plugin Host · Event Bus ·     │
│  Capability Broker · Loom Runner · Transport    │
├─────────────────────────────────────────────────┤
│  L1  Engine Layer                               │
│  Fragment · Pass · Pipeline · Resolve           │
│  来自 npm: @loom/core                            │
└─────────────────────────────────────────────────┘
```

**单向依赖规则**：

- 上层可以引用下层；下层永不知道上层
- L3 / L4 只能通过 L2 暴露的接口访问 L1，**禁止跨层直接 import `@loom/core`**

为什么禁止跨层直连？因为 Kernel 必须是 trace、capability、调度的**唯一入口**。任何 Extension 偷偷起一个 Pipeline，DevTools 就丢失上下文，平台属性瞬间崩塌。

---

## 5. Data Layer

数据层拆成多个独立关注，混在一起讨论会乱。

### 5.1 Storage Semantics

Kernel 只承认一种数据单元：**Document**。

```ts
type DocId = `${string}:${string}`        // e.g. "official.chat.session:01HXYZ..."

interface Document<T = unknown> {
  id: DocId
  type: string                            // 字符串命名空间，Kernel 不认识其含义
  version: number                         // 单调递增，写入时做乐观并发
  content: T                              // 任意 JSON，Kernel 不理解业务语义
  meta: {
    createdAt: string
    updatedAt: string
    ownerExtensionId?: string             // 注册或拥有此 type 的 Extension
    tags?: string[]
  }
}
```

Kernel 提供的 API 极少：

```
get(id)
put(doc)
patch(id, jsonPatch, expectedVersion)
list(type, query?)
subscribe(type | id, listener)
```

**没有关系、没有外键、没有事务、没有跨 type 查询。** 需要这些的领域 Extension 自己往 `content` 里塞 ID、自己在应用层维护一致性。这是 ECS 哲学在数据层的复刻，与 Loom 引擎"平铺优于嵌套"一脉相承。

**Document Type Schema** 由注册它的 Extension 通过 Extension SDK 声明（JSON Schema 或类似），Kernel 持有 schema 仅用于 introspection（Tenet III），**不用它做校验**。校验是 Extension 自己的事。

#### `system.*` 命名空间保留

`system.*` 是 Kernel 自身使用的 Document type 命名空间（见 §5.6）。**Extension 不应注册或直接写入 `system.*` type**——它们由 Kernel 持有写权限，Extension 只读。

### 5.2 Persistence Backend

把"语义"和"用什么存"解耦：

```ts
interface DocumentBackend {
  read(id): Promise<Document | null>
  write(doc): Promise<void>
  list(type, query): AsyncIterable<Document>
  watch(filter): AsyncIterable<DocumentEvent>
}
```

**默认实现：单文件 SQLite + WAL 模式**（`better-sqlite3` 同步 API + 二进制预编译）。

为什么 SQLite 而不是"一堆 JSON 文件"：

- **原子性**：单文件 + WAL，事务原子性是数据库给的，不用我们手写 fsync+rename 的舞蹈
- **查询能力**：`list(type, query?)` 在文件夹方案下要么自己实现索引、要么每次 scan，SQLite 一个 `WHERE type=? ORDER BY ...` 解决
- **变更订阅**：SQLite 的 update hook 比 fs.watch 跨平台稳定
- **可移植**：一个 `workspace.db` 文件就是用户的完整数据，备份/迁移就是 cp 一个文件
- **生态**：Node 平台第一档稳定

**SQLite 是默认后端而非唯一后端**。`DocumentBackend` 是一个接口，未来可以接 CRDT（多人协作）、网络数据库（NAS 共享）、其他方案。Kernel 只承诺"语义不变"。

### 5.3 Projection Pattern

派生视图（如"按 sessionId 分组的 message 列表"、"按 tag 索引的卡库"）**完全是 Extension 自己的事**，但要在架构里给它留位置：

- 一个 Server Part 可以在内存里维护派生视图
- 视图通过订阅 Document 事件保持同步
- 视图永不写回 Kernel
- 不同 Extension 可以维护**冲突的视图**（这是 feature）

Extension SDK 提供 `defineProjection()` 帮助函数，但 Kernel 对它一无所知。

### 5.4 Extension Scratch Space

不是所有 Extension 数据都适合塞进 Document Store。例如：

- 向量库的 ANN 索引（需要 mmap、二进制、特殊 IO 模式）
- LLM provider 的请求缓存（半结构化、TTL 驱动）
- 重型 Extension 自己的 SQLite / lmdb / 二进制文件

这些**不该污染 Document Store**——它们语义不是 user-facing 的 typed JSON。强塞会污染 introspection、污染备份导出、性能也差。

每个 Extension 在 workspace 内拥有一个独立目录：

```
<workspace>/extensions/<extension-id>/
```

约定：

- Extension 默认拥有此目录的 `fs:rw:own` capability，**无需用户额外审批**
- Extension 完全自主决定目录内的格式（sqlite/lmdb/jsonl/二进制）
- 跨 Extension 访问需更高 capability（`fs:rw:other:<id>`），需用户显式授权
- **此目录在 workspace 备份时一起被打包**——Kernel 唯一的承诺
- Extension 卸载时此目录由用户决定保留或删除

Document Store 与 Scratch Space 共同覆盖 Extension 95% 的存储需求：普通 Extension（记忆条目这种）用 Document Store；重型 Extension（向量库、知识图）用 Scratch Space。

### 5.5 Minimal Provision

启动一个空的 Studio，看到的世界是：

- 一个空 workspace（仅有 `workspace.db` 与基础结构）
- Document Store 6 个 API
- 一条 Transport 通道
- `system.introspect` 返回一张接近空的能力图
- 一句"安装 Extension 开始使用"

**没有** chat 概念、message 概念、character 概念、任何内置 UI、任何内置 LLM provider。这是平台正确的初始状态。

### 5.6 Self-Hosting

Kernel 自身需要存的东西也走 Document Store，使用 Kernel 命名空间下的 Document type：

- `system.trace` —— 每次 invocation 的完整快照（见 §10）
- `system.audit` —— capability 调用与拒绝的审计记录
- `system.setting` —— Kernel 与 workspace 级设置
- `system.capability-grant` —— capability 授权记录（与锁文件互补）
- `system.invocation` —— 进行中 invocation 的索引（短生命周期，结束即删）

这样 Kernel 内部状态与 Extension 外部状态用**同一种存储原语**——DevTools 能用同一种方式 introspect 两者，备份机制天然覆盖两者。**Kernel 自己也是 Document Store 的用户，跟 Extension 平起平坐。**

这是一种自指的优雅，也呼应了 Tenet III：连 Kernel 自己注册的东西也是可发现的。

### 5.7 Workspace Layout

```
my-workspace/
  loom-studio.json              ← workspace 元信息（版本、激活的 Extensions、settings）
  loom-studio.lock              ← Extension 版本与 capability 授权的锁
  workspace.db                  ← Document Store 默认 SQLite 后端
  workspace.db-wal              ← SQLite WAL 文件
  extensions/installed/         ← 本 workspace 安装的 Extension 源
    com.author.memory@1.4.2/
      manifest.json
      server/
      client/
  extensions/scratch/           ← Extension Scratch Space
    com.author.memory/
      vectors.sqlite
      cache/
    official.tokenizer/
      tiktoken-cache/
  .loom/
    cache/                      ← Kernel 派生数据，可删
    token                       ← Transport 鉴权 token
```

**关键性质**：workspace 是**可压缩、可拷贝、可 git** 的。备份 = 打包整个文件夹。分享一组"卡 + 世界书 + 预设" = 分享一个 zip 或一个 git repo。这是本地部署社区最在意的属性，必须从架构层保证。

> 注：`workspace.db` 是二进制，git 友好度差。爱手动管文件 / 想 git 历史可读的用户可换成未来提供的 `FsBackend`（每 doc 一 JSON 文件）。Kernel 通过接口承诺两种后端语义等价。

### 5.8 Workspace 与 Process 的关系

**一个 Studio 进程对应一个 workspace**。要管多个 workspace 就开多个进程，每个进程绑不同端口。

但是——**一个 workspace 装用户的全部内容库**。几百上千张角色卡、所有世界书、所有会话都在同一个 workspace 内。切换角色 = 在同一个进程里切一个 active document，**不重启任何东西**。

游戏引擎/IDE 模型（一项目一进程）不能直接照搬到 LLM 应用，因为 LLM 应用的"资产"是轻、量大、关系弱的；用户期望"打开一次工具，里面是我所有的卡"。

---

## 6. Kernel Services

Kernel = 6 个服务的总和。每个服务都遵循 *The Kernel Does Less*。

### 6.1 Document Store

见 §5。Kernel 只懂 Document，不懂 chat / message / character。默认 SQLite 后端，接口可换。Kernel 自身的 trace / audit / platform configuration documents 也走它（Self-Hosting，§5.6）。这里避免使用 `settings` 作为主要术语，以免和 AIRP `Setting Layer` 混淆。

### 6.2 Extension Host

负责 Extension 的发现、加载、激活、回收。

- **加载源**：本地路径 / git url / npm 包；第一阶段先支持本地路径
- **manifest**：JSON，声明 id / version / engines / capabilities / contributes / activationEvents
- **激活模型**：懒加载，按 activationEvent 触发（"打开了某 type 的 doc"、"用户运行了某 command"、"启动时"）
- **隔离边界**：Server Part 默认 inproc；少数 Extension 可声明 `isolation: "worker"`（详见 §7）

### 6.3 Event Bus

类型化、命名空间化的 pub/sub：

- 通道命名约定：`<extensionId>.<domain>.<verb>`，例如 `official.chat.message.appended`
- 同步发射 + 异步订阅（不让一个慢订阅者阻塞发射方）
- 所有事件通道在 Tenet III 下可被 introspect
- Kernel 自身也用它：文档变更、Extension 激活、Loom invocation 生命周期都走这条总线

### 6.4 Capability Broker

每个 Extension 在 manifest 里声明它要什么能力：

```
docs:rw:chat.*
net:fetch:openai.com
loom:run
fs:rw:own                ← Scratch Space 默认能力
fs:rw:other:<id>         ← 跨 Extension 访问
```

Broker 在加载时让用户审批（或读 trust policy），运行时拦截每次跨 capability 的调用。**Loom 引擎本身就是一种 capability**（`loom:run`）。

没有 Capability Broker，"Studio 是平台"是一句空话。

### 6.5 Loom Runner

Loom Runner 是 Kernel 对 `@loom/core` 的受控包装。它是 **Tenet IV 的物理体现**。

```ts
kernel.loom.run({
  passes:    Pass[],          // 已经排好序的扁平数组（ADR-001）
  fragments: Fragment[],      // 调用方组装好的初始 fragment

  invoker: {
    stackId?:    string       // 调用方自我声明属于哪个栈，可空
    clientId:    string       // Transport 层注入：哪个客户端发起
    callerRef?:  string       // 调用方自由塞，用于事后关联回业务
                              // 例: "st.chat.session:abc"
  },

  options: {
    signal?:   AbortSignal    // 取消支持
    timeout?:  number
    traceId?:  string         // 可选，否则 Kernel 自动生成
  }
}) → AsyncIterable<TraceEvent> | Promise<Fragment[]>
```

**核心契约**：

1. **纯函数化**——同一组输入得到同一组输出（受 Pass 自身确定性约束）
2. **可重入**——任意并发调用，互不感知；Kernel 内部不持锁
3. **无会话状态**——Runner 不缓存"上一次"，每次完全独立
4. **invoker 是自我声明**——`stackId` / `callerRef` 由调用方自报，Kernel 不验证不解读，**只忠实落进 trace**；`clientId` 由 Transport 层填，可信
5. **取消是协作式的**——`AbortSignal` 在 Pass 之间生效（Pass 是原子粒度）
6. **trace 写入是 fire-and-forget**——invoke 返回不等 trace 落盘；trace 写失败不影响业务返回

**Runner 自身的 Pass Registry**：所有 Extension 通过 manifest `contributes.passes` 注册的 Pass 进入一张全局表。任何 Extension 在调 `loom.run` 时可按 name 引用别人的 Pass——这是跨 Extension 编排的基础（也是 Tenet III 在编排层的兑现）。

**Runner 不做的事**：

- 不重排 Pass 数组（顺序由调用方负责，引擎也不重排，ADR-001）
- 不替任何栈"维护当前会话"
- 不替任何栈做 Source（把 Document 转 Fragment 是栈的事）
- 不替任何栈做 Orchestration（决定哪些 Pass、什么顺序是栈的事，§9）

### 6.6 Transport

**唯一一条**对外通道，本地 WebSocket（或 Unix domain socket）。

- 协议：JSON-RPC 2.0 + 一种自定义的 stream message
- 暴露的 namespace：
  - `docs.*` —— Document Store CRUD
  - `events.*` —— 订阅与发射
  - `commands.*` —— 命令运行
  - `loom.*` —— 引擎入口
  - `extensions.*` —— Extension 注册的 RPC（命名空间由各 Extension 自己决定）
  - `system.*` —— Kernel 元能力，含 `system.introspect`（Tenet III）
- 鉴权：默认 workspace-scoped token，写在 `.loom/token`，客户端连接时必须携带
- **不暴露**：`plugins.load` 这类管理操作（要做也走另一个 admin socket，需要更高 capability）

#### `system.introspect`

返回平台运行时的完整能力图：

```jsonc
{
  "studio":     { "version": "0.3.0" },
  "loom":       { "version": "0.1.0" },
  "extensions": [
    {
      "id": "com.author.memory",
      "version": "1.4.2",
      "documentTypes": [
        { "type": "memory.entry", "schema": { /* JSON Schema */ } }
      ],
      "rpc": [
        { "name": "memory.search", "params": {...}, "returns": {...}, "stream": false }
      ],
      "events": [
        { "name": "memory.indexed", "payload": {...} }
      ],
      "passes":   [ { "name": "MemoryRecallPass", "version": "1.0.0", "provides": [...], "requires": [...] } ],
      "commands": [ { "name": "memory.rebuild-index", "title": "重建记忆索引" } ]
    }
  ]
}
```

Transport 是 Tenet II 与 Tenet III 的物理体现。

---

## 7. Extension Model

Extension 是 Studio 的扩展一等公民。它有两个独立的可分发部分：**Server Part** 与 **Client Part**。两者**通过协议而不是组件库连接**，可独立分发，任一可缺席。

### 7.1 Repository Layout

约定一个 Extension 仓库长这样：

```
com.author.memory/
├── manifest.json                  ← 同时声明 server / client 两 part（任一可省略）
├── README.md
├── server/                        ← Server Part 源（任一可省略）
│   ├── index.js                   ← manifest.server.entry 指向此
│   ├── recall-pass.js
│   └── ...向量库、算法...
└── client/                        ← Client Part 源（任一可省略）
    ├── dist/                      ← manifest.client.entry 指向 bundle entry
    ├── views/
    └── ...React / Vue / 原生 ...
```

**第一版只支持单 Extension 仓库**（一个 git url / npm 包 = 一个 Extension）。monorepo 作者自己把子目录作为分发单位（git subtree、submodule、npm 单包）。

### 7.2 Manifest

```jsonc
{
  "manifestVersion": 1,
  "id": "com.author.memory",
  "version": "1.4.2",
  "displayName": "Memory Extension",
  "engines": {
    "studio": "^0.1.0"
  },

  // —— Extension 间依赖（决定 Extension 的加载顺序与可满足性） ——
  "dependencies":     { "official.tokenizer": "^1.0.0" },
  "peerDependencies": { "official.character": "^1.0.0" },
  "conflicts":        { "thirdparty.alt-memory": "*" },

  // —— Pass 间依赖（决定 Pipeline 内 Pass 的相对位置；Loom Engine 由 ADR-001 约束 —— Studio 在送入引擎前完成扁平化）——
  "provides": ["loom.pass.memory-recall"],
  "requires": ["loom.pass.history-window"],

  "capabilities": {
    "required": [
      { "id": "docs.write", "scope": "memory.*", "reason": "Store memory entries" },
      { "id": "loom.run", "scope": "*", "reason": "Run memory recall pass" }
    ]
  },

  "contributes": {
    "documentTypes": ["memory.entry"],
    "passes":        ["MemoryRecallPass"],
    "rpc":           ["memory.search", "memory.embed", "memory.upsert"],
    "events":        ["memory.indexed", "memory.recalled"]
  },

  "server": {
    "entry": "./server/index.js",
    "isolation": "inproc"
  },

  "client": {
    "entry": "./client/dist/index.js",
    "consumes": {
      "rpc":    ["memory.search", "memory.upsert"],
      "events": ["memory.indexed"]
    }
  },

  "activation": {
    "events": ["onDocument:memory.*", "onCommand:memory.*"]
  }
}
```

#### Pass 是命名注册物

顶层 `contributes.passes` 注册的 Pass 进入 Kernel 的全局 Pass Registry，**任何 Extension 都可按名引用**。这是跨 Extension 编排（特别是 Concept Stack 编排别人提供的 Pass）的基础——也是 Tenet III 在 Pipeline 层的兑现。

### 7.3 Server Part

运行在 Kernel 内，负责 Extension 的"能力"。它是协议提供者：

- 注册 Document Type 与 schema
- 注册 Pass，进入全局 Pass Registry
- 注册 RPC，向所有合法 Studio 客户端开放
- 注册 Event channels

**关键性质**：Server Part **不知道**自己在为哪个 UI 服务。它对自己的能力消费者一视同仁——官方 Web UI、独立前端、其他 Extension 的 Client Part 都通过同一组 RPC 调用它。这就是"protocol-shaped, not application-shaped"。

#### 隔离模型

Server Part 默认运行在主线程（inproc）。Extension 可在 manifest 里声明 `isolation: "worker"`，进入独立 `worker_threads`。

|  | inproc | worker |
|---|---|---|
| 序列化开销 | 无 | structured clone 每次跨边界 |
| 故障隔离 | 一坏全坏 | 强 |
| 共享状态 | 自然 | 难（SharedArrayBuffer 或 message） |
| CPU 抢占 | 卡 UI | 真并行 |
| 同步 API | 可用 | 不可能 |
| 启动 | 即时 | 几十~上百毫秒 |
| 调试 | 简单 | 复杂 |

**指导**：

- 大部分 Extension 是 inproc。Provider（IO 异步即可）、纯函数 Pass、领域 schema 注册器、ST 兼容层都属此类。
- worker 模式留给：tokenizer、本地嵌入、向量检索、规则引擎、不信任来源的 Extension。
- LLM 应用整体偏轻量异步，**不要**默认推 worker。worker 是少数派 opt-in。

**Extension SDK 在两种模式下 API 完全相同**——Extension 作者不写两套代码，区别只在 Kernel 启动它时把它装进哪个执行容器。

#### 数据形态约束

跨边界数据（包括 inproc 的事件总线在内）收敛成"可结构克隆的 plain object"。Document 已经是 JSON-able，Fragment 也是。这一约束反过来强化 Loom 引擎"Fragment 是数据不是行为"的纪律，并直接支撑 Trace 的可序列化（§10）。

### 7.4 Client Part

**Studio Kernel 不感知 Client Part 的形态**。manifest 里 `client.entry` 只是一个静态资源入口，Kernel 把这个指针通过 Transport 暴露给 Client Host Bridge，宿主通过 sandbox activation 决定怎么用。

不同宿主可以用不同方式：

- 官方 Web UI：通过 Dock convention（§7.5）默认挂载
- 独立角色卡前端 page：直接 `import` 进自己的工程，按自己设计语言渲染；或选择性引入 Dock 组件以瞬间获得"用户已装的所有 Extension UI"
- CLI 客户端：忽略 Client Part 不挂载即可
- 桌面套壳客户端：用 webview 加载

**Studio 不定义 Client Part 的 API 形状、不定义挂载方式、不规定 UI 框架**。这是 Tenet II（Transport API is the Contract）的延伸——UI 不在契约里，所以 UI 不被约束。

#### Extension 拓扑

| 类型 | server | client | 例子 |
|---|---|---|---|
| 纯能力 Extension | ✓ | — | tokenizer、provider、向量算法、纯 Pass 库 |
| 纯 UI Extension | — | ✓ | 主题包、新视图（用现有 RPC 组合） |
| 双形态 Extension | ✓ | ✓ | 记忆、文生图、世界书管理器 |
| **Concept Stack** | ✓ | (常带) | `loom-studio-st`、未来的新对话栈、LARP 栈 |

**纯 Server Part 与纯 Client Part 都是一等公民**。后端大佬只发后端，前端大佬只发前端，组合由用户在 workspace 里完成。

**Concept Stack 是一种特殊的双形态 Extension**——它的 Server Part 比一般 Extension 多承担一件事：注册一组 `compose(input) → Pass[]` 与 `invoke(input) → Stream<Result>` RPC，把"概念哲学 + Source + Pass 编排"打包成可被任何客户端调用的能力。详见 §9。

### 7.5 Default Presentation: Dock Convention

> **重要**：Dock 是**生态级 convention**，不是平台级 contract。Kernel 与 Transport 完全不知道 Dock 存在。

官方 Web UI 提供一个 **Dock** 组件作为 Extension Client Part 的默认呈现位（隐喻借自 macOS Dock，是"应用启动器"而非"功能栏"）：

- Extension 默认呈现为 Dock 上的一个图标 / 槽位
- 点开 = 展开它的 Client Part（一个面板、一个抽屉、一个浮窗，由 Extension 自己决定）
- Extension 作者**不被强迫用 Dock**——他可以在 Client Part 里做悬浮窗、做全屏接管、做侧边抽屉，Dock 只是"如果你不知道挂哪，挂这里"

**Dock 作为独立 npm 包**（`@loom-studio/dock`），独立前端作者可选择性引入：

```jsx
// 作者写的西幻 page
<MyFantasyUI>
  <SoulBookView />              {/* 他自己的全部门面 */}
  <LoomDock position="bottom"/> {/* 装了的所有 Extension UI 都在这里 */}
</MyFantasyUI>
```

——他什么都不写，就拿到了用户已装的所有 Extension UI。这是 Extension 前后端分离这件事最具体的兑现：**最低成本路径**（用 Dock 就有）和**最高自由度路径**（完全替换 / 重写 Extension UI 成"灵魂之书"）两端齐备，中间不强行拉一条。

Client Part 具体的挂载协议（postMessage 形态、生命周期事件、视觉约定）属于 Dock 与官方 Web UI 内部的实现细节，**不是平台架构层的承诺**，留待 Web UI 文档单独规范。

### 7.6 Extension Resolver

加载流程：

```
扫 extensions/installed/ → 解析 manifests
  → SAT 求解（dependencies / conflicts / engines / version 兼容）
  → 失败：列出最小冲突集，报给用户（人类可读：
     "memory 想要 tokenizer^2，但 chat 锁定 tokenizer^1，
      请考虑升级 chat 到 1.5.0"）
  → 成功：拓扑排序 → 按序激活
  → 激活时跑 capability 授权（首次询问用户；之后读锁文件）
```

第一版 SAT 可以是朴素实现，但 `ExtensionResolver.resolve(manifests, lockfile?) → Plan | Conflict[]` 接口从一开始稳定。

### 7.7 Lockfile

```jsonc
// loom-studio.lock
{
  "version": 1,
  "extensions": {
    "official.chat": {
      "version": "1.2.3",
      "source": "git+https://github.com/foo/loom-studio-st#v1.2.3",
      "integrity": "sha256-...",
      "capabilities": ["docs:rw:chat.*", "loom:run"],
      "approvedAt": "2026-04-27T10:00:00Z"
    }
  }
}
```

锁文件做四件事：

1. 复现性（同一 workspace 在另一台机上启动行为一致）
2. capability 审批的持久化（不每次启动都问）
3. 拓扑解的缓存（启动快）
4. 来源溯源（防止"同名异物"替换攻击）

**锁文件进 git。** 这对本地部署社区分享 workspace 是关键。

### 7.8 Installation

第一版安装链路：**URL + 声明依赖**。

```
loom-studio install https://github.com/foo/loom-studio-st
loom-studio install npm:loom-extension-memory
loom-studio install file:./my-local-extension
```

或在官方 Web UI 里粘贴 URL → 点"安装"。

#### 内部流程

1. fetch / clone / npm install 到 `extensions/installed/<id>@<version>/`
2. 解析 manifest，读取 `dependencies` / `peerDependencies` / `engines`
3. 跑可满足性求解——若有未装依赖，**显示**"将一并安装：A、B、C"，用户确认后递归装
4. 解析 capability 请求，**显示**"此 Extension 申请：访问网络（openai.com）、读写记忆文档"，用户确认
5. 写进 `loom-studio.lock`（含 source、integrity、approvedAt）
6. 下次启动激活

#### 关键设计决策

- **没有中央仓库**——URL 就是地址，git/npm/local 三种 scheme 即可。这与 Deno 依赖模型一致，与本地部署气质一致。
- **没有自动升级**——`loom-studio update <id>` 显式触发。本地部署人群最讨厌自动更新破坏配置。
- **lockfile 进 git**——一个 workspace 的可复现性靠它。
- **依赖冲突报告人类可读**——这件事容易被低估，但 npm 早期"resolution failed"那种报错是真劝退人。

#### Uninstall Semantics

卸载 Extension 涉及两件事：源码与 Scratch Space 的物理清理（这部分由用户决定保留或删除），以及**它注册的 Document type 残留下的 user-facing 数据**——例如卸载某 Concept Stack 后，那个栈的 chat session、character card 仍然在 Document Store 里。

Studio 采取**orphan + 用户决策**模型：

1. **不阻止卸载**——卸载是用户的权利，平台不家长式拦截
2. **检测并报告 orphan**——卸载前 / 后扫描 Document Store，列出"哪些 type 现在无人提供 schema、无人提供 RPC、无人能解读"
3. **提供处置选项**：
   - **保留**：Documents 仍在 Document Store 里，type 字段不变；将来重装该 Extension 可恢复完整功能
   - **导出**：把 orphan documents 打包成 JSON 文件让用户带走
   - **删除**：用户确认后清除
4. **DevTools 视角**：orphan documents 在 introspection 里有明确标记（`orphaned: true`），用户随时能查看与处理

这条策略对应 Tenet I 的延伸——平台不替用户做"该不该删数据"这种决定，但保证"不替用户做决定的同时，把决策所需的信息全部呈现"。

---

## 8. Card Script (deferred)

角色卡自带的前端脚本（如"xxx 的日记本前端"）是与 Extension **截然不同**的扩展物：

- 生命周期 = 所属 Document 的生命周期，不是进程生命周期
- 跟着角色卡的 zip / json 一起走，不进 `extensions/installed/`、不进锁文件
- 信任模型 = 匿名作者，必须强沙箱
- **架构第一版只承认前端形态**，以 sandboxed iframe 在客户端 Web UI 内加载，通过 postMessage 拿到一个受限的 Studio API
- **Card Script 完全不进 Studio 后端进程**——它只是 Web UI 里的浏览器内沙箱代码。要调后端能力（LLM、记忆、文生图）通过受限 Studio API 走 Transport

第一版**不承认** Card Script 的后端形态——它的安全模型显著更难，且 Extension 已经覆盖了"我想给 LLM 流程加 hook"的需求。

> Studio 处理两类截然不同的扩展物：**用户安装的全局工具（Extension）**与**内容自带的脚本（Card Script）**。前者要稳，后者要安全。Studio 的扩展系统不试图用同一个机制覆盖这两件事。

详细规范留待后续文档。

---

## 9. Loom Engine ↔ Studio: The Composition Boundary

这一节说明 Studio 与 Loom 引擎在运行时如何衔接，以及 Concept Stack 在生态中的具体形态。

### 9.1 Composition Diagram

```
                ┌──────────────────────┐
                │  纯 Loom 生态        │
                │  Pass / Tokenizer /  │
                │  Source helper /     │
                │  DevTool             │
                │                      │
                │  纯 npm 包，不依赖    │
                │  Studio              │
                └─────────┬────────────┘
                          │  通过 npm 引用
                          ▼
    ┌──────────────────────────────────────┐
    │  Studio 生态                         │
    │  ┌────────────────────────────┐      │
    │  │ Pass-only Extension        │      │
    │  │ （包了一层 manifest，让    │      │
    │  │  Loom Pass 同时是 Studio  │      │
    │  │  Pass Registry 成员）     │      │
    │  └────────────────────────────┘      │
    │  ┌────────────────────────────┐      │
    │  │ Server-only Extension      │      │
    │  │ （Provider, tokenizer,    │      │
    │  │  vector store...）        │      │
    │  └────────────────────────────┘      │
    │  ┌────────────────────────────┐      │
    │  │ Dual Extension             │      │
    │  │ Server + Client            │      │
    │  └────────────────────────────┘      │
    │  ┌────────────────────────────┐      │
    │  │ Concept Stack              │      │
    │  │ (compose + invoke RPC +    │      │
    │  │  Pass + DocType + Schema) │      │
    │  └────────────────────────────┘      │
    └──────────────────────────────────────┘
                          │  Transport API
                          ▼
    ┌──────────────────────────────────────┐
    │  客户端生态                          │
    │  Official Web UI / 独立前端 /        │
    │  CLI / Tauri 包装 / OBS overlay      │
    └──────────────────────────────────────┘
```

三个生态层叠，每层都受益于下一层但不被下一层强制。

这个图只描述**物理生态边界**，不描述运行时数据流。Studio 运行时不是一条从 Core 到 Provider 的金字塔流水线，而是 Extension 围绕 Kernel 原语形成的能力图。一次用户操作可以多次调用 `kernel.loom.run`，也可以在 provider / tool / document / event 之间循环多轮。

更接近真实运行形态的是：

```
                         ┌────────────────────┐
                         │  Provider Extension │
                         │  *.invoke / stream  │
                         └─────────▲──────────┘
                                   │ RPC
                                   │
┌──────────────┐     RPC/Event ┌────┴─────────────┐
│ Tool / MCP   │ ◄───────────► │ Runtime / Stack  │
│ Extension    │               │ Extension        │
└──────▲───────┘               └──────▲───────────┘
       │ docs/events                  │ loom.run
       │                              │
┌──────┴──────────────────────────────┴──────┐
│                 Studio Kernel               │
│ Document Store / Event Bus / RPC / Loom Run │
│ Capability / Introspection / Trace / Audit  │
└─────────────────────────────────────────────┘
```

在这个模型里，Kernel 提供节点之间的通道与审计，不规定节点的业务含义。Agent 的 observation、工具调用结果、provider response、用户输入、长期记忆都可以由 Runtime Extension 转成下一次 Loom invocation 的 Fragment 输入。

### 9.2 Pass 的双重身份

> **关键观察**：同一份代码可以同时是 Loom Pass 和 Studio Extension 的注册物。

```
loom-studio-memory/
├── manifest.json                       ← Studio Extension 入口
├── server/
│   ├── entry.ts                        ← 注册到 Kernel
│   └── passes/
│       └── recall.ts                   ← 标准 Loom Pass，纯 import @loom/core
└── package.json
```

- Studio 眼里 `recall.ts` 是 `MemoryRecallPass`，通过 manifest 进入 Pass Registry
- Loom 引擎眼里 `recall.ts` 是一个标准 Pass——任何不用 Studio、直接用 `@loom/core` 的人也能 import 它
- 二者通过 manifest 的 `contributes.passes` 黏合
- **同一份代码，两套生态都能用**

这件事让 Loom 生态的"Pass 库"自然成为 Studio 生态"Extension 库"的子集——任何 Loom Pass 作者只要补一个 manifest，就成了 Studio Extension。

### 9.3 Pass 的纯度规则（反向不污染）

为保持 Loom 引擎的纯度（ADR-001 的 *The Engine Does Less* 在 Studio 这边的延伸），Pass 必须遵守：

1. **Pass 不 import `@loom-studio/*`**——Pass 的输入永远是 Fragment 数组，输出也是 Fragment 数组。它对 Studio 一无所知。
2. **Pass 不调用 Studio RPC**——想调别的 Extension 的能力？把"调用 RPC"的逻辑写在 Server Part 的非 Pass 部分里，准备好结果后再让 Pass 消费。
3. **Pass 是纯函数**——没有副作用、没有持久状态。状态住在 Document Store、Scratch Space、Server Part 内存里；Pass 拿到的只是它们的派生物（通过 Fragment 传入）。

这三条规则不只是工程审美——它们是 Trace 自包含与可回放的物质基础（§10）。

### 9.4 Concept Stack 是什么（精确定义）

> **Concept Stack** 是一种特殊的 Extension，它把"一种概念哲学"打包成可被任何客户端调用的能力。

一个 Concept Stack 通常包含：

- 一组 Document Type 与 Schema（如 `st.chat.session`、`st.character.card`、`st.world.entry`）
- 一组 Pass（如 `StHistoryWindow`、`StWorldInfoInjection`）
- 两个核心 RPC：
  - `compose(input) → Pass[]`：给"我想自己看 pipeline 长什么样再决定怎么跑"的高级用户
  - `invoke(input) → Stream<Result>`：给"我就想直接跑出来"的普通调用
- 通常还附带 Client Part（默认 UI 形态，如 ST 风格的会话 UI）

**关键性质**：

- Concept Stack 的 RPC 是**纯函数式**的——没有"开始一个 session"和"结束一个 session"这种生命周期 RPC。每次调用自带全部上下文。
- Concept Stack **不是 Kernel 的注册概念**——它在 Kernel 眼里就是一个普通 Extension，"Concept Stack" 只是它的设计模式名字。
- 一个 workspace 可装多个 Concept Stack，**同时可用**，由调用方在每次调用时选用。

Concept Stack 可以同时承担 Runtime Extension 的角色，但二者不是同义词：

- 一个 ST 风格 Concept Stack 可能只提供 `compose`，让外部 Runtime 调用 provider
- 一个 Chat Runtime 可能不定义新的 Document schema，只把现有 Stack / Provider / Tool 串起来
- 一个 Agent Runtime 可能每一步都调用不同 Stack 的 `compose`，并把 tool observation 重新转成 Fragment

因此，"Concept Stack" 描述的是**概念哲学与文档 / Pass 词汇**；"Runtime Extension" 描述的是**运行循环与状态推进**。Kernel 都不内置。

### 9.5 Per-Invocation Orchestration

Tenet IV 的工程兑现就在这里。

#### 运行时图

```
全局且无状态：
  · Document Store           (typed JSON, 命名空间隔离)
  · Pass Registry            (name → module 的纯查表)
  · Capability Grants        (lockfile)
  · Server Part 实例         (各自维护自己的状态)

per-invocation 临时计算：
  · 客户端选哪个 Concept Stack 的 RPC 调用
  · Stack 的 compose 决定 Pass[] 数组
  · kernel.loom.run(passes, fragments, invoker, options) 跑一次
  · 写一条 system.trace
  · 结束
```

每一次 invoke 都是从全局资源里挑一组组合，临时拼一个 pipeline，跑完就散。**没有"切换"，因为没有"当前"**。

这里的 `invoke` 指一次 Loom pipeline invocation，不等于一次完整的模型请求，更不等于一次完整的 Agent run。一个 Runtime Extension 可以在同一个高层 run 内多次调用：

```
读取 Document / Runtime State
  → 构造 Fragment[]
  → kernel.loom.run
  → 调 provider RPC
  → 收到 tool call
  → 调 tool / MCP RPC
  → 写入 observation Document
  → 再构造 Fragment[]
  → 再次 kernel.loom.run
  → ...
```

Kernel 只看到一组独立的 Loom invocation 和 RPC / Event / Document 操作；它不需要知道这些操作共同组成了一个 Chat turn、ReAct loop 或 Workflow run。

#### 三个场景

**场景 1：ST 用户和西幻独立前端同时连一个 Studio**

- ST 用户的 Web UI 调 `loom-studio-st.invoke(sessionId, userInput)` RPC
- 西幻独立前端调它自己的栈，比如 `mystack.invoke(sessionId, userInput)` RPC
- 两个 RPC 完全独立，各自内部组装 Fragment → 排序 Pass → 调 `kernel.loom.run`
- Kernel 同时跑两个 invoke，互不知情

**场景 2：同一个用户在同一个 Web UI 里来回切换两个会话，分属不同栈**

- 会话 A 是 ST 风格的（`type: "st.chat.session"`）
- 会话 B 是某新栈的（`type: "novelstack.session"`）
- 用户点 A → Web UI 调 `loom-studio-st.invoke(...)`
- 用户点 B → Web UI 调 `novelstack.invoke(...)`
- **零成本切换**——什么都不需要重启，什么都不需要释放

实现上 Web UI 只需要根据 Document `type` 字段决定调哪个 RPC。这是 Web UI 的逻辑，不是 Kernel 的逻辑。

**场景 3：跨栈调用同一个 Server Part**

记忆插件 `loom-studio-memory` 提供 `MemoryRecallPass`。

- ST 栈在它的 compose 里把 `MemoryRecallPass` 加进 Pass 数组
- 新栈在它的 compose 里也把 `MemoryRecallPass` 加进去
- 两个栈在不同 invoke 里都用了同一个 Pass
- `MemoryRecallPass` 是纯函数（拿 Fragment 数组返回 Fragment 数组），它访问向量索引是通过调用同 Server Part 的内部 API（不是 RPC，因为 Pass 不调 RPC——见 §9.3）
- `memory` 的内部状态（向量索引）是**全局共享的**，不属于任何栈，按 sessionId / 业务 key 分隔即可

### 9.6 Stack Interop

平台不直接支持 Stack 之间的拼接，但**允许调用方自己拼**。

具体路径：

- 高级玩家写一个**自己的小 Extension**（或 Card Script，或独立前端）
- 在 invoke 时调 `loom-studio-st.compose(...)` 拿到 ST 的 Pass[]
- 在中间插入 `newstack.SomeLorebookPass`（从 Pass Registry 里直接拿）
- 再调 `kernel.loom.run(myComposedPasses, fragments, invoker)`

这是 Tenet IV 的真正用法——**编排哲学外移**意味着任何人都可以自己当编排器，包括"魔改两个现成栈拼一个新的"。这是平台性的最具体兑现。

### 9.7 ST 兼容栈：Concept Stack #1

`loom-studio-st`（原 `packages/st`）在 Studio 生态里的真实定位是：

> **Concept Stack #1**——它定义了 `st.chat.session` / `st.character.card` / `st.world.entry` 等 Document type，定义了 ST 风格的 Source（怎么把这些 Document 变成 Fragment），定义了 ST 风格的 compose（按 position/depth/order 排序）。它对 ST 用户是"兼容层"，对生态来说是"第一个完整概念栈"。

它有两个角色：

1. **诱饵作用**：让现役 SillyTavern 用户与扩展作者无痛迁移过来
2. **示范作用**：给未来想做新 Concept Stack 的人一份完整、可读、可学习的参考实现

文档不承诺 ST 兼容栈的完整 API 或 schema 形态——这是它自己的事。Studio 平台层只承诺"它可以作为一个 Extension 存在并工作"。

### 9.8 Loom Engine 的 ADR 承诺反过来支撑 Studio

Studio 这一侧的几个能力，物质基础在 Loom 引擎的几条契约里：

| Studio 能力 | 依赖的 Loom Engine 契约 |
|---|---|
| Trace 自包含 | Fragment 必须 JSON-able |
| Trace 可回放 | Pass 是纯函数 + Pass 带 `version` 字段 |
| 跨栈共用 Pass | Pass 输入输出只是 Fragment 数组，不引用栈概念 |
| 拓扑由调用方负责 | Loom 引擎不重排 Pass（ADR-001） |
| 多 invoke 并发 | Pass 无副作用、Pipeline 无状态 |

两边的契约在边界上彼此支撑、互不污染。

### 9.9 Provider / Tool / Runtime：Extension Pattern 而非 Kernel 层

Studio 不提供内置 AI Gateway，也不提供内置 Agent Framework。Provider、Tool、MCP、Agent Runtime 都是 Extension 形态，而不是 Kernel service。

#### Provider Extension

Provider Extension 是普通 Server Extension。它可以注册：

- `official.provider.openai.invoke`
- `official.provider.openai.stream`
- `official.provider.openai.listModels`
- `official.provider.openai.capabilities`

Kernel 不理解这些 RPC 的语义，只负责：

- 根据 capability 判断调用是否允许
- 通过 Transport / host API 转发调用
- 在 introspection 中暴露 RPC 名称、参数 schema、返回 schema、是否流式
- 在 audit 中记录调用链、耗时、状态

官方可以维护少数 Provider Extension，也可以发布推荐 payload schema；但这只是生态约定，不是 Kernel contract。社区 Provider 可以兼容它，也可以暴露自己的 RPC 形态，只要通过 introspection 说清楚。

#### Tool / MCP Extension

Tool / MCP Extension 也是普通 Server Extension。MCP 只是一种外部协议适配目标，不进入 Studio 内部通信模型。一个 MCP Bridge Extension 可以把 MCP server 的 tools 暴露成 Studio RPC；Agent Runtime 再按需调用这些 RPC。

Kernel 不内置 MCP client，不定义 tool call loop，不把 tool result 解释为 message。它只提供 RPC / Event / Capability / Audit。

#### Runtime Extension

Runtime Extension 负责把多个能力串成运行循环。典型 Runtime 包括：

- Chat Runtime：读取会话 Document → 调 Stack compose / Loom run → 调 provider → 保存 assistant message
- Agent Runtime：维护 plan / scratchpad / observation → 多次 Loom run → 多次 provider / tool RPC → 推进 ReAct 或其他 agent loop
- Workflow Runtime：按节点调 Loom / provider / tool，写入 step Document

Runtime 可以定义自己的 Document type（如 `agent.run`、`agent.step`、`tool.execution`），也可以只消费别人的 Document type。Kernel 不判断它是不是 Runtime。

#### 关于 `messages[]`

`messages[]` 不是 Kernel 的平台产物。它只是某些 Runtime 调 Provider RPC 时选择的一种 payload 形态。

```
Compiled Fragment[]
  --由某个 Runtime / Stack 解释-->
provider RPC payload（可能是 messages[]，也可能是 raw provider request）
  --由 Provider Extension 翻译 / 发送-->
具体模型 API
```

这条边界避免 Provider Extension 直接理解任意 Stack 的 Fragment meta，也避免 Concept Stack 直接绑定具体 provider SDK。需要共享时，官方 Extension 可以提供推荐 RPC convention；需要突破时，Extension 可以通过自己的 RPC schema 暴露能力。

### 9.10 Runtime Graph Examples

Studio 文档不应把运行时画成单向金字塔。下面是几种运行图，它们都由同一组 Kernel 原语支撑。

#### Chat Turn

```
UserMessage Document
  → ST Concept Stack / Chat Runtime
  → Fragment[]
  → kernel.loom.run
  → Provider Extension RPC
  → AssistantMessage Document
```

#### Agent ReAct Loop

```
Goal / AgentState Document
  → Agent Runtime Extension
  → Fragment[]
  → kernel.loom.run
  → Provider Extension RPC
  → ToolCall
  → Tool / MCP Extension RPC
  → Observation Document
  → Fragment[]
  → kernel.loom.run
  → ...
```

#### RAG-Augmented Call

```
User Query
  → Retriever Extension RPC
  → Memory / Evidence Documents or Fragments
  → kernel.loom.run
  → Provider Extension RPC
```

这些图的共同点是：`kernel.loom.run` 是可重复调用的编译节点，不是固定流程的第一半；Provider / Tool / Runtime 都是普通 Extension 节点。

---

## 10. Observability & Trace

Studio 的可观测性建立在一个简单事实上：**Trace 不是会话状态，是事实记录**。它写一次、永远不变、彻底自包含。这让它完美契合 §5 数据层——Trace 就是一种 Document。

### 10.1 Trace 是一种 Document

```jsonc
{
  "id": "system.trace:01HXYZ...",
  "type": "system.trace",
  "version": 1,
  "content": {
    "invocationId": "inv_01HXYZ...",
    "startedAt": "2026-04-28T...",
    "endedAt":   "2026-04-28T...",
    "duration":  1340,

    // 调用方自我声明（Kernel 不验证、不解读）
    "invoker": {
      "stackId":    "loom-studio-st",     // 哪个栈
      "clientId":   "official-web-ui",    // 哪个 Transport 客户端（可信，由 Transport 注入）
      "callerRef":  "st.chat.session:abc" // 调用方塞的业务引用，用于关联回业务
    },

    // 已排好序的 Pass 列表（含版本，关键 —— 见 §10.4 回放）
    "passes": [
      { "name": "StHistoryWindow",   "module": "loom-studio-st@1.2.3",     "version": "1.0.0" },
      { "name": "MemoryRecallPass",  "module": "loom-studio-memory@0.4.1", "version": "1.0.0" }
    ],

    // 初始 Fragment 数组（Loom Engine 已保证 Fragment JSON-able）
    "initialFragments": [...],

    // 每个 Pass 执行后的 Fragment 数组（DevTool 时间轴的核心）
    "stages": [
      { "afterPass": "StHistoryWindow",  "fragments": [...] },
      { "afterPass": "MemoryRecallPass", "fragments": [...] }
    ],

    // 最终结果
    "result": {...},

    // 失败时的错误对象（如有）
    "error": null
  },
  "meta": {
    "createdAt": "2026-04-28T...",
    "updatedAt": "2026-04-28T...",
    "ownerExtensionId": "system",
    "tags": ["trace", "stack:loom-studio-st"]
  }
}
```

### 10.2 Trace 的关键性质

- **完全自包含**——哪怕全部 Extension 都被卸载、栈被换掉，这条 Trace 依然能被读、被理解、被可视化
- **不可变**——写完不再改（`version` 永远 1）
- **可枚举可查询**——作为 Document，享受 §5 数据层全部能力（按 `type` 列表、按 invoker.stackId 分组、按 callerRef 过滤）
- **跨栈天然平等**——`loom-studio-st` 的 trace 与某独立前端的 trace 是同一种 Document type，DevTool 不为不同栈写不同代码
- **写入是 fire-and-forget**——见 §10.5

### 10.3 DevTool 的体验

依赖 Trace 是 Document 这件事，DevTool 本身可以做成一个**纯客户端 Extension**——它订阅 `system.trace`、做 UI 即可。Kernel 不为 DevTool 提供任何特殊接口。

典型界面（具体形态属于 DevTool Extension 自身的设计，本节只示意）：

```
DevTool 主界面：
┌────────────────────────────────────────────────┐
│  Filter: [stack: all ▾]  [client: all ▾]       │
│          [time: today]   [search...]            │
├────────────────────────────────────────────────┤
│  16:42  inv_xxx  loom-studio-st        web-ui  │
│  16:50  inv_xxx  loom-studio-st        web-ui  │
│  20:13  inv_xxx  fantasy-frontend      custom  │
│  20:15  inv_xxx  fantasy-frontend      custom  │
└────────────────────────────────────────────────┘
```

按 `invoker.stackId` 过滤就只看某个栈。按 `callerRef` 过滤就只看跟某张角色卡相关的所有 invoke——**而 Kernel 自己不知道"角色卡"是什么**，DevTool 只是把那个字段当作可过滤的字符串。

**Studio DevTool 复用 `@loom/devtool`** 作为 Pipeline / Fragment 流可视化面板（parentId 树投影、剪枝可视化等已有能力），DevTool 自身只补 Studio 特有的维度（invoker、Document、capability 调用、Extension 拓扑）。

### 10.4 Replay

回放 = 拿一条 Trace 的 `passes` + `initialFragments` 重新跑一遍 `kernel.loom.run`。

回放是否成功取决于**那些 Pass 模块此刻是否还装着、版本是否匹配**：

| 情况 | 行为 |
|---|---|
| Pass 模块仍在、版本一致 | 完全回放，Loom Pass 是纯函数 → 结果应一致（Loom 引擎"确定性"承诺的回报） |
| Pass 模块仍在、版本不同 | 警告"将用当前版本回放，结果可能不同"，让用户选 |
| Pass 模块已卸载 | 不能回放，但仍可**只读查看**这条 trace 的 Fragment 流水（DevTool 仍然全功能可视化） |

最后一种情况就是 Trace 自包含的回报——**即便 Extension 全卸了，trace 仍然有用**。

### 10.5 写入语义

Trace 写入是 **fire-and-forget**：

- invoke 完成 → Kernel **异步**把 trace push 进 Document Store
- invoke 的返回 promise **不等** trace 落盘
- 如果 trace 写失败（磁盘满之类），**不影响** invoke 已返回的结果，只在 Kernel 日志里报告
- 这是性能上的硬约束：observability 永远不阻塞业务

### 10.6 Pass 跨栈复用的可观测性

因为 Trace 自包含且查得动，DevTool 可以做一件之前架构里完全没承诺、但很有价值的事：

> 用户在某栈 A 的 trace 里看到一个 `MemoryRecallPass`，DevTool 顺手列出"这个 Pass 在过去 30 天被哪些栈调用过、各调了多少次"——直接通过 `system.trace` Document 的查询就能算出来。

**Pass 跨栈复用的可观测性**自然落地，没有任何额外机制。这件事也间接回答了"Server Part 状态命名空间约定要不要平台层介入"——**不需要，trace 提供的事后可观测性已足以让生态自己形成最佳实践**。

---

## 11. Extensibility Rings

Studio 同时服务多种深度差异巨大的玩家。三圈结构是这一承诺的具体形态。

```
        ┌─────────────────────────────────────────┐
        │  外圈：Transport API                     │  ← 任何语言、任何客户端
        │  ┌───────────────────────────────────┐  │
        │  │  中圈：Extension SDK               │  │  ← TS Extension 作者
        │  │  ┌─────────────────────────────┐  │  │
        │  │  │  内圈：Shell Toolkit + Dock  │  │  │  ← Client Part 视图作者
        │  │  │  （官方 Web UI 的 UI 原语）   │  │  │
        │  │  └─────────────────────────────┘  │  │
        │  └───────────────────────────────────┘  │
        └─────────────────────────────────────────┘
```

| 玩家类型 | 用什么圈 | 投入 |
|---|---|---|
| 用户 | 装别人的 Extension | 零 |
| 改皮玩家 | 内圈 Toolkit + 一个 Client-only Extension | 几小时 |
| 平台扩展者 | 中圈 SDK | 一个周末到一周 |
| 独立前端作者 | 外圈协议（可选 import Dock） | 一个项目 |
| Kernel 黑客 | 直接 fork Studio | 长期投入 |

### 内圈：Shell Toolkit + Dock

- 一组官方提供的 UI 原语：消息气泡、流式文本、命令面板、设置面板、文档列表
- 加上 Dock 组件（§7.5）
- 给"我只想给默认 UI 加一个按钮"的玩家用
- 不强制使用，但用了就能融入官方 UI
- **它本身只是官方 Web UI 的一部分**，不是 Studio 平台的一部分；同时也作为独立 npm 包发布，让独立前端作者也能用

### 中圈：Extension SDK

- TypeScript 包（`@loom-studio/extension-sdk`），含 manifest 类型、Document 类型、capability helpers、`defineProjection`、`defineCommand`、`defineRpc`、`defineEvent` 等便利函数
- 给"我想加新文档类型 / 新 Pass / 新命令 / 新 RPC"的玩家用
- 可完全不写 UI（headless Extension），也可只写 UI（视图 Extension）

### 外圈：Transport API

- 纯协议（JSON-RPC over WS + stream message），有版本号、有 schema
- 任何语言、任何运行时都能写一个客户端
- Vim 插件、iOS 原生 App、Discord bot、OBS overlay 都是这一层的客户端
- **官方 Web UI 也是这一层的一个客户端**，无任何特殊待遇
- `system.introspect` 让外圈客户端不必读源码就能发现后端能力（Tenet III）

> Tenet II 的工程意义在这里得到具体形态：Studio 把"客户端"和"Extension"当作平等公民，区别只在物理位置——Extension 在进程内，客户端在进程外。两者通过同一组接口看到同一个 Kernel。

---

## 12. The Eight Boundary Decisions

正式立项需明确站位的八件事。

| # | 决定 | 站位 |
|---|---|---|
| 1 | **进程模型** | Server Part 默认 inproc；worker 是少数 opt-in（manifest 显式声明）。Extension SDK 在两种模式下 API 一致。Card Script 走 Web UI 内 sandboxed iframe，与 Extension 隔离机制不共用 |
| 2 | **打包形态** | Studio 是 Node.js 应用，第一阶段以源码 + `npm run` 启动；内置官方 Web UI；headless 模式（仅 Kernel + Transport，不挂 UI）恒在；desktop bundle / embedded 模式列入 v1 路线图 |
| 3 | **Workspace** | 单进程单 workspace；一个 workspace 装用户全部内容库（几百上千张卡），切换角色 = 切 active document，不重启进程；workspace 文件夹可压缩、可拷贝、可 git |
| 4 | **信任** | Extension 用 manifest + capability + 锁文件管理；锁文件入 git；Card Script 用 sandbox + 加载时权限请求；无签名、无中心仓库、无自动更新 |
| 5 | **引擎绑定** | manifest 必须声明 `engines.studio`；只有直接贡献 Loom Pass / 依赖 Loom Core ABI 的 Extension 才声明 `engines.loom`；Studio 团队先内部验证 Core 再 bump |
| 6 | **Extension 形态** | Server Part 与 Client Part 独立分发，通过 Transport API 连接；Studio Kernel 不感知 Client Part 形态；任一 Part 可缺席；Dock 是 Web UI 端的 convention，不是平台 contract |
| 7 | **安装链路** | URL + 三种 scheme（git / npm / local）+ 锁文件 + 显式 capability 确认；无中央仓库、无自动更新；第一版只支持单 Extension 仓库；卸载采用 orphan + 用户决策模型 |
| 8 | **运行时边界** | Kernel 不内置 Chat Runtime / Agent Runtime / Provider Gateway / Tool Loop / MCP Bridge；这些都是 Extension Pattern。Kernel 只提供 RPC / Event / Document / Loom Runner / Capability / Introspection / Audit |

---

## 13. Non-Goals

平台架构最有用的部分是它列出的"不做"。这些条目越多，平台属性越强。

- **Kernel 不发布 official chat / character / worldbook schemas**——默认 AIRP 领域模型由 Studio AIRP Layer 提供，但不进入 Kernel
- **不把第三方完整上层体验强行并入 Studio AIRP Layer**——完全不同的体验后续应通过隔离进程 / 数据根 / namespace 等方式讨论
- 不内置任何 LLM provider
- 不抹平 LLM provider 差异（无 AI Gateway）
- 不内置 Chat Runtime / Agent Runtime / Workflow Runtime
- 不内置 Tool Loop；模型 tool call 如何推进下一步由 Runtime Extension 决定
- 不把 `messages[]`、`InvocationDraft` 或任何 provider-neutral request schema 作为 Kernel contract
- 不内置全文搜索、向量检索、嵌入算法
- 不假设官方 Web UI 必然存在
- 不替 Extension 决定 UI 形态、UI 框架、UI 挂载方式（Dock 是 convention，可被忽略可被替换）
- 不做云端同步、用户系统、多租户、SaaS
- 不做中央插件市场
- 不做插件签名 / 中央信任根
- 不做插件自动更新
- 不做内置 MCP 客户端（MCP 是 Extension 的事，作为外部协议适配器，不进入内部通信）
- 不做内置 HTTP 路由 / 鉴权策略
- 不做跨 workspace 的数据流通（多 workspace 通过开多进程实现）
- 不做插件级别的"读写另一个插件的 doc"——一切跨 Extension 通信走 RPC / Event
- 不做"全局当前会话"或"激活栈"概念（Tenet IV）

### 关于上层体验协议的软约定（非承诺）

Kernel 不定义业务概念。Studio 默认 AIRP 体验由 Studio AIRP Layer 提供；第三方完整上层体验如果需要独立语义，应公开自己的事件命名空间与 Document schema，供其他 Extension 适配。生态会自然形成"事实标准"——这与 Linux 社区对窗口管理协议形成 EWMH 的方式一致：内核不管，社区形成共识。

### 关于 Provider / Runtime RPC 的软约定（非承诺）

Studio 不定义内置模型调用协议，但**鼓励**官方 Provider Extension 和官方 Runtime Extension 发布自己的 RPC schema，作为生态可选 convention。Kernel 不校验这些 payload，也不要求所有 Provider 兼容同一个 `messages[]` 形态；它只要求 RPC / Event / Document schema 可以被 introspect。

---

## 14. Open Questions

明确标记尚未拍板的事项，避免未来贡献者把"未定"误读为"已定"。

1. **Workspace 多端共享**：多设备同步是 Extension 的事，还是 Document Backend 的事？倾向后者，但接口长什么样未定。
2. **Card Script Backend 形态**：第一版只承认 frontend Card Script。是否在某个版本承认 backend Card Script（用 `node:vm` / `isolated-vm`），以及它的安全模型，留待 §8 详细文档。
3. **Plugin Resolver 的语义版本策略**：semver 严格匹配？还是允许 caret/tilde？倾向严格 semver + caret 默认，但 conflicts 字段的语义（"任何版本互斥"还是"特定 range 互斥"）需细化。
4. **Trace 保留策略**：trace 落 `system.trace` 文档在长期使用下会膨胀。需要 retention policy（按数量 / 按时间 / 错误优先 / 用户 pin）；策略由 Kernel 提供还是 DevTool Extension 提供未定，默认值未定。
5. **`isolation: "worker"` 的实现时机**：第一版只实现 inproc，manifest 字段保留并校验。具体在哪个 Studio 版本兑现 worker 实现未定。
6. **Plugin SDK 的发布节奏**：是与 Studio 同版本，还是独立版本号？倾向同版本以避免版本矩阵爆炸。
7. **官方 Web UI 与 Plugin SDK 的边界**：Shell Toolkit + Dock（内圈）的代码物理上属于官方 Web UI 还是独立包？倾向独立 npm 包，让第三方客户端也能用。
8. **Dock 与 Client Part 的具体挂载协议**：Client Part 与 Dock 之间通过什么协议交流（postMessage 形态、生命周期事件、视觉融合约定）？这是 Web UI 端的实现细节，留待单独的 Web UI 文档规范。
9. **`system.introspect` 的粒度与权限**：是否所有客户端都能看到完整能力图，还是按 capability 过滤？信任 token 是否分级？
10. **Extension Scratch Space 的配额**：是否需要 per-extension 磁盘配额？目前倾向不做（信任本地用户），但需求需观察。
11. **`engines.loom` 跨大版本时 Extension 的迁移路径**：Studio 是否提供 codemod / 兼容垫片？还是要求 Extension 作者自行升级？
12. **Concept Stack 共存时的 UI 分流**：当一个 workspace 同时装了多个 Concept Stack，官方 Web UI 怎么呈现"我现在在哪个栈"？这是 Web UI 设计问题，不是平台问题，但需要在 Web UI 文档里有答案。
13. **Server Part 状态命名空间的最佳实践**：要不要在文档里给 Server Part 作者一份"如何按 sessionId / callerRef 分隔状态"的指南？倾向不写硬约定（让 §10.6 的事后可观测性引导自然形成最佳实践），但需要观察。
14. **官方 Provider RPC convention 的边界**：官方是否发布一份推荐 `invoke` payload（例如 chat messages + tools + sampling options），以及它是独立文档还是随官方 Provider Extension 文档发布？倾向后者，避免把它误读为 Kernel contract。
15. **RPC / Audit 调用链关联字段**：Runtime Extension 会形成 `loom.run → provider RPC → tool RPC → loom.run` 的链路。Kernel audit 是否需要 `parentCallId` / `correlationId` 这种通用字段来串联，不限定业务语义但支撑 DevTool 展示？倾向需要。
16. **Streaming RPC 的最小协议**：Provider streaming、agent progress、tool progress 都需要流式事件。Transport 需要一套通用 stream framing，但不定义事件 payload 业务语义。

---

## Appendix A — Vocabulary Cross-Reference

与 Loom 引擎文档的术语对应：

| Studio | Loom Engine |
|---|---|
| Document | （无对应；引擎不感知 Document） |
| Server Part 注册的 Pass | `Pass` |
| Loom Runner 调用 | `Pipeline.run` |
| Trace | `Pass` 执行的 IR snapshot 序列 |
| Transport `loom.*` namespace | 包装后的 `@loom/core` 入口 |
| Concept Stack 的 `compose` RPC | （引擎不感知；编排哲学外移由 Studio 这边承担） |
| Runtime Extension | （无对应；引擎只提供可重复调用的 pipeline 编译步骤） |
| Provider / Tool RPC | （无对应；引擎不感知模型 API、tool call 或 MCP） |

与 SillyTavern 现状的术语对应（仅参考，非承诺）：

| Studio | SillyTavern |
|---|---|
| Workspace | 用户的整个 ST 数据目录 |
| Document (`character.card` type，由 `loom-studio-st` 注册) | 角色卡 |
| Document (`worldbook.entry` type，由 `loom-studio-st` 注册) | 世界书条目 |
| Concept Stack (`loom-studio-st`) | （无直接对应；ST 的 prompt 组装哲学被打包成栈） |
| Extension (Server + Client) | 全局扩展 |
| Card Script | 角色绑定 JS 脚本 |
| 官方 Web UI | ST 的 web 界面 |
| Dock | （无对应；ST 没有此抽象） |

---

## Appendix B — Document History

| Version | Date | Notes |
|---|---|---|
| Draft v0.1 | 2026-04-28 | 首版讨论稿。基于 Loom 白皮书 + ADR-001 + 与维护者的架构讨论。 |
| Draft v0.2 | 2026-04-28 | 加入 Tenet III（Everything Registered is Discoverable）；§5 数据层定为 SQLite 默认后端，新增 Scratch Space 与 Self-Hosting 节；§6.6 Transport 加 `system.introspect`；§7 Extension Model 加 Repository Layout、Dock Convention、Installation 章节；§10 站位扩展为 7 项；§11 Non-Goals 强化"不发布 chat/character/worldbook 官方 schema"等承诺；§12 Open Questions 移除已定项、新增 Dock 挂载协议等。 |
| Draft v0.3 | 2026-04-29 | 加入 Tenet IV（The Kernel Runs Pipelines, Not Sessions）；§6.5 Loom Runner 重写为纯函数化、可重入、无会话状态、`AbortSignal` 取消、`invoker` 入参形态；§7.4 Extension 拓扑表加 Concept Stack 行；§7.8 Installation 加 Uninstall Semantics（orphan + 用户决策）；新增 §9 Composition Boundary（Loom Engine ↔ Studio 接合面、Pass 双重身份与纯度规则、Concept Stack 精确定义、Per-Invocation Orchestration 三场景、Stack Interop、ST 兼容栈定位为 Concept Stack #1）；新增 §10 Observability & Trace（Trace as Document、自包含与回放、fire-and-forget 写入、跨栈可观测性）；§11 Non-Goals 加"不强制单一 Concept Stack"与"不做全局当前会话"；§14 Open Questions 加 Trace retention、Concept Stack UI 分流、Server Part 状态命名空间指南。 |
| Draft v0.4 | 2026-05-02 | 加入 Tenet V（Runtimes Are Extensions）：Runtime / Provider / Tool / MCP 都是 Extension Pattern，不是 Kernel Service；明确 `messages[]` 与 provider-neutral invocation schema 不是 Kernel contract；§0 加入“借用 OS 的边界观，而不是 OS 的产品承诺”作为架构隐喻；§9 加入能力图、Provider / Tool / Runtime Extension Pattern、Runtime Graph 示例；§12 增加运行时边界决策；§13 Non-Goals 与软约定同步 Provider / Runtime 边界；§14 增加 Provider RPC convention、audit correlation、streaming RPC 开放问题。 |
