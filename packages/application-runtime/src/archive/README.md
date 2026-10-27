# Timeline Archive

本目录定义 Timeline 归档格式、校验、参与者数据块和 ID 映射。公开编解码与参与者注册入口由 [`src/index.ts`](../index.ts) 导出；完整 Timeline 的读写由 [`narrative-runtime.ts`](../runtime/narrative-runtime.ts) 组合各领域 Store 完成，不要把本目录的 JSON 编解码当成独立的完整恢复流程。跨 Session、Workspace 与分支的历史边界见[运行与 Session 合同](../../../../docs/architecture/application/agent/runtime-and-session.md)。

## 扩展参与者前提

- 参与者以唯一 `namespace` 和正整数 `version` 注册 `export` / `import` 回调，并用 JSON payload 表达扩展拥有的数据；导出的引用可带 Timeline、Branch、Node、State Revision ID 映射。
- 导出回调在 Runtime 的 Data Engine 快照读取期间执行，只应读取；导出 Workspace Blob 还要求宿主提供 Blob Storage。
- 导入时，已注册的参与者收到新 Timeline ID 和组合后的 ID 映射。未注册的 namespace 与回调失败会作为 pending participant 数据保留，并从导入结果报告；当前 Runtime 没有自动重试 pending 数据的流程。版本兼容由参与者自身实现，本目录不自动迁移 payload。
- Archive 导入会创建新身份并校验引用闭合；它不执行归档中的工具或 Run。宿主仍负责调用权限和文件传输边界。

## 阅读入口与验证

- [`timeline-archive.ts`](./timeline-archive.ts)：v1/v2 结构、校验、ID 映射与参与者注册表。
- [`timeline-archive-participant.test.ts`](../../../../tests/unit/application-runtime/timeline-archive-participant.test.ts)、[`extension-record-archive.test.ts`](../../../../tests/integration/application-runtime/extension-record-archive.test.ts)：参与者映射与 Extension Record 归档的现有验证入口。
