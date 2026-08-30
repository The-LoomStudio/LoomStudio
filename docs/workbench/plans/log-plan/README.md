# Loom Studio 可观测性后续计划

> **状态**：Active Workbench Plan
>
> **当前正式架构**：[`../../../architecture/platform/logging.md`](../../../architecture/platform/logging.md)
>
> **范围**：只记录统一日志底座完成后的未实现工作，包括历史查询、实时交付、Client 持久化、Extension Logger、Viewer 增强、Notification 与后端 TUI。

---

## 1. 当前基线

系统结构化日志底座已经晋升为正式 Architecture。当前已经实现：

- `@loom-studio/logging` Browser/Node 通用核心；
- `@loom-studio/logging/node` JSONL Sink；
- Root/Child Logger 与点分 namespace；
- 有界 Memory Ring Buffer、cursor 与 gap；
- 选择性 Console Sink；
- Server 默认 JSONL 持久化；
- 实验性 `logs.list` Memory 查询；
- Studio Client 的 Server/Client Logs Workspace；
- Server 与 Browser Transport 失败日志；
- `system`、`document.store`、`prompt.build`、`runtime.provider`、`extension.loader` 等当前模块接入；
- metadata-only、canonical English 和敏感键脱敏边界。

这些事实不在本计划中复制第二份定义。记录形状、默认容量、JSONL 限制、Console 过滤和当前 namespace 以正式架构与代码为准。

## 2. 继续保持的语义边界

后续功能不得破坏以下原则：

| 概念 | 权威职责 |
|---|---|
| Log | 运行事实和生命周期摘要 |
| Diagnostic | 可行动异常与降级状态 |
| Trace | 一次操作的详细执行过程 |
| Audit | 权限与外部副作用事实 |
| Event | 已发生事实的组件间传播 |
| User Notification | 用户应立即看到的短消息 |
| Metric | 可聚合数值 |

共享 Viewer、Transport 或关联 ID 不代表共享语义模型。Notification 不能变成日志级别，PromptBuild/Agent Trace 也不能退化为普通 JSONL 文本流。

## 3. Workstream A：历史日志与实时交付

### 3.1 JSONL 历史查询

当前 `logs.list` 只查询 Server Memory Sink。未来历史查询需要独立解决：

- 文件发现和按日期/instance 查询；
- 不一次性把完整 JSONL 读入内存；
- cursor 如何跨文件和轮转 segment；
- 文件被保留策略清理后的 gap；
- Memory 最新记录与 JSONL 历史记录的衔接；
- 导出范围、隐私提示和文件格式；
- 多进程日志是否只聚合索引，不共写单个文件。

第一版不建立日志查询 DSL。RPC 继续使用 level、namespace、service、instance、时间和 cursor 等明确字段。

### 3.2 实时日志流

当前 Viewer 通过手动刷新读取 Server 日志。实时交付尚未决定采用 SSE、WebSocket 还是未来统一 Transport stream。

需要先确认：

- reconnect cursor；
- Ring Buffer 淘汰期间的 gap；
- 慢消费者和浏览器后台标签页；
- 是否只发送符合订阅过滤器的新记录；
- Viewer 暂停滚动是否等于暂停接收；
- stream 本身的错误如何避免产生自观察风暴。

历史查询和实时流必须使用同一 `LogRecord`，但不要求使用同一个内部读取实现。

## 4. Workstream B：Client 与 Extension 日志

### 4.1 Client 日志持久化

Browser 当前只有 1,000 条有界 Memory Sink。候选路径：

```text
Client Root Logger
  -> local Memory / Console
  -> optional Host-owned batch uploader
  -> authenticated Server ingest
  -> Server-side validation and JSONL
```

不允许每条日志单独调用公共 `logs.add`：

- Server 断开时仍必须能记录 Transport 失败；
- 插件不能伪造 `studio-server/system` 身份；
- 上传需要批处理、限流和大小限制；
- Server 必须重写 service、instance、origin 与 extension identity；
- Client 日志是否默认持久化仍需产品决策。

如果未来提供 ingest，它是 Host/Transport 基础设施，不是任意记录插入权威 Server 日志流的后门。

### 4.2 Extension Logger

当前 `extension.loader` 只记录 Host 自身的 Extension 生命周期。Extension 作者尚未获得正式 Logger capability。

候选方向：

```text
Server Extension
  -> host/ctx.logger
  -> studio-server Root Logger
  -> Memory / JSONL / selective Console

Client Extension
  -> host/ctx.logger
  -> studio-client Root Logger
  -> Memory / selective Console
  -> optional Host-owned batch ingest
```

Host Logger 必须自动绑定 extension identity 和 namespace，不能把内部 Root Logger、Sink、service 或 instance 控制权交给插件。详细设计保留在 [`../../../archive/discussion/extensions/studio-extension-host-capabilities-v0.md`](../../../archive/discussion/extensions/studio-extension-host-capabilities-v0.md)。

## 5. Workstream C：Viewer 增强

当前 Logs Workspace 支持来源切换、手动刷新、level/namespace 过滤和结构化详情。后续候选能力：

