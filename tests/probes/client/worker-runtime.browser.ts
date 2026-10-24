import type { ClientExtensionActivationContext, ClientStateSnapshot, ExtensionRegistrationHandle } from '@loom-studio/extension-sdk'
import type { ResolvedLoomScriptRendererMount } from '../../../apps/studio-client/src/entities/loom-script.js'
import { createClientExtensionHost, type ClientExtensionDataApi, type ManagedClientExtensionPackage } from '../../../apps/studio-client/src/features/extension-renderers/model/client-extension-host.js'
import { createClientScriptRuntime } from '../../../apps/studio-client/src/features/loom-scripts/model/client-script-runtime.js'
import { createClientRendererHost } from '../../../apps/studio-client/src/shared/extension-renderer-runtime/client-renderer-host.js'
import { createClientWorkerModule } from '../../../apps/studio-client/src/shared/worker-runtime/client-worker-module.js'

const button = document.querySelector<HTMLButtonElement>('#run')!
const output = document.querySelector<HTMLPreElement>('#result')!
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message) }
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))
async function until(check: () => boolean) {
  const start = performance.now()
  while (!check()) { if (performance.now() - start > 5000) throw new Error('Timed out waiting for Worker'); await delay(20) }
}
const workerGuard = `if (typeof window !== 'undefined' || typeof document !== 'undefined' || !(self instanceof DedicatedWorkerGlobalScope)) throw new Error('Not a dedicated Worker');`

