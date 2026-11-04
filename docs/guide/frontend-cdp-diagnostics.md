# 前端 CDP 与 Console 实战取证

更新于 2026-11-04。供后续 Agent 直接接手浏览器审计；入口见[前端专项](audit-frontend.md)，问题输出见[审计流程](audit-workflow.md)。本文保存可复用方法，不是开放缺陷清单，也不额外授权业务写入或修复。

以下操作在本项目 Chrome + `mcp__cua_repl.js` 会话中实际使用过。浏览器 ID、端口、对象句柄、源码行号与协议支持均可能变化，接手时读取当前工具文档和现场，不复制旧句柄。相关案例见[持续 CDP 审计](../archive/issues/frontend-cdp-investigation-2026-11-04.md)；历史结果不证明当前构建仍如此。

## 1. 接入与每轮执行节奏

1. 阅读当前浏览器工具说明。若没有用户指定的 tab/browser，首次调用只执行 `await cua.getState()`；从返回库存选择浏览器与页面。用户指定页面时遵守工具的对应接入规则。上下文压缩后先 `await cua.rewriteDocumentation()`。
2. 通过 `cua.getBrowser({ id: 已观察到的ID })` 取得 browser；Chrome 按工具要求先 `browser.nameSession('🔬 具体任务')`，再 claim 页面。已有绑定继续复用，不因新用户消息重新选择浏览器。若旧browser明确不可用，先重新读取inventory；本次Chrome连接由1变4，确认新实例后再接入，不能反复重试失效ID或误动用户原页。
3. 优先保留原故障现场。只有需要刷新、拦截、改变网络或隔离实验时才创建自己的临时页；明确它会增加连接和启动负载，不能自动等同原页。不要刷新可能有草稿的用户页。
4. 从 tab 的 `capabilities.get('cdp')` 取得能力，读取 `documentation()`。支持 Runtime 不代表支持 Profiler、Worker target 或全部协议；一条命令失败不等于 CDP 不可用，不擅自另开调试端口或扩大权限。
5. 单个探针按“安装 → 一次动作 → 读数 → 撤销”完成。取得对象/API 后立即进入下一步，不停在方法枚举数分钟。每次动作先确认生效，再解释统计。需要连续取证时，短窗口反馈结果和下一项不确定性。

普通点击/输入优先语义 locator；Console/Runtime 用于页面真实 JS、计数和定向对象检查。`playwright.evaluate` 是受限的只读 DOM scope，不能假定它与 `Runtime.evaluate` 能力相同。操作后高层快照有时先于状态稳定；等待特定元素或核对 Runtime 状态，不把 `networkidle` 用于有常驻连接的页面。

并行Agent每人只操作自己的tab、使用独有REPL变量/探针名，不重置他人会话，文档由明确所有者整合。本轮并行时高层语义click曾返回成功却产生不符动作，根因未确认；出现这种情况立即核对目标页与命中，暂停native/共享焦点输入，改用自己tab的CDP精确DOM.click作非指针型状态实验。DOM.click不验证pointer覆盖/命中；需要指针证据另行隔离执行。不能把工具错位当产品缺陷，也不重复盲点。

当前服务与构建需现场确认。生产端口不可用时如改用开发构建，应标明环境；不要把开发耗时外推生产。另起预览被 Origin 鉴权拒绝，不是允许修改白名单或伪造代理的理由。

## 2. 先证明动作真正到达目标

按钮在 DOM、可见、有 handler，不证明点击已经落到它。先核对命中、disabled、遮罩、modal 状态和结果变化；操作超时可能实际已执行，读状态后再决定是否重试。

```js
// 在 Runtime.evaluate 的 expression 内执行；只返回命中元数据。
(() => {
  const button = document.querySelector('已核对的选择器');
  if (!button) return { found: false };
  const rect = button.getBoundingClientRect();
  const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
  return {
    found: true,
    disabled: button.disabled,
    hitTarget: hit === button || button.contains(hit),
    hitTag: hit?.tagName,
    openDialogs: document.querySelectorAll('dialog[open]').length,
  };
})()
```

本项目曾有启动遮罩覆盖已渲染页面，导致搜索/Token 按钮的“零工作”是假对照。还存在组件未挂载的前置门控：仅关闭遮罩点击拦截，不代表全局浮层已经挂载。先分清状态未就绪、组件未挂载和退出动画未完成；动画超时兜底只能覆盖已经开始的退出流程。

若在自己的页临时覆盖 pointer-events、媒体或样式来隔离实验，记录原值并恢复；明确干预范围，不能将干预后的成功记为正常路径通过。不要靠强改业务 ready / Store 状态掩盖启动问题。

## 3. Network：有界窗口、请求身份和响应暂缓

```js
await cdp.send('Network.enable');
const methods = ['Network.requestWillBeSent', 'Network.responseReceived',
  'Network.loadingFinished', 'Network.loadingFailed'];
const start = await cdp.readEvents({ methods, limit: 1 });
// 执行一个已授权动作。
let batch = await cdp.readEvents({ methods, afterSequence: start.cursor, limit: 300 });
// 保存必要元数据；hasMore 时使用同一 methods、afterSequence=batch.cursor 继续。
```

