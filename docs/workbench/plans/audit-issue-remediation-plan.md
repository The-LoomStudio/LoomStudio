# 审查 Issue 修复实施计划

状态：In Progress

2026-09-23 lint 门禁批次完成：Application Runtime 实际 30 条、Client 实际 9 条 ESLint 错误均清零，两包定向 noEmit 通过。Runtime 清理 Workspace 无用导入/helper，三处 VFS 控制字符处理保持拒绝、替换和百分号编码语义，新增定向测试 3/3 通过。Client 清理无用项、以真实 Transcript/JSON 类型替代 any，日志控制字符边界不变；日志及工具结果 13 项通过，工作区持久化定向 1 项通过/8 项筛选跳过。子 Agent 的定向验证未机械重跑，主 Agent 补 Client noEmit 并核对关键源码。两份 lint 专项 issue 达到关闭条件后删除，索引同步移除；不代表全仓 lint、测试或浏览器验收完成。

FRONTEND-001 本轮仅核对，尚未实施：消息正文卸载会进入 RendererInstanceRoot 的清理分支，abort signal、调用 disposer，并销毁 DOM/iframe；直接按可见范围卸载可能重置扩展表单、播放进度等局部状态。需确认是允许离屏重建，还是保留已挂载的有状态扩展消息（代价是此类消息不能保证 DOM 总量有界）。编辑中的消息必须保留，不能以性能优化丢弃编辑会话。未新建 Renderer 状态序列化合同。

2026-09-23 用户重新确认导航合同，原 FR-002 “全部 Panel URL 化”方向撤销，实际实施和验证集中于 [工作区导航计划](studio-navigation-and-workspace.md)。统一入口恢复、同 URL History State、明确 URI 目标、受控引用、入口遗漏及较早消息分页定位均已修复，真实浏览器完成客观入口/历史/恢复检查；人工视觉仍未验收。FR-010 另按“不支持认证代理”完成 userinfo 拒绝及先持久化后发布内存，临时文件 17 项通过，无真实配置/密钥操作。全仓质量门禁与其余 issue 仍未完成，RPC 体积边界仍待决定。

2026-09-23 引用边界补齐：并行 A/B 分别移除 StateDefinition、PortablePayload 的跨 Card 拒删，各自真实 Runtime/SQLite 三项通过。版本条件仍校验；State 既有冻结快照可用，新建缺模板失败；Payload 读取及导出缺失明确失败，保留外部 ID、不自动替代。主代理核对实现并更新旧 workspace-artifact 拒删断言，定向一项通过/14 跳过。未做遗留库/浏览器验收。FR-010 当前成功 RPC 日志已不记录原始参数，但代理 userinfo 仍进普通配置和 DTO；认证代理支持与否、FR-005 总请求体容量仍为未决产品边界，不自行选择。

本轮并行交付已集成：A 的 Preset/扩展删除保留外部引用由真实 HTTP RPC+临时 SQLite 两文件 5 项通过，自身资源仍清理、主 Preset 缺失严格失败。B 的 Setting/Tool 不可用投影、选择保留及显式移除由三个定向文件 19 项通过，Client noEmit 通过；主代理核对实际实现，未重复执行。RPC 参考与正式 PromptBuild 契约已同步。本轮未做浏览器验收；FR-012 尚需核对原审查提及的 StateDefinition/Portable Payload 等边界，不把已修子链等同全域完成。下面各轮记录保留当时进度。

2026-09-23 下一并行轮：A 负责 Preset 直接删除和扩展 removePackageResources 保留外部业务引用（自身拥有资源仍清理），B 负责 Setting/Tool 缺失挂载的前端投影与提醒；两包均不修改执行器，共享文档主代理维护。主代理修复三处测试 Extension Host 桥接的过期手写类型和 emitEvent 漏返回，并使事件订阅回调返回 void；RPC/文档契约两文件 26 项、ClientBridge/平台烟测两文件 5 项通过。阶段性 tsc 仍退出 2，174 条/63 文件，较上一轮减少 15 条；随后补掉同一平台烟测文件剩余的 push 返回值，未把静态修正冒充再次全量类型通过。

2026-09-23 FR-012 并行交付：A 完成 Profile 删除/无关编辑规则，Runtime+SQLite 定向 3 项通过，22 项未执行；删除本次失去唯一消费者的 AgentStore.hasSessionForProfile 实现/声明。B 完成 Setting 墓碑删除保留外部引用，共用 Store 语义涵盖扩展移除，三文件定向 3 项通过、18 项未执行，无迁移/保留开关。主代理核对实现，补前端 Profile current/stored ID 保留与不可用视图，相关两文件 6 项通过；共享 issue 同步实际完成范围。没有重复跑子代理测试，未做真实浏览器、真实 Provider 或全库验收。FR-012 尚余 Preset 删除、扩展显式清理和 Tool/Setting 缺失投影。

2026-09-23 本轮增量：并行 A 修复首次 Narrative 提交准备失败后仍返回导航目标，保留输入/已创建 Timeline，受控 Hook 两项通过，未覆盖 Run 开始后失败恢复或真实浏览器。主代理补齐 tests/tsconfig 的 Ai Gateway 源映射和已有 Vite 类型声明；真实全测试类型诊断由 283 条/118 文件降至 189 条/67 文件，检查仍退出 2，FR-006 未关闭。并行 B 对 FR-012 剩余消费只读核对，未授权改变 Agent 执行器或公共删除语义。
目标：按用户已确认方向持续解决现有审查问题，直到完成或遇到确需用户决定的新行为/边界。

## 执行合同

- 修复口径与批次以[审查修复口径与施工顺序](../issues/audit-remediation-decisions-and-order.md) 为准，不重复恢复强引用删除阻拦、严格 Prompt Build、全局 GC 或持久草稿系统。
- 持续完成可执行工作；普通报错、定向测试失败和局部实现选择自行处理。只有未决定的产品/架构/权限/持久化语义变化或不可逆外部操作才向用户提问。
- 先核对每项当前实现与消费链，不把旧 issue、旧行号或旧检查结果当作当前事实。原有用户和并行任务修改保留。
- Agent/CodeAct 执行器及现有并行改动不覆盖；必要公共契约变更先核对归属。Website 在其自己的仓库更新源码与问题记录。
- 各批使用最小行为验证，只有类型/跨包入口变化才追加相应类型检查或构建。不默认全仓 lint/test/build 连跑。

## 首批写入范围