async function run() {
  const pass = (message: string) => { output.textContent += `PASS ${message}\n` }
  const rendererHost = createClientRendererHost()
  rendererHost.setScopeSnapshot({ workspace: 'probe', cardId: 'card', timelineId: 'story', branchId: 'main' })
  let revision = 1
  const snapshot = (): ClientStateSnapshot => ({ target: { scope: 'global' }, scopeId: 'global', revisionId: String(revision), value: { day: revision }, createdAt: 'now' })
  const data = { state: { get: async () => snapshot() } } as unknown as ClientExtensionDataApi
  const notifications: string[] = []
  const runtime = createClientScriptRuntime({ rendererHost, data, notify: (_owner, value) => { notifications.push(value.message) } })
  const source = (name: string) => `${workerGuard}
    export async function activate(ctx) {
      const current = await ctx.state.get({scope:'global'});
      await ctx.notifications.show({message:'${name}:start:' + current.value.day});
      return ctx.state.subscribe({scope:'global'}, async state => {
        if (state.value.day > 1) await ctx.notifications.show({message:'${name}:day:' + state.value.day});
      });
    }`
  const mount = (id: string): ResolvedLoomScriptRendererMount => ({
    mountId: id, mountVersion: 1, enabled: true, orderIndex: 0, target: { kind: 'card', cardId: 'card' },
    source: source(id), grantedCapabilities: ['runtime.client-worker', 'state.read', 'ui.notify'],
    script: { id, version: 1, metadataId: id, name: id, scriptVersion: '1.0.0', runtime: 'client-worker', requestedCapabilities: ['runtime.client-worker', 'state.read', 'ui.notify'], contributions: [] },
  })
  try {
    const first = mount('first'), other = { ...mount('other'), target: { kind: 'user' as const } }
    await runtime.reconcile([{ ...first, grantedCapabilities: ['runtime.client'] }])
    assert(!notifications.length && runtime.host.diagnostics().some(item => item.message.includes('not granted')), 'Worker trust was bypassed')
    pass('独立 Worker 授权：主线程授权不替代 Worker 授权')
    await runtime.reconcile([first, other])
    assert(notifications.join(',') === 'first:start:1,other:start:1', JSON.stringify(runtime.host.diagnostics()))
    pass('真实脚本在 DedicatedWorkerGlobalScope 中读取 State、建立订阅')
    const saved = { ...first, source: source('saved'), script: { ...first.script, version: 2 } }
    rendererHost.setScopeSnapshot({ workspace: 'probe', cardId: 'card', timelineId: 'story-2', branchId: 'main' })
    await runtime.reconcile([saved, other])
    assert(notifications.length === 2, 'Save or same-role Timeline change restarted Worker')
    pass('保存与同角色切换 Timeline 均不重启')
    await runtime.reconcile([{ ...saved, mountVersion: 2 }, other])
    assert(notifications.join(',') === 'first:start:1,other:start:1,saved:start:1', 'Refresh affected another instance')
    revision = 7
    await runtime.host.notifyStateChanged()
    await until(() => notifications.includes('saved:day:7') && notifications.includes('other:day:7'))
    assert(!notifications.includes('first:day:7'), 'Old subscription survived refresh')
    pass('刷新只替换目标 Worker；新版本收到第 7 天事件，旧版本订阅消失')
    rendererHost.setScopeSnapshot({ workspace: 'probe', cardId: 'other-card' })
    await runtime.reconcile([other])
    revision = 8
    await runtime.host.notifyStateChanged()
    await until(() => notifications.includes('other:day:8'))
    assert(!notifications.includes('saved:day:8'), 'Role Worker survived role change')
    pass('切换角色卸载角色实例，保留全局实例')
  } finally { await runtime.dispose() }

  const packageHost = createClientExtensionHost({ rendererHost, data, notify: (_owner, value) => { notifications.push(value.message) } })
  const pkg: ManagedClientExtensionPackage = {
    packageId: 'probe.worker', version: '1', displayName: 'Probe', tags: [], available: true, sourceKinds: ['repository'],
    modules: [{ packageId: 'probe.worker', moduleId: 'worker', runtimeKind: 'client-worker',
      entryUrl: new URL('./worker-fixtures/entry.js', import.meta.url).href,
      requestedUiCapabilities: ['ui.notify'], desired: { enabled: true, grants: { ui: ['ui.notify'] } }, contributions: {} }],
  }
  try {
    await packageHost.reconcile([pkg])
    assert(notifications.includes('relative-import-ok'), JSON.stringify(packageHost.diagnostics()))
    pass('扩展模块使用同一真实 Worker 执行器，入口保留相对 import')
  } finally { await packageHost.dispose() }

  const crashRuntime = createClientScriptRuntime({ rendererHost, data })
  try {
    const crash: ResolvedLoomScriptRendererMount = {
      mountId: 'crash', mountVersion: 1, enabled: true, orderIndex: 0, target: { kind: 'user' },
      source: `export function activate() { setTimeout(() => { throw new Error('intentional-running-crash') }, 100) }`,
      grantedCapabilities: ['runtime.client-worker'],
      script: { id: 'crash', version: 1, metadataId: 'crash', name: 'crash', scriptVersion: '1', runtime: 'client-worker', requestedCapabilities: ['runtime.client-worker'], contributions: [] },
    }
    await crashRuntime.reconcile([crash])
    assert(crashRuntime.host.summaries()[0]?.state === 'active', 'Crash fixture never started')
    await until(() => crashRuntime.host.summaries()[0]?.state === 'degraded')
    assert(crashRuntime.host.diagnostics().some(item => item.code === 'client-extension.execution_failed' && item.message.includes('intentional-running-crash')), 'Runtime failure was not exposed')
    pass('运行中崩溃回收 Worker，并将管理状态更新为失败')
  } finally { await crashRuntime.dispose() }

  const controller = new AbortController()
  const events: string[] = [], errors: string[] = []
  const logger = { log() {}, debug() {}, info() {}, warn() {}, error(message: string) { errors.push(message) }, child() { return logger } }
  const context = {
    extension: { packageId: 'probe', moduleId: 'worker', instanceId: crypto.randomUUID(), displayName: 'Probe', version: '1' },
    signal: controller.signal, logger, notifications: { show: async ({ message }: { message: string }) => { events.push(message) } },
  } as unknown as ClientExtensionActivationContext
  let handle: ExtensionRegistrationHandle | void = undefined
  let ticks = 0
  const timer = setInterval(() => { ticks += 1 }, 10)
  try {
    handle = await createClientWorkerModule({ source: `${workerGuard}
      export function activate(ctx) { setTimeout(async () => { await ctx.notifications.show({message:'loop'}); while(true) {} }, 0); }`
    }).activate(context)
    await until(() => events.includes('loop'))
    const before = ticks
    await delay(100)
    assert(ticks > before, 'Main-thread heartbeat stopped')
    const stop = performance.now()
    await handle?.dispose()
    const elapsed = Math.round(performance.now() - stop)
    assert(elapsed < 1500, 'Noncooperative Worker did not terminate')
    pass(`Worker 死循环时主线程继续运行，${elapsed} ms 内终止`)
    handle = await createClientWorkerModule({ source: `${workerGuard} export async function activate(ctx) { await ctx.notifications.show({message:'restart'}); }` }).activate(context)
    assert(events.includes('restart'), 'Worker could not restart')
    await handle?.dispose()
    handle = undefined
    let failure: unknown
    try { await createClientWorkerModule({ source: `throw new Error('intentional-probe-failure')` }).activate(context) } catch (error) { failure = error }
    assert(failure instanceof Error && failure.message.includes('intentional-probe-failure') && errors.length, 'Startup error not reported')
    pass('终止后可以启动新实例；启动异常正确报告并回收')
  } finally { clearInterval(timer); controller.abort(); await handle?.dispose() }
}

button.addEventListener('click', async () => {
  button.disabled = true
  output.textContent = ''
  try { await run(); output.textContent += '全部通过\n' }
  catch (error) { output.textContent += `FAIL ${error instanceof Error ? error.stack : String(error)}\n` }
  finally { button.disabled = false }
})
