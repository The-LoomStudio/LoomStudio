# Loom Studio 运行日志架构（Operational Logging）

Loom Studio 使用统一的结构化运行日志记录 Server、Client、Transport、Document Store、PromptBuild、Provider Gateway 与 Extension Host 的运行事实。本文描述当前已经由代码和测试证明的日志架构，不包含 Notification、TUI、PromptBuild 专用 Trace、Agent Run Transcript 或尚未实现的实时采集方案。

当前实现对应：

- [`packages/logging`](../../../packages/logging/)；
- [`packages/logging/src/jsonl-reader.ts`](../../../packages/logging/src/jsonl-reader.ts)；
- [`packages/shared/src/resource-reference.ts`](../../../packages/shared/src/resource-reference.ts)；
- [`apps/studio-server/src/main.ts`](../../../apps/studio-server/src/main.ts)；
- [`apps/studio-client/src/main.tsx`](../../../apps/studio-client/src/main.tsx)；
- [`apps/studio-server/src/rpc/handlers/logs-rpc.ts`](../../../apps/studio-server/src/rpc/handlers/logs-rpc.ts)；
- [`apps/studio-client/src/widgets/log-viewer/`](../../../apps/studio-client/src/widgets/log-viewer/)；
- [`tests/unit/logging/`](../../../tests/unit/logging/)；
- [`tests/unit/client/log-viewer.test.ts`](../../../tests/unit/client/log-viewer.test.ts)；
- [`tests/integration/studio-server/logging.test.ts`](../../../tests/integration/studio-server/logging.test.ts)。

## 1. 定位与设计目标

普通字符串日志会把模块身份、事件类型、调用链和业务摘要混在不可查询的文本中。Loom Studio 的 Logger 在记录诞生时绑定稳定来源，使 Viewer、Console 和持久化 Sink 不需要解析 message 文本即可分类。

核心目标：

- 结构化记录，而不是依赖正则解析自有 stdout；
- 模块通过 Child Logger 绑定点分 `namespace`；
- Server 使用有界内存与默认 JSONL 持久化；
- Browser 使用有界内存与选择性 Console；
- 日志调用不等待文件 IO，也不能让 Sink 失败中断业务；
- 普通运行日志默认只包含运行元数据；
- 前后端、Application 和 Extension Host 复用同一记录形状；
- 保持 Log、Diagnostic、Trace、Audit、Event、Notification 和 Metric 的语义边界。

本系统不是集中式运维平台，也不尝试在第一版复制 journald、Loki 或 OpenTelemetry 的完整能力。

## 2. 可观测性语义边界

| 概念 | 当前职责 | 不应退化成 |
|---|---|---|
| Log | 高频运行事实、生命周期和失败摘要 | 领域状态数据库或完整调试快照 |
| Diagnostic | 可行动的异常、配置问题或降级状态 | 任意 INFO 日志 |
| Trace | 一次操作的详细执行过程和因果关系 | 平铺的日志字符串 |
| Audit | 权限、外部副作用和破坏性操作事实 | 普通调试日志 |
| Event | 已发生事实的组件间传播 | 日志订阅协议 |
| User Notification | 用户需要立即看到的短消息 | 所有 warn/error 的自动 Toast |
| Metric | 可聚合的计数和数值 | 从 message 文本反向解析的数据 |

基本规则：

```text
共享传输与展示基础，不共享语义模型。
```

Diagnostic、Trace 和 Audit 可以产生带引用 ID 的摘要 Log，但其权威数据仍保留在各自模型中。PromptBuild 和 Agent Run 的详细内容也不能因为 Viewer 支持展开 JSON 就进入普通日志。

## 3. Package 与依赖边界

日志实现分成两个入口：

```text
@loom-studio/logging
  Browser / Node 通用
  Root Logger
  Child Logger
  Memory Sink
  Console Sink
  LogRecord / LogQuery 类型

@loom-studio/logging/node
  Node 专属
  JSONL File Sink
```

核心入口只依赖 `@loom-studio/shared`，不导入 Node 文件系统 API。Browser 代码不得从 `@loom-studio/logging/node` 导入。

Composition Root 创建 Root Logger 和 Sinks。业务模块只接收 `Logger`，不接收能执行 `flush()` 或 `close()` 的 `RootLogger`。因此模块不能意外关闭全局日志设施，也不需要知道文件路径和持久化策略。

