import {
  createStateArtifact,
  materializeTimelineState,
  materializeStateContribution,
  parseStateArtifact,
  validateStateDefinitionDraft,
  validateStateValue,
} from '@loom-studio/application-runtime'
import { describe, expect, it } from 'vitest'

describe('state definitions', () => {
  it('materializes timeline bindings from template defaults and card overrides', () => {
    const result = materializeTimelineState({
      bindings: [{ path: 'characters.alice', templateId: 'person', templateVersion: 1, initial: { gold: 3 } }],
      templates: new Map([['person', {
        kind: 'timeline-template',
        templateVersion: 1,
        schema: {
          type: 'object',
          properties: { name: { type: 'string' }, gold: { type: 'number', minimum: 0 } },
          required: ['name', 'gold'],
          additionalProperties: false,
        },
        initial: { name: 'Alice', gold: 0 },
      }]]),
    })

    expect(result).toEqual({ characters: { alice: { name: 'Alice', gold: 3 } } })
  })

  it('rejects invalid paths, duplicate bindings, and schema violations', () => {
    expect(() => validateStateDefinitionDraft({
      kind: 'global', path: 'user.name', schema: { type: 'string' },
    })).toThrowError(expect.objectContaining({ code: 'state.definition_path_invalid' }))
    expect(() => validateStateValue(-1, { type: 'number', minimum: 0 })).toThrowError(
      expect.objectContaining({ code: 'state.schema_minimum' }),
    )
    expect(() => materializeTimelineState({
      bindings: [
        { path: 'alice', templateId: 'person', templateVersion: 1 },
        { path: 'alice', templateId: 'person', templateVersion: 1 },
      ],
      templates: new Map([['person', {
        kind: 'timeline-template', templateVersion: 1, schema: { type: 'object' }, initial: {},
      }]]),
    })).toThrowError(expect.objectContaining({ code: 'state.binding_path_conflict' }))
    expect(() => validateStateDefinitionDraft({
      kind: 'timeline-template', templateVersion: 1,
      schema: { type: 'object', properties: { gold: 'not-a-schema' } }, initial: {},
    })).toThrowError(expect.objectContaining({ code: 'state.schema_invalid' }))
  })

  it('treats prototype-like binding segments as ordinary own State keys', () => {
    const result = materializeTimelineState({
      bindings: [{ path: 'safe.__proto__.component', templateId: 'value', templateVersion: 1 }],
      templates: new Map([['value', {
        kind: 'timeline-template', templateVersion: 1, schema: { type: 'object' }, initial: { enabled: true },
      }]]),
    })

    expect(Object.hasOwn(result.safe as object, '__proto__')).toBe(true)
    expect(JSON.parse(JSON.stringify(result))).toEqual(JSON.parse('{"safe":{"__proto__":{"component":{"enabled":true}}}}'))
    expect(({} as Record<string, unknown>).component).toBeUndefined()
  })

  it('supports multi-component assembly on the same entity and wildcard injection', () => {
    const templates = new Map([
      ['core_stats', {
        kind: 'timeline-template' as const,
        templateVersion: 1,
        schema: {
          type: 'object',
          properties: { hp: { type: 'number' }, mp: { type: 'number' } },
        },
        initial: { hp: 100, mp: 50 },
      }],
      ['inventory', {
        kind: 'timeline-template' as const,
        templateVersion: 1,
        schema: {
          type: 'object',
          properties: { items: { type: 'array' } },
        },
        initial: { items: ['新手小刀'] },
      }],
      ['anatomy', {
        kind: 'timeline-template' as const,
        templateVersion: 1,
        schema: {
          type: 'object',
          properties: { head: { type: 'object' }, torso: { type: 'object' } },
        },
        initial: { head: { hp: 30 }, torso: { hp: 80 } },
      }],
      ['weather', {
        kind: 'timeline-template' as const,
        templateVersion: 1,
        schema: {
          type: 'object',
          properties: { type: { type: 'string' }, temp: { type: 'number' } },
        },
        initial: { type: '暴风雪', temp: -5 },
      }],
    ])

    const bindings = [
      // 1. 世界级环境组件
      { path: 'world.weather', templateId: 'weather', templateVersion: 1 },
      // 2. 精确挂载创建 Alice / Bob Entity 的 core-stats 组件
      { path: 'entities.characters.alice.components.core_stats', templateId: 'core_stats', templateVersion: 1, initial: { hp: 120 } },
      { path: 'entities.characters.alice.components.inventory', templateId: 'inventory', templateVersion: 1, initial: { items: ['银之法杖'] } },
      { path: 'entities.characters.bob.components.core_stats', templateId: 'core_stats', templateVersion: 1, initial: { hp: 150, mp: 10 } },
      // 3. 生理 Mod 通过 wildcard 为所有已存在的 Character Entity 挂载 anatomy 组件
      { path: 'entities.characters.*.components.anatomy', templateId: 'anatomy', templateVersion: 1 },
    ]

    const result = materializeTimelineState({ bindings, templates })

    expect(result).toEqual({
      world: {
        weather: { type: '暴风雪', temp: -5 },
      },
      entities: {
        characters: {
          alice: {
            components: {
              core_stats: { hp: 120, mp: 50 },
              inventory: { items: ['银之法杖'] },
              anatomy: { head: { hp: 30 }, torso: { hp: 80 } },
            },
          },
          bob: {
            components: {
              core_stats: { hp: 150, mp: 10 },
              anatomy: { head: { hp: 30 }, torso: { hp: 80 } },
            },
          },
        },
      },
    })
  })

  it('materializes explicit entities, component mounts, and soft entity references from one contribution', () => {
    const contribution = {
      id: 'card:ec-example',
      entityTypes: [
        { id: 'character', collectionPath: 'entities.characters', label: '角色' },
        { id: 'item', collectionPath: 'entities.items', label: '物品' },
      ],
      templates: [
        {
          id: 'character.identity',
          templateVersion: 1,
          componentKey: 'identity',
          targetEntityTypeIds: ['character'],
          schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
          initial: { name: '未命名角色' },
        },
        {
          id: 'character.vitals',
          templateVersion: 1,
          componentKey: 'vitals',
          targetEntityTypeIds: ['character'],
          schema: { type: 'object', properties: { hp: { type: 'number', minimum: 0 } }, required: ['hp'] },
          initial: { hp: 100 },
        },
        {
          id: 'character.inventory',
          templateVersion: 1,
          componentKey: 'inventory',
          targetEntityTypeIds: ['character'],
          schema: {
            type: 'object',
            properties: {
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  'x-loom-entity-ref': { allowedTypeIds: ['item'] },
                },
              },
            },
            required: ['items'],
          },
          initial: { items: [] },
        },
        {
          id: 'item.identity',
          templateVersion: 1,
          componentKey: 'identity',
          targetEntityTypeIds: ['item'],
          schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
          initial: { name: '未命名物品' },
        },
      ],
      entities: [
        { typeId: 'character', entityId: 'alice' },
        { typeId: 'item', entityId: 'silver-sword' },
      ],
      componentMounts: [
        {
          templateId: 'character.identity', templateVersion: 1, componentKey: 'identity',
          target: { kind: 'entity', entity: { typeId: 'character', entityId: 'alice' } },
          initial: { name: 'Alice' },
        },
        {
          templateId: 'character.inventory', templateVersion: 1, componentKey: 'inventory',
          target: { kind: 'entity', entity: { typeId: 'character', entityId: 'alice' } },
          initial: {
            items: [
              { typeId: 'item', entityId: 'silver-sword' },
              { typeId: 'item', entityId: 'missing-potion' },
            ],
          },
        },
        {
          templateId: 'character.vitals', templateVersion: 1, componentKey: 'vitals',
          target: { kind: 'entity-type', typeId: 'character' },
        },
        {
          templateId: 'item.identity', templateVersion: 1, componentKey: 'identity',
          target: { kind: 'entity', entity: { typeId: 'item', entityId: 'silver-sword' } },
          initial: { name: '银之剑' },
        },
      ],
      bindings: [],
    }

    const artifact = createStateArtifact(contribution)
    expect(parseStateArtifact(JSON.parse(JSON.stringify(artifact)))).toEqual(artifact)

    const result = materializeStateContribution(contribution)
    expect(result.snapshot).toEqual({
      entities: {
        characters: {
          alice: {
            components: {
              identity: { name: 'Alice' },
              inventory: {
                items: [
                  { typeId: 'item', entityId: 'silver-sword' },
                  { typeId: 'item', entityId: 'missing-potion' },
                ],
              },
              vitals: { hp: 100 },
            },
          },
        },
        items: {
          'silver-sword': { components: { identity: { name: '银之剑' } } },
        },
      },
    })
    expect(result.referenceDiagnostics).toEqual([{
      code: 'state.entity_ref_unresolved',
      path: 'entities.characters.alice.components.inventory.items.1',
      reference: { typeId: 'item', entityId: 'missing-potion' },
    }])
    expect(result.components.map(component => component.path)).toEqual([
      'entities.characters.alice.components.identity',
      'entities.characters.alice.components.inventory',
      'entities.items.silver-sword.components.identity',
      'entities.characters.alice.components.vitals',
    ])
  })
})
