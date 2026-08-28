# Global Scope v0

> **状态**：从 ADR-005 迁移 / 开放设计  
> **来源**：[`../adr/ADR-005-official-concept-stack-open-design.md`](../../adr/ADR-005-official-concept-stack-open-design.md)

---

## CS-4：Global Scope

### 10.1 问题

全局设定是 Studio Application 的关键问题之一，不能被简化成某张 Card 内的字段。

例如：

- 全局 user 设定；
- 全局设定库；
- 全局写作偏好；
- 全局安全 / 风格规则；
- 跨 Card / 跨 Session 的长期状态；
- 当前 Workspace 范围内的默认上下文。

这些能力与 Card、Session、Setting Layer、Composition Skeleton 都有关。

当前不接受用 `User Persona` 或 `Actor` 这类窄概念直接覆盖全局问题。

### 10.2 开放问题

- Global Scope、Workspace Scope、Card Scope、Session Scope 如何区分？
- 全局 user 设定是否只是 Setting Layer 中的一个全局 setting tree？
- 全局设定如何被当前 Card / Session 选择性引用？
- 多张 Card 同时参与一个 Session 时，全局设定如何合并？
- 全局设定是否有优先级、启用条件和可回滚边界？
- 全局状态是否随单个 Session rollback？
- Composition Skeleton 如何声明是否接收 global sources？

### 10.3 候选方向

```text
把 global user settings 和 global lore 视为 scope 问题，
而不是特殊的 Character / Persona 字段。
```
