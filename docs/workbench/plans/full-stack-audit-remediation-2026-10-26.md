# 2026-10-26 综合审查修复与优化实施计划

状态：待实施；两项方向已确认。本轮只核查消费者与编写计划，未修改业务代码。

来源：[综合审查 Issue](../../archive/issues/full-stack-audit-2026-10-26.md)。审查报告已完成并归档，保存问题、复现证据与验证边界；本计划是当前修复与验收的承接入口，定义执行顺序、文件所有权和关闭条件。15 项确认问题、1 项精简与 5 项条件优化均未实施，归档报告不关闭这些后续。

## 目标与授权边界

修复综合审查的 15 项已确认问题，移除 1 项已证明无生产消费者的旧路径；对 5 项优化候选先取得适配当前工作区的证据，再决定是否进入实现。最终应保持媒体可用、安装身份隔离、编辑草稿安全、Run 恢复正确，并减少已经测出的重复读取与重复通知。

用户已确认：

- BP-01 保留 SVG 的上传、媒体显示和原始导出，在媒体 HTTP 响应处禁止脚本并隔离文档 origin。
- BP-02 采用同一 `changesetId` 下按 payload 字节拆分通知的方向，先核实消费者合同。
- 当前仅交付实施计划，不执行代码修复、迁移、提交或发布。下列工作包用于后续实施，不代表已实施。

基线为 Issue 记录的 `main` / `d3d4e7e934b1b47c4cb62d2e61906ce10852032c` 加当前未提交工作区。已有大量其他任务修改；开工只复核各包拥有文件的当前差异，不覆盖、不回滚。独立[官方扩展审查](../../archive/issues/official-extensions-audit-2026-10-26.md)的 8 项问题不并入本计划。

## 已核实事实：事件消费者合同

本节为 2026-10-26 的定向源码核查；不是新一轮运行测试。路径均相对仓库根。

| 位置 / 消费者 | 当前合同与行为 | 对拆分方案的约束 |
| --- | --- | --- |
| `docs/architecture/kernel/README.md` §6–7；`packages/kernel/src/kernel.ts` | 正式文档明确一次提交一次 `data.changed`，有 Document 操作再一次 `docs.changed`；两次 emit 在同一 observer 顺序执行 | 不能宣称现有合同天然允许拆分；实现必须同步正式文档和事件 definition version |
| `packages/data-engine/src/commit.ts`；`document-store/src/sqlite-store.ts` | 原始 `subscribeCommits` 交付完整 Commit Fact；observer 错误发生在提交之后，不能回滚已落库结果 | 只拆 Kernel 的事件投影，保持 SQLite 事务、Changeset、直接订阅者完整事实不变 |
| `packages/kernel/src/events.ts` | 每次 emit 生成独立 `eventId`；内置事件 payload 上限为 UTF-8 JSON 的 64 KiB；异步 subscriber 不串行等待 | 预算按最终 payload 计，不能按条数或字符串字符数估算；不能依赖异步扩展回调完成顺序 |
| `apps/studio-client/src/shared/api/data-commit-events.ts` | 当前丢弃 changesetId，仅把一条事件的 operations 传入回调 | 在此桥接层适配分片；不让每个 Hook 自建重组逻辑 |
| `features/narrative-runtime/model/use-narrative-runtime.ts` | Timeline/Branch 删除优先用整批 `.some()` 阻止读取已删除对象；Session 批次只要含 delete/create 等就走列表刷新，否则逐项 get | 业务回调必须继续看到完整的一批操作，不能逐片回调；否则后片删除可能晚于前片触发的读取 |
| `features/narrative-runtime/model/use-timeline-session.ts` | 命中当前 Timeline 的操作即刷新；本身不按 Changeset 去重 | 完整批次应只通知一次；FE-R02 另行缩减健康 Run 的历史读取 |
| `shared/api/extension-events.ts` | 一页共享一个 EventSource；连接恢复及晚加入已连接源都会调用 onConnected；末个订阅卸载关闭源 | 半批、断线、卸载要释放暂存；重新连接仍以权威读取恢复，不添加可靠重放承诺 |
| `apps/studio-server/src/extensions/extension-event-projection.ts`、`extension-application-adapter.ts` | Card 安装按提交版本、资源归属和安装身份逐操作过滤；空结果不投递；重建 payload；投影有 await | Card 可能看不到若干原始分片，不能等待全局 chunk count，也不能暴露全局分片计数或绕过权限聚合 |
| `apps/studio-server/src/server.ts` 的 SSE subscribe | 每个连接都注册 data→extensions 派生发布者；客户端扩展和 Script runtime 收到派生事件后失效/刷新，不依赖 operations | 应由 Server 生命周期唯一拥有发布者，按原始完整提交派生一次，独立于连接数、data 分片数 |
| `runtime/cards-runtime.ts`、`runtime/card-directory-sync.ts`、`extensions/timeline-participation.ts`、`extensions/narrative-activity.ts` | 直接订阅 Data Engine 的完整 Commit Fact；Document Store logging 为透传 | 保持直接订阅链不变，无需迁移为分片消费者 |
| `packages/extension-sdk/src/events.ts`、SDK Host、官方扩展与本地 `st-data-compat` / `the-world` 源码 | SDK 是通用 JsonValue event；检索未发现这些生产源码按 data/docs 的 changesetId 去重；The World 的 changesetId 来自 State 写入结果 | 没发现现有生产去重阻塞，但不能据此保证任意外部扩展兼容；须明确 SDK 失效提示语义 |
| `tests/fixtures/extensions/weather-station/src/index.ts`；Kernel contract tests | fixture 按 documents 命中增加事件计数；现有 Kernel 测试用小提交断言一次 data/一次 docs | 小提交保留单条；fixture 的计数是通知次数，不能当事务计数；补大提交与授权过滤合同验证 |

