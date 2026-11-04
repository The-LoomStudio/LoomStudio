import { describe, expect, it, vi } from 'vitest'
import { createRendererSessionHost } from '../../../apps/studio-client/src/features/extension-renderers/model/renderer-session.js'
import { createClientRendererHost } from '../../../apps/studio-client/src/shared/extension-renderer-runtime/client-renderer-host.js'

describe('Renderer Session Host', () => {
  it('revokes private windows on scope changes and global windows when their renderer is removed', () => {
    const closed: string[] = []
    vi.stubGlobal('window', { location: { href: 'https://studio.test/' }, open: (url: string) => ({ opener: null, close: () => closed.push(url) }) })
    const renderers = createClientRendererHost()
    const sessions = createRendererSessionHost(renderers)
    try {
      const globalHandle = renderers.register({
        owner: { kind: 'extension', packageId: 'example.global', moduleId: 'client' },
        definition: { id: 'page', name: 'Global', surface: 'standalone.page', instanceScope: 'workspace' },
        frame: { src: '/global.html' }, mount: vi.fn(),
      })
      renderers.register({
        owner: { kind: 'extension', packageId: 'example.private', moduleId: 'client', target: { kind: 'card', cardId: 'a' } },
        definition: { id: 'page', name: 'Private', surface: 'standalone.page', instanceScope: 'timeline' },
        frame: { src: '/private.html' }, mount: vi.fn(),
      })
      renderers.setScopeSnapshot({ workspace: 'workspace', cardId: 'a', timelineId: 'timeline-a' })
      const registrations = renderers.list('standalone.page')
      const global = registrations.find(item => item.definition.name === 'Global')!
      const privateRenderer = registrations.find(item => item.definition.name === 'Private')!
      const globalSession = sessions.open(global, { kind: 'workspace', key: 'workspace' })
      const privateSession = sessions.open(privateRenderer, { kind: 'timeline', key: 'timeline-a' })
      renderers.setScopeSnapshot({ workspace: 'workspace', cardId: 'a', timelineId: 'timeline-a2' })
      expect(privateSession.state()).toBe('revoked')
      expect(globalSession.state()).toBe('opening')
      expect(closed).toHaveLength(1)
      const next = sessions.open(privateRenderer, { kind: 'timeline', key: 'timeline-a2' })
      renderers.setScopeSnapshot({ workspace: 'workspace', cardId: 'b', timelineId: 'timeline-b' })
      expect(next.state()).toBe('revoked')
      expect(() => sessions.open(privateRenderer, { kind: 'timeline', key: 'timeline-b' })).toThrow('unavailable')
      globalHandle.dispose()
      expect(globalSession.state()).toBe('revoked')
      expect(closed).toHaveLength(3)
    } finally {
      sessions.dispose()
      vi.unstubAllGlobals()
    }
  })

  it.each(['/page.html', '/page.html#settings', '/page.html?theme=dark#settings',
    'https://studio.test/page.html?loomRendererSession=old#settings'])('preserves query and hash for %s', src => {
    const open = vi.fn((_url: string, _target: string) => ({ opener: null, close: vi.fn() }))
    vi.stubGlobal('window', { location: { href: 'https://studio.test/studio/' }, open })
    const host = createRendererSessionHost()
    try {
      const handle = host.open({
        owner: { kind: 'extension', packageId: 'example.page', moduleId: 'client' },
        contributionId: 'page',
        definition: { id: 'page', name: 'Page', surface: 'standalone.page', instanceScope: 'workspace' },
        frame: { src }, mount: vi.fn(),
      }, { kind: 'workspace', key: 'workspace' })
      const actual = new URL(String(open.mock.calls[0]?.[0]))
      const original = new URL(src, 'https://studio.test/studio/')
      expect(actual.hash).toBe(original.hash)
      expect(actual.searchParams.get('theme')).toBe(original.searchParams.get('theme'))
      expect(actual.searchParams.getAll('loomRendererSession')).toEqual([handle.sessionId])
    } finally {
      host.dispose()
      vi.unstubAllGlobals()
    }
  })

  it('creates a disconnected standalone session when no browser window is available and supports revoke', () => {
    const host = createRendererSessionHost()
    const handle = host.open({
      owner: { kind: 'extension', packageId: 'example.page', moduleId: 'client' },
      contributionId: 'page',
      definition: { id: 'page', name: 'Page', surface: 'standalone.page', instanceScope: 'workspace', adapter: 'sandbox-iframe' },
      frame: { src: '/extensions/example.page/1.0.0/files/page.html' },
      mount: vi.fn(),
    }, { kind: 'workspace', key: 'workspace' })
    expect(handle.state()).toBe('disconnected')
    expect(host.summaries()).toEqual([expect.objectContaining({ sessionId: handle.sessionId, state: 'disconnected' })])
    handle.dispose()
    expect(handle.state()).toBe('revoked')
  })

  it.each([null, undefined])('does not allocate channels or accumulate failed attempts when window.open returns %s', opened => {
    const channel = vi.fn(function () { return { postMessage: vi.fn(), close: vi.fn() } })
    let nextWindow: { opener: unknown; close(): void } | null | undefined = opened
    vi.stubGlobal('BroadcastChannel', channel)
    vi.stubGlobal('window', { location: { href: 'https://studio.test/' }, open: () => nextWindow })
    const host = createRendererSessionHost()
    const registration = {
      owner: { kind: 'extension' as const, packageId: 'example.page', moduleId: 'client' },
      contributionId: 'page',
      definition: { id: 'page', name: 'Page', surface: 'standalone.page' as const, instanceScope: 'workspace' as const },
      frame: { src: '/page.html' }, mount: vi.fn(),
    }
    try {
      const first = host.open(registration, { kind: 'workspace', key: 'workspace' })
      const second = host.open(registration, { kind: 'workspace', key: 'workspace' })
      expect(channel).not.toHaveBeenCalled()
      expect(host.summaries()).toEqual([expect.objectContaining({ sessionId: second.sessionId, state: 'disconnected' })])
      expect(first.state()).toBe('revoked')
      const close = vi.fn()
      nextWindow = { opener: undefined, close }
      const recovered = host.open(registration, { kind: 'workspace', key: 'workspace' })
      expect(channel).toHaveBeenCalledOnce()
      expect(second.state()).toBe('revoked')
      expect(host.summaries()).toEqual([expect.objectContaining({ sessionId: recovered.sessionId, state: 'opening' })])
      recovered.dispose()
      expect(close).toHaveBeenCalledOnce()
      expect(host.summaries()).toEqual([])
    } finally {
      host.dispose()
      vi.unstubAllGlobals()
    }
  })
})
