# 后端生命周期与失败恢复对抗性审查

日期：2026-09-22  
状态：Open Issues，待修复  
来源：前五项为同模型子智能体独立只读审查，未继承本轮先前审计结论；主 Agent 后续以真实 SQLite 独立复核 BACKEND-ADV-001，并执行 BACKEND-ADV-006、007 及事件订阅补查。

## 范围与证据边界

覆盖五条链：

1. 服务启动、默认初始化、接收请求与关闭；
2. Card 目录保存、Apply、删除及恢复，Blob/Asset 提交；
3. Provider RPC 引用检查与凭据持久化；
4. Asset HTTP 下载、客户端断开与文件流释放；
5. Kernel 事件订阅异常隔离、注销及 Diagnostics 保留。

排除前端、Agent/CodeActor 执行器。未覆盖完整扩展安装生命周期、全部迁移历史、断电持久性及多进程共享目录竞争。

审查基于包含未提交修改的工作区。前五项最初来自子智能体报告，其中第一项后续由主 Agent 换用真实 SQLite 独立复核，第二项补充 HTTP adapter 暂停点探针；第三至五项未重复独立验证。第六、七项由主 Agent 运行隔离探针。行号为审查时定位，后续修复需重新核对源码。

共 1 项 P1、6 项 P2，其中第 5 项复核已有 FR-012，不重复计为新发现。第 1、2、6、7 项有隔离探针证据，其余为静态调用链判断，不等于完整应用端到端复现。本次未修改实现或真实数据。

## BACKEND-ADV-001：Blob 回滚可能删除其他未提交请求需要的文件

优先级：P1  
证据等级：隔离探针复现；初次使用 metadata 内存替身，后续使用当前 SQLite Data Engine 和 Blob Store 独立复核。

位置：

- `packages/blob-store/src/store.ts:108,171`
- `packages/application-runtime/src/runtime/card-directory-sync.ts:149`

两个请求准备相同 hash 的文件，均尚未登记 metadata。请求 A 失败后，`discardPreparedWrite()` 查不到已提交引用便删除文件；请求 B 随后通过 `participateWrite()` 登记 metadata，却不重新检查或写入文件，最终提交一个无法读取的 Blob。

不同 Card 的 Apply 独立互斥；多附件准备过程中，一个请求后续校验失败并清理，另一个请求仍可处于准备阶段。单次 prepare/discard 的 `writeQueue` 不覆盖 prepared 句柄从准备到提交的整个寿命，SQLite 唯一约束也不能保护文件。

子智能体初次在临时目录执行 Blob Store 源码，以 metadata 内存替身得到 `metadataRows=1` 和 `blob.bytes_missing`。

2026-09-22 主 Agent 独立补强：直接导入当前 Data Engine 与 Blob Store 源码，在临时目录创建真实 SQLite 和 Blob 文件；按 prepare A → prepare B（相同字节）→ discard A → 在 SQLite transaction 中 participate B 的顺序执行。断言事务成功、metadata 存在，但读取缺少字节：

```json
{"realSqlite":true,"metadataRows":1,"commitReturnedSuccess":true,"readError":"blob.bytes_missing"}
```

该探针退出码为 0，结束时关闭 Engine 并删除临时目录。它验证真实 Store/SQLite 在受控交错下的结果，不是完整 Card Apply 或并行 HTTP 请求复现；没有触碰真实工作区。未保留临时探针文件。

最小修复方向：失败回滚不直接删除已经 finalize 的共享 hash 文件；孤儿文件清理必须考虑完整引用与在途准备状态，不能把同一误删窗口移到清理流程。

关闭条件：

- 两个同 hash prepared 写入中，一方失败不会破坏另一方提交；
- 定向并发回归验证提交 metadata 对应文件仍可读；
- 明确孤儿文件处理边界，不以静默丢文件换取即时清理。

## BACKEND-ADV-002：关闭连接不等于等待在途业务完成

优先级：P2  
证据等级：静态调用链及当前 HTTP adapter、真实内存 SQLite 的暂停点探针；未执行完整 Studio Server 停机。

位置：

- `apps/studio-server/src/main.ts:666`
- `apps/studio-server/src/http/http-server.ts:501`

