# 扩展角色目录与全局 Framework 依赖

状态：W1–W3 已实施并完成定向集成验证；界面待人工验收。2026-11-01。

## 目标与边界

以 `official.loom-assistant` 为首个样例：扩展继续提供独立助手 Preset、Lore 和资源；扩展详情列出诺姆角色模板，只有用户选择导入后才创建 Card。角色里的扩展可消费全局 Framework 的公开能力，不能将“装了依赖”等同于任意访问另一个包。

本轮已授权并实施随包角色目录；远程按需下载为后续阶段，不以账号系统、作者平台、自动同步、表情消息或正则改造为前置。独立扩展仓库可检出在项目扩展开发目录；仓库拆分本身不在本方案施工范围。

## 实施前源码基线

以下为静态源码证据，不是运行验收。

| 链路 | 当前支持与缺口 | 源码入口 |
| --- | --- | --- |
| 角色携带扩展 | Card Bundle v4 支持 `extensionPackages`；归档携带不等于安装启用，管理器另有 `installCardPackage` | `packages/application-runtime/src/cards/workspace-types.ts`；`apps/studio-server/src/codecs/card-bundle-zip.ts`；`apps/studio-server/src/extensions/extension-manager.ts` |
| 扩展依赖声明 | `dependencies` 有 id、version、可选下载 source，没有 target；显式启用模块时 `validateInstalledDependencies` 查询全局 catalog。Card 安装资源没有统一遍历全部依赖进行同等检查 | `packages/extension-sdk/src/index.ts`；`extension-manager.ts` 的 `importResources`、`enableModule` |
| 工具、assets、图标 | `resolvePackageDependency` 检查声明、版本、精确安装身份；允许 Card 消费 global，禁止 global 消费 Card、跨 Card。具体消费仍受能力授权及可用性约束 | `packages/application-runtime/src/extensions/package-dependency.ts`、`tool-reference.ts`；`apps/studio-server/src/extensions/extension-asset-access.ts` |
| 服务端 RPC | `ctx.rpc.call(method, params, {scope:'global'})` 可以从 Card 路由到全局注册的公开 RPC。Kernel 按 target 找 handler；这条调用链没有统一依赖/版本校验，不能称为完整 Framework 契约 | `packages/extension-sdk/extension-host/src/instance.ts`；`packages/kernel/src/kernel.ts` |
| 客户端界面 RPC | `ctx.rpc.call` 没有目标包参数，客户端宿主传自身 packageId/target，Kernel wrapper 校验包命名空间；不能直接把服务端 global 参数照搬过来 | `packages/extension-sdk/src/index.ts`；`apps/studio-client/src/features/extension-renderers/model/client-extension-host.ts`；`packages/kernel/src/handlers.ts` |
| 独立脚本 | `@require` 是 HTTP(S) 代码加载，不是已安装扩展依赖。服务端脚本创建合成 manifest，没有传递包依赖，虽获得服务端 ctx，也没有完整依赖生命周期 | `packages/shared/src/loom-script-metadata.ts`；`apps/studio-server/src/scripts/script-service.ts`、`server-script-runtime.ts` |
| 依赖生命周期 | global catalog 有卸载/更新保护；runtime 能追踪具体 Tool 和图标消费者。但 Card→global 只有依赖声明、没有具体工具/图标引用时，`sameTarget` 分支会跳过，不能覆盖只调用 RPC 的消费者 | `extension-manager.ts`；`tool-reference.ts` 的 `assertToolDependencyConsumers` |
| 角色采用扩展 | `extensionAdoptions` 支持 packageId 和 global/card；用于故事采用，不含版本范围，不能代替安装依赖。Timeline participation 有独立采用及可用性控制 | `packages/application-runtime/src/cards/card.ts`；`extensions/timeline-adoption.ts`；`runtime/extension-resource-access.ts` |
| 角色引用预设 | Card 的 `preset` 是内嵌 system/macros，不是全局 Agent Preset 引用。`externalContextAssetIds` 也不是免复制引用：import 会为 contextAssets 创建新资源 | `cards/workspace-types.ts`、`cards/workspace.ts`；`packages/application-runtime/src/types.ts` |
| 头像 | Card media 使用 avatarAssetId/coverAssetId；导入服务创建媒体资产，读取走目录/AssetStore。扩展资源图标协议不能直接用于 Card 头像 | `apps/studio-server/src/codecs/card-transfer-service.ts` |
| 角色目录 | `ExtensionPackageContributions` 没有角色目录类型；管理器没有列目录/预检/导入这条原生链路 | `packages/extension-sdk/src/index.ts`；`apps/studio-server/src/extensions/extension-manager.ts` |
| 作者流程 | Card 已有文件投影、目录加载和导入；扩展 authoring builder 当前以 Preset/Lore resource 映射为入口，不能假定已能构建角色目录 | `apps/studio-server/src/codecs/card-bundle-files.ts`；`resource-directories/card-directory-import.ts`；`scripts/pack/extension-authoring.ts` |

