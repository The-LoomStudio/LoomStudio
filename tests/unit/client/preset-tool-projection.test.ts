import { describe, expect, it } from 'vitest'
import type { AgentToolDefinition, PresetToolMount } from '../../../apps/studio-client/src/entities/index.js'
import { buildPresetToolProjection } from '../../../apps/studio-client/src/features/context-assets/model/preset-tool-projection.js'

function tool(id: string, kind: AgentToolDefinition['input']['kind'], namespace = 'official'): AgentToolDefinition {
  return {
    id,
    version: 1,
    owner: { namespace },
    name: id.split('/').at(-1)!,
    description: `${id} description`,
    input: { kind },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function mount(toolId: string, input: Partial<PresetToolMount> = {}): PresetToolMount {
  return {
    id: `mount:${toolId}`,
    presetResourceId: 'preset-1',
    toolId,
    orderIndex: 0,
    defaultEnabled: true,
    origin: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    ...input,
  }
}

describe('preset tool projection', () => {
  it('keeps structured tools on the provider surface and content tools in external slots', () => {
    const result = buildPresetToolProjection({
      presetId: 'preset-1',
      tools: [tool('official/structured', 'structured'), tool('official/content-a', 'freeform'), tool('official/content-b', 'hybrid')],
      mounts: [
        mount('official/structured', { provider: { order: 20 } }),
        mount('official/content-a', { provider: { order: 10 }, content: { zone: 'tools', slot: 'official-tools', orderHint: 20 } }),
        mount('official/content-b', { provider: { order: 30 }, content: { zone: 'tools', slot: 'official-tools', orderHint: 30 } }),
      ],
    })

    expect(result.providerTools.map(item => item.toolId)).toEqual([
      'official/content-a',
      'official/structured',
      'official/content-b',
    ])
    expect(result.contentNodes).toHaveLength(1)
    expect(result.contentNodes[0]).toMatchObject({
      category: 'runtime',
      kind: 'virtual',
      label: 'official-tools',
      projection: { sourceKind: 'virtual', zoneId: 'tools' },
      readOnly: true,
    })
    expect(result.contentNodes[0]?.configRows?.map(row => row.label)).toEqual(['content-a', 'content-b'])
    expect(result.zoneDefinitions).toEqual([{ id: 'tools', displayName: 'Content Tools' }])
  })

  it('keeps plugin slots separate and omits disabled mounts', () => {
    const result = buildPresetToolProjection({
      presetId: 'preset-1',
      tools: [tool('official/content', 'freeform'), tool('weather/query', 'freeform', 'weather')],
      mounts: [
        mount('official/content', { defaultEnabled: false }),
        mount('weather/query', { content: { zone: 'tools', slot: 'weather-tools' } }),
      ],
    })

    expect(result.providerTools.map(item => item.toolId)).toEqual(['weather/query'])
    expect(result.contentNodes.map(node => node.label)).toEqual(['weather-tools'])
  })
})