导入、目录操作或凭据修改正在等待文件/外部后端 I/O 时，关闭流程可通过 `closeAllConnections()` 断开响应并继续关闭 Engine，而请求异步函数仍可能继续运行。其后续数据库操作会遇到 `data.engine_closed`，已完成的跨资源步骤也不会因为断开连接自动撤销。

反证核查：Engine close 会等待已进入 FIFO 的操作，但不包含仍在外部 I/O 中、尚未入队的业务；`kernel.stop()` 没有持有这些 HTTP 请求的 Promise。

2026-09-22 后续复核发现 HTTP RPC adapter 已新增 AbortSignal。不能继续将当前实现描述为没有请求取消机制；业务是否观察该信号、是否完成清理，仍与 HTTP 连接关闭是不同条件。

主 Agent 使用当前 createStudioHttpServer、内存 SQLite Engine、真实 loopback 随机端口 HTTP 请求及暂停中的替身 RPC handler 验证：handler 进入暂停点后，按组合根的 close/closeAllConnections 顺序关闭 HTTP，等待关闭完成，再关闭 Engine；随后释放暂停点，handler 的 Engine read 得到 `data.engine_closed`。探针断言通过，退出码为 0，HTTP 连接与 Engine 已清理，无真实文件数据操作。

该结果证明连接关闭回调不等待未完成 handler，不证明整个 Kernel.stop 路径或任一真实业务均缺少协作取消。替身 handler 有意不观察取消信号；当次采样时 signal.aborted 仍为 false，此采样不能推导后续 close 事件永远不会触发取消。关闭正确性不能依赖把“连接已关”当作“业务已结束”。

最小修复方向：停止接收请求后，等待已接纳业务完成或完成可恢复取消，再关闭依赖。长连接关闭与业务执行完成需要分别处理。

关闭条件：用可控 I/O 暂停点验证关闭期间的请求不会访问已关闭依赖，且失败后的文件/凭据状态有明确恢复结果。

## BACKEND-ADV-003：凭据写入前缺少可恢复的持久化意图

优先级：P2  
证据等级：静态崩溃窗口分析，未操作真实凭据后端。

位置：`packages/secret-store/src/store.ts:69,94`。

创建或替换凭据时，外部 backend 写入成功与 SQLite metadata 提交之间存在进程退出窗口。新 `backendKey` 此时仅在内存中；重启后 metadata 和 cleanup 表都没有它，应用无法发现并删除该孤儿凭据。

反证核查：catch 补偿只能处理进程仍在运行的异常；替换事务记录的是旧 key 的清理，新 key 在外部写入前没有持久化意图。`SecretBackend` 也未提供枚举能力。

最小修复方向：外部写入前持久化不含明文的待处理 key；成功提交时转换状态，启动恢复时处理未完成记录。具体事务顺序需在实施前明确。

关闭条件：通过替身后端与重开数据库验证每个中断点均可追踪，既不泄漏新 key，也不误删仍有效的旧凭据。

## BACKEND-ADV-004：凭据清理队列未接入生产消费路径

优先级：P2  
证据等级：源码调用点检索。

位置：

- `packages/secret-store/src/store.ts:149,172`
- `packages/application-runtime/src/runtime/providers-runtime.ts:151`

外部凭据删除失败后，旧 key 进入 cleanup 队列。但应用启动和正常运行没有调用现有重试入口，后端恢复或应用重启也不会自动处理积压；替换 RPC 还未向上保留 `cleanupPending`。

反证核查：子智能体检索 `apps/`、`packages/`、`tests/`，重试入口实际调用仅在单元测试。测试手动 drain 不能证明生产恢复已接线。

主 Agent 后续核对当前组合根：`apps/studio-server/src/main.ts` 创建 `SecretStore` 后仅将其注入 AI Gateway/Profiled Gateway 与 Application Runtime；启动路径没有调用 `retryPendingCleanup`。正常 `StudioServer.close()` 只处理 HTTP、media watcher、Kernel 和共享 Data Engine，也没有在 Engine 关闭前 drain cleanup。`providers-runtime.ts` 的删除路径保留单次 `cleanupPending`，替换路径只返回 configured/updatedAt，未保留该标记；两者都没有注册队列消费者。该调用点核对强化了“没有生产消费路径”的结论，但没有模拟真实 Keyring 删除失败。

最小修复方向：在适当服务生命周期接入已有重试入口，保留清理未完成的可见状态，不另建通用任务框架。

