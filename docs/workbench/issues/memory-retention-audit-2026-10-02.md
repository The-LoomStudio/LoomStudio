# 内存留存与输入预算专题审查

日期：2026-10-02
状态：审查完成 / 3 项内存预算候选，未实施
基线：当前未提交工作树，沿用[专题计划](../plans/specialized-audits-2026-10-02-plan.md)
非目标：CPU、耗时、FPS、渲染速度、包体积优化及一般正确性 Bug 重审

## 结论

收束为 **3 项具有生产链与有界探针支持的候选**：一个慢连接无界积压路径、一个按数量而非字节淘汰的 Run 缓存、一个缺少批量/在途总文本预算的 Worker 输入边界。

这不是三项已证实现场泄漏或 OOM。**没有测真实回收后存活堆、heap snapshot 或实际峰值**；JSON 字节、队列条数和缓冲字节不等于完整堆内存。优化可能改变重放/恢复/缓存语义，因此不直接清空数组或裁剪草稿。

| 编号 | 性质 | Owner / 释放边界 |
| --- | --- | --- |
| MEM-001 | SSE 慢连接持续积压，无输出字节预算 | 每连接输出缓冲；断连释放订阅和心跳 |
| MEM-002 | Run 重放缓存有数量门槛，单项/总字节无预算 | ApplicationRuntime 对应的 Server RPC Map；数量超限淘汰非 running |
| MEM-003 | Tokenizer 单段/任务数有限，批量与在途总文本缺预算 | 共享 Worker 实际排队输入；任务完成/Worker error 收束 |

## MEM-001 · SSE 输出忽略背压

**路径与调用链**：[http-server.ts](../../../apps/studio-server/src/http/http-server.ts) 的 `handleExtensionEventStream`（329 行）→ `/extensions/events` → [main.ts](../../../apps/studio-server/src/main.ts) 的事件订阅（698 行）→ response.write。事件与 15 秒心跳都不处理 write 返回 false。

**可达条件**：连接保持打开，客户端长期不消费或消费慢于事件生产。当前 owner 为每连接 Node 输出缓冲，没有字节预算；事件生产不会因该连接背压暂停。

**有界探针**：执行当前函数源码，用不消费的 PassThrough 代替 socket，发送 2,000 个约 512 字符的合成事件。

| 时点 | writableLength |
| --- | --- |
| 第 100 个事件 | 61,723 字节 |
| 第 2,000 个事件 | 1,256,023 字节 |

关闭后 `subscriptionDisposed=true`。不是遗忘断连 cleanup 的泄漏；现有 [http-lifecycle.test.ts](../../../tests/unit/studio-server/http-lifecycle.test.ts)（79 行）覆盖异步订阅释放，但没有输出预算验证。

**最小建议**：定义每连接输出预算；超限断连必须配合客户端重连后的状态恢复。不能阻塞全局 EventBus，也不能静默丢弃必要通知。需核对使用该 SSE 的所有消费者，而不只当前列表的 open 刷新。

**关闭条件与风险**：持续背压时每连接保留量受限；断连释放、重连同步、事件完整性约定都可验证。探针没有真实网络 socket，未测现场增长速度或 Server heap；新增断连政策属于行为变化，不在本轮实施。

## MEM-002 · Run 数量限制不是内存字节限制

**路径与调用链**：[agents.ts](../../../apps/studio-server/src/rpc/handlers/application/agents.ts) 的 `startAgentRun`（380 行）→ onEvent 追加 delta/transcript/completed → runtime 对应的 Map；`pruneCompletedRuns`（465 行）仅当数量超过 128 时淘汰非 running。

**留存事实**：终态 Run 没有 TTL/单项/总字节预算；读取到游标尾部不释放。running 不参与淘汰，因此 128 不是所有状态的绝对总数上限。事件、请求及暂停 checkpoint 确有重放/恢复需求，不是所有引用都无用。

**有界探针**：执行实际 RPC handler，模型由合成事件替代。130 次 Run，每次 200 个 delta，全部结束后：

```text
retainedRuns = 128
retainedEvents = 25,856
JSON serialized bytes = 6,741,632
latest Run tail read = 0 events
latest Run replay from start = 202 events
```

数量淘汰有效，不是“所有完成 Run 永久无界增长”。合成 JSON 大小只显示留存载荷规模，不是 JS 对象/Promise/checkpoint 全部堆占用；未证明正常输出会 OOM。