## 实施合同

### 目录与角色归属

新增 `contributes.characters`（命名建议）：稳定条目 id、名称、说明、预览图、随包 Card Bundle 路径。目录只描述分发内容，不创建 Card、不安装角色内部代码。首版不支持动态目录脚本。

导入引用使用发布包身份、条目 id、版本/内容摘要，服务端从已安装包安全读取文件；客户端不能提交任意磁盘路径。预检与提交核对摘要，变化则要求重新预检。

导入生成新 Card，并保留来源标记以展示“已添加／打开已有／再添加一份”；不能用名称去重，不自动覆盖已有角色。来源标记跟随 Card 持久化，删除 Card 后不留下阻止重导入的状态。模板更新和用户 Card 更新分开，后者留给[资源下载与更新](./resource-download-and-update-plan.md)。

### 依赖与公开能力

扩展依赖增加可选 `target: global | card`；显式目标贯穿安装、启用、恢复及依赖保护。旧省略值保留既有行为：具体资源引用按其声明的范围解析，模块启用仍按全局 catalog 检查；不会在资源解析失败时自动跨范围回退。Card 自身 `extensionDependencies` 首版只支持 global。

Card 本身需要可移植的 Framework 依赖及默认助手 Preset 引用（packageId/contributionId/target，而非本机生成 ID）。不借 `extensionAdoptions` 承担版本依赖，也不把 `externalContextAssetIds` 当作链接协议。默认预设仅是新建会话的选择提示，不复制 Framework Preset、不重设用户已有会话。

只用现有资源能力即可满足诺姆第一版；通用跨包 RPC 和独立脚本依赖分开施工，不为目录导入强行新增一个通用服务总线。需要 Framework RPC 的角色作者可先把业务代码放在角色携带的正式扩展里；客户端到其他包的调用仍需显式受控入口，不能伪装调用方身份。

若后续打通跨包 RPC，必须保留消费者身份和 Card 上下文，并分别传路由目标；依赖声明、版本、提供者已运行、公开方法和授权要在宿主边界核对。依赖不是自动启动或扩大授权。

### 诺姆首版

扩展持有 Preset、Lore、头像源文件及未来表情。角色只含资料、开场白、全局诺姆依赖和默认助手 Preset 引用；不把诺姆扩展再打进自己的角色包。

头像先沿用正常 Card Bundle 媒体导入，接受小头像的物化副本；不复制未来整套表情。扩展文件直接作为角色头像引用是独立合同，首版不做。即使用户未添加角色，原有独立助手 Preset 仍可使用。

## 施工顺序与位置

### W1：统一依赖目标与生命周期

- 入口：`packages/extension-sdk/src/index.ts`、`extension-host/src/manifest.ts`；runtime `extensions/package-dependency.ts`、`tool-reference.ts`、`runtime/extensions-runtime.ts`；server `extensions/extension-manager.ts`。
- 确定声明目标及旧字段兼容；让 Card 扩展资源安装、显式启用、重启恢复、全局更新/卸载使用同一解析规则；补只依赖 RPC/资源但没有 Tool mount 的消费者保护。
- Card 级依赖落在 `cards/workspace-types.ts`、`workspace-codec.ts`、`workspace.ts`、`types.ts`，往返导出保留声明；默认不自动下载或启用依赖。
- 验收：Card→global 成功；缺失/版本不符/跨 Card 失败；被依赖的 global 不兼容更新或卸载被阻止，并指出角色或扩展。导入校验失败不留下半成品 Card。

### W2：角色目录与原生导入服务