## 4. 正式记录形状

当前公共记录类型为：

```ts
type LogLevel = 'debug' | 'info' | 'warn' | 'error'

type LogError = {
  name?: string
  code?: string
  message: string
  stack?: string
}

type LogRecord = {
  timestamp: string
  level: LogLevel
  service: string
  instanceId: string
  namespace: string
  message: string
  event?: string
  data?: JsonObject
  error?: LogError
  correlationId?: string
  callId?: string
  parentCallId?: string
  extension?: {
    packageId: string
    moduleId?: string
    instanceId?: string
    runtime: 'server' | 'client'
  }
}
```

字段责任：

- `service` 是稳定程序身份，例如 `studio-server` 或 `studio-client`；
- `instanceId` 区分同一 service 的不同启动实例；
- `namespace` 表示 service 内部模块，不同时承担进程身份；
- `message` 是人类无需展开即可理解的单行摘要；
- `event` 是可供机器查询的稳定生命周期名称；
- `data` 保存 JSON-safe 运行元数据；
- `extension` 是 Host 绑定的扩展归属，不从插件 data 或 message 推断；其中 instanceId 为扩展激活实例，与顶层 service instanceId 不同；
- `error` 只在调用点确认错误正文和 stack 可以进入日志时使用；
- correlation 字段关联一次跨模块调用，但不替代 Trace。

`success` 不是日志级别。成功操作使用 `info`，需要时在 `data.outcome` 中表达结果。

## 5. Namespace 与 Child Logger

Root Logger 由 Composition Root 绑定 `service`、`instanceId` 与 Sink 集合：

```ts
const root = createRootLogger({
  service: 'studio-server',
  instanceId: 'server-...',
  sinks,
})
```

模块通过 Child Logger 获得稳定 namespace：

```ts
const logger = root.child('document.store')
logger.info('Document changeset committed', fields)
```

Child Logger 可以继续创建子级：

```text
root.child("data").child("sync")
  -> namespace = "data.sync"
```

`service`、`namespace` 与 `event` 使用小写点分名称，每个 segment 允许数字、连字符和下划线。`instanceId` 必须非空且不含空白字符。

Loom Studio 把日志路径称为 `namespace`，不称为 `scope`。`scope` 已用于 workspace、card、session 等运行隔离语义。

## 6. Message 与结构化事实

日志折叠行必须能直接回答“发生了什么”，不能只显示大量重复的 `RPC call completed` 或 `Prompt build completed`。

当前规则：

```text
message
  面向人类的单行摘要，可重复最有价值的两三个字段。

event + data
  面向机器过滤、聚合和详情查看的权威事实。
```

示例：

```text
application.getPromptResource completed
runtime prompt build completed · 7 messages
example.echo activation completed
```

message 不应复制参数、正文、长 ID 列表或完整 JSON。Viewer 也不能通过解析 message 完成分类和聚合。

`data.detail` 保存安全单行附属摘要；`durationMs` 始终为数值毫秒，Console/Viewer 就近格式化为 ms/s；`usage.inputTokens/outputTokens` 缺失不填零。`readLogPresentation` 是两端共用的通用格式化函数，不推断 Agent 状态。`data.technical = true` 标记普通读取/轮询等技术记录；warn/error 不受默认技术降噪影响。

## 7. 规范化、错误与隐私

Root Logger 在分发前把 `data` 规范化为 JSON-safe 值：

- `Date` 转为 ISO 字符串；
- `bigint` 转为字符串；
- 非有限数字转为 `null`；
- `undefined`、函数和 symbol 从对象字段中省略；
- 循环引用写为 `[Circular]`；
- 无法读取的属性写为 `[Unserializable]`；
- `Error` 可以规范化为 name、code、message 和 stack。

以下敏感键及其连字符、下划线变体会被统一替换为 `[REDACTED]`：

```text
authorization
cookie
password
secret
accessToken
refreshToken
apiKey
```

自动脱敏只是第二道保险：

- 它不扫描 `message` 中的秘密；
- 它不能判断任意插件字段是否包含正文；
- 它不会自动识别角色名、会话标题或 Prompt；
- `error.message` 和 stack 也可能包含用户内容。

