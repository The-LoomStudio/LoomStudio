# 测试治理与测试边界 v0

> **状态**：Open Design Method / Test Architecture Guardrails
> **目的**：整理 Loom Studio 从 M0 阶段门控演进到长期产品/平台测试体系的规则，避免测试数量很多但不能真实保护当前代码。
> **适用范围**：`tests/`、packages/apps/extensions 内的测试、CI 默认测试、性能探针、历史 stage 测试、设计探索测试。

---

## 0. 背景

当前测试体系混合了多种历史来源：

```text
M0 stage gate
Kernel MVP acceptance
whitepaper scenario validation
prompt builder design feasibility
application-runtime M0 flow
performance probes
server RPC integration
client helper unit tests
```

这些测试在当时有价值，但长期混在默认 `pnpm test` 里会产生三个问题：

1. 测试很多，但不知道当前关键产品路径是否被保护；
2. 一些测试验证的是历史设计想法，而不是生产代码；
3. 一些断言不是从真实需求或 bug 推出，容易变成“为了过测试而维护测试”。

本文档用于区分哪些测试应进入默认回归，哪些应归档、迁移或改写。

---

## 1. 成功标准

长期测试体系应满足：

1. 默认测试能保护当前核心行为；
2. 测试文件名能说明被测边界；
3. 每个测试都能回答“这个失败代表什么用户/平台风险”；
4. 历史 M0 验收不继续污染当前测试分类；
5. 性能探针不伪装成回归测试；
6. 设计探索代码不伪装成生产代码测试；
7. 新功能能明确知道需要 unit、contract、integration 还是 regression test；
8. CI 失败时，维护者能快速定位责任模块。

---

## 2. 测试分类

推荐目录：

```text
tests/
  unit/
    document-store/
    prompt-builder/
    client/
    shared/

  contract/
    rpc/
    events/
    extension/
    transport/

  integration/
    application-runtime/
    studio-server/
    client-workflows/

  regression/
    known-bugs/

  probes/
    performance/

  archive/
    m0-stage/
    design-spikes/
    whitepaper-scenarios/
```

### 2.1 Unit Tests

验证纯函数、小模块或单 package 行为。

适合：

```text
Document Store version / tombstone / transaction
Prompt Builder sorting / projection
Context Asset tree operations
shared id generation
serializer / parser
```

不适合：

```text
启动完整 server
跨 extension RPC
模拟完整用户工作流
性能测量
```

### 2.2 Contract Tests

验证平台公开契约。

适合：

```text
RPC envelope
system.introspect shape
Extension activation context
Event payload shape
Document Store event semantics
Client Bridge request / response behavior
```

Contract test 应尽量少关心实现细节。

### 2.3 Integration Tests

验证多个模块组合后的真实路径。

适合：

```text
Client Bridge -> HTTP /rpc -> Application Runtime -> Document Store
Extension Host -> Kernel RPC -> Document event
Application Runtime submitTurn -> prompt -> provider -> timeline
Studio Server restart -> SQLite persistence
```

Integration test 应控制数量，覆盖关键路径，不替代所有 unit test。

### 2.4 Regression Tests

只为已发现 bug 或真实风险添加。

每个 regression test 必须说明：

```text
bug / risk:
expected behavior:
failure meaning:
```

禁止把普通新功能测试随便放到 regression。

### 2.5 Probes

性能、容量、实验性测量属于 probes。

特点：

- 可以输出 measurement；
- 可以不设严格阈值；
- 不默认进入 `pnpm test`；
- 需要单独脚本或手动运行。

例如：

```text
JSON round-trip measurement
large docs.list pagination measurement
renderer event latency probe
```

如果没有明确阈值，不应叫 performance regression test。

### 2.6 Archive

历史 M0 stage、白皮书证明、设计探索可以归档。

Archive 中的测试默认不跑。

用途：

- 保留历史设计上下文；
- 帮助未来阅读 M0 是怎么来的；
- 作为迁移新测试的素材。

Archive 不应用来证明当前系统健康。

---

## 3. 默认测试策略

默认 `pnpm test` 应只跑：

