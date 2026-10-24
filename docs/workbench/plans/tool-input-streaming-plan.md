# 工具参数生成反馈与恢复

状态：第一批已实现 / 定向验证通过，待人工体验验收（2026-10-22）。

## Goal

工具参数生成时显示可展开的临时条目，正式记录接替且不重复，断线后恢复当前草稿。

## Verified facts

Gateway 已发布 tool-input-delta；Runtime 转发 providerRunId、providerStep、toolCallId。正式原生调用的 providerItemId 对应 toolCallId。客户端尚未消费参数增量，服务端过期游标快照仅保存正文与推理。

## Inherited decisions

复用现有工具卡片，草稿默认折叠；明确区分准备、执行和中断。草稿不能执行或用于鉴权。不更换 SDK、传输或持久化系统，本批不实现 CodeAct 内部操作事件。

## Minimal design

Server Run 持有当前工具输入快照，随正式步骤提交或终止清除。订阅游标过期时随现有快照返回。客户端 observer 将增量投影成临时 tool-input 条目，正式记录通过 providerItemId 匹配并接替；presentationId 仅属于客户端，维持工具卡片展开身份。读取 Transcript 与补读事件之间发生提交时，丢弃过期草稿。终态没有正式记录的草稿标明中断未执行。

## Work packages

1. Server agent-run-service.ts：累积、快照、清理；不修改数据库。
2. Client agent-run-observer.ts、use-narrative-runtime.ts 与 entities/agent.ts：草稿投影、接替与重放。
3. agent-chat-panel.tsx：复用工具条目展示准备与中断。
4. 现有 Server RPC、Client observer/工具条目测试：补充关键行为回归。

## Acceptance and validation

覆盖交错的多个工具输入、完整参数接替、展开身份、同批提交、中断未执行、过期游标恢复与恢复期间提交竞态。运行定向测试和受影响 TypeScript 检查；不启动真实模型或主动重启服务。人工验收关注长参数生成时的反馈与折叠操作。

## Open questions or blockers

None。

## 实施结果

- 参数增量以独立 tool-input 展示，草稿默认折叠并使用现有纯文本详情；未解析完成的参数不进入执行路径。
- 正式调用通过 providerItemId（中断记录通过 invocationId）接替草稿，presentationId 在步骤更新、过期快照以及终态 Transcript 刷新中保留；摘要边界排序同步使用展示标识。
- Server 当前工具输入快照支持交错调用并在步骤提交或终止后清理。快照副本不受后续增量修改，恢复期间的提交不会重新显示旧草稿。
- 中断的参数生成和已有的未执行中断记录显示“尚未执行”。CodeAct 内部操作子步骤仍属于后续批次。

## 验证结果

- 首轮四文件回归 57 项通过、1 项失败；失败为 narrative-run-recovery 中切换 endpoint 后终态刷新断言，与 agent-send-and-sdk-boundary-repair-plan.md 已记录问题一致。
- 补齐终态刷新展示身份后，三个客户端定向文件共 30 项通过。
- Server no-emit 类型检查通过；更新 Server RPC 声明后，Client no-emit 类型检查通过。Diff 空白检查通过。
- 未调用真实 Provider，未进行浏览器视觉验收。人工关注长参数生成、展开后正式接替、断线重连和主动暂停。
