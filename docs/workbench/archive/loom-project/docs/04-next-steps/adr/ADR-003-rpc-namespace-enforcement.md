# ADR-003: Extension RPC 强制 `extensionId.method` 命名空间，Kernel 校验注册冲突

- **Status**: Accepted
- **Date**: 2026-04-29
- **Promoted from**: [ADR-C-003](../loom-adr-candidates.md#adr-c-003-extension-间-rpc-的命名空间与权限)

## Context

PoC 修复了 `host.rpcs` 裸露的问题（改为 `callRpc` 且记入 trace），但所有 Extension 对所有 RPC 仍是可见、可调用、注册命名靠约定。

从生态开发者视角看，这条路有明确历史教训：
- VS Code、Chrome Extension 早期都走"命名约定"路线，规模过 50 之后**必然出注册冲突**，最后都加了 `publisher.extensionId` 硬命名空间。
- Concept Stack 作者最怕的不是"我的 RPC 被偷调"（trace 可审计），而是"另一个 Extension 注册了同名 RPC，把我的覆盖了"——这是数据完整性问题，不是权限问题。

而原候选 B 路线（manifest `consumes` 鉴权）会显著膨胀 Kernel：每个 RPC 调用都要查 manifest、做 capability 比对，且引入"Extension 间信任图谱"的新概念。在尚未观察到真实滥用前引入这套是过度设计。

## Decision

**采纳 B 路线的精简版**：强制命名空间 + 注册冲突校验，但不引入 manifest `consumes` 鉴权。

具体规则：
1. **强制命名格式**：所有 RPC 注册必须以 `extensionId.method` 形式存在；当 Extension 调用 `host.registerRpc('character.update', fn)` 时，Kernel 自动改写为 `<callerExtensionId>.character.update`。
2. **冲突即抛错**：注册时若检测到同名 RPC 已存在（即使 owner 相同），直接抛 `RpcRegistrationConflict`，不允许覆盖（避免静默替换）。
3. **调用侧无鉴权**：`callRpc('loom-st.character.update', ...)` 无需声明 `consumes`，任何 Extension 都可调用；调用关系仍记入 trace，由 audit 兜底。
4. **保留 reserved namespace**：`system.*`、`loom.*` 由 Kernel 占用，第三方 Extension 注册时被拒。

## Consequences

- **正面**：
  - 从根本上消除"两个 Extension 注册同名 RPC"的爆雷场景。
  - Concept Stack 作者拿到稳定的"我的 RPC 命名空间不会被污染"承诺。
  - Kernel 改动极小（注册时 1 个 if，调用时 0 改动）。
  - 留出未来引入 `consumes` 鉴权的空间（向后兼容）。
- **负面 / 已知缺口**：
  - Extension 间 RPC 调用仍是"想调就调"，理论上可被滥用——但目前生态规模下风险可控，且 trace 可审计。
  - `<callerExtensionId>` 在沙箱里必须可信（由 Plugin Host 注入，Extension 不可伪造）；这与 ADR-001 的 stackId 不同，是**硬身份**。

## Alternatives Considered

- **A. 默认开放，只依赖约定和 trace 审计（"软隔离"）**：
  - 拒绝原因：规模化必爆冲突，VS Code/Chrome 已走过弯路。
- **B 完整版. manifest `consumes` 鉴权**：
  - 推迟原因：当前生态规模下成本大于收益；待观测到真实滥用案例（且 audit 不足以应对）再起 ADR。

## Implementation Notes

- Plugin Host 在实例化 Extension 时注入 `host.extensionId`（不可篡改），`host.registerRpc` 内部使用此值改写命名。
- 新增 `RpcRegistrationConflict` 错误类型，包含 ownerExtensionId、conflictingExtensionId、method。
- 测试用例：
  - 同一 Extension 重复注册同名 RPC → 抛错（不允许覆盖）。
  - 两个 Extension 注册同 method（不同 extensionId）→ 都成功，互不影响。
  - 注册 `system.foo` → 拒绝。
