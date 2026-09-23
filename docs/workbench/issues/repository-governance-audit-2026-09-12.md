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

### GOV-004 · P2 · 终态历史 Plan 留在 active Workbench

补查日期：2026-09-22。`pnpm check:docs:lifecycle` 报告：

```text
docs/workbench/plans/file-backed-resource-agent-script-codeact-plan.md:3
  active Workbench document declares a terminal lifecycle status:
  Superseded for CodeAct / 持久脚本等远期内容延期
```

该文件顶部已经说明 CodeAct / Sandbox 的当前入口是独立 successor，本文只是历史综合提案；它继续位于 `docs/workbench/plans/`，会让生命周期门禁把“历史快照”误认为当前施工计划。它与内容是否有追溯价值无关，问题是物理目录和状态不一致。

最小方向：把该文件移动到 `docs/archive/plans/` 并在 Archive 索引保留入口，或改回明确的非终态 Workbench 规划并删除已失效的综合入口。不能只让检查器忽略 `Superseded`，否则 active 目录仍会混入终态文件。

关闭条件：生命周期门禁不再报告该文件；当前 CodeAct successor、历史综合提案和远期延期内容各有唯一可发现入口。

### GOV-005 · P2 · Shell 动画 Plan 未进入 Workbench 计划索引

补查日期：2026-09-22。`pnpm check:docs:lifecycle` 对 `docs/workbench/plans/ui/shell-motion-integration-2026-09-18.md` 同时报告：

```text
active Workbench document is not reachable from a Workbench README index
Plan is missing from its directory index: docs/workbench/plans/ui/README.md
Plan is not reachable from plans/README.md through nested Plan indexes
```

当前文件仍写明第二轮未完整验收，因而不能简单删除或归档。问题是它既没有加入 `docs/workbench/plans/ui/README.md`，也没有通过嵌套索引进入 `docs/workbench/plans/README.md`；实际施工状态无法从规定入口发现。

最小方向：在 `ui/README.md` 登记该 Plan，并在上层 Plans 索引补充嵌套入口与状态；若它已被后续交付记录和正式 Architecture 取代，则完整迁移到 Archive，而不是只删除文件。

关闭条件：该 Plan 的状态与实际验收一致，且从 `docs/workbench/plans/README.md` 可以沿索引到达；生命周期门禁通过。

### GOV-006 · P3 · Active 全仓审阅保留已迁移源码定位

补查日期：2026-09-22。窄范围检索发现 `docs/workbench/issues/full-repo-code-review-2026-08-27.md` 仍在当前 Issue 索引中，但正文至少保留了 9 处已经失效或过时的源码路径文本：

- `apps/studio-client/src/pages/studio/model/use-studio-navigation.ts`
- `apps/studio-client/src/pages/studio/model/studio-route.ts`
- `apps/studio-server/src/http-server.ts` 的多处定位

当前对应源码位于：

- `apps/studio-client/src/shared/studio-shell/use-studio-navigation.ts`
- `apps/studio-client/src/shared/studio-shell/studio-route.ts`
- `apps/studio-server/src/http/http-server.ts`

这些是反引号代码定位而不是 Markdown 文件链接，所以 `check-docs:links` 不会发现；旧报告的发现本身可能仍有价值，但修复者按这些路径无法直接核对当前实现，行号也不能默认保持有效。该问题与 Archive 断链不同：它发生在仍被索引为当前 Issue 的审查材料中。

最小方向：在报告顶部标明历史基线并补当前路径映射，或将已冻结报告移入 Archive、在 Workbench 只保留当前 successor。不要批量替换路径后假装旧行号仍准确，也不要修改原始发现的结论而不重新审查。

关闭条件：当前 Issue 入口中的源码定位可回到现有文件，或文档明确声明其仅为历史快照并从 active 施工入口移除；不再让已迁移路径承担当前修复依据。

### GOV-007 · P3 · Knip 审计入口无法表达动态 Worker 与 Stress 测试

补查日期：2026-09-22。运行 `pnpm audit:unused` 退出码为 1，报告 3 个未使用文件、1 个未使用依赖、131 个未使用导出、1 个重复导出和 2 个配置提示。当前输出不能作为批量删除授权。

已核对的高置信边界：

