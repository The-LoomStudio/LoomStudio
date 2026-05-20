# Studio Application 讨论顺序 v0

> **状态**：从 ADR-005 迁移 / 开放设计  
> **来源**：[`../adr/ADR-005-official-concept-stack-open-design.md`](../adr/ADR-005-official-concept-stack-open-design.md)

---

## 建议讨论顺序

因为这个设计范围较大，讨论应分轮推进。

### 第一轮：领域基础

| 顺序 | 议题 | 必要产物 |
|---|---|---|
| 1 | CS-0 Studio Application 定位 | Card / 边界 / 已收束原则 |
| 2 | CS-3 Unified Setting Layer | Setting entry / 嵌套树 / KV / scope 候选方案 |
| 3 | CS-1 Chat / Opening model | Session / ChatEntry / Opening 候选方案 |
| 4 | CS-2 Composition Skeleton model | Skeleton / slot / cluster / ordering 候选方案 |

### 第二轮：组合流程与 runtime 边界

| 顺序 | 议题 | 必要产物 |
|---|---|---|
| 5 | CS-6 Composition Pipeline | Documents -> Fragments -> Payload 流程 |
| 6 | CS-7 Runtime Boundary | compose / sendMessage / provider.invoke 的边界 |
| 7 | CS-10 Trace Explainability | source、activation、ordering 的解释模型 |

### 第三轮：增长层

| 顺序 | 议题 | 必要产物 |
|---|---|---|
| 8 | CS-4 Global Scope | global user setting / global setting library 的边界 |
| 9 | CS-5 State / Mutation API | state patch / AI update / rollback 边界 |
| 10 | CS-8 Studio AIRP UI Integration | RPC / document access / 内建 UI 策略 |
| 11 | CS-9 Compatibility | import 策略 |

---

## 当前未决事项

以下事项明确保持未决：

- official document type 的命名；
- namespace 应该是 `airp.*`、`studio.airp.*`、`official.airp.*`，还是其他名称；历史候选 `official.concept.*` 已待重新评估；
- Card 的准确 schema；
- Opening 的准确 schema；
- Chat Session 的准确 schema；
- ChatEntry / TimelineEntry / compiled Message 的命名；
- timeline / branch / swipe 是否进入 M0；
- Setting Layer 的准确 schema；
- Composition Skeleton 的准确 schema；
- activation scanning source；
- placement / slot taxonomy；
- compiled output 是 `messages-like`、plain text，还是多个 payload；
- `compose` 是否写入 Documents；
- trace metadata 的准确约定；
- ST / CityTalent imports 的兼容范围，目前延后。

---

## 决策状态

当前状态：**未完成 / 开放设计**。

任何实现都不应把本 ADR 中的候选 TypeScript 草案当作已接受 API。

实现前，项目至少应接受或修订：

1. Studio Application 高层边界；
2. Card model M0；
3. Unified Setting Layer M0；
4. Chat / Opening model M0；
5. Composition Skeleton model M0；
6. Composition pipeline M0；
7. Runtime boundary。
