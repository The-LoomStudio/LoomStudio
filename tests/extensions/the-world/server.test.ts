import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { applyJsonPatch, applyMutation, validateWorldRoot } from '../../../extensions/the-world/src/server/index.js'
import { createWorldRoot, projectCurrentWorld, upgradeLegacyWorld } from '../../../extensions/the-world/src/world-state.js'
import { createLegacyWorldImport } from '../../../extensions/the-world/src/importer.js'

const branch = { timelineId: 'timeline-1', branchId: 'branch-1' }
const example = () => JSON.parse(readFileSync(new URL('../../../extensions/the-world/resources/examples/world-ec.json', import.meta.url), 'utf8'))

describe('The World native EC contract', () => {
  it('keeps importer diagnostics outside persisted entity components', () => {
    const imported = createLegacyWorldImport({
      branch, revisionId: 'rev-1', idempotencyKey: 'import-1',
      mapUpdateText: '<MapUpdate>[{"op":"add_or_update","id":"harbor","name":"Harbor","type":"region","illustration":"candidate"}]</MapUpdate>',
    })
    expect(imported.operations).toEqual([{
      op: 'upsert-entity', entityId: 'harbor', entity: { components: { place: { name: 'Harbor' } } },
    }])
    const next = applyMutation(createWorldRoot(), {
      schemaVersion: 3, target: branch, expectedRevisionId: 'rev-1', idempotencyKey: 'import-1', operations: imported.operations,
    }, 'rev-1', branch)
    expect(next.entities.harbor).toEqual({ components: { place: { name: 'Harbor' } } })
    expect(imported.diagnostics.some(diagnostic => diagnostic.code === 'unresolved-resource-reference')).toBe(true)
  })

  it('initializes an unknown world without invented dates or weather', () => {
    const root = createWorldRoot()
    expect(validateWorldRoot(root)).toBe(root)
    expect(projectCurrentWorld(root)).toMatchObject({ time: undefined, weather: undefined, scene: undefined })
    expect(root).not.toHaveProperty('branch')
    expect(root.entities.world.components).toEqual({
      world: { currentSceneId: null },
      worldTime: { value: { calendarId: null, year: null, month: null, day: null, hour: null, minute: null } },
      calendar: { id: null, name: null, months: null },
      weather: { kind: null, label: null, intensity: null },
    })
  })
  it('uses explicit scene and place references, preserving midnight', () => {
    const current = projectCurrentWorld(example())
    expect(current.scene?.id).toBe('arrival')
    expect(current.place?.id).toBe('pier')
    expect(current.time?.value.hour).toBe(0)
    expect(() => applyJsonPatch(example(), [{ op: 'remove', path: '/entities/pier' }])).toThrow('reference is missing')
    expect(() => applyJsonPatch(example(), [{
      op: 'add', path: '/entities/harbor/components/place/parentPlaceId', value: 'pier',
    }])).toThrow('cyclic')
  })
  it('validates the whole batch, allowing a scene and pointer to be added together', () => {
    const entity = { components: { scene: { name: 'Atrium' } } } as const
    const next = applyMutation(createWorldRoot(), {
      schemaVersion: 3, target: branch, expectedRevisionId: 'rev-1', idempotencyKey: 'mutation-1',
      operations: [
        { op: 'upsert-entity', entityId: 'scene', entity },
        { op: 'set-component', entityId: 'world', component: 'world', value: { currentSceneId: 'scene' } },
      ],
    }, 'rev-1', branch)
    expect(projectCurrentWorld(next).scene).toEqual({ id: 'scene', ...entity })
    expect(next.entities.scene).toEqual(entity)
    expect(() => applyMutation(next, {
      schemaVersion: 3, target: { ...branch, branchId: 'other' }, expectedRevisionId: 'rev-1', idempotencyKey: 'other',
      operations: [{ op: 'remove-entity', entityId: 'scene' }],
    }, 'rev-1', branch)).toThrow('branch does not match')
    expect(() => Reflect.apply(applyMutation, undefined, [next, {
      schemaVersion: 3, target: branch, expectedRevisionId: 'rev-1',
      operations: [{ op: 'typo', entityId: 'scene' }],
    }, 'rev-1', branch])).toThrow('operation is invalid')
  })
  it.each([{ hour: 24 }, { minute: 60 }, { month: 0 }, { day: -1 }, { second: 60 }, { millisecond: 1000 }])('rejects malformed time %j', change => {
    const root = example()
    Object.assign(root.entities.world.components.worldTime.value, change)
    expect(() => validateWorldRoot(root)).toThrow('time component is invalid')
  })
  it('checks dates against their custom calendar, not Gregorian Date', () => {
    const root = example()
    root.entities.world.components.calendar.months[0].days = 40
    root.entities.world.components.worldTime.value.day = 40
    expect(validateWorldRoot(root)).toBe(root)
    root.entities.world.components.worldTime.value.day = 41
    expect(() => validateWorldRoot(root)).toThrow('outside its calendar')
  })
  it('rejects array element paths and unsafe keys, but permits whole array replacement', () => {
    const root = example()
    root.entities.arrival.components.scene.participantEntityIds = ['a', 'b']
    expect(() => applyJsonPatch(root, [{
      op: 'add', path: '/entities/arrival/components/scene/participantEntityIds/0', value: 'c',
    }])).toThrow('must traverse existing objects')
    expect(() => applyJsonPatch(root, [{ op: 'add', path: '/entities/__proto__', value: {} }])).toThrow('path is invalid')
    expect(applyJsonPatch(root, [{
      op: 'replace', path: '/entities/arrival/components/scene/participantEntityIds', value: ['c'],
    }]).entities.arrival!.components.scene!.participantEntityIds).toEqual(['c'])
    expect(root.entities.arrival.components.scene.participantEntityIds).toEqual(['a', 'b'])
  })
  it('requires explicit upgrade and never mutates the v1 source', () => {
    const old = { schemaVersion: 1, branch, entities: {
      legacy: { schemaVersion: 1, id: 'legacy', kind: 'world', branch, createdBy: 'migration', components: {} },
    } }
    expect(() => validateWorldRoot(old)).toThrow('explicit upgrade')
    expect(() => upgradeLegacyWorld(old)).toThrow('worldEntityId explicitly')
    const next = upgradeLegacyWorld(old, { worldEntityId: 'legacy' })
    expect(next).toEqual({ entities: { world: { components: { world: {} } } } })
    expect(next.entities.world).not.toHaveProperty('branch')
    expect(old.entities.legacy.branch).toEqual(branch)
    expect(old.schemaVersion).toBe(1)
  })
  it('rejects entity metadata and explicitly upgrades v2 without losing the scene pointer', () => {
    const root = example()
    expect(() => validateWorldRoot({ entities: { world: { ...root.entities.world, createdBy: 'author' } } })).toThrow('only components')
    const legacy = { schemaVersion: 2, entities: Object.fromEntries(Object.entries(root.entities).map(([id, value]) => [
      id, { schemaVersion: 2, id, kind: id === 'world' ? 'world' : 'place', createdBy: 'author',
        components: Object.fromEntries(Object.entries((value as any).components).map(([key, data]) => [key, { version: 1, ...data as object }])) },
    ])) }
    expect(upgradeLegacyWorld(legacy)).toEqual(root)
    expect(legacy.entities.world).toHaveProperty('createdBy', 'author')
  })
})
