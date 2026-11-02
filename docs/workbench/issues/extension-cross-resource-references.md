# 扩展跨资源引用后续

状态：部分修复；媒体可移植引用、Lore／文本依赖诊断、跨包脚本与媒体回收仍待收束。

日期：2026-10-31。范围：工具引用修复期间的定向源码核对；不是全扩展系统审计。工具三类引用由本轮实现，本页仅保留其他类别的真实缺口。

| 类别 | 当前行为 | 后续边界 |
| --- | --- | --- |
| 预设图标 | 已补：跨包 scope＋dependency、确切安装与文件验证、作者往返、UI 禁止错误回退、更新删除图片检查 | 不再列为本包白名单缺口；缺少真实运行实例的人工视觉验收不等于功能未实现 |
| Media assets | 已补：现有 assetId API 跨包读取同时检查 assets.read、dependency版本与精确安装范围 | assetId 仍是运行时身份，不宣称可移植包内媒体协议已实现；本轮没有设计新的素材清单或复制资产 |
| Lore／文本资源 | 支持 package/external 引用；external origin 可携带 packageId、contributionId、target，运行时按安装身份定位 | 现有部分路径保留未解析 resourceId，不等于验证了依赖存在。需要另行核对缺失、版本、更新与卸载策略；文本系统正在独立改造，本轮不改 |
| 脚本挂载 | manifest scriptMounts 与 Runtime scriptMetadata 仅解析本包脚本 | 缺少跨包挂载合同。不能直接套工具引用：还涉及脚本 Owner、采用版本、授权及执行生命周期，需要独立收束 |
| 媒体卸载 | 扩展文件/记录清理不等于 Media Asset 清理 | 不新增自动资产删除；历史消息仍可能引用资产，需先明确保留与回收责任 |

定位入口：

- [作者扩展构建器](../../../scripts/pack/extension-authoring.ts)。
- [图标合同](../../../packages/shared/src/prompt-resource-contracts.ts)、[图标解析](../../../apps/studio-client/src/shared/ui/extension-icon/extension-icon.tsx)、[资源安装](../../../packages/application-runtime/src/runtime/extensions-runtime.ts)。
- [扩展 API 权限与 assets](../../../packages/extension-sdk/extension-host/src/instance.ts)。
- [扩展贡献合同](../../../packages/extension-sdk/src/index.ts)、[manifest 校验](../../../packages/extension-sdk/extension-host/src/manifest.ts)。
- [包管理与生命周期](../../../apps/studio-server/src/extensions/extension-manager.ts)。

后续验收应分别覆盖 global／同 Card／不同 Card、依赖不存在、禁用与卸载；本页没有宣称这些场景已全部运行验收，也不授权新建统一资源协议或更改既有资产访问权限。

2026-10-31 续：assets 与图标依赖／安装范围链路已补齐，使用合同见[扩展架构](../../architecture/extensions/README.md#跨包图标与-media-asset)。正则／文本资源未修改；跨包脚本仍保留独立后续。

验证：Host/Server/UI/作者构建六套33项通过，Runtime图标/工具/作者三套共16项通过；真实临时Server覆盖纯图片包安装身份、跨包图标落库与缺图拒绝。Server和Runtime类型检查通过。Client全项目检查仍受并行正则预览文件 CodeMirrorEditor 缺少 onCommit 阻塞，未修改该文件；本次图标解析测试通过，未做主观视觉巡检。个人预设引用不构成manifest依赖，未增加其卸载阻止规则。
