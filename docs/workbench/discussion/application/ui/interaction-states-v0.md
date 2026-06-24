# Interaction States v0

> **状态**: Open Design
> **主题**: Studio Application UI 的空状态、加载状态、错误状态、运行状态、脏状态和降级状态。

---

## 1. 问题

正式 UI 不能只展示成功路径。AIRP UI 至少需要处理：

- workspace 未打开；
- 没有 Card；
- 没有 Session；
- provider 未配置；
- model profile 不可用；
- submitTurn 运行中；
- provider stream / error；
- extension degraded；
- diagnostics warning；
- document dirty / conflict；
- optimistic update rollback；
- branch fork / reroll pending；
- trace 不完整或被 redacted。

这些状态如果分散在页面里临时写，会导致体验和语义不一致。

---

## 2. 状态分类

| 状态 | 含义 | UI 目标 |
|---|---|---|
| Empty | 数据不存在或尚未创建 | 给出最小下一步 |
| Loading | 正在读取数据 | 保持布局稳定 |
| Pending | 用户操作已提交，等待结果 | 显示进度与取消/中止入口 |
| Streaming | 结果逐步到达 | 不打断用户阅读历史 |
| Error | 当前操作失败 | 说明影响范围和下一步 |
| Degraded | 系统可用但部分能力下降 | 可见但不阻塞无关操作 |
| Dirty | 本地编辑未保存 | 防止误丢改动 |
| Conflict | 远端/持久化版本冲突 | 需要比较、接受或重试 |
| Optimistic | UI 已先行更新，等待确认 | 失败时能回滚或说明 |
| Redacted | 内容因权限或安全被隐藏 | 说明隐藏原因，不泄露内容 |

---

## 3. 基础原则

1. 状态不应改变主布局几何。
2. 加载中应保留用户已看到的旧内容，除非上下文已经切换。
3. 错误要区分 operation error 和 global diagnostics。
4. Diagnostics 不替代当前操作的 error response。
5. Pending 和 Streaming 是运行状态，不是普通 loading。
6. Empty state 应提供动作，不提供长篇解释。
7. Degraded extension 不应让整个 Application UI 失效。
8. Dirty state 必须和导航、防关闭、branch 切换联动。

---

## 4. Runtime Turn 状态

默认玩家回合可能出现：

```text
idle
composing
calling_provider
streaming_provider
waiting_for_tool
waiting_for_confirmation
committing
completed
failed
discarded
suspended
```

UI 不一定逐字使用这些状态名，但需要能表达：

- 当前正在做什么；
- 是否可以 cancel / stop；
- 是否可以 retry；
- 是否有 pending confirmation；
- 是否已有可展示的 partial result；
- 最终是否写入 Narrative Timeline。

---

## 5. 错误呈现

错误至少分三类：

```text
local UI error:
  表单校验、无效输入、焦点范围内提示。

operation error:
  某次 RPC / provider / submitTurn 失败，靠近触发动作展示。

system diagnostic:
  extension degraded、trace persist warning、provider profile 缺失，可进入 diagnostics 面板。
```

不要把所有错误都塞进 toast。Toast 只适合短暂反馈，不适合需要用户决策或排查的错误。

---

## 6. 待决问题

1. Runtime turn 状态是否需要独立 Run Status Bar？
2. `diagnostics.updated` 应默认进入 Drawer，还是也影响局部页面 badge？
3. provider 配置缺失时，New Session / Send 按钮是 disabled、引导配置，还是 fallback fake gateway？
4. optimistic update 是否进入 M0 UI，还是先全部等待 server 确认？
5. dirty editor 离开页面时采用 modal confirmation，还是局部 save/discard bar？

