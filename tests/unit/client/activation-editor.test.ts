import {
  buildActivationUpdate,
  normalizeKeywords,
  readActivationDraft,
  updateActivationDraft,
} from '../../../apps/studio-client/src/features/prompt-resources/model/activation-editor.js'
import type { ContextAssetNode } from '../../../apps/studio-client/src/entities/index.js'
import { describe, expect, it } from 'vitest'

describe('context asset activation editor model', () => {
  it('writes condition activation for preset and setting prompt-facing nodes', () => {
    const preset = node('preset-entry', 'preset')
    const setting = node('setting-entry', 'lore')
    const draft = updateActivationDraft(readActivationDraft(preset), {
      mode: 'condition',
      conditionPreset: 'agent.mode',
      conditionValue: 'finalize',
    })

    expect(buildActivationUpdate({ node: preset, draft }).capabilities?.activation).toEqual({
      kind: 'condition',
      conditions: [{ fact: 'agent.mode', equals: 'finalize' }],
    })
    expect(buildActivationUpdate({ node: setting, draft }).capabilities?.activation).toEqual({
      kind: 'condition',
      conditions: [{ fact: 'agent.mode', equals: 'finalize' }],
    })
  })

  it('writes activation on module, folder, and entry nodes', () => {
    const draft = updateActivationDraft(readActivationDraft(node('module', 'lore', 'module')), {
      mode: 'condition',
      conditionPreset: 'tags',
      conditionValue: 'scene:combat',
    })

    expect(['module', 'folder', 'entry'].map(kind => buildActivationUpdate({
      node: node(kind, 'lore', kind as ContextAssetNode['kind']),
      draft,
    }).capabilities?.activation)).toEqual([
      { kind: 'condition', conditions: [{ fact: 'tags', includes: 'scene:combat' }] },
      { kind: 'condition', conditions: [{ fact: 'tags', includes: 'scene:combat' }] },
      { kind: 'condition', conditions: [{ fact: 'tags', includes: 'scene:combat' }] },
    ])
  })

  it('normalizes keyword activation input', () => {
    const draft = updateActivationDraft(readActivationDraft(node('entry', 'lore')), {
      mode: 'keyword',
      keywords: ' 雨，镜市, 雨， ,地下 \n 暗巷 ',
    })
    const update = buildActivationUpdate({ node: node('entry', 'lore'), draft })

    expect(normalizeKeywords(draft.keywords)).toEqual(['雨', '镜市', '地下', '暗巷'])
    expect(update.capabilities?.activation).toEqual({
      kind: 'keyword',
      keywords: ['雨', '镜市', '地下', '暗巷'],
    })
    expect(update.capabilities?.lifecycle).toEqual({ lifecycle: 'keyword' })
  })

  it('keeps custom activation untouched until the user switches modes', () => {
    const customNode = {
      ...node('custom', 'lore'),
      capabilities: {
        activation: { kind: 'all', activations: [{ kind: 'manual' }] },
      },
    } satisfies ContextAssetNode
    const draft = readActivationDraft(customNode)

    expect(draft.mode).toBe('custom')
    expect(buildActivationUpdate({ node: customNode, draft })).toEqual({})
  })
})

function node(id: string, category: ContextAssetNode['category'], kind: ContextAssetNode['kind'] = 'entry'): ContextAssetNode {
  return {
    id,
    category,
    kind,
    label: id,
    projection: {
      lifecycle: 'always',
      order: 'entry: 10',
      slotKey: category === 'preset' ? 'preset:test@preset.system' : 'lore:test@lore.stable',
      zoneId: category === 'preset' ? 'preset.system' : 'lore.stable',
    },
  }
}