**最小建议**：评估终态重放窗口的 TTL/总字节预算，减少与权威 Transcript 重复的正文持有。保留运行中和暂停恢复需要的内容，不直接 splice 事件数组。

**关闭条件与风险**：大数量/大载荷终态 Run 保留有明确预算；过期游标返回可恢复的明确结果，重放顺序和暂停 checkpoint 不退化。现有 [agent-run-rpc.test.ts](../../../tests/unit/studio-server/agent-run-rpc.test.ts) 保护游标重放而非预算；淘汰策略和恢复合同需要确认。

## MEM-003 · Tokenizer 总输入预算缺口

**路径与调用链**：资源树文本 → `use-resource-token-counts` → [use-token-counts.ts](../../../apps/studio-client/src/shared/tokenizer/use-token-counts.ts)（21 行）→ [client.ts](../../../apps/studio-client/src/shared/tokenizer/client.ts) 的 `countTexts`（7 行）→ Worker postMessage。

现有 [contracts.ts](../../../packages/tokenizer/src/contracts.ts) 限单段 1,000,000 字符、任务队列 32 项，未限每批文本数量/总字符或实际在途总字符。序列化签名、解析后的数组和 Worker 克隆可能重叠持有，实际保留几份/峰值未测。

**有界探针**：执行实际 Client 源码，Worker 用 structuredClone 替身；64 段 × 32,768 ASCII 字符，共 2,097,152 文本字节被接受。取消返回 AbortError，但已投递批次仍由 Worker 替身持有直至处理结束；未运行真实 BPE。

**反证**：结果缓存最多 2,048 项，key 为摘要，merge cache 已禁用。取消不能打断 BPE，保留 pending 槽直到真实任务结束正是在限制积压；[token-worker.test.ts](../../../tests/unit/client/token-worker.test.ts)（30 行）明确验证这一行为。不能把它当泄漏，不能通过取消时立即删槽位来“释放”实际仍排队的任务。

**最小建议**：投递前限制批量/在途总字符，或采用有界分批。预算超过时的可见失败/分批合同需定义，不静默少算文本。

**关闭条件与风险**：批量和实际在途输入有界；取消仍跟踪真实任务，结果顺序、计数及队列失败语义正确。候选是预算缺口，不表示本次 2 MiB 样本已经造成异常；没有堆快照或真实 Worker 内存测量。

## 检查过但未升级为新发现

- **HTTP/Blob/导入**：存在单请求上限；RPC body 为 384 MiB，ZIP 为 128 MiB。PNG 外层预算不同，不能将 ZIP 上限误当整个 PNG 上限。字符串解析、Buffer 合并、解压与 Base64 可重叠持有，单请求预算也不保证进程并发总量。未测并发导入实际峰值，仅列有界高峰观察，不新增泄漏结论。
- **Client 历史**：Narrative 已加载页和当前 Session 完整 Transcript 仍在数据数组中；虚拟 DOM 不释放它们。切换上下文有清理，历史和未保存草稿具有用途。未重复登记 OCT 分页问题，也不以任意截断历史/草稿作为优化方案。
- **显示投影**：已加载 K 条却返回完整历史的接口问题归 [API-001](./client-server-api-audit-2026-10-02.md)，本报告不重复计数。
- **生命周期与缓存**：核对下载 Object URL 回收、iframe 模块 URL/port、Worker error terminate、Extension Host handles 和若干有界缓存，未形成新增确认项。这不是所有第三方扩展无泄漏证明。
- **ESM 与 TraceAudit**：ESM 模块缓存已有历史审查，不重报；TraceAudit 数组缺淘汰，但本轮只确认显式 `loom.run(trace.enabled)` 路径，未证明持续生产规模，未计入三项。

## 验证账目

本轮执行 3 次合成、有界、纯内存探针，分别验证写缓冲增长、Run 保留数量/JSON 载荷、Tokenizer 已接受批量及取消后的真实任务留存。现有测试只阅读，没有运行；未新增测试文件、依赖、build 或全套检查。

主 Agent 核对 SSE write/close、Run onEvent/prune、Tokenizer 单段/队列与 pending 清理逻辑，未重跑可信探针。未启动实际服务器/浏览器，未做真实 socket 背压、长时 Provider stream、真实导入、扩展循环启停或 heap snapshot；没有人工视觉验收。

后续应先决定预算和恢复语义，再做临时样本的真实内存测量。不能把此报告当作“优化无风险”或已证明内存安全。
