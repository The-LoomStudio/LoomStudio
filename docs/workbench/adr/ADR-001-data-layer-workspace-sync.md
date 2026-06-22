# ADR-001: Studio 数据层、项目工作区与运行时输入边界

- **Status**: Accepted
- **Date**: 2026-05-09
- **Related**:
  - [`../04-data/studio-data-layer-architecture.md`](../04-data/studio-data-layer-architecture.md)
  - [`../06-engineering/loom-studio-mvp-engineering.md`](../06-engineering/loom-studio-mvp-engineering.md)

## Context

Loom Studio 需要同时服务三类使用场景：

1. **Play Mode / Consumer Mode**：用户导入角色、世界书、预设或项目包后，直接在 Studio 内游玩、编辑和运行。
2. **Dev Mode / Authoring Mode**：开发者希望把角色、世界书、prompt、preset、stack 等内容拆成多文件目录，用 VSCode、Git、AI coding assistant、搜索工具和 diff 工具进行开发。
3. **Distribution / Interchange**：项目需要导入、导出、分享，或者兼容 SillyTavern 等生态中的聚合 JSON 资产。

早期讨论中曾考虑过把 Git-like versioning 作为项目级版本管理核心。但进一步分析后发现，更根本的问题不是版本管理，而是：

> Studio 项目到底如何在内部可靠数据层、外部开发者工作区、运行时输入和发布包之间转换？

同时，Studio 必须保持既定架构边界：

- Kernel 不内置 Chat Runtime、Agent Runtime、Provider Gateway、Tool Loop、MCP Bridge。
- Kernel 不理解 `messages[]`、角色卡、世界书、预设、SillyTavern JSON 或具体 runtime artifact 语义。
- Runtime / Provider / Tool / MCP 都是 Extension Pattern。
- Concept Stack 定义项目语义和编译规则。
- Data Layer 提供通用 Document / Revision / Changeset / Checkpoint / Event / Audit 原语。

因此，本 ADR 需要明确：

1. SQL / Document Store、物理文件目录、聚合 JSON 各自的职责；
2. 项目目录化是否属于 Kernel 能力；
3. Dev Workspace 如何解决“解包后反复打包导入很麻烦”的同步问题；
4. Runtime 应该消费什么输入；
5. Git 思想与真实 Git 集成应放在哪一层。

## Decision

### 1. 区分三种项目形态

Studio 将明确区分以下三种形态：

| 形态 | 定位 | 主要用途 |
|---|---|---|
| **Workspace Files** | Authoring Source | Dev Mode 下供人类、VSCode、Git、AI 工具开发的多文件目录 |
| **SQL Document Store** | Operational State | Studio 内部运行态、revision、changeset、checkpoint、event、audit、last valid snapshot |
| **Aggregated JSON / Package** | Distribution Artifact | 导入、导出、分享、兼容外部生态的聚合产物 |

这三者不是互相替代关系，而是不同生命周期阶段的不同表示。

推荐链路：

```text
Dev Mode:
  Workspace Files
    -> import / validate / sync
    -> SQL Document Snapshot
    -> compile
    -> Runtime Artifact
    -> Runtime Extension

Play Mode:
  Aggregated JSON / Package
    -> import
    -> SQL Documents
    -> compile
    -> Runtime Artifact
    -> Runtime Extension

Distribution:
  SQL Documents or Workspace Files
    -> export / package
    -> Aggregated JSON / Package
```

### 2. SQL 是目标运行态底座，不是唯一开发格式

Studio 的持久化目标后端是 SQL-backed Document Store。P0 engineering slice 可以先实现 in-memory backend 来稳定接口、测试 revision / changeset / checkpoint 语义，但不得改变本文定义的数据边界；进入持久化 MVP 时应落到 SQL-backed backend。

SQL / Document Store 负责：

- typed JSON Documents；
- document revisions；
- changesets；
- checkpoints；
- rollback-as-new-version；
- tombstone delete；
- event outbox；
- diagnostics state；
- source mapping state；
- trace / audit facts；
- Runtime 所需的 last valid imported snapshot。

SQL 的事务 rollback 只用于撤销**尚未提交的事务写入**。用户级历史回滚必须通过 Studio 的 revision / changeset / checkpoint 模型实现。

已提交历史的回滚规则保持为：

```text
restore as new version, never move history backward
```

即：恢复历史状态时写入新的 document revisions 和新的 changeset，而不是让数据库或历史指针倒退。

