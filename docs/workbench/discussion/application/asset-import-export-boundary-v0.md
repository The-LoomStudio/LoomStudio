# Asset Import / Export Boundary v0

> **状态**：Open Design / Implementation Planning  
> **主题**：Card、Setting Layer、Worldbook 兼容导入、Workspace Artifact 与运行时 SQL 文档之间的边界。  
> **Related**:
> - [`card-model-v0.md`](card-model-v0.md)
> - [`compatibility-import-v0.md`](compatibility-import-v0.md)
> - [`prompt/prompt-builder-philosophy-v0.md`](prompt/prompt-builder-philosophy-v0.md)
> - [`../data/studio-data-layer-architecture.md`](../data/studio-data-layer-architecture.md)
> - [历史 Config / Local State 草案](../../../archive/discussion/studio-config-and-local-state-v0.md)
>
> **2026-07-29 更新**：本文中的 “Artifact seeds the workspace” 属于早期术语。下一阶段目标是 Artifact 创建 Card Manifest、平铺 Resources 与 Import Bundle；PromptWorkspace 不再进入 Session、PromptBuild 或 Export 权威链。实施计划见 [`../../plans/card-resource-manifest-migration-plan.md`](../../../archive/plans/card-resource-manifest-migration-plan.md)。
>
> **2026-08-15 更新**：原始 Artifact 的最终物理边界已收束为内容寻址 Blob Store。原始 JSON 也按不可变字节保留；Importer 解析出的可编辑、可查询内容进入 SQLite。内部不再按 Card / Worldbook / Preset 建立运行时权威文件夹，具体实施见 [`../../plans/local-data-blob-store-foundation-plan.md`](../../../archive/plans/local-data-blob-store-foundation-plan.md)。

---

## 1. 核心问题

SillyTavern 导入角色卡时常见做法是同时创建 card PNG 副本和 worldbook JSON 副本。

这个机制真正解决的不是文件格式问题，而是：

```text
导入后的 Worldbook 不应被卡片文件强拥有。
卡片和 Worldbook 需要能解耦、独立编辑、独立替换、独立分发。
```

Loom Studio 应吸收这个目标，但不能把 ST 的文件形态变成 canonical model。

---

## 2. 核心结论

Loom Studio 的边界应收束为：

```text
Artifact 是初始化、分发、备份和重置边界。
SQL Document Store 是运行时可编辑状态。
Import Bundle / Binding 记录导入来源与推荐组合关系。
```

因此：

- 导入文件不是运行时唯一事实源；
- 用户编辑不直接写回原始 PNG / JSON；
- 导入后 Card、Setting Layer、Prompt Asset、Preset、Transform Rule 等应变成独立运行时内容；
- 导出是显式操作，会从当前 SQL state 重新生成 artifact；
- 重置是显式操作，会从保留的 source artifact 或 canonical seed 重新初始化运行时内容。

一句话：

```text
Artifact seeds the workspace; SQL owns the editable runtime state.
```

---

## 3. 三层模型

### 3.1 Source Artifact

Source Artifact 是用户导入、系统内置或导出的文件。

例子：

```text
card.png
setting-layer.json
preset.json
workspace.json
loompack.zip
```

职责：

- 作为分发格式；
- 作为导入来源；
- 作为重置来源；
- 作为导出目标；
- 保留 source metadata 和兼容信息。

不承担：

- 实时编辑状态；
- Prompt Build 直接输入；
- SQL document revision；
- changeset / rollback 事实源。

### 3.2 Runtime Documents

Runtime Documents 是导入后进入 Document Store 的 canonical editable state。

候选文档：

```text
airp.card
airp.settingLayer
airp.promptAsset
airp.compositionSkeleton
airp.projectionOrderProfile
airp.transformRule
airp.promptWorkspace
```

职责：

- 支持编辑；
- 支持 changeset / revision / rollback；
- 参与 Prompt Builder source set；
- 参与 Session / Workspace 隔离；
- 由 Application Runtime 转换为 Composition Fragment。

### 3.3 Import Bundle / Binding

Import Bundle 记录“一次导入进来的东西属于同一个分发包或导入事务”。

Binding 记录这些内容的推荐组合关系，而不是所有权关系。

例如：

```json
{
  "bundleId": "loom-city-seraphina-v0",
  "sources": [
    { "documentId": "card.seraphina", "type": "airp.card" },
    {
      "documentId": "setting.rainline-station",
      "type": "airp.settingLayer",
      "recommendedFor": ["card.seraphina"]
    }
  ]
}
```

这表达的是：

```text
这张卡推荐搭配这个 Setting Layer。
```

而不是：

```text
这个 Setting Layer 被这张卡拥有。
```

同一原则也适用于声明式规则。ST Regex 等兼容配置导入后应成为平铺的 Transform Rule Resource；Card、Preset 或其他资源只记录引用关系。规则可以随某个 Bundle 一起分发，但不被 Bundle、Card 或 Extension Module 强拥有。

```text
Bundle / Artifact:
  决定导出时应收集哪些规则资源。

Card / Preset Binding:
  决定某个使用场景启用哪些规则资源。

Transform Rule Resource:
  保存规则配置并独立编辑、版本化、禁用和复用。
```

