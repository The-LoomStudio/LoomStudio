import { describe, expect, it } from 'vitest'
import traceSchema from '../src/schemas/trace.schema.json'
import { deserializeTrace, deserializeTraceChecked, pipeline, serializeTrace, type Pass } from '../src'

describe('trace', () => {
  it('serializes and deserializes trace JSON', () => {
    const pass: Pass = {
      name: 'upper',
      run: (fragments) => fragments.map((fragment) => ({
        ...fragment,
        content: fragment.content.toUpperCase(),
      })),
    }

    const result = pipeline([pass]).run([{ id: 'f1', content: 'hello', meta: {} }])
    const serialized = serializeTrace(result.trace)

    expect(deserializeTrace(serialized)).toEqual(result.trace)
    expect(deserializeTraceChecked(serialized)).toEqual(result.trace)
    expect(result.trace.status).toBe('ok')
  })

  it('checks trace shape during checked deserialization', () => {
    expect(() => deserializeTraceChecked('{"version":"bad"}')).toThrow(/Invalid Loom Trace/)
  })

  it('records error status in trace', () => {
    const bad: Pass = {
      name: 'bad',
      run: () => {
        throw new Error('boom')
      },
    }

    const result = pipeline([bad]).run([{ id: 'f1', content: 'hello', meta: {} }])

    expect(result.status).toBe('error')
    expect(result.trace.status).toBe('error')
    expect(result.trace.error?.message).toBe('boom')
  })

  it('exports a strict Trace v1 schema with core definitions', () => {
    expect(traceSchema.properties.version).toEqual({ const: '1' })
    expect(traceSchema.properties.status).toEqual({ enum: ['ok', 'error'] })
    expect(traceSchema.additionalProperties).toBe(false)
    expect(traceSchema.$defs.fragment.required).toEqual(['id', 'content', 'meta'])
    expect(traceSchema.$defs.mutation.oneOf).toHaveLength(4)
    expect(traceSchema.$defs.execution.required).not.toContain('afterFragments')
    expect(traceSchema.$defs.diagnostic.required).toEqual([
      'severity',
      'code',
      'message',
      'pass',
    ])
  })
})