```text
unit
contract
integration
regression
```

默认不跑：

```text
probes
archive
design-spikes
historical stage gates
```

推荐脚本：

```json
{
  "test": "vitest run --config vitest.config.ts",
  "test:probes": "vitest run tests/probes/**/*.test.ts",
  "test:archive": "vitest run tests/archive/**/*.test.ts"
}
```

是否真实改脚本，应在测试目录迁移时单独提交。

---

## 4. 什么是有效测试

有效测试必须至少满足三条：

1. 被测对象是生产代码；
2. 断言来自 public contract、用户流程、架构约束或已知 bug；
3. 失败时能指出真实风险；
4. fixture 是为了触发真实行为，而不是为了证明测试作者的设想；
5. 测试名称能解释行为，不只描述实现步骤。

示例：

```text
有效：
  docs.write through Kernel emits docs.changed after commit

无效：
  stage 5 thing works

有效：
  extension activation failure cleans registered RPC handles

无效：
  whitepaper S1 works
```

---

## 5. 生造测试识别

如果一个测试符合以下任一项，应重新审查：

### 5.1 测试自己实现目标系统

典型信号：

```text
测试文件内定义完整领域模型；
测试文件内实现完整 compiler / runtime；
测试只验证这个测试内实现；
生产代码没有被 import。
```

这类测试应迁到：

```text
tests/archive/design-spikes/
```

或转成生产代码的 fixture。

### 5.2 断言和场景没有因果关系

典型信号：

```text
场景叫“客户端面板读取数据”，但断言某个无关 diagnostics code；
场景没有触发错误，却期待错误诊断；
测试名称和 expect 的核心风险不一致。
```

处理方式：

- 删除无关断言；
- 拆成独立 contract / regression test；
- 或补充真实触发条件。

### 5.3 只是证明历史规划

典型信号：

```text
MVP whitepaper scenario
stage-0 / stage-1 / stage-5 acceptance
M0 feasibility
```

处理方式：

- 保留核心行为，重命名并迁到当前分类；
- 历史证明归档；
- 没有当前价值的删除。

### 5.4 没有有效断言

典型信号：

```text
expect(true).toBe(true)
expect(avgMs).toBeGreaterThanOrEqual(0)
只 console.info measurement
只验证数组长度等于循环次数
```

处理方式：

- 删除；
- 移到 probes；
- 加入真实阈值和失败语义。

---

## 6. 现有测试迁移建议

### 6.1 保留并重命名

```text
tests/document-store-sqlite.test.ts
  -> tests/unit/document-store/sqlite-store.test.ts

tests/studio-client-context-assets.test.ts
  -> tests/unit/client/context-assets.test.ts

tests/prompt-builder-compiler.test.ts
  -> tests/unit/prompt-builder/compiler.test.ts

tests/studio-server-application-rpc.test.ts
  -> tests/integration/studio-server/application-rpc.test.ts
```

### 6.2 拆分

```text
tests/application-runtime-m0.test.ts
```

拆成：

```text
tests/integration/application-runtime/card-session.test.ts
tests/integration/application-runtime/turn-flow.test.ts
tests/integration/application-runtime/prompt-preview.test.ts
tests/integration/application-runtime/provider-gateway.test.ts
tests/integration/application-runtime/agent-transcript.test.ts
tests/regression/application-runtime/provider-failure-rollback.test.ts
```

### 6.3 从 stage 迁到 contract

```text
tests/stage-1.test.ts
  -> contract/rpc + unit/document-store + contract/transport

tests/stage-3.test.ts
  -> contract/extension-host

tests/stage-4.test.ts
  -> contract/client-bridge

tests/stage-5.test.ts
  -> integration/capability-platform-smoke.test.ts
```

### 6.4 归档或删除

```text
tests/stage-0.test.ts
  -> delete

tests/prompt-builder-data-model.test.ts
  -> archive/design-spikes/prompt-builder-data-model.test.ts

tests/scenarios/json-communication-performance.test.ts
  -> probes/performance/json-communication.test.ts

tests/scenarios/mvp-whitepaper-scenarios.test.ts
  -> split useful parts, archive the rest
```

