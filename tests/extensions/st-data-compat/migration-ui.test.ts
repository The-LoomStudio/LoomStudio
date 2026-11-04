// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClientExtensionModule, ClientRenderer, ClientRendererContext, ExtensionRegistrationHandle } from '@loom-studio/extension-sdk'
import { readClientThemeSnapshot } from '../../../apps/studio-client/src/features/extension-renderers/model/client-theme.js'
import extension from '../../../extensions/st-data-compat/src/client/index.js'

const cleanups: ExtensionRegistrationHandle[] = []
beforeEach(() => vi.useFakeTimers())
afterEach(async () => {
  for (const handle of cleanups.splice(0)) await handle.dispose()
  document.body.replaceChildren()
  vi.useRealTimers()
})
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
function report(status = 'completed', files = 1) {
  return { counts: { cards: files, chats: 0, presets: 0, worlds: 0 }, files, bytes: files,
    scan: { status, processed: files, total: files, currentPath: '' } }
}
async function mount(call: (method: string, params: { directory?: string; sessionId?: string }) => Promise<unknown>,
  commit = vi.fn(async (_sessionId: string) => ({ imported: 1, skipped: [] }))) {
  let renderer!: ClientRenderer
  const rpc = vi.fn(call)
  const controller = new AbortController()
  const close = vi.fn()
  const warn = vi.fn()
  await extension.activate!({
    renderers: { register: (_definition: unknown, value: ClientRenderer) => { renderer = value } },
    commands: { register() {} }, rpc: { call: rpc }, imports: { commit }, logger: { warn },
  } as unknown as Parameters<NonNullable<ClientExtensionModule['activate']>>[0])
  const root = document.createElement('div')
  document.body.append(root)
  const rendererContext: ClientRendererContext = {
    identity: { owner: { kind: 'extension', packageId: 'sillytavern.importer', moduleId: 'client' }, contributionId: 'overall-migration-modal' },
    surface: 'shell.workspace-panel',
    scope: { kind: 'workspace', key: 'workspace' },
    host: { compact: false, prefersReducedMotion: false, theme: 'inherit', themeSnapshot: readClientThemeSnapshot() },
    signal: controller.signal,
    close,
  }
  const handle = await renderer.mount(root, rendererContext)
  if (!handle) throw new Error('Migration Renderer must return its cleanup handle')
  cleanups.push(handle)
  const path = root.querySelector<HTMLInputElement>('[data-action="path"]')!
  const choose = root.querySelector<HTMLButtonElement>('[data-action="choose"]')!
  const importButton = root.querySelector<HTMLButtonElement>('[data-action="import"]')!
  const status = root.querySelector<HTMLElement>('.stbridge-migration-status')!
  const changePath = (value: string) => { path.value = value; path.dispatchEvent(new Event('input')) }
  return { root, rpc, controller, close, warn, commit, path, choose, importButton, status, changePath,
    scan(value: string) { changePath(value); choose.click() } }
}
const flush = () => vi.advanceTimersByTimeAsync(0)