### 3. Trace / Audit 是事实，不参与回滚

Trace 和 Audit 是事实记录，必须 append-only。

任何 project restore、document rollback、reroll、import、export、provider call、tool call 都可以产生新的事实记录，但不能删除或改写旧事实。

规则：

```text
Kernel-managed Documents are rollbackable.
Extension-managed scratch data is rollback-notified.
External side effects are audit-only.
Trace and Audit are facts, never rolled back.
Business rollback semantics are extension-defined.
```

### 4. Dev Workspace 是官方 DevTool 能力，不是 Kernel 领域能力

项目目录化能力命名为：

```text
Dev Workspace / Workspace Sync
```

它是官方一等 DevTool / Authoring Extension 能力，但不是 Kernel 的领域能力。

Kernel 不理解：

- 世界书目录结构；
- 角色卡目录结构；
- 预设目录结构；
- SillyTavern JSON；
- Markdown frontmatter 业务字段；
- 一条世界书如何拆文件；
- 一个角色如何聚合成运行时输入。

Studio Core / Kernel 只提供通用底座：

- Document Store；
- Changeset transaction；
- Event Bus；
- Diagnostics registry；
- Extension RPC；
- Capability declarations / audit；
- optional file watching capability；
- source mapping metadata；
- import / export 需要的事务边界。

具体目录布局和 pack / unpack / validate / build 规则由 Concept Stack 或 Workspace Adapter 提供。

### 5. Dev Mode 下 Workspace Files 是 authoring source

启用 Dev Workspace 后：

```text
Workspace files become the authoring source.
SQL stores the last valid imported snapshot and runtime operational state.
```

这避免 SQL 与物理文件长期形成“双真相”。

在 Dev Workspace 启用时：

- VSCode / 外部工具修改文件后，Studio 自动 import 到 SQL last valid snapshot；
- Studio 内置世界书 / 预设 / 角色快速编辑面板如果修改同一类 authoring data，应通过 Workspace Adapter 写回源文件；
- 写回源文件后，再由 import 流程更新 SQL；
- build / package 输出放在 generated directory 中，不作为 canonical source。

Play Mode 下则不同：

```text
SQL Documents are canonical.
Files / packages are import-export artifacts.
```

### 6. Runtime 不直接消费任意工作区文件

Runtime Extension 不应直接扫描或读取 Dev Workspace 目录作为主输入。

默认运行链路必须是：

```text
Workspace Files
  -> import / validate
  -> SQL last valid snapshot
  -> Concept Stack compile
  -> Runtime Artifact
  -> Runtime Extension
```

Play Mode 链路为：

```text
SQL Documents
  -> Concept Stack compile
  -> Runtime Artifact
  -> Runtime Extension
```

Runtime 可以由 Extension 实现，项目或 Concept Stack 可以声明推荐 Runtime，但 Studio 本体不决定具体 Runtime。

### 7. Concept Stack 定义语义映射，Studio 提供通用机制

职责划分：

```text
Studio Core / Kernel:
  workspace lifecycle primitives, document store, transactions, events,
  diagnostics, source mapping, capability boundaries, extension dispatch.

DevTool / Workspace Extension:
  Enable Dev Workspace, Open in VSCode, Watch Changes, Sync Now,
  diagnostics panel, rebuild status, export package UI.

Concept Stack / Workspace Adapter:
  detect layout, import files, export documents, validate source,
  map files to document ids, build runtime artifact, package distribution output.

Runtime Extension:
  consume compiled artifact, run the business loop, call providers/tools,
  write runtime documents and audit/trace facts.
```

### 8. 自动同步取代手动反复打包导入

Studio 不采用“解包 -> 编辑 -> 手动打包 -> 手动导入”的批处理体验作为 Dev Workspace 的主流程。

Dev Workspace 必须支持 live sync：

```text
file saved
  -> file watcher detects change
  -> debounce / wait for stable write
  -> Workspace Adapter parses affected files
  -> validate
  -> if valid: write SQL changeset + document revisions + source map + events
  -> if invalid: write diagnostics only, keep last valid snapshot
  -> invalidate / rebuild runtime artifact
  -> notify DevTool / preview / next runtime invocation
```

目标不是前端意义上的毫秒级 HMR，而是：

```text
保存有效文件后，无需手动打包导入，Studio 在短时间内自动更新可运行快照。
```

### 9. Last Known Good Snapshot 是同步安全边界

自动同步必须遵守：

```text
Runtime always consumes the last valid imported snapshot.
```

