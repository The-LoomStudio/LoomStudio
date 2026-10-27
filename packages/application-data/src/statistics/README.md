# Application Statistics

本目录提供 Dashboard 使用的持久化统计 Store。它位于 `@loom-studio/application-data` 公共入口，但不属于 Agent Transcript 或 Provider Observation：它记录请求用量和被接受的用户交互，以便汇总和分组查询。

## 注入与采集边界

- 用共享 [`SqliteDataEngine`](../../../data-engine/README.md) 创建 [`createStatisticsStore()`](./store.ts)，并提供时钟；统计数据使用独立的 `application.statistics` namespace。宿主负责创建 Store 并将它接入 Provider Gateway。
- Provider Gateway 的 [`track()`](../../../application-runtime/src/providers/gateway.ts) 包装实际 Provider 操作，收集 Provider 上报的 TokenUsage、请求状态与调用身份。没有用量上报时，记录仍保留为未上报；进程启动时遗留的 `running` 请求改记为 `unknown`，不会重试远端请求。
- Narrative 与 Agent 的已接受用户输入事务调用 [`recordUserInteraction()`](../narrative/store.ts)，不是每次 Transcript 写入都算一次使用。历史 Observation 不用于回填统计。
- 查询按调用方给定的 `[from, to)` 和时区汇总；用量默认排除模拟请求，明细还要求指定 Provider Profile。Store 提供的 API 没有按日期清理或记录删除操作，因此报告时间范围是查询口径，不是数据保留期。
- `usage()` 返回总量、Provider / Model / Capability 分组、按日（跨度超过一年则按月）聚合及采集起始时间；`usageRequests()` 提供游标分页明细；`play()` 汇总接受的用户交互及其关联故事。`resources()` 是当前资源数量投影，不是用量记录。

## 阅读入口与验证

- [`store.ts`](./store.ts)：表结构、采集/恢复、查询聚合及交互记录合同。
- [`dashboard-statistics.test.ts`](../../../../tests/unit/data-engine/dashboard-statistics.test.ts)：重启后用量保留、模拟记录筛选和交互统计的现有验证入口。
