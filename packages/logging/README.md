# `@loom-studio/logging`

> **状态**：Active Package Guide / Current Source Is Authority

`@loom-studio/logging` 是 Loom Studio 跨端统一的结构化日志底座。它提供层级化 Logger 派生、可插拔 Sink（控制台、内存环形缓冲、Node.js 旋转 JSONL 文件归档）以及结构化查询能力。

## 业务使命与分层架构

在前后端协同与插件化运行时中，散落各处的 `console.log` 会造成日志无法追踪调用链路、无法根据级别过滤、且容易引发内存泄漏或敏感信息打印。
`@loom-studio/logging` 建立结构化观测底座：
- **层级化派生**：通过 `logger.child('rpc')` 派生 namespace；correlationId 等调用关联在每次日志的 fields 中传入；
- **严格日志记录 (`LogRecord`)**：统一定义时间戳（ISO）、日志级别（`debug` / `info` / `warn` / `error`）、服务名、实例 ID 与结构化键值对；
- **环境隔离设计**：
  - `.`（通用入口）：无任何 Node.js 私有依赖，可安全在浏览器 Client 与测试环境中运行；提供 `createConsoleLogSink` 与用于内存检索的 `createMemoryLogSink`；
  - `./node`（Node 专属子入口）：提供基于高吞吐流式队列的 `createJsonlFileSink`，支持按日期/大小自动分卷与过期日志自动清理。

---

## 架构规约与开发红线 (Rules & Boundaries)

1. **全面杜绝裸奔的 `console.log`**：
   - 生产代码（Server 与 Client）**严禁随意插入未经格式化的原生 `console.log`**，必须使用注入的结构化 Logger；
2. **异步队列非阻塞保障**：
   - 文件写操作严禁阻塞当前主事件循环，JSONL 写入必须经由非阻塞内存缓冲队列调度；
3. **环境隔离约束**：
   - 前端 Web Client 只能引用 `@loom-studio/logging` 根入口，**严禁引用 `@loom-studio/logging/node`**（该子入口包含 `node:fs`）。

---

## 公共入口

### 跨端通用入口 (`@loom-studio/logging`)
- `createRootLogger(options)`：创建根日志记录器；
- `createConsoleLogSink(options)`：控制台 Sink 工厂；
- `createMemoryLogSink(options)`：内存环形缓冲 Sink（支持分页查询与断流检测）；
- `readLogFailure(error)`：仅提取已知安全错误分类与数值 HTTP 状态，不复制错误正文；
- `readLogPresentation(record)` / `formatLogDuration(ms)`：跨端安全摘要字段、技术明细分类与耗时显示；
- `readLogQuery` / `matchesLogQuery`：统一验证与精确过滤，支持 event、runId、扩展 package/module 和字面关键词；
- `createExtensionLogWriter` / `queryExtensionLogs`：Host 内部使用，固定扩展来源、限制写入量与大小、限定自有查询；SDK 扩展使用注入的 `ctx.logger` / `ctx.logs`，不创建自己的 Root；
- 核心类型：`Logger`、`RootLogger`、`LogLevel`、`LogRecord`、`LogSink`。

### Node.js 专属入口 (`@loom-studio/logging/node`)
- `createJsonlFileSink(options)`：旋转 JSONL 文件持久化 Sink（支持 `maxFileBytes`、`maxTotalBytes`、`maxAgeDays`）；
- `createJsonlLogReader({ directory })`：流式历史分页，必填时间范围、固定读取快照、绑定过滤器的 cursor、扫描预算与缺失报告；支持 AbortSignal，不改变 Sink 保留策略；
- 核心类型：`JsonlFileSink`、`CreateJsonlFileSinkOptions`。

---

## 构建与验证

```bash
# 编译 TypeScript 产物
pnpm --filter @loom-studio/logging build

# 运行跨端日志核心与 JSONL 文件 Sink 单元测试
pnpm exec vitest run tests/unit/logging
```

---

Console 默认紧凑输出；`verbose: true` 才展示完整结构化字段。`data.detail`、`durationMs`、`usage` 和 `technical` 的生产者约定见正式架构；未知字段留在原始记录，不自动铺满控制台。

## 正式文档

- [Logging Architecture 完整日志架构](../../docs/architecture/platform/logging.md)