如果工作区文件当前无效：

- Studio 记录 diagnostics；
- 不写入新的 canonical document revision；
- 不污染 runtime artifact；
- Runtime 继续使用 last known good snapshot；
- DevTool 显示 workspace invalid / dirty 状态。

### 10. Runtime invocation 使用稳定 artifact snapshot

一次 Runtime invocation 必须绑定明确的 input snapshot / artifact id。

如果文件在当前 provider invocation / runtime step 期间发生变化：

- 当前 invocation 不受影响；
- 新变化经过 import / compile 后生成新的 artifact；
- 下一次 invocation 使用新 artifact。

MVP 不做“当前生成过程中的中途热替换”。

### 11. 聚合 JSON 是发布/交换格式，不是大型项目开发主格式

Aggregated JSON / Package 的定位是：

- import from external ecosystem；
- export to SillyTavern-compatible assets；
- share project package；
- package playable bundle；
- archive simple projects。

大型项目开发不应以单一巨大 JSON 为中心，因为它不利于：

- 局部编辑；
- Git diff；
- AI 工具分块读取；
- review；
- merge；
- schema 演化。

### 12. Git 是可选外部增强，不是内部回滚引擎

Studio 可以借鉴 Git 思想，例如：

- immutable history；
- stable object identity；
- project snapshot；
- diff；
- branch-like experiments；
- human-readable workspace；
- external version control。

但真实 Git 不作为 Studio 内部主回滚系统。

Git 适合：

- Dev Workspace 文件级版本控制；
- 人类可读 diff；
- 团队协作；
- 备份；
- 外部 branch / merge；
- 项目级 snapshot。

Git 不负责：

- Studio changeset transaction；
- document revision history；
- rollback-as-new-version；
- trace / audit 保真；
- extension scratch invalidation；
- runtime input snapshot；
- external side-effect audit。

未来可以提供可选 Git integration，但它必须建立在 Dev Workspace / Package 之上，而不是绕过 Studio Data Layer。

## Consequences

### Positive

- Kernel 边界保持克制，不长出世界书、角色卡、预设、Chat Runtime 或 SillyTavern JSON 语义。
- Dev Mode 获得开发者友好的多文件目录，可直接使用 VSCode、Git、AI coding assistant、搜索、diff 和 review 工具。
- Play Mode 仍可保持 SQL-backed Studio 体验，不强迫普通用户理解文件工作区。
- Runtime 获得稳定、可复现的 artifact snapshot，不受外部文件半写入或坏文件影响。
- 自动同步解决传统“解包后必须反复打包导入”的痛点。
- `last valid snapshot` 提供安全边界，坏文件不会污染运行态。
- 聚合 JSON、物理目录、SQL 三者职责清晰，不再互相争夺唯一定位。
- Git 能自然服务 Dev Workspace，但不会绑死 Studio 内部数据模型。

### Negative / Known Gaps

- Dev Workspace 需要额外实现 file watcher、debounce、stable read、source map、diagnostics、conflict detection。
- Studio authoring UI 在 Dev Workspace 启用时需要通过 Workspace Adapter 写回文件，复杂度高于直接写 SQL。
- 删除、重命名、移动文件需要 stable id 和 source map 规则支持。
- Concept Stack / Workspace Adapter 需要承担 pack / unpack / validate / build 的语义复杂度。
- 多文件 import 的事务边界和 diagnostics 需要谨慎设计。
- 初期不支持复杂 merge UI、real-time collaboration、runtime mid-generation hot swap。
- 如果用户同时用外部编辑器和 Studio UI 改同一文件，仍需要冲突策略。

## Alternatives Considered

### A. SQL 是唯一真相，文件只是手动导出物

拒绝作为 Dev Mode 唯一方案。

优点是内部一致性强、实现简单、Runtime 读取稳定。缺点是开发者体验差，无法自然使用 VSCode / Git / AI coding assistant，也无法解决大型世界书和 prompt 工程的局部编辑问题。

### B. 物理文件是全局唯一真相，SQL 只是 cache

拒绝作为全局方案。

优点是开发者体验最好。缺点是 Play Mode、回滚、checkpoint、trace/audit、runtime consistency、UI 查询都会变复杂。文件系统也不能提供 Studio 所需的事务语义和事实审计。

### C. SQL 和物理文件长期双真相

拒绝。

双真相会持续制造冲突：