| 所有者 | 写入范围 | 验收 |
| --- | --- | --- |
| 主 Agent | `packages/blob-store/src/store.ts`、`tests/unit/blob-store/blob-store.test.ts` 与关联文档 | 同 hash 的两个 prepared 写入中，一方失败/丢弃不破坏另一方；已提交 metadata 的字节仍可读 |
| 子 Agent | `apps/studio-server/src/extensions/extension-state-store.ts`、新增同名 unit test，以及必要的独立临时 Server 重启测试 | 合法 state 能力保存后能重新加载，非法能力仍拒绝；不改真实配置 |
| 同一子 Agent 续作 | `packages/extension-sdk/extension-host/src/instance.ts`、`tests/contract/extension-host/state-subscription.test.ts` | EXT-LIFE-006：预取消 signal 不创建有效订阅；后取消和重复 dispose 正常 |
| 主 Agent 后续 | State/Prompt Resource JSON 与 Delta 的局部源码、现有相邻测试及关联文档 | 非有限值在写入边界拒绝，合法值/空键不受损；实施前核对共享校验是否已有 |
| 主 Agent 生命周期链 | `apps/studio-server/src/http/http-server.ts`、`apps/studio-server/src/main.ts`、新增 `tests/unit/studio-server/http-lifecycle.test.ts` 与 `tests/integration/studio-server/shutdown.test.ts` | BACKEND-ADV-002/006：停机取消并等待在途业务，下载中断释放源流，真实 Server 关闭不抢先关闭 SQLite |
| 同一子 Agent 客户端链 | `apps/studio-client/src/features/extension-renderers/model/client-extension-host.ts`、同目录 `use-client-extension-runtime.ts`、`tests/unit/client/client-extension-host.test.ts`，必要时新增单个 `use-client-extension-runtime.test.ts` | EXT-LIFE-002/003/005：清理异常不遗留其他注册，失效实例不能重新获取资源，旧 Catalog 响应不复活卸载实例 |
| 同一子 Agent 卸载链 | `apps/studio-server/src/extensions/extension-manager.ts`、必要时 `packages/extension-sdk/extension-host/src/host.ts`、新增 `tests/unit/studio-server/extension-uninstall.test.ts` | EXT-LIFE-004：失败卸载不破坏 Catalog/discovery/持久状态一致性，异常可诊断，重试及重建可恢复 |
| 主 Agent 凭据链 | `packages/secret-store/src/store.ts`、`packages/secret-store/package.json`、README、`pnpm-lock.yaml`、`vitest.config.ts` 的 Secret Store source alias、`apps/studio-server/src/main.ts`、`tests/unit/secret-store/store.test.ts`、新增 `tests/integration/studio-server/secret-cleanup.test.ts` | BACKEND-ADV-003/004：外部写入前持久化 key，提交原子移除意图，Engine 内在途写入不被 cleanup 误删；启动/关闭清理积压，失败可见，无明文落库 |
| 主 Agent 诊断链 | `packages/diagnostics/src/index.ts`、README、`packages/kernel/src/kernel.ts` 的订阅故障 ID、新增 `tests/unit/diagnostics/diagnostics.test.ts`、`tests/contract/kernel/kernel-rpc.test.ts` 的事件聚合回归 | BACKEND-ADV-007：总量 1000、单来源 100 上限；重复故障次数与最新上下文；不同订阅/模块不误聚合 |

不借首批修复调整磁盘布局、Schema 版本或媒体/扩展产品功能。子 Agent 不修改计划、Issues 索引或主 Agent 的文件；主 Agent 汇总验证证据，不机械重跑子 Agent 已完成的等价检查。

## 任务状态

- [x] 核对已确认修复口径、dirty worktree 与首批源码入口。
- [x] BACKEND-ADV-001：Blob prepared 回滚不再删除共享 finalized 字节。
- [x] EXT-LIFE-001：合法 State 授权可持久化重读与临时 Server 重建。
- [x] EXT-LIFE-006：预取消 State 订阅不再注册，代码与子 Agent 的定向验证已核对。
- [x] STATE-DATA-001/002、PROMPT-DATA-001：JSON 保真与空键 Delta，修复后定向验证通过。
- [x] BACKEND-ADV-002/006：HTTP 停机 drain 与 Asset 源流释放。
- [x] EXT-LIFE-002/003/005：Client Extension 清理与异步生命周期。
- [x] EXT-LIFE-004：Server 异常卸载的一致性与重试恢复。
- [x] BACKEND-ADV-003/004：凭据写入意图、依赖错误语义与生命周期清理。
- [x] BACKEND-ADV-007：诊断有界保留与重复故障聚合。
- [x] DOCUMENT-DATA-001/003、O-003：两种 Store keyset 与统一分页输入。
- [x] FR-018：Provider、Capability Profile、Agent Profile 客户端完整读页。
- [x] PROMPT-DATA-002：更新时间 keyset 与全量消费者稳定 ID 遍历。
- [x] CARD-FILE-001/002：媒体 MIME/字节往返与 ZIP CRC 完整性。
- [x] BACKEND-ADV-005：Provider 删除后的可读失效引用与手动重新绑定。
- [ ] FR-012 其余引用与 Prompt Build：Agent Profile、Tool、Setting、宏及历史消费。
- [ ] 按统一批次继续生命周期、数据读取、引用消费、前端及 Website；逐批补充实际结果。
- [ ] 将已完成问题的状态和证据同步原报告/索引，保留未完成项与验收边界。

## 验证与偏差记录