关闭条件：模拟删除失败后恢复后端，验证生产生命周期能够消费积压；持续失败可诊断，不报告已经彻底清理。

## BACKEND-ADV-005：Provider 引用检查与删除存在并发窗口

优先级：P2  
证据等级：静态交错分析。  
去重：已有 [全仓审查 FR-012](./full-repo-code-review-2026-08-27.md)，本项是当前源码的独立复核，修复结果应同步原记录。

位置：`packages/application-runtime/src/runtime/providers-runtime.ts:184,214`。

删除请求检查确认没有 Capability Profile；另一个创建请求读取尚存在的 Provider；删除随后提交，而创建仍可写入 Capability Profile。返回值转换再次读取 Provider 时失败，但新 Profile 已经提交，后续列表也可能因此失败。

反证核查：RPC 没有业务级串行化；Engine FIFO 只保护各次操作；`expectedVersion` 只保护被删除文档；JSON 内的 Provider ID 没有外键约束。现有顺序引用检查测试不覆盖该交错。

最小修复方向：引用检查与删除、目标存活检查与创建分别纳入共享事务，两个方向遵守同一约束。

关闭条件：受控并发下只能得到合法的创建或删除结果，不得留下引用已删除 Provider 的新 Profile。

## BACKEND-ADV-006：Asset 下载中断后未释放上游文件流

优先级：P2  
证据等级：当前处理函数、真实本地 HTTP 与临时文件流的隔离探针；Asset Store 使用替身。

位置：

- `apps/studio-server/src/http/http-server.ts:392`，`handleAssetRead`；
- `packages/asset-store/src/store.ts:178`，`openMediaAsset`；
- `packages/blob-store/src/store.ts:70`，`open`。

浏览器取消尚未完成的 Asset 下载时，HTTP response 会关闭，但处理函数只把源流错误传给 response，并调用 `stream.pipe(response)`，没有反向销毁源流。实际 Store 返回 `createReadStream`；在尚未读完的情况下，断开后源流停止消费，文件描述符仍然打开。连续取消下载会增加未及时释放的文件资源，不应依赖垃圾回收时机完成清理。

反证核查：正常下载读到 EOF 可以自动关闭；源流错误也有处理。这些路径不覆盖 response 提前关闭，也不覆盖等待 `openMediaAsset` 时客户端已经断开的情况。这里不声称已复现描述符耗尽或测得长期内存增长。

探针通过 TypeScript AST 提取当前 `handleAssetRead`，执行其编译结果；使用临时 8 MiB 文件、真实 `createReadStream` 和绑定 loopback 随机端口的 HTTP Server。客户端收到第一块后断开，等待 response close 后再等待 150 ms，得到：

```json
{"destroyed":false,"closed":false,"fdOpen":true,"bytesRead":196608,"readableEnded":false}
```

断言确认源流未销毁、文件描述符仍打开、未到 EOF；随后显式销毁流、关闭测试 Server、删除临时目录。探针退出码为 0，没有读取真实资产或启动完整 Studio Server。

最小修复方向：明确将 response 提前结束传播到源流；使用现有 Node stream 生命周期能力，同时处理源流取得前连接已经关闭的分支，不另建下载管理器。

关闭条件：定向验证完整下载、中途取消、源流打开期间取消和源流读取失败；各路径都释放文件描述符，取消不导致未处理异常。

## BACKEND-ADV-007：重复订阅故障令运行时 Diagnostics 无上限积累

优先级：P2  
证据等级：当前 Kernel 与 Diagnostics Registry 的内存探针及生产调用点核查。

位置：

- `packages/kernel/src/kernel.ts:23`：每次订阅者失败新增 `event.subscriber_failed`；
- `packages/diagnostics/src/index.ts:45`：Registry 用数组保留全部记录，add 持续追加；
- `packages/kernel/src/handlers.ts:215`：`diagnostics.list` 返回过滤后的全部记录；
- `apps/studio-server/src/main.ts:96`：服务生命周期共用该 Registry。

同一扩展订阅持续抛错时，事件总线正确隔离错误，但每次错误都产生一条新的诊断，连同错误详情保留到进程结束。当前没有数量或字节保留上限，也没有同类错误聚合；生产路径未调用现有 clear。解除故障订阅不会回收已经积累的记录，读取列表还会返回完整匹配集合。

