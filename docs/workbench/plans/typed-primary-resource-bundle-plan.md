# Typed Primary Resource Bundle 延期计划

> **状态**：延期规划 / 低优先级高级功能
>
> **日期**：2026-08-25
>
> **触发条件**：Preset 或 Setting 出现必须随主体分发的二进制附件、独立脚本源码或外部运行时依赖，且普通 JSON Artifact 已无法完整表达。
>
> **事实边界**：本文只记录未来导入导出方向，不是当前 Architecture、Schema 或实施授权。当前 `Preset`、`Setting`、Card Bundle、Prompt Resource Library 与全局 Setting Mount 合同保持不变。

## 1. 决策摘要

本计划不引入长期存在的通用 Resource Package 领域实体，也不建立任意资源之间的 Package 依赖图。

Package 只作为带唯一主体类型的导入导出 Artifact：

```text
Preset Bundle
  -> 导入后仍是 Preset

Setting Bundle
  -> 导入后仍是 Setting

Card Bundle
  -> 导入后仍是 Card
```

Bundle 可以携带主体所需的图片、脚本、规则和普通文件，但不会取代这些内容各自的 Store、Document 类型、权限或运行时合同。

一句话：

```text
Bundle 负责运输和重建主体附件；Application 负责运行时挂载。
```

## 2. 为什么延期

当前 Preset 与 Setting 的主要内容仍可由现有 Prompt Resource Artifact 表达。脚本 Runtime、Script Mount、普通 File-backed Resource 和跨资源路径解析也尚未形成已实现合同。

在没有真实二进制附件或独立脚本消费者前提前实现 Bundle，会同时引入：

- Archive Manifest 与版本迁移；
- 路径解析和重命名语义；
- Script 信任、Capability 与授权；
- Asset / Blob 生命周期；
- 导入冲突、重复 ID 和重新导出规则。

这些成本目前没有对应的必要产品收益，因此只保留边界，不进入近期任务列表。

## 3. 主体、附件、挂载与需求

未来实现必须区分四种语义，不能统一成一个通用 `links[]`：

| 关系 | 含义 | 是否参与当前上下文 |
| --- | --- | --- |
| Primary | Bundle 导入后的主体资源，只允许一个 | 由主体类型决定 |
| Attachment | 随主体分发的图片、脚本、规则或普通文件 | 只通过主体的类型化合同参与 |
| Mount / Binding | Setting、Preset、Card、Timeline 等运行时组合关系 | 是 |
| Requirement | 所需 Tool、Extension、Runtime 或版本 | 否，只检查可用性 |

关键约束：

1. Preset Bundle 导入为 Preset，Setting Bundle 导入为 Setting，不询问用户把同一 Bundle 当成哪一种资源。
2. 主体类型由 Manifest 的 `primary.kind` 决定；旧 JSON 继续由兼容 Importer 按内容识别。
3. Preset 可以附带自己的脚本、图片和规则，但不能借 Bundle 恢复 `Preset -> Setting` 自动挂载。
4. Setting 可以附带条目引用的图片、脚本或规则；只有 Setting 本身通过既有入口挂载后，这些附件才可能参与运行时。
5. Requirement 只报告缺失依赖，不自动安装 Extension、不自动授权 Tool，也不修改全局 Setting Mount。
6. Bundle 导入完成后不进入 PromptBuild 权威链；可保留 Source Artifact 与 Import Bundle provenance，用于重置、诊断和兼容导出。

## 4. 候选文件形态

以下仅用于说明边界，不是冻结 Schema。

### 4.1 Setting Bundle

```text
wardrobe.setting.loompack
├── loom.bundle.json
├── setting.json
├── assets/
│   ├── casual.webp
│   └── formal.webp
└── scripts/
    └── daily-random.js
```

### 4.2 Preset Bundle

```text
advanced.preset.loompack
├── loom.bundle.json
├── preset.json
├── assets/
└── scripts/
    └── prompt-hook.js
```

候选 Manifest 只需要表达最小分发事实：

```json
{
  "format": "loom.typedResourceBundle",
  "schemaVersion": 1,
  "primary": {
    "kind": "preset",
    "path": "preset.json"
  },
  "attachments": [
    {
      "kind": "agent-script",
      "role": "preset-script",
      "path": "scripts/prompt-hook.js"
    }
  ],
  "requirements": []
}
```

不在此阶段确定资源 ID、Hash、MIME、Capability Schema、跨包版本约束和路径 URI 形式。

## 5. 导入责任

未来 Importer 是唯一负责从 Artifact 恢复关系的组件：