---

## 7. 测试命名规则

文件名应表达被测边界：

```text
document-store/sqlite-store.test.ts
extension-host/activation.test.ts
rpc/introspection.test.ts
application-runtime/turn-flow.test.ts
client/context-assets.test.ts
```

测试名应表达行为：

```text
it('emits docs.changed after document commit')
it('cleans extension RPC registrations after activation failure')
it('stores prompt preview and submitted run prompt with the same messages')
```

避免：

```text
it('stage 5 path works')
it('S1')
it('M0 loop')
it('scenario')
```

---

## 8. Fixture 规则

Fixture 必须服务于真实行为。

允许：

```text
最小 extension fixture
fake provider
in-memory transport
temporary SQLite database
small card/session documents
```

谨慎：

```text
大型虚构世界设定
复杂但无复用价值的 prompt tree
测试内完整实现一个模型
```

禁止：

```text
fixture 中隐藏被测行为；
为了让断言成立而创造无业务含义的 diagnostics；
复制生产算法到测试里做镜像判断。
```

如果 fixture 超过 80 行，应考虑：

- 提取为 test helper；
- 缩小场景；
- 或把它移到 archive/design-spikes。

---

## 9. Coverage by Risk

不要追求平均覆盖率，按风险覆盖。

优先保护：

```text
Document revision / tombstone / transaction
RPC envelope / error / introspection
Extension activation / cleanup / ownership
Event emission timing and payload
Application turn flow
Prompt preview and stored run prompt consistency
Provider failure rollback
Client typed API and state hooks after refactor
Context asset tree mutation
```

低优先级：

```text
纯展示组件快照
demo 文案
临时 renderer PoC 样式
历史 M0 stage 名称
无阈值性能测量
```

---

## 10. 新功能测试要求

新增功能时，至少回答：

```text
被测 public contract 是什么？
最小 unit test 是什么？
是否需要 integration test？
是否影响 event / RPC / document type？
是否有失败路径？
是否需要 regression test？
```

示例：

### 新增 RPC

需要：

- contract test：method name、input、output、error；
- introspection test：owner、namespace、schema；
- integration test：如果跨模块。

### 新增 Event

需要：

- event catalog / schema test；
- emission timing test；
- subscriber visibility test；
- no half-commit observation test，如涉及 transaction。

### 新增 Client Hook

需要：

- hook 或 model unit test；
- API client mock；
- 不依赖完整 `useStudioState`；
- event cleanup test，如有 subscription。

### 修复 bug

需要：

- 先写失败的 regression test；
- test name 描述 bug；
- 注明以前为什么会错。

---

## 11. CI 分层

推荐长期分层：

```text
pnpm lint
pnpm test:unit
pnpm test:contract
pnpm test:integration
pnpm build
```

可选：

```text
pnpm test:probes
pnpm test:archive
```

CI 默认不跑 archive / probes，除非手动触发。

---

## 12. Review Checklist

新增或修改测试时检查：

### 归属

- 这是 unit、contract、integration、regression、probe 还是 archive？
- 是否放在正确目录？
- 是否应该进入默认 `pnpm test`？

### 真实性

- 被测对象是否是生产代码？
- 断言是否来自真实 contract / workflow / bug？
- 失败时是否代表真实风险？
- 是否只是证明历史设计想法？

### 可靠性

- 是否依赖时间、随机、顺序或性能波动？
- 是否产生未清理临时文件？
- 是否污染全局状态？
- 是否有稳定 fixture？

### 可维护性

- 测试是否过长？
- fixture 是否过大？
- 是否重复搭 harness？
- 是否应该抽 test helper？

---

## 13. 判断原则

遇到不确定时，优先选择：

```text
当前行为 > 历史阶段
生产代码测试 > 测试内模型测试
真实风险 > 白皮书证明
contract test > implementation trivia
fixture 最小化 > 大型虚构场景
probes 单独跑 > 默认测试假装性能回归
归档历史 > 删除上下文
```

测试的目标不是显得很多，而是让哥哥看到一眼就知道：当前系统最容易坏、最值得保护的地方，都有人守着。
