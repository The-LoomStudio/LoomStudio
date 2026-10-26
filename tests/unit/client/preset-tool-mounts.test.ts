import { describe, expect, it } from 'vitest'
import { togglePresetToolMount, validPresetToolMounts } from '../../../apps/studio-client/src/features/prompt-resources/model/preset-tool-mounts.js'
import type { AgentToolDefinition, PresetToolMount } from '../../../apps/studio-client/src/entities/index.js'

const structured = {
  id: 'official/codeact_json',
  input: { kind: 'structured', schema: { type: 'object' } },
  prompt: { content: { targetAnchorId: '@chat.tools' } },
} as unknown as AgentToolDefinition
const freeform = { id: 'official/codeact', input: { kind: 'freeform' } } as AgentToolDefinition

describe('Preset tool mounting', () => {
  it('preserves mount configuration when toggling default availability', () => {
    const mount: PresetToolMount = {
      id: 'mount', presetResourceId: 'preset', origin: {}, createdAt: '',
      toolId: structured.id, orderIndex: 3, defaultEnabled: false,
      activation: { kind: 'always' }, provider: { order: 5 },
    }
    expect(togglePresetToolMount([mount], structured)).toEqual([{
      toolId: structured.id, orderIndex: 3, defaultEnabled: true,
      activation: { kind: 'always' }, provider: { order: 5 },
    }])
  })

  it('removes invalid Content only from structured mounts in whole-list replacements', () => {
    const mounts = [
      { toolId: structured.id, orderIndex: 0, defaultEnabled: true, content: { targetAnchorId: '@old' } },
      { toolId: freeform.id, orderIndex: 1, defaultEnabled: true, content: { targetAnchorId: '@chat.tools' } },
    ]
    expect(validPresetToolMounts(mounts, [structured, freeform])).toEqual([
      { toolId: structured.id, orderIndex: 0, defaultEnabled: true },
      mounts[1],
    ])
    expect(togglePresetToolMount([], structured)[0]).not.toHaveProperty('content')
  })
})
