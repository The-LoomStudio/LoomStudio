# File-backed Bundle 与 VFS Projection v0

> **状态**：Open Design / Discussion Capture  
> **日期**：2026-09-10  
> **主题**：让 Card、Preset、Setting、State Definition、Transform Rule 与 Script 使用可读真实文件分发，并让 Bundle、Dev Workspace 和 Agent VFS 共用同一套领域资源投影。  
> **事实边界**：本文记录候选方向，不是已实现 Architecture、最终文件 Schema 或实施授权。
>
> **Related**:
> - [`asset-import-export-boundary-v0.md`](asset-import-export-boundary-v0.md)
> - [`data-capabilities-and-runtime-content.md`](data-capabilities-and-runtime-content.md)
> - [`../../plans/file-backed-resource-agent-script-codeact-plan.md`](../../plans/file-backed-resource-agent-script-codeact-plan.md)
> - [`../../plans/typed-primary-resource-bundle-plan.md`](../../plans/typed-primary-resource-bundle-plan.md)

---

## 1. 当前判断

Loom Studio 可以把作者工程、可读分发包和内部 VFS 收束到同一条转换链：

```text
Domain Store
    <-> Resource File Codec
File Projection
    -> Agent VFS
    -> Dev Workspace checkout / apply
    -> Bundle pack / unpack
```

核心不是把 SQLite 改造成文件系统，而是让同一个领域资源拥有稳定、可验证、可读写的文件投影。

```text
SQLite / Domain Store:
  资源身份、关系、版本、Binding、Changeset 和运行时权威状态。

Blob Store:
  Markdown、JavaScript、图片和其他不可变原始字节。

VFS / Dev Workspace / Bundle:
  面向作者、Agent、外部编辑器和分发的文件表示。
```

路径只是投影地址，不能成为资源身份。资源移动或重命名不应破坏引用、历史版本和 Binding。

## 2. 当前实现基础

当前 `.loomcard` 已经使用 ZIP，包内包含 `manifest.json`、媒体文件和 Portable Extension Payload；但 Card、Prompt Resource、State 等核心结构主要仍嵌入 Manifest 中的 JSON Artifact。

当前 Prompt Resource Store 已保存资源、节点、父子关系与顺序。它已经具备投影成目录树的基础，但父子关系本身仍是领域关系，不等于物理目录。

当前 Document Store、Prompt Resource Store、Blob Store 与共享 SQLite Data Engine 已分别承担：

- 结构化资源与 Revision；
- Prompt Resource 节点关系；
- 原始字节与内容摘要；
- Transaction、Changeset 与 Commit Fact。

因此本方向不需要建立第二套文件数据库，也不需要让 Bundle 或 Dev Workspace 成为另一个 canonical Store。

## 3. 两个需要统一的问题

### 3.1 可读真实文件的打包与解包

复杂 Card 或 Preset 不适合继续表现为一个巨大 JSON。作者更适合维护：

```text
manifest.json
card.json
settings/
  index.json
  characters/
    alice.md
    bob.md
scripts/
  update-affinity.js
state/
  world.state.json
transforms/
  narrative-rules.json
macros/
  macros.json
assets/
  avatar.png
```

其中：

- Markdown 保存主要由人类或 Agent 编写的长文本；
- JavaScript 保存真实脚本源码；
- JSON 保存需要严格 Schema、引用和程序消费的结构化定义；
- `index.json` 保存节点 ID、顺序、Activation、路径和父子关系；
- `manifest.json` 保存包级主体、版本、文件索引、摘要和 Requirement；
- ZIP 只作为运输容器，不成为运行时领域模型。

### 3.2 数据库资源与 Agent VFS 的桥接

VFS 是数据库领域资源与 AI 文件操作之间的桥接层。它不要求底层数据按通用 `files` 表重新存储，而是要求各领域资源能够提供一致的文件投影。

```text
Prompt Resource Node Tree
    -> settings/index.json + entries/*.md

State Definition
    -> state/*.state.json

Transform Rule
    -> transforms/*.json

Agent Script Definition + Blob
    -> scripts/*.js + manifest metadata
```

同一投影应服务三个消费者：

1. Agent 通过 VFS 阅读和修改资源；
2. Dev Workspace 将资源物化为真实目录供 IDE、Git 和外部 Agent 使用；
3. Bundle packer 将相同文件表示写入 ZIP。

