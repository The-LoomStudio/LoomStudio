import { describe, expect, it, vi } from 'vitest'
import { createNarrativeRuntimeMethods } from '../../../packages/application-runtime/src/runtime/narrative-runtime.js'
import type { ApplicationRuntimeContext } from '../../../packages/application-runtime/src/foundation/application-context.js'

describe('Narrative effective preview', () => {
  it('reads only after the published Memory boundary through the raw endpoint', async () => {
    const getPage = vi.fn(async ({ cursor }: { cursor?: string }) => ({
      timeline: { id: 'timeline', createdFrom: { cardId: 'card' } },
      branch: { id: 'branch', headNodeId: 'newer' },
      nodes: cursor === 'older' ? [{ id: 'older', body: { raw: 'covered' } }] : [
        { id: 'older', body: { raw: 'covered' } },
        { id: 'newer', body: { raw: 'visible' } },
      ],
    }))
    const resolve = vi.fn(async () => ({
      sourceId: 'memory-provider',
      version: '1',
      memory: { coveredThroughNodeId: 'older', entries: [{ id: 'summary', content: 'summary' }] },
      rawThroughNodeId: 'newer',
    }))
    const methods = createNarrativeRuntimeMethods({
      narratives: { getPage },
      narrativeContext: { resolve },
    } as unknown as ApplicationRuntimeContext)
    const result = await methods.getEffectiveNarrativePreview({ timelineId: 'timeline', branchId: 'branch' })
    expect(resolve).toHaveBeenCalledWith({ timelineId: 'timeline', branchId: 'branch', cardId: 'card' })
    expect(result).toMatchObject({
      coveredThroughNodeId: 'older',
      rawThroughNodeId: 'newer',
      nodes: [{ id: 'newer', text: 'visible' }],
      complete: true,
    })
  })
})
