import {
  materializeTimelineState,
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
})