- SDK 增加目录 schema；server 新建 `extensions/extension-character-catalog.ts`，管理器提供包内读取入口；RPC 接在 `packages/kernel/src/handlers.ts` 与相应客户端 API 类型。
- 复用 `codecs/card-transfer-service.ts`、`card-bundle-zip.ts`、目录落盘，不另写 Card 数据导入器。把已有导入并落盘流程提取为可复用入口，保留“Card 已创建但落盘失败”的恢复提示。
- 默认预设引用需接 Card portable contract、资源解析和新建会话的 preset 选择；先追踪 `createTimeline`/Agent Session 创建入口后定具体 UI 文件，不能只存字段而不消费。
- 验收：浏览/安装扩展不创建 Card；预检显示依赖和将导入内容；显式导入一次建立一个角色；重复点击有明确选择；改名后来源匹配仍有效；导出再导入保留依赖与默认预设引用。

### W3：诺姆作者样例与界面

- 样例：`official/extensions/loom-assistant/authoring/characters/nom/`；manifest 目录声明；文档 `NOM-ASSISTANT.md`。构建接 `scripts/pack/extension-authoring.ts` / CLI，复用 Card 文件投影和 ZIP 编码，输出 staging，不将开发目录直接当作用户角色目录。
- UI：`apps/studio-client/src/features/extension-renderers/ui/extension-workspace.tsx` 及同目录样式；API/entity 接线；沿用当前导入反馈组件和 i18n。
- 验收：扩展详情看到诺姆；导入后角色库出现诺姆头像/开场白；创建会话默认选择扩展预设，知识不复制；不导入角色仍可使用问答助手。真实 Provider 回答质量另验，不由构建成功替代。

### W4：远程目录条目（后续）

目录条目增加 HTTPS 下载源、内容摘要、版本与有限元数据；浏览不下载角色归档。显式选择后下载到暂存，核对摘要/大小/路径，再走 W2。复用 `extensions/extension-download.ts` 可用的下载安全机制，但不把 Card 安装伪装成 Extension 安装。跨域重定向、内网地址、取消、失败清理要覆盖，具体复用范围实施前核对。

不做远程脚本执行式目录、不替作者建设平台、不自动更新已导入 Card。与资源下载计划共同维护下载/采用边界。

### W5：Framework RPC 与脚本声明（独立后续）

补服务端依赖校验、客户端显式目标调用，以及脚本声明的包依赖。涉及 SDK/Kernel 权限与脚本新 metadata，必须单独定稿，避免与正在演进的脚本系统冲突；诺姆首版不依赖此包。脚本 `@require` 保持其现有含义，不改成两套混合解析。

## 验证范围与停止条件

本轮通过隔离临时数据目录的真实服务 RPC 验证，未修改用户运行实例，也未启动浏览器做视觉验收。

实施时复用 `tests/integration/application-runtime/tool-reference.test.ts` 与既有 Card bundle/extension manager 测试。补少量能保护跨范围依赖、导入原子边界和角色归属的行为测试；目录浏览不产生 Card 用真实 API 验证。静态 schema/跨模块类型改动再做对应包类型检查。界面由用户验收，必要时对具体交互故障做诊断。

已落实默认 Agent Preset 语义：按包贡献身份解析实际资源，在新建故事主 Session 时绑定；不改已有 Session。W4/W5 仍未授权实施。媒体使用既有导入流程，目录保存失败保留已创建 Card 并提示恢复，重复导入保护可识别其来源。

## 本轮交付记录

- 新增 `cards/card-framework.ts`：Card 字段验证、默认预设解析、读取到提交期间的并发保护。
- 新增 `extensions/extension-character-catalog.ts` 与原生 RPC：目录浏览、摘要预检、显式导入、来源记录与重复导入确认。
- 新增扩展详情角色目录 UI；导入后刷新角色库并打开角色。
- 诺姆作者目录 `official/extensions/loom-assistant/authoring/characters/nom/`，使用用户指定 `nom-illustration-007.png` 原图；构建输出 ZIP 和预览图。
- `--character ID=DIRECTORY` 复用 Card 文件格式和 ZIP 编解码；不另建角色源码格式。
- 定向验证：工具/依赖与 Card 保护 6 项、目录与真实诺姆流程 2 项、既有作者构建 7 项通过；服务端项目引用构建与客户端类型检查通过。
- 不涉及远程角色下载、跨包 RPC、脚本依赖、表情消息或新的独立 Git 仓库。
