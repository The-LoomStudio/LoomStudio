import {
  createOfficialAgentToolRegistry,
  createPromptToolExecutionScope,
  officialReadContextTool,
  officialSearchContextTool,
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
  it('registers search_context and read_context as structured tools', () => {
    const registry = createOfficialAgentToolRegistry()
    expect(registry.list()).toEqual([
      officialSearchContextTool,
      officialReadContextTool,
    ])
    expect(
      registry.analyze(
        [officialSearchContextTool.id, officialReadContextTool.id],
        { nativeFunction: true, providerCustom: false, content: true },
      ).exposures,
    ).toEqual([
      expect.objectContaining({ transport: 'native-function' }),
      expect.objectContaining({ transport: 'native-function' }),
    ])
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
      content: [{ type: 'json', value: { id: 'fragment:knowledge', content: expect.stringContaining('Agent Sessions') } }],
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
          capabilities: { projection: { zoneId: 'tools' } },
        },
        {
          id: 'knowledge-fragment',
          sourceRef: { kind: 'settingLayer', sourceId: 'knowledge', sourceNodeId: 'knowledge-node' },
          content: 'visible knowledge',
          capabilities: {
            activation: { kind: 'keyword', keywords: [] },
            projection: { zoneId: 'setting.stable', joinSlotKey: 'setting:knowledge' },
          },
        },
      ],
    })

    expect(result.context.map(item => item.id)).toEqual(['knowledge-fragment'])
    expect(result.context[0]).toMatchObject({ name: 'Hidden Knowledge', promptState: 'not-triggered' })
  })
})
