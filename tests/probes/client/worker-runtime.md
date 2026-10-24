# Worker 运行时诊断

此探针通过真实 Client Host、Script Runtime、MessagePort 和浏览器 Dedicated Worker 执行。
仅使用内存 State / 通知，不读写真实工作台数据，也不授予持久权限。

从仓库根目录启动客户端 Vite，然后在独立标签页打开
`http://127.0.0.1:18011/@fs/<仓库绝对路径>/tests/probes/client/worker-runtime.html`，点击“运行诊断”。
9 项 PASS 与“全部通过”才表示完成。本地已有客户端服务时可直接复用。

覆盖独立授权、真实 Worker 执行、State 读订阅、保存不重启、局部刷新与旧订阅清理、
角色/全局生命周期、扩展包相对 import、运行中崩溃状态、死循环终止与启动失败。
死循环仅在 Worker 内运行，最后由生产执行器强制终止；异常用例故意产生错误日志。
不覆盖真实数据库、跨窗口、离线依赖、浏览器退出后持续运行或全站视觉效果。

2026-10-23：Chrome / Vite 实测通过；死循环终止约 260 ms，主线程心跳继续运行。
