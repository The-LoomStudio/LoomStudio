# ADR-006: capability 校验下沉到 Stdlib 作为 LinterPass / DevTool 命令

- **Status**: Accepted
- **Date**: 2026-04-29
- **Promoted from**: [ADR-C-006](../loom-adr-candidates.md#adr-c-006-capability-链路名存实亡)

## Context

合流测试发现 `@loom/st` 的 14 个真实 Pass **没有一个**定义 `requires/provides`。架构设计中的 DAG 依赖分析在现实中没有被遵守。

原候选 A/B 都不令人满意：
- **A（Core 强校验）**：让 Core 读 `requires/provides`，违反白皮书 §"Structure over Semantics"——"Core 不读 meta 任何字段"。这是 Loom 最核心的克制原则之一，破例就回不去了。
- **B（降级为文档字段）**：等于告诉 Pass 作者"你声明 capability 没有任何机器可验证的保证"。Pass 作者无法向用户承诺 Pipeline 在什么前提下能工作，社区协作必然劣化。

讨论中识别到原候选漏掉的关键问法：

> 真正的问题不是"要不要强制"，而是 **capability 校验属于哪一层**？

如果把校验从 Core 挪到 Stdlib，Core 的"不读 meta"原则维持，Pass 作者仍拿到机器可验证的工具。这才是符合三层架构的正解。

## Decision

**采纳新增的 C 路线**：capability 校验下沉到 Stdlib，作为可选 lint 工具。

具体规格：

1. **Pass 接口字段保留**：
   ```ts
   interface Pass {
     name: string
     requires?: string[]     // 保留作为契约声明
     provides?: string[]
     run(fragments): ...
   }
   ```
2. **Core 完全不读这两个字段**：`loom.run` 的执行路径与 capability 无关。
3. **Stdlib 提供 `validatePipeline`**：
   ```ts
   import { validatePipeline } from '@loom/stdlib'
   const diagnostics = validatePipeline(passes)
   // 检查：
   //   - 每个 requires 是否被前序 Pass 的 provides 满足
   //   - 是否存在循环依赖
   //   - 是否有 unused provides（warning）
   ```
4. **DevTool CLI 封装**：`loom lint <pipeline.json>` 命令输出 Diagnostic 列表，CI 可集成。
5. **运行时不强制**：即使 lint 失败，`loom.run` 仍按声明顺序执行。这保持"Pass 作者可在原型阶段不写 capability"的灵活性。

## Consequences

- **正面**：
  - Core 的"不读 meta"原则严格保持。
  - Pass 作者声明 capability 仍然有意义（CI 可校验，发布前必过 lint），可向用户承诺"我的 Pass 在 X 前提下能工作"。
  - 校验逻辑可独立演进（加新规则、加智能提示），不污染 Core 冻结面。
  - 与 ADR-005 的 PassConfig 结构天然衔接：`validatePipeline(passes: PassConfig[])` 可同时检查 capability 和 params schema。
- **负面 / 已知缺口**：
  - 运行时不阻拦，意味着用户绕过 lint 直接 `loom.run` 一个有缺陷的 pipeline 时仍会跑——但这与 TS 类型不强校验、JS 运行时仍跑的关系是同构的，可接受。
  - Pass 作者要主动声明 `requires/provides` 才能享受 lint，需通过文档和模板引导。
  - 当前 14 个 ST Pass 都需要补 capability 声明（文档级任务）。

## Alternatives Considered

- **A. Core 强校验（TS 类型 + 运行期断言）**：
  - 拒绝原因：违反"Structure over Semantics"；让 Core 读 meta 是不可逆的哲学破口。
- **B. 降级为纯文档字段或彻底删除**：
  - 拒绝原因：Pass 作者失去机器可验证的保证，伤害生态协作。

## Implementation Notes

- `@loom/stdlib` 新增 `validatePipeline` 模块；签名：
  ```ts
  function validatePipeline(passes: PassConfig[]): Diagnostic[]
  // Diagnostic { severity, code, message, passIndex, related? }
  ```
- 错误码至少包含：`missing-required`、`circular-dependency`、`unused-provides`（warning）。
- DevTool CLI 包装：
  ```bash
  loom lint pipeline.json
  loom lint --strict pipeline.json    # warning 也视为失败
  ```
- 给 14 个 ST Pass 补 `requires/provides` 声明作为 follow-up 任务（不阻塞本 ADR 接受）。
- 测试用例：
  - 缺失 requires → 报 `missing-required`，附带建议"在第 N 步前插入提供 X 的 Pass"。
  - 循环依赖 → 报 `circular-dependency` 并指出环的成员。
  - 完全不写 capability 的 pipeline → 不报错（视为"作者放弃静态保证"）。
