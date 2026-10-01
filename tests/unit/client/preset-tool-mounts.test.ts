import { describe, expect, it } from 'vitest'
import { togglePresetToolMount, validPresetToolMounts } from '../../../apps/studio-client/src/features/context-assets/model/preset-tool-mounts.js'
import type { AgentToolDefinition, PresetToolMount } from '../../../apps/studio-client/src/entities/index.js'

const structured = {
  id: 'official/codeact_json',
  input: { kind: 'structured', schema: { type: 'object' } },
  prompt: { content: { zone: 'tools' } },
} as unknown as AgentToolDefinition
const freeform = { id: 'official/codeact', input: { kind: 'freeform' } } as AgentToolDefinition

describe('Preset tool mounting', () => {
  it('preserves mount configuration when toggling default availability', () => {
    const mount = {
      toolId: structured.id, orderIndex: 3, defaultEnabled: false,
      activation: { kind: 'always' }, provider: { order: 5 },
    } as PresetToolMount
    expect(togglePresetToolMount([mount], structured)).toEqual([{
      toolId: structured.id, orderIndex: 3, defaultEnabled: true,
      activation: { kind: 'always' }, provider: { order: 5 },
    }])
  })

  it('removes invalid Content only from structured mounts in whole-list replacements', () => {
    const mounts = [
      { toolId: structured.id, orderIndex: 0, defaultEnabled: true, content: { zone: 'old' } },
      { toolId: freeform.id, orderIndex: 1, defaultEnabled: true, content: { zone: 'tools' } },
    ]
    expect(validPresetToolMounts(mounts, [structured, freeform])).toEqual([
      { toolId: structured.id, orderIndex: 0, defaultEnabled: true },
      mounts[1],
    ])
    expect(togglePresetToolMount([], structured)[0]).not.toHaveProperty('content')
  })
})
