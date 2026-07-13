# ADR-004: Pass 写权限不阻拦，但 owner 越权写自动产生 Diagnostic

- **Status**: Accepted
- **Date**: 2026-04-29
- **Promoted from**: [ADR-C-004](../loom-adr-candidates.md#adr-c-004-pass-写权限边界)

## Context

PoC 的 Rogue Client 测试证明：客户端 / Pass 可以随意篡改任何 Fragment 的 content，包括系统提示词。Kernel 不阻拦。

原候选只给出 A（不阻拦）/ B（运行时阻拦）两选：
- A 让"Pass 之间互改"成为合法用例（如 `ActivateWorldInfo` 修改 `WorldEntry.active` 字段），符合 Core 的纯函数气质，但 **Pass 作者无法知道"我的产出是不是被悄悄改了"**——这是协作型生态的硬伤。
- B 引入 field-level 冻结或权限校验，违反 fragment-as-data 的简洁性，且会让大量合法的"协作改写"场景变得异常笨重。

讨论中识别到一个被原候选漏掉的中间路线：**不阻拦，但所有越权写入自动进 Diagnostic 流**。代价极小，把"猜测"变成"读 trace"。

## Decision

**采纳新增的 C 路线**：软所有权 + 越权写自动 Diagnostic。

具体规则：

1. **owner 自动写入**：Core 在 `Pass.run()` 包装层为 Pass 产出（add）的每个 fragment 自动写入 `meta.__owner = passName`。
2. **owner 字段不可被后续 Pass 修改**：尝试 mutation `meta.__owner` 视作非法操作（直接抛错）；这是少数 Core 主动校验的字段。
3. **越权写不阻拦但记 Diagnostic**：后续 Pass 对 `meta.__owner !== self` 的 fragment 做任何 mutation 时，Core 不阻拦但向当前 PassExecution 的 trace 写一条：
   ```
   Diagnostic {
     severity: 'info',
      code: 'loom/cross-owner-write',
      fragmentId,
      meta: {
        fromOwner: <originalPassName>,
        toPass: <currentPassName>,
        mutatedFields: ['content', 'meta.foo', ...]
      }
   }
   ```
4. **DevTool 提供过滤器**：默认显示，可按 `code: 'loom/cross-owner-write'` 过滤；CI 可配置为 `severity: 'warning'` 触发失败。

## Consequences

- **正面**：
  - Pass 作者拿到"我的产出被谁改了"的事后归因能力，协作摩擦从"调试一周"降到"读一行 trace"。
  - 不引入运行时阻拦，Pass 仍可自由组合，纯函数气质维持。
  - `meta.__owner` 是 Core 唯一主动写的 meta 字段；这与"Structure over Semantics"的违反被限定在最小范围（且只写不读语义）。
- **负面 / 已知缺口**：
  - Core 必须为产出 fragment 自动写 owner，给 Pass.run() 增加了一层包装；mutation 路径性能影响 < 5%（合流测试估算）。
  - 若 Pass 通过共享引用偷偷修改 fragment（绕过 mutation API），owner 检测会失效——这与 fragment 的不可变契约本身违反，是 anti-pattern，由 ADR-006 的 lint 工具检出。
  - `__owner` 占用 meta 命名空间；`__` 前缀作为保留前缀写入白皮书。

## Alternatives Considered

- **A. 不加阻拦（什么都不做）**：
  - 拒绝原因：生态协作成本过高；Pass 作者要么不敢发布要么过度防御性编程。
- **B. 运行时阻拦（field-level 冻结或 reads/writes 强校验）**：
  - 拒绝原因：违反 Pass 自由组合的核心承诺；ActivateWorldInfo 这类合法用例会被迫变成 RPC 调用。

## Implementation Notes

- Core 改动点：`Pipeline.run()` 在调用 `pass.run(fragments)` 前后做 mutation diff，自动给 `add` 写 `meta.__owner`，给 `update` 检测 owner 不匹配。
- v0.1 实现收紧：
  - 初始 input fragment 的 owner 强制归一化为 `input`，不信任调用方自带的 `meta.__owner`。
  - 新增 fragment 即使自带 `meta.__owner`，也会被 Core 覆盖为当前 `pass.name`。
  - 用户传入的 `meta.__owner` 永远不作为 Core 边界上的可信事实。
- `__owner` 字段在 mutation replay (ADR-002) 中保持完整。
- 测试用例：
  - 单 Pass 产出 → owner 自动写入，等于 Pass.name。
  - Pass A 产出，Pass B update content → trace 含 1 条 `loom/cross-owner-write` Diagnostic。
  - 任何 Pass 试图 update `meta.__owner` → 抛错。
