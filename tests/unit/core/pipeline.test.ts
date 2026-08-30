import { describe, expect, it } from 'vitest'
import { runPasses, type Fragment, type Pass } from '@loom/core'

describe('pipeline', () => {
  it('runs passes synchronously in declaration order', () => {
    const appendA: Pass = {
      name: 'append-a',
      run: (fragments) => fragments.map((fragment) => ({ ...fragment, content: `${fragment.content}a` })),
    }
    const appendB: Pass = {
      name: 'append-b',
      run: (fragments) => fragments.map((fragment) => ({ ...fragment, content: `${fragment.content}b` })),
    }

    const result = runPasses({ passes: [appendA, appendB], fragments: [{ id: 'f1', content: '', meta: {} }] })

    expect(result.status).toBe('ok')
    expect(result.fragments[0]!.content).toBe('ab')
    expect(result.trace.executions).toHaveLength(2)
    expect(result.trace.executions[0]!.passName).toBe('append-a')
    expect(result.trace.executions[1]!.passName).toBe('append-b')
  })

  it('rejects promise-returning passes at runtime', () => {
    const asyncPass = {
      name: 'async-pass',
      run: async (fragments: readonly unknown[]) => fragments,
    } as unknown as Pass

    const result = runPasses({ passes: [asyncPass], fragments: [{ id: 'f1', content: 'hello', meta: {} }] })

    expect(result.status).toBe('error')
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'loom/async-pass-result')).toBe(true)
  })

  it('handles rejected async passes without changing sync error result', () => {
    const asyncPass = {
      name: 'async-pass',
      run: async () => {
        throw new Error('async boom')
      },
    } as unknown as Pass

    const result = runPasses({ passes: [asyncPass], fragments: [{ id: 'f1', content: 'hello', meta: {} }] })

    expect(result.status).toBe('error')
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'loom/async-pass-result')).toBe(true)
  })

  it('uses mutation-only trace by default', () => {
    const pass: Pass = {
      name: 'upper',
      run: (fragments) => fragments.map((fragment) => ({ ...fragment, content: fragment.content.toUpperCase() })),
    }

    const result = runPasses({ passes: [pass], fragments: [{ id: 'f1', content: 'hello', meta: {} }] })

    expect(result.trace.version).toBe('1')
    expect(result.trace.mode).toBe('on')
    expect(result.trace.executions[0]!.mutations).toHaveLength(1)
    expect(result.trace.executions[0]!.snapshot).toBeUndefined()
    expect('afterFragments' in result.trace.executions[0]!).toBe(false)
  })

  it('records snapshots only when explicitly requested', () => {
    const pass: Pass = {
      name: 'noop',
      run: (fragments) => fragments,
    }

    const result = runPasses({
      passes: [pass],
      fragments: [{ id: 'f1', content: 'hello', meta: {} }],
      trace: { snapshot: 'boundaries' },
    })

    expect(result.trace.executions[0]!.snapshot?.before).toHaveLength(1)
    expect(result.trace.executions[0]!.snapshot?.after).toHaveLength(1)
  })

  it('returns error result for invalid initial fragments', () => {
    const pass: Pass = {
      name: 'noop',
      run: (fragments) => fragments,
    }

    const emptyId = runPasses({ passes: [pass], fragments: [{ id: '', content: 'hello', meta: {} }] })
    const invalidContent = runPasses({ passes: [pass], fragments: [{
      id: 'f1',
      content: Promise.resolve('bad'),
      meta: {},
    } as unknown as Fragment] })

    expect(emptyId.status).toBe('error')
    expect(emptyId.diagnostics.some((diagnostic) => diagnostic.code === 'loom/empty-id')).toBe(true)
    expect(invalidContent.status).toBe('error')
    expect(invalidContent.diagnostics.some((diagnostic) => diagnostic.code === 'loom/invalid-content')).toBe(true)
  })

  it('returns error result for invalid pass objects', () => {
    const result = runPasses({ passes: [null as unknown as Pass], fragments: [{ id: 'f1', content: 'hello', meta: {} }] })

    expect(result.status).toBe('error')
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'loom/invalid-pass')).toBe(true)
  })

  it('returns error result when a pass throws and preserves previous fragments', () => {
    const good: Pass = {
      name: 'good',
      run: (fragments) => fragments.map((fragment) => ({ ...fragment, content: 'good' })),
    }
    const bad: Pass = {
      name: 'bad',
      run: () => {
        throw new Error('boom')
      },
    }

    const result = runPasses({ passes: [good, bad], fragments: [{ id: 'f1', content: 'start', meta: {} }] })

    expect(result.status).toBe('error')
    expect(result.fragments[0]!.content).toBe('good')
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'loom/pass-threw')).toBe(true)
  })

  it('does not leak in-place mutations from a throwing pass', () => {
    const bad: Pass = {
      name: 'bad',
      run: (fragments) => {
        ;(fragments[0] as { content: string }).content = 'partial'
        throw new Error('boom')
      },
    }

    const result = runPasses({ passes: [bad], fragments: [{ id: 'f1', content: 'original', meta: {} }] })

    expect(result.status).toBe('error')
    expect(result.fragments[0]!.content).toBe('original')
    expect(result.trace.finalFragments[0]!.content).toBe('original')
  })

  it('keeps diagnostics emitted before a pass throws', () => {
    const bad: Pass = {
      name: 'bad',
      run: (fragments, ctx) => {
        ctx.diagnose({ severity: 'warning', code: 'test/before-throw', message: 'before throw' })
        throw new Error('boom')
      },
    }

    const result = runPasses({ passes: [bad], fragments: [{ id: 'f1', content: 'original', meta: {} }] })

    expect(result.status).toBe('error')
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'test/before-throw')).toBe(true)
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'loom/pass-threw')).toBe(true)
  })

  it('returns error result when pass output has duplicate or empty ids', () => {
    const duplicate: Pass = {
      name: 'duplicate',
      run: () => [
        { id: 'dup', content: 'a', meta: {} },
        { id: 'dup', content: 'b', meta: {} },
      ],
    }
    const empty: Pass = {
      name: 'empty',
      run: () => [{ id: '', content: 'a', meta: {} }],
    }

    const duplicateResult = runPasses({ passes: [duplicate], fragments: [{ id: 'f1', content: 'start', meta: {} }] })
    const emptyResult = runPasses({ passes: [empty], fragments: [{ id: 'f1', content: 'start', meta: {} }] })

    expect(duplicateResult.status).toBe('error')
    expect(duplicateResult.diagnostics.some((diagnostic) => diagnostic.code === 'loom/duplicate-id')).toBe(true)
    expect(emptyResult.status).toBe('error')
    expect(emptyResult.diagnostics.some((diagnostic) => diagnostic.code === 'loom/empty-id')).toBe(true)
  })

  it('collects ctx.diagnose diagnostics into result and trace', () => {
    const pass: Pass = {
      name: 'diagnoser',
      run: (fragments, ctx) => {
        ctx.diagnose({
          severity: 'hint',
          code: 'test/hint',
          message: 'hello',
          fragmentId: fragments[0]!.id,
        })
        return fragments
      },
    }

    const result = runPasses({ passes: [pass], fragments: [{ id: 'f1', content: 'hello', meta: {} }] })

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'test/hint')).toBe(true)
    expect(result.trace.executions[0]!.diagnostics.some((diagnostic) => diagnostic.code === 'test/hint')).toBe(true)
  })

  it('keeps result diagnostics but omits trace payload when trace mode is off', () => {
    const pass: Pass = {
      name: 'diagnoser',
      run: (fragments, ctx) => {
        ctx.diagnose({ severity: 'info', code: 'test/info', message: 'info' })
        return fragments
      },
    }

    const result = runPasses({
      passes: [pass],
      fragments: [{ id: 'f1', content: 'hello', meta: {} }],
      trace: { mode: 'off' },
    })

    expect(result.status).toBe('ok')
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'test/info')).toBe(true)
    expect(result.trace.executions).toEqual([])
    expect(result.trace.finalFragments).toEqual([])
  })
})
