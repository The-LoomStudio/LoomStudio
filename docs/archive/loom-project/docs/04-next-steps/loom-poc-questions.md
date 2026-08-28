# Loom Regression Test Seeds (Post-PoC)

> 所有问题都**没有**期望在 PoC 阶段解决；这是给正式版的回归测试种子输入。

| ID | 领域 | 题目 | Owner | 是否已有测试覆盖 |
|---|---|---|---|---|
| **C.1 Core 层** |
| Q1 | Core | **Pass.version 的语义**：semver？字符串相等？版本递增？(影响缓存/重放) | loom-core | 否 |
| Q2 | Core | **`reads/writes` 是死字段还是策略字段？** | loom-core | 否 |
| Q3 | Core | **Pass 抛错时 partial mutation 的语义**：现在是保留，是否该回滚？ | loom-core | 否 |
| Q4 | Core | **resolve barrier "最多一个" 是真的吗？**：流式响应合并场景 | loom-core | 否 |
| Q5 | Core | **Pass 是不是真的纯函数**：Source Pass 读取 FS/DB 破坏纯度 | loom-core | 否 |
| **C.2 Studio 层** |
| Q6 | Studio | **trace 里的 Pass 与 invocation 的是同一个实例吗？** | loom-studio | 否 |
| Q7 | Studio | **Extension 卸载时正在跑的 invocation 怎么办？** | loom-studio | 否 |
| Q8 | Studio | **多 client 同时写 docStore 同一 path 的并发隔离** | loom-studio | 否 |
| Q9 | Studio | **rpc 调用计入 trace 吗？** | loom-studio | 是 (t2i-test) |
| Q10 | Studio | **`system.introspect` 是否泄露其它栈的 Pass？** | loom-studio | 否 (目前全漏) |
| **C.3 跨层** |
| Q11 | 跨界 | **`@loom/st` 的 Pass 一旦进 extension，能不能直接 `import 'fs'`？** | loom-st / core | 否 |
| Q12 | 跨界 | **Concept Stack 的"私有词汇"在 trace 里如何脱敏？** | loom-studio | 否 |
| Q13 | 跨界 | **Pass 跨栈复用的命名空间约定够不够？** (rogue test证明不够) | loom-studio | 是 (rogue test) |
| Q14 | 跨界 | **Extension 的 `engines.loom` 语义是 semver 还是 capability set？** | loom-studio | 否 |
| Q15 | 跨界 | **`@loom/st` 升级 → extension 重发 → kernel 兼容旧 trace 吗？** | loom-studio | 否 |

---

## 边界条件表驱动测试种子 (Boundary Cases)

### D. 交互模式场景
- **D.1 单 client × 单 stack**: 顺序 invoke, compose 后 splice 再 invoke [已覆盖]
- **D.2 单 client × 多 stack**: 持有多个栈的 session，共享 Pass 时的归属。
- **D.3 多 client × 单 stack**: 同时 invoke 的交错 trace 重放；同时写 docStore。
- **D.4 多 client × 多 stack**: Introspect 隔离性。
- **D.5 时间维度**: Extension 热重载 / Kernel 重启数据恢复 [已覆盖(Keystone)] / Trace 升级兼容。
- **D.6 失败模式**:
  - Pass 同步/异步报错 [部分覆盖(Convergence)]
  - Pass 死循环
  - 返回不合法 Fragments
  - SQLite 盘满写入失败

### E. 极值状态 (Minimum Observable Boundaries)
- **E.1 Fragment 形态**: `[]`, 空 id/content, id 特殊字符, id 重复, content lazy 报错, content lazy 嵌套, meta JSON 不可序列化对象。
- **E.2 Pass 形态**: 同步返回 `undefined`, 返回原数组引用, version 异常, read/write 乱声明。
- **E.3 Pipeline 形态**: 同一 Pass 两次, 顺序导致 capability 断裂 [已覆盖(Convergence证实无能力链)], 无 Source 直接 Compile, 长度 10000。
- **E.4 Mutation / Trace**: `snapshot: off` 下的隐式修改, 1MB 超大 content, Pass 内部改写 `fragments[i].id`, 并发写 Trace。
- **E.5 Studio 多体**: 1 Client + 100 Stack, 100 Client + 1 Stack, Extension manifest 孤儿, 重名 Pass。
