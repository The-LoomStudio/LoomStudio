# Loom Studio 运行日志架构（Operational Logging）

Loom Studio 使用统一的结构化运行日志记录 Server、Client、Transport、Document Store、PromptBuild、Provider Gateway 与 Extension Host 的运行事实。本文描述当前已经由代码和测试证明的日志架构，不包含 Notification、TUI、PromptBuild 专用 Trace、Agent Run Transcript 或尚未实现的实时采集方案。

当前实现对应：

- [`packages/logging`](../../../packages/logging/)；
- [`apps/studio-server/src/main.ts`](../../../apps/studio-server/src/main.ts)；
- [`apps/studio-client/src/main.tsx`](../../../apps/studio-client/src/main.tsx)；
- [`apps/studio-server/src/logs-rpc.ts`](../../../apps/studio-server/src/logs-rpc.ts)；
- [`apps/studio-client/src/widgets/log-viewer/`](../../../apps/studio-client/src/widgets/log-viewer/)；
- [`tests/unit/logging/`](../../../tests/unit/logging/)；
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
}
```

字段责任：

- `service` 是稳定程序身份，例如 `studio-server` 或 `studio-client`；
- `instanceId` 区分同一 service 的不同启动实例；
- `namespace` 表示 service 内部模块，不同时承担进程身份；
- `message` 是人类无需展开即可理解的单行摘要；
- `event` 是可供机器查询的稳定生命周期名称；
- `data` 保存 JSON-safe 运行元数据；
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
application.getPromptResource completed in 1.37 ms
runtime prompt build completed · 7 messages · 11.08 ms
example.echo activated · active · 3.42 ms
```

message 不应复制参数、正文、长 ID 列表或完整 JSON。Viewer 也不能通过解析 message 完成分类和聚合。

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

普通运行日志因此采用 **metadata-only by default**：

| 数据类别 | 示例 | 默认策略 |
|---|---|---|
| 运行元数据 | ID、type、version、数量、耗时、状态码 | 允许 |
| 私密元数据 | 角色名、预设名、会话标题、文件名 | 不进入普通 Log |
| 私密正文 | 聊天、Prompt、角色正文、ToolResult、Provider payload | 禁止进入普通 Log |
| Secret | API key、Authorization、Cookie、Token、Password | 所有可观测性出口均禁止 |

资源操作优先记录稳定引用。授权 UI 未来可以临时把引用解析为名称、头像或链接，但解析结果不能写回 LogRecord、JSONL 或导出文件。

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

默认目录：

```text
$LOOM_STUDIO_DATA_DIR/logs

未设置时：
~/.loomstudio/logs
```

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
| `extension.loader` | Extension 发现、激活、降级/失败和 dispose |

这些模块不记录 Prompt、请求参数、Document content、Provider response text 或插件异常正文。

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

Client Transport 日志不复制请求 params 或错误正文。当前 Browser 日志不会上传 Server，也不会写入 JSONL。

## 12. Console Sink

Console 是即时开发反馈，不是完整日志存储的文本副本。

Server 默认显示：

- 所有 warn/error；
- `system`；
- `runtime.provider`。

Client 默认显示：

- 所有 warn/error；
- `system`。

Document changeset、PromptBuild 成功和普通 RPC 成功仍存在于 Memory/JSONL/Viewer，但不会持续占用终端或 Browser Console。Console 展示结构化 details，不要求开发者阅读单行 JSON 字符串。

## 13. 查询 API 与 Viewer

Studio Server 暴露实验性 `logs.list` RPC。它只查询当前 Server Memory Sink：

- `limit` 默认为 100，范围 1–500；
- 支持 level、namespace prefix、service、instance 和时间过滤；
- 支持不透明 cursor 与 gap；
- 成功的 `logs.list` 本身不产生 `transport.rpc` INFO，避免 Viewer 刷新制造自观察噪音；
- 失败的 `logs.list` 仍记录 Transport ERROR。

Studio Client 的 Logs Workspace 可以：

- 手动刷新；
- 在 Server 与 Client 来源之间切换；
- 按 level 和 namespace prefix 过滤；
- 展开结构化 data、error 和关联 ID。

当前 Viewer 没有实时订阅、历史 JSONL 查询、namespace Tree/Accordion、资源引用增强或跨来源统一 cursor。

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

- JSONL 历史分页与导出 API；
- SSE/WebSocket 实时日志流；
- Browser 日志持久化或 Server ingest；
- Extension 作者可用的 `ctx.logger` / Host Logger；
- Notification 与 Sonner 协议；
- 后端 TUI；
- PromptBuild 专用 Trace Envelope；
- Agent Run Transcript/Trace；
- Metric backend；
- OTel exporter。

这些方向继续保留在 [`../../workbench/plans/log-plan/`](../../workbench/plans/log-plan/) 和相关专题 Discussion 中。

## 17. 变更纪律

以下变化需要同步更新本文：

- 修改 `LogRecord`、`LogQuery` 或 cursor/gap 语义；
- 修改 Logger/Sink 生命周期或失败策略；
- 修改 JSONL 默认目录、文件命名或保留限制；
- 新增默认 Sink 或远程采集；
- 修改 Server/Client Console 过滤；
- 新增正式 namespace；
- `logs.list` 开始读取历史 JSONL；
- Browser 日志开始上传或持久化；
- Extension Host 正式向作者暴露 Logger capability。

关键可执行证据：

- [`tests/unit/logging/core.test.ts`](../../../tests/unit/logging/core.test.ts)；
- [`tests/unit/logging/jsonl-file-sink.test.ts`](../../../tests/unit/logging/jsonl-file-sink.test.ts)；
- [`tests/unit/studio-server/logs-rpc.test.ts`](../../../tests/unit/studio-server/logs-rpc.test.ts)；
- [`tests/unit/client/studio-api.test.ts`](../../../tests/unit/client/studio-api.test.ts)；
- [`tests/contract/extension-host/logging.test.ts`](../../../tests/contract/extension-host/logging.test.ts)；
- [`tests/integration/studio-server/logging.test.ts`](../../../tests/integration/studio-server/logging.test.ts)。