`promptResourceIds` 只表达参与 Prompt 内容组织的资源，不能顺便承担 Card 全部 Bundle inventory 或 Display Rule binding。正式关系 Schema 尚未确定，不在本文提前引入通用 Resource Binding Graph。

同一分发边界也适用于 Card 作者与 Extension 作者之间的配置协作。Core 不需要理解文生图、记忆或其他插件配置 Schema；Extension 可以把允许分发的配置和初始数据序列化为 Portable Extension Payload，由 Card 作者显式绑定并随 Bundle 运输。这不建立 Card 运行时存储 Scope，也不表示 Card 强拥有 Extension 数据。

```text
Extension creates Portable Payload
  -> Card author binds Payload
  -> Core exports generic metadata and bytes
  -> Importer preserves opaque Payload and Extension Requirement
  -> installed Extension validates, migrates and applies it explicitly
```

只被 Extension 消费的画师串、模型参数和插件初始记录进入 Portable Payload；会被 Prompt、脚本、UI 和分支回滚共同消费的角色语义值进入 State Template。Secret、用户私有历史、缓存、生成任务和全部 Timeline 运行数据不得因为“与 Card 一起使用”就默认进入导出包。

Core 负责 namespace、hash、大小预算、安全路径、未知 Payload 保留和再次导出；Extension 负责内容选择、私有 Schema、版本迁移与应用目标。正式讨论见 [`extension/card-extension-portable-payload-v0.md`](extension/card-extension-portable-payload-v0.md)。实现前只需定义最小 Payload / Binding 合同，不引入通用 Card-owned Extension database。

---

## 4. 与 Prompt Builder 的关系

Prompt Builder 已收束为：

```text
Structure 负责接，Source 负责产出，Capability 负责编排。
Everything is a Source, Composition is a Capability.
```

导入一个 ST card + worldbook bundle 时，兼容层可以做：

```text
ST card png
  -> airp.card document

ST worldbook json
  -> airp.settingLayer document
  -> projection / activation / lifecycle capability

ST preset json
  -> airp.compositionSkeleton document
```

但 Prompt Builder 不应知道这些内容曾经来自 PNG 或 worldbook JSON。

Prompt Builder 只看到：

```text
Current Source Set
  -> Source Adapters
  -> Composition Fragments
  -> Application Passes
  -> Compiled Prompt Payload
```

---

## 5. Card 与 Setting Layer 的关系

Card 是顶层内容包，不等于 Character，也不应该强拥有全部 prompt-facing 内容。

推荐关系：

```text
Card may recommend Setting Layers.
Card may recommend Prompt Assets.
Card may recommend a default Composition Skeleton.
Card may recommend Runtime Profiles.
```

禁止关系：

```text
Card owns Setting Layer.
Card writes directly into Setting Layer artifact file.
Setting Layer must know which Card owns it.
Prompt Builder must scan Card internals for legacy fields.
```

运行时启动 Session 时，Application Runtime 应构造当前 Source Set，而不是让 Card 文件自己决定最终 prompt 结构。

---

## 6. 导入导出策略

第一阶段优先支持 JSON artifact。

导入流程：

```text
read artifact
validate envelope
create import bundle record
create SQL runtime documents
record source artifact ref
return workspace / document ids
```

导出应支持三类：

```text
Card Only:
  只导出 Card 展示信息和必要启动信息。

Source Only:
  单独导出 Setting Layer / Prompt Asset / Preset。

Bundle Export:
  导出完整推荐组合，适合作为 Loom 正式分发格式。
```

PNG card 是兼容和分发格式，不是运行时编辑格式。导入后可以保留原始 PNG artifact，但编辑应发生在 SQL runtime state 中。

---

## 7. 本地目录边界

本文早期提出的 repo 内 `data/artifacts` 与 `.loomstudio-dev/document-store.sqlite` 双目录只是 MVP 候选，已由本地数据基建计划替代。

当前目标边界：

```text
SQLite:
  Card / Resources / Timeline / Import Bundle / Asset metadata

Content-addressed Blob Store:
  原始 PNG / JSON / Bundle 与正式媒体字节

Cache / Logs:
  可重建派生文件与 JSONL 运行日志
```

原始 Artifact 不作为 Prompt Builder 每轮扫描输入。用户显式导出时选择目标目录；内部 Blob Store 不作为作者手工编辑工作区。

---

## 8. MVP 实施顺序

建议按以下顺序实现：

1. 固化 Artifact / Runtime Document / Import Bundle / Binding 术语。
2. 标准化 Loom City seed，让前端 demo、后端测试和导入导出测试使用同一份 artifact。
3. 后端导入时记录 source artifact ref、import bundle 和推荐 bindings。
4. 前端从后端 workspace 读取 Prompt Builder 数据。
5. 增加 JSON 导入导出 UI。
6. PNG 嵌入和 ST byte-compatible export 延后。

---

## 9. 非目标

当前不做：

- 承诺 ST byte-compatible prompt；
- 把 ST worldbook schema 变成 canonical Setting Layer schema；
- 让 Card 直接拥有 Worldbook / Setting Layer；
- 编辑时实时写回 PNG；
- Prompt Builder 扫描 artifact 文件夹；
- 在 Core 中加入 Card / Setting Layer / Bundle 语义；
- 一开始实现完整 `.loompack` 压缩包格式。
