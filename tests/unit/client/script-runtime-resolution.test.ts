// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { useScriptRuntime } from '../../../apps/studio-client/src/features/loom-scripts/model/use-script-runtime.js'
import { createClientRendererHost } from '../../../apps/studio-client/src/shared/extension-renderer-runtime/client-renderer-host.js'
import type { StudioApi } from '../../../apps/studio-client/src/shared/api/studio-api.js'

it('shares initial connection resolution, but revalidates changes and reconnects while ignoring older results', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  class Source extends EventTarget {
    static OPEN = 1
    readyState = 0
    close() { this.readyState = 2 }
  }
  let source!: Source
  vi.stubGlobal('EventSource', class extends Source {
    constructor() { super(); source = this }
  })
  type Resolution = Awaited<ReturnType<StudioApi['loomScripts']['reconcileRuntime']>>
  const pending: Array<(value: Resolution) => void> = []
  const reconcileRuntime = vi.fn(() => new Promise<Resolution>(resolve => { pending.push(resolve) }))
  const api = { loomScripts: { reconcileRuntime } } as unknown as StudioApi
  const rendererHost = createClientRendererHost()
  rendererHost.setScopeSnapshot({ workspace: 'workspace', cardId: 'card' })
  const onResolved = vi.fn()
  const empty = { mounts: [], unavailableMounts: [], serverInstances: [] } as unknown as Resolution
  function Fixture() {
    useScriptRuntime({ api, rendererHost, refreshToken: 0, listBackgrounds: () => [],
      resolveInputs: async () => ({ matches: [], artifacts: [] }), stateRead: async () => ({}), notify: () => {}, onResolved })
    return null
  }
  const root = createRoot(document.createElement('div'))
  try {
    await act(async () => { root.render(createElement(Fixture)) })
    expect(reconcileRuntime).toHaveBeenCalledTimes(1)
    await act(async () => { source.readyState = 1; source.dispatchEvent(new Event('open')) })
    expect(reconcileRuntime).toHaveBeenCalledTimes(1)
    await act(async () => { source.dispatchEvent(new Event('extensions.changed')) })
    expect(reconcileRuntime).toHaveBeenCalledTimes(2)
    await act(async () => { pending[0]!(empty) })
    expect(onResolved).not.toHaveBeenCalled()
    await act(async () => { pending[1]!(empty) })
    expect(onResolved).toHaveBeenCalledTimes(1)
    await act(async () => { source.dispatchEvent(new Event('open')) })
    expect(reconcileRuntime).toHaveBeenCalledTimes(3)
    await act(async () => { pending[2]!(empty) })
    expect(onResolved).toHaveBeenCalledTimes(2)
    await act(async () => { rendererHost.setScopeSnapshot({ workspace: 'workspace', cardId: 'other' }) })
    await act(async () => { rendererHost.setScopeSnapshot({ workspace: 'workspace', cardId: 'card' }) })
    expect(reconcileRuntime).toHaveBeenCalledTimes(5)
    await act(async () => { pending[3]!(empty) })
    expect(onResolved).toHaveBeenCalledTimes(2)
    await act(async () => { pending[4]!(empty) })
    expect(onResolved).toHaveBeenCalledTimes(3)
  } finally {
    await act(async () => { root.unmount() })
    vi.unstubAllGlobals()
  }
})