- 每个窗口检查 `truncated` / `hasMore`。启动模块和 Debugger 事件可挤掉旧事件；有截断就不能声称完整瀑布、总数或排行榜。完整 requestId 配对可支持该样本，不能补全丢失部分。
- 同端点不等于同请求；可在本地比较已有参数是否相等，只输出比较结果，不打印参数或正文。没有参数时不能用相似字节数替代。由调用栈定位发起者，不只看请求时间接近。
- 按 requestId 配对 response 与 loadingFinished。完成字节、decoded/body 字节、字符数量和 heap 是不同口径；HTTP 200 也可能来自缓存，另查 fromDiskCache、fromServiceWorker、requestServedFromCache。
- 响应头用白名单，只读 cache-control、etag、vary、content-type/length/encoding 等必要字段。不要导出全量 HAR、Cookie、认证头、正文或完整聊天。queryKey/queryHash 也可能包含原文，不能直接打印。
- Query 缓存与 HTTP 缓存分开；可变扩展文件的 no-store、版本化图标的 private immutable 不能混用。两次显式 fetch 都下载，不证明每次 React render 都会重新加载图片。

隔离响应到达前后工作时，可在已有支持下使用 `Fetch.enable`，精确匹配同源 URL、resourceType=Fetch、requestStage=Response。只暂缓已授权请求，不读取或改写正文；不要拦截 Document。先取事件游标，再发动作，尽快取得 `Fetch.requestPaused` 的 requestId。

用 `Fetch.continueResponse` 放行已知句柄。**把 patterns 清空只停止后续匹配，不会自动释放已有暂停请求。** 如果事件被挤出且句柄丢失，不能继续等应用；清空 patterns 后只在自己的无草稿页刷新或关闭以丢弃请求，并记录失败实验。不得刷新用户原页。请求已被 abort 时句柄可能报 Invalid InterceptionId，需用对应 loadingFailed/canceled 等证据确认，而非一概忽略错误。本轮环境的 `Fetch.disable` 不可用；这是能力限制，不是通用协议结论。

Network timing的dnsStart/connectStart/sendStart是相对requestTime的偏移，不是该阶段耗时：DNS用dnsEnd-dnsStart，连接用connectEnd-connectStart。requestWillBeSent到发送起点的间隔包含多个阶段，不直接叫后端CPU或精确socket排队。记录协议、connectionReused与白名单Connection响应头；开发代理Connection:close和模块加载负载不能自动外推生产。首次启动尚未稳定就刷新会额外叠加负载，需要稳定后对照且仍注明不是严格冷启动。

生产预览先查当前进程的非秘密Origin配置及代理Host规则，再构建/启动；preview承载生产JS不代表该端口已获session允许。只报告配置可推导的限制，不把未实际访问的端口写成实测403，也不改白名单或伪造代理。

### SSE故障实验的有效性

Network.emulateNetworkConditions返回成功不证明既有连接已断开。本轮offline模拟会使新HEAD请求失败，却未关闭已有OPEN的EventSource；先核对原生readyState/open/error和Network失败，再判断实验是否有效。恢复offline=false、latency=0、throughput=-1，不能将诊断限速遗留给页面。

需要隔离原生重试时，可在自己的无草稿页重载前，仅拦截已知SSE的Request阶段，取得暂停句柄后返回200 text/event-stream、只有注释的短body并EOF，随后立即清空patterns，让重试接真实服务器。先给现有实例安装被动open/error计数；这验证的是受控短流的原生错误/重试，不是物理断网或稳态长连接切断。直接dispatchEvent(error)只验证应用handler，可能安排断连timer，必须标明合成并清理；不能混称真实断线。Fetch事件的resourceType本轮可能显示XHR，结合实际EventSource实例和URL确认，不只看单字段。

同一EventSource重连时应对照监听器规模；最后消费者卸载后查CLOSED和监听器归零。Runtime.queryObjects特定prototype可定位实例，但可能影响GC，且RemoteObject/被动监听器会暂时保留它；结束后移除自己的监听器并releaseObjectGroup，不拿这个对象存活做泄漏证据。

通道超时与页面脚本取消分别判断：本轮一次awaitPromise等5秒超过默认3秒命令上限，页面计时器仍可继续。超时后先读当前状态，不重新触发同一业务动作；计数窗口优先短于1秒分段。若要调整命令timeout，先看当前能力文档/限制，不假设工具总超时等于CDP命令超时。

## 4. React、Zustand 与 Query：只取已有对象

优先使用已有诊断入口；确需内部检查时，可从 root 上现有 `__reactContainer$…` 对应 FiberRoot 的 `stateNode.current` 遍历 child/sibling，定位当前组件或 QueryClientProvider 的 `memoizedProps.client`。这是私有实现线索，不是稳定 API；形状不匹配时停止，不导入模块另造 Store/QueryClient、重新挂 React 或枚举整堆充当现场。

- Fiber 指向当前树，不能混用 alternate 的旧状态。Hook 槽位只能配合本次源码顺序定位，不写成永久索引。
- `useSyncExternalStore` 的 getSnapshot 曾位于 Hook `queue.getSnapshot`，不是直接读 memoizedState 就能统计；它也可能来自 Query，不全是 Zustand。
- Runtime.getProperties 可定向读取函数 `[[Scopes]]`：本轮从 `Closure (useStore)` 找到原 api。只读必要绑定、方法和计数，不输出整个闭包或 Store 内容。API 枚举不是通知/执行测量。
- 若加被动 `api.subscribe`，只计该额外观察者的回调，不能说总订阅数就是它。身份布尔、通知次数与有界时间足够；必须保存 unsubscribe 并执行。
- 对现有 QueryClient 只汇总 family、observer 数、status/fetchStatus、dataUpdateCount、gcTime、实体/字符量等。读取当前 data 引用比较，不为了计数 setQueryData、invalidate 全库或模拟业务写入。

