import { describe, expect, it, vi } from 'vitest'
import { createClientRendererHost } from '../../../apps/studio-client/src/features/extension-renderers/model/client-renderer-host.js'
import { listRuntimeRendererRegistrations, listRuntimeScriptItems } from '../../../apps/studio-client/src/features/text-transforms/ui/text-transform-panel.js'

describe('text pipeline runtime catalog', () => {
  it('lists effective extension and Loom Script renderer registrations', () => {
    const host = createClientRendererHost()
    const definition = {
      id: 'tail',
      name: 'Tail',
      surface: 'narrative.timeline.tail' as const,
      instanceScope: 'timeline' as const,
      adapter: 'direct' as const,
    }
    host.register({ owner: { kind: 'extension', packageId: 'example.extension', moduleId: 'client' }, definition, mount: vi.fn() })
    host.register({ owner: { kind: 'script', scriptDocumentId: 'effective-script', documentVersion: 3 }, definition: { ...definition, id: 'script-tail' }, mount: vi.fn() })

    expect(listRuntimeRendererRegistrations(host).map(item => item.key)).toEqual([
      'extension:example.extension/client/tail',
      'script:effective-script@3/script-tail',
    ])
  })

  it('keeps unrelated Card scripts out when the runtime resolver omits them', () => {
    const resolvedMounts = [{
      mountId: 'mount-1', enabled: true, orderIndex: 0, grantedCapabilities: [], source: '// effective',
      script: { id: 'effective-script', version: 3, name: 'Effective', metadataId: 'effective', scriptVersion: '1.0.0', requestedCapabilities: [], contributions: [] },
    }]

    expect(listRuntimeScriptItems(resolvedMounts).map(item => item.id)).toEqual(['script:effective-script'])
    expect(listRuntimeScriptItems(resolvedMounts).map(item => item.id)).not.toContain('script:other-card-script')
  })

  it('excludes disabled mounts from the effective runtime sequence', () => {
    const mount = {
      mountId: 'mount-1', orderIndex: 0, grantedCapabilities: [], source: '// source',
      script: { id: 'script-1', version: 1, name: 'Script', metadataId: 'script', scriptVersion: '1.0.0', requestedCapabilities: [], contributions: [] },
    }

    expect(listRuntimeScriptItems([{ ...mount, enabled: false }])).toEqual([])
    expect(listRuntimeScriptItems([{ ...mount, enabled: true }]).map(item => item.id)).toEqual(['script:script-1'])
  })
})
