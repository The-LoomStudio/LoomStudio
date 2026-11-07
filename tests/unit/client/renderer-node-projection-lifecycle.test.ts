// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import type { ClientRendererRegistration } from '../../../apps/studio-client/src/shared/extension-renderer-runtime/client-renderer-host.js'
import { createClientRendererHost } from '../../../apps/studio-client/src/shared/extension-renderer-runtime/client-renderer-host.js'
import { RendererNodeMountHost } from '../../../apps/studio-client/src/features/extension-renderers/ui/renderer-node-mount-host.js'

afterEach(() => { vi.unstubAllGlobals() })

it('removes old inline ranges while new text or owner projection is pending and releases mounted renderers', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  type Projection = Awaited<ReturnType<NonNullable<ClientRendererRegistration['projectNodeWithAnchors']>>>
  const first = Promise.withResolvers<Projection>()
  const next = Promise.withResolvers<Projection>()
  const changedOwner = Promise.withResolvers<Projection>()
  const project = vi.fn<NonNullable<ClientRendererRegistration['projectNodeWithAnchors']>>()
    .mockReturnValueOnce(first.promise).mockReturnValueOnce(next.promise).mockReturnValueOnce(changedOwner.promise)
  const disposed = vi.fn()
  const mount = vi.fn((element: HTMLElement) => { element.textContent = '[OLD]'; return { dispose: disposed } })
  const host = createClientRendererHost()
  const registration = host.register({
    owner: { kind: 'extension', packageId: 'audit.example', moduleId: 'client' },
    definition: { id: 'inline', name: 'Inline', surface: 'narrative.entry.inline', instanceScope: 'node' },
    mount, projectNodeWithAnchors: project,
  })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const render = (text: string, timelineId = 'story-a') => act(async () => {
    root.render(createElement(RendererNodeMountHost, {
      host, surface: 'narrative', nodeId: 'entry', timelineId, rawText: text,
      children: createElement('span', null, text, createElement('em', null)),
    }))
  })
  const inline: Projection = {
    mounts: [{ key: 'replace', part: { type: 'text', content: '[OLD]' }, target: { slot: 'node.inline', selector: { kind: 'match-ref', matchId: 'match' }, placement: 'replace' } }],
    matches: new Map([['match', { start: 0, end: 3 }]]),
  }
  try {
    await render('ABC xyz')
    await act(async () => { first.resolve(inline) })
    expect(container.textContent).toBe('[OLD] xyz')
    expect(host.instances()).toHaveLength(1)

    await render('DEF xyz')
    expect(project).toHaveBeenCalledTimes(2)
    expect(container.textContent).toBe('DEF xyz')
    expect(container.querySelector('[data-loom-render-mount]')).toBeNull()
    expect(disposed).toHaveBeenCalledTimes(1)
    expect(host.instances()).toHaveLength(0)

    await act(async () => { next.resolve(inline) })
    expect(container.textContent).toBe('[OLD] xyz')
    await render('DEF xyz', 'story-b')
    expect(container.textContent).toBe('DEF xyz')
    expect(host.instances()).toHaveLength(0)
    await act(async () => { changedOwner.resolve({ mounts: [], matches: new Map() }) })
    expect(container.textContent).toBe('DEF xyz')
    expect(mount).toHaveBeenCalledTimes(2)
    expect(disposed).toHaveBeenCalledTimes(2)
    expect(host.diagnostics()).toEqual([])
  } finally {
    await act(async () => { root.unmount() })
    registration.dispose()
    container.remove()
  }
})
