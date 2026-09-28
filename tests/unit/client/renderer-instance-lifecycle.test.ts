import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RendererInstanceRoot } from '../../../apps/studio-client/src/features/extension-renderers/ui/renderer-surface-host.js'
import { createClientRendererHost } from '../../../apps/studio-client/src/shared/extension-renderer-runtime/client-renderer-host.js'
import type { ClientRendererContext } from '../../../apps/studio-client/src/shared/extension-renderer-runtime/client-renderer-host.js'

const hooks = vi.hoisted(() => ({
  effects: [] as (() => void | (() => void))[],
  themeListeners: new Set<(snapshot: unknown) => void>(),
}))
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useMemo: (compute: () => unknown) => compute(),
  useRef: (current: unknown) => ({ current }),
  useState: (initial: unknown) => [initial, vi.fn()],
  useEffect: (effect: () => void | (() => void)) => hooks.effects.push(effect),
}))
vi.mock('../../../apps/studio-client/src/features/extension-renderers/model/client-theme.js', () => ({
  readClientThemeSnapshot: () => ({}),
  subscribeClientTheme: (listener: (snapshot: unknown) => void) => {
    hooks.themeListeners.add(listener)
    return () => hooks.themeListeners.delete(listener)
  },
}))
beforeEach(() => { hooks.effects = []; hooks.themeListeners.clear() })

function fixture(update = vi.fn((_context: ClientRendererContext) => {}), sandbox = false) {
  const host = createClientRendererHost()
  const dispose = vi.fn()
  const mount = vi.fn(() => ({ dispose, ...(sandbox ? { update } : {}) }))
  host.register({
    owner: { kind: 'extension', packageId: 'test', moduleId: 'client' },
    definition: { id: 'tail', name: 'Tail', surface: 'narrative.timeline.tail', instanceScope: 'timeline' },
    mount, update,
    ...(sandbox ? { sandboxMount: mount } : {}),
  })
  const registration = host.list('narrative.timeline.tail')[0]!
  const tree = RendererInstanceRoot({
    host, registration, revision: 1, scope: { kind: 'timeline', key: 'timeline' },
  })
  const root = { replaceChildren: vi.fn(), shadowRoot: null } as unknown as HTMLElement
  tree.props.ref(root)
  const cleanups: (() => void)[] = []
  function start() {
    for (const effect of hooks.effects.splice(0)) {
      const cleanup = effect()
      if (cleanup) cleanups.push(cleanup)
    }
  }
  return { host, mount, update, dispose, root, start, close: () => cleanups.splice(0).forEach(cleanup => cleanup()) }
}

describe('Renderer instance lifecycle', () => {
  it.each([false, true])('reports an asynchronous dispose rejection without retaining its instance (sandbox: %s)', async sandbox => {
    const f = fixture(undefined, sandbox)
    f.dispose.mockRejectedValue(new Error('Async dispose failed'))
    f.start()
    await vi.waitFor(() => expect(f.mount).toHaveBeenCalledOnce())
    f.close()
    expect(f.host.instances()).toHaveLength(0)
    expect(f.root.replaceChildren).toHaveBeenCalled()
    await vi.waitFor(() => expect(f.host.diagnostics()).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'renderer.dispose_failed', message: 'Async dispose failed' }),
    ])))
    expect(f.dispose).toHaveBeenCalledOnce()
  })

  it.each([false, true])('finishes host cleanup when dispose throws synchronously (sandbox: %s)', async sandbox => {
    const f = fixture(undefined, sandbox)
    f.dispose.mockImplementation(() => { throw new Error('Dispose failed') })
    f.start()
    await vi.waitFor(() => expect(f.mount).toHaveBeenCalledOnce())
    expect(() => f.close()).not.toThrow()
    expect(f.host.instances()).toHaveLength(0)
    expect(f.root.replaceChildren).toHaveBeenCalled()
    expect(hooks.themeListeners.size).toBe(0)
    expect(f.host.diagnostics()).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'renderer.dispose_failed', message: 'Dispose failed' }),
    ]))
  })

  it.each([false, true])('reports synchronous update errors for initial and theme updates (sandbox: %s)', async sandbox => {
    const f = fixture(vi.fn(() => { throw new Error('Synchronous update failure') }), sandbox)
    expect(() => f.start()).not.toThrow()
    await vi.waitFor(() => expect(f.host.diagnostics().some(item => item.message === 'Synchronous update failure')).toBe(true))
    expect(() => { for (const listener of hooks.themeListeners) listener({}) }).not.toThrow()
    await vi.waitFor(() => expect(f.update).toHaveBeenCalledTimes(2))
    f.close()
    expect(f.host.instances()).toHaveLength(0)
  })

  it('does not start a queued mount or update after unmount', async () => {
    const f = fixture()
    f.start()
    f.close()
    await Promise.resolve()
    await Promise.resolve()
    expect(f.mount).not.toHaveBeenCalled()
    expect(f.update).not.toHaveBeenCalled()
    expect(f.host.instances()).toHaveLength(0)
    expect(hooks.themeListeners.size).toBe(0)
  })

  it('mounts current instances and disposes them once', async () => {
    const f = fixture()
    f.start()
    await vi.waitFor(() => expect(f.mount).toHaveBeenCalledOnce())
    expect(f.host.instances()).toHaveLength(1)
    f.close()
    expect(f.dispose).toHaveBeenCalledOnce()
    expect(f.host.instances()).toHaveLength(0)
  })
})
