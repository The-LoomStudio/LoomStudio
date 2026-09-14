# Workspace 资源文件、导入导出与在线分发计划

> **状态**：In Progress / 角色目录、Card Bundle、官方内容与 Extension ZIP 已有实现；Preset / Setting 完整附件、在线来源与开发模式待接续
> **日期**：2026-09-13
> **来源**：合并 `data-directory-resource-development-plan`、`typed-primary-resource-bundle-plan`、`extension-package-source-host-runtime-plan` 与 `workspace-dev-sync-plan`

## 目标

统一处理 Workspace 资源从文件、目录、ZIP、Git 或用户自定义来源进入 Loom Studio，以及用户如何保存、更新和显式 Apply。

## 已完成

- `data/` 根目录、角色目录保存、目录发现、确认导入、原 Card Apply、媒体读取与变更通知。
- Card Bundle ZIP v2、PNG 内嵌 ZIP、脚本与 Text Pipeline 文件化。
- Preset / Setting Prompt Resource ZIP 首切片。
- Extension 本地 ZIP 安装、路径安全检查、临时解包与现有激活流程。
- 官方 starter、显式安装、官方内容导出和完整 Character Status 样例。
- Card Bundle、Prompt Resource 与 Card Directory 的脚本 Blob 写入已接入 prepared write 清理；并行准备阶段等待全部结果后，任一附件失败都会丢弃已成功准备的文件。
- Asset / Blob 元数据与引用记录在同一 SQLite 事务中参与提交；事务回滚不会保留本次写入的未提交 Blob。

## 后续阶段

1. 补齐 Preset / Setting 的完整附件分发。
2. 完成 Extension 用户自定义来源、Git 更新和非 Git 版本替换。
3. 讨论并实现 Workspace 开发模式：编辑源、草稿、显式 Apply 与权限边界。

## 已确认边界

- 远程来源不固定，用户自行决定来源是否可信；平台负责获取、校验、安装和替换流程。
- 有 Git 时优先使用 Git；没有 Git 时允许安全地替换版本目录。
- 平台不负责 Extension 作者自己的数据迁移。
- 不执行包内安装脚本，不自动授予新权限，不覆盖已冻结 Timeline。
- 文件目录、数据库、运行时 Session 和 Timeline State 保持不同职责。
- 文件系统 Blob 与 SQLite 元数据不是跨进程单事务；正常准备/事务失败必须清理 prepared 文件，进程崩溃后的历史 orphan 文件仍由后续 GC 或运维策略处理。

## 非目标

不建设 Marketplace、依赖求解、自动合并、通用 IDE、自动双向 Watcher、CLI/MCP 或通用 Sandbox。

## 完成标准

各主体可通过同一套正式编解码和安装边界完成本地导入导出；远程来源失败不产生半成品；用户显式操作才会修改既有资源；开发模式不绕过领域事务、CAS、权限和 Apply 合同。

本 Plan 的导入失败标准具体包括：Card Bundle、Prompt Resource 和 Card Directory 在 Blob 准备或 SQLite 事务失败时不得留下本次操作产生的可见半成品。历史 orphan Blob、进程崩溃恢复、引用计数与物理 GC 不属于本轮完成范围。
