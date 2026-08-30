import { describe, expect, it, vi } from 'vitest'
import { createClientRendererHost } from '../../../apps/studio-client/src/features/extension-renderers/model/client-renderer-host.js'

describe('Client Renderer Host', () => {
  it('registers, orders and disposes collection contributions', () => {
    const host = createClientRendererHost()
    const first = host.register({
      packageId: 'example.b',
      moduleId: 'client',
      definition: { id: 'tail', name: 'B', surface: 'narrative.timeline.tail', instanceScope: 'timeline', suggestedOrder: 10 },
      mount: vi.fn(),
    })
    host.register({
      packageId: 'example.a',
      moduleId: 'client',
      definition: { id: 'tail', name: 'A', surface: 'narrative.timeline.tail', instanceScope: 'timeline', suggestedOrder: -10 },
      mount: vi.fn(),
    })
    expect(host.list('narrative.timeline.tail').map(item => item.packageId)).toEqual(['example.a', 'example.b'])
    first.dispose()
    expect(host.list('narrative.timeline.tail').map(item => item.packageId)).toEqual(['example.a'])
  })

  it('releases exclusive claims when their contribution is disposed', () => {
    const host = createClientRendererHost()
    const registration = host.register({
      packageId: 'example.focus',
      moduleId: 'client',
      definition: { id: 'focus', name: 'Focus', surface: 'shell.focus-surface', instanceScope: 'workspace' },
      mount: vi.fn(),
    })
    expect(host.claim('shell.focus-surface', 'workspace', 'example.focus/client/focus')).toEqual(expect.objectContaining({ accepted: true }))
    expect(host.activeContributionKey('shell.focus-surface', 'workspace')).toBe('example.focus/client/focus')
    registration.dispose()
    expect(host.activeContributionKey('shell.focus-surface', 'workspace')).toBeUndefined()
  })

  it('notifies subscribers after registry and claim changes', () => {
    const host = createClientRendererHost()
    const listener = vi.fn()
    host.subscribe(listener)
    host.register({
      packageId: 'example.focus',
      moduleId: 'client',
      definition: { id: 'focus', name: 'Focus', surface: 'shell.focus-surface', instanceScope: 'workspace' },
      mount: vi.fn(),
    })
    host.claim('shell.focus-surface', 'workspace', 'example.focus/client/focus')
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('tracks active scopes and mounted Renderer instances', () => {
    const host = createClientRendererHost()
    host.setScopeSnapshot({ workspace: 'workspace', timelineId: 'timeline-1' })
    const registration = host.register({
      packageId: 'example.background',
      moduleId: 'client',
      definition: { id: 'background', name: 'Background', surface: 'shell.background', instanceScope: 'workspace' },
      mount: vi.fn(),
    })
    const instance = host.trackInstance('shell.background', { kind: 'workspace', key: 'workspace' }, 'example.background/client/background')
    expect(host.scopeSnapshot()).toEqual({ workspace: 'workspace', timelineId: 'timeline-1' })
    expect(host.instances()).toEqual([expect.objectContaining({ contributionKey: 'example.background/client/background' })])
    instance.dispose()
    expect(host.instances()).toEqual([])
    registration.dispose()
  })

  it('keeps Workspace background claims when the active Timeline changes', () => {
    const host = createClientRendererHost()
    host.register({
      packageId: 'example.background',
      moduleId: 'client',
      definition: { id: 'background', name: 'Background', surface: 'shell.background', instanceScope: 'workspace' },
      mount: vi.fn(),
    })
    host.setScopeSnapshot({ workspace: 'workspace', timelineId: 'timeline-1' })
    host.claim('shell.background', 'workspace', 'example.background/client/background')
    host.setScopeSnapshot({ workspace: 'workspace', timelineId: 'timeline-2' })
    expect(host.activeContributionKey('shell.background', 'workspace')).toBe('example.background/client/background')
  })
})
