# Extension 开发者体验后续

状态：SDK 与声明式设置已有实现；生态发布、自省和作者工具仍为后续。
更新：2026-10-25。本页收窄原路线，不新增产品决定或实施授权。
早期路线、设置合同和完成切片见[完整原稿](../../archive/plans/extension-developer-experience.md)。

## 当前已交付

- `@loom-studio/extension-sdk` 是现有 TypeScript 契约入口；Runtime 模块化和 Server / Client Logger 已存在。
- Setting 声明、Manifest 校验、Host 控件、字段级提交、Document Version 冲突保护及权威配置快照订阅已接通。
- IFrame 公共 Theme Token Snapshot 已实现；Example Echo 是仓库内可追踪的 text Setting 消费者。
- boolean、select、range 已有 Host 表单覆盖；这不代表 The World 独立源码已完成普通设置迁移。
- Declarative Contribution 与 Custom Renderer 保持两条路径，不建设覆盖所有 UI 的万能 DSL。

## 真正未完成与未决合同

1. **SDK 与组件公开发布**：包导出、文档、版本和第三方兼容承诺需按实际对外发布范围确定。
   内部组件可复用不等于已经形成稳定的公开 `@loom-studio/ui` SDK。
2. **动态能力发现**：按现有 Registry / RPC 元数据核对 `system.introspect` 的真实缺口，再决定 Schema 和 DevTools 范围。
   Logger 或已有 RPC 清单不能作为完整 Schema 自省已交付的证据。
3. **作者脚手架**：官方模板与轻量创建工具仍是候选，须等待真实发布和作者使用合同明确；不生成另一套核心逻辑。
4. **设置消费者与演进**：The World 正式普通设置迁移、第三方兼容和长期 Schema 迁移策略尚未完成。
   多步骤 Flow 是独立延期切片，不因已有整体迁移需求就直接塞入 Setting Schema。

## 已确认边界与授权

- 普通设置复用现有 Extension Config，保留 Scope、校验、版本冲突、错误和重试；不新建表单数据库。
- 布尔/枚举直接提交；文本/数值保留本地 draft，按已确认节奏提交；滑块在交互结束提交最终值。
- 保存失败保留 draft，不发布失败值或悄悄恢复默认；Runtime 消费已提交快照，预览与持久状态分开。
- Custom Renderer 继续负责地图、天气和复杂编辑；普通控件不强制作者编写框架或私有持久化层。
- 原已确认方向保留；未决发布、兼容、迁移和 Flow 合同由用户与主 Agent 收束。本次整理不授权发布或新依赖。

## 接续入口

- 当前 SDK / Host 事实见 [Extension Architecture](../../architecture/extensions/README.md)与 `packages/extension-sdk/src/index.ts`。
- 远程安装、更新和官方预构建发行由 [Extension 模块后续](./extension-module-completion-plan.md)承担，不在 DX 重建安装流程。
- 前端目录所有权由[独立边界计划](../../archive/plans/frontend-feature-boundary-consolidation-plan.md)处理；本页不接管其写集或改变 UI 产品语义。
- CLI/MCP 的外部 Agent 接入归[适配器计划](./application-capability-cli-mcp-adapters-plan.md)，不从“开发者体验”推导实施授权。

## 最小关闭条件与验证边界

- 对外包与模板若推进，作者能仅依赖声明的公开入口完成代表性扩展，版本和兼容范围可解释。
- 自省只覆盖已冻结的真实能力；设置迁移验证非法值、快速编辑、冲突、失败保留和模块停用。
- 多步骤 Flow、长期 Schema 迁移等其余候选有明确延期或撤回记录，不为收尾建设通用 UI 平台。
- 现有 Host 表单测试不等于第三方 Extension 兼容、浏览器交互或独立扩展发行验收。
