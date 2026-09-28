import { describe, expect, it } from 'vitest'
import { applyJsonPatch, applyMutation, validateWorldRoot } from '../../../official/extensions/the-world/src/server/index.js'

const branch = { timelineId: 'timeline-1', branchId: 'branch-1' }

function snapshot() {
  return {
    schemaVersion: 1,
    branch,
    entities: {
      world: {
        schemaVersion: 1,
        id: 'world',
        kind: 'world',
        branch,
        createdBy: 'system',
        createdAt: '2026-09-22T00:00:00.000Z',
        updatedAt: '2026-09-22T00:00:00.000Z',
        components: {},
      },
    },
  }
}

describe('The World server state contract', () => {
  it('accepts a valid entity mutation and preserves the branch', () => {
    const entity = {
      ...snapshot().entities.world,
      id: 'scene-1',
      kind: 'scene',
      components: { scene: { version: 1, name: 'Atrium' } },
    }
    const next = applyMutation(snapshot(), {
      schemaVersion: 1,
      target: branch,
      expectedRevisionId: 'rev-1',
      idempotencyKey: 'mutation-1',
      operations: [{ op: 'upsert-entity', entity }],
    }, 'rev-1')

    expect(next.entities['scene-1']).toEqual(entity)
    expect(next.branch).toEqual(branch)
  })

  it('rejects malformed entities and cross-branch patches', () => {
    expect(() => validateWorldRoot({
      ...snapshot(),
      entities: { broken: { ...snapshot().entities.world, id: 'other' } },
    }, branch)).toThrow('entity is invalid')

    expect(() => applyJsonPatch(snapshot(), [{
      op: 'replace',
      path: '/entities/world/components',
      value: {},
    }, {
      op: 'add',
      path: '/entities/foreign',
      value: {
        ...snapshot().entities.world,
        id: 'foreign',
        branch: { timelineId: 'other', branchId: 'branch-1' },
      },
    }])).toThrow('branch')
  })

  it('accepts an empty contribution root after binding it to a branch', () => {
    expect(validateWorldRoot({
      schemaVersion: 1,
      branch,
      entities: {},
    }, branch)).toEqual({
      schemaVersion: 1,
      branch,
      entities: {},
    })
  })
})