上述 `features/`、`shared/` 相对 `apps/studio-client/src/`；直接订阅表中的 runtime/extensions 相对 `packages/application-runtime/src/`。本次核查结论是：**需要适配桥接层并修订公开事件语义，不能只改 emit 循环。**

还有两处与预算直接相关的事实：

1. `packages/kernel/src/handlers.ts` 的 `docs.revertChangeset` 将数据库回滚与 `docs.rollback.completed` 的 emit 包在同一个 catch 中；完成 payload 同样包含全部 operations/documents。完成事件超限会在补偿 Changeset 已提交后抛错，并走 `docs.rollback.failed`。这是 BP-02 的相邻完成路径，源码确认，尚未新增运行复现。
2. 同文件 `toWriteDocumentInput` / `readString` 和 `packages/document-store/src/sqlite-store.ts` 的 `applyWrite` 未给自定义 Document ID/type 设置与事件预算对应的长度上限。因此理论上单个摘要也可能大于 64 KiB。但尚无实际调用或存量数据证据表明需要支持这种身份长度；这只记录为本次分片方案的适用边界，不新增长度限制、不扩展协议，也不阻塞实施。

## 最小设计

### A. 媒体响应隔离（BP-01）

所有权在 `apps/studio-server/src/http/http-server.ts` 的 Card media 与通用 Asset 响应入口。复用一个局部响应策略，明确包含不授予 `allow-scripts` / `allow-same-origin` 的 CSP `sandbox` 和 `script-src 'none'`；限制对象嵌入、base 与表单提交，具体指令以媒体兼容验证收口。保留已有 nosniff、MIME、字节、流式输出、HEAD、ETag/304 与普通图片/视频行为。

策略只应用于外部/用户媒体，不覆盖可信 Extension module 文件入口；不改上传 accept、不栅格化 SVG、不改归档内容。Card media 的 304 与 HEAD 也应携带一致策略。浏览器验证必须覆盖 SVG 在 img 中显示、顶层/iframe 打开不能执行脚本和读取宿主 origin、普通媒体与导出往返；HTTP 头断言不能替代浏览器安全行为验收。

