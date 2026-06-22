# Isolation / Scope Boundary v0

> **状态**：Open Design
> **主题**：对话隔离、角色卡隔离、source set、scope layering、rollback boundary。
> **相关**：[`global-scope-v0.md`](global-scope-v0.md)、[`session-timeline-data-model-v0.md`](session-timeline-data-model-v0.md)、[`card-model-v0.md`](card-model-v0.md)、[`setting-layer-v0.md`](setting-layer-v0.md)、[`state-store-v0.md`](state-store-v0.md)

---

## 1. 背景

Studio Application 需要同时支持：

- 多个 Card；
- 多个 Session；
- 全局 user / lore / preference；
- Session 内运行时状态；
- 卡片私有设定和共享设定；
- 插件贡献内容；
- 导入旧生态角色卡和世界书；
- reroll / branch / rollback。

如果没有明确隔离模型，后续会出现典型问题：

```text
一个 Session 的 state patch 泄漏到另一个 Session。
一张 Card 的世界设定污染另一张 Card。
全局用户设定被角色卡 silently override。
Prompt Builder 不知道本轮到底应该加载哪些 source。
Reroll 时剧情回滚了，但 HP / 好感度没有回滚。
插件写入内容没有明确 owner 和 scope。
```

本文件先定义隔离问题的讨论框架，不接受最终 schema。

---

## 2. 核心判断

### 2.1 Scope 不是文件夹

Scope 是数据可见性、生命周期和回滚边界，不等于 Source Tree 中的目录。

```text
Source Tree:
  作者如何组织内容。

Scope:
  内容在哪些上下文可见、可写、可回滚。
```

### 2.2 Session 是默认隔离边界

默认 AIRP 体验中，Session 应是运行时状态和剧情推进的主要隔离边界。

```text
Session owns:
  - Narrative Timeline
  - Runtime Transcript refs
  - selected card set
  - session-local State Store values
  - active source set
  - projection order profile overrides
  - run changesets
```

这意味着：

```text
同一张 Card 开两个 Session:
  默认不共享剧情进度、HP、好感度、当前场景、Runtime Transcript。

除非显式引用 Global / Workspace scope:
  才共享全局用户设定、全局设定库、用户偏好。
```

### 2.3 Card 是内容包边界，不是运行实例边界

Card 是可分发、可游玩、可开发的顶层内容单元，但它不是一次对话运行实例。

```text
Card may own:
  - card metadata / readme
  - opening candidates
  - setting entries
  - default state schema
  - default composition / runtime profile hints
  - assets

Session owns:
  - actual play timeline
  - mutable state instance
  - runtime transcript
  - selected provider / model binding overrides
```

同一 Card 的两个 Session 可以从相同初始设定派生，但后续 state 和 timeline 默认隔离。

### 2.4 Global Scope 需要显式选择性引用

Global Scope 不应被所有 Session 自动无条件注入。

```text
Global Scope contains:
  - global user profile
  - global writing preferences
  - global lore libraries
  - workspace-level reusable settings
  - provider / runtime defaults

Session selects:
  - 哪些 global sources 进入当前 source set
  - 是否允许 global user profile 投影
  - 是否允许 global lore 参与 activation
```

Composition Skeleton 需要声明它是否接收 global sources，以及接收到哪里。

---

## 3. Scope Layer 候选

候选分层：

```text
Workspace Scope:
  整个 workspace 可见。用于全局库、Provider profiles、用户偏好引用。

Global Application Scope:
  Studio AIRP Layer 的全局内容。用于 global user setting、global lore。

Card Scope:
  某张 Card 自带内容。用于 opening、setting entries、assets、默认 state schema。

Session Scope:
  一次游玩 / 对话实例。用于 timeline、state instance、runtime profile override。

Run Scope:
  一次 Agent run。用于 fresh read tail、draft、tool state、temporary context mount。

Step Scope:
  单次 provider/tool/commit 推进。用于 provider response、ToolResult、candidate mutation。
```

这些 scope 可以层层引用，但不能默认互相写入。