触发不需要无效协议输入：一个运行中的订阅者持续失败、后续正常事件持续发生即可。后果是长会话下诊断内存及列表返回体随失败次数增长；本轮未测内存峰值、延迟或 OOM，不宣称已造成服务崩溃。

探针直接导入当前 Kernel 和 Diagnostics 源码，只构造 Kernel 并使用其 Event Bus，不 start Kernel，也不提供或调用其他服务。注册一个同步抛错的订阅者，发布 1000 次 `extensions.changed`：

```json
{"emissions":1000,"retainedDiagnostics":1000,"retainedAfterUnsubscribe":1000,"codes":["event.subscriber_failed"]}
```

断言 1000 条记录拥有不同 ID，注销后仍保留；最后显式 clear 测试 Registry。退出码为 0，没有服务启动、数据库或网络操作。这证明当前追加与保留行为，没有模拟真实 Extension Host 的完整卸载。

反证核查：Registry 提供 clear，但未在 `apps/`、`packages/` 的生产调用路径找到消费；错误被隔离并不意味着错误记录有界；只在查询时过滤也不释放存量记录。完整日志归 Logging，本包正式说明的职责是当前诊断状态，不需要无限复制故障历史。

最小方向：明确运行时诊断的有界保留语义，兼顾重复故障计数与最近上下文；丢弃或聚合规则应可解释。不能仅增加分页而保留无限内存，也不必引入新的后台任务框架。

关闭条件：持续同类失败时 Registry 的保留量有可验证上限，仍能看到最近故障及重复情况；不同来源诊断不会被单个高频故障完全淹没，列表返回预算与保留策略一致。

## 审查实验记录

提示词采用“熟悉 Linux 用户态服务、SQLite 与开源维护的挑剔维护者”情景，要求追查完整生命周期、实际失败后果和最小可删除设计，而不是按角色头衔或问题数量输出。

明确要求每项发现列出可达触发条件、源码定位和反证；不得因怀疑 AI 生成就预设代码有错，不以文件长度、命名偏好或抽象风格替代缺陷证据。

子智能体排除的典型候选：

- SQLite 普通读写并非无序；
- Card 删除已有全局提交失效检测和共享事务；
- 目录删除提交后的清理失败不会反向恢复已删除 Card；
- 默认内容初始化识别已有及 tombstone 资源，不是每次启动覆盖用户内容。

验证账目：运行临时 Blob、Asset 下载取消、Kernel 事件订阅生命周期和 Diagnostics 保留探针；后续定向运行 Data Engine 的三项事务通知测试，详见补查记录。Asset 探针使用真实本地 HTTP 连接，不是完整应用服务；事件与诊断探针仅在内存运行。未运行真实数据迁移、真实密钥后端或全仓检查。未做提示词对照实验，不能据此证明角色设定优于普通审查。

## 2026-09-22 补查：Kernel 事件订阅生命周期

本次补查没有新增确认缺陷。依据 `docs/architecture/kernel/README.md` 的 Event Bus 契约，直接导入当前 `packages/kernel/src/events.ts` 执行内存探针，覆盖：

- 同步抛错和异步 rejection 均传入 `onSubscriberError`，不阻断后续健康订阅者；
- 同一订阅句柄连续 dispose 两次，随后 emit 不再调用该订阅者；
- 删除事件定义后重新注册同名定义，再释放旧定义句柄，不会删除新定义。

探针断言通过，退出码为 0；结果：

```json
{"syncAndAsyncFailuresReported":["sync failure","async failure"],"healthySubscriberDeliveries":2,"repeatUnsubscribeSafe":true,"oldDefinitionHandlePreservesReplacement":true}
```

以上只证明这几项 Event Bus 原语的生命周期行为，不代表全部 Kernel 或 Extension Host 已通过审计。未验证错误报告器自身抛错、订阅者修改共享事件对象、真实扩展卸载交错和生产 Diagnostics 接线；不将尚未完成调用链或影响验证的疑点登记成缺陷。

本探针没有启动服务、访问数据库、修改真实数据或运行完整测试套件。没有为了增加发现数量重复登记已有扩展清理问题。

## 2026-09-22 补查：Data Engine 提交后通知