describe('ST migration panel ownership', () => {
  it('ignores the late old directory and commits the displayed scan only', async () => {
    const pending = { A: deferred<ReturnType<typeof report>>(), B: deferred<ReturnType<typeof report>>() }
    const ui = await mount(async (method, params) => {
      if (method.endsWith('.start')) return { sessionId: params.directory }
      if (method.endsWith('.inspect')) return pending[params.sessionId as 'A' | 'B'].promise
      return { cancelled: true }
    })
    ui.scan('A'); await flush()
    ui.scan('B'); await flush()
    pending.B.resolve(report('completed', 2)); await flush()
    pending.A.resolve(report('completed', 1)); await flush()
    expect(ui.path.value).toBe('B')
    expect(ui.status.textContent).toContain('2 个兼容文件')
    ui.importButton.click(); await flush()
    expect(ui.commit).toHaveBeenCalledExactlyOnceWith('B')
    expect(ui.rpc).toHaveBeenCalledWith('sillytavern.importer.migration.cancel', { sessionId: 'A' })
  })

  it('invalidates the completed result as soon as its path is edited', async () => {
    const ui = await mount(async method => method.endsWith('.start') ? { sessionId: 'A' } : report())
    ui.scan('A'); await flush()
    ui.changePath('B')
    expect(ui.importButton.hidden).toBe(true)
    ui.importButton.click()
    expect(ui.commit).not.toHaveBeenCalled()
    expect(ui.rpc).toHaveBeenCalledWith('sillytavern.importer.migration.cancel', { sessionId: 'A' })
  })

  it('cancels a late start response after the panel has closed without starting its poll', async () => {
    const started = deferred<{ sessionId: string }>()
    const ui = await mount(async method => method.endsWith('.start') ? started.promise : { cancelled: true })
    ui.scan('A')
    ui.root.querySelector<HTMLButtonElement>('[data-action="close"]')!.click()
    started.resolve({ sessionId: 'A' }); await flush()
    expect(ui.close).toHaveBeenCalledOnce()
    expect(ui.rpc.mock.calls.map(([method]) => method)).toEqual([
      'sillytavern.importer.migration.start', 'sillytavern.importer.migration.cancel',
    ])
  })

  it.each(['scanning', 'completed'])('releases an abandoned %s session and stops polling on unmount', async status => {
    const ui = await mount(async method => method.endsWith('.start') ? { sessionId: 'A' } : report(status))
    ui.scan('A'); await flush()
    ui.controller.abort()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(ui.rpc.mock.calls.filter(([method]) => method.endsWith('.inspect'))).toHaveLength(1)
    expect(ui.rpc.mock.calls.filter(([method]) => method.endsWith('.cancel'))).toEqual([
      ['sillytavern.importer.migration.cancel', { sessionId: 'A' }],
    ])
  })

  it('leaves an accepted commit to the host when closed and does not publish its late result', async () => {
    const committed = deferred<{ imported: number; skipped: [] }>()
    const commit = vi.fn((_sessionId: string) => committed.promise)
    const ui = await mount(async method => method.endsWith('.start') ? { sessionId: 'A' } : report(), commit)
    ui.scan('A'); await flush()
    ui.importButton.click()
    expect(ui.path.disabled).toBe(true)
    expect(ui.choose.disabled).toBe(true)
    ui.root.querySelector<HTMLButtonElement>('[data-action="close"]')!.click()
    const before = ui.status.textContent
    committed.resolve({ imported: 1, skipped: [] }); await flush()
    expect(ui.commit).toHaveBeenCalledExactlyOnceWith('A')
    expect(ui.rpc.mock.calls.some(([method]) => method.endsWith('.cancel'))).toBe(false)
    expect(ui.status.textContent).toBe(before)
  })

  it('reports a rejected cleanup without retrying or reviving the abandoned result', async () => {
    const ui = await mount(async (method, params) => {
      if (method.endsWith('.start')) return { sessionId: params.directory }
      if (method.endsWith('.cancel')) throw new Error('Cleanup unavailable')
      return report()
    })
    ui.scan('A'); await flush()
    ui.changePath('B'); await flush()
    expect(ui.warn).toHaveBeenCalledExactlyOnceWith('ST migration staging cleanup failed', {
      sessionId: 'A', error: 'Error: Cleanup unavailable',
    })
    expect(ui.root.querySelector('[role="status"]')?.textContent).toContain('旧扫描清理失败：Cleanup unavailable')
    expect(ui.root.querySelector('[role="status"]')?.textContent).toContain('旧结果已作废，临时文件可能仍保留')
    expect(ui.importButton.hidden).toBe(true)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(ui.rpc.mock.calls.filter(([method]) => method.endsWith('.cancel'))).toHaveLength(1)
  })
})