- Blob：新增 3 条回归先复现失败；修复后 `pnpm exec vitest run tests/unit/blob-store/blob-store.test.ts tests/unit/asset-store/asset-store.test.ts` 两文件 11 项通过。覆盖同/不同 Store 的相同 hash prepared 交错及原 Asset 消费；未执行完整 Card Apply/并行 HTTP 压测。
- State 授权：子 Agent 运行新建的 `extension-state-store.test.ts` 与 `extension-state-restart.test.ts`，修复前 3 失败/6 通过，修复后两文件 9 项通过。临时目录、真实 Server 接线、内存 Secret 后端；覆盖同进程关闭后重建，不声称独立进程或生产配置重启验收。
- 主 Agent 已核对授予能力的代码差异、测试覆盖与写集；未机械重跑同一测试。没有 Schema/version 变更或新兼容分支。
- JSON/Delta：新回归定向运行先复现 13 失败/1 通过/26 跳过；修复后 State Store、Prompt Resource Store 与 State Runtime 三文件 40 项通过，追加 Prompt Runtime 与树不变量两文件 7 项通过。覆盖值拒绝、合法扩展 JSON、假值 capabilities、空键 Delta 及重新打开 SQLite 重放；不迁移或清洗真实数据。
- EXT-LIFE-006：子 Agent 的 `state-subscription.test.ts` 修复前 1 失败/3 通过，修复后 4 项通过，主 Agent 已核对源码与测试写集，未机械重跑。
- HTTP 生命周期：`http-lifecycle.test.ts` 验证在途 RPC 取消后仍等待业务完成、SSE 异步 disposer 被等待、下载中/打开中取消释放源流与源读取失败清理。`shutdown.test.ts` 使用真实临时 Server、SQLite 和受控内存凭据后端，验证关闭等待后续数据库提交，重建后配置仍可读；不是系统 Keychain 或独立进程崩溃验收。
- HTTP 验证账目：初轮 Asset 两种取消确实失败，两个 shutdown API 测试在新增入口前失败；真实 Server 用例曾因测试导入缺少 alias、空凭据夹具被拒绝而失败/超时，这些不计作产品缺陷复现，纠正后通过。原 `assets-http.test.ts` 的完整上传/GET/HEAD 用例 1 通过、6 跳过。
- Server 定向 `tsc --noEmit --incremental false --composite false --pretty false` 仍仅报告已登记的两个 `agents.ts` 错误：Transcript 联合类型未收窄与缺少 `inspectProviderAccount`。未报告本次 HTTP 类型错误，但整个 Server 类型门禁并未通过；并行 Agent 执行器边界不覆盖。
- EXT-LIFE-002/003/005：子 Agent 的 Host 测试修复前 18 项中 6 失败、修复后 18 通过；Hook 受控 Effect 回放修复前 4 失败、修复后 4 通过。未运行真实 React 挂载、SSE 或浏览器验收，Node localStorage 警告未影响测试。
- EXT-LIFE-004：子 Agent 的临时 dev-link/State Store/真实 Host 与 Manager 回归修复前 3 失败、修复后 3 通过。卸载先持久化禁用并尽力 dispose 全部模块；有错误则保留包来源、授权、Catalog 和 discovery，明确未完成，可重试。未改 SDK/公共 RPC 返回结构；未验证 installed 文件删除、磁盘故障或独立进程。
- 凭据链：7 项新增回归先失败；修复后 Store 12 项、Keyring 入参守卫 1 项通过，Server 启动/关闭清理与停机两文件 3 项通过，Secret Store build 通过。覆盖外部写入前后中断并重开 SQLite、metadata 提交失败、同 Engine 跨 Store 清理交错、持续失败可见和旧 active key 保留。没有访问真实 Keychain，没有独立进程崩溃或多进程并发验收。
- Keyring 依赖已定向升级到 2.1.0，lock diff 仅涉及该包及其平台二进制包；本机 native binding 可导入，未创建原生 Entry。Vitest 增加 Secret Store source alias，避免生产组合根测试误用旧 dist。接口行为依据同版本上游源代码核对，不把 mock/内存后端测试当作系统钥匙串验收。
- Diagnostics：四项新回归先失败；修复后 Registry、既有 Kernel RPC 与文档诊断三文件 24 项通过，追加 Event Bus 1000 次事件、两坏订阅一好订阅回归 1 通过/13 跳过；Diagnostics build 通过。记录与单来源上限、聚合次数/最近上下文、身份隔离、clear 重置均覆盖；未测长期内存、极大单条 payload 或真实扩展压力。
- Document 分页：新契约在原实现上 36 失败/16 跳过；修复后两文件 65 项通过，Document Store build 通过。覆盖删除游标行、更新已读行、插入、事务内分页、筛选错配、页长改变与非法参数；没有改 Schema 或保留旧 OFFSET cursor。
- 客户端分页：Provider/Capability/Agent 三类 101 条结果与后页失败不发布半列表，加上原 Provider model 测试，两文件 6 项通过；Client 定向 noEmit 类型检查通过。测试驱动真实 Hook 函数及受控 React setter，不代表真实浏览器挂载或视觉验收。
- Prompt 分页：新分页/Runtime/Extension storage 三文件 10 项通过；追加稳定 ID 插入/删除边界用例后，分页与真实 Server Provider RPC 两文件 4 项通过。Application Data build 与 Runtime 定向 noEmit 类型检查通过。第一轮 501 项测试错误地访问 mapper 不输出的 `label` 字段而失败，改为真实公开 `version` 断言后通过，不计作产品缺陷复现。
- 消费边界核对：`listMappedResources()` 收完仍按 label 排序，`cloneConflictingPromptNodes()` 改稳定 ID 扫描；Document `listDocuments()`、扩展 Storage collector 原本已消费全部页。Card 删除与目录 Apply 的 commit 失效订阅、expectedVersion 和共享事务保留，不将普通动态列表升级或降级为快照合同。未执行全部导入/导出/删除的并发压力组合。
- Card 媒体：ZIP/目录媒体/Asset HTTP 三文件 38 项通过，覆盖已知/未知 MIME、SVG 同库再导入和目录再次导出、两帧 APNG 在 PNG 容器内字节保留。视频使用不透明测试字节，仅证明容器保真，不证明播放器、视频格式解码或浏览器视觉。
- Card CRC：加入中央目录/本地头/数据描述符校验及小体积 ZIP64 用例后，Card ZIP/PNG/Asset HTTP 三文件 41 项通过。存储和 deflate 正常包、流式包、同长度正文损坏、CRC 元数据损坏、重复路径与数量预算均覆盖。原增量解压预算保留，没有新增解压依赖或无界二次解压。
- 本轮 Server 定向 noEmit 检查仍仅有已登记的两个 Agent handler 类型错误，没有本次 Codec/目录/接线新诊断；不声称整个 Server 类型门禁通过。没有修改真实 Card、运行浏览器或访问外部媒体服务。
- Provider 软引用：Provider/Gateway 原有两文件 12 项通过；追加失效/健康混合列表、完全缺失 Provider、失败绑定不改变配置、显式重绑、创建与删除交错后，Gateway/真实 Server RPC/SSR 提示三文件 3 项通过。Runtime build 与 Client noEmit 通过。Client 初轮因本次新文案键与旧键重名失败，已改为独立键；重绑用例曾因替代账号测试夹具缺少必填凭据失败，补合法测试凭据后通过，没有放松凭据校验。
- 失效 Profile 前端使用受控选择而非自动匹配，原 ID/config 保留；无已注册 Provider 时 SSR 仍显示引用与配置。尚未进行浏览器选择交互、窄屏/长 ID 样式或视觉验收，不把 SSR 当作浏览器证明。
- 上一轮仅按用户要求整理审查口径和顺序；用户现已恢复持续实施，本轮从未验收 JSON/Delta 改动接续，保留所有并行修改。
- 后续批次仍未完成，不因上述通过将整体目标标记为完成。

## 已关闭专项

- FRONTEND-006：生产 Agent Chat 不再因 messages 为空替换成 Mock。原样例数组机械迁移到 `dev/preview/agent-chat-sample.ts`，新增并注册 `AgentChatPreview` 通过按钮向正式组件传入样例。删除模拟计时器与进度状态、按 mock ID 生成的时长和产物、没有真实 mutation 的撤销/审核控件及其孤立 CSS。真实 partial 消息驱动 Markdown 补全/显示，滚动监听真实消息更新。`agent-tool-collapse.test.ts` 两项通过，Client noEmit 与 diff check 通过；首轮发现本次删除后遗留的 streamCharLength 依赖，已修正。未访问真实会话/Provider，没有浏览器视觉验收或生产包体积测量。

- FRONTEND-016：保留空容器现有鼠标展开能力，左右方向键使用同一容器判定；空容器展开后 Right 保持焦点，Left 先收起、再次 Left 才回父节点。`file-tree-model.test.ts` 四项通过，含空容器/叶子的完整左右键序列，未执行真实 DOM/读屏测试。

- FRONTEND-015：搜索摘要统一 trim 后的定位/截取基准，按原字符长度映射大小写转换后的偏移，不改变排序或命中规则。`context-asset-search.test.ts` 5 项通过，覆盖原搜索行为及大段空白、大小写展开、emoji 前缀；没有增加依赖，未做浏览器验收。不宣称覆盖所有 locale 相关上下文大小写变换。

- FRONTEND-003：布局持久化白名单补入 `composerPinned`，复用原有读取清洗及默认值，不改 Storage key/version。`studio-layout-store.test.ts` 15 项通过，新增测试实际调用 Store 写入和 rehydrate，覆盖固定/取消固定两种值；内存 Storage 替身不等于真实浏览器重载验收。未访问用户实际 LocalStorage。

- FRONTEND-011 / FR-017：Prompt Resource State 三个 cache setter 在写入结果发布前取消精确 endpoint/query key 的在途查询，阻止旧读取覆盖修改、新增或删除。`prompt-resource-cache.test.ts` 三项通过，使用真实 QueryClientProvider/QueryClient 与受控响应，覆盖三类资源缓存、删除后旧数据不复活、另一 endpoint 不受影响和下一次查询可正常更新。取消保证结果不再提交，不宣称网络传输中止。测试最初遇到根目录未安装 Query 包以及不同入口造成 Provider context 不一致，最终显式使用 Client 已安装包的现代入口；没有新增依赖或修改全局测试配置。