Asset 当前有长效 immutable cache。新响应策略不能追溯修改已经缓存的旧响应；交付需说明验证的是重新取回的响应，不宣称已撤回所有历史缓存。若发布要求立刻撤回旧 URL 的风险，由发布任务制定缓存/URL 更新方案，不在本轮计划中暗改资源身份。

### B. 有界提交通知与唯一派生发布者（BP-02、BP-04）

以下设计修复已复现的大量正常操作导致总 payload 超限的问题，适用于每个 operation summary 本身可放入单条预算的提交。超大单项不在本轮新增支持范围内。

1. **Kernel 投影。** 在当前 Kernel/handlers 边界增加一个局部纯分片函数，不新建 Event Manager。小提交保留单条原形 payload；大提交保留原 operation 顺序，每片带相同 changesetId 及 `chunk: { index, count }`（index 从 0 开始）。每片 eventId 独立；correlation/call/source 保留。data 与 docs 分别计算自己的分片，docs 的 operations/documents 必须由同一组操作成对生成，不分别切数组。
2. **字节预算。** 对完整候选 payload 计算 UTF-8 JSON 字节，计入 chunk metadata、转义和多字节字符；从已注册事件 definition 读取上限或共用同一预算常量，避免两份魔法数字。分片构建避免反复序列化整个增长数组造成新的二次成本。不得截断身份、丢操作、提高全部事件上限、拆分真实事务或持久化事实。
3. **发送和错误。** 一个提交的同名分片按序同步 emit，但不要求不同提交的回调绝不重入/交错；data 与 docs 各自准备/处理失败，不能因 data 失败跳过 docs。发布失败进入现有 Diagnostics，并明确是“已提交、通知失败”，不得向调用者伪装数据库回滚。异常诊断只补可观测性，不替代完整通知的验收。
4. **前端批次。** `subscribeDataCommits` 暂存分片，在当前未过滤 SSE 流收齐同一 changeset 的完整 operations 后只调用一次原回调；无 chunk 的旧形 payload直接沿用现有路径。校验分片编号/数量和重复，保留原操作顺序。仅暂存尚未收齐的批次，以 changesetId 区分可能交错的提交，收齐立即释放；不建立历史 Changeset 去重缓存。晚订阅从中间分片加入、同批缺片/序号不连续或连接错误时丢弃半批并走已有权威刷新入口，禁止将半批作为完整操作回调；重连清空状态后正常刷新，卸载只释放状态与订阅，不启动新读取。暂存设置总字节上限；超限明确转权威刷新并忽略该批后续非首片，不缓存其全部操作或无限保存 ID 集合，后续完整新批次仍可正常消费。
5. **角色扩展。** 原始每片先经过现有 committed-version/owner/installation 过滤，空片不发送；不放宽任何 capabilities。Card 投影不透传全局 chunk count/index，保持授权范围内每条为独立失效提示，不承诺一次回调包含完整事务。SDK 文档明确：changesetId 用于关联，不能作为忽略后续通知的去重键；不能从“没有 chunk”推断授权投影包含整笔提交。已有 payload 重建正好提供这一边界，仅做必要的显式处理与合同测试，不引入跨权限重组缓存。
6. **派生事件。** `server.ts` 使用与 Kernel 相同的 `dataEngine ?? documents` Commit Source 建立唯一 `extensions.data.changed` publisher，每个原始提交仅 emit 一次 `{ changesetId }`。在 Kernel start 后、Extension Manager 初始化前安装；启动失败及 close 释放，避免重复 listen 注册。SSE 连接只创建 delivery subscription。这样不依赖“最后分片”或 Changeset 去重集合；不承诺派生通知与 data 分片之间提供跨订阅者全序。
7. **回滚完成。** `docs.rollback.completed` 使用同一 docs 摘要分片规则，保留 targetChangesetId；只有实际 revert 失败才发送 rollback.failed。通知失败与已成功的数据库补偿结果分开报告，不让用户因假失败重复回滚。回滚本身的 CAS、历史与结果结构不变。
8. **公开合同。** 将受影响的 `data.changed`、`docs.changed`、`docs.rollback.completed` definition version 升为 2，其他内置事件不变；文档说明 small single / large chunk / Card filtered 三种语义。现有 EventBus 按事件名授权订阅，version 是事实标记，不能声称升级 version 会自动替外部扩展迁移。正式 Architecture 在实现落地时更新，本轮仍保留当前事实。