- 按 `namespace.split('.')` 构造 Tree View / Accordion；
- 节点展示总数、warn 和 error 数量；
- correlationId/callId 快捷过滤；
- 实时流与暂停滚动；
- JSONL 历史分页；
- 大量记录的窗口化；
- 复制、导出和关联跳转；
- Logs、Diagnostics、Trace 与 Audit 的独立标签。

Viewer 不解析 message 完成分类。`event + data` 仍是机器查询的权威事实。

### 5.1 权限感知的资源引用增强

普通日志继续只保存 ID、type、version 和 operation。Viewer 未来可以按需把资源引用解释为名称、头像、链接或详情浮层：

```text
LogRecord resource reference
  -> permission-aware resolve on hover / focus / click
  -> temporary display metadata
```

约束：

- 不修改 canonical LogRecord；
- 不回写 JSONL 或导出；
- 只有当前权限允许时才显示私密元数据；
- 优先按记录中的 document version 解析；
- 不为每行自动产生 N+1 请求；
- hover 信息必须同时支持 focus 或 click；
- 解析失败时退回资源类型和短 ID；
- 在出现真实高频需求前不建设通用 Resource Resolver Registry。

## 6. Workstream D：User Notification

Sonner 可以作为 Studio Client 的 Toast renderer，但不能成为 Notification 协议或日志 Sink。

候选最小语义：

```text
kind: success | info | warning | error
title / message
source
target client / workspace / session
dedupe key
optional action
```

规则：

- 普通 Log 不自动产生 Notification；
- 用户主动操作成功时由业务显式请求；
- 表单错误优先在触发位置附近展示；
- 后台失败、连接中断、Extension degraded 适合通知；
- Diagnostic 映射必须经过用户相关性、去重和冷却；
- Toast 不承载唯一恢复入口、长文本或完整排障内容；
- 插件不需要先写 Log 才能请求通知。

Client Extension 候选入口属于受控 Client Host，例如 `host.ui.notify(...)`。Server Extension 通知 Client 需要先建立带 target、权限和频率限制的 Server-to-Client delivery。

## 7. Workstream E：后端 TUI

TUI 是可选开发/运维客户端和启动器，不是 Studio Server 的强制运行入口。

```text
Headless Studio Server
  -> structured logs / metrics / control surface
  -> optional Studio TUI
```

第一阶段只考虑高价值后端视角：

- Server PID、端口、uptime；
- namespace/level 日志过滤；
- 内存、RPC 数量和活动连接；
- Provider 延迟、Token 摘要和关联 ID；
- 暂停滚动、复制记录和退出；
- 非 TTY/CI 回退到普通文本或 JSON。

在真实多进程需求出现前不实施：

- 通用子进程自动重启；
- 默认 SIGKILL 控制；
- TUI 自重启 Shell 循环；
- 虚构的 Redis、向量数据库或 Agent Worker 面板；
- 完整 worker pool 管理。

Ink 仍只是候选技术。确认 M0 交互范围前不增加依赖。

## 8. 专题可观测性计划

以下内容仍属于 Application 专用设计，不能并入普通 Log Architecture：

- [PromptBuild 可观测性计划](prompt-build-observability.md)；
- [Agent Run 可观测性计划](agent-run-observability.md)。

PromptBuild 生命周期摘要已经进入 `prompt.build`，但完整 Trace Envelope、Build Inspector 和内容保存策略仍未完成。

Provider 生命周期摘要已经进入 `runtime.provider`，但 Agent Run、Step、Tool、Commit、Transcript 和专业 Trace 继续延后到 Agent 基建稳定后讨论。

## 9. 建议顺序

```text
1. 观察当前 Logs Workspace 和模块日志的实际价值
2. 稳定 Extension Host Capability / Auth boundary
3. 为 Server Extension 暴露受控 Logger
4. 建立 Client Extension Host 后复用同形 Logger
5. 根据真实需求选择历史 JSONL 查询或实时流的先后顺序
6. 再实现 Notification
7. 多进程需求出现后再启动 TUI M0
8. PromptBuild / Agent Run 按各自专题独立攻坚
```

## 10. 当前非目标

- 不引入 Elasticsearch、Loki 或完整 OTel；
- 不建立通用 Sink Plugin Registry；
- 不让插件创建自己的官方 Root Logger；
- 不把 Client API 失败逐条同步写成 Server 权威日志；
- 不保存完整 Prompt、聊天、Provider payload 或 ToolResult；
- 不把 Notification、Diagnostic、Trace 或 Audit 合并进 Log；
- 不为尚不存在的进程和指标提前建设 Dashboard。

## 11. 待确认事项

1. 历史 JSONL 查询和实时流哪一个优先；
2. Client 日志是否默认上传，还是只在显式诊断模式上传；
3. Client ingest 的 batch、限流和保留策略；
4. Extension Logger 的 event prefix 与 child namespace 规则；
5. Server Extension RPC handler 日志如何继承 correlation；
6. Viewer namespace tree 是否先基于当前 Memory 数据实现；
7. Notification target、权限、去重和持久化边界；
8. TUI 是否先只连接现有 Server，还是同时作为启动器。