函数执行、React commit、DOM mutation、layout、paint 逐层区分。被动 MutationObserver 的一批不是一次 commit；受控 INPUT 的 name/type/name 等中间赋值可能发生在关闭的 dialog。核对 open/getClientRects 与目标，不把隐藏属性更新叫正文重绘。oldValue 等于回调时最终值也不能直接认定业务赋值冗余。

新数组身份、相同内容键和新请求分别计数：本项目曾连续重渲染产生新 entries 数组并重复哈希，但稳定键阻止了新增投影请求。分组计数必须覆盖实际 scope 身份，不能把 kind+条数作为通用唯一键。快捷键引发局部状态更新也不证明被门控的浮层已挂载。

需要组件/函数调用数时，本轮支持 `Debugger.setBreakpointOnFunctionCall`，condition 仅做有界计数并返回 false，不暂停；这不是 CPU profile。DevTools hook 存在但 renderers 为空时，不能假称已接到 React commit。

需要源码入口调用栈而启动 scriptParsed 已丢失时，本轮可先用 `Debugger.setBreakpointByUrl({ urlRegex, lineNumber: 0, condition: 'false' })` 定位已加载脚本，从返回 location.scriptId 读 getScriptSource；核对实际编译行，再移除定位断点、设置目标不暂停断点。Vite TS 编译行和仓库行不同。locations 为空就尚未定位，不猜行号。只记录有界 stack/序号/布尔值，完成后 removeBreakpoint、关闭本轮开启的 Debugger。

缓存审计先确认实际所有者：一个功能可能由Effect/useState直接调用API，旁边的Query仅缓存选择配置；不能凭功能名发明inspection Query key。可在当前Fiber的Effect deps定向比较必要依赖与结果引用，但不能打印完整key/配置/正文。相同参数的显式“刷新”属于用户请求，返回新对象本身也不是缓存缺陷。

原生details折叠并不自动卸载React children；需结合条件挂载源码、实际转换调用与DOM节点数。对懒加载消费者，初次Debugger定位locations为空时先确认模块/消费者已到位再定位，不把空位置当命令不支持或猜源码行。

Query增长窗口同时记family内数量、observer、isActive、空data与gcTime。disabled仍可能占缓存并随时间键新增；observer>0不等于正在请求。含当前时间的key在开/关两边都变化时，需区分再次打开刷新语义、关闭时多余造键与空Query；小窗口增长且有GC合同不直接称无界泄漏。

读取函数[[Scopes]]中的primitive时，本轮发现旧scope句柄会保留旧快照；状态变化后需从函数getProperties重新取得Scopes链再读。Map等对象可读到实时内容，也不能据旧primitive判断恢复状态。先做一次已知状态变化的正向对照，再解释闭包计数。

内部对象识别要结合真实owner及其自有字段/原型形状；tRPC Proxy对任意属性都可能返回函数，单纯typeof鸭子类型会误认，不要靠调用未知方法试探。逻辑注册/监听集合在owner卸载后归零，比“旧host仍可达”更有判别力；探针自己的引用必须释放。

InfiniteQuery须分别验证首屏与真实“加载更多”，记录pages/items/observer/dataUpdateCount和对应请求；首屏的取消/回收证据不自动覆盖next-page链。晚到结果进入无observer旧缓存与重新挂载当前DOM是两件事，再进入同一个Query的正向对照可核实身份。

DevTools Console的getEventListeners等CLI helper不是页面JS内建；本通道includeCommandLineAPI也不保证可用。可Runtime取得window/document句柄，再用DOMDebugger.getEventListeners读取必要类型的数量/来源，避免反复执行ReferenceError。

引用统计分URI总数、Set后的unique、解析/类型过滤与最终type/id去重；参数变化的小批次和固定周期同参刷新不能混称重复。交替来自不同消费者的记录不能只拿“上一条key”比较，必须按真实scope分组。高引用密度合成的解析耗时不能替代当前小样本的全Hook/DOM成本。

异步Hook可取当前树原useCallback函数，把外部action替为本地受控Promise，验证调度核心而不执行真实写入：同时观察isCurrent/context、返回值、聚合pending和错误。旧任务settle仍减少pending是正常的；runReported捕获返回不代表自带latest/取消/对象隔离。合成边界与真实网络/卸载端到端覆盖分开。

递归转换入口次数常是对象容器调用数，不是输出节点数；分别统计输入根/总节点/DOM展开项。零调用需有原函数正向对照。比较微基准时核对是否包含输出计数/预热，保留引用的节点不等于深拷贝整个快照。

### 编辑器保活的反证

当前CodeMirror版本可从现有`.cm-content.cmTile.view`定向取得实例；这是版本相关私有线索，形状不符就停止。可有界包装原prototype的update/measure/requestMeasure/destroy保持Reflect.apply，比较“隐藏稳态”与“返回后正向工作”，再检查实例身份/数量。inView=false、observer.active=true与保留实例可以同时成立；没有实际回调/持续工作证据，不能据Observer存在称泄漏。结束必须恢复原方法，别让探针保留实例。

