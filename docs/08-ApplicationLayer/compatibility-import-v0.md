# Compatibility / Import v0

> **状态**：从 ADR-005 迁移 / 延后  
> **来源**：[`../adr/ADR-005-official-concept-stack-open-design.md`](../adr/ADR-005-official-concept-stack-open-design.md)
> **Related**：[`asset-import-export-boundary-v0.md`](asset-import-export-boundary-v0.md)

---

## CS-9：Import / Compatibility

### 15.1 问题

现有用户可能已经拥有 ST / CityTalent / 角色扮演生态格式的数据。兼容性议题暂时延后，并且不能反向定义 Studio Application 的内部模型。

本文当前关注下一代 AIRP / Studio Application 概念，而不是 ST import。

### 15.2 开放问题

- 是否导入 ST character card？
- 是否导入 ST worldbook？
- 是否导入 ST preset？
- 是否导入 chat logs？
- 是否保留 source raw data？
- 是否支持导出回 ST？
- 是否承诺 byte-compatible prompt？候选答案：不承诺。
- 是否为 explainability 保留 source metadata？

### 15.3 候选方向

```text
延后 import。
不要把 ST import 作为设计驱动力。
不要承诺 byte-compatible output。
不要让 ST data shape 成为内部 canonical model。
后续讨论 import 时，应把 source data 转换成 Studio AIRP documents。
```

### 15.4 2026-06-22 补充：兼容格式不拥有运行时文档

SillyTavern 的 card PNG 与 worldbook JSON 副本机制，主要解决的是导入后解耦和独立编辑问题。

Loom Studio 继承这个目标，但不继承它的内部文件形态：

```text
ST / third-party artifact
  -> Importer
  -> Studio AIRP runtime documents
  -> explicit export
```

导入后的 Card、Setting Layer、Prompt Asset、Composition Skeleton 应作为独立运行时内容参与编辑、回滚、Prompt Build 和导出。

原始 PNG / JSON 只作为 source artifact、重置来源和兼容导出参考，不作为运行时可编辑事实源。

详见 [`asset-import-export-boundary-v0.md`](asset-import-export-boundary-v0.md)。
