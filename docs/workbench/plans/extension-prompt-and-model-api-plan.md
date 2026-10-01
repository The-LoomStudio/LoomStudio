# Extension Prompt 与模型调用 API

状态：已实施，聚焦验证完成（2026-09-29）。

## 事实与决定

- 当前 Agent Turn 的 Preview/Run 共用准备路径；Prompt 编译器可独立接受 SourceNode/Contribution，不依赖 Session 或模型。
- 扩展逐次 Agent 调用可附加 Setting 引用和结构化锚点内容；不持久化挂载，不新增作用域。
- 独立 Prompt build 不强制使用；扩展自行构建 messages 时，以显式模型引用和参数调用普通网关，不回退主 Agent 模型，也不向扩展提供凭据。

## 实施

1. 扩充逐次输入，在共用准备路径验证安装可见性并注入当前构建；覆盖并发、预览一致性。
2. 开放无 Session/model 的编译能力；SDK/Host 接线施加安装权限与实例生命周期。
3. 为扩展普通模型调用接线明确模型、参数、真实流和取消；保留现有 capability-profile invoke。
4. 聚焦测试与相关包类型检查，更新架构契约及本计划结果。

非目标：UI、自动 Provider 注册、迁移、全局挂载变更、自定义 Agent Loop、全仓构建或真实计费调用。

## 剩余

已接入 Agent Turn 的逐次输入、无 Session/model 的扩展 build，以及显式普通模型调用的 SDK/Host/Server 接线。扩展 build 的资源读取限于本安装导入资源；普通模型入口复用 `ai.invoke` 权限和平台凭据网关。

聚焦验证：Agent Session/普通网关三例、Extension Host 三例、资源归属一例通过；相关 SDK、Runtime、Host、Server 定向 TypeScript project check 通过。未执行真实计费网关、完整测试/构建、UI/人工视觉验收。普通模型直调不提供自定义 Agent Loop；fake Provider 不生成虚构 token delta。
