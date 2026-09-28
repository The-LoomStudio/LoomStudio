# 消息 HTML 预览归档

2026-09-24：用户验收通过并确认用于正式界面，演示从活动预览注册表移除。

这里保留角色状态栏、围栏 HTML、折叠推演、嵌套伏笔、图片画廊，以及分段播放控件。没有业务 RPC 或真实角色数据写入。JPEG 是网站仓库 `public/images/cards_wide/image.png` 的开发缩略图，示例内嵌图片不代表允许外部图床。

## 正式实现

- `src/features/message-content/`：消息分段、Display 消费、安全片段与隔离 iframe。
- `src/widgets/narrative-timeline/narrative-timeline.tsx`：Narrative 消息与开场白。
- `src/widgets/agent-chat-panel/agent-chat-panel.tsx`：Agent 消息及流式状态。

演示不是正式渲染的依赖。`message-html-examples.ts` 继续被 `tests/unit/client/message-html.test.ts` 作为验收回归样例使用。

## 重现方式

旧地址 `/dev/preview/message-html` 不再注册。需要重现历史验收时，在 `src/dev/preview/index.tsx` 临时显式导入 `../archive/message-html/message-html-preview.js`，并注册 `MessageHtmlPreview`。不要为归档目录增加自动扫描或生产路由。

实现与验证记录见仓库 `docs/archive/plans/ui/native-message-html-plan.md`（消息渲染与后续 iframe 基建均已实施，Plan 已归档）。归档保留样例和未验收边界，不扩大已确认的网络、ST API 或持久化权限。
