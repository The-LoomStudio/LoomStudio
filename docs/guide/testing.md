# 测试准则 (Testing)

Loom Studio 使用 `vitest` 进行测试。我们的测试原则是：**测试不追求数量，只为保护真实的业务合同和暴露真实风险。**

## 1. 测试目录结构与分类

自动化测试集中在根目录 `tests/`，按验证边界分类，而不是按开发阶段或修复日期分类：

```text
tests/
  ├── unit/          # 单一模块或领域：纯逻辑、Store、隔离依赖的客户端测试
  │   └── client/    # 客户端 model、组件接线及 SSR；不等于真实浏览器验收
  ├── contract/      # RPC、Transport、Extension Host 等公开边界合同
  ├── integration/   # 真实 Runtime、SQLite、Server 和跨端调用
  │   └── client/    # 客户端逻辑与真实 HTTP/SSE 协作
  ├── stress/        # 显式运行的容量与性能阈值门禁
  ├── probes/        # 测量与手动浏览器诊断，不参与默认 CI
  ├── extensions/    # 独立发布扩展的测试，不属于主应用 CI
  ├── fixtures/      # 静态样本、宿主维护的测试扩展
  └── support/       # 已有多个消费者的共享测试夹具
```

`regression/` 是默认运行器保留的可选入口，不强制将每个 Bug 用例移入其中。
历史设计记录放在文档归档；不为过时的可执行测试建立永久 `archive/`。
使用真实 SQLite 的单一 Store 测试可以留在 `unit/`；启动真实 HTTP Server 的用例进入 `integration/`。

## 2. CI 运行策略

默认的 `pnpm test` 只会运行 `unit`, `contract`, `integration`, 和 `regression`。

| 命令 | 实际范围 |
| --- | --- |
| `pnpm test` | 主应用全部自动化回归，不含独立扩展、stress、probes |
| `pnpm test:fast` | Shared 单元测试及 contract；不是所有单元测试的别名 |
| `pnpm test:client` | `unit/client` 与 `integration/client` |
| `pnpm test:server` | `unit/studio-server` 与 `integration/studio-server` |
| `pnpm test:real` | `integration/pipeline`，使用真实本地调用链和 Fake Provider，不访问真实模型 |
| `pnpm test:stress` | 仅 `stress`，包含显式性能阈值 |
| `pnpm test:probes` | `probes/**/*.test.ts` 的测量，不包含 `.browser.ts(x)` 手动诊断 |
| `pnpm benchmark:context-assets` | mitata 纯模型基准，独立于 Vitest 门禁 |
| `pnpm check:types` | 全仓包复合构建与测试类型契约硬性门禁（`tsc -b && tsc -p tests/tsconfig.json`） |
| `pnpm check:all` | 综合检查工作区一致性与全仓类型契约 |

范围由根 `vitest.config.ts` 的 `LOOM_TEST_SCOPE` 决定；未知值直接报错，不静默运行全套。
定向运行使用 `pnpm exec vitest run tests/…/name.test.ts`；只检查范围使用
`pnpm exec vitest list --filesOnly`。不要把“未收集到目标测试”或带 `passWithNoTests` 的退出码 0 当作通过。

`pnpm check:types` 统一执行全仓 Project References 复合构建（`tsc -b`）与测试类型检查（`tsc -p tests/tsconfig.json`），是全仓类型一致性的最高门禁，可防止本地因别名直通而漏报 `packages/` 编译失败。`pnpm test:typecheck` 仅独立检查主应用测试及其引用源码的类型契约；全仓基础编译基线与测试环境均对齐至 ES2024 与 DOM 规范。内部包通过源码映射解析，不以旧构建产物代替。

The World 与 ST Data Compat 独立发布。检出对应扩展源码后，可用 `pnpm test:extensions` 和 `pnpm test:extensions:typecheck` 运行本仓库保留的扩展验证；只运行某个扩展时，在前者后附 `tests/extensions/the-world` 或 `tests/extensions/st-data-compat`。这些命令不是主应用门禁，不会自动下载扩展。主应用仍验证 Extension Host 和扩展安装、重载、卸载契约，使用自身维护的测试夹具。

主应用的 [GitHub Actions 配置](../../.github/workflows/ci.yml) 在 push、pull request、手动或可复用工作流触发时，检查 job 依次运行 `check:workspace`、`build`、Client build、`lint`、`test:typecheck` 和 `test`。独立的三平台 release-smoke job 构建主应用、验证静态文件与认证、准备发行目录并执行冒烟检查；它不发布产物，也不运行独立扩展测试。Node 和 pnpm 版本分别来自 `.node-version` 与 `package.json`。

## 3. 什么是好的测试？

1. **测试必须验证生产代码**：mock 只替换当前测试之外的边界。不要在测试里重写业务实现来验证自己。
2. **测试名应该陈述行为**:
   - ✅ `it('emits docs.changed after document commit')`
   - ❌ `it('stage 5 path works')`
3. **不要为了过测试而写没有断言的测试**:
   - 不要写只 `console.info` 的 performance 测试。要么给它加上严格阈值放到回归里，要么放到 `probes/`。
4. **断言当前合同，不锁定无关细节**：验证消息内容时，不用包括遥测、运行状态的总行数代替；
   但测量记录、失败边界等本身是目标时，应单独断言它们。更新旧预期前先核对实现与正式合同。
5. **相似场景不一定重复**：Store 原子性、Runtime 业务行为、HTTP 身份边界各有不同风险。
   只有前置条件、执行路径与断言合同一致时才合并；保留独立的权限、并发和失败恢复用例。