### 草稿隔离与节点错误传播补充

Context Asset 的草稿、已保存资源和串行队列已按 endpoint 分组；切回原 endpoint 保留未提交输入，在旧 endpoint 请求完成后不写当前撤销历史。资源面板按 endpoint 重建，布局 workspace key 包含 endpoint；Explorer/Toolbar 创建的晚响应在卸载后不再触发选择。首次编辑版本取实际显示快照，防止远端缓存已刷新但屏幕旧帧仍可输入的交错。

节点命令已迁移严格 `run()`。终端提交/移动事件接住已全局报告的错误；创建、删除、复制在 Explorer 内处理失败且不切换选中项。两个工作台补齐已有重命名入口的保存回调，失败保持编辑。草稿和 Explorer 两文件 13 项通过，Client noEmit 与 diff check 通过；受控回调/Effect 生命周期不是浏览器 DOM、输入法或动画验收。FR-001 尚剩 Narrative 与终端调用分类核对；FRONTEND-002/010 仍需浏览器交互及完整草稿生命周期验收，不整体关闭。

- FRONTEND-007：Agent 创建链明确返回提交是否成功，表单只在成功时重置；失败保留草稿、pending 防重入且禁用编辑/取消。创建提交后刷新失败不冒充创建失败，仍选中新 ID 并报告刷新错误。写集为 Agent Profiles Hook、AgentPanel、默认内容调用方类型和两份 Client 测试；共享异步封装 FR-001 未关闭，其他 mutation 的 Promise 语义仍需逐链修复。受控 Hook/React 元素回调测试不等于浏览器挂载或人工视觉验收。
  验收：Agent Panel 创建与 Profile Hook 两文件 10 项通过，Client 定向 noEmit 通过。覆盖成功、布尔失败、Promise rejection、同帧重复提交、等待期间禁用和创建后刷新失败。Node 提示未配置 localStorage 文件，测试没有使用真实浏览器 Storage。

- SERVER-TYPE-001：在协作暂停后修复 Agent 恢复时的联合类型收窄，移除 `userEntry as any`；删除无 Runtime 实现且无消费者的 `application.providerAccounts.inspect` 分支；清理 AI Gateway 未使用类型导入。Server `tsc -b --pretty false` 和 `eslint src` 均通过，Agent Run RPC 单文件 5 项通过，覆盖有/无 partial 文本及非消息 observation。测试使用 Runtime 替身，不等于真实 Provider 续跑端到端验收。专项 MD 已删除，原历史失败记录保留为当时证据。

- STATE-DATA-001/002：Store 拒绝非有限数字及嵌套非法 JSON；合法空键的 checkpoint/Delta、修改、删除、重放和数据库重开均通过。没有新增业务字段白名单、Schema 版本或旧格式兼容。
- PROMPT-DATA-001：metadata/extra/capabilities 的创建、更新与读取维持 JSON 保真；嵌套节点同步校验，合法 `0`、`false`、空字符串和 `null` capabilities 不再被入库判断丢弃。
- EXT-LIFE-001 至 006：State 授权持久化、异常清理、失效实例注册、异常卸载恢复、Hook 晚响应和预取消订阅均已有对应修复与上述定向证据。这里的关闭不等于全扩展端到端或所有故障组合已经验收。
- DOCUMENT-DATA-001/003 与 O-003：保留首次插入身份的 keyset，内存/SQLite 统一页长与筛选绑定；游标不跨数据库重建/离线维护提供保证。
- PROMPT-DATA-002：普通更新时间浏览使用读取时边界，全量 Runtime 消费按稳定 ID；新插入项是否出现取决于其位于边界哪一侧，不承诺全集对应某一时间快照。
- FR-018：客户端 Provider、Capability Profile 和 Agent Profile 完整收集分页后发布列表，不改 Agent 执行器或模型选择政策。
- CARD-FILE-001/002：Manifest 保存媒体 MIME，ZIP 和 PNG 内嵌包保持素材字节，目录导出不再把非 PNG 媒体伪装为 PNG；CRC 不一致在领域导入前拒绝，不作为来源认证。
- BACKEND-ADV-005：删除 Provider 不扫描/阻断业务引用；Capability Profile 投影明确不可用，列表不整体失败，实际调用报错。显式重新绑定通过新目标 Schema 校验后保留 Profile 身份及原配置，不按同名账号匹配。此关闭只覆盖 Provider 子链，FR-012 其余领域仍开放。

按用户要求，已全部解决的 State JSON、Prompt Resource JSON 和 Extension 生命周期三份独立 Issue MD 删除，索引和方向文档改指本计划。后端生命周期总报告的七项现均有对应修复与上述验收记录，亦已删除；更广的 FR-012 继续由原全仓审查跟踪。

Document 分页、分页输入与 Prompt Resource 分页三份独立 Issue MD 同样已删除，验收记录集中于本计划；原全仓审查只标记对应项完成，不删除其中尚未解决的其他发现。

Card 文件往返独立 Issue 已全部解决并删除；正式文件化角色包说明同步了 MIME 和 CRC 契约。

## 凭据链实施边界

BACKEND-ADV-003/004 已按先持久化意图、再执行外部 I/O 的顺序实现，启动/关闭接入清理与失败可见状态。在途写入不会被同 Engine 的 cleanup 误删，不在持有共享 SQLite 写事务时等待系统 Keychain。

核对原安装的 `@napi-rs/keyring` 1.3.0 及其同版本上游 Rust 源码，删除错误被 `.is_ok()` 压成 `false`，读取错误被 `.ok()` 压成缺失；现有适配器无法区分不存在与不可访问。npm registry 返回 2.1.0，上游该版本 `result.rs` 已将 `NoEntry` 与其他错误区分。已核对未传 options 时的默认平台初始化及 `AsyncEntry(service, key)`、字节读写、删除合同，保持原 service 身份与数据格式；按此更新现有依赖，不切换平台后端，不访问真实钥匙串。

凭据意图复用现有 cleanup 表，不增加 Schema/version。每个 Engine 共享当前进程内的在途 key 集合，避免 recovery 与写入交错；多进程并发共用同一数据库不在本轮验收范围，不声称已提供跨进程租约。现有恢复方法仍返回已清理数量，通过实际生产调用者使用的失败回调报告未完成清理，不改变公共 RPC 返回合同。

## 下一施工单元

FRONTEND-012 实现已修复：Markdown 的 a/code/img/pre renderer 固定为模块级组件，动态代码块文案由私有 Context 传递，避免仅用 useMemo(labels) 仍因调用方创建新 labels 对象而重建。`markdown-renderer-identity.test.ts` 一项通过，验证正文和 labels 更新时 renderer 映射身份不变及真实 SSR 文案更新；Client noEmit、diff check 通过。未做浏览器复制反馈、换行状态与流式更新交互，保留人工验收边界。