第一方运行错误通过 `readLogFailure` 提取已知错误类型、数值 HTTP 状态及本地固定分类，不透传未知错误正文、任意 error code、headers 或 response body。Provider HTTP 适配保留数值 `statusCode`，网络错误保留已知安全类型。未知错误仍只给安全分类及调用阶段，详细正文不属于普通日志。Client Bridge 已有正式稳定 RPC code 继续保留。

普通运行日志因此采用 **metadata-only by default**：

| 数据类别 | 示例 | 默认策略 |
|---|---|---|
| 运行元数据 | ID、type、version、数量、耗时、状态码 | 允许 |
| 私密元数据 | 角色名、预设名、会话标题、文件名 | 不进入普通 Log |
| 私密正文 | 聊天、Prompt、角色正文、ToolResult、Provider payload | 禁止进入普通 Log |
| Secret | API key、Authorization、Cookie、Token、Password | 所有可观测性出口均禁止 |

资源操作优先记录稳定引用。授权 UI 可按需将结构化身份转换为 `loom-resource://entity` 引用，打开时解析名称、头像或目标页面；解析结果不写回 LogRecord、JSONL 或默认诊断报告。实体引用与已有版本/行号正文 URI 分开，不伪造快照定位。会话尚无直达入口，运行引用只打开相应日志筛选，不冒充 Runs Inspector。

## 8. 分发与生命周期

Logger 调用同步创建记录并依次调用每个 Sink 的 `write()`：

```text
module log call
  -> validate
  -> normalize / redact
  -> create immutable record
  -> fan out to sinks
```

业务代码不等待 JSONL 文件 IO。JSONL Sink 的 `write()` 只把单行记录加入内部队列，异步 pump 负责文件写入和 backpressure。

单个 Sink 同步失败不会中断其他 Sink 或业务调用。Root Logger 使用 `onSinkError` 报告失败；未提供 handler 时回退到独立的 `console.error`，避免把 Sink 错误重新写入同一 Logger 形成递归。

`RootLogger.flush()` 与 `close()` 由 Composition Root 管理。`close()` 会先 flush，再关闭 Sinks；关闭后的日志调用被忽略。

## 9. Memory Sink

Memory Sink 是固定容量 Ring Buffer：

- 达到容量后淘汰最旧记录；
- 统计 `size`、`capacity` 和累计 `dropped`；
- 写入和读取时使用结构化克隆，避免消费者修改内部记录；
- `clear()` 清空记录并重置 cursor generation；
- 不在进程启动时把全部历史 JSONL 灌回内存。

分页查询支持：

```text
cursor
limit
levels
namespacePrefix
service
instanceId
since
until
text
event
runId
packageId
moduleId
```

cursor 是不透明值。发生淘汰或 buffer generation 变化时，查询结果通过以下结构明确告知连续性中断：

```ts
type LogGap = {
  reason: 'evicted' | 'reset'
  dropped?: number
}
```

## 10. Node JSONL Sink

Studio Server 默认启用 JSONL 持久化。每行是一条可独立解析的完整 `LogRecord`。

目录由 Studio Server 的 `LoomStudioLocalPaths.logRoot` 注入。正式运行使用操作系统原生日志目录；开发脚本默认将日志收拢到 `.loomstudio-dev/logs/`，持久数据单独位于仓库 `data/`。显式 `LOOM_STUDIO_HOME` 时日志位于其 `logs/` 子目录。Logging Package 不读取环境变量，路径由 Server 注入。

文件名包含：

```text
date-service-instanceId-pid.segment.jsonl
```

当前默认限制：

| 限制 | 默认值 |
|---|---:|
| 单文件大小 | 10 MiB |
| 目录总大小 | 100 MiB |
| 最大保留时间 | 7 天 |
| 等待队列 | 1,000 条 |

日期、service 或 instance 改变时会切换文件；单文件达到上限后递增 segment。打开新文件时会删除过期文件，并在需要时从最旧的非活动 JSONL 开始收缩总空间。

队列达到上限时，新记录被丢弃并计入 `dropped`。发生持久化错误后，Sink 停止继续写入，清空等待队列，并调用 `onError` 或回退到 `stderr`。当前实现尚未把 JSONL Sink 失败自动映射为 Diagnostic。

## 11. Server 与 Browser Composition

