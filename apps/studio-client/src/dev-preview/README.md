# Dev Preview

显式注册入口位于 `preview-entry.tsx`，仅 `import.meta.env.DEV` 启用，不进入生产导航。现有展示页不连接业务写入；共用组件的浏览器偏好 Storage 在加载前隔离。

## 原生正则实验室

开发客户端启动后访问 `/dev/preview/regex`。例如默认开发端口为 `http://127.0.0.1:18011/dev/preview/regex`；端口随 Vite 配置变化。本次浏览器验收使用独立端口 18013。

- 左侧编辑原文本，右侧查看真实替换字符串或正式 `MessageContent` 渲染。
- 选择用例，点击“保存并启用示例规则”；然后播放、单字符步进、拖动输入切片或跳到结束。
- 下方可展开完整 MD 源码、调整规则顺序后重新保存。标准样例会对照确定预期；自定义输入不借用样例预期。
- “完成并持久化”通过 `invokeAgentTurn` 提交本地 Provider 样例；检查数据库记录与两种投影，刷新后仍可读取。

该页是原生集成实验，区别于只提供内存样例 Props 的其他 Preview。`build/regex-preview.ts` 只在 Vite serve 时挂载 `/__dev/regex-lab`，限制同源、loopback POST，服务固定使用仓库 `.artifacts/regex-preview` 的独立 SQLite 和 Blob。`scripts/dev/regex-preview-runtime.ts` 复用正式 ApplicationRuntime / Script / Mount / 文本处理器；只替代外部 Provider 输出，不访问真实服务数据、不请求外部模型。

用例覆盖复杂修剪、捕获引用、顺序、Unicode 零宽、流式临时末尾、三档手机消息流式、保存时推理分块和嵌套渲染边界。第三档能观察内容增长和 iframe 重建编号，不能作为已实现 CTX 连续更新的证据；显式 iframe 嵌套也不等于 Markdown 自动递归渲染。

验证入口：`tests/integration/application-runtime/regex-preview.test.ts` 使用独立临时目录，检查原生规则与 SQLite 关闭重开，测试结束清理目录。

## 测试 Fixtures 说明

本目录下的 `script-management-fixtures.ts` 与 `observability-fixtures.ts` 供单元测试（如 `tests/unit/client/script-management-panel.test.ts`、`tests/unit/client/observation-reading-ui.test.ts`）复用，请勿直接移除。