FRONTEND-014 实现已修复：引用路由保留 resourceId，并贯穿 Preset/Setting 工作台选择；目标缺失明确提示，不展示首个资源。资源切换更新引用 URL，节点选择保留现有工作台交互。入口恢复资源编辑视图和详情面板。`resource-reference.test.ts`、`studio-route.test.ts` 共 12 项通过，Client noEmit 通过。纯路由序列测试不等于浏览器前进后退验证，刷新、窄屏与实际定位仍待人工验收。

FRONTEND-013 的预览卸载路径已修复：初次打开源码后，在当前文档组件生命周期内保留 CodeMirror，预览仅 hidden，返回源码 requestMeasure；初始纯预览不挂载编辑器。没有新增全局 EditorState 缓存或改变保存语义。`long-text-editor-session.test.ts` 两项通过，Client noEmit 通过；测试仅验证子树身份、隐藏状态与新文档挂载隔离，不冒充真实 DOM 的撤销/重做、焦点、IME 验证。代价是每个尚未卸载且访问过源码的文档保留一个编辑器实例，代码旁已标记。

FR-019 已修复：InMemory DocumentStore 的外层读写统一 FIFO；事务内直接使用 tx，错误重入通过 AsyncLocalStorage 立即拒绝。没有修改 SQLite 实现、Schema 或用户数据库。`document-store-contract.test.ts` 共 62 项通过，其中新增 10 项覆盖两种实现的并发回滚、四类后续写入、读隔离、revision/Changeset 保留和重入失败恢复。首轮新增测试错误读取顶层 changeset，修正为现有结果契约后重跑通过。

FR-004 已修复：Provider/Capability Profile、Agent Profile、Tool 的 RPC mutation 全链转发 RuntimeRequestContext；writeDocument 明确接受 actor/reason/correlationId/callId/parentCallId，delete 同步补齐。`mutation-context.test.ts` 通过真实 HTTP 与临时 SQLite 逐笔验证数据库 Changeset 和 Kernel 实际 data.changed/docs.changed 事件，含 Credential 准备/回写/替换/清理及失败补偿。Server 引用图类型构建通过。仅内存 Secret Backend，无真实 Provider、Keychain 或用户数据写入。首轮测试的事件 metadata 层级和 Secret 提交数量假设有误，按现有实现修正后通过；未改 Secret 生命周期实现。

FR-003 实现已修复：Card 选择与 Play 打开集中至 Narrative Hook，移除 registry 的异步列表/自动激活编排及 facade 重复刷新 Effect。列表来源包含 API/Card，选择与 Effect 复用请求；写入后的显式刷新仍强制新请求并抑制旧响应。详情和 Session 恢复验证选择代际/API，创建晚返回不激活或导航；显式 Timeline 深链接不被启动默认 Card 覆盖。`card-timeline-selection.test.ts` 8 项通过，Client noEmit 通过。测试使用受控 Hook 生命周期与 deferred API，不等于浏览器视觉/URL 历史验证。没有取消服务端已经发出的创建，也没有改普通选择和 Play 的创建策略。

FR-014 State 侧完成，Text Transform 侧待继续：State 快照归属于 API + target/refreshToken 来源对象，旧响应无法发布或作为新面板的保存输入。保存使用同步 request token 和当前编辑上下文 ref，拒绝错误 target，保存期间锁住当前编辑区，失败保留草稿并可重试；旧 API 保存完成不会清掉新草稿。`state-panel-source.test.ts` 4 项通过，Client noEmit 通过。测试环境提示未配置 localStorage 文件，没有访问用户 Storage。未进行浏览器焦点/IME 交互，不改变已有 source 切换时的草稿清空行为，整个 FR-014 暂不关闭。

FR-014 后续：Text Transform runtime inspection 侧已完成。使用 API/owner 与 source/phase/consumer 两层作用域，目录刷新有独立序号；inspection、默认 trace 和 override 每段 await 后均校验，结果与 override 同批发布。切换即时隐藏旧结果/版本/错误，旧 override 保存不触发当前来源刷新，同源重复提交被拒绝。`text-transform-source.test.ts` 6 项通过，Client noEmit 通过，FR-014 两侧实现修复完成。仍未做浏览器交互验收，也未把 scoped inspection 修复扩大为 Script/Rule/Extractor 所有编辑生命周期已经验证。

FR-016 已修复（fixed）：远程 Card URL 的 body 消费改为限量流读取，128 MiB 边界不变，超限立即取消且不构造超限 Blob/File；取消失败不掩盖超限原因。CharacterPanel 将 AbortController 绑定下载/卸载生命周期，保持 busy 期间不可 dismiss 的原行为，不新增取消 UI，不改变本地导入、文件名或 MIME 路由。原生 Response 复现显示旧代码在 8-byte 测试限制下先读完 16 bytes；新测试证明第一个超限块之后不再读取。`bounded-response-blob.test.ts` 10 项 + `card-operation-failures.test.ts` 4 项通过，Client noEmit 与 diff check 通过；独立调查和一次只读候选审查无具体残余问题，审查后重跑 14 项通过。网络仅访问临时本地 HTTP 测试端口，无外部下载或用户数据修改。未执行真实浏览器 PNG/ZIP 导入/卸载验证，不承诺网络缓冲及 Blob 分配峰值也小于上限。

FR-002 搜索子链完成：Preset/Context 的搜索值直接由 URL q 提供，删除本地镜像；路由构造遵循首次 Push、后续输入/清空 Replace，保留其他参数、Hash 和 History state。`studio-search-navigation.test.ts` 真实 Memory Router 三项通过。初次尝试的 SSR Hook 导航无法触发挂载生命周期，改测实际路由构造与 Memory Router；不把 SSR 失败当成产品回归或声称完成浏览器验收。Panel、Rail、关闭动作与原 Store 返回栈仍由主代理继续处理。

2026-09-23 用户明确授权两包并行实施：A 仅负责 FR-005 的 HTTP 请求读取及独立测试，B 仅负责 FR-008 的 State 路径/Binding/Store 及独立测试；共同 issue/plan 只由主代理更新。主代理保留前端导航写集，三者不交叉。A 只读核对发现扩展 ZIP 上限为 256 MiB（Base64 约 341 MiB）、Timeline Archive 无总大小合同，暂未改文件；已向用户提出 RPC 总 body 384 MiB 的容量决定，未获确认前不擅自限制。B 实施中，结果另行登记，不将派发当作完成。

并行 B 已交付 FR-008：只改 `state/state-contribution.ts` 和 `state/state-definition.ts` 四处继承读取，新增 `state-prototype-boundaries.test.ts` 与 `state-prototype-replay.test.ts`。既有 Pointer/合并/Delta 的 own-property 安全写入保留；此次补齐 Contribution、通配 Binding、Schema 和引用诊断，合法 own 特殊键/空键/null/扩展字段不被拒绝。B 报告新两文件加既有 state-operations、state-definition、state-store、state-runtime 共 6 文件/43 项通过，diff 检查通过；主代理定向核对交付文件与证据，没有重复跑同组测试。未运行全库、类型检查或 HTTP RPC/Agent Tool 端到端验证。该包无开放产品决定，FR-005 容量仍等待用户。

