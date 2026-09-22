# LoomStudio 仓库治理与生命周期审计（2026-09-12）

> **状态**：Open Issues
> **审计基线**：`main` / `e7683f1cac7bc8d9a59de724f753a765942bd3e7` + 当前未提交工作树
> **范围**：文档生命周期门禁、归档索引、workspace 依赖版本合同

## 已确认问题

### GOV-001 · P2 · 活跃 Workbench Plan 使用终态 Complete，生命周期门禁因此失败

`pnpm run check:docs:lifecycle` 当前失败，具体证据为：

```text
docs/workbench/plans/session-recovery-and-history-transfer-plan.md:3
  active Workbench document declares a terminal lifecycle status: Complete
```

该文件仍位于 `docs/workbench/plans/`，但状态已写成终态。这样会让“活跃设计/待执行工作”和“已完成归档事实”无法区分，也会使文档检查持续红灯。问题不在检查器过于严格，而是文件位置和生命周期状态互相矛盾。

最小修复方向：二选一。若计划已完成，将其移入 `docs/archive/plans/` 并补齐归档摘要；若仍需作为活跃 successor，改回项目约定的非终态并明确剩余工作。不要只绕过检查器。

### GOV-002 · P2 · 归档 Plan 存在但未登记 Archive 索引

同一次 `pnpm run check:docs:lifecycle` 还报告：

```text
docs/archive/plans/README.md:1
  archived Plan is missing from the Archive index: card-bundle-size-and-layout-fix-plan.md
```

归档文件没有进入索引，导致通过入口无法发现它，也说明归档动作不是一个完整的原子流程。长期积累后，项目会同时拥有“磁盘上存在但不可导航”的历史设计和重复 successor。

最小修复方向：把该 Plan 加入 `docs/archive/plans/README.md`，或删除确认已无交付价值的孤儿归档文件；选择必须与实际生命周期一致。

### GOV-003 · P3 · 当前重构工作区留下三个归档源码断链

补查日期：2026-09-22。此项依据当前未提交工作区，不指称已发布或已提交基线存在回归；前两项的历史状态未在本轮重新验证。

`pnpm check:docs:links` 退出码为 1，报告：

```text
docs/archive/issues/frontend-fsd-and-architecture-review.md:66
  ../../../apps/studio-client/src/pages/studio/model/studio-layout-store.ts
docs/archive/plans/ui/background-and-panel-materials-plan.md:16
  ../../../../apps/studio-client/src/features/extension-renderers/model/client-renderer-host.ts
docs/archive/plans/ui/background-and-panel-materials-plan.md:18
  ../../../../apps/studio-client/src/pages/studio/model/studio-layout-store.ts
```

三个目标均已不存在。当前 git 状态显示两个旧源码路径被删除，对应的新路径为：

- `apps/studio-client/src/shared/studio-shell/studio-layout-store.ts`
- `apps/studio-client/src/shared/extension-renderer-runtime/client-renderer-host.ts`

检查器实际递归扫描 Archive；`docs/archive/README.md` 将归档定义为冻结的历史材料，而非现行实现保证。修复时应保留旧路径作为历史文本，并注明当前位置或使用准确的历史版本引用，不能只把链接文字替换成新路径后继续声称文件仍错置于 Page。也不应为三个路径迁移直接跳过全部归档检查。

关闭条件：上述三处链接有可访问目标且不改变原历史判断的时态，文档链接命令通过；不将这个文档门禁问题扩大为运行功能故障。本轮仅登记问题，未修改历史正文、检查器或正在进行的源码重构。

## 2026-09-12 依赖合同检查

对 workspace manifests 执行范围扫描，未发现 `^` 或 `~` 开头的依赖版本，当前浮动范围数量为 0。因此本轮没有把“依赖版本不锁定”列为问题。客户端确实仍有未使用依赖候选，但属于代码瘦身审计中的 SEP-006，不在此重复登记。

## 验证记录

- `pnpm run check:docs:links`：通过，292 个 Markdown 文件的路径、大小写和锚点有效。
- `pnpm run check:docs:lifecycle`：失败，GOV-001、GOV-002。
- workspace manifest 范围扫描：浮动版本数量 0。
- 未修改业务代码、文档内容或依赖配置。
