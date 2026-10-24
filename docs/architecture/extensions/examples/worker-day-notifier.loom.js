// ==LoomScript==
// @format 1
// @id example.worker-day-notifier
// @name Worker 第七天提醒
// @version 1.0.0
// @runtime client-worker
// @capability state.read
// @capability ui.notify
// ==/LoomScript==

// 观察全局 State 的 world.day，不修改状态、不发送消息、不调用 AI。
// 每个运行实例只提醒一次；刷新、重新启用或刷新网页会重新计数。
export async function activate(ctx) {
  let notified = false
  ctx.logger.info('第七天提醒 Worker 已启动')
  return ctx.state.subscribe({ scope: 'global' }, async snapshot => {
    const day = snapshot.value?.world?.day
    if (typeof day !== 'number' || day < 7 || notified) return
    notified = true
    await ctx.notifications.show({ message: '世界已进入第七天。', level: 'info' })
  })
}