如果三者各自维护一套序列化逻辑，字段、路径、默认值和迁移规则最终会漂移。

## 4. Resource File Codec

候选的最小公共接缝是按资源类型提供 `Resource File Codec`：

```ts
type ResourceFileCodec = {
  project(resourceId: string, version?: number): ProjectedFileTree
  prepareApply(input: {
    resourceId: string
    expectedVersion: number
    changes: FileChange[]
  }): PreparedResourceMutation
}
```

这里表达的是职责，不是最终 TypeScript API。

`project()` 负责把领域资源生成为文件树；`prepareApply()` 负责解析文件变化、执行 Schema 校验并产生领域 Mutation。真正提交仍由原有 Domain Store 和 Transaction 完成。

```text
VFS write / Bundle import / Dev Workspace apply
    -> Codec parse
    -> validation
    -> mutation preview
    -> expectedVersion check
    -> atomic domain commit
    -> Changeset
```

首版只需要官方内置 Codec，不开放 Extension 任意注册新的领域 Codec。Extension 私有文件继续通过 Package File 或 Portable Payload 运输，直到出现明确的公共注册需求。

## 5. 身份、路径与内容

文件索引至少需要区分：

```json
{
  "resourceId": "setting.alice.personality",
  "kind": "setting-entry",
  "path": "settings/characters/alice.md",
  "version": 7,
  "mediaType": "text/markdown",
  "sha256": "..."
}
```

字段职责：

| 字段 | 职责 |
|---|---|
| `resourceId` | 稳定领域身份和跨资源引用 |
| `path` | 当前文件投影中的可读位置 |
| `version` | 乐观并发、Revision 与导入基线 |
| `mediaType` | 选择 Codec 和编辑能力 |
| `sha256` | 校验运输内容，不替代资源身份 |

路径变化不创建新资源；内容相同也不表示两个资源具有同一身份。

## 6. Pack、Unpack 与 Apply

需要区分三个动作：

```text
pack:
  从当前 canonical resources 生成文件树并压缩。

unpack:
  只把 ZIP 展开成文件，不改变 Workspace 数据。

import / apply:
  解析文件、验证 Manifest、生成 Mutation 并提交到 Domain Store。
```

推荐导入流程：

```text
read archive
  -> validate entry count / size / path
  -> validate manifest and file digests
  -> select codecs by declared kind
  -> parse resources
  -> resolve stable IDs and import conflicts
  -> preview mutations and required grants
  -> atomic commit
  -> retain source artifact and import provenance
```

`.js` 文件存在不代表获得执行权限。Script Definition、Mount、Capability Grant 与用户确认仍是独立合同。

未知 Extension 文件不能因为 Core 无法理解而丢失；满足安全预算的内容应作为 opaque Package File 或 Portable Payload 保留，以支持安装对应 Extension 后消费和再次导出。

## 7. VFS 写入边界

VFS 不应绕过领域 API 直接写 SQLite，也不应让每一次底层 `writeFile` 立即产生半完成状态。

对于多文件修改，推荐使用临时变更集：

```text
Agent edits files
  -> collect FileChange[]
  -> parse and show domain diff
  -> commit as one Changeset
```

适合可写文件投影的资源包括：

- Setting / Prompt Resource 的作者文本；
- 静态 State Definition、Entity Type、Component Template 和初始化数据；
- Macro 声明；
- Transform Rule / Extractor 声明；
- Agent Script 源码及其 Definition metadata。

不应通过“重写一个 JSON 文件”完成的运行数据包括：

- Timeline State 的高频字段修改；
- Agent Session Transcript；
- Narrative commit；
- Permission / Grant；
- Log、Trace 与 Diagnostic。

这些数据可以提供只读文件快照帮助 Agent 理解，但正式写入仍应使用 State Operation、Narrative Tool、Agent Runtime 或权限 API。文件投影不能抹去这些领域操作的并发、权限和回滚语义。

## 8. Dev Workspace 边界

Dev Workspace 可以把数据库资源 checkout 为真实文件，支持 IDE、Git 和外部 Agent；但它与数据库之间不能默认形成无条件双向实时同步。

首版更适合显式操作：

