# 测试准则 (Testing)

Loom Studio 使用 `vitest` 进行测试。我们的测试原则是：**测试不追求数量，只为保护真实的业务合同和暴露真实风险。**

## 1. 测试目录结构与分类

所有的测试都在项目根目录的 `tests/` 下。为了避免历史遗留代码污染当前逻辑的验证，我们采用了严格的分类结构：

```text
tests/
  ├── unit/          # 单元测试：验证无副作用的纯函数、算法
  ├── contract/      # 契约测试：验证 RPC Envelope、接口结构是否符合约定
  ├── integration/   # 集成测试：跨包的端到端调用（不含 UI）
  ├── regression/    # 回归测试：专门针对已发现的具体 bug，确保不重犯
  ├── probes/        # 探针：性能测量、容量测试（不参与默认 CI）
  ├── extensions/    # 独立发布扩展的测试，不属于主应用 CI
  └── archive/       # 归档：历史的白皮书论证、MVP 过渡测试
```

## 2. CI 运行策略

默认的 `pnpm test` 只会运行 `unit`, `contract`, `integration`, 和 `regression`。

`probes/` 和 `archive/` 默认不运行。

`pnpm test:typecheck` 独立检查主应用测试及其引用源码的类型契约，包含探针和压力测试，不包含 `extensions/`；Vitest 的运行时通过不替代此检查。测试类型环境按项目 Node 最低版本提供 ES2024 API，浏览器测试同时保留 DOM 类型；内部包通过源码映射解析，不以旧构建产物代替。

The World 与 ST Data Compat 独立发布。检出对应扩展源码后，可用 `pnpm test:extensions` 和 `pnpm test:extensions:typecheck` 运行本仓库保留的扩展验证；只运行某个扩展时，在前者后附 `tests/extensions/the-world` 或 `tests/extensions/st-data-compat`。这些命令不是主应用门禁，不会自动下载扩展。主应用仍验证 Extension Host 和扩展安装、重载、卸载契约，使用自身维护的测试夹具。

主应用的 [GitHub Actions 配置](../../.github/workflows/ci.yml) 在 push、pull request 或手动触发时依次运行 `check:workspace`、`build`、`lint`、`test:typecheck` 和 `test`。工作流只读仓库，不运行独立扩展测试或执行发布；Node 和 pnpm 版本分别来自 `.node-version` 与 `package.json`。

## 3. 什么是好的测试？

1. **测试必须验证生产代码**: 绝不要在测试里自己用 mocks 搭建一个系统来证明自己的假设。
2. **测试名应该陈述行为**:
   - ✅ `it('emits docs.changed after document commit')`
   - ❌ `it('stage 5 path works')`
3. **不要为了过测试而写没有断言的测试**:
   - 不要写只 `console.info` 的 performance 测试。要么给它加上严格阈值放到回归里，要么放到 `probes/`。

## 4. 如何新增测试

- **修复 Bug**: 优先在 `regression/` 目录下新增一个以 bug 描述命名的测试，并在注释里写明以前为什么会错，复现步骤是什么。然后去修代码直到测试绿。
- **新增模块**: 在对应的 `unit/` 目录下增加基础单元测试。如果是跨核心流程的新功能，补充一个 `integration/`。

> 💡 **小建议**: 编写测试时，如果发现你需要超过 80 行代码去设置一个 fixture（假环境），那说明你的模块设计可能耦合度过高，或者你应该把这部分 fixture 提取成 helper 函数。
