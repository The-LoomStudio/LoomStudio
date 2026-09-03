import {
  createOfficialAgentToolRegistry,
  createPromptToolExecutionScope,
  officialAppendNarrativeTool,
  officialEditNarrativeTool,
  officialReadContextTool,
  officialReadStateTool,
  officialSearchContextTool,
  officialUpdateStateTool,
} from '@loom-studio/application-runtime'
import { describe, expect, it } from 'vitest'

const signal = new AbortController().signal
const scope = {
  context: [
    {
      id: 'fragment:knowledge',
      name: 'Knowledge',
      zoneId: 'setting.stable',
      slotKey: 'setting:knowledge',
      sourceKind: 'settingLayer',
      sourceId: 'knowledge',
      promptState: 'not-triggered' as const,
      content: 'Loom Studio uses Prompt Resources and Agent Sessions.',
    },
  ],
}

describe('official Agent context tools', () => {
  it('registers search_context, read_context, read_state, update_state, append_narrative, edit_narrative as structured tools', () => {
    const registry = createOfficialAgentToolRegistry()
    expect(registry.list()).toEqual([
      officialSearchContextTool,
      officialReadContextTool,
      officialReadStateTool,
      officialUpdateStateTool,
      officialAppendNarrativeTool,
      officialEditNarrativeTool,
    ])
    expect(
      registry.analyze(
        [officialSearchContextTool.id, officialReadContextTool.id, officialAppendNarrativeTool.id, officialEditNarrativeTool.id],
        { nativeFunction: true, providerCustom: false, content: true },
      ).exposures,
    ).toEqual([
      expect.objectContaining({ transport: 'native-function' }),
      expect.objectContaining({ transport: 'native-function' }),
      expect.objectContaining({ transport: 'native-function' }),
      expect.objectContaining({ transport: 'native-function' }),
    ])
  })

  it('reads and updates only State targets authorized for the current turn', async () => {
    const registry = createOfficialAgentToolRegistry()
    let revisionId = 'revision-1'
    let value = { gold: 10 }
    const stateScope = {
      ...scope,
      state: {
        canAccess: (target: { scope: 'global' } | { scope: 'timeline'; timelineId: string; branchId: string }) => target.scope === 'global',
        read: async () => ({ revisionId, value }),
        update: async (input: { idempotencyKey: string }) => {
          expect(input.idempotencyKey).toBe('inv-update')
          revisionId = 'revision-2'
          value = { gold: 7 }
          return { revisionId }
        },
      },
    }
    const read = await registry.execute({
      id: 'inv-read-state', toolId: officialReadStateTool.id,
      arguments: { target: { scope: 'global' }, paths: ['/gold'] }, transport: 'native-function',
    }, signal, stateScope)
    const update = await registry.execute({
      id: 'inv-update', toolId: officialUpdateStateTool.id,
      arguments: {
        target: { scope: 'global' }, expectedRevisionId: 'revision-1',
        operations: [{ op: 'increment', path: '/gold', by: -3 }],
      }, transport: 'native-function',
    }, signal, stateScope)

    expect(read).toMatchObject({ content: [{ value: { revisionId: 'revision-1', value: { '/gold': 10 } } }] })
    expect(update).toMatchObject({ content: [{ value: { revisionId: 'revision-2', modifiedPaths: ['/gold'] } }] })
    const denied = await registry.execute({
      id: 'inv-denied', toolId: officialReadStateTool.id,
      arguments: { target: { scope: 'timeline', timelineId: 'other', branchId: 'other' } }, transport: 'native-function',
    }, signal, stateScope)
    expect(denied).toMatchObject({ status: 'failed', error: { code: 'state.permission_denied' } })
  })

  it('preserves State error codes and replays one invocation without a second mutation', async () => {
    const registry = createOfficialAgentToolRegistry()
    const revisions = new Map<string, string>()
    let mutations = 0
    const stateScope = {
      ...scope,
      state: {
        canAccess: () => true,
        read: async () => ({ revisionId: 'revision-1', value: { gold: 10 } }),
        update: async (input: { expectedRevisionId: string; idempotencyKey: string }) => {
          if (input.expectedRevisionId === 'schema-error') {
            throw Object.assign(new Error('gold must be non-negative'), { code: 'state.schema_minimum' })
          }
          if (input.expectedRevisionId === 'stale-revision') {
            throw Object.assign(new Error('State head changed'), { code: 'state.head_conflict' })
          }
          const replay = revisions.get(input.idempotencyKey)
          if (replay) return { revisionId: replay }
          mutations += 1
          revisions.set(input.idempotencyKey, 'revision-2')
          return { revisionId: 'revision-2' }
        },
      },
    }
    const invocation = {
      id: 'inv-idempotent', toolId: officialUpdateStateTool.id,
      arguments: {
        target: { scope: 'global' }, expectedRevisionId: 'revision-1',
        operations: [{ op: 'increment', path: '/gold', by: -3 }],
      }, transport: 'native-function' as const,
    }

    const first = await registry.execute(invocation, signal, stateScope)
    const replay = await registry.execute(invocation, signal, stateScope)
    const schemaError = await registry.execute({
      ...invocation, id: 'inv-schema',
      arguments: { ...invocation.arguments, expectedRevisionId: 'schema-error' },
    }, signal, stateScope)
    const headConflict = await registry.execute({
      ...invocation, id: 'inv-conflict',
      arguments: { ...invocation.arguments, expectedRevisionId: 'stale-revision' },
    }, signal, stateScope)

    expect(first).toEqual(replay)
    expect(mutations).toBe(1)
    expect(schemaError).toMatchObject({ status: 'failed', error: { code: 'state.schema_minimum' } })
    expect(headConflict).toMatchObject({ status: 'failed', error: { code: 'state.head_conflict' } })
  })

  it('searches the current execution scope and reads an exact item', async () => {
    const registry = createOfficialAgentToolRegistry()
    const search = await registry.execute({
      id: 'inv-search',
      toolId: officialSearchContextTool.id,
      arguments: { query: 'prompt resources' },
      transport: 'native-function',
    }, signal, scope)
    const read = await registry.execute({
      id: 'inv-read',
      toolId: officialReadContextTool.id,
      arguments: { id: 'fragment:knowledge' },
      transport: 'native-function',
    }, signal, scope)

    expect(search).toMatchObject({
      status: 'completed',
      content: [{ type: 'json', value: { matches: [{ id: 'fragment:knowledge' }] } }],
    })
    expect(read).toMatchObject({
      status: 'completed',
      content: [{ type: 'json', value: { id: 'fragment:knowledge', mounted: 'fresh' } }],
      contextMounts: [{ id: 'fragment:knowledge', content: expect.stringContaining('Agent Sessions') }],
    })
  })

  it('includes non-triggered resources and excludes tool instructions', () => {
    const result = createPromptToolExecutionScope({
      prompt: {
        zones: [],
        messages: [],
        messageBlocks: [],
        editorProjection: { sourceRows: [], promptRows: [] },
      },
      sourceNodes: [
        { id: 'tools-node', sourceId: 'tools', parentId: null, displayName: 'Tools', orderIndex: 1 },
        { id: 'knowledge-node', sourceId: 'knowledge', parentId: null, displayName: 'Hidden Knowledge', orderIndex: 2 },
      ],
      contributions: [
        {
          id: 'tool-fragment',
          sourceRef: { kind: 'runtime', sourceId: 'tools', sourceNodeId: 'tools-node' },
          content: 'tool instructions',
          capabilities: { targetAnchorId: '@chat.tools' },
        },
        {
          id: 'knowledge-fragment',
          sourceRef: { kind: 'settingLayer', sourceId: 'knowledge', sourceNodeId: 'knowledge-node' },
          content: 'visible knowledge',
          capabilities: {
            activation: { kind: 'keyword', keywords: [] },
            targetAnchorId: 'setting.stable', localDepth: 10,
          },
        },
      ],
    })

    expect(result.context.map(item => item.id)).toEqual(['knowledge-fragment'])
    expect(result.context[0]).toMatchObject({ name: 'Hidden Knowledge', promptState: 'not-triggered' })
  })

  it('appends narrative node to active timeline through append_narrative tool', async () => {
    const registry = createOfficialAgentToolRegistry()
    let appendedContent = ''
    const narrativeScope = {
      ...scope,
      narrative: {
        timelineId: 'timeline-1',
        branchId: 'branch-1',
        appendNode: async ({ content }: { content: string }) => {
          appendedContent = content
          return { nodeId: 'node-new-1' }
        },
        editNode: async () => {
          throw new Error('Not used')
        },
      },
    }

    const result = await registry.execute({
      id: 'inv-append-1',
      toolId: officialAppendNarrativeTool.id,
      arguments: { content: '新情节发生在一个雨夜。' },
      transport: 'native-function',
    }, signal, narrativeScope)

    expect(result.status).toBe('completed')
    expect(appendedContent).toBe('新情节发生在一个雨夜。')
    expect(result.content).toEqual([{
      type: 'json',
      value: {
        nodeId: 'node-new-1',
        timelineId: 'timeline-1',
        branchId: 'branch-1',
      },
    }])
  })

  it('edits narrative node in active timeline through edit_narrative tool', async () => {
    const registry = createOfficialAgentToolRegistry()
    let editedNodeId = ''
    let editedContent = ''
    const narrativeScope = {
      ...scope,
      narrative: {
        timelineId: 'timeline-1',
        branchId: 'branch-1',
        appendNode: async () => {
          throw new Error('Not used')
        },
        editNode: async ({ nodeId, content }: { nodeId: string; content: string }) => {
          editedNodeId = nodeId
          editedContent = content
          return { nodeId }
        },
      },
    }

    const result = await registry.execute({
      id: 'inv-edit-1',
      toolId: officialEditNarrativeTool.id,
      arguments: { nodeId: 'node-existing-1', content: '修改后的情节' },
      transport: 'native-function',
    }, signal, narrativeScope)

    expect(result.status).toBe('completed')
    expect(editedNodeId).toBe('node-existing-1')
    expect(editedContent).toBe('修改后的情节')
    expect(result.content).toEqual([{
      type: 'json',
      value: {
        nodeId: 'node-existing-1',
        timelineId: 'timeline-1',
        branchId: 'branch-1',
      },
    }])
  })
})