```text
下层 run / step 可以读上层 selected source。
下层 run / step 写入必须走受控 mutation / commit 路径。
```

---

## 4. Source Set

Prompt Builder 不应该扫描整个 workspace。

Runtime 在每次 compose 前应构造当前 `source set`：

```text
Source Set:
  当前 compose 可见、可投影、可激活的数据来源集合。
```

候选来源：

- selected Card sources；
- selected Opening；
- Session Narrative Timeline projection；
- Session State Store snapshot；
- selected Setting Layer trees；
- selected Global Scope sources；
- Runtime Transcript projection；
- Dynamic Context Mount；
- Fresh Read Tail；
- Extension contributions；
- Run Memo。

Source Set 应记录进入 trace：

```text
为什么这个 source 可见？
来自哪个 scope？
由谁选择？
是否被用户禁用？
是否因为 permission / visibility 被过滤？
```

---

## 5. 角色卡隔离

“角色卡隔离”不应只理解为文件隔离。

需要区分：

```text
Packaging isolation:
  Card 分发包内的资源和默认设定。

Runtime isolation:
  Card 被实例化到某个 Session 后产生的 state / timeline。

Prompt projection isolation:
  Card sources 在 Prompt Builder 中形成 source-scoped dynamic slots。

Permission isolation:
  Card script / plugin contribution 只能访问被授权 scope。
```

默认原则：

```text
Card package content is reusable.
Card runtime state is session-local.
Card projection contribution is source-scoped.
Card scripts / plugin content require explicit permissions.
```

开放问题：

- 一张 Card 是否可以声明依赖另一张 Card；
- 多 Card 同 Session 时，Card source set 如何合并；
- Card 默认 state schema 如何实例化到 Session；
- Card 内置脚本是否能写 Session State；
- Card export 是否包含某个 Session 的状态快照。

---

## 6. 对话隔离

对话隔离主要指 Session 隔离。

```text
Session A:
  timeline A
  state A
  runtime transcripts A
  projection overrides A

Session B:
  timeline B
  state B
  runtime transcripts B
  projection overrides B
```

默认不共享：

- Narrative Timeline；
- Runtime Transcript；
- Session State Store；
- Run Memo；
- Fresh Read Tail；
- Dynamic Context Mount；
- pending setting patches；
- reroll / branch state。

可以共享但必须显式引用：

- Global user setting；
- Global lore library；
- Provider profile；
- Composition Skeleton；
- Runtime profile；
- reusable Setting Library。

---

## 7. Rollback Boundary

一次玩家输入建议创建任务级 checkpoint。

```text
Before user turn:
  create session checkpoint

During run:
  provider calls / tool calls / candidates / temporary state changes

Commit:
  narrative + state snapshot + mount changes + run memo

Reroll / rollback:
  restore to checkpoint
```

需要分清：

```text
可回滚:
  - Session documents
  - Narrative Timeline entries
  - Session State Store snapshot
  - Dynamic Context Mount
  - Run Memo
  - PendingSettingPatch

不可物理回滚，只能审计:
  - external provider call
  - external tool side effect
  - network request
```

这与 Document Store 的 rollback 机制和 Trace / Audit 机制联动。

---

## 8. 与 Kernel / Provider / Extension 的边界

Kernel 不理解 scope 语义。

```text
Kernel:
  Document type / owner / version / changeset / audit。

Studio Application:
  Workspace / Global / Card / Session / Run / Step scope。

Provider Adapter:
  不理解 Card / Session 隔离，只消费 Runtime 给它的 provider request。

Extension:
  通过 manifest / runtime registration 声明能力。
  通过 Application permission 访问被授权 scope。
```

---

## 9. M0 候选

M0 可以先支持：

```text
Workspace Scope:
  provider profiles, global preferences refs

Global Scope:
  global user profile, global setting library

Card Scope:
  card setting entries, opening, assets refs

Session Scope:
  narrative timeline tree, selected card ids, active branch head

Branch Head:
  branch-local state snapshot / changeset head, transcript head, dynamic mounts

Run Scope:
  runtime transcript, fresh read tail, run memo
```

暂缓：