6. **UI 树节点与实体标识契约明确**：涉及树形资源（如 `PromptResource`）操作与展示时，测试必须明确断言树根节点使用 `rootNode.id` 而非外层 `resource.id`，并在选择/重命名回调中严格验证节点标识与资源标识语义，禁止混淆。

## 4. 如何新增测试

- **修复 Bug**：优先在所属行为文件中补用例，必要时注明原故障原因；不再为审查编号、开发阶段单独创建重复套件。
- **新增模块**：在对应 `unit/` 放最小合同测试；只有风险跨越真实依赖时才增加 integration。
- **拆分文件**：按业务行为或运行环境拆分。共享确有重复的夹具，不按固定行数拆文件，不建立通用 fixture 配置框架。
- **合并用例**：相同执行步骤、仅输入和期望不同，用 `it.each`；不要把互不相关的失败场景合成一个长测试。

## 5. 现有依赖与夹具

- **happy-dom 与客户端隔离环境**：默认使用 Node 环境。需要 DOM 或真实 React 挂载的测试在文件中声明 `// @vitest-environment happy-dom`；纯模型与 SSR 测试可以保持 Node 环境。当前 Vitest 不使用 `environmentMatchGlobs`，不依赖目录名切换环境。
- **原生 Hook 挂载工具 (`renderHook`)**：针对需要验证 React 生命周期的 Custom Hooks，使用 `tests/support/client/render-hook.ts` 提供的零依赖原生挂载器（基于 React 19 的 `act` 与 `createRoot`）。**严禁在新测试中手写 `vi.mock('react')` 拦截 `useState`/`useEffect`**；纯逻辑应优先下沉为纯函数或纯模型文件进行无 Mock 单测。
- **fast-check**：当前用于 Context Asset 列表过滤与 Prompt Resource 树不变量。
  所有随机输入必须由 arbitrary 生成，禁止在 property 或 `.map()` 中用 `Math.random()`。
  ID 从本次样本派生，避免全局递增状态；保留失败输出的 seed/path，通过
  `fc.assert(property, { seed, path })` 重放。固定例子保护已知 Bug，属性测试补充组合空间，二者不机械互换。
- **mitata**：已有 `scripts/dev/benchmark-context-assets.ts`，用于模型算法比较。
  输入构造与索引准备放在被测函数之外；生产 API 变化时同步 fixture。
  不为显示测量数字把 HTTP 探针强行改成微基准；压力阈值与趋势测量是不同用途。
- **Vitest**：复用 `vi.fn`、`vi.spyOn`、`it.each`、fake timers 和 `onTestFinished`。
  真实计时不是异步同步机制；等待明确的 Promise/事件，定时器逻辑才使用 fake timers。
- **原生 Promise**：Node 基线支持 `Promise.withResolvers<T>()`，不再重复编写 deferred 工厂。
- **资源清理**：临时目录使用 `mkdtemp`，在 `finally` 或 `onTestFinished` 中释放。
  不依赖测试成功后最后一行才关闭数据库，不复用跨用例固定可写目录。
- **客户端夹具**：`support/client/narrative-runtime.ts` 只服务 Narrative Hook 测试，
  集中注册 mock 与每用例重置；不得在一个文件混用该夹具和真实 React 生命周期。
  `primaryFixture` 显式创建并打开主对话；测试“尚未创建主对话”时使用普通 `fixture`。
- **查询与组件边界**：SSR 使用真实 QueryClient 和明确的缓存数据，每次渲染后清理；
  `support/client/character-panel.ts` 拒绝意外 RPC。父面板验证子组件接线，
  子组件自己验证选择、错误与重试，不在两处复制同一套内部控件操作。

## 6. 验证边界

维护测试时先取得相关基线，保留失败原因；不得以删除断言、宽泛 mock、`.skip` 或增加超时制造通过。
局部修改跑直接覆盖的文件，公共夹具或运行配置变更扩大到其消费者。
Vitest 通过、TypeScript 通过、客观浏览器诊断和人工视觉验收是四种不同证据。
`probes/client/` 的浏览器模块需要单独入口与实际运行；其存在不证明当前版本已验收，
更不能因内容与 mock 测试相似就认定冗余。
会话恢复探针的入口、运行步骤和隔离边界见
[浏览器恢复诊断](../../tests/probes/client/session-recovery.md)；
它运行真实 React 生命周期，但使用内存 API，不替代真实后端端到端验证。


### 独立扩展的测试归属

扩展自己的 parser、normalizer、Worker 和业务集成测试放在扩展仓库，由扩展的 test / test:typecheck 执行；主应用测试不得静态导入未追踪的 `extensions/` 源码或构建产物。混合用例拆开：主应用以原生 Artifact 验证领域合同，扩展验证转换结果符合合同。不能用 skip、空声明或 passWithNoTests 掩盖缺失仓库。

当前 checkout 集成测试可复用 `tests/support/extension-vitest-config.ts`，配置显式限定扩展自己的测试路径，并统一宿主根目录、别名、环境。Runtime、Store、Blob 等能力直接使用现有 Workspace 包；Server 内部测试辅助仅作为对应版本的兼容性测试依赖，不承诺公共 SDK。真正多个扩展共同需要的 fixture 再抽小的开发测试包，不整体公开主应用测试树。

扩展 CI 检出指定宿主版本，将自身放在对应 Workspace 路径，安装依赖、构建真实产物并运行自己的测试；主应用的干净检出必须独立通过。STData 已提供该布局及独立 workflow。扩展仓库文件必须单独提交发布，主仓库忽略的本地扩展不会随主应用 push 上传。
