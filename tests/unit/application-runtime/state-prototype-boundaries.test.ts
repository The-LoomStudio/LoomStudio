import { describe, expect, it } from 'vitest'
import { materializeStateContribution } from '../../../packages/application-runtime/src/state/state-contribution.js'
import { expandTimelineStateBindings, materializeTimelineState, validateStateValue } from '../../../packages/application-runtime/src/state/state-definition.js'
import { applyStateOperations } from '../../../packages/application-runtime/src/state/state.js'
import type { TimelineStateTemplateDraft } from '../../../packages/application-runtime/src/types.js'

describe('State own-property boundaries', () => {
  it.each(['__proto__', 'constructor.prototype', 'entities.__proto__'])('materializes collection %s without inherited writes', collectionPath => {
    const key = 'fr008Entity'
    try {
      const result = materializeStateContribution({
        id: 'prototype-probe',
        entityTypes: [{ id: 'person', collectionPath }],
        templates: [],
        entities: [{ typeId: 'person', entityId: key }],
        componentMounts: [],
        bindings: [],
      })
      expect(Object.hasOwn(Object.prototype, key)).toBe(false)
      let value = result.snapshot
      for (const segment of collectionPath.split('.')) {
        expect(Object.hasOwn(value, segment)).toBe(true)
        value = value[segment] as typeof value
      }
      expect(value[key]).toEqual({ components: {} })
    } finally {
      Reflect.deleteProperty(Object.prototype, key)
    }
  })

  it('does not expand wildcards from inherited collections but expands own prototype-like keys', () => {
    const key = 'fr008Collection'
    const binding = { path: `__proto__.${key}.*.component`, templateId: 'value', templateVersion: 1 }
    try {
      Object.defineProperty(Object.prototype, key, {
        configurable: true, value: { alice: {} },
      })
      expect(expandTimelineStateBindings([binding], {})).toEqual([])
      const own = JSON.parse(`{"__proto__":{"${key}":{"alice":{}}}}`)
      expect(expandTimelineStateBindings([binding], own)).toEqual([
        { ...binding, path: `__proto__.${key}.alice.component` },
      ])
    } finally {
      Reflect.deleteProperty(Object.prototype, key)
    }
  })

  it('does not treat inherited schema properties as declared fields', () => {
    const value = JSON.parse('{"__proto__":{}}')
    expect(() => validateStateValue(value, { type: 'object', properties: {}, additionalProperties: false }))
      .toThrowError(expect.objectContaining({ code: 'state.schema_additional_property' }))
    expect(() => validateStateValue(value, JSON.parse(
      '{"type":"object","properties":{"__proto__":{"type":"object"}},"additionalProperties":false}',
    ))).not.toThrow()
    expect(() => validateStateValue(value, { type: 'object', 'x-custom': { enabled: true } })).not.toThrow()
  })

  it('ignores inherited reference values while diagnosing missing own references', () => {
    const key = 'fr008Reference'
    try {
      Object.defineProperty(Object.prototype, key, {
        configurable: true, value: { typeId: 'person', entityId: 'missing' },
      })
      const result = materializeStateContribution({
        id: 'reference-probe',
        entityTypes: [{ id: 'person', collectionPath: 'people' }],
        templates: [{
          id: 'value', templateVersion: 1,
          schema: { type: 'object', properties: {
            [key]: { type: 'object', 'x-loom-entity-ref': { allowedTypeIds: ['person'] } },
            own: { type: 'object', 'x-loom-entity-ref': { allowedTypeIds: ['person'] } },
          } },
          initial: { own: { typeId: 'person', entityId: 'missing' } },
        }],
        entities: [],
        componentMounts: [],
        bindings: [{ path: 'data', templateId: 'value', templateVersion: 1 }],
      })
      expect(result.referenceDiagnostics).toEqual([{
        code: 'state.entity_ref_unresolved',
        path: 'data.own',
        reference: { typeId: 'person', entityId: 'missing' },
      }])
    } finally {
      Reflect.deleteProperty(Object.prototype, key)
    }
  })

  it('merges own prototype-like keys and retains empty keys, nulls and extension data', () => {
    const template: TimelineStateTemplateDraft = {
      kind: 'timeline-template', templateVersion: 1, schema: { type: 'object' },
      initial: JSON.parse('{"__proto__":{"left":1},"constructor":{"prototype":{"left":2}},"":null,"extra":{"custom":true}}'),
    }
    try {
      const result = materializeTimelineState({
        bindings: [{
          path: '__proto__.fr008Merged', templateId: 'value', templateVersion: 1,
          initial: JSON.parse('{"__proto__":{"right":3},"constructor":{"prototype":{"right":4}}}'),
        }],
        templates: new Map([['value', template]]),
      })
      expect(JSON.stringify(result)).toBe(
        '{"__proto__":{"fr008Merged":{"__proto__":{"left":1,"right":3},"constructor":{"prototype":{"left":2,"right":4}},"":null,"extra":{"custom":true}}}}',
      )
      expect(Object.hasOwn(Object.prototype, 'fr008Merged')).toBe(false)
      expect(template.initial).toEqual(JSON.parse(
        '{"__proto__":{"left":1},"constructor":{"prototype":{"left":2}},"":null,"extra":{"custom":true}}',
      ))
    } finally {
      Reflect.deleteProperty(Object.prototype, 'fr008Merged')
    }
  })

  it('rejects inherited Pointer reads and removals while preserving escaped and empty own keys', () => {
    for (const path of ['/__proto__/fr008Counter', '/constructor/prototype/fr008Counter']) {
      expect(() => applyStateOperations({}, [{ op: 'increment', path, by: 1 }])).toThrow()
      expect(() => applyStateOperations({}, [{ op: 'remove', path }])).toThrow()
    }
    const result = applyStateOperations({}, [
      { op: 'set', path: '/__proto__/a~1b/~0/', value: 1 },
      { op: 'increment', path: '/__proto__/a~1b/~0/', by: 2 },
      { op: 'set', path: '/constructor/prototype/fr008Counter', value: null },
      { op: 'remove', path: '/constructor/prototype/fr008Counter' },
    ])
    expect(JSON.stringify(result)).toBe('{"__proto__":{"a/b":{"~":{"":3}}},"constructor":{"prototype":{}}}')
  })
})