FR-002 后续已收口实现：导航 Hook 统一 openPanel/closePanel/togglePanel 和 Router back/forward；StudioPage 直接消费 route.panel，Rail/窗口关闭/跨面板入口不再直接改 Store。删除 Store 的私有 history/canGoBack/canGoForward/actions，仅保留 syncActivePanel 供布局投影；前进后退不伪造一份浏览器历史可用性，交由 Router 执行。关闭进入当前 Timeline/Branch，钻取目录本地返回及 Panel 开合动画保留；Header 的方向动画在 Router POP 后使用实际目标。close/toggle callback 稳定，避免普通渲染反复重置外部点击监听。Memory Router 四项通过，既有 route/layout/Header 共 21 项通过，Client noEmit 通过；真实浏览器刷新/前进后退、IME 与动画尚未验收。

并行续包：A 暂不处理未确认的 RPC 容量，转做 O-005 启动/测试文档与当前源对齐（仅 README/guide）；B 转做 FR-007 State/Text Transform 可见语言与 accessible-name（限定 UI/i18n/定向测试）。主代理继续独占 navigation/page/shell 和共同审查文档，禁止交叉写入与重复验证。

并行续包验收：A 的 O-005 修改授权五份 README/guide，报告 74 个相对链接目标、13 处测试路径引用及 diff 核对通过；主代理核对实际范围，未跑不相关 lint/test/build，不冒充启动验收。B 的 FR-007 修改 State 运行/配置面板、Text Transform、管线列表及两语言表，新增 SSR/i18n 测试；4 文件/37 项和 Client 定向 noEmit 通过，主代理未重复执行。FR-007 的 Character Group Dialog 和人工键盘/读屏仍待处理。B 另报告 State 配置装配预览的继承路径静态候选，主代理已索要具体证据，尚未将其认定为已复现漏洞或自行关闭。

主代理交付核对发现此前 FRONTEND-014 新增的 referenceUnavailable 文案使用单层 `{id}`，与既有翻译器 `{{id}}` 不符；仅修正两语言中的占位符，属于本次引入问题，没有另跑形式化测试。

FR-008 前端预览遗漏已确认，整体状态重新打开：B 独立内存探针证明 StateAuthoringPanel 的 setPreviewPath 可沿继承原型写入，deepMerge 可触发实例原型 setter。无需服务端保存即可由配置编辑触发。B 已获仅 StateAuthoringPanel + 新最小测试的修复授权，遵循 own-property 保真而非禁止特殊键。A 同时仅在 CharacterPanel 的 GroupDialog 区域复用公共 Dialog，保留 FR-016 下载改动；共同审查文档仍只由主代理更新。

FR-008 前端补包已验收：B 仅修改 StateAuthoringPanel 预览的路径读取/合并/安全属性定义，新增 `state-preview-prototype.test.ts`。与 State 面板既有测试共 2 文件/15 项通过；主代理定向核对当前函数及测试，没有重复跑测。配置解析器+组件 SSR 覆盖污染触发、全局及实例原型不变、own 特殊键/空键/null/普通预览，未操作浏览器。服务端与前端本轮已确认入口的实现修复完成，保留 RPC/Agent Tool 端到端与用户浏览器未验收边界。

FR-007 GroupDialog 补包已验收：A 仅替换 CharacterPanel 内的自定义 GroupDialog 为共享 Dialog、移除旧焦点/遮罩实现并清理对应 SCSS，父级分组与关闭草稿逻辑、FR-016 保持不变。`character-group-dialog.test.ts` 两项通过，主代理核对当前组件和测试，未重复运行。FR-007 所列代码修复完成，最终键盘/焦点恢复/读屏/背景隔离的浏览器人工验收仍开放。整个并行批次全局 diff check 通过；没有因此重跑全库或宣称其余审查项关闭。

后续并行分工已完成：A 修复 FR-009 当前 HTTP Origin/Content-Type 边界（不处理仍待用户决定的 FR-005 大小上限），B 修复 FR-013 Extension Host ownership 原子写入。两者写集分别为 Server HTTP 与 Extension Host/独立测试，共同文档由主代理维护。A 的实际 HTTP/认证检查 31 项通过，B 在真实 InMemory/SQLite Store 上的所有权定向检查 16 项通过；主代理核对关键实现并补齐旧停机测试的 JSON 请求头，生命周期检查 5 项通过。没有重复执行子代理已覆盖测试；未做浏览器 CSRF、动态扩展加载或 Kernel RPC 端到端验证。

主代理去重核对：O-004 当前 ZIP 解压 seenPaths 已拒绝重复条目，既有 duplicate manifest.json 回归及此前 Card CRC 41 项记录覆盖，补记关闭，不重跑旧测试。FR-015 原 Add Zone/Composition 全数组生产入口当前已从 Preset UI 移除，剩余 Zone/Composition 为只读详情，工作台 onChangeNodes 未消费；原 UI 复现归为不再适用，不建设服务旧入口的更新框架，也不宣称未来任意完整数组补丁自动合并。当前 draft/expectedVersion 行为的既有验证边界保持不变。

FR-006 包级测试入口子链完成：17 个遗留 package test 脚本改为 root + 实际测试路径，保留 Application Data/Runtime/Server 已正确入口；嵌套 Extension Host root 使用 ../../..，Core 不再指向不存在的 packages/core/test。结构化核对 20 个现有命令的 root/目标，无缺失、无残留 passWithNoTests；只改 scripts.test 字段，保留其余 dirty metadata。根 Vitest passWithNoTests 改 false；故意无匹配命令返回 1，Asset Store 包命令真实 3 项通过、Core 包命令真实 31 项通过。其余包未逐个执行，不能宣称全仓测试通过。修正 Ai Gateway contracts source alias 的优先顺序，更新 getting-started 的零测试说明；测试类型/lint/CI 仍属于未完成范围。

FRONTEND-004/005 实现修复：原 `FlipCollapse` 简化为局部 `ToolCollapse`，删除两个竞争 Effect、WAAPI、rendered 状态和动画完成回调，使用 CSS Grid 0fr/1fr 过渡。收起不卸载工具内容，inert/aria-hidden 排除不可见交互；reduce 下沿用上一批 CSS 规则关闭过渡。单工具/多工具统一层级，工具 key 保留 ID；工具组 key 改为首个 invocation 条目 ID，修复从末尾工具组转为回复前工具组时身份变化。

验收：`agent-tool-collapse.test.ts` 一项受控元素树测试通过，覆盖工具追加、回复追加的组身份、单/多工具子项身份、关闭后子项存在及 inert/aria-hidden。Client noEmit 通过，diff check 通过。未进行浏览器快速展开/收起、动态内容高度、滚动位置与视觉闪烁验收，因此两项保留待验收状态。保留 DOM 会增加折叠内容的驻留量，本次不宣称实现消息虚拟化或内存性能优化。

FRONTEND-009 CSS 接线已完成：Agent 面板及其后代/伪元素在根元素有效 motion 为 reduce 时关闭 CSS animation/transition；shimmer 取消透明填色和背景闪光，使用静态 text-muted。复用应用已有 system/full/reduce 解析及根属性，不增加媒体监听或设置。纯 SCSS 改动检查定向 diff，未跑无关测试；运行中切换、系统跟随和人工视觉仍待验收。JS `FlipCollapse` 在切换 reduce 时的在途动画取消及两个 Effect 竞争仍未关闭。

FRONTEND-008 样式实现完成：删除消息行 `outline: none !important`，为共享 treeitem row 增加 `:focus-visible`，使用 `--loom-color-focus` 与内收轮廓，独立于 selected 背景且不改变布局尺寸。只修改相关 SCSS 并检查 diff，未执行无关构建/测试；普通和虚拟树均复用该 row，但真实键盘、主题对比度和人工视觉验收尚未完成，因此不宣称全部验收通过。

