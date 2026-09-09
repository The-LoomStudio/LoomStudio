import { describe, expect, it } from 'vitest'
import {
  createBatchSetStatePropertiesInput,
  createSnapshotReplaceFromYaml,
  createSnapshotReplaceInput,
  objectToYaml,
  parseCardStateConfig,
  stateSnapshotToTreeNodes,
  yamlToObject,
} from '../../../apps/studio-client/src/features/state-variables/model/state-variable-editor.js'

describe('State variable editor model', () => {
  it('preserves the explicit Branch target and expected Revision on save', () => {
    const target = { scope: 'timeline' as const, timelineId: 'timeline-1', branchId: 'branch-2' }
    expect(createSnapshotReplaceInput({ scopeId: 'scope-1', target, revisionId: 'revision-3', value: {}, createdAt: 'now' }, '{"gold":7}')).toEqual({
      target,
      expectedRevisionId: 'revision-3',
      operations: [{ op: 'set', path: '', value: { gold: 7 } }],
    })
  })

  it('rejects malformed snapshots and Card State configuration', () => {
    expect(() => createSnapshotReplaceInput({ scopeId: 'scope-1', target: { scope: 'global' }, revisionId: 'revision-1', value: {}, createdAt: 'now' }, '[]')).toThrow('State Snapshot must be a JSON object')
    expect(() => parseCardStateConfig('stateDefinitionIds: wrong\ntimelineStateBindings: []')).toThrow('stateDefinitionIds must be a string array')
    expect(() => parseCardStateConfig('stateTemplates:\n  - id: t\n    schema: {}\n    initial: {}\ntimelineStateBindings: []')).toThrow('templateVersion')
  })

  it('supports YAML round-trip and snapshot replacement', () => {
    const data = { hp: 100, name: 'Alice', desc: 'A line\nSecond line' }
    expect(yamlToObject(objectToYaml(data))).toEqual(data)
    expect(createSnapshotReplaceFromYaml({ scopeId: 'scope-g', target: { scope: 'global' }, revisionId: 'rev-1', value: {}, createdAt: 'now' }, 'WritingStyle: Light Novel').operations).toEqual([{ op: 'set', path: '', value: { WritingStyle: 'Light Novel' } }])
  })

  it('parses Entity, Component, Mount, and Extension contribution authoring fields', () => {
    const parsed = parseCardStateConfig(`
stateTemplates:
  - id: character.vitals
    templateVersion: 1
    componentKey: vitals
    targetEntityTypeIds: [character]
    schema: { type: object }
    initial: { hp: 100 }
stateDefinitionIds: [character.vitals]
stateEntityTypes:
  - id: character
    collectionPath: entities.characters
timelineStateEntities:
  - typeId: character
    entityId: alice
timelineComponentMounts:
  - templateId: character.vitals
    templateVersion: 1
    componentKey: vitals
    target:
      kind: entity-type
      typeId: character
stateContributionIds: [example.health.character-vitals]
timelineStateBindings: []
`)
    expect(parsed.stateEntityTypes).toEqual([{ id: 'character', collectionPath: 'entities.characters' }])
    expect(parsed.timelineStateEntities).toEqual([{ typeId: 'character', entityId: 'alice' }])
    expect(parsed.timelineComponentMounts[0]?.target).toEqual({ kind: 'entity-type', typeId: 'character' })
    expect(parsed.stateContributionIds).toEqual(['example.health.character-vitals'])
  })

  it('converts runtime snapshots to editable tree nodes and batch patches', () => {
    const treeNodes = stateSnapshotToTreeNodes({ player: { hp: 100, lore: 'long text\nsecond line' }, flag: true })
    expect(treeNodes.find(node => node.label === 'player')?.children?.find(node => node.label === 'lore')?.capabilities?.macroToken).toBe('{{player.lore}}')
    expect(treeNodes.find(node => node.label === 'player')?.children?.find(node => node.label === 'lore')?.capabilities?.isLongText).toBe(true)
    expect(createBatchSetStatePropertiesInput({ scope: 'timeline', timelineId: 'tl-1', branchId: 'br-1' }, 'rev-batch', { '/player/hp': 90 })).toEqual({
      target: { scope: 'timeline', timelineId: 'tl-1', branchId: 'br-1' },
      expectedRevisionId: 'rev-batch',
      operations: [{ op: 'set', path: '/player/hp', value: 90 }],
    })
  })

})
