import {
  buildActivationUpdate,
  normalizeKeywords,
  readActivationDraft,
  updateActivationDraft,
} from '../../../apps/studio-client/src/features/context-assets/model/activation-editor.js'
import type { ContextAssetNode } from '../../../apps/studio-client/src/entities/index.js'
import { describe, expect, it } from 'vitest'

describe('context asset activation editor model', () => {
  it('writes condition activation for preset and setting prompt-facing nodes', () => {
    const preset = node('preset-entry', 'preset')
    const setting = node('setting-entry', 'setting')
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
    const draft = updateActivationDraft(readActivationDraft(node('module', 'setting', 'module')), {
      mode: 'condition',
      conditionPreset: 'tags',
      conditionValue: 'scene:combat',
    })

    expect(['module', 'folder', 'entry'].map(kind => buildActivationUpdate({
      node: node(kind, 'setting', kind as ContextAssetNode['kind']),
      draft,
    }).capabilities?.activation)).toEqual([
      { kind: 'condition', conditions: [{ fact: 'tags', includes: 'scene:combat' }] },
      { kind: 'condition', conditions: [{ fact: 'tags', includes: 'scene:combat' }] },
      { kind: 'condition', conditions: [{ fact: 'tags', includes: 'scene:combat' }] },
    ])
  })

  it('normalizes keyword activation input', () => {
    const draft = updateActivationDraft(readActivationDraft(node('entry', 'setting')), {
      mode: 'keyword',
      keywords: ' 雨, 镜市, 雨, ,地下 ',
    })
    const update = buildActivationUpdate({ node: node('entry', 'setting'), draft })

    expect(normalizeKeywords(draft.keywords)).toEqual(['雨', '镜市', '地下'])
    expect(update.capabilities?.activation).toEqual({
      kind: 'keyword',
      keywords: ['雨', '镜市', '地下'],
    })
    expect(update.projection?.lifecycle).toBe('keyword')
  })

  it('keeps custom activation untouched until the user switches modes', () => {
    const customNode = {
      ...node('custom', 'setting'),
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
      group: category === 'preset' ? 'preset.system' : 'setting.stable',
      lifecycle: 'always',
      order: 'entry: 10',
      slotKey: category === 'preset' ? 'preset:test@preset.system' : 'setting-layer:test@setting.stable',
      zone: 'StablePrefix',
    },
  }
}