### 11.1 Studio Server

Server Composition Root 创建：

```text
Root Logger
  service = studio-server
  instanceId = server-...
  sinks:
    MemorySink(capacity = 5,000)
    JsonlFileSink
    filtered ConsoleSink
```

Root Logger 正常关闭与 Server shutdown 绑定。当前模块 Logger 包括：

| Namespace | 当前内容 |
|---|---|
| `system` | Server 启动、停止和失败 |
| `transport.rpc` | HTTP RPC 完成与失败摘要 |
| `document.store` | 已提交 Changeset 与 mutation 失败摘要 |
| `prompt.build` | Preview/Runtime PromptBuild 生命周期摘要 |
| `runtime.provider` | Provider invoke 生命周期、耗时和 usage 摘要 |
| `runtime.run` | 整轮调用开始、完成、失败、暂停/取消及失败阶段 |
| `runtime.step` | Provider Step 序号、开始/终态、结果处理 |
| `runtime.tool` | 实际 Tool Invocation、结果状态、耗时；不保存参数或 ToolResult |
| `runtime.commit` | Narrative 提交开始、真实提交成功或失败 |
| `extension.loader` | Extension 发现、激活、降级/失败和 dispose |

这些模块不记录 Prompt、请求参数、Document content、Provider response text 或插件异常正文。

Runtime 的 `runtimeLogger` 与原有 PromptBuild `logger` 分别注入。调用开始前生成/继承 runId，贯穿准备、循环和提交；RPC create 成功只表示接受调用，不表示运行完成。Provider 完成不等于 Run 完成，Run completed 必须在请求的 Narrative 提交之后。用户暂停/取消不作为 ERROR；可恢复检查点导致的失败暂停仍以 WARN 保留。

Provider 记录 Step、模型、消息/原生工具数量、交付模式、输出字符数、原生调用数、usage 和耗时；`firstOutputMs` 仅在实际观察到 text/tool-input delta 时产生。整轮摘要记录 Step/Tool 数量，不把最后一次 Provider usage 当作整轮 Token 合计。

HTTP 成功记录不再复制 params 或资源名称，只提取数量、提交引用与明确的 Run 接受/完成摘要。已有历史 JSONL 不会被重写或清理。

### 11.2 Studio Client

Browser Composition Root 创建：

```text
Root Logger
  service = studio-client
  instanceId = client-...
  sinks:
    MemorySink(capacity = 1,000)
    filtered ConsoleSink
```

Client 当前记录：

- 客户端启动和停止；
- root element 缺失；
- Window 未捕获错误和 Promise rejection 的元数据摘要；
- Studio API 与 Renderer API 的 RPC 失败、耗时、failure type 和稳定 error code。
- Client Extension Host 生命周期和扩展通过 `ctx.logger` 写入的运行事件。

Client Transport 日志不复制请求 params 或错误正文。当前 Browser 日志不会上传 Server，也不会写入 JSONL。

### 11.3 扩展日志

SDK 两端使用 Host 注入的 `ctx.logger`；原 `info(message, data)` 等方法不变，结构化事件通过 `logger.child('sync').log('info', 'Sync completed', { event: 'sync.completed', data: { count: 12 } })` 写入，事件加 `extension.` 前缀。Host 固定顶层 extension 身份，插件 data 不能覆盖它。Server/Client Host 自身的生命周期也携带这一归属。

Host 共用现有 Logger/Sink，不劫持 console，不暴露 Root/Sink 控制权。每个 Host Logger 下同一 package 的模块、child 和重复激活共用每分钟 200 条预算；触及限额立即警告，后续窗口写入时汇总 dropped 数。消息截到 2,000 字符；超过 16 KiB 的规范化 data 被省略并记录 originalBytes。限制不是完整审计或同进程沙箱。

`ctx.logs.query` 强制当前 package，拒绝 packageId/service/instanceId 覆盖。Server 可查自身 Memory 和 JSONL；Client 仅查询本浏览器 Memory，返回实际 sources，不暗中调用全局 Server 查询。旧 data.packageId 不具有授权意义。扩展仍不能通过 `ctx.rpc.call('logs.*')` 绕过保留 namespace。

## 12. Console Sink

Console 是即时开发反馈，不是完整日志存储的文本副本。

Server 默认显示：

