# Compatibility / Import v0

> **状态**：从 ADR-005 迁移 / 延后  
> **来源**：[`../adr/ADR-005-official-concept-stack-open-design.md`](../adr/ADR-005-official-concept-stack-open-design.md)

---

## CS-9：Import / Compatibility

### 15.1 问题

现有用户可能已经拥有 ST / CityTalent / 角色扮演生态格式的数据。兼容性议题暂时延后，并且不能反向定义内部模型。

本 ADR 当前关注下一代 AIRP / Official Concept Stack 概念，而不是 ST import。

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
后续讨论 import 时，应把 source data 转换成 official concept documents。
```