### C. 编辑、运行与读取成本

- 安装身份采用已有 `ExtensionInstallationTarget`，所有配置读取/保存/删除与 React identity 一致。冲突恢复复用现有表单操作：用户可采用服务端内容，或在最新版本上显式重新应用保留的本地草稿；不能静默改 baseline 后自动覆盖。
- Card/State 编辑的基线由当前编辑器拥有：服务端刷新只同步干净字段/表单，dirty 内容保留。成功保存仅确认该次提交快照，不清除保存后继续输入的内容；切换 Card 则按新身份初始化。
- Run 的执行身份与当前界面选择分离。晚到的旧 Swipe 结果不进入新 Timeline 观察器，但不擅自取消已经合法启动的旧后台 Run。
- FE-R02 的判断移到完整 Transcript I/O 之前，只合并可确认属于当前健康观察 Run 的普通提交。必要的 Session 状态读、初始加载、外部编辑、终态与断线恢复仍走权威读；无法证明提交归属时不直接跳过。沿用当前 generation/source 校验，不另建历史缓存。

## 工作包、所有权与依赖

后续实施建议沿用主 Agent + 前端子 Agent + 两个后端子 Agent，但不要求为了并行再分裂相同文件。主 Agent 负责跨端事件合同、前端运行链及最终文档；前端子 Agent 负责编辑器；后端两个 Agent 分别负责 Runtime 与平台媒体/ZIP。所有执行者均须知道共享工作区存在他人修改，不覆盖或撤销；新遇到未记录的公共合同/权限/迁移选择交主 Agent，不自行扩展。

下表中的前端 `src/` 均指 `apps/studio-client/src/`，测试只允许改对应现有文件，必要新回归用例放同目录、沿用现有测试方式。

