import { describe, expect, it } from 'vitest'
import {
  createSnapshotReplaceInput,
  parseCardStateConfig,
} from '../../../apps/studio-client/src/features/state-variables/model/state-variable-editor.js'

describe('State variable editor model', () => {
  it('preserves the explicit Branch target and expected Revision on save', () => {
    const target = { scope: 'timeline' as const, timelineId: 'timeline-1', branchId: 'branch-2' }
    expect(createSnapshotReplaceInput({
      scopeId: 'scope-1', target, revisionId: 'revision-3', value: {}, createdAt: 'now',
    }, '{"gold":7}')).toEqual({
      target,
      expectedRevisionId: 'revision-3',
      operations: [{ op: 'set', path: '', value: { gold: 7 } }],
    })
  })

  it('rejects non-object snapshots and malformed Card Binding config before RPC', () => {
    expect(() => createSnapshotReplaceInput({
      scopeId: 'scope-1', target: { scope: 'global' }, revisionId: 'revision-1', value: {}, createdAt: 'now',
    }, '[]')).toThrow('State Snapshot must be a JSON object')
    expect(() => parseCardStateConfig('{"stateDefinitionIds":"wrong","timelineStateBindings":[]}'))
      .toThrow('stateDefinitionIds must be a string array')
  })
})
