import { describe, expect, it, vi } from 'vitest'
import { createClientRendererHost } from '../../../apps/studio-client/src/shared/extension-renderer-runtime/client-renderer-host.js'
import { rendererContributionKey } from '../../../apps/studio-client/src/shared/extension-renderer-runtime/renderer-registry.js'

describe('Client Renderer Host', () => {
  it('separates same-name installation renderers and releases private claims on Card changes', () => {
    const host = createClientRendererHost()
    const owners = [
      { kind: 'extension' as const, packageId: 'example.shared', moduleId: 'client' },
      { kind: 'extension' as const, packageId: 'example.shared', moduleId: 'client', target: { kind: 'card' as const, cardId: 'a' } },
      { kind: 'extension' as const, packageId: 'example.shared', moduleId: 'client', target: { kind: 'card' as const, cardId: 'b' } },
    ]
    const keys = owners.map(owner => {
      host.register({
        owner, definition: { id: 'panel', name: 'Panel', surface: 'shell.workspace-panel', instanceScope: 'workspace' },
        mount: vi.fn(),
      })
      return rendererContributionKey({ owner, contributionId: 'panel' })
    })
    expect(new Set(keys).size).toBe(3)
    host.setScopeSnapshot({ workspace: 'workspace', cardId: 'a' })
    expect(host.list('shell.workspace-panel').map(rendererContributionKey)).toEqual([keys[0], keys[1]])
    expect(host.find(keys[2]!)).toBeUndefined()
    expect(() => host.claim('shell.workspace-panel', 'workspace', keys[2]!)).toThrow('outside this Card')
    host.claim('shell.workspace-panel', 'workspace', keys[1]!)
    host.trackInstance('shell.workspace-panel', { kind: 'workspace', key: 'workspace' }, keys[1]!)
    host.setScopeSnapshot({ workspace: 'workspace', cardId: 'b' })
    expect(host.activeClaims()).toEqual([])
    expect(host.instances()).toEqual([])
    expect(host.list('shell.workspace-panel').map(rendererContributionKey)).toEqual([keys[0], keys[2]])
  })

  it('notifies instance observers without recursively invalidating render projections', () => {
    const host = createClientRendererHost()
    const listener = vi.fn()
    host.subscribe(listener)
    const before = host.renderRevision()
    const instance = host.trackInstance('narrative.entry.inline', { kind: 'node', key: 'node' }, 'preview')
    expect(host.instances()).toHaveLength(1)
    instance.dispose()
    expect(host.instances()).toHaveLength(0)
    expect(listener).toHaveBeenCalledTimes(2)
    expect(host.revision()).toBe(2)
    expect(host.renderRevision()).toBe(before)
    host.invalidate()
    expect(host.renderRevision()).toBe(before + 1)
  })

  it('registers, orders and disposes collection contributions', () => {
    const host = createClientRendererHost()
    const first = host.register({
      owner: { kind: 'extension', packageId: 'example.b', moduleId: 'client' },
      definition: { id: 'tail', name: 'B', surface: 'narrative.timeline.tail', instanceScope: 'timeline', suggestedOrder: 10 },
      mount: vi.fn(),
    })
    host.register({
      owner: { kind: 'extension', packageId: 'example.a', moduleId: 'client' },
      definition: { id: 'tail', name: 'A', surface: 'narrative.timeline.tail', instanceScope: 'timeline', suggestedOrder: -10 },
      mount: vi.fn(),
    })
    expect(host.list('narrative.timeline.tail').map(item => item.owner)).toEqual([
      { kind: 'extension', packageId: 'example.a', moduleId: 'client' },
      { kind: 'extension', packageId: 'example.b', moduleId: 'client' },
    ])
    first.dispose()
    expect(host.list('narrative.timeline.tail').map(item => item.owner)).toEqual([{ kind: 'extension', packageId: 'example.a', moduleId: 'client' }])
  })

  it('releases exclusive claims when their contribution is disposed', () => {
    const host = createClientRendererHost()
    const registration = host.register({
      owner: { kind: 'extension', packageId: 'example.focus', moduleId: 'client' },
      definition: { id: 'focus', name: 'Focus', surface: 'shell.focus-surface', instanceScope: 'workspace' },
      mount: vi.fn(),
    })
    expect(host.claim('shell.focus-surface', 'workspace', 'extension:example.focus/client/focus')).toEqual(expect.objectContaining({ accepted: true }))
    expect(host.activeContributionKey('shell.focus-surface', 'workspace')).toBe('extension:example.focus/client/focus')
    registration.dispose()
    expect(host.activeContributionKey('shell.focus-surface', 'workspace')).toBeUndefined()
  })

  it('notifies subscribers after registry and claim changes', () => {
    const host = createClientRendererHost()
    const listener = vi.fn()
    host.subscribe(listener)
    host.register({
      owner: { kind: 'extension', packageId: 'example.focus', moduleId: 'client' },
      definition: { id: 'focus', name: 'Focus', surface: 'shell.focus-surface', instanceScope: 'workspace' },
      mount: vi.fn(),
    })
    host.claim('shell.focus-surface', 'workspace', 'extension:example.focus/client/focus')
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('tracks active scopes and mounted Renderer instances', () => {
    const host = createClientRendererHost()
    host.setScopeSnapshot({ workspace: 'workspace', timelineId: 'timeline-1' })
    const registration = host.register({
      owner: { kind: 'extension', packageId: 'example.background', moduleId: 'client' },
      definition: { id: 'background', name: 'Background', surface: 'shell.background', instanceScope: 'workspace' },
      mount: vi.fn(),
    })
    const instance = host.trackInstance('shell.background', { kind: 'workspace', key: 'workspace' }, 'extension:example.background/client/background')
    expect(host.scopeSnapshot()).toEqual({ workspace: 'workspace', timelineId: 'timeline-1' })
    expect(host.instances()).toEqual([expect.objectContaining({ contributionKey: 'extension:example.background/client/background' })])
    instance.dispose()
    expect(host.instances()).toEqual([])
    registration.dispose()
  })

  it('keeps Workspace background claims when the active Timeline changes', () => {
    const host = createClientRendererHost()
    host.register({
      owner: { kind: 'extension', packageId: 'example.background', moduleId: 'client' },
      definition: { id: 'background', name: 'Background', surface: 'shell.background', instanceScope: 'workspace' },
      mount: vi.fn(),
    })
    host.setScopeSnapshot({ workspace: 'workspace', timelineId: 'timeline-1' })
    host.claim('shell.background', 'workspace', 'extension:example.background/client/background')
    host.setScopeSnapshot({ workspace: 'workspace', timelineId: 'timeline-2' })
    expect(host.activeContributionKey('shell.background', 'workspace')).toBe('extension:example.background/client/background')
  })
})