### 已确认并实现：Narrative 正文持久化

用户明确保留正文编辑并要求持久化，随后确认：仅当前分支，保留后续消息与 State，不回滚、不重新生成、不重算，不影响其他分支。因此撤掉入口的建议作废，下文原调查仅保留为过程证据。

实现采用分支路径复制：Store 新增 `editBranchNode`，同事务校验 Head/原正文，复制目标及后续节点，保留后续内容/来源/State，只移动指定分支 Head。不改原节点 ID 对应内容、不新增 Schema；旧的 Agent 内部 `editNode` 调用未借机改语义，UI 使用独立的分支局部入口。Runtime、RPC、Client API 与 Hook 已接通，组件捕获开始编辑时的保存回调，等待成功才退出，失败显示错误并保留原草稿，pending 禁止编辑/取消/重复提交；正文首尾空白不丢弃。

归档接线是路径复制引起的必要修复：旧导入器要求分叉点始终在父分支当前路径，无法恢复保留下来的历史路径。现按校验并拓扑排序的节点/分支关系恢复空 Timeline，仍使用原归档格式及同一事务；新增缺失历史分叉点校验，不新增兼容版本。

验证：Narrative Store 原有 10 项、真实 handler→Runtime→SQLite 编辑/冲突/归档往返/数据库重开 1 项、受控前端保存成功/失败 2 项，共 13 项通过。Server 类型构建与 Client noEmit 通过。首轮集成夹具漏传必需 Prompt Store，修复夹具后通过；本次两个类型接线错误已修正。未运行浏览器 IME、视觉动画、长分支性能和真实 Agent 并发执行。复制与返回规模为目标后的路径长度，旧节点保留而不 GC；并发追加导致冲突是预期，不自动重试。整体审查修复仍未完成。

当前复核发现 `use-narrative-runtime.ts` 的 `editNarrativeNode()` 只有本地 `setNodes`，没有 RPC 或落库；旁边的 ponytail 明确声明只是视觉草稿。`narrative-timeline.tsx` 的 `saveValue()` 调用它后立即退出编辑。此前将这一处归因于异步失败会误导施工：这里并不存在可等待的持久化结果。

正式 `docs/architecture/application/data-capabilities-and-lifecycle.md` 定义 Narrative Node 不可变，Runtime 当前提供分支 Fork/追加相关能力，没有对应节点正文更新接口。因此本轮没有改写 Node、伪造 mutation 或把 Promise 包装视为保存修复。

原待决策问题已由用户确认的分支局部正文持久化语义解决，见上方实现记录。其他未完成 Issue 仍保留，整体目标不标记完成。

前端失败语义子链：`useAsyncOperations.run()` 记录状态后保留 rejection；新增明确命名的 `runReported()` 接住尚未迁移及 bootstrap 等终端调用，不改变其结果合同。Card 和 Agent Profile/Tool 已改用严格 `run`，CharacterPanel 的最终事件接住全局已上报错误；保存和远程导入成功后才关闭，资源绑定捕获失败并保留搜索。AgentPanel 的修改/删除回调明确 Promise 合同并在终端处理；ToolEntryEditor 原有局部 catch 现可达。Agent 创建保留“已提交但刷新失败不重复创建”边界。

本批四文件 18 项测试通过、Client noEmit 与 diff check 通过。测试执行真实 AsyncOperations/Card/Agent Hook 与受控 React 回调，覆盖原异常传播、全局错误记录、成功 void、保存/上传/导入失败不进入成功回调、Agent 创建/刷新失败和表单等待；未运行真实浏览器或服务端网络失败交互。FR-001 仍开放，下一步迁移 Provider、Context Asset、Prompt Resource 与 Narrative 的具体消费链；`runReported()` 不是这些 mutation 已修复的证明。

后续 Provider 子链已迁移严格 `run()`：ModelPanel/ProviderAccountList 明确异步回调合同，最终删除与创建事件处理 rejection；模型手动添加成功后才清搜索，等待期间的新输入不被旧成功结果清除，模型添加/连接保存错误进入局部 alert。AI Capability 表单和重新绑定沿用已有 catch，现在可收到真实失败。Provider/Capability 创建已取得 ID 后刷新失败继续返回该 ID，普通 Provider 创建在提交后即清已提交草稿，避免误导重复创建；配置更新和凭据更换不宣称原子性。

此子链 Profile Hook 单文件 10 项通过，新增两类创建失败/刷新失败与模型串行队列失败恢复用例；Client noEmit 最终通过。首轮类型检查指出本次错误提示的 JSX 放置错误，移动到两个 Provider 分支共有区域后通过。未执行浏览器表单/凭据/重绑交互，未访问真实 Provider 或凭据。FR-001 仍剩 Context Asset、Prompt Resource 命令及 Narrative 消费。

Prompt Resource 命令子链现已迁移严格 `run()`。资源工具栏的创建/复制/导入/导出处理 rejection 并显示错误；删除失败不关闭确认框，成功才解除选中。已提交的创建/复制/导入立即发布返回资源，后续刷新失败仍返回新 ID；删除已提交则立即移除本地资源，不把后续刷新错误误判为未删除。错误仍由 mutation reporter 上报；没有新增资源补偿或自动重试。ToolMountEditor 和 ResourceBindingDialog 的既有 catch 现在可收到实际失败。

验收：`prompt-resource-command-failures.test.ts` 六项通过，覆盖五种命令的写入失败和提交后刷新失败，以及挂载替换失败不发布新 mount；Client noEmit 通过。未执行工具栏浏览器交互。Context Asset 尚未迁移：当前工作台不消费 `nodes` 草稿、`setNodes` 覆盖草稿且异常分支恢复旧快照，客户端更新还未传编辑基线版本。下一施工单元联合处理 FRONTEND-002/010 与 FR-001 节点消费，避免只改 rejection 而继续丢失输入或覆盖 Agent 新提交。

编辑基线第一步已完成：Runtime 的单节点/批量更新输入、Client API 类型及 Server workspace handler 增加可选 `expectedVersion`，Runtime 原样交给现有 Prompt Store 原子版本检查。不新增锁、迁移或冲突框架；未携带版本的既有调用保持服务端读写窗口保护，不能视为客户端保护。

`tests/integration/studio-server/prompt-resource-version.test.ts` 两项通过，执行真实 handler → Runtime → SQLite Store，覆盖单节点和批量旧版本拒绝、Agent 新内容/版本不变、非法版本拒绝、读取新版本后成功写入。Server `tsc -b --pretty false` 通过。未经过 HTTP transport，前端尚未捕获首次编辑版本或发送该字段，FRONTEND-002/010 及 FR-001 节点链仍未完成。

前端基线接线已随后实现：Context Asset Hook 按资源保留首次编辑基线和节点 patch，远端刷新不替换脏草稿；保存时携带基线版本，本地已知远端改变则不发请求。失败后保留文本并阻止后续自动提交，显式重试仍使用原版本，不能强制覆盖。自身成功提交才推进草稿基线，只移除本次已提交的 patch，保留在途新输入。资源远端删除时，编辑视图暂留本地草稿；确认放弃后才移除。

