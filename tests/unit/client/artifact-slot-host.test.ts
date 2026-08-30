import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ArtifactSlotHost } from '../../../apps/studio-client/src/features/text-transforms/ui/artifact-slot-host.js'

describe('ArtifactSlotHost', () => {
  it('mounts one host-owned renderer instance per artifact in the requested scope slot', () => {
    const html = renderToStaticMarkup(createElement(ArtifactSlotHost, {
      surface: 'shell.workspace-panel',
      renderers: [{ id: 'json', name: 'JSON', artifactType: 'application/json', surface: 'shell.workspace-panel', instanceScope: 'workspace', fallback: 'json' }],
      artifacts: [{ id: 'world-state', artifactType: 'application/json', content: { location: 'tavern' } }],
    }))
    expect(html.match(/data-loom-component="artifact-slot-host"/g)).toHaveLength(1)
    expect(html.match(/data-renderer-id="json"/g)).toHaveLength(1)
    expect(html).toContain('tavern')
  })
})
