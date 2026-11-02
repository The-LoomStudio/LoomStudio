# 运行异常：先取证，再修改

遇到界面状态与实际行为不一致，先追踪一次具体操作，避免仅凭截图推断原因。相关合同见 [运行日志架构](../architecture/platform/logging.md) 和 [Runtime 与 Session](../architecture/application/agent/runtime-and-session.md)。

## 最小证据路径

1. 记录操作时间、界面错误、Session ID、Run ID；区分「刚失败的新 Run」与「阻塞它的旧 Run」。不要把它们当成同一个执行。
2. 在应用日志面板按 Run / Session / correlationId 查找。开发服务的持久化日志位于 `.loomstudio-dev/logs/*.jsonl`，先用 `rg -n '具体RunID' .loomstudio-dev/logs` 定向搜索，再按 correlationId 串联 RPC、PromptBuild、Provider、工具、transcript 和结束事件。生产路径以启动配置和日志架构文档为准。浏览器日志是有界内存缓冲，刷新前保留必要证据。
3. 涉及布局、点击、按钮状态、订阅断开时，用浏览器 DOM、Network、Console 或只读脚本验证具体假设。例如核对停止按钮是否存在、是否 disabled，以及 `agent.run.subscribe` 返回的 runId/state 是否和界面一致。不要仅凭「流式」一词假定使用 SSE/WS；当前 Agent 事件通过 RPC 增量轮询获取。模型到服务端的流式链路需另查。
4. 日志不能回答持久化状态时，先查现有 inspect / task / transcript 接口。必要时才只读打开当前配置的数据文件；本地默认通常为 `data/studio.sqlite`，不能把这个路径当成所有实例的固定位置。
5. 区分执行者是否仍存活、数据库是否留有旧标记、前端正在观察哪个 Run。日志是事件证据，transcript 是持久化事实，内存执行器负责当前执行；任何单一来源都不能回答所有问题。

只读 SQLite 示例（仅输出状态和标识，不输出用户正文、工具参数或凭据）：

```python
import sqlite3
connection = sqlite3.connect('file:data/studio.sqlite?mode=ro', uri=True)
session_id = '待调查的SessionID'
rows = connection.execute('''
SELECT e.run_id, e.sequence, json_extract(e.entry_json, '$.state')
FROM agent_transcript_entries e
WHERE e.agent_session_id = ?
  AND json_extract(e.entry_json, '$.kind') = 'run-state'
  AND NOT EXISTS (
    SELECT 1 FROM agent_transcript_entries later
    WHERE later.agent_session_id = e.agent_session_id
      AND later.run_id IS e.run_id AND later.sequence > e.sequence
      AND json_extract(later.entry_json, '$.kind') = 'run-state'
  )
ORDER BY e.sequence
''', (session_id,))
for row in rows:
    print(row)
connection.close()
```

必须检查每个 Run 的最后状态，而不只是整个 Session 的最后一条：较新的失败可能遮住较旧的 running 标记。

## 修复与验证边界

- 先写出已证实的因果链，再选择最小修复。没有证据时标记为假设。
- 不用修改数据库字段替代生命周期修复。恢复应经正常业务入口追加状态、保持历史，并保留并发比较。
- 不能因为没有输出就认定执行者死亡；超时、取消、执行所有权与工具副作用需要明确处理。不能通过重放未知结果的工具来「恢复」。
- 浏览器只读诊断无需制造业务请求；发送消息、执行工具、修改持久状态前说明影响并取得相应授权。
- 日志补充使用安全字段或已知错误分类，不把任意异常正文、Provider 响应或用户内容塞入日志。
- 交付时区分定向测试、类型检查、浏览器诊断和真实服务复测；未执行的验证不能写成通过。