```text
Checkout:
  Domain Store -> local files

Status / Diff:
  local files <-> projected baseline

Apply:
  local changes -> validated domain mutations
```

文件监听、自动合并和多人并发同步属于后续能力。没有可靠冲突语义前，不建立第二权威来源。

## 9. 可借鉴的现有系统

### 9.1 VS Code FileSystemProvider

VS Code 允许用 URI Scheme 和 `FileSystemProvider` 将非磁盘数据暴露为统一文件接口，并显式声明读写能力。这支持 Loom 将 `loom://` 作为领域资源视图，而不要求底层改成真实文件系统。

参考：[`FileSystemProvider`](https://code.visualstudio.com/api/references/vscode-api#FileSystemProvider)、[`Virtual Workspaces`](https://code.visualstudio.com/api/extension-guides/virtual-workspaces)。

### 9.2 VS Code NotebookSerializer

Notebook Serializer 把文件字节和结构化 Notebook 数据双向转换。它与 Loom 的 Resource File Codec 最接近：文件是交换表示，编辑与执行仍依赖结构化领域模型。

参考：[`Notebook API`](https://code.visualstudio.com/api/extension-guides/notebook)。

### 9.3 Git Object Model

Git 分离 Blob 内容、Tree 路径关系与指向版本的引用。Loom 可以借鉴这种分离，但不把内容 Hash 当成可变领域资源的身份。

参考：[`Git Internals - Git Objects`](https://git-scm.com/book/en/v2/Git-Internals-Git-Objects)。

### 9.4 Godot Resource UID

Godot 使用稳定 UID 辅助资源引用，避免文件移动后只依赖路径解析。Loom 的 Manifest 同样应同时保存稳定 `resourceId` 和可读 `path`。

参考：[`ResourceUID`](https://docs.godotengine.org/en/stable/classes/class_resourceuid.html)。

### 9.5 Kubernetes Declarative Apply

Kubernetes 区分声明式文件与服务器中的实际对象，并通过 Apply 计算变化。Loom 不需要引入其完整字段所有权系统，但应吸收“多个编辑入口汇入同一 Mutation 管线”的原则。

参考：[`Kubernetes Object Management`](https://kubernetes.io/docs/concepts/overview/working-with-objects/object-management/)。

### 9.6 OCI Image Layout

OCI Image Layout 使用 Index / Manifest 描述关系，并用带摘要的独立 Blob 承载内容。Loom Bundle 可以借鉴其 Manifest 与载荷分离、摘要校验和可重建分发边界。

参考：[`OCI Image Layout`](https://github.com/opencontainers/image-spec/blob/main/image-layout.md)。

## 10. 不采用的方向

- 不建立一个替代 Document Store、Prompt Resource Store 和 State Store 的通用文件数据库；
- 不把目录路径作为 Resource ID、Binding 或权限主体；
- 不让 ZIP、解包目录和 SQLite 同时成为可写权威来源；
- 不因 `.js` 后缀自动注册或执行脚本；
- 不在第一版实现文件监听、三方合并、任意 Codec 注册或通用依赖图；
- 不把高频运行 State 和 Transcript 降级为整文件覆写。

## 11. 开放问题

1. Card、Preset、Setting 是否共享一个 Bundle Envelope，还是保留不同主体 Schema、只复用 File Entry 合同；
2. Prompt Resource 的 `index.json` 如何表达共享节点、排序和 Activation，而不复制全部领域 Schema；
3. Dev Workspace Apply 是按单个资源提交，还是允许一个 Changeset 原子提交多个资源；
4. Bundle 中的 State 初始化是否按单文件、按 Entity Type 分片，或由作者自由组织后通过 Manifest 聚合；
5. VFS URI、Bundle path 与本地 checkout path 是否共享路径规则，还是只共享稳定 Resource ID；
6. 哪些运行数据需要只读 VFS 快照，哪些应只通过专用 Tool 查询。

## 12. 当前停止点

本文只确认两项方向：

1. Bundle 从“ZIP 包裹大型 JSON”演进为“Manifest 索引可读真实文件”；
2. VFS、Dev Workspace 与 Bundle 应复用领域 Resource File Codec，但 SQLite 领域 Store 继续保持 canonical authority。

在上述开放问题形成实施决策前，不修改现有 Card Bundle Schema、Prompt Resource Store 或 VFS API。
