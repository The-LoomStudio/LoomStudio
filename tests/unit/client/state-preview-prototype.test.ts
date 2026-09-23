import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { Card } from '../../../apps/studio-client/src/entities/card.js'
import type { JsonObject } from '../../../apps/studio-client/src/entities/common.js'
import { StateAuthoringPanel } from '../../../apps/studio-client/src/features/state-variables/ui/state-authoring-panel.js'
import { parseCardStateConfig, stateSnapshotToTreeNodes } from '../../../apps/studio-client/src/features/state-variables/model/state-variable-editor.js'
import { createTranslator } from '../../../apps/studio-client/src/shared/i18n/index.js'

vi.mock('../../../apps/studio-client/src/features/state-variables/model/state-variable-editor.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../apps/studio-client/src/features/state-variables/model/state-variable-editor.js')>()
  return { ...actual, stateSnapshotToTreeNodes: vi.fn(actual.stateSnapshotToTreeNodes) }
})

const marker = 'fr008PreviewRegression'
const template = { id: 't', templateVersion: 1, schema: { type: 'object' }, initial: {} }

function preview(input: Record<string, unknown>) {
  const config = parseCardStateConfig(JSON.stringify(input))
  const card: Card = {
    ...config, id: 'card-1', version: 1, name: 'User Card',
    opening: { entries: [] }, settingLayer: { entries: [] }, createdAt: 'now', updatedAt: 'now',
  }
  vi.mocked(stateSnapshotToTreeNodes).mockClear()
  const html = renderToStaticMarkup(createElement(StateAuthoringPanel, {
    card, t: createTranslator('en-US'), onSaveCard: async () => card,
  }))
  expect(stateSnapshotToTreeNodes).toHaveBeenCalledTimes(1)
  return { snapshot: vi.mocked(stateSnapshotToTreeNodes).mock.calls[0]![0] as JsonObject, html }
}

describe('State authoring preview prototype boundaries', () => {
  it.each(['__proto__', 'constructor.prototype', 'entities.__proto__'])('keeps entity collection %s and mounts in own data', collectionPath => {
    const prototype = Object.getOwnPropertyDescriptors(Object.prototype)
    try {
      const { snapshot } = preview({
        stateEntityTypes: [{ id: 'person', collectionPath }],
        timelineStateEntities: [{ typeId: 'person', entityId: marker }],
        stateTemplates: [template],
        timelineComponentMounts: [{
          templateId: 't', templateVersion: 1, componentKey: '__proto__',
          target: { kind: 'entity', entity: { typeId: 'person', entityId: marker } },
          initial: { value: null },
        }],
        timelineStateBindings: [],
      })
      expect(Object.getOwnPropertyDescriptors(Object.prototype)).toEqual(prototype)
      let current = snapshot
      for (const segment of [...collectionPath.split('.'), marker, 'components', '__proto__']) {
        expect(Object.hasOwn(current, segment)).toBe(true)
        expect(Object.getPrototypeOf(current)).toBe(Object.prototype)
        current = current[segment] as JsonObject
      }
      expect(current).toEqual({ value: null })
      expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot)
    } finally {
      Reflect.deleteProperty(Object.prototype, marker)
    }
  })

  it.each(['__proto__', 'constructor.prototype', 'safe.__proto__'])('keeps binding parent %s in own data', parent => {
    const prototype = Object.getOwnPropertyDescriptors(Object.prototype)
    try {
      const { snapshot } = preview({
        stateTemplates: [template],
        timelineStateBindings: [{
          path: `${parent}.${marker}`, templateId: 't', templateVersion: 1, initial: { enabled: true },
        }],
      })
      let current = snapshot
      for (const segment of [...parent.split('.'), marker]) {
        expect(Object.hasOwn(current, segment)).toBe(true)
        expect(Object.getPrototypeOf(current)).toBe(Object.prototype)
        current = current[segment] as JsonObject
      }
      expect(current).toEqual({ enabled: true })
      expect(Object.getOwnPropertyDescriptors(Object.prototype)).toEqual(prototype)
    } finally {
      Reflect.deleteProperty(Object.prototype, marker)
    }
  })

  it('merges special own keys without changing instance or global prototypes', () => {
    const prototype = Object.getOwnPropertyDescriptors(Object.prototype)
    try {
      const initial = JSON.parse('{"nested":{"__proto__":{"left":1}},"constructor":{"prototype":{"left":2}},"":null,"extension":{"custom":[null,false,""]}}')
      const override = JSON.parse(`{"__proto__":{"${marker}":true},"nested":{"__proto__":{"right":3}},"constructor":{"prototype":{"right":4}}}`)
      const { snapshot } = preview({
        stateTemplates: [{ ...template, initial }],
        timelineStateBindings: [{ path: 'safe', templateId: 't', templateVersion: 1, initial: override }],
      })
      const result = snapshot.safe as JsonObject
      expect(Object.getOwnPropertyDescriptors(Object.prototype)).toEqual(prototype)
      expect(Object.getPrototypeOf(result)).toBe(Object.prototype)
      expect(Object.hasOwn(result, '__proto__')).toBe(true)
      expect(result[marker]).toBeUndefined()
      expect(JSON.parse(JSON.stringify(result))).toEqual(JSON.parse(
        `{"nested":{"__proto__":{"left":1,"right":3}},"constructor":{"prototype":{"left":2,"right":4}},"":null,"extension":{"custom":[null,false,""]},"__proto__":{"${marker}":true}}`,
      ))
      expect(Object.getPrototypeOf(result.nested)).toBe(Object.prototype)
      expect(Object.getPrototypeOf(result.constructor)).toBe(Object.prototype)
      expect(initial.nested.__proto__).toEqual({ left: 1 })
      expect(override.nested.__proto__).toEqual({ right: 3 })
    } finally {
      Reflect.deleteProperty(Object.prototype, marker)
    }
  })

  it.each(['__proto__', 'constructor', 'prototype', ''])('preserves own entity key %j and ordinary previews', entityId => {
    const prototype = Object.getOwnPropertyDescriptors(Object.prototype)
    try {
      const { snapshot, html } = preview({
        stateEntityTypes: [{ id: 'person', collectionPath: 'people' }],
        timelineStateEntities: [{ typeId: 'person', entityId }],
        stateTemplates: [{ ...template, initial: { hp: 100, note: null } }],
        timelineStateBindings: [
          { path: 'world', templateId: 't', templateVersion: 1, initial: { hp: 80 } },
          { path: 'empty.', templateId: 't', templateVersion: 1 },
        ],
      })
      const people = snapshot.people as JsonObject
      expect(Object.hasOwn(people, entityId)).toBe(true)
      expect(people[entityId]).toEqual({ components: {} })
      expect(Object.getPrototypeOf(people)).toBe(Object.prototype)
      expect(snapshot.world).toEqual({ hp: 80, note: null })
      expect(Object.hasOwn(snapshot.empty as object, '')).toBe(true)
      expect((snapshot.empty as JsonObject)['']).toEqual({ hp: 100, note: null })
      expect(Object.getOwnPropertyDescriptors(Object.prototype)).toEqual(prototype)
      expect(html).toContain('User Card')
      expect(html).toContain('Final Assembly Preview')
    } finally {
      Reflect.deleteProperty(Object.prototype, marker)
    }
  })
})