## 5. 取消、失效与回收必须分别验证

| 观察 | 能证明 | 不能证明 |
| --- | --- | --- |
| request/selection 序号拒收旧结果 | 当前发布受保护 | 合并在途、取消 HTTP |
| Query.cancel 后旧 data 不变 | Query 取消/回退行为 | 浏览器或服务器已停止 |
| loadingFailed + canceled + ERR_ABORTED | 浏览器请求终止 | 服务端已中断计算/撤销写入 |
| observer 从1归0 | 该消费者移除 | 关闭面板一定卸载、所有消费者归零 |
| QueryCache 不再包含该 Query | 缓存项移除 | 所有 JS 引用和 retained heap 已释放 |

本地 query-core 合同需随版本核对：未消费 signal 时，最后一个 observer 移除可允许请求完成缓存；消费 signal 会改变自然卸载行为。显式取消与卸载后的预热不是同一个合同，接 signal 也不是完全无行为变化的修复。revert 取消在有旧 data 时可能 resolve 旧值，无 data 时才 reject，不用 Promise resolved 判断 HTTP 是否取消。

`enabled=false` 不等于 observer 已移除，隐藏面板也不一定卸载。要测真实 React 卸载，可在自建页经已有 Router 做受控同文档导航，核对页面分支、observer 与 DOM；整页刷新会自动中止文档请求，不能替代 Query 取消测试。gcTime=0 仍需区分正在 fetching 与 idle；非零 gcTime 的短时保留不是泄漏，未等待时不宣称已验证定时回收。

历史扫描取消应同时看原AbortController.signal、原networkId的ERR_ABORTED、按钮稳定终态及切回模式后的page/query。取消浏览器请求不证明服务端扫描已停止。资源选择前先确认正文是否已随revision到达；只有一个同步文本的工作区，不构成异步双资源A/B样本。观察到curtain与未显示host并存时，还要核对visibility/navigation状态，不能直接当因果结论。

客户端 `useQuery` 中可能调用 tRPC mutate，例如展示投影。先读到最终 API/RPC 类型和副作用合同，不能因 Hook 名称就手工重放。只读请求的显式 fetch/refetch 也应标为受控探针，不冒称用户实际关闭/卸载路径。

对已确认只读Query，可用Fetch.failRequest注入一次transport失败，配对Network失败、Query failureCount/dataUpdateCount、rpc.failed与后续重试窗口；不要动认证或mutation。显式refetch恢复作正向对照；探针自行catch后无unhandledrejection，不能外推所有UI handler的错误边界。Query实例本轮使用getObserversCount，不存在getObservers；探针自己的TypeError/SyntaxError单独记录并从产品错误窗口排除。

## 6. Performance 与 Worker 的正向对照

先撤掉函数断点、Storage 包装等干预，再比较短窗口 Performance.getMetrics。保留 Timestamp 差与数据规模；ScriptDuration / TaskDuration 等是页面聚合、彼此有包含关系，不能相加，也不能归为某函数独占耗时。高层 fill/click 本身有调度开销；不同输入方式不是严格 A/B。等待500ms的窗口不是交互延迟，未见>50ms长任务也不是零成本。Profiler 命令本轮不支持时，明确缺少调用栈，不虚构 CPU profile。

统计timer/RAF时同时保留注册owner、clear与实际触发，不能把累计注册次数当同时存续或泄漏：Query回包后可能clear/recreate interval。隐藏稳态配合正常进入/恢复正向对照，区分两个feed的同stack与真正重复；安装晚于启动的包装不覆盖更早注册，也不覆盖iframe/Worker或递归setTimeout。方法包装全部恢复。

Worker 可短暂包装原 prototype.postMessage，用 Reflect.apply 保持调用语义；只按已核对的消息形状统计条数/字符量，回包计长度/错误布尔。保留原方法和新增监听器，禁止保存正文或打印完整消息。先用正常本地计算建立正向对照，否则“零消息”可能只是动作未执行。往返时间包括消息复制、计算、主线程排队与回调，不是 BPE 独占耗时。

取消不可中断已提交 BPE 时，保留任务槽直到回包、先清空客户端文本引用可以是正确设计。用现有函数和一个有界合成任务核对取消/超限，不制造队列洪泛或调用模型；区分合成探针与真实业务规模。页面 singleton Worker 存活不是泄漏；缓存上限、hash key 与 retained heap 字节也不能混称。

对真实日志等数据做纯计算采样时，先记录条数、输入序列化字符量与单项最大规模，只返回数量/耗时；不要输出用户正文。空查询短路与非空文本查询的成本不同，函数时间也不等于输入延迟，不能仅凭存在JSON.stringify就新增缓存。

对已经定位的纯计算，可在撤销断点后用现有函数/输入做有界微基准，返回耗时和规模即可。预热后的少量短文本只能用于当前样本的收益反证；不推导精确单次延迟、不外推长历史，时钟读数0不等于零成本。

审查已有测试时核对执行方式：renderToString 不运行 Effect；由SSR拿到Query options再手工fetch，可验证查询/返回合同，不能证明Effect中的100ms流式采样、清理和浏览器调度。没有活动Run时不为覆盖率调用模型；保留未测范围，换有独立证据的方向。

