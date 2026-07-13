import { describe, expect, it } from 'vitest'
import { pipeline, type Pass } from '../src'

describe('owner tracking', () => {
  it('annotates input fragments with input owner and ignores spoofed input owner', () => {
    const noop: Pass = {
      name: 'noop',
      run: (fragments) => fragments,
    }

    const result = pipeline([noop]).run([{ id: 'f1', content: 'original', meta: { __owner: 'spoofed' } }])

    expect((result.fragments[0]!.meta as Record<string, unknown>).__owner).toBe('input')
  })

  it('annotates newly created fragments with current pass owner', () => {
    const creator: Pass = {
      name: 'creator',
      run: () => [{ id: 'new', content: 'created', meta: {} }],
    }

    const result = pipeline([creator]).run([])

    expect((result.fragments[0]!.meta as Record<string, unknown>).__owner).toBe('creator')
  })

  it('overrides spoofed owner on newly created fragments', () => {
    const creator: Pass = {
      name: 'creator',
      run: () => [{ id: 'new', content: 'created', meta: { __owner: 'external' } }],
    }

    const result = pipeline([creator]).run([])

    expect(result.status).toBe('ok')
    expect((result.fragments[0]!.meta as Record<string, unknown>).__owner).toBe('creator')
  })

  it('reports cross-owner writes without blocking the run', () => {
    const editor: Pass = {
      name: 'editor',
      run: (fragments) => fragments.map((fragment) => ({ ...fragment, content: 'changed' })),
    }

    const result = pipeline([editor]).run([
      { id: 'f1', content: 'original', meta: { __owner: 'other' } },
    ])

    expect(result.status).toBe('ok')
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'loom/cross-owner-write')).toBe(true)
  })

  it('reports writes to spoofed input owner as input-owned writes', () => {
    const editor: Pass = {
      name: 'editor',
      run: (fragments) => fragments.map((fragment) => ({ ...fragment, content: 'changed' })),
    }

    const result = pipeline([editor]).run([
      { id: 'f1', content: 'original', meta: { __owner: 'editor' } },
    ])

    expect(result.status).toBe('ok')
    expect(result.diagnostics.some((diagnostic) =>
      diagnostic.code === 'loom/cross-owner-write' && diagnostic.meta?.owner === 'input'
    )).toBe(true)
  })

  it('does not report cross-owner writes for self-owned changes', () => {
    const creator: Pass = {
      name: 'editor',
      run: () => [{ id: 'f1', content: 'original', meta: {} }],
    }
    const editor: Pass = {
      name: 'editor',
      run: (fragments) => fragments.map((fragment) => ({ ...fragment, content: 'changed' })),
    }

    const result = pipeline([creator, editor]).run([])

    expect(result.status).toBe('ok')
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'loom/cross-owner-write')).toBe(false)
  })

  it('reports cross-owner writes for business meta changes', () => {
    const editor: Pass = {
      name: 'editor',
      run: (fragments) => fragments.map((fragment) => ({
        ...fragment,
        meta: { ...(fragment.meta as Record<string, unknown>), tag: 'changed' },
      })),
    }

    const result = pipeline([editor]).run([
      { id: 'f1', content: 'original', meta: { __owner: 'other', tag: 'old' } },
    ])

    expect(result.status).toBe('ok')
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'loom/cross-owner-write')).toBe(true)
  })

  it('does not report cross-owner writes for equivalent meta key reordering', () => {
    const creator: Pass = {
      name: 'other',
      run: () => [{ id: 'f1', content: 'original', meta: { a: 1, b: 2 } }],
    }
    const editor: Pass = {
      name: 'editor',
      run: (fragments) => fragments.map((fragment) => ({
        ...fragment,
        meta: { __owner: 'other', b: 2, a: 1 },
      })),
    }

    const result = pipeline([creator, editor]).run([])

    expect(result.status).toBe('ok')
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'loom/cross-owner-write')).toBe(false)
  })

  it('does not report cross-owner writes for pure moves', () => {
    const mover: Pass = {
      name: 'mover',
      run: (fragments) => [...fragments].reverse(),
    }

    const result = pipeline([mover]).run([
      { id: 'a', content: 'a', meta: { __owner: 'other' } },
      { id: 'b', content: 'b', meta: { __owner: 'other' } },
    ])

    expect(result.status).toBe('ok')
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'loom/cross-owner-write')).toBe(false)
  })

  it('reports cross-owner writes when removing fragments owned by others', () => {
    const remover: Pass = {
      name: 'remover',
      run: () => [],
    }

    const result = pipeline([remover]).run([
      { id: 'f1', content: 'original', meta: { __owner: 'other' } },
    ])

    expect(result.status).toBe('ok')
    expect(result.diagnostics.some((diagnostic) =>
      diagnostic.code === 'loom/cross-owner-write' && diagnostic.meta?.operation === 'remove'
    )).toBe(true)
  })

  it('rejects meta.__owner mutation', () => {
    const mutator: Pass = {
      name: 'mutator',
      run: (fragments) => fragments.map((fragment) => ({
        ...fragment,
        meta: { ...(fragment.meta as Record<string, unknown>), __owner: 'mutator' },
      })),
    }

    const result = pipeline([mutator]).run([
      { id: 'f1', content: 'original', meta: { __owner: 'other' } },
    ])

    expect(result.status).toBe('error')
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === 'loom/owner-mutation')).toBe(true)
  })
})