- 多 Card 同 Session 的复杂合并；
- Card script 权限；
- 跨 Session 长期状态同步；
- 共享世界状态自动传播；
- 多用户 workspace；
- 第三方完整替代体验的数据根隔离。

---

## 10. Discussion Capture: Session Runtime Instance / Branch Isolation (2026-05-31)

### 10.1 核心收束

Session 是运行实例，也是一个对话单元。

但在 Agent RP 中，一个 Session 内部至少存在两条内容流：

```text
Narrative Timeline:
  剧情正文，玩家可见，是作品产出。

Runtime Transcript:
  Agent 工作对话，记录模型调用、工具调用、草稿、提交候选、失败和确认过程。
```

这两条流不应混成同一个 `chat[]`，但它们属于同一个 Session runtime instance。

### 10.2 同一 Card 多 Session 绝对隔离

同一张 Card 开两个 Session，默认绝对不共享运行时状态：

```text
不共享:
  - Narrative Timeline
  - Runtime Transcript
  - State Store instance
  - Dynamic Context Mount
  - Run Memo
  - PendingSettingPatch
  - Agent 工作过程
```

共享的只是 Card 的源内容和可显式引用的 Global / Workspace sources。

### 10.3 Card Source 与 Session Instance 分离

Card 是内容包 / 模板，不是运行时状态容器。

Session 创建时，应基于 Card source 的某个版本快照初始化：

```text
Card Source Version
  -> instantiate Session
  -> create session-local overlays / state / timeline
```

Agent 在 Session 内对世界书 / Setting / State 的动态演进，默认写入 Session-local overlay 或 branch-local changeset，不直接修改 Card source。

如果用户确实想从根本上修改 Card 内容，应走显式路径：

```text
Edit Card Source:
  直接修改 Card 模板本身。

Promote Session Changes:
  用户选择把某些 session-local 变更提升回 Card source。
```

默认不自动把 Session 演进污染原 Card。

### 10.4 Branch Head 是更小的运行隔离点

因为 AIRP 应用中分支、reroll、改写会非常频繁，Session 内还需要 branch-level 隔离。

候选判断：

```text
Session:
  最大运行实例边界。

Branch Head:
  当前剧情树状态的最小运行隔离点。
```

Branch Head 应关联：

- 当前 Narrative branch head；
- 当前 State Store snapshot / changeset head；
- 当前 Dynamic Context Mount；
- 当前 PendingSettingPatch；
- 与该 branch 对应的 Runtime Transcript head。

### 10.5 Agent Transcript Tree 默认同步 Narrative Tree

Agent Transcript 基本没有独立分支需求。

默认方向：

```text
Runtime Transcript Tree mirrors Narrative Timeline Tree.
```

也就是说，Agent 工作树默认 1:1 复刻剧情正文树的 branch topology。

原因：

- 玩家频繁操作的是剧情分支；
- Agent 工作记录主要用于解释对应剧情产出；
- 默认 Runtime 采用总结式 / ephemeral projection，不需要把历史工作对话作为独立长期上下文；
- 维护两套可独立分叉的复杂树会显著增加实现和 UI 负担。

后续若出现 code-agent-like 长任务，可以允许某些 Runtime Profile 使用独立 transcript graph，但这不是默认 AIRP M0。

### 10.6 Branch State 是否适合 Git-like 模型

可以借鉴 Git，但不应完整复刻 Git。

适合借鉴：

```text
commit / changeset:
  一次 accepted turn 或 accepted mutation 的不可变记录。

branch head:
  指向当前 narrative + state + mount + transcript 的最新 accepted changeset。

parent refs:
  支持 reroll / branch / restore。

diff / patch:
  state patch、timeline append、setting overlay patch 可追踪。
```

不宜照搬：

```text
merge semantics:
  AIRP 分支合并不应作为 M0 基础能力。

text conflict resolution:
  剧情和状态的冲突不是普通文本冲突。

distributed sync:
  当前不是 Git 远程协作模型。
```

因此更准确的候选是：

```text
Git-like immutable changeset graph,
not Git-compatible storage or merge model.
```