| 包 / 责任人 | 精确写入范围 | 必须完成与可观察验收 |
| --- | --- | --- |
| W1 平台媒体 / 后端平台 | `apps/studio-server/src/http/http-server.ts`；对应 `tests/unit/studio-server/http-lifecycle.test.ts`、`card-directory-media.test.ts`，必要的同目录媒体 HTTP 回归文件 | BP-01：两个媒体入口统一隔离；SVG img 可显示、顶层脚本被阻止；普通媒体、HEAD/304、原始导出保持。不得改扩展模块加载合同 |
| W2 安装配置与冲突 / 前端编辑 | `src/features/extension-renderers/ui/extension-workspace.tsx`、`extension-settings-form.tsx`；`tests/unit/client/extension-settings-form.test.ts`；需要的既有 extensions 四语言词条 | FR-R01、FR-R06：同包全局/A 卡/B 卡配置隔离；target 入读写和表单身份；非法 storage scope 不可提交；冲突保留草稿，明确采用服务端/重新应用后能继续保存；切 target 不串数据 |
| W3 Card/State/宏编辑 / 前端编辑 | `src/features/cards/model/use-character-profile-editor.ts`、`src/widgets/character-panel/character-panel.tsx`、`src/features/state-variables/ui/state-authoring-panel.tsx`、`macro-authoring-panel.tsx`；`tests/unit/client/card-editor-lifecycle.test.ts` 与必要同目录行为用例 | FR-R02、FR-R03、FR-R04：延迟 refetch 不丢另一字段/开场草稿；State clean 接纳同卡新版本、dirty 不被覆盖且仍提示冲突；宏 ID 在 updater 外一次分配，普通与 Strict 模式新增后选中真实行。不要以禁用整个编辑器掩盖时序 |
| W4 资源删除与草稿 / 前端编辑 | `src/features/prompt-resources/model/use-context-assets.ts`、`use-prompt-resource-commands.ts`、`src/app/studio-resource-panels.tsx`；`tests/unit/client/context-assets.test.ts`、`prompt-resource-commands.test.ts` | FR-R05：成功删除时显式撤销对应失败草稿；删除失败保留；其他远端暂缺资源的可恢复草稿不被批量抹除；刷新后不复活已删资源 |
| W5 Run 恢复与互斥 / 后端 Runtime | `packages/application-runtime/src/agents/tool-loop.ts`、`run-recovery.ts`、`packages/application-runtime/src/runtime/agents-runtime.ts`；`tests/integration/application-runtime/agent-run-recovery.test.ts`、`agent-session.test.ts`、必要的 `narrative-output-loop.test.ts` | BR-01、BR-02：所有 Session checkpoint 指向实际 assistant partial，保留 reasoning 顺序；冷恢复继续可写入且 Store 严格校验不变。执行登记/所有读取用同一个 AgentStore owner；processor 等待期切预设被拒，结束后正常；branch/Swipe 调用同 helper 不漏修 |
| W6 Swipe 与 Transcript 读取 / 主 Agent | `src/features/narrative-runtime/model/use-narrative-runtime.ts`、`use-timeline-session.ts`、`agent-run-observer.ts`；`tests/unit/client/use-narrative-runtime.test.ts`、`use-timeline-session.test.ts` | FE-R01、FE-R02、SIM-R01：A 创建晚到不能绑定 B；健康 Run 的普通提交不重复全量分页，终态/恢复仍完整读取；仅删除 releasePrimaryRun 及无消费者 import/re-export/专属 describe，保留真实恢复 helpers |
| W7 提交通知 / 主 Agent | `packages/kernel/src/kernel.ts`、`handlers.ts`、`events.ts`，必要局部纯分片文件；`apps/studio-server/src/server.ts`、`extensions/extension-event-projection.ts`；`src/shared/api/data-commit-events.ts`，仅必要时改 `extension-events.ts`；`tests/contract/kernel/kernel-rpc.test.ts`、`tests/integration/studio-server/extension-event-projection.test.ts`、`tests/unit/client/data-commit-events.test.ts`、`tests/unit/studio-server/http-lifecycle.test.ts`，必要同目录 SSE 集成用例；`docs/architecture/kernel/README.md`、`packages/extension-sdk/README.md` 的事件说明 | BP-02/04：按上文 B 整包落地；普通/大提交完整、Card 授权过滤不泄漏、前端只处理完整批次、多连接每提交各收一次派生通知、回滚成功不误报失败。BP-02 按本轮大量正常操作的复现场景验收；不宣称支持任意长度身份 |
| W8 ZIP CRC / 后端平台 | `apps/studio-server/src/codecs/prompt-resource-zip.ts`、`zip-checksums.ts`、`apps/studio-server/src/extensions/extension-package-installer.ts`；`tests/unit/studio-server/prompt-resource-zip.test.ts`、`extension-package-installer.test.ts` | BP-03：复用 readZipChecksums 与 node:zlib crc32，校验每个实际展开 entry；正常包往返通过，损坏包在持久写入/安装生效前拒绝。保留路径、数量、展开字节、descriptor/ZIP64 边界；Card streaming 解码不重写，CRC 不等于签名 |
| W9 工作过程本地化 / 主 Agent | `src/features/narrative-runtime/ui/narrative-execution-flow.tsx`、`narrative-communication.tsx`；`src/widgets/narrative-timeline/narrative-timeline.tsx`；`src/features/narrative-runtime/model/timeline-execution-projection.ts` 的固定标题消费链及 `src/shared/i18n/{zh-cn,en-us,ja-jp,ko-kr}/` 中相关词条 | FE-R03：沿用 t 和命名插值，按钮/状态/复制反馈/aria name 四语言一致；用户正文与 Provider 原始错误不翻译；不引入第二套文案框架 |