类似地，window.fetch 包装可能拦不到已绑定的 fetchImpl；本项目 createSessionFetch 会在 client 创建时捕获实现。包装无记录不能证明没有请求，优先对照 Network 或实际函数入口。

附件/预览入口失败时，先区分scan只列身份与open实际解码的深度。安全路径错误也可能来自索引引用缺失（例如undefined），不能直接称ZIP损坏或当前writer-reader漂移。用已有组件/目录catalog定位单一目标，仅检查字段存在性/类型，再对照当前writer/schema/reader；不读取正文、不自动覆盖目录或加兼容迁移。数据异常、当前代码缺陷与历史来源未定分别记录。

协议恢复探针可在共享source上额外建立只计数订阅，并从它的cleanup闭包取该订阅私有handler直接调用有界合成消息，避免向业务订阅者dispatch假data.changed。分别记pending批次/bytes、timer set/clear/fire/active和callback，不只看最后是否报错；自然超时与恢复后新批次作正向对照。撤销额外订阅后核对原监听器/连接仍正常，不触碰用户订阅。

分页边界先确认服务是否逐页读当前集合；游标分页不自动代表快照。可从现有已加载模块捕获纯核心函数，在本地用受控外部list响应验证“页间reset/evicted/游标不前进/预算耗尽”，不复制核心逻辑、不重启服务或向真实数据洪泛。此证据只证明核心行为与合同交错，不能冒充真实网络故障端到端复现；分页中途reset还要检查本轮已积累items，不能只看最终gap或此前展示集合。

iframe诊断分DOM可见、父层消息和子realm实际工作。Page.getFrameTree只见根并不能证明没有iframe；先核对DOM与通道暴露范围，空childFrames不能直接取下标。历史Target.attachedToTarget句柄可能已失效，需验证当前附着；有truncated时不推断完整子目标清单，寻址失败不等于整个CDP不可用，不擅自绕过sandbox/Origin。父层零高度消息也不能推出内部无测量；宽度变化没有引起实际高度变化时不构成正向对照，停止该推断并恢复覆盖。

资源拥有疑点先追真实调用者是否保存/dispose返回handle，再用原factory隔离边界验证创建/关闭余额。可在自己的页一个同步JS调用中替代window.open返回空，finally恢复，避免真实打开/执行扩展页；以local计数边界定位后，必要时用原生channel计数子类作对照并立即关闭。这个新隔离factory不能冒称当前App host已有泄漏；应核对单handle与全host dispose两种正向释放，不把失败路径余额和永久无法释放混为一谈。

跨窗口消息把随机私有channel名的身份与payload ID校验分开：在已知channel回调里注入wrong ID不自动证明跨会话可达漏洞。人工调用dispose前保存的handler绕过原生分发，closed port/channel抛错也不能单独登记真实晚消息Bug；需原生排队可达或正式协议依据。

异步mount停止探针可给合成source加只计数getter，先证明外部projection确实已开始，再dispose并让它resolve/reject；getter0、root无子节点和原iframe数不变可支持“守卫阻止后续准备”。等待Promise没有取消不等于晚到结果发布，更不能据人为未结算Promise推产品泄漏。

资源预算要区分等待响应的pending Map、仍在途handler和底层服务并发。超时删响应slot不一定取消工作；用原服务函数与小型本地port、可结算Promise验证边界时，所有工作最终settle，且不得向真实业务端口洪泛。外层32槽不能外推后端并发32；反过来，合成超时并发也不能直接称真实服务资源压力或允许取消未知写入。

流式字节预算可用原读取函数+本地原生Response/ReadableStream验证：刚好上限、声明超限、流式超限、cancel拒绝和源stream异常分别观察错误身份、underlying cancel次数与body.locked。不要只看最终Blob大小；已errored的stream不需要再次cancel。构造Response上的Content-Encoding不运行浏览器HTTP解压，字节预算也不是native网络缓冲/Blob峰值内存预算。

存储与目录审计先核对合同和真实字段：optional/best-effort存储失败未必违背持久化承诺，不能用吞异常源码直接立数据丢失Bug；source字段也可能只是Blob引用，需追到实际read/decode。没有新消费者/交错/规模时停止重复探针，按活跃报告的待测前沿选择下一步，不为续轮制造业务数据。

搜索审计先量当前consumer的props.nodes子树：全库缓存规模、实际索引规模、匹配结果数和虚拟DOM行数必须分别记录。索引包含正文不等于每次输入重新索引；先核对memo身份和deferred query，再决定是否需要大规模动态探针。

Zustand persist的partialize只限定保存内容，不自动跳过相同投影的写入。可用原partialize和未发布的隔离浅副本核对投影，并单独核对实际React selector；不要把持久化相等、Store通知和组件执行混成一项。没有真实set路径触发时，源码候选不能冒称实测写次数或性能收益。

Query恢复审计同时读当前QueryClient默认值与逐Query覆盖，不能按TanStack默认猜测本项目配置。动态refetchInterval可能是function，CDP returnByValue会显示为{}；返回typeof、observerCount、isActive和fetchStatus分别说明配置、观察者、启用与当时请求状态，不执行配置函数来“检测计时器”。pending状态也不自动意味着正在请求。

图片资源先区分data URL、File/Blob引用与objectURL，只对实际createObjectURL建立revoke配对；下载所需的有界URL保留不是永久泄漏。组件未按src重置状态的疑点，先查实际父级key与关闭卸载，证明正常同实例切换可达后再做故障交错。

