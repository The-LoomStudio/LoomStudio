import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { createClientRendererHost } from '../../../apps/studio-client/src/features/extension-renderers/model/client-renderer-host.js'
import { RendererSurfaceHost } from '../../../apps/studio-client/src/features/extension-renderers/ui/renderer-surface-host.js'

describe('RendererSurfaceHost', () => {
  it('projects ordered collection roots into one Host-owned surface', () => {
    const host = createClientRendererHost()
    host.register({
      packageId: 'official.b',
      moduleId: 'client',
      definition: { id: 'tail', name: 'B', surface: 'narrative.timeline.tail', instanceScope: 'timeline', suggestedOrder: 10 },
      mount: vi.fn(),
    })
    host.register({
      packageId: 'official.a',
      moduleId: 'client',
      definition: { id: 'tail', name: 'A', surface: 'narrative.timeline.tail', instanceScope: 'timeline', suggestedOrder: -10 },
      mount: vi.fn(),
    })
    const html = renderToStaticMarkup(createElement(RendererSurfaceHost, {
      host,
      scope: { kind: 'timeline', key: 'timeline-1' },
      surface: 'narrative.timeline.tail',
    }))
    expect(html.indexOf('official.a/client/tail')).toBeLessThan(html.indexOf('official.b/client/tail'))
    expect(html).toContain('data-renderer-policy="collection"')
  })

  it('renders only the active navigation contribution', () => {
    const host = createClientRendererHost()
    host.register({
      packageId: 'official.panel',
      moduleId: 'client',
      definition: { id: 'panel', name: 'Panel', surface: 'shell.workspace-panel', instanceScope: 'workspace' },
      mount: vi.fn(),
    })
    host.claim('shell.workspace-panel', 'workspace', 'official.panel/client/panel')
    const html = renderToStaticMarkup(createElement(RendererSurfaceHost, {
      host,
      scope: { kind: 'workspace', key: 'workspace' },
      surface: 'shell.workspace-panel',
    }))
    expect(html).toContain('official.panel/client/panel')
    expect(html).toContain('data-renderer-policy="navigation"')
  })

  it('does not mount a contribution into a mismatched instance scope', () => {
    const host = createClientRendererHost()
    host.register({
      packageId: 'official.sheet',
      moduleId: 'client',
      definition: { id: 'sheet', name: 'Sheet', surface: 'composer.sheet', instanceScope: 'timeline' },
      mount: vi.fn(),
    })
    host.claim('composer.sheet', 'workspace', 'official.sheet/client/sheet')
    const html = renderToStaticMarkup(createElement(RendererSurfaceHost, {
      host,
      scope: { kind: 'workspace', key: 'workspace' },
      surface: 'composer.sheet',
    }))
    expect(html).toBe('')
  })
})
