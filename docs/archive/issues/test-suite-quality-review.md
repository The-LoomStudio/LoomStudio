# 测试套件质量审查报告 (Test Suite & Quality Review)

> **状态**：Historical Audit Snapshot / Superseded

## 审查目标

全面排查 Loom Studio 项目中的 **测试套件架构、测试有效性与代码质量**（涵盖 `tests/` 目录、各 Package 内嵌测试与 Vitest 配置），重点审查：
1. **测试组织物理分布与包级脚本有效性**
2. **历史僵尸测试与设计探针残留（Archive / Spike Tests）**
3. **形式主义单测与断言深度不足**
4. **文档与实际测试文件的虚假引用**
5. **测试 Harness 与 Mock 工具的重复粘贴**

---

## 1. 核心问题与设计异味清单

### 🔴 [高] 1. 包级测试脚本失效与空跑假象（Ghost Test Scripts）

**文件：**
- [`packages/application-runtime/package.json` L12](../../../packages/application-runtime/package.json)
- 多个 `packages/*/package.json`

**现象分析：**
1. `packages/application-runtime/package.json` 中的测试命令为：
   ```json
   "test": "vitest run --root ../.. tests/application-runtime-m0.test.ts --passWithNoTests"
   ```
   然而，`tests/application-runtime-m0.test.ts` 物理上**根本不存在**！带上 `--passWithNoTests` 导致执行 `pnpm --filter @loom-studio/application-runtime test` 时没有任何报错，静默返回成功。
2. **测试位置组织严重分裂**：
   - 只有 `core` 与 `secret-store` 将测试放在包源码目录内（`packages/secret-store/src/*.test.ts`）；
   - 其余 16 个包的单元测试全部分散在顶层 `tests/unit/` 下。
   - 这导致在各个子包目录下运行 `pnpm test` 时，全部由于当前包目录无测试文件而触发 `--passWithNoTests` 空跑退出。

**建议：**
- 统一测试存放规范（推荐各包内聚放置 `src/*.test.ts`，集成测试放置顶层 `tests/integration/`）。
- 修正所有失效的包级 test 脚本路径。

---

### 🔴 [高] 2. 顶层 `tests/archive/` 堆积近 1000 行僵尸测试

**文件：**
- 历史路径 `tests/archive/design-spikes/prompt-builder-data-model.test.ts`（704 行，现已删除）
- 历史路径 `tests/archive/whitepaper-scenarios/mvp-whitepaper-scenarios.test.ts`（208 行，现已删除）

**现象分析：**
- `vitest.config.ts` 中配置了 `defaultTestExclude = ['tests/archive/**/*.test.ts', ...]`，这意味着这些测试在日常开发和 CI 中**被完全排除、从不执行**。
- `prompt-builder-data-model.test.ts` 内部手写了大量已过时的临时数据结构（`Anchor`, `ZoneNode`, `CompositionSkeleton`），正式功能已在 `prompt-builder.ts` 落地。
- `mvp-whitepaper-scenarios.test.ts` 仍在使用已废弃的 Manifest v1 和旧的 InMemoryDocumentStore。

**建议：**
- 物理删除 `tests/archive/` 下已无回归验证价值的陈旧测试文件，精简近 **1000 行** 磁盘与心智负担。

---

### 🟡 [中] 3. 形式主义单测（Trivial / Low-Value Tests）

**文件：**
- [`tests/unit/client/narrative-runtime.test.ts`](../../../tests/unit/client/narrative-runtime.test.ts) (17 行)
- [`tests/unit/client/activation-control.test.ts`](../../../tests/unit/client/activation-control.test.ts) (23 行)

**现象分析：**
- `narrative-runtime.test.ts`：作为承载 Narrative 分支切换、多轮对话调用、时间线加载等 300+ 行复杂状态机的前端核心 Feature，其单测文件里**仅包含 1 个测试用例——验证数组 `find(b => b.id === id)` 是否能查到元素**！
- 核心业务的并发冲突、状态回滚、分支派生等高风险逻辑处于零单测覆盖状态。

**建议：**
- 剔除纯静态语言特性的无意义断言，补齐关键状态转换与错误恢复的最小真实测试。

---

### 🟡 [中] 4. 架构指南中引用的测试文件物理缺失

**文件：** [`docs/guide/project-structure.md` L73](../../guide/project-structure.md)

**现象分析：**
- 指南中的 Client 任务路由表写明：
  `修改角色卡列表、创建卡、选中卡 -> 对应测试 tests/unit/client/cards.test.ts`
- 实际在 `tests/unit/client/` 目录下**根本不存在 `cards.test.ts`**。

**建议：**
- 补齐对应的 Feature 单元测试，或修正文档路由表。

---

### 🟡 [中] 5. 测试 Harness 与初始化代码 5 处大面积复制粘贴

**文件：**
- `tests/integration/client-bridge/data-flow.test.ts` L14
- `tests/integration/platform/capability-platform-smoke.test.ts` L13
- `tests/integration/platform/document-trace-diagnostics.test.ts` L13
- `tests/probes/performance/json-communication.test.ts` L21
- `tests/archive/whitepaper-scenarios/mvp-whitepaper-scenarios.test.ts` L16

**现象分析：**
上述 5 个文件各自完整复制粘贴了一段约 30 行的 `function createHarness() { ... }`（用于装配 InMemoryDocumentStore, DiagnosticsRegistry, TraceAudit, LoomRunner, ExtensionHost, Kernel）。

**建议：**
- 提取统一的测试基建 `tests/helpers/test-harness.ts`，供所有集成测试直接 import，消除约 **120 行** 样板代码。

---

## 2. 审查总结与改进优先级

| 问题类型 | 影响范围 | 风险级别 | 优化建议 |
|---|---|---|---|
| **失效测试脚本** | `packages/application-runtime` 及各子包 | 🔴 高 | 修正 `package.json` 中指向不存在文件的测试命令 |
| **归档僵尸测试** | `tests/archive/` (近 1000 行) | 🔴 高 | 彻底清理被 exclude 的设计探针与过时白皮书测试 |
| **形式主义单测** | `tests/unit/client/narrative-runtime.test.ts` 等 | 🟡 中 | 提升关键状态机与边界的断言深度 |
| **虚假测试引用** | `docs/guide/project-structure.md` | 🟡 中 | 移除不存在的 `cards.test.ts` 文档指引 |
| **重复测试 Harness** | 5 个集成测试文件 | 🟡 中 | 提取公共 `test-harness.ts` |