后台调度先区分自续排RAF、事件唤醒的单帧和指针stroke周期；仅缺visibilityState检查不足以立性能缺陷。活动运行才有的计时器，没有真实Run就保留缺口，不能为审计调用模型。

认证恢复可用已加载原wrapper＋本地受控fetch验证，分别覆盖初始成功、401后成功、auth非成功/网络拒绝、auth期间abort及重放仍401。记录调用次数、返回Response身份、signal/reason身份和重放上限，不触碰真实cookie或制造认证写入；本地fetch边界不证明真实认证与网络中断。Resource Timing未保留模块条目不能证明模块未加载；若Debugger确认为精确当前模块URL，动态import该同一URL可复用module实例，避免加查询后缀加载第二份模块及其副作用。

静态资源观测不要假定Page.addScriptToEvaluateOnNewDocument可用；当前通道会拒绝该命令，失败调用中后续JS语句也没有执行。Network启动事件缓冲截断后，筛选为空不证明无请求；Resource Timing条数达到容量（本次250）也不是完整清单。可对照保留条目、document.styleSheets与FontFace.status，但不要把transferSize、encodedBodySize、decodedBodySize或duration混称实体重传/服务器CPU。两个font-face引用同一URL不自动意味着两次下载，unloaded状态也不能外推未访问页面。

长期缓存先核对条数与key总字符双重预算、覆盖计数和LRU命中顺序；模块Map跨卸载存在不自动是泄漏。连接client可能只拥有请求timer/listener，port关闭在外层factory；必须追到外层dispose后才判所有权缺失。并发任务修改了相关文件，不代表既有问题已修复，关闭问题前对照具体根因与对应动态证据。

导入计算先区分file.size前置检查、整文件读取、同步解析/编码、传输及服务端领域限制。服务端body上限不能替代浏览器预处理预算。Base64边界可用原函数和小型合成Uint8Array验证0/1/2/3及分块前后，返回长度和逐字节往返布尔，不调用真实导入/下载。单次计时尤其在Debugger启用、首次调用或启动期间不能直接当产品延迟；本次同一1MiB函数首值255.8ms、撤Debugger后23.9ms，混有预热/时点差异，不能归因其一或外推大文件收益。

流式成本按真实输入→React提交→解析→展示逐层定位；delta数量不等于提交次数，另一条投影链的节流不自动覆盖reasoning。折叠子内容不能免掉父组件在返回JSX前的split/map，但没有活动Run/规模证据时也不应直接立性能缺陷。错误解码则区分协议envelope与业务Schema；合法可选字段的空对象不是错误数据，类型断言缺运行校验需结合真实服务输出合同判断。

HTTP缓存判断必须按requestId配对ExtraInfo：本次原生图片的responseReceived.status=200，而responseReceivedExtraInfo.statusCode=304；requestWillBeSent看不到If-None-Match，requestWillBeSentExtraInfo却存在。不要把前者的200/缺条件头直接算完整实体重传；loadingFinished编码字节也不自动是图片大小。保留truncated/hasMore与观测窗口，DOM图片数不等于请求数，不清缓存时也不能外推所有revision URL都走同一路径。只返回条件头存在性，避免输出完整头或凭据；结束时释放临时事件引用。

订阅审计看最终snapshot而非中间表达式：map后join字符串、数字revision或稳定模块fallback可满足稳定性，内联selector本身不构成新snapshot。去抖审计则把组件key、timer/队列撤销、已开始写入与晚结果发布分开；旧scope已提交写入完成不等于污染新scope，不能只按mounted检查有无定性。

BFCache用真实全导航离开再back验证，记录pagehide/pageshow.persisted和原内存token；合成事件不能证明浏览器冻结恢复。恢复后PerformanceNavigationTiming.type仍可能是原navigate，notRestoredReasons为空也不能单独证明命中。避免先启用Debugger改变资格；命中后定向只读现有闭包状态（本次logger.closed）比发测试日志干预更少。persisted冻结不是永久销毁，且once监听即使分支return也已被消耗，修复建议需保留最终清理合同。

通知/队列保留分DOM、active和模块history三层；visibleToasts只约束可见数，dismiss不一定删除历史。可在独立页用2+2条短合成通知，确认真实组件挂载、自然到期与详情回调是否仍有引用，不读取真实详情或做洪泛。公开history可能是依赖设计，需区分依赖合同与应用无界保留需求；引用条数不是retained heap字节，也不等于当前性能瓶颈。没有正式清理API时不为探针直接改私有数组，关闭自建页释放该realm。

同文档BFCache恢复不等于原生连接重连；分别记录persisted、原EventSource.readyState、open/error事件、新SSE请求、业务补读及监听余额。连接持续OPEN且没有新open时，零补读不能直接称数据丢失，也不能从OPEN外推服务器仍投递。不要把日志根对象关闭扩成所有网络停止。

跨endpoint审计先找产品真实切换入口，再追父级key、旧闭包捕获的Query key与新实例ref。API对象身份变化不自动代表换服务；旧实例完成旧scope写入也不自动污染新scope。当前只有内部setter而无UI路径时保留未来重开条件，不用探针临时开放能力冒充真实竞态。