- 所有 warn/error；
- `system`；
- `runtime.*`；
- `prompt.build`。

Client 默认显示：

- 所有 warn/error；
- `system`。

Document changeset 和普通 RPC 成功仍存在于 Memory/JSONL/Viewer，但默认不占用终端。Console 默认输出摘要、就近耗时及必要 detail/Token，不自动展开 data 和关联 ID；无颜色时也采用紧凑文本。`createConsoleLogSink({ verbose: true })` 可输出完整结构化详情；Server 使用 `LOOM_STUDIO_LOG_DETAILS=1` 开启该模式，颜色依据 TTY。详细模式不改变字段准入或持久化策略。

## 13. 查询 API 与 Viewer

Studio Server 暴露 `logs.list` 与 `logs.history` RPC。前者查询当前 Server Memory，后者查询 Host 注入的 JSONL 目录：

- `limit` 默认为 100，范围 1–500；
- 支持 level、namespace prefix、service、instance、时间、字面关键词、event、runId 和扩展 package/module 精确过滤；
- 拒绝未知参数和调用者文件路径；
- 当前日志支持不透明 cursor 与 gap；
- 成功的 `logs.*` 本身不产生 `transport.rpc` INFO；失败仍记录 Transport ERROR，主动取消历史读取不记业务失败。

历史查询要求 since/until，单次时间范围不超过 31 天，不改变现有七天/容量保留策略。Node Reader 固定文件长度快照，不追入查询开始后的追加或新 segment；按文件确定性顺序扫描，Client 将已加载记录按时间展示，不承诺跨进程全局时间归并 cursor。

分页按约 2 MiB 扫描阈值及条数上限停止，正常行可读至行末；单行超过 256 KiB 跳过并报告，跨页继续丢弃该行尾部。坏行、未完成尾行、文件删除和替换分别报告，其他 IO 失败明确失败。返回 scannedBytes/scannedRecords、issues、hasMore，不把零匹配误当作扫描完成。

目录只读取符合本应用命名的常规文件，打开时拒绝符号链接并校验 inode/size 与记录所属文件。Reader 缓存最多 32 个十分钟查询快照，单快照最多 4,096 个 segment；cursor 绑定查询过滤条件，过期或改变条件时显式要求重新搜索。HTTP 断开经 AbortSignal 取消扫描，浏览器取消会中止请求；没有把整个 JSONL 装入内存。

Studio Client 的 Logs Workspace 可以：

- 手动刷新、分页补读和两秒增量轮询；页面不可见时暂停轮询；
- 当前视图合并 Server 与本浏览器来源，也可分别查看；独立保留两端 cursor、缺口和失败信息；
- 按 level、全文和当前缓冲区中的 runId 过滤，显示/隐藏技术明细；RPC warn/error 默认可见；
- 沿事件流原地展开多条记录，保留来源辨识色；耗时与 Token 紧跟摘要；
- 在详情复制完整记录、二级展开原始 JSON、导出当前筛选结果；
- 扩展管理一键进入同一日志页，URL 使用 logPackage/logRun/logSource 表达筛选；
- 历史模式按范围搜索 JSONL、显式继续下一页，最多展示 5,000 条；修改条件后标明结果仍属于上次查询；
- 复制诊断信息先固定预览，选择最近故障上下文或当前筛选；包含版本、范围、缺口、摘要及白名单关联字段，不带任意 data/正文或解析出的资源名称；最多 200 条、正文约 60,000 字符；
- 检查详情时暂停追随最新，显式返回最新后恢复；记录身份不因分页淘汰或筛选下标改变而错配。

当前 Viewer 没有实时推送、跨来源统一 cursor 或原生诊断助手。当前与历史分开，按运行筛选仍受各自可用范围限制，不承诺完整历史。复制前提示旧日志和扩展消息可能有私密信息；不会自动发给 AI，原始 JSON 下载也不等于隐私安全保证。基础日志不是 Master–Detail Inspector，旧 DEV 样例已清理。

## 14. I18N

原始 Log、Trace、Audit、Error stack 和 JSONL 使用 canonical English，不为每条记录维护翻译 key。这样可以保持：

- namespace、event、code 和搜索结果稳定；
- 与上游错误、文档和 Issue 的词汇一致；
- 插件和外部库错误不被伪装成本地化文本；
- 导出后可以直接交给开发者或 AI 分析。