两个工作台现在通过 `StudioResourcePanels` 消费 Hook 的草稿资源投影，远端资源库仍是独立权威缓存。工具栏增加明确的重试与确认放弃入口，不引入持久化草稿库、自动合并或版本迁移。`context-asset-drafts.test.ts` 六项通过，覆盖远端更新阻断、服务端冲突保留、连续排队版本推进、在途输入保留、远端删除、批量提交与显式网络失败重试；Client noEmit 与 diff check 通过。

未完成边界：Context Asset 的 `runReported()` 和其他节点命令终端尚待迁移；跨 endpoint/API 身份的草稿隔离仍需补齐，不能把同资源 ID 的不同服务器视为同一草稿。FRONTEND-002/010 暂不整体关闭，浏览器输入/失焦/IME、冲突后重试和放弃交互未验收。

生命周期、分页、Card 文件往返及 Provider 软引用子链已完成，可选 Setting/Tool 的宽松 Prompt Build 已局部实现，FR-012 其余引用消费仍待处理。旧 FR-005/016/019 的输入预算、导入与内存事务风险仍需复核，未被 Codec 测试顺带关闭。Server 两个类型错误已在后续协调范围内修复并验收；不据此宣称 Agent/CodeAct 执行器整体审查完成。整体修复目标未完成。

### Document 分页写集与验收

先处理 DOCUMENT-DATA-001/003：写集为 `packages/document-store/src/{pagination,sqlite-store,in-memory-store}.ts`、README 和 `tests/unit/document-store/document-store-contract.test.ts`。SQLite 改 UPSERT 保留 rowid，游标保存最后返回行的插入序号与筛选；内存实现按包含 tombstone 的 Map 插入序号对齐，不新增 Schema 或兼容旧数字 cursor。默认 100、最大 1000，拒绝非法页长/游标及筛选错配。定向契约覆盖删除游标行、更新已读项、插入、过滤、事务及两实现输入一致性；其他批次不借机修改。

FR-018 消费端写集：`apps/studio-client/src/shared/api/collect-pages.ts`、Provider Settings 与 Agent Profiles 两个 model Hook、`tests/unit/client/profile-pagination.test.ts`。分页结果聚合完整后更新列表，包括 Capability Profile 与添加模型前的 Provider 重读；不改 Agent 执行器或服务端 Agent 写入。

PROMPT-DATA-002 写集：Application Data 的 Prompt Resource `store.ts`/`types.ts`、Runtime `prompt-resource-mapper.ts` 与 `cards/workspace.ts` 的全量扫描调用、新增 `tests/unit/prompt-resource-store/pagination.test.ts`。普通浏览保留更新时间降序且使用读取时 keyset；全量集合扫描按稳定 ID，最终 UI 仍按名称排序。两种模式与筛选绑定 cursor，不声称跨请求快照或改造 Agent 搜索语义。

### Card 文件往返

CARD-FILE-001 写集：Server `codecs/card-bundle-zip.ts`、`resource-directories/card-directory-media.ts`、`main.ts` 的媒体导出调用，及现有 Card ZIP、目录媒体、Asset HTTP 测试。Manifest `mediaTypes` 保存原 MIME，未知后缀使用 `.bin`，已知 MIME 对应真实后缀；目录导出允许携带原素材，现有 HTTP 预览仍只接纳栅格图片，不增加 SVG/视频执行权限。验收包括同库 SVG 重导入、已保存目录再导出、PNG 内嵌 ZIP、APNG 动画块字节保留；不声称具备视频播放器或动画视觉验收。

CARD-FILE-002 同一 Codec 链新增 `codecs/zip-checksums.ts`，只读取校验元数据，fflate 继续拥有解压。CRC 针对中央目录及本地头/描述符一致性与实际输出字节；正式说明更新 `docs/architecture/application/card-bundle-files.md`，不实现第二套解压算法、远程认证或媒体执行。

### 失效引用消费

当前先实施 Provider → Capability/Agent Profile 链：`runtime/providers-runtime.ts`、Runtime/Client 对应 Capability View 类型、`widgets/model-panel/ai-capability-lab.tsx` 和两种语言文案，以及 Provider/Gateway 现有集成测试。删除 Provider 不因业务引用拒绝，不修改引用者；Capability 投影读取 tombstone 以保留可知的扩展身份，完全不存在时不伪造身份，返回 `available: false` 与缺失原因。存储错误、类型错配、Secret 清理与实际 Gateway 调用不静默降级。

前端在无 Provider 可选时也保留失效 Profile 的名称、引用 ID 和配置；已补 Capability 手动重新绑定入口，并同步 Runtime 输入、Provider RPC Handler、typed API、Provider Settings model 与 Inspector props 及 RPC Reference。新增 SSR 用例 `tests/unit/client/unavailable-capability-profile.test.ts`，扩展真实 RPC `profiled-ai-gateway-rpc.test.ts`。没有触碰并行 Agent/CodeAct 的 Profile 删除/执行实现，FR-012 其余部分尚不关闭。

### 已确认的协作边界

用户确认 Preset、Context Toning 和 CodeAct 的另一任务已暂停，等待本次 Issue 修复完成。当前任务可修改下述消费接点，但必须保留对方已存在的未提交实现，不借机重做上下文或执行器架构。先实现可选 Setting/Tool 缺失的警告与跳过，主 Preset、Provider 和存储故障仍明确失败。

继续核对宽松 Prompt Build 时发现目标消费路径进入已排除的 Agent 运行链：

- `agents/agent-turn.ts` 的 `composeAgentTurnPrompt()` 对 Timeline 的缺失 Prompt Resource 直接抛错，然后汇总 Setting 和 Preset 贡献。
- `agents/tool-loop.ts` 的 `compileAgentToolSet()` 调用 Tool resolution 后生成暴露列表，缺失 Tool 的宽松处理涉及执行能力与提示贡献的共同结果，不能只改文本模板。
- `runtime/agents-runtime.ts` 的 turn preparation 先读取 Preset，再组装工具与 PromptBuild diagnostics；该文件与 `agents/tool-registry.ts` 当前均有并行未提交修改。

写集为上述 Agent 构建入口、`cards/workspace.ts` 的定向缺失回调和 Tool trace，以及现有 Prompt Resource/Native Tool 集成测试。Store 读取合同不变，默认严格读取；只有可选贡献调用者显式接管缺失。其他审查项仍保留原范围和未完成状态，FR-012 不整体关闭。

本子链已实现：Timeline/手动 Setting 缺失时跳过并在 Prompt Build diagnostics 记录资源 ID，缺失项不进入 VFS 可见资源列表；主 Preset 缺失与存储读取异常继续抛错。挂载 Tool 定义消失时跳过暴露并同时写入 Tool trace 和总 Prompt Build diagnostics，不改变实际调用校验、Provider/transport 错误或注册执行器不变量。

验收：Prompt Resource Runtime 与 Native Tool Loop 两文件 19 项通过，Runtime 定向 noEmit 通过，`git diff --check` 通过。新增 Setting 用例用受控 Store 缺失返回证明构建边界与引用保留，Tool 用例在真实挂载后移除注册定义并执行真实 preview；未覆盖 Timeline 缺失的独立集成用例、前端警告显示和真实插件卸载全流程。首轮夹具缺少 `now`、试图通过严格编辑接口直接挂载不存在 Tool，已改正夹具；类型检查发现本次空值收窄问题，改用 `flatMap` 后通过。