文本保真不能只断言segment.kind仍是markdown或没有iframe；同时比较input、segment.value和原组件最终code.textContent。用普通围栏正向对照、长短围栏嵌套及inline分隔符长度的小样本，区分分段前改写和语义预处理，避免同症状重复登记。可在独立页hidden容器挂载原组件，登记每个root后再render，最后unmount/remove；无需改真实消息或复制到剪贴板。Vite预打包CommonJS模块动态import可能只有default导出，先核对实际形状，不假定静态import转换后的named导出也存在。

有换行/反引号的合成输入优先用callFunctionOn arguments或结构化JSON数据传入，不手写嵌套表达式转义；SyntaxError意味着整段没执行，修正后再启动，不能报API已请求。对服务端样本预览先确认无持久/JS/模型副作用，再通过当前API只改一个合同字段做对照；启动后立即返回并读取同一pending状态，超时不重复发起。output原文/matches0/diagnostics0可能是来源targets正常筛选，需同时核对API来源构造与UI是否说明适用范围。

YAML到JSON审计要分别记录解析后运行时类型、有限数判断与实际序列化结果；“对象且非数组”的检查仍会放行Set，NaN/Infinity在JSON编码时可变成null。用原helper与完整配置入口对照，先补齐无关必填字段再判断深层类型保护；某入口拒绝根Set，不代表另一initial字段也拒绝。未真实提交时只报告边界变形及可达调用链，不宣称持久状态已经受损；测试专用helper也不能当真实整树覆盖入口。

树身份问题须追上游唯一性、导入clone与父级过滤；非法重复ID不自动代表产品可达。特殊键也须按名称空间区分：JSON Pointer允许根/空键及转义斜杠，宏点路径是另一合同，Script setting identifier可能允许constructor却拒绝空键/__proto__。先核对合法性，再看每层hasOwn、defineProperty或无原型容器；不能仅凭特殊字符串报问题，也不把末端0/false/null与继续穿越标量混称。可见行index若只负责访问当前visibleNodes、事件仍回传stable id，就不能按出现index字样判错对象。直接import无业务初始化的纯helper可用于隔离边界，但不能冒充正常UI已激活；脚本事件截断/点击无效时准确保留该限制，不强制ready。

怀疑Unicode零长度regex无法推进时，严禁先把危险样本发真实预览服务或在页面主线程调用完整循环。先用原生exec最多2–3步记录index/lastIndex，检查手工+1是否进入代理对中部并回退；再把原核心置可强制终止的独立Worker/子进程。父级先收到“原校验通过、已进入调用”的同步握手，再启动短deadline，区分导入慢与执行不返回；用ASCII空匹配、无u标志和消耗字符对照，终止并wait回收。old-space限制不是总RSS上限，父进程kill也不能写成OOM。外层Promise timeout无法中断同步死循环，不以长时间耗尽服务取证。

范围单位要追生成与消费：match.index/string.length和slice同为UTF-16时，不能只因表情占两个单元就判错位；零长度匹配推进则需要另看Unicode模式的码点合同。两路Agent发现同根因后立即合并验证分工，避免对高风险输入重复执行。

结构化提取用“普通字段/单独特殊字段/混合字段”和“required已存在/普通缺失/继承同名缺失/自有同名存在”分开验证。仅特殊字段触发parse_failed，不代表混合输入也会报错；普通{}赋值__proto__字符串可静默丢键，原型仍不变，不能直接叫原型污染。required里的in会包含继承属性，需与hasOwn实测对应，不扩大为要求完整JSONSchema。top diagnostics为空时也检查extractions/artifact内的诊断。

已确认某类执行器有不终止风险后，后续安全样本必须显式避开触发条件，并先在独立原函数进程结束，再送真实只读预览。声明式样本只有Metadata且API不执行JS/持久化时，HTTP POST仍可为RPC query；要按真实合同说明，不笼统写零网络或业务写入。

匹配次数/输入字符预算不是单次RegExp.exec时间预算；先看检查发生在exec前还是后，是否存在真正可终止的执行边界。可在独立原函数进程显式降低数量预算，用线性失败、嵌套成功、短嵌套失败作对照；危险失败样本始终不进真实服务或浏览器主线程。短deadline未返回不能单独叫无限循环，也不提供真实服务最长阻塞时间。debounce/ticket只管发送和发布，自动播放若有pending门控则不能误称持续请求洪泛。

加载失败审计分应用Promise缓存、React.lazy缓存与浏览器module map；确认实际重试是局部重置还是reload。只在成功后缓存和finally移除在途请求可排除应用自建拒绝缓存，但不能外推浏览器所有离线/旧chunk恢复成功。

输出预算先问限制最终文本、逐步中间量、匹配记录还是后续提取返回。用2字符输入→10字符中间量→0字符最终值，可验证检查位置而无需大分配；最终通过不意味着峰值有界，也不自动违背最终预算合同。非空消耗匹配仍可通过lookahead捕获每个后缀，4/8字符返回10/36字符；用小样本+源码证明返回放大后停止，不生成推导的极大结果。字符量、共享子串与heap字节分开。

Dialog懒挂DOM不等于父render懒计算：直接JSX children中的JSON.stringify先求值，children回调则由消费者决定执行。当前没有打开详情/没有真实规模时，只记录缺口，不把0挂载消费者当性能低的证据；前端截显示也不替代服务端响应总量预算。

