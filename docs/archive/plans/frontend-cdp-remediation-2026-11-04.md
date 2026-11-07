# 前端 CDP 审计修复准备（2026-11-04）

状态：已归档 / 修复已完成（2026-11-04）。第一批10项、第二批8项、第三批DATA-03/PERF-08/09已完成代码与定向验证；Vite已重启，RES-02当前页面已复验生效。后续PERF-05/06与宏预览初始就绪已收敛，原9项fixture前置失败现已排除（两文件11项通过）。用户允许并行；DATA-01已由用户说明属于旧契约数据，不要求增加兼容，本轮不转换。真实环境审计按用户决定延期。

后续更新：用户随后授权的FR-R06冲突恢复与FR-R01安装身份隔离已由[综合计划W2](../../workbench/plans/full-stack-audit-remediation-2026-10-26.md#w2-实施结果2026-11-04)完成，20项定向验证及Client类型通过；本页末尾此前的W2“未实施”是当时取舍，已由该结果接续。

来源：[审计证据](../issues/frontend-cdp-investigation-2026-11-04.md)、[CDP 方法](../../guide/frontend-cdp-diagnostics.md)。本计划承接修复顺序与待决定事项，不复制全部实验，也不把候选当成待修缺陷。旧公共控件五项已归档，不重开。

## 已确认的方向

| 事项 | 推荐方向 | 决定的影响 |
| --- | --- | --- |
| 正则执行与超限（PERF-08/09） | 保留当前 JavaScript 正则语义；同步计算需有可终止隔离边界；超限明确失败，不把截断结果当成功 | 隔离涉及运行时/打包边界，实施前另列最小设计；不擅自换引擎、禁高级语法或引入通用任务系统。具体初始预算由实现和验证确定，无需用户逐个选毫秒/条数 |
| 样本预览来源（DATA-03） | 明确显示并允许选择 Narrative / Agent；能确定当前上下文时作为默认，Agent-only 默认 Agent | 需要改变预览输入合同及小范围UI；避免继续隐含Narrative，也避免双跑所有来源 |
| 异常目录数据（DATA-01） | 与代码修复分开；先复核现状，若用户要处理，再备份并定向修复该份数据 | 不自动迁移/覆盖现有目录，不用通用旧格式兼容掩盖来源未明的问题 |

通知保留（RES-02）默认不新增历史中心或更换通知体系：先确认现有库正式能力与应用可控保留上限，释放退休记录带出的无用引用；若必须换库/改公开行为，再单独说明成本。当前四条合成记录证明保留，未证明真实页面已经卡顿。

## 第一批：先修确定的安全与正确性缺陷

这些不需要逐项产品决策；开工仍要复核拥有源码与并发修复状态，不能按旧行号盲改。

| 组 | 编号 | 最小方向与不可破坏的合同 |
| --- | --- | --- |
| 启动/循环 | BOOT-01、PERF-07 | 启动就绪发布不被被淘汰参与刷新永久卡住；提取器空匹配按Unicode码点前进，保留合法空匹配语义，不能仅加Promise timeout |
| 投影保真 | DATA-02、DATA-07 | 保留代码围栏/inline字面；既有包裹HTML恢复仍有效。已发布projection按输入/owner身份判断资格，不能只拦旧Promise晚回包 |
| 输入/输出 | DATA-04/05/06 | YAML边界拒绝不属于JsonValue的数据，避免静默null/空对象；KV parser保留自身字段；required只看自身属性，不禁止合法同名键 |
| 日志生命周期 | LOG-01/02 | 分页reset清本轮旧代记录；BFCache冻结与真正终止分开，恢复后日志可用，注意once监听消耗 |
| 失败资源释放 | RES-01 | 弹窗未打开时不留下无对端channel；保留失败反馈，实际已打开窗口仍按原生命周期管理 |

归属集中在 `features/extension-renderers`、`features/message-content`、`shared/ui/markdown-content`、`features/state-variables`、`features/log-viewer`、`main.tsx` 和 `packages/application-runtime/src/transforms/history-text.ts`。其中history-text同时拥有多项问题，必须由同一个执行者集中集成，避免多个Agent改同一文件。

## 第二批：缩减已证重复工作

| 编号 | 方向 | 验证/边界 |
| --- | --- | --- |
| PERF-03 | 启动同参数在途读取合并 | 保留真实重连/新修订补同步，不能直接删onConnected |
| PERF-04 | 资源列表queryFn→API→transport贯通取消 | 保留版本/旧结果抑制；明确Query消费signal后的卸载行为，正常保活面板不应无故丢缓存 |
| PERF-10 | 同rule step共享inputDigest | matchId逐字节不变；跨step文本变化须重算，无匹配不新增工作，不建全局缓存 |
| PERF-01/02 | 瞬态候选输入不重写不变持久内容；收窄无关订阅 | 保留候选编辑及提交行为；不承诺未经真实大消费者验证的UI提速 |
| RES-02 | 收敛退休通知保留 | 不改依赖私有数组，不因此重写通知系统；保留在场通知和详情操作 |
| CDP-01/02 | 按实际导航行为修语义；Enter只在正确列表上下文截获 | 小范围控件修正，不再开展新一轮UI巡检 |

第一批的明确缺陷与这些小范围成本修复可按文件职责并行；执行隔离/总结果预算另行设计，不和简单修复混成一个大PR。

## 第三批：经方向确认后处理计算预算

PERF-08需要真实可终止的单次执行边界；PERF-09需要候选/捕获总量及返回预算。必须说明预览与实际运行超限如何反馈，超限不能成功返回不完整结果。仅前端截显示、AbortSignal、ticket或Promise timeout不能替代同步计算终止与服务端总量限制。

用户已批准保留JavaScript语义及可终止隔离的方向，具体Worker/进程复用、打包入口和数值由后续工程设计收敛；第一批未实施这些变化。不修改正则语言以规避问题。

## 暂不混入修复批次

- PERF-05（总览时间键）与PERF-06（响应槽/在途工作）仍是候选，不是已量化泄漏或已确认无限后台并发。
- 单scope旧尺寸key、Inspector派生引用、整文件预处理、折叠reasoning、排序游标交错、范围扫描复杂度等留在审计前沿；缺实际规模/合同不能直接重构。
- 跨故事virtualizer复用已被真实实例重建反证，不按“缺key”修复。
- DATA-01是特定目录异常，未定当前writer缺陷；代码修复不自动包含数据迁移。
- 用户停止时最后一轮仅完成源码阅读：projector正常abort误报、旧direct ctx撤销后部分adapter仍可进入，均未动态确认；晚返回handle已有释放反证。不据此扩大执行范围。

## 修复验收与交付

每个职责完整批次集中验证：复用本报告原最小复现，优先防止死循环、旧状态发布与数据变形回归；有必要时添加少量长期保护合同的测试，不建新测试体系。

涉及类型/入口/打包时运行对应检查；涉及浏览器生命周期/Network/焦点则按原CDP路径复验。隔离Node证明不替代真实浏览器，开发页复验不等同生产构建验收。生产Origin与18121环境仍需按当前状态重新核实，不擅自改认证白名单。

每修复一批回填编号状态和验证边界，再归档已关闭证据；候选/数据异常/需要人工验收项保留。不要等所有问题一起修完才交付，也不要因为部分修完关闭整份报告。当前第一批代码与验收结果见文末；未修改既有业务数据、提交或发布。

## 第一批执行设计（已授权）

### 目标

关闭BOOT-01、PERF-07、DATA-02/04/05/06/07、LOG-01/02、RES-01的确定实现缺陷；不处理DATA-01，不混入第二/三批或未确认候选。

### 已核实事实与继承决定

当前工作区约482个跟踪文件有并发改动，必须在当前内容上增量编辑，不回滚/覆盖。history-text拥有Unicode空匹配与结构化提取两类根因；Markdown涉及两层前处理；启动与异步Renderer在同一feature但不同生命周期。保留JS regex语义、代码字面、合法特殊键和原持久化合同；YAML拒绝不可表达JSON值。没有新依赖、迁移、发布或真实业务写入。

### 最小设计与分工

| 执行者 | 精确代码写集 | 验收责任 |
| --- | --- | --- |
| controls_source | packages/application-runtime/src/transforms/history-text.ts；apps/studio-client/src/features/state-variables/model/state-variable-editor.ts；各自现有单测 | PERF-07及DATA-04/05/06，原核心有限样本与相关回归测试由该Agent验证 |
| editor_runtime_audit | apps/studio-client/src/features/message-content/model/message-segments.ts；apps/studio-client/src/shared/ui/markdown-content/markdown-content-model.ts；message-html/markdown-content-model现有单测 | DATA-02，两层代码字面保真及现有HTML恢复由该Agent验证 |
| recovery_failure_audit | apps/studio-client/src/features/extension-renderers/model/use-client-extension-runtime.ts；apps/studio-client/src/features/extension-renderers/ui/renderer-node-mount-host.tsx；对应现有测试，可增加一个原组件pending回归文件 | BOOT-01/DATA-07，启动竞态和旧projection归属由该Agent验证 |
| 主Agent | apps/studio-client/src/features/log-viewer/model/log-feed-model.ts；apps/studio-client/src/main.tsx；apps/studio-client/src/features/extension-renderers/model/renderer-session.ts；对应日志/会话回归与文档 | LOG-01/02、RES-01及最终集成/CDP复验 |

所有其他代码文件只读，确需扩写集先由主Agent解决冲突。无需子Agent级联。执行者保留已存在差异，不对自己文件之外的失败作顺手修复。

### 验收与验证

重要新合同允许在现有测试中追加小型行为回归，不引入框架/大量fixture。共享核心Unicode循环先在独立短超时进程确认可结束再运行测试；其余每个完整模块稳定后集中运行拥有测试。主Agent运行一次相关集成检查及浏览器复验，不重复已由子Agent可靠覆盖的全部研究。当前环境不能作为18121生产验收时明确写出。

### 未决问题

本批无须用户追加决定。跨线程regex隔离、预览来源UI、返回预算仍在后续批次；DATA-01不动。工程细节由主Agent收敛，遇到真正架构/数据边界才回传。

## 第一批实施结果（2026-11-04）

本批10项：BOOT-01、PERF-07、DATA-02/04/05/06/07、LOG-01/02、RES-01。均已修复；DATA-01没有修改/迁移/覆盖，其他批次不因此标完成。

| 编号 | 实际修复 | 验证 |
| --- | --- | --- |
| BOOT-01 | 当前catalog参与刷新成功也能发布首次就绪；要求目录数组与当前effect signal匹配，目录未加载时不抢先ready | 回归覆盖旧participation被淘汰、catalog held时scope变化；独立开发页正常移除启动遮罩，无强制ready |
| PERF-07 | applyRule/extractHistory共用Unicode空匹配推进，u/v代理对前进2个UTF-16单元 | 原函数独立5秒硬超时先确认u/v样本终止，相关回归通过；危险样本未发真实服务 |
| DATA-02 | 复用remark AST源offset保护围栏/缩进/inline代码；分段无改写时复用原tree，无token直接返回 | 50项相关测试；CDP原组件四围栏、双inline、普通三围栏code文本均保真；自定义tag分段26→26 |
| DATA-04 | YAML边界递归拒绝非有限数、Set/Date、循环和非JSON值；合法共享alias/空值/特殊键保留 | 相关回归；CDP NaN/Infinity/Set均拒绝，没有静默序列化转换 |
| DATA-05/06 | KV以自身属性创建保留__proto__；required改hasOwn | 原核心与相关回归覆盖特殊字段保留、继承名不满足required、自有同名通过 |
| DATA-07 | projection携带host/entry/owner/文本/surface/revision输入身份，异步pending时旧结果无渲染资格 | 原组件受控Promise回归及CDP：旧[OLD]发布后改DEF，新pending阶段显示DEF/anchor0/renderer0；1mount/1dispose、订阅0 |
| LOG-01 | 页间reset清已积累旧代items，并覆盖早先evicted gap | 现有日志测试补跨reset序列及merge最终仅新代的行为回归 |
| LOG-02 | persisted pagehide不永久close logger，去掉会消耗首次冻结的once | 真正全导航离开/back，pagehide/pageshow.persisted均true，原内存保留，恢复后实际logger闭包closed=false |
| RES-01 | 无window不创建channel；同contribution/scope只留最后失败摘要，成功重试替换失败摘要 | 既有会话测试含null/undefined失败与成功重试；CDP三次失败native BC创建0、summary1，dispose后0，window/BC覆盖全恢复 |

### 验证汇总与清理

8个定向测试文件，合计117项通过：history-text/state-variable-editor 32、message-html/markdown-content-model 50、use-client-extension-runtime/renderer-node-projection-lifecycle 15、log-viewer/renderer-session 20。均为这批关键行为和原有合同检查，不是全仓覆盖。

Client与Application Runtime两个项目的tsc --noEmit通过（临时buildinfo置/tmp，未重建/覆盖项目输出）；本批Diff空白检查通过。未运行全仓测试或发布构建，浏览器使用当前18011开发构建，未将其等同18121生产验收。

浏览器旧连接ID不可用后从当前inventory定位新Chrome连接，新建独立页，没有刷新/关闭用户页。原组件临时root全部unmount，BFCache监听/RemoteObject组释放，popup覆盖在同步finally恢复，验收页关闭。未向真实服务提交危险正则、未发模型请求或修改异常目录数据。没有提交/发布。

### 后续范围

第二批状态见下节；DATA-03预览来源，以及PERF-08/09隔离/总量预算仍待实施；PERF-05/06与其他条件候选继续保留，不因第一批完成自动关闭。后续按已批准方向推进，无需重复让用户决定普通工程细节。

## 第二批实施结果（2026-11-04）

用户授权继续第二批并行修复，普通工程细节自主收敛；DATA-01仍明确不动。本批代码覆盖PERF-01/02/03/04/10、RES-02、CDP-01/02共8项，第三批隔离/总量预算和DATA-03不混入。

### 分工与实际结果

| 职责 | 实际修复 | 主要验收 |
| --- | --- | --- |
| controls_source：PERF-03/04 | Timeline首次restore仍在途时首次连接复用同source读取；commit、重连、restore完成后的连接仍补读。资源list贯通Query→API→tRPC AbortSignal | 终态恢复/逆序/source切换回归保留；CDP响应暂停后cancel得到net::ERR_ABORTED、canceled=true，旧cache保持同对象，窗口无截断 |
| editor_runtime_audit：PERF-01/02 | 原单store保留API/持久格式，mode/candidate只走原内存set；query/scope/kind实际变化才persist，相同输入不改snapshot。GlobalSearchOverlay拥有候选/debounce/Query状态，App仅订阅query | storage spy确认candidate零写、kind正常落盘；原Overlay+QueryClient+Profiler确认候选/去抖/Query更新不提交query-only父层，正常query仍通知父 |
| recovery_failure_audit：PERF-10、CDP-01/02 | 同一有匹配rule step复用inputDigest，跨step重算且无匹配不算。移动按钮命名导航、关联稳定aside id并反映真实展开/拖动状态。普通按钮Enter只阻止cmdk传播，不取消默认激活 | crypto计数和golden ID回归；CDP真实搜索内部关闭按钮Enter后dialog0；390px导航label正确、controls存在，expanded/data-open均false→true→false |
| 主Agent：RES-02及集成 | Sonner无正式历史清理API，使用pnpm可复现小补丁在自身dismiss处释放记录及回调，不在业务层改私有数组、不引入通知体系/新依赖 | 实际Sonner API更新/单条及全部dismiss回归；真实Toaster自然到期退场后history清空；见下方开发缓存限制 |

PERF-03没有合并所有读取；测试中任意首次连接复用终态读取会破坏恢复，最终明确限定初始restoring。PERF-04消费signal后，最后observer卸载会按TanStack合同abort/revert；保活面板仍有App observer则不受影响，不再保留全应用离开后的目录下载来暖缓存。

### 依赖补丁与生效边界

Sonner仍为2.0.7，新增patches/sonner@2.0.7.patch、说明及pnpm patchedDependencies/lock hash。修改ESM/CJS两个发布入口，移除退休记录和dismissed-ID保留；活动ID更新、详情回调、退出动画继续走原UI，应用不需要的getHistory退休历史不再积累。没有手改运行中的私有数组或另建通知中心。

pnpm patch-commit从已有store复用，downloaded0，补丁可随安装重现。升级依赖需复核补丁。包管理器只增加此补丁配置/锁身份；已有其他任务差异保留。

**当前开发进程限制：** 共享18011仍提供旧Sonner预构建模块。独立页两条短通知退场后旧bundle仍保留2条，故不能声称当前开发进程的RES-02已浏览器复验通过。当前安装包及真实Toaster回归已通过；需重启该开发服务或新构建加载补丁后再做运行验收。为避免刷新用户有草稿的原页，本轮不重启共享服务、不清其缓存、不刷新用户页。

### 集成验证与清理

最终一次集成运行9份测试：use-timeline-session、prompt-resource-cache、studio-api、global-search、global-search-workspace、global-search-dialog、history-text、notification-retention、notification-toaster，**87/87通过**。先前各Agent测试有重叠，不相加虚报总数。

Client/Runtime两个项目tsc --noEmit通过。集成中发现内嵌read丢失string收窄，已通过read(id:string)最小修复并复跑42项职责测试，再次Client类型通过。相关Diff空白检查通过。没有全仓测试、生产构建、提交或发布；开发页CDP不等于生产验收。

浏览器搜索关闭需读取下一独立task确认React提交，不把press返回时dialog仍1误判失败；两个关闭按钮先定位cmdk内部按钮后验证。移动viewport已reset，Fetch模式清空、Network关闭；取消后Network明确ERR_ABORTED，暂停请求已终止。全局探针删除、独立页关闭，无业务资源/异常目录更改。正常页面读取不称零网络。

### 剩余

下一批：DATA-03明确预览来源、PERF-08可终止隔离、PERF-09提取总量预算。RES-02留运行生效检查；DATA-01继续不动。候选不升级为修复任务，也不恢复无限审计。


## 第三批执行设计（2026-11-04，已授权）

目标：DATA-03预览显式区分Narrative/Agent，PERF-08将真实同步正则计算置于可终止线程，PERF-09限制整次提取累计成本；DATA-01及未确认候选不动。用户允许子Agent并行，工程数值与入口由执行收敛。

已核实：18011实际为Vite HMR，18121无监听；18010为tsx watch后端，运行时包从dist消费。18011旧优化依赖需要重载。保持同Origin/同后端数据，重启Vite并force依赖优化，不新建业务数据目录、不刷新用户原页。

最小设计与写入边界：

| 执行者 | 写集/接口 | 验收责任 |
| --- | --- | --- |
| preview_source_batch3 | LoomScript预览UI/model及最小上下文调用，studio-api/RPC/runtime类型，transforms-runtime仅previewLoomScript方法 | 可选previewSource独立于脚本文本source；Agent-only默认Agent、上下文默认与明确选择；两来源过滤与旧响应抑制 |
| regex_isolation_batch3 | 新history-text-isolation/worker，transforms-runtime其余方法及import，narrative/projection与agent-turn/tool-response-protocol/tool-loop必要async链 | Node原生正则语义；预览与实际prompt/display/classify/project/extract隔离；真实terminate，有界并发/排队，源码与dist入口 |
| extraction_budget_batch3 | history-text.ts与核心预算测试 | 跨entry累计扫描/候选/捕获/结果/诊断预算，超限明确失败，latest-valid保留语义 |
| 主Agent | 服务运行、计划/审计/guide、最终类型与入口集成及CDP验收 | 不触碰异常目录；确认Vite HMR/补丁生效，类型与打包/线程入口联通，记录证据边界 |

正则线程初始预算2并发、16排队、5秒含排队总deadline、128MiB老生代；线程终止完成后才释放slot。只在输入可确认无正则计算时fastpath，避免无规则文本起线程；不引入通用任务系统/新依赖。提取默认扫描10,000匹配、5,000合法候选、1,000,000捕获UTF-16单元、2,000,000结果结构单位、100诊断，数值可由验证收敛；这些限制不是网络字节估算。超限禁止部分成功，线程间保留明确错误code/message。

验收采用原核心有限合法样本与真实worker超时/恢复回归，危险输入不发未升级共享后端；集中验证对应类型与实际dist入口，独立浏览器页检查来源交互及当前bundle。拥有职责由子Agent验证，不机械重复；主Agent处理跨模块新增失败与缺证据项。无新依赖、迁移、提交或发布。本节是执行合同，不代表已完成。


## 第三批实施结果（2026-11-04）

DATA-03、PERF-08、PERF-09均完成，DATA-01没有修改、迁移或覆盖。没有恢复无限审计、提交或发布。预算/运行合同已同步至[History Text Pipeline](../../architecture/application/history-text-pipeline.md#样本来源与执行预算)。

### 实际实现

- DATA-03：`previewSource`贯通样本UI、RPC及Runtime，与原脚本文本`source`独立；省略兼容Narrative。Agent-only默认Agent，其他按可确定上下文默认，无上下文Narrative；两处原预览组件允许选择、切换清旧结果并拦截晚回包。只运行所选target。
- PERF-08：一次性Node Worker执行完整纯投影/提取，2并发、16队列、含排队5秒总期限，128MiB old-space；线程终止完成才释放槽位。无规则且无提取器的安全纯路径保留同步。已接入preview、project/inspect/extract、Narrative三阶段采样、Agent prompt与classify；必要调用链转async。高级lookbehind、命名捕获/反向引用语义保留，不更换正则引擎。
- PERF-09：单Extractor跨Entry累计扫描10,000/候选5,000/捕获1,000,000 UTF-16/结果结构2,000,000单位/诊断100。匹配与全部编号捕获计量；latest只保存最优候选而仍累计成本。多Extractor任务另累计组合结果2M。超限code/details跨线程保留，明确失败不截断成功。
- 失败收尾：classification隔离失败不保存raw partial Narrative或adopt，原timeout错误与failed run-state仍保留。原有display可恢复诊断合同没有被扩大为所有错误静默成功。

### 验证证据及限制

关键定向集合6文件**87项通过**：history-text25、loom-script-editor5、loom-scripts RPC3、script-text-pipeline9、history-text-isolation4、native-tool-loop41。不同Agent的集合不重复相加。覆盖原核心预算/Unicode/特殊键、两个UI切换晚回包、真实RPC来源矩阵、原生高级regex、变换与提取灾难回溯、并发/队列/总期限、跨Extractor组合超限、真实runtime采样/project/inspect/artifact/extract、classification失败不写partial Narrative。

源码`node --import tsx`与编译dist纯Node均真实Worker smoke通过；Client/Runtime/Server tsc --noEmit通过。入口验证曾发现Node strip-only不支持新Error参数属性，已改显式字段；源码worker注册现有tsx以解析核心`.js`源码引用，dist无需loader。Vite生产构建3043模块成功，输出仅`/tmp/loom-batch3-client-build`，未启动生产端口；保留既有chunk大小/静态动态重复导入提示，不称生产浏览器验收。

**额外检查未全绿：** `tests/integration/application-runtime/narrative-output-loop.test.ts`6项在初始append→withTimelinePositions读取fixture缺失的narratives.listNodes失败，尚未到provider decode/classify；`narrative-projection.test.ts`3项在规则upsert前置处因classify混合phase或Blob Store未配置失败，未进入投影/采样。该扩展集合其余检查有通过，但不计入上述87；未做历史baseline，不能断言已证明全部为既有失败。不修改这些fixture，也不宣称全仓测试通过。

### 服务与CDP

核实时18121已无监听，18011实际已是Vite，18010仍为原tsx watch后端。根据用户授权停掉旧18011 Vite，启动`pnpm exec vite --config apps/studio-client/vite.config.ts --force --strictPort`，端口保持18011，HMR client 200。没有另建数据目录、修改Origin白名单、刷新用户原页或启动生产服务；原后端package watch自动消费当前dist。

当前独立18011页CDP确认HMR=true、自然startup移除，实际Sonner依赖hash从旧4c6c7908变3371ddb9。原Toaster中合成50ms通知创建history1，自然退场后该ID history0，RES-02在当前bundle生效。没有修改依赖私有数组。

通过CDP仅挂载原`TextRulePreviewDialog`与真实StudioApi，使用合成Agent-only声明（没有保存/启用）：默认Agent，输入待替换文字命中1并替换；切Narrative后原文保留、命中0。然后只对已证明可终止且当前已升级后端发送65字符灾难失败样本，约5056ms明确显示deadline错误且output为空；后续合法输入aaaa原组件恢复X/命中1。另一次合法API调用约262ms返回XX，不将此单次耗时外推生产性能，也不在无时间重叠证据时宣称与危险任务同时完成。

浏览器初次连接遇到paused-document/detached，恢复同一个自建页后完成上述验证；工具中断不算产品缺陷。探针root、globals与自建页最终清理，未覆盖用户原型/Storage/fetch或拦截真实请求。未触碰异常目录、真实草稿、模型调用或业务写入。当前HMR服务保留，便于用户直接体验。

### 仍保留

DATA-01按用户明确要求延后；PERF-05/06和其他未确认候选不因此转修复任务。界面主观视觉与真实模型生成体验仍由用户验收。三批已确认修复项不等同全站无问题，9项fixture前置阻塞如上保留。


## 候选与归档后续收敛（2026-11-04）

用户同意处理PERF-05/06，并要求查看归档后续有无可一并处理项；真实环境验证审计延期。DATA-01用户说明为旧契约数据，可选定向改数据，不要求旧格式兼容。本轮不触碰这些目录，不新增兼容/迁移。

### 最小执行范围与归属

- preview_source_batch3：use-dashboard.ts、studio-dashboard.tsx及一份Dashboard回归；关闭不产生新时间range，未选Provider不挂calls Query，保留重开当前时间、period/refresh与原缓存合同。
- regex_isolation_batch3：frame-channel.ts及既有iframe-channel测试；32槽绑定真实未结算工作，timeout只回复一次，不强制取消已提交写入，不引入队列或重试。
- extraction_budget_batch3：仅narrative-output-loop/narrative-projection两份fixture，补实际存储并使用当前公开规则合同，不修改生产实现或削弱断言。
- 主Agent：use-macro-preview.ts及use-studio-state.ts接线、宏就绪回归和文档；仅等待初始用户资料/资源Query结算，不删除真实失效依赖，不新增宏缓存。

以上职责已稳定完成后集中验证对应风险；各Agent只运行拥有测试，Client类型由主Agent统一执行。无需生产/浏览器/模型压力实验，不包含头像派生、完整源映射、导航消费归属或正文投递恢复。

### 实施结果

| 项目 | 实际行为与边界 | 定向证据 |
| --- | --- | --- |
| PERF-05 | 关闭保留range；重开、打开时period/refresh才捕获新时间，同次渲染直接使用新range。calls仅在选定Provider后挂载，返回保留旧缓存 | 原Dashboard+真实QueryClient：关闭不增hash/请求，无Provider零calls Query，重开当前range、period/refresh、endpoint隔离；2项通过 |
| PERF-06 | timeout保留实际在途容量与requestId，settlement才释放；超时/晚回不双响应，dispose清timer/listener不回包，不取消已提交动作 | iframe-channel/sandbox-renderer-protocol两文件17项通过；32超时后仍busy，结算1个才放1槽，ID复用与dispose均覆盖 |
| 归档宏预览就绪 | 首次user-profile及prompt-resource Query都结算后再inspect，失败结算也允许原服务暴露自己的结果/错误；后台refetch不关闭已有预览。保留版本、资源、selections、Run、上下文与显式刷新依赖，旧请求不得发布 | macro-preview-readiness/macro-selection/prompt-resource-cache三文件16项通过，含等待时参数变化、真实失效、晚回包与失败后刷新 |
| 原9项fixture失败 | output-loop传入原已创建NarrativeStore；projection补真实临时BlobStore，按当前脚本编辑→刷新采用、mount停用与delete验证生命周期；classify单独声明，Prompt断言使用当前实际贡献ID | 两文件11项全部通过；未删或放宽原核心断言，临时存储测试后清理 |

合计8文件**46项定向测试通过**，无重叠相加；Client tsc --noEmit通过，拥有Diff检查通过。没有全仓测试、生产构建重跑或现场压力审计；上批已完成的入口/构建不因本轮小项自动扩大覆盖。未提交、发布或修改真实业务数据，HMR沿用18011，用户原页不刷新。

永久不结算的Host操作仍占对应bridge槽位，直到该bridge生命周期结束；这是如实限制在途工作的合同，不以timeout假释放并发额度。其他bridge不受该实例容量影响。不承诺撤回超时前已提交写入。

### 后续清单的取舍

[归档后续](../../workbench/issues/audit-follow-ups.md)中宏预览初始就绪已在本轮实施。FR-R06设置版本冲突恢复仍是可处理的已确认项，但它与原综合计划W2的安装target身份隔离相邻，应在对应包中一并核实，不能仅按历史片段加按钮就宣布配置写入安全；原入口继续承接。头像缩略图、完整Markdown源坐标映射、FE-031跨常驻面板导航归属和D-01正文投递恢复各有独立合同，不混入本轮。版本化扩展缓存也需区分可变开发路径与不可变身份后再做；没有直接统一改immutable。真实Provider、发行/远端CI、物理断网及大数据现场验收均按用户决定延期。