- `packages/application-runtime/src/agents/codeact/sandbox-worker.ts` 不是普通静态 import，而是由 `sandbox.ts` 通过 `new Worker(new URL(\`./sandbox-worker.${extension}\`, import.meta.url))` 按构建/源码扩展名加载；Knip 将其报告为未使用文件，至少需要配置动态 Worker 入口或显式保留规则后才能判断。
- `quickjs-emscripten` 由该 Worker 直接 import；其“未使用依赖”与 Worker 未被 Knip 追踪属于同一条证据链，不能据此删除运行时依赖。
- `tests/stress/prompt-build-dfs.test.ts` 与 `tests/stress/sqlite-concurrency.test.ts` 是由 `test:stress` scope 直接发现的测试文件，不是生产孤儿；当前根 Knip entry 没有覆盖 stress 测试入口。

131 个未使用导出还混有公开类型、跨 package/动态边界和测试入口候选；本轮没有逐项判定，也没有删除任何导出。当前真正可行动的问题是 Knip 配置没有描述项目的动态/分级入口，导致门禁失败结果不可直接用于代码瘦身。

最小方向：为 `tests/stress`、CodeAct Worker 和官方 Extension 的真实入口补充 Knip 项目配置或明确 ignore，并单独审阅重复导出；保留删除前的逐项调用点证据。不要用调高容忍阈值或一次性 ignore 全部 unused exports 伪造通过。

关闭条件：Knip 能区分生产未引用、分级测试入口、动态 Worker 与公共导出；命令退出码和剩余结果具有可解释性。此项不等于上述 131 个导出全部合理。

### GOV-008 · P2 · 根 ESLint 把草稿与多运行时源码混入同一门禁

补查日期：2026-09-22。运行 `pnpm lint` 退出码为 1，报告 **175 个错误**。分包检查已经确认 Studio Client 8 个错误、Studio Server 3 个错误；根命令除此之外还扫描：

- `drafts/aicss-main/`，当前配置没有忽略 Drafts；
- `official/extensions/the-world/` 的浏览器脚本和 Node 脚本，却没有按运行时设置对应 globals；
- `official/extensions/st-data-compat/` 的未使用迁移辅助函数；
- `packages/application-runtime`、`packages/shared`、VFS 等自身的未使用导入和 `no-control-regex` 结果。

当前 `eslint.config.js` 的全局配置只给 TypeScript 文件声明了 `console`、`document`，没有为浏览器 JavaScript、Node CLI、草稿目录和 Extension smoke 脚本建立独立 project/ruleset。因而根命令的失败结果不能直接等同于 175 个同等级产品缺陷；但它也不能作为“lint 已通过”的门禁。

最小方向：明确根 lint 的范围，至少将不属于产品源代码的 `drafts/` 作为独立审查范围；为浏览器 Extension、Node Extension、CLI/Smoke 与正式 Package 分别配置运行时 globals 和 TypeScript project。保留正式 Client/Server lint 的错误，不用大范围 ignore 掩盖它们。

关闭条件：根 lint 失败项能按产品代码、草稿、浏览器运行时和 Node 运行时分类；分包门禁仍能单独阻塞真实错误；退出码与检查范围一致。未要求本轮修复 175 个结果。

## 2026-09-12 依赖合同检查

对 workspace manifests 执行范围扫描，未发现 `^` 或 `~` 开头的依赖版本，当前浮动范围数量为 0。因此本轮没有把“依赖版本不锁定”列为问题。客户端确实仍有未使用依赖候选，但属于代码瘦身审计中的 SEP-006，不在此重复登记。

## 验证记录

- `pnpm run check:docs:links`：通过，292 个 Markdown 文件的路径、大小写和锚点有效。
- `pnpm run check:docs:lifecycle`：失败，GOV-001、GOV-002。
- workspace manifest 范围扫描：浮动版本数量 0。
- 未修改业务代码、文档内容或依赖配置。

## 2026-09-22 门禁复核

补跑 `pnpm check:docs`，退出码为 1。该脚本串联 `check:docs:links` 与 `check:docs:lifecycle`，本次没有产生新的独立问题：前者复现 GOV-003 的 3 个归档源码断链，后者复现 GOV-004 的 1 个终态 active Plan 与 GOV-005 的 3 条索引缺失报告。

因此当前文档门禁的可核对状态是：**总门禁失败；链接子检查失败；生命周期子检查失败**。这里的失败来自当前工作区的文档/源码移动状态，不等于业务代码编译或运行失败；本轮未修改门禁、历史文档或索引。

同日运行 `pnpm check:workspace`，结果为 `Workspace health check passed`，退出码为 0。该检查没有发现新的 Package、Workspace manifest 或目录结构问题；它不能抵消文档门禁和 Studio Server TypeScript 门禁的失败。