重复计算可先计工作量而非计时：在独立进程包装原生crypto边界、仍调用原实现，统计同一合成输入被update的次数/字符，再finally恢复并比较原函数完整输出ID。Node builtin命名ESM绑定需同步恢复；包装不能修改核心或返回伪摘要。每匹配需要独立ID摘要，不代表每次都需要重新摘要共享全文；共享范围要精确到rule step，前序替换后的输入变化和无匹配零工作合同必须保留。小样本工作量证据不等于当前UI瓶颈或已量化优化收益。

异步UI审计要分“旧Promise晚回包被拒绝”和“新请求pending期间旧state仍可发布”。验证后者必须先让旧结果实际挂载，再更新输入、保持新Promise未结算，观察原组件是否混用旧range与新sourceText；只调用anchor helper或看到disposed guard不够。

虚拟列表分别记当前item key集合、measurements、elements与itemSizeCache差集；一个旧ID→number不代表保留正文/DOM或长期泄漏。ContentErrorBoundary.resetKey也不等于React key重建。先确认同一实例跨scope、disabled/measure清理路径和真实样本，再评估增长，不能用count0/缺消费者当低成本证明。

原组件交错验证可只替换外部projector Promise和叶mount服务，保留真实React state/Effect/Portal/DOM Range核心。先读到旧renderer实际挂载，再同实例更新源文本并独立读取pending窗口；最后resolve新结果核对恢复，记录mount/dispose、trackInstance/dispose、subscriber和signal余额。旧signal已abort仍可能旧投影state继续参与新渲染，不能混为同一守卫。

跨scope缓存一定比较实际virtualizer对象身份，不能只看父级无显式key；中间空态/路由条件也能卸载重建。单scope旧尺寸键与跨故事累计是两项不同假设，后者被反证不代表前者不存在，也不能反向扩大。正常导航还原选择不等于零请求/零UI持久写入。

## 7. 退出前清理与同轮沉淀

结束或中断实验前核对：已知暂停请求放行/明确终止；Fetch patterns 清空；订阅取消；Observer disconnect；计时器和新增事件监听器释放；原型/fetch/Storage 包装及媒体/viewport/样式恢复；删除探针全局变量；releaseObjectGroup；撤销断点和本轮开启的诊断域；关闭自建页，不关用户页。Debugger/CDP RemoteObject 和自己保存的数组也可能保留对象，不拿探针引入的保留当产品泄漏。

每轮 Issue 写事实、基线、数值、触发链、反证、覆盖缺口和清理结果；**同轮**将新发现的可复用方法或失败教训合并到本文相应段落。不要只追加日期流水账、重复已知限制、复制缺陷全文，或把候选升级成稳定工具能力。工具变化时更新能力限定；仅日志/超时未解释时不能登记为通过。

## 第一批修复复验补充

修复验收与继续审计分开：先用原复现证明反证已反转，再停止，不借修复重新拓宽范围。启动需真实curtain移除，BFCache需原persisted事件及当前闭包closed=false，代码需最终code.textContent，异步投影需新pending窗口没有旧anchor，失败弹窗需native channel与摘要余额。临时root/RemoteObject/监听/覆盖在同轮清理；危险旧正则先在可终止原函数进程验证，不直接重放到运行中服务。

依赖补丁的安装包测试通过不证明运行中的Vite预构建已更新。核对实际服务模块及自然生命周期，不按pnpm lock变动直接宣称页面修复生效。若共享服务仍供旧bundle，记录待重载，不为验收擅自刷新有草稿的用户页或清共享缓存。修复后Query取消以配对Network ERR_ABORTED及缓存身份确认，Promise resolved本身仍不能证明HTTP是否终止。


## 可终止计算修复与HMR复验

切开发服务前先核实监听PID、启动命令与页面`/@vite/client`，不能按历史端口或用户印象把Vite误称生产。用户授权切HMR后保持原Origin与后端数据；对应生产端口已无监听时如实记录，不另停后端。依赖补丁要重启并force优化后核对实际模块URL/hash与原生命周期，源码安装包测试不代替当前浏览器模块。重启HMR不要求刷新有草稿的用户原页，独立页适合验收。

危险regex先在真实可终止Worker/独立进程验证，再确认共享后端已消费当前dist，才可发送有限的无持久化预览样本。源码tsx和dist纯Node两个入口分别证明：源码`.js`引用/TS参数属性可能只在真实worker启动时失败，不能用tsc或mock Worker替代。线程内预算异常跨消息后要保留code/limit/actual，不能变成无提示的空结果；组合多个提取器也需检查总返回预算。old-space不是总RSS限制，UTF-16/结果结构单位也不是字节。

预览来源复验可在自建页临时挂载原组件并调用真实StudioApi，用只声明不执行JS的合成源码：Agent-only默认Agent并命中，切Narrative后命中0；不需保存/启用规则或改真实聊天。清除旧结果、晚回包抑制和真实来源筛选是不同合同，分别用原组件交错测试和API结果验证。隔离超时后检查明确alert、无partial输出和下一合法输入恢复；主线程响应的并发判断需要明确时间重叠，不按两个顺序请求耗时宣称并发。临时root即使Portal渲染到body也必须unmount，删除globals并关闭自建页。

工具的paused-document/detached失败先区别于应用异常；恢复同一自建页后继续最小验收，避免长时间重复挂起的Console调用。额外集成检查在fixture前置失败时列出阻塞阶段，不计为通过；没有baseline时不把推测写成“已证既有失败”，也不为交付全绿扩大清理范围。
