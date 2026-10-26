# 扩展开发态自动重载

状态：Pending / Backlog；优先级：Low；创建：2026-09-04；复核：2026-10-25。

## 当前能力与缺口

现有模块 reload、`/extensions/events` SSE 和 Client Runtime 失效后 reconcile 可复用。开发启动器 [`scripts/dev/dev-with-packages.mjs`](../../../scripts/dev/dev-with-packages.mjs) 当前通过 `tsx watch` 监听 Server 入口、`packages/**/dist/**/*`、`official/**` 与测试扩展构建产物；这些目录的变动可以触发进程重启。

剩余目标是任意独立扩展或外部 DevLink 目录的构建变化自动触发重载。当前启动器未统一覆盖这些目录，Server 的 DevLink 发现也没有绑定文件监听；已有手动 reload 和跨端通知不等于实现了该触发源。直接在源码层监听但未更新构建产物，也不能视为加载了新代码。

## 后续选择与验收

按实际开发需要选择最小方案，尚未决定或实施：

- 扩大开发进程 watch，覆盖已配置扩展的构建产物，变动后重启 Server。
- 给 DevLink 构建入口绑定模块级监听，防抖后调用现有 reload，并沿 SSE 通知 Client。

验收时使用临时扩展目录，核对构建变化能加载新产物、连续构建不会并行重复重载、移除 DevLink/退出时清理监听，以及前后端旧实例资源释放。是否需要免进程重启由真实开发需求决定，不另建一套扩展生命周期。当前没有本项的实现或运行验收记录，暂不安排自动跟进。
