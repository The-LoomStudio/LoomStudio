import { createEventBus } from '@loom-studio/kernel'
import type { JsonValue } from '@loom-studio/shared'
import { describe, expect, it } from 'vitest'
import { isJsonValue } from '../../../packages/application-runtime/src/data/json.js'

function createBus() {
  const bus = createEventBus()
  bus.registerDefinition({
    name: 'system.jsonContract',
    owner: { kind: 'kernel' },
    version: 1,
    visibility: 'public',
    summary: 'JSON boundary contract',
    stability: 'experimental',
  })
  return bus
}

describe('Application Data and Kernel JSON boundaries', () => {
  it.each([
    ['null', null],
    ['false', false],
    ['zero', 0],
    ['empty string', ''],
    ['nested values', { '': [null, false, 0, '', { number: 1.5 }] }],
    ['null-prototype object', Object.assign(Object.create(null), { value: [1, 2] })],
  ])('accepts %s at both boundaries', (_name, value) => {
    expect(isJsonValue(value)).toBe(true)
    const bus = createBus()
    expect(bus.emit('system.jsonContract', value as JsonValue).payload).toEqual(value)
  })

  it.each([
    ['undefined', undefined],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['negative Infinity', -Infinity],
    ['bigint', 1n],
    ['function', () => 1],
    ['Date', new Date('2026-10-02T00:00:00Z')],
    ['class instance', new (class { value = 1 })()],
    ['undefined array item', [undefined]],
    ['undefined object field', { value: undefined }],
  ])('rejects %s before event delivery', (_name, value) => {
    expect(isJsonValue(value)).toBe(false)
    const bus = createBus()
    let delivered = 0
    bus.subscribe(['system.jsonContract'], () => { delivered++ })
    expect(() => bus.emit('system.jsonContract', value as JsonValue)).toThrow('JSON-compatible')
    expect(delivered).toBe(0)
  })

  it('rejects cycles but permits a shared object that is not an ancestor', () => {
    const shared = { values: [0, false, null] }
    const acyclic = { first: shared, second: shared }
    const cyclic: { child?: unknown } = {}
    cyclic.child = { parent: cyclic }
    const bus = createBus()
    expect(isJsonValue(acyclic)).toBe(true)
    expect(bus.emit('system.jsonContract', acyclic).payload).toEqual(acyclic)
    expect(isJsonValue(cyclic)).toBe(false)
    expect(() => bus.emit('system.jsonContract', cyclic as JsonValue)).toThrow('JSON-compatible')
  })

  it('exposes the sparse-array difference rather than silently unifying the boundaries', () => {
    const sparse = new Array(2)
    sparse[1] = 'present'
    const payload = { values: sparse }
    const bus = createBus()
    expect(isJsonValue(payload)).toBe(false)
    const published = bus.emit('system.jsonContract', payload)
    expect(0 in (published.payload as typeof payload).values).toBe(false)
    expect(JSON.parse(JSON.stringify(published.payload))).toEqual({ values: [null, 'present'] })
    expect(isJsonValue({ values: [null, 'present'] })).toBe(true)
  })
})
