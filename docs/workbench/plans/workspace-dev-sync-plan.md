# Workspace 本地开发化与文件级双向同步 (Workspace Dev Sync) 规划

> **状态**：Open Design / 待讨论提案  
> **日期**：2026-09-03  
> **前置计划**：[`docs/archive/plans/prompt-resource-ordered-tree-and-caged-slot-plan.md`](../../archive/plans/prompt-resource-ordered-tree-and-caged-slot-plan.md)  
> **核心目标**：在已落地的 VFS 动态扩展名与强类型树结构之上，探索将角色卡、预设等提示词资源以真实本地目录与 Markdown 文件的形态导出/落盘，打通外部 IDE（VSCode / Cursor）与本地 AI Agent 的文件级共建通道。

---

## 1. 背景与核心动机

在“预设即有序文件树 + 笼中深度”架构落地后，系统底层数据已经具备天然的树状层次与基于 `kind` 的虚拟扩展名映射（`entry ➔ .md`，`anchor ➔ .virtual`）。

许多创作者与开发者希望脱离纯 Web 界面，使用本地熟悉的 Markdown 编辑器、Git 工具链或本地 AI 编程助手直接对角色卡和预设进行深度共建。因此，需要一套双向同步机制，将数据库中的树结构投影为物理磁盘上的文件夹与文件。

---

## 2. 核心复杂度与开放讨论问题 (Open Questions)

将纯内存/数据库树序列化为真实磁盘文件并支持双向同步存在若干深层次设计取舍，需专门讨论立项：

### 2.1 Metadata 存储与表达形式
- 提示词条目不仅包含正文，还携带 `enabled`、`capabilities`（如 `roleHint`、`lifecycle`）、`localDepth`、`meta` 等结构化字段。
- **候选方案 A**：采用 Markdown Frontmatter（YAML 头）承载元数据。优势是单文件自包含；缺点是纯文本解析较重，用户误删 YAML 字段容易导致状态损坏。
- **候选方案 B**：采用伴随隐藏文件（如 `.loom/metadata.json` 或 `.card.meta.json`）。优势是正文保持极致纯净，缺点是移动/重命名单个文件时容易发生元数据脱钩。
- **候选方案 C**：对普通条目仅暴露纯正文，仅特殊条目使用 Frontmatter，大部分元数据由目录结构与文件名约定隐式推导。

### 2.2 虚拟节点（Anchor 注入孔位）的物理形态
- `Anchor` 在运行时并不是真实文本文件，而是供外部注入的占位孔位（如 `@style.card`）。
- 导出为本地文件时：
  - 它是一个带 `.virtual` 扩展名的空文件 / 配置文件？
  - 还是一个带有特殊标识的前缀目录？
  - 亦或通过目录命名约定（如 `[anchor]@style.card/`）来体现？

### 2.3 物理文件名与数据库 Node ID 映射
- 数据库操作依赖严格的 UUID（`id`）；物理磁盘上用户可能直接用操作系统重命名文件、拖拽移动文件。
- 如何在外部 IDE 修改文件路径后，准确识别“这是一次重命名”还是“新建了一个文件并删除了旧文件”，以避免破坏原有的 Mount 绑定和历史 Revision 追溯？

### 2.4 外部文件监听与双向冲突仲裁 (FS Watcher & Conflict Resolution)
- 当用户在本地 VSCode 修改文件，同时又在 Studio Client Web 界面进行了修改时，冲突如何仲裁？
- 何时落盘（显式导出按钮 vs 实时 File Watcher 双向监听）？

---

## 3. 实施路线构想

```text
Phase 1: 序列化契约设计
  -> 敲定 Frontmatter / 伴随元数据 Schema 与 Anchor 的物理表示规范。

Phase 2: 导出器 (Disk Exporter)
  -> 实现单向全量导出：PromptResource ➔ 本地文件夹结构。

Phase 3: 导入与反向同步 (Disk Importer & Watcher)
  -> 实现基于文件树的解析器，读取本地文件树重建/更新数据库节点。
  -> 接入 node:fs watch 监听本地文件变更。

Phase 4: 冲突检测与 Studio Client 同步状态面板
  -> 在客户端提供“本地同步状态”指示与差异对比确认。
```
