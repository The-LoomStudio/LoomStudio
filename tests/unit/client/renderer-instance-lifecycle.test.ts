// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RendererInstanceRoot } from '../../../apps/studio-client/src/features/extension-renderers/ui/renderer-surface-host.js'
import { createClientRendererHost } from '../../../apps/studio-client/src/shared/extension-renderer-runtime/client-renderer-host.js'
import type { ClientRendererContext } from '../../../apps/studio-client/src/shared/extension-renderer-runtime/client-renderer-host.js'

const hooks = vi.hoisted(() => ({
  themeListeners: new Set<(snapshot: unknown) => void>(),
}))
vi.mock('../../../apps/studio-client/src/features/extension-renderers/model/client-theme.js', () => ({
  readClientThemeSnapshot: () => ({}),
  subscribeClientTheme: (listener: (snapshot: unknown) => void) => {
    hooks.themeListeners.add(listener)
    return () => hooks.themeListeners.delete(listener)
  },
}))
beforeEach(() => { hooks.themeListeners.clear() })
const cleanups: Array<() => void> = []
afterEach(() => { for (const close of cleanups.splice(0)) close() })
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

function fixture(update = vi.fn((_context: ClientRendererContext) => {}), sandbox = false) {
  const host = createClientRendererHost()
  const dispose = vi.fn()
  const mount = vi.fn((root: HTMLElement) => {
    const marker = document.createElement('span')
    marker.dataset.testRenderer = 'mounted'
    root.append(marker)
    return { dispose, ...(sandbox ? { update } : {}) }
  })
  host.register({
    owner: { kind: 'extension', packageId: 'test', moduleId: 'client' },
    definition: { id: 'tail', name: 'Tail', surface: 'narrative.timeline.tail', instanceScope: 'timeline' },
    mount, update,
    ...(sandbox ? { sandboxMount: mount } : {}),
  })
  const registration = host.list('narrative.timeline.tail')[0]!
  const container = document.createElement('div')
  document.body.append(container)
  const reactRoot = createRoot(container)
  let root: HTMLElement
  let closed = false
  const scope = { kind: 'timeline', key: 'timeline' } as const
  function start() {
    act(() => reactRoot.render(createElement(RendererInstanceRoot, { host, registration, revision: 1, scope })))
    root = container.firstElementChild as HTMLElement
  }
  const close = () => { if (!closed) { act(() => reactRoot.unmount()); container.remove(); closed = true } }
  cleanups.push(close)
  return { host, mount, update, dispose, get root() { return root }, start, close }

}

describe('Renderer instance lifecycle', () => {
  it.each([false, true])('reports an asynchronous dispose rejection without retaining its instance (sandbox: %s)', async sandbox => {
    const f = fixture(undefined, sandbox)
    f.dispose.mockRejectedValue(new Error('Async dispose failed'))
    f.start()
    await vi.waitFor(() => expect(f.mount).toHaveBeenCalledOnce())
    expect((f.root.shadowRoot ?? f.root).querySelector('[data-test-renderer]')).not.toBeNull()
    f.close()
    expect(f.host.instances()).toHaveLength(0)
    expect((f.root.shadowRoot ?? f.root).querySelector('[data-test-renderer]')).toBeNull()
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
    expect((f.root.shadowRoot ?? f.root).querySelector('[data-test-renderer]')).not.toBeNull()
    expect(() => f.close()).not.toThrow()
    expect(f.host.instances()).toHaveLength(0)
    expect((f.root.shadowRoot ?? f.root).querySelector('[data-test-renderer]')).toBeNull()
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