```text
validate archive
  -> read primary kind
  -> import primary as Preset / Setting / Card
  -> import attachments into their canonical Store
  -> create typed primary-to-attachment relations
  -> validate requirements
  -> record Source Artifact / Import Bundle provenance
```

Importer 不应：

- 创建通用 Resource Binding Graph；
- 把图片或 JavaScript 塞进 Prompt Resource Node JSON；
- 因为 `.js` 扩展名自动授予执行权限；
- 自动把 Bundle 内的其他 Setting 写入全局 Mount；
- 让原始 ZIP 成为导入后的可编辑事实源。

如果未来确实需要一个 Bundle 携带多个同级 Prompt Resource，第一版应将其作为多个独立资源导入，并明确提示用户选择挂载；不能把其中一个资源的附件关系伪装成另一个资源的运行时依赖。

## 6. 导出责任

导出从当前 canonical state 重新生成 Artifact：

```text
read primary
  -> collect typed attachments
  -> materialize JSON / Blob bytes as files
  -> write manifest and hashes
  -> emit archive
```

导出收集附件不等于运行时所有权。是否允许附件被多个主体复用、主体删除时如何处理共享附件，留到真实消费者出现后再决定。

## 7. 与全局 Setting 的边界

全局 Setting 继续是额外 Setting 参与 PromptBuild 的统一产品入口。本计划不会新增以下分支：

```text
Preset -> auto mount Setting
Setting -> auto mount peer Setting
Bundle -> auto mount imported Setting
```

Preset 或 Setting 的附属脚本与图片属于主体自身能力，不等同于再挂载一个 Setting。

如果 Preset Bundle 推荐搭配某个独立 Setting，Bundle 可以记录推荐来源；导入后仍由用户通过现有 Setting 入口显式挂载。

## 8. SillyTavern 参考结论

SillyTavern 的 Preset 仍以 JSON 导入和导出。扩展通过 Preset 的 `extensions` 对象保存附属配置；Preset Regex Script 是该对象中的结构化规则，由当前 Preset 的扩展适配器读取。

可借鉴之处：

- 导入目标始终由主体类型决定；
- 附属配置跟随主体导出；
- 运行时由对应扩展解释附属字段。

不直接继承之处：

- 不把未知扩展数据长期塞入无约束 JSON；
- 二进制附件和独立源码进入 Asset / Blob / typed Document 边界；
- 可执行脚本必须经过 Capability 与用户授权。

参考源码快照：SillyTavern `8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8`。

## 9. 未来实施阶段

只有触发条件成立后才重新审核以下阶段：

1. **Artifact 合同**：冻结唯一主体、Archive 安全限制、路径和 Hash 规则。
2. **附件合同**：为第一个真实消费者增加类型化附件关系，不建立通用 Graph。
3. **Import / Export**：完成主体加附件的 round-trip，并保留 provenance。
4. **Script 安全**：接入 Agent Script Runtime、Capability、Grant 和默认禁用策略。
5. **UI**：在 Preset / Setting 自身操作中提供增强导入导出，不新增独立 Package Workbench。

## 10. 最小验证要求

未来实现至少覆盖：

- Preset Bundle 导入后只能得到 Preset 主体；
- Setting Bundle 导入后只能得到 Setting 主体；
- JSON、Asset 与 Script round-trip；
- path traversal、absolute path、symlink、文件数量和大小限制；
- Hash mismatch 与未知主体类型拒绝；
- 脚本导入后默认不可执行；
- Bundle 导入不会修改全局 Setting Mount；
- export -> import -> export 保持可解释的主体和附件关系。

## 11. 明确非目标

- 当前阶段实施 `.loompack`；
- 通用 Package Library 或 Package Workbench；
- npm 风格递归依赖安装；
- Preset / Setting 互相任意绑定；
- 自动 Extension 安装和权限授予；
- 真实文件夹同步、watch 或 Git Authoring Mode；
- 将 Artifact 作为 PromptBuild 实时输入；
- 为尚未出现的附件类型设计完整 Schema。

## 12. 实施前开放问题

1. 对外名称使用 Package、Bundle 还是按主体显示为 `Preset Package` / `Setting Package`；
2. 包内资源路径是稳定逻辑路径，还是导入后立即解析成 Resource ID；
3. 附件首批是否只允许单主体使用，暂不支持共享；
4. Preset Script 首批是 Agent 可调用 Script，还是受控生命周期 Hook；
5. Requirement 首批只做诊断，还是允许跳转到 Extension / Tool 安装入口；
6. Bundle 中出现第二个 Prompt Resource 时，是拒绝导入还是作为独立推荐资源导入。
