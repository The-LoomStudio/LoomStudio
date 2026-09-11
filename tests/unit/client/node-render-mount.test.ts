import { describe, expect, it, vi } from 'vitest'
import type { ClientRendererRegistration } from '../../../apps/studio-client/src/features/extension-renderers/model/client-renderer-host.js'
import { resolveNodeRenderMounts } from '../../../apps/studio-client/src/features/extension-renderers/model/node-render-mount.js'

const registration: ClientRendererRegistration = {
  owner: { kind: 'extension', packageId: 'example.image', moduleId: 'client' },
  contributionId: 'inline',
  definition: { id: 'inline', name: 'Inline', surface: 'narrative.entry.inline', instanceScope: 'node' },
  mount: vi.fn(),
}

describe('Node Render Mount resolver', () => {
  it('resolves before, after and one unique literal anchor deterministically', () => {
    const result = resolveNodeRenderMounts({
      rawText: 'Alpha target Omega',
      mounts: [
        { registration, mount: { key: 'after', target: { slot: 'node.after' }, part: { type: 'text', content: 'after' } } },
        { registration, mount: { key: 'inline', target: { slot: 'node.inline', selector: { kind: 'literal', value: 'target' }, placement: 'after' }, part: { type: 'text', content: 'inline' } } },
        { registration, mount: { key: 'before', target: { slot: 'node.before' }, part: { type: 'text', content: 'before' } } },
      ],
    })
    expect(result.before.map(item => item.mount.key)).toEqual(['before'])
    expect(result.after.map(item => item.mount.key)).toEqual(['after'])
    expect(result.inline).toEqual([expect.objectContaining({ start: 6, end: 12, placement: 'after' })])
    expect(result.diagnostics).toEqual([])
  })

  it('rejects duplicate Mount keys and ambiguous literal anchors', () => {
    const duplicate = { registration, mount: { key: 'same', target: { slot: 'node.after' as const }, part: { type: 'text' as const, content: 'x' } } }
    const result = resolveNodeRenderMounts({
      rawText: 'same same',
      mounts: [
        duplicate,
        duplicate,
        { registration, mount: { key: 'ambiguous', target: { slot: 'node.inline', selector: { kind: 'literal', value: 'same' }, placement: 'replace' }, part: { type: 'text', content: 'x' } } },
      ],
    })
    expect(result.after).toHaveLength(1)
    expect(result.inline).toEqual([])
    expect(result.diagnostics.map(item => item.code)).toEqual(['renderer.mount_duplicate', 'renderer.anchor_ambiguous'])
  })

  it('resolves a stable match-ref from the official display range', () => {
    const result = resolveNodeRenderMounts({
      rawText: 'before <CharacterStatus>ready</CharacterStatus> after',
      matches: new Map([['match-1', { start: 7, end: 47 }]]),
      mounts: [{
        registration,
        mount: {
          key: 'status',
          target: { slot: 'node.inline', selector: { kind: 'match-ref', matchId: 'match-1' }, placement: 'replace' },
          part: { type: 'text', content: 'status' },
        },
      }],
    })

    expect(result.inline).toEqual([expect.objectContaining({ start: 7, end: 47, placement: 'replace' })])
    expect(result.diagnostics).toEqual([])
  })
})