核对 `packages/data-engine/README.md`、`src/sqlite.ts` 和 `src/commit.ts`。同步 observer 在 COMMIT 后调用，每个 observer 得到 structuredClone 的 Commit Fact，其同步异常在通知器内被隔离。

定向运行：

```bash
pnpm exec vitest run tests/unit/data-engine/sqlite-data-engine.test.ts -t 'commits one journal|rolls back failed|isolates observer'
```

结果为 1 个文件通过、3 项通过、4 项跳过，退出码为 0。已读断言确认这三项分别覆盖：

- 成功事务产生一条 Changeset 并通知一次，operation journal 不含测试正文；
- 失败和未记录 operation 的事务回滚测试表写入，不产生 Changeset 或通知；
- 同步 observer 抛错后事务仍成功、Changeset 保留、另一个订阅者仍被调用。

本轮没有新增确认缺陷。验证仅覆盖上述同步 observer 与测试数据库行为，不证明异步回调拒绝、进程崩溃、磁盘错误或所有领域 Store 的提交后行为。未执行的四项测试不计入通过范围；没有修改实现或真实工作区数据。

后续核对生产 `subscribeCommits` 调用点：Kernel 同步投影事件，Card Runtime/目录同步链同步标记 stale，Document Store 同步转换并转发通知；Logging 和 data-commit adapter 转发订阅注册。当前检索未找到返回 Promise 的生产订阅回调，因此不将异步 rejection 隔离不足登记为已触发的生产缺陷。这不意味着 TypeScript 的 void 回调契约能够禁止传入 async 函数。

另外直接导入当前 `createDataCommitNotifier` 运行 Commit Fact 隔离探针：第一个 observer 修改 actor.id、operation.entityId 并追加 operation，第二个 observer 和原始 fact 均保持原值。断言通过、退出码为 0，无数据库或网络操作：

```json
{"observerMutationIsolated":true,"originalFactUnchanged":true}
```

此证据仅适用于 Data Commit notifier 的逐订阅者 clone，不可推广为 Kernel Event Bus 或其他广播 API 也隔离对象修改。

## 2026-09-22 补查：Document Store 的 Engine 所有权

本次没有新增确认缺陷。当前 `createSqliteDocumentStore` 以是否传入 `filename` 区分 Engine 所有权：共享 `engine` 的 Store.close 返回已完成 Promise，不关闭组合根持有的 Engine；独立 filename Store 才负责其内部 Engine。创建 Schema 失败时，独立 Engine 也进入异步关闭路径。

定向运行：

```bash
pnpm exec vitest run tests/unit/document-store/sqlite-store.test.ts -t 'shared|close|drain'
```

结果为 1 个文件通过、2 项通过、11 项跳过，退出码为 0。覆盖范围包含共享 Engine Store 关闭不误伤 Engine，以及独立 Store 的关闭/重复关闭和在途操作排空行为。没有运行完整 Document Store 测试，也没有访问真实开发数据目录。

静态核对还确认 Studio Server 在自建 Document Store 初始化失败时关闭共享 Data Engine，并在正常关闭时由组合根统一关闭 Engine；不能据此替代进程崩溃或文件系统错误测试。本轮没有修改实现。

## 2026-09-22 结构精简候选：重复的空编译函数

此项是遗留代码清理候选，不计入前述确认缺陷数量，也不声称当前 PromptBuild 会返回空消息。

`packages/application-runtime/src/prompt/prompt-builder.ts:80` 导出一个无参数的 compilePromptDataModel，固定返回空 messages 和空 editorProjection。同名的实际编译器位于 `prompt/prompt-build-pipeline.ts:27`。

当前对 `apps/`、`packages/`、`official/`、`scripts/`、`tests/` 的源码检索显示，实际调用者和编译测试都从 pipeline 文件导入函数。`src/index.ts:168` 起仅从 prompt-builder 导出类型，package.json 也只有根入口 export；没有证据表明该空函数属于当前包公共 API 或被生产链调用。

最小清理建议：在确认并行开发未引入新调用者后，只删除没有调用者的空函数，保留现有类型与真实编译器。没有必要为三行遗留代码引入新的 façade、兼容入口，或连带重命名全部类型文件。

本次仅做源码与导出面核对，没有删除实现、改动 Agent 执行器或运行无关测试。后续实施前应重新确认调用点；未引用不等于已经完成删除。
