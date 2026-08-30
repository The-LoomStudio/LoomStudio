import { describe, expect, it, vi } from 'vitest'
import { createRendererSessionHost } from '../../../apps/studio-client/src/features/extension-renderers/model/renderer-session.js'

describe('Renderer Session Host', () => {
  it('creates a disconnected standalone session when no browser window is available and supports revoke', () => {
    const host = createRendererSessionHost()
    const handle = host.open({
      packageId: 'example.page',
      moduleId: 'client',
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
})
