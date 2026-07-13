import Ajv2020 from 'ajv/dist/2020'
import { describe, expect, it } from 'vitest'
import traceSchema from '../src/schemas/trace.schema.json'
import { pipeline, serializeTrace, type Pass } from '../src'

function createValidator() {
  const ajv = new Ajv2020({ allErrors: true })
  return ajv.compile(traceSchema)
}

describe('Trace v1 JSON Schema validation', () => {
  it('validates runtime traces', () => {
    const pass: Pass = {
      name: 'upper',
      run: (fragments) => fragments.map((fragment) => ({
        ...fragment,
        content: fragment.content.toUpperCase(),
      })),
    }
    const validate = createValidator()
    const result = pipeline([pass]).run([{ id: 'f1', content: 'hello', meta: {} }])

    expect(validate(result.trace)).toBe(true)
  })

  it('validates serialized trace JSON', () => {
    const pass: Pass = {
      name: 'noop',
      run: (fragments) => fragments,
    }
    const validate = createValidator()
    const result = pipeline([pass]).run([{ id: 'f1', content: 'hello', meta: {} }])

    expect(validate(JSON.parse(serializeTrace(result.trace)))).toBe(true)
  })

  it('rejects invalid trace shapes', () => {
    const validate = createValidator()
    const base = {
      version: '1',
      mode: 'on',
      status: 'ok',
      initialFragments: [{ id: 'f1', content: 'hello', meta: {} }],
      finalFragments: [{ id: 'f1', content: 'HELLO', meta: {} }],
      executions: [
        {
          passName: 'upper',
          passIndex: 0,
          durationMs: 1,
          diagnostics: [],
          mutations: [
            {
              op: 'update',
              fragmentId: 'f1',
              index: 0,
              before: { id: 'f1', content: 'hello', meta: {} },
              after: { id: 'f1', content: 'HELLO', meta: {} },
            },
          ],
        },
      ],
      diagnostics: [],
    }

    expect(validate({ ...base, version: '2' })).toBe(false)
    expect(validate({ ...base, extra: true })).toBe(false)
    expect(validate({ ...base, initialFragments: [{ id: 'f1', meta: {} }] })).toBe(false)
    expect(validate({
      ...base,
      executions: [{ ...base.executions[0], mutations: [{ op: 'unknown', fragmentId: 'f1' }] }],
    })).toBe(false)
    expect(validate({
      ...base,
      executions: [{ passName: 'upper', passIndex: 0, durationMs: 1, diagnostics: [] }],
    })).toBe(false)
  })
})