W9 的投影文案仅改固定 UI 标题的映射，保留语义 kind；投影文件只保留语义或文案构造所需输入，标题在已有消费层用 t 构造，不扩成全仓本地化。W2/W9 如同时触及同一词条文件，先由主 Agent 合并词条契约或顺序执行，避免共享写集。

依赖顺序：

1. 先 W1/W2 两项 P1；W5 的恢复/互斥可独立并行。前端编辑 Agent 按 W2→W3→W4 连续处理，避免同职责散落多人。
2. 主 Agent 先落实 W7 分片与消费者合同，再实现跨端通知；W7 的服务端改动与 W1 的 HTTP 测试共享部分测试文件，相关测试交接后顺序修改。W7 不等待 ZIP/编辑器全部结束。
3. W6 的异步身份修复可独立先行；最终请求次数验收在 W7 桥接行为固定后执行，避免旧单事件假设重复改测。SIM-R01 随 W6 一并收口。
4. 平台 Agent W1→W8；主 Agent 在 W6/W7 后完成 W9 与文档归档。每个包验收完成后才扩大到相邻依赖包，不重复全量审查。

## 优化候选的准入条件

这些是有具体入口的候选，不纳入“15 项缺陷已修”的计数，也不因源码循环存在就宣称用户可感知性能提升。需要的测量使用临时/隔离数据，不能读写真实用户库或调用付费 Provider。

| 候选 / 所有权与文件 | 先验证什么 | 证据成立后的最小实现 / 停止条件 |
| --- | --- | --- |
| BR-OPT-01 / 后端 Runtime；`packages/application-runtime/src/agents/session-summary.ts` | 已有 1000 节点调用数证据；补查 force/token/floor/Timeline Session 分支的语义等价 | 仅普通 Session 且 `!force && !tokenDue && allowFloorTrigger === false` 的不触发路径前移 return，减少无用来源/RecoveryPoint 读取；force/token/floor 和 Timeline rounds 保持。若存在必须执行的错误检查，保留它，不做宽泛提前返回 |
| BR-OPT-02 / 后端 Runtime；`packages/application-runtime/src/scripts/loom-script-resolution.ts` | 当前 target 数、mount/rule 目录读取次数；与并行 Script 更新后的 effective/adopted settings/revision 合同对照 | 单次 resolve 只读取一份 mount 和必要 rules，按 target/installation 分组，复用 effective 选择输入。保留公开 snapshot、pinned revision/缺失诊断/排序/disabled 输出；不做跨调用 cache，不未经验证删除二次 revision 存在性检查 |
| BP-OPT-01 / 后端 Runtime；`packages/application-data/src/agent/store.ts` 的 restoreTimelineEntries | 代表性线性/分支/工具历史的耗时、内存、祖先访问数；线性源码二次复杂度不等于已测卡顿 | 仅证据显示收益时复用连续段 tool state；保留 parent/sequence/ancestor continuation/tool 配对校验；禁止每 Entry 复制全 Map。若净复杂度或内存仍二次，停止该方案并记录，不修改 Store 校验换性能 |
| PR-R01 / 前端编辑；`src/widgets/character-panel/character-panel.tsx`、`src/features/cards/model/use-character-profile-editor.ts` | 多 Timeline 卡资料保存的 RPC 数/字节/耗时；先完成 W3 草稿修复 | 有实际收益再拆 Card/Timeline query key，并采用已返回 Card；创建/删除/显式目录刷新仍失效。不能拿它代替 FR-R02 正确性修复 |
| PR-R02 / 前端编辑；`src/features/observability/model/use-observations.ts` | 开启观测页后已加载分页/长 Prompt 的轮询量；确认服务端何时真正终结，是否仍有晚到更新 | 仅确认稳定终态后停止相应详情/完成步骤轮询，保留运行中、晚到数据与手动刷新；隐藏 Panel 已卸载不重复立项。终态合同不清楚则保持候选 |