Observability UI 可以本地化导航、筛选器、字段标签和有限的稳定状态。User Notification 和已知 Diagnostic 摘要可以独立本地化，但不能改变 canonical LogRecord。

## 15. 设计来源与当前取舍

| 来源 | 吸收的原则 | Loom Studio 当前实现 |
|---|---|---|
| Linux Kernel Ring Buffer | 日志有界、不能阻塞主系统 | 固定容量 Memory Sink 与 dropped 统计 |
| systemd-journald | 进程身份与模块身份分离 | Root 绑定 service/instance，Child 绑定 namespace |
| Docker / Kubernetes | Producer、Collector、Storage 分层 | 模块不感知文件路径，Node Sink 独立持久化 |
| OpenTelemetry Logs | Resource、scope、record、trace context 分层 | 保持可映射字段，但不引入 OTel SDK |
| Pino / SLF4J | Child Logger、结构化 metadata、同步调用 | message-first API 与 `child(namespace)` |
| Apple Unified Logging | 隐私优先和集中脱敏 | 统一 normalize/redact，加调用点准入规则 |

当前明确不引入：

- journald 二进制格式；
- Elasticsearch / Loki；
- Kubernetes Sidecar；
- 完整 OpenTelemetry SDK / Exporter；
- 通用 Appender/Sink Registry；
- 日志查询 DSL；
- Event Schema Registry；
- 无限内存日志数组。

## 16. 当前限制与演进边界

以下能力尚未实现，不属于当前 Architecture：

- 独立的全量历史流式导出 API（当前可下载已加载结果）；
- 原生诊断助手的范围授权与只读工具；
- SSE/WebSocket 实时日志流；
- Browser 日志持久化或 Server ingest；
- Extension Logger 的远程采集、批处理和跨端持久化策略；Server / Client Activation Context 已提供受控 `ctx.logger`；
- Notification 与 Sonner 协议；
- 后端 TUI；
- PromptBuild 专用 Trace Envelope；
- Agent Run Transcript/Trace；
- Metric backend；
- OTel exporter。

这些方向继续保留在 [`../../workbench/plans/log-plan/`](../../workbench/plans/log-plan/) 的远期路线图和相关专题 Discussion 中。已完成的历史查询、扩展日志平台与诊断复制实施记录位于归档的 [`../../archive/plans/log-platform-consumption-plan.md`](../../archive/plans/log-platform-consumption-plan.md)。

## 17. 变更纪律

以下变化需要同步更新本文：

- 修改 `LogRecord`、`LogQuery` 或 cursor/gap 语义；
- 修改 Logger/Sink 生命周期或失败策略；
- 修改 JSONL 默认目录、文件命名或保留限制；
- 新增默认 Sink 或远程采集；
- 修改 Server/Client Console 过滤；
- 新增正式 namespace；
- 新增或改变 `logs.list` 当前缓冲、`logs.history` 历史 JSONL 的查询语义；
- Browser 日志开始上传或持久化；
- Extension Logger 的身份、限流、自有查询或远程采集与持久化语义；
- `loom-resource://entity` 或其他日志资源引用的解析和导航语义；
- 诊断报告的字段白名单、复制预算或 AI 外发授权语义。

关键可执行证据：

- [`tests/unit/logging/core.test.ts`](../../../tests/unit/logging/core.test.ts)；
- [`tests/unit/logging/jsonl-reader.test.ts`](../../../tests/unit/logging/jsonl-reader.test.ts)；
- [`tests/unit/logging/jsonl-file-sink.test.ts`](../../../tests/unit/logging/jsonl-file-sink.test.ts)；
- [`tests/unit/studio-server/logs-rpc.test.ts`](../../../tests/unit/studio-server/logs-rpc.test.ts)；
- [`tests/unit/client/studio-api.test.ts`](../../../tests/unit/client/studio-api.test.ts)；
- [`tests/contract/extension-host/logging.test.ts`](../../../tests/contract/extension-host/logging.test.ts)；
- [`tests/unit/client/client-extension-host.test.ts`](../../../tests/unit/client/client-extension-host.test.ts)；
- [`tests/integration/studio-server/logging.test.ts`](../../../tests/integration/studio-server/logging.test.ts)。
