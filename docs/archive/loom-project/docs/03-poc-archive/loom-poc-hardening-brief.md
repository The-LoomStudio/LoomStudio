# Loom PoC Hardening Brief

> **Status**: sealed
> **替代关系**: 不替代 `loom-poc-plan.md` / `loom-studio-poc-plan.md`，是它们的**收口工作**。
> **后继关系**: 已完成后产出 `loom-adr-candidates.md`，正式版以那份文件为输入。
> 
> 本文件已封存。后续工作见 `loom-adr-candidates.md` 和 `loom-poc-questions.md`。

---

## 0. 这份文件存在的理由

两个 PoC 已分别证伪了"机械可行性"。但在源码审视中浮现了 6 条与文档不一致的现实形态（详见 §App-A）。其中：

- **观察 #3 (rpcs map 全局可见)** 一旦进正式版会被 extension 锁定为依赖，**必须现在改**。
- **观察 #6 (`@loom/st` 与 studio-poc 没合流)** 是两个 PoC 之间唯一缺失的接口验证，**做一次性价比最高**。
- 其余 4 条 (#1 #2 #4 #5) 信号已饱和，应当**归档**而非继续 PoC。

本文件的总目标：**用最小代价把两个 PoC 的"可信度"从 60% 拉到决策线，然后封存。**

（其余原计划内容已实施并归档，故略）
