import { describe, expect, it } from 'vitest'
import { applyStateOperations, ApplicationStateError } from '../../../packages/application-runtime/src/state/state.js'

describe('applyStateOperations', () => {
  it('auto-vivifies missing parent objects on nested set operations', () => {
    const initial = {}
    const next = applyStateOperations(initial, [
      { op: 'set', path: '/user/name', value: 'shiyue' },
    ])

    expect(next).toEqual({
      user: {
        name: 'shiyue',
      },
    })
  })

  it('supports deep nested auto-vivification', () => {
    const initial = {}
    const next = applyStateOperations(initial, [
      { op: 'set', path: '/a/b/c/d', value: 42 },
    ])

    expect(next).toEqual({
      a: { b: { c: { d: 42 } } },
    })
  })

  it('updates existing properties cleanly without overwriting siblings', () => {
    const initial = {
      user: {
        name: 'User',
        description: 'A traveller',
      },
    }
    const next = applyStateOperations(initial, [
      { op: 'set', path: '/user/name', value: 'shiyue' },
    ])

    expect(next).toEqual({
      user: {
        name: 'shiyue',
        description: 'A traveller',
      },
    })
  })

  it('throws when setting a child of a non-container value', () => {
    const initial = { user: 'not-an-object' }
    expect(() => {
      applyStateOperations(initial, [
        { op: 'set', path: '/user/name', value: 'shiyue' },
      ])
    }).toThrow(ApplicationStateError)
  })

  it('removes properties correctly', () => {
    const initial = {
      user: { name: 'shiyue', description: 'text' },
      temp: 'val',
    }
    const next = applyStateOperations(initial, [
      { op: 'remove', path: '/temp' },
      { op: 'remove', path: '/user/description' },
    ])

    expect(next).toEqual({
      user: { name: 'shiyue' },
    })
  })

  it('keeps prototype-like mutation paths as own State keys without polluting object prototypes', () => {
    const prototype = Object.prototype as Record<string, unknown>
    delete prototype.loomPolluted
    delete prototype.constructorPolluted

    try {
      const next = applyStateOperations({}, [
        { op: 'set', path: '/__proto__/loomPolluted', value: true },
        { op: 'set', path: '/constructor/prototype/constructorPolluted', value: true },
      ])

      expect(JSON.parse(JSON.stringify(next))).toEqual(JSON.parse(
        '{"__proto__":{"loomPolluted":true},"constructor":{"prototype":{"constructorPolluted":true}}}',
      ))
      expect(Object.hasOwn(next, '__proto__')).toBe(true)
      expect(Object.hasOwn(next, 'constructor')).toBe(true)
      expect(({} as Record<string, unknown>).loomPolluted).toBeUndefined()
      expect(({} as Record<string, unknown>).constructorPolluted).toBeUndefined()
    } finally {
      delete prototype.loomPolluted
      delete prototype.constructorPolluted
    }
  })
})