- SQL revision 与文件内容不一致时谁覆盖谁？
- Git checkout 后 SQL 如何处理？
- Studio rollback 后是否覆盖文件？
- 外部格式化是否算业务变更？
- Runtime 使用哪个状态？

本 ADR 采用 mode-based canonical source：Dev Mode 下文件是 authoring source，SQL 是 last valid snapshot；Play Mode 下 SQL 是 canonical source。

### D. Runtime 直接读取多文件目录

拒绝作为默认运行模式。

这会让 Runtime 绕过 validation、revision、event、diagnostics、audit、source map 和 last valid snapshot，也会迫使 Runtime 理解 Concept Stack 的目录布局。

允许未来提供 Live Dev Preview，但其本质仍应是自动 import + compile + artifact update，而不是 Runtime 直接扫目录。

### E. 真实 Git 作为内部版本和回滚引擎

拒绝。

Git 的抽象是文件树历史，不理解 Studio 的 Document / Changeset / Checkpoint / Extension Scratch / Audit / External Side Effect 边界。Git 可作为 Dev Workspace 的外部版本控制和备份工具，但不能替代 Studio Data Layer。

### F. 聚合 JSON 作为唯一项目格式

拒绝作为大型项目开发主格式。

聚合 JSON 适合导入、导出、分享和生态兼容，但不适合大型项目的局部编辑、AI 辅助生成、review、diff 和 merge。

## Implementation Notes

### MVP Scope

Dev Workspace MVP 应只做：

1. Enable Dev Workspace；
2. Export current SQL documents to workspace files；
3. Watch file changes；
4. One-file-one-document import；
5. Stable id in source metadata；
6. Validate changed files；
7. Write SQL changeset on valid import；
8. Keep last valid snapshot on invalid import；
9. Diagnostics panel/state；
10. Manual Sync Now；
11. Rebuild runtime artifact after valid import；
12. Disable Dev Workspace。

MVP 不做：

- complex staging；
- semantic merge UI；
- multi-section source mapping；
- real-time collaboration；
- Git push / pull；
- runtime mid-generation hot swap；
- arbitrary layout customization UI；
- Studio-wide official worldbook / character schema in Kernel。

### Suggested Workspace Files

示例目录仅作为 DevTool / Concept Stack 参考，不是 Kernel contract：

```text
project/
  loom.workspace.json

  character/
    profile.md
    personality.md
    speech.md

  worldbook/
    characters/
      alice.md
      yuki.md
    locations/
      academy.md
      shrine.md
    factions/
      student-council.md

  prompts/
    system.md
    style.md

  presets/
    default.json

  source/
    novel.md
    notes.md

  .loom/
    build/
      runtime-artifact.json
      package.json
    cache/
    diagnostics.json
    workspace-state.json
```

### Source File Identity

Dev Workspace source files should use stable ids so file rename does not imply document recreation.

Example frontmatter:

```yaml
---
id: wb.location.academy
type: worldbook.entry
title: 星海学院
---
```

MVP rule:

```text
one source file maps to one primary document
```

### Event Flow

Recommended event flow:

```text
workspace.file.changed
workspace.import.started
workspace.import.completed | workspace.import.failed
docs.changed
concept.artifact.invalidated
concept.artifact.rebuilt
runtime.preview.updated
```

Exact event payloads are deferred to the data-layer engineering spec.

### Conflict Handling

MVP conflict policy:

- if Studio wants to write a workspace file whose current hash differs from last imported hash, do not overwrite automatically；
- mark workspace state as conflict；
- require explicit user action or manual sync；
- runtime continues using last valid snapshot。

### Authoring UI Writes

When Dev Workspace is disabled:

```text
Studio authoring UI -> SQL Document Store
```

When Dev Workspace is enabled:

```text
Studio authoring UI -> Workspace Adapter writes source file -> import updates SQL snapshot
```

This preserves a single authoring source in Dev Mode.

## Success Criteria

This ADR is satisfied when:

1. Saving a valid workspace source file updates the corresponding Studio document without manual pack/import.
2. Saving an invalid source file reports diagnostics and does not replace the last valid runtime snapshot.
3. Runtime invocations consume stable artifact snapshots and only see workspace changes after successful import/compile.
4. Dev Workspace can be disabled without breaking Play Mode SQL-backed operation.
5. Aggregated JSON remains available as import/export/package format but is not required as the authoring format.
6. Kernel code contains no worldbook, character card, prompt preset, SillyTavern, chat message, provider invocation, or runtime artifact domain logic.
