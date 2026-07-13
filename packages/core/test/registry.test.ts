import { describe, expect, it } from 'vitest'
import { PassRegistry, run, type PassFactory } from '../src'

describe('PassRegistry', () => {
  it('creates passes from JSON pass configs', () => {
    const registry = new PassRegistry()
    const factory: PassFactory<{ suffix: string }> = {
      name: 'append',
      create: (params) => ({
        name: 'append',
        run: (fragments) => fragments.map((fragment) => ({
          ...fragment,
          content: `${fragment.content}${params.suffix}`,
        })),
      }),
    }
    registry.register(factory)

    const result = run({
      registry,
      passes: [{ name: 'append', params: { suffix: '!' } }],
      fragments: [{ id: 'f1', content: 'hello', meta: {} }],
    })

    expect(result.status).toBe('ok')
    expect(result.fragments[0]!.content).toBe('hello!')
    expect(result.trace.passConfigs).toEqual([{ name: 'append', params: { suffix: '!' } }])
  })

  it('returns specific error result when factory is missing', () => {
    const result = run({
      registry: new PassRegistry(),
      passes: [{ name: 'missing' }],
      fragments: [{ id: 'f1', content: 'hello', meta: {} }],
    })

    expect(result.status).toBe('error')
    expect(result.diagnostics[0]!.code).toBe('loom/factory-missing')
    expect(result.diagnostics[0]!.meta?.factoryName).toBe('missing')
    expect(result.trace.status).toBe('error')
  })

  it('rejects duplicate factory names', () => {
    const registry = new PassRegistry()
    const factory: PassFactory = {
      name: 'dup',
      create: () => ({ name: 'dup', run: (fragments) => fragments }),
    }

    registry.register(factory)

    expect(() => registry.register(factory)).toThrow(/already registered/)
  })

  it('rejects empty factory names', () => {
    const registry = new PassRegistry()

    expect(() => registry.register({
      name: '',
      create: () => ({ name: 'empty', run: (fragments) => fragments }),
    })).toThrow(/non-empty name/)
  })

  it('returns contextual error result when factory create throws', () => {
    const registry = new PassRegistry()
    registry.register({
      name: 'bad',
      create: () => {
        throw new Error('bad params')
      },
    })

    const result = run({
      registry,
      passes: [{ name: 'bad' }],
      fragments: [{ id: 'f1', content: 'hello', meta: {} }],
    })

    expect(result.status).toBe('error')
    expect(result.diagnostics[0]!.code).toBe('loom/factory-threw')
    expect(result.diagnostics[0]!.meta?.factoryName).toBe('bad')
    expect(result.diagnostics[0]!.meta?.passIndex).toBe(0)
  })

  it('passes params through and creates passes in config order', () => {
    const registry = new PassRegistry()
    const received: unknown[] = []
    registry.register({
      name: 'append',
      create: (params: unknown) => {
        received.push(params)
        const suffix = (params as { suffix: string }).suffix
        return {
          name: `append-${suffix}`,
          run: (fragments) => fragments.map((fragment) => ({ ...fragment, content: `${fragment.content}${suffix}` })),
        }
      },
    })

    expect(registry.has('append')).toBe(true)
    expect(registry.has('missing')).toBe(false)

    const passes = registry.createAll([
      { name: 'append', params: { suffix: '1' } },
      { name: 'append', params: { suffix: '2' } },
    ])

    expect(received).toEqual([{ suffix: '1' }, { suffix: '2' }])
    expect(passes.map((pass) => pass.name)).toEqual(['append-1', 'append-2'])
  })
})
