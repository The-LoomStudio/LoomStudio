import { createId, nowIso } from '@loom-studio/shared'
import { describe, expect, it, vi } from 'vitest'
import { createNarrativeRuntimeMethods } from '../../../packages/application-runtime/src/runtime/narrative-runtime.js'
import { createApplicationRuntimeContext } from '../../../packages/application-runtime/src/foundation/application-context.js'
import { createAgentStore, createNarrativeStore, createPromptResourceStore, type NarrativePage } from '@loom-studio/application-data'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'

describe('Narrative effective preview', () => {
  it('reads only after the published Memory boundary through the raw endpoint', async () => {
    const timestamp = '2026-11-04T00:00:00.000Z'
    const nodes: NarrativePage['nodes'] = [
      { id: 'older', timelineId: 'timeline', kind: 'narrative', floor: 1,
        stateRevisionId: 'state', workspaceRevisionId: 'workspace',
        body: { format: 'loom-markdown.v1', raw: 'covered' }, createdAt: timestamp },
      { id: 'newer', timelineId: 'timeline', parentNodeId: 'older', kind: 'narrative', floor: 2,
        stateRevisionId: 'state', workspaceRevisionId: 'workspace',
        body: { format: 'loom-markdown.v1', raw: 'visible' }, createdAt: timestamp },
    ]
    const getPage = vi.fn(async ({ cursor }: { cursor?: string }): Promise<NarrativePage> => ({
      timeline: { id: 'timeline', createdFrom: { cardId: 'card', cardVersion: 1 },
        promptResourceIds: [], activeBranchId: 'branch', createdAt: timestamp, updatedAt: timestamp },
      branch: { id: 'branch', timelineId: 'timeline', headNodeId: 'newer',
        stateHeadRevisionId: 'state', workspaceHeadRevisionId: 'workspace', createdAt: timestamp, updatedAt: timestamp },
      nodes: cursor === 'older' ? nodes.slice(0, 1) : nodes,
    }))
    const resolve = vi.fn(async () => ({
      sourceId: 'memory-provider',
      version: '1',
      memory: { coveredThroughNodeId: 'older', entries: [{ id: 'summary', content: 'summary' }] },
      rawThroughNodeId: 'newer',
    }))
    const engine = createSqliteDataEngine({ filename: ':memory:', createId, now: nowIso })
    const ctx = createApplicationRuntimeContext({ dataEngine: engine, documents: createSqliteDocumentStore({ engine }),
      agents: createAgentStore({ engine }), narratives: createNarrativeStore({ engine }), promptResources: createPromptResourceStore({ engine }) })
    const methods = createNarrativeRuntimeMethods({ ...ctx,
      narratives: { ...ctx.narratives!, getPage },
      narrativeContext: { ...ctx.narrativeContext, resolve },
    })
    try {
      const result = await methods.getEffectiveNarrativePreview({ timelineId: 'timeline', branchId: 'branch' })
      expect(resolve).toHaveBeenCalledWith({ timelineId: 'timeline', branchId: 'branch', cardId: 'card' })
      expect(result).toMatchObject({
        coveredThroughNodeId: 'older',
        rawThroughNodeId: 'newer',
        nodes: [{ id: 'newer', text: 'visible' }],
        complete: true,
      })
    } finally { ctx.observations.dispose(); engine.close() }
  })
})