Provider 更新内部参数收窄仅在相关模块本就需要修改时顺带评估，不安排独立清理包，不引入依赖/缓存管理器/新测试框架。

## 验收与验证预算

执行包负责人提交：变更路径、关闭的 Issue ID、一个能区分修复前后行为的证据、实际执行的验证及仍未覆盖项。主 Agent 验收跨包合同与新增疑点，不机械复跑已可靠完成的局部验证。只在重要契约缺少更便宜保护时补少量现有框架回归用例，不建设覆盖率工程。

- **编辑/身份：** 用现有 Hook/表单测试控制 refetch 延迟、target 切换、两次冲突保存、Strict updater；看可观察输入与请求 target，不断言私有 setState 调用顺序。FR-R02 同时覆盖资料和开场编辑。
- **恢复/互斥：** 真实内存/临时 SQLite Store + Fake Gateway；reasoning→partial text→失败→丢内存→继续可落库；processor barrier 期间拒绝切配置。现有真实 Provider/浏览器缺口继续保留。
- **事件：** 复用 Issue 的 700 对象事务场景，收集所有 data/docs 分片，检查每片预算、顺序、无遗漏/重复和独立 eventId；增加 UTF-8/转义边界、混合 Store、纯非 Document 提交、大回滚。前端验证删除操作在末片也不会提前读已删对象、断线/晚订阅不会交付半批。Card 权限投影验证某些片为空及异步投影交错，不等待全局 count，不含其他 Card/installation 的 ID/content。2 个 SSE 连接每次原始提交各 1 个 extensions.data.changed；零连接、断开再连、启动失败/关闭后不遗留 publisher。
- **性能：** FE-R02 使用既有 250 条/多页场景，健康 Run 普通提交不新增全历史分页；终态/恢复仍读取全部页一次，观察过程中外部编辑不被漏掉。BP-04 以派生帧/RPC 次数为证据，不把次数减少写成毫秒或帧率提升。候选需报告前后相同场景的数据与语义对照，无收益就不进入代码。
- **安全与导入：** W1 先验证 HTTP 合同，再对本地隔离媒体执行针对性浏览器行为检查（无需真实业务写入）；W8 用真实 ZIP 解码/隔离安装证明损坏包不生效，并复用既有正常格式边界。不得只 Mock 安全校验后声明通过。
- **类型与本地化：** target、event metadata、跨模块签名变更后，对受影响 Workspace 做一次类型检查；四语言词条使用现有类型/缺词检查。W9 不额外建设截图/视觉回归体系；人工只关注相关操作文案和可访问名称。
- **文档：** 实施完成在本计划按 Issue ID 记录处理状态及实际证据，归档报告保留审查快照；同步 Kernel/SDK 当前合同后，才将计划相应包标完成。全部完成再按仓库生命周期迁移归档，不能仅凭计划写好关闭 Issue。

本计划轮次只做文档链接/生命周期检查，不重跑此前产品测试，也不将审查时测试通过当作修复验收。

## 已知边界与停止条件

**单个 operation summary 超限：非阻塞的已知边界。** 源码允许超长自定义 ID/type，但尚未发现真实使用需求或存量实例。本轮不为此增加 ID/type 长度限制、数据清点/迁移或另一套全量失效协议。分片函数遇到无法容纳的单项应明确失败，沿用本包已有的发布失败诊断与投影隔离，避免无限切分、截断身份或把已提交结果报成数据库失败；该极端情况下不保证完整通知。只有出现实际调用、数据或明确需求，再单独评估支持方式。此前把它列为 W7 阻塞条件的要求撤销。

当前没有阻塞实施的未决产品方向。分片桥接、角色过滤、回滚完成与唯一 publisher 是已选拆分方向的必要配套；实施时如果发现必须更改上述权限/持久化/公共调用结果合同，应停在该包并报告具体证据。真实浏览器、Provider、发布与历史缓存撤回的未覆盖范围须如实保留，不能用本地测试或文档审查代替。
