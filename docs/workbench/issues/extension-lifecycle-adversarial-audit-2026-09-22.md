# 扩展生命周期与清理一致性对抗性审查

日期：2026-09-22  
状态：Open Issues，待修复  
范围：Server Extension Manager/State Store、Extension Host、Client Extension Host 与加载 Hook。  
来源：同模型子智能体独立只读审查；主 Agent 整理，未重复独立运行探针。

## 结论与证据边界

共 1 项 P1、4 项 P2，基于当前含未提交修改的工作区。子智能体执行五类隔离探针，未修改仓库业务实现或真实扩展数据；临时文件已清理，探针未作为回归测试落盘。

这些问题不等同于“缺少自动监听触发热重载”，也不重复上一份后端 Blob/Secret/Provider 审查。排除 Agent/CodeActor 执行器，不做泛化安全扫描。

## EXT-LIFE-001：合法 state 授权保存后无法重新加载

优先级：P1

位置：`apps/studio-server/src/extensions/extension-state-store.ts:183`；启动消费者 `apps/studio-server/src/main.ts:633`。

链条：Manifest 申请 state 订阅 → `extensions.enableModule` 与 Manager 接受并保存 → 新进程 State Store load 的白名单拒绝 state → 初始化失败，Server 尚未开始监听。

隔离探针：临时文件保存成功；创建新的 Store 读回报：

```text
Invalid events.subscribe grants: probe.state/server
```

反证核查：state 是 SDK 已定义的能力，Manifest、RPC 与 Manager 都允许，并非绕过验证写入非法值。启动没有绕过该加载错误。未执行真实 Server 重启，P1 依据是正常配置变更导致下次初始化无法继续的源码链。

最小方向：持久化读取与写入使用一致的合法能力集合，避免多处独立白名单漂移。

关闭条件：合法能力逐项保存/重读成功，非法值仍拒绝；启用 state 的临时 Server 实例可重启，不改写真实配置来验证。

## EXT-LIFE-002：Client disposer 抛错会中断其他清理

优先级：P2

位置：`apps/studio-client/src/features/extension-renderers/model/client-extension-host.ts:197,245`。

模块注册 Renderer、Command、Config 订阅后返回 disposer。stop 先从 active 删除实例，然后反序清理，最先执行的模块 disposer 一旦抛错，其他注册句柄就未释放。后续 dispose 也找不到已从 active 删除的实例记录。

隔离探针结果：再次调用 host.dispose 后仍有一个 Renderer、一个 Command；Config 通知继续调用旧订阅，summary 仍为 active。

反证核查：AbortSignal 已触发，但这些注册不会自动随 abort 删除；操作队列无法恢复被移除的 record。

最小方向：逐项尽力完成有明确释放语义的清理，最后汇总失败；实例记录与公开状态应反映真实清理结果，而不是在清理前丢掉回收责任。

关闭条件：任一 disposer 抛错不阻断其他句柄释放，重复 dispose 不遗留可调用注册，异常仍可诊断。

## EXT-LIFE-003：已卸载实例的异步 Command 可以重新注册 Renderer

优先级：P2

位置：`apps/studio-client/src/features/extension-renderers/model/client-extension-host.ts:388,479`。

Command 开始后等待异步工作，期间模块禁用并清理实例；Command 恢复执行后仍可通过旧 ctx 注册 Renderer。新句柄被加入已经脱离 active 的旧 record，后续没有回收所有者。

隔离探针结果：禁用后 Renderer 数量归零；释放异步暂停点后恢复为一，再执行 Host dispose 仍存在，summary 为 inactive。

反证核查：执行前 abort 检查只覆盖开始前；Renderer 注册没有与相邻 Config/Background 注册相同的失效检查。串行 reconcile 不等于串行执行所有 Command。

最小方向：资源获取入口拒绝失效实例，明确在途回调完成后的行为。不能只要求扩展作者自行读取 signal，而宿主继续接受旧 ctx 注册。

关闭条件：禁用、重载、dispose 后，旧异步回调无法注册新 Renderer；新实例注册不受旧实例取消影响。

## EXT-LIFE-004：Server 卸载失败后 Catalog 与 Host discovery 不一致

优先级：P2

位置：

- `apps/studio-server/src/extensions/extension-manager.ts:238`
- `packages/extension-sdk/extension-host/src/host.ts:132`

uninstallPackage 调用 forget，扩展 onDispose 抛错；Host 的 finally 删除 discovery record，Manager 则提前退出，持久状态、来源与 Catalog 未清除。后续 enable/reload 使用保留的 Catalog 条目，却被 Host 判为不存在。

隔离探针使用临时 dev-link 和真实 Host/Manager/StateStore，结果：

```text
Catalog available = true
desired enabled = true
Host discovery / RPC registrations = empty
```

反证核查：Server Scope 继续清理其他资源，因此不是 Server 注册泄漏。第二次卸载可以完成，不能夸大为永久不可恢复。

最小方向：为清理失败后已部分提交的卸载明确结果与后续操作，保证 Catalog、Host discovery、持久状态一致，或明确呈现可恢复的中间状态。

关闭条件：注入 onDispose 异常后，界面状态与可执行操作一致；重试/重启可恢复，不依赖猜测再点一次卸载。

## EXT-LIFE-005：Hook 卸载后晚到的 Catalog 响应可重新激活模块

优先级：P2

位置：`apps/studio-client/src/features/extension-renderers/model/use-client-extension-runtime.ts:53,98`。

refresh 等待 Catalog 请求 → Effect cleanup 调用 Host dispose → 请求完成 → refresh 无条件调用 host.reconcile。局部 disposed 只阻止创建 EventSource，不保护 reconcile。

隔离探针按此交错调用真实 Client Host：dispose 完成后仍激活模块并留下 Renderer。未挂载真实 React Hook，Hook 接线与可达性通过源码核对。

反证核查：队列保证顺序，不拒绝 dispose 后排入的 reconcile；SSE 关闭不取消已启动的 refresh。

最小方向：在 Hook 生命周期边界淘汰过期 refresh，兼顾卸载、依赖替换与 StrictMode 重执行；不能简单把可复用 Host 永久锁死来掩盖 Hook 所有权问题。

关闭条件：cleanup 后旧响应不激活扩展，新生命周期仍可正常初始化，重复挂载不会泄漏注册。

## 去重与未验证项

- 未重复登记 `extension-dev-hot-reload-enhancement.md` 的监听触发源需求。
- 未把 Server reload 先释放旧实例判为缺陷，这是现有合同。
- activation 失败后 desired enabled 保留，但存在 activation_failed 与诊断，不能仅因 RPC resolve 就说它伪装成功。
- State 订阅旧 Issue 索引状态与当前实现存在偏差，本报告以当前源码为准，不在这里顺手修改历史台账。
- 没有运行全仓检查、真实浏览器、真实数据库或密钥后端；会写入仓库测试扩展目录的既有测试只阅读断言。
- 未覆盖断电、多进程竞争或全部安装文件系统失败组合。后续修复需把隔离场景转为可维护的定向回归验证。
