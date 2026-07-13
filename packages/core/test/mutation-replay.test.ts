import { describe, expect, it } from 'vitest'
import { pipeline, replayTrace, type Pass } from '../src'

describe('replayTrace', () => {
  it('replays mutation trace to final fragments', () => {
    const pass: Pass = {
      name: 'mix',
      run: (fragments) => [
        { ...fragments[0]!, content: 'updated' },
        { id: 'new', content: 'added', meta: {} },
      ],
    }

    const result = pipeline([pass]).run([
      { id: 'a', content: 'original', meta: {} },
      { id: 'b', content: 'removed', meta: {} },
    ])

    expect(replayTrace(result.trace)).toEqual(result.trace.finalFragments)
  })

  it('can replay until a pass index', () => {
    const first: Pass = {
      name: 'first',
      run: (fragments) => fragments.map((fragment) => ({ ...fragment, content: `${fragment.content}1` })),
    }
    const second: Pass = {
      name: 'second',
      run: (fragments) => fragments.map((fragment) => ({ ...fragment, content: `${fragment.content}2` })),
    }

    const result = pipeline([first, second]).run([{ id: 'f', content: '', meta: {} }])

    expect(replayTrace(result.trace, { untilPassIndex: 0 })[0]!.content).toBe('1')
  })

  it('replays add mutations without execution afterFragments', () => {
    const pass: Pass = {
      name: 'add',
      run: () => [{ id: 'added', content: 'new', meta: {} }],
    }

    const result = pipeline([pass]).run([])

    expect(result.trace.executions[0]!.mutations.map((mutation) => mutation.op)).toEqual(['add'])
    expect('afterFragments' in result.trace.executions[0]!).toBe(false)
    expect(replayTrace(result.trace)).toEqual(result.trace.finalFragments)
  })

  it('replays remove mutations', () => {
    const pass: Pass = {
      name: 'remove',
      run: () => [],
    }

    const result = pipeline([pass]).run([{ id: 'f1', content: 'old', meta: {} }])

    expect(result.trace.executions[0]!.mutations.map((mutation) => mutation.op)).toEqual(['remove'])
    expect(replayTrace(result.trace)).toEqual([])
  })

  it('replays content update mutations', () => {
    const pass: Pass = {
      name: 'update',
      run: (fragments) => fragments.map((fragment) => ({ ...fragment, content: 'new' })),
    }

    const result = pipeline([pass]).run([{ id: 'f1', content: 'old', meta: {} }])

    expect(result.trace.executions[0]!.mutations.map((mutation) => mutation.op)).toEqual(['update'])
    expect(replayTrace(result.trace)[0]!.content).toBe('new')
  })

  it('replays metadata-only update mutations', () => {
    const pass: Pass = {
      name: 'meta-update',
      run: (fragments) => fragments.map((fragment) => ({
        ...fragment,
        meta: { ...(fragment.meta as Record<string, unknown>), tag: 'new' },
      })),
    }

    const result = pipeline([pass]).run([{ id: 'f1', content: 'old', meta: { tag: 'old' } }])

    expect(result.trace.executions[0]!.mutations.map((mutation) => mutation.op)).toContain('update')
    expect((replayTrace(result.trace)[0]!.meta as Record<string, unknown>).tag).toBe('new')
    expect(replayTrace(result.trace)).toEqual(result.trace.finalFragments)
  })

  it('replays move mutations', () => {
    const pass: Pass = {
      name: 'move',
      run: (fragments) => [...fragments].reverse(),
    }

    const result = pipeline([pass]).run([
      { id: 'a', content: 'a', meta: {} },
      { id: 'b', content: 'b', meta: {} },
    ])

    expect(result.trace.executions[0]!.mutations.every((mutation) => mutation.op === 'move')).toBe(true)
    expect(replayTrace(result.trace).map((fragment) => fragment.id)).toEqual(['b', 'a'])
  })

  it('replays move plus update on the same fragment', () => {
    const pass: Pass = {
      name: 'move-update',
      run: (fragments) => [
        { ...fragments[1]!, content: 'B updated', meta: { ...fragments[1]!.meta as Record<string, unknown>, label: 'updated' } },
        fragments[0]!,
      ],
    }

    const result = pipeline([pass]).run([
      { id: 'a', content: 'A', meta: {} },
      { id: 'b', content: 'B', meta: { label: 'old' } },
    ])
    const ops = result.trace.executions[0]!.mutations.map((mutation) => mutation.op)
    const replayed = replayTrace(result.trace)

    expect(ops).toContain('move')
    expect(ops).toContain('update')
    expect(replayed).toEqual(result.trace.finalFragments)
    expect(replayed[0]!.content).toBe('B updated')
    expect((replayed[0]!.meta as Record<string, unknown>).label).toBe('updated')
  })

  it('preserves owner information after replay', () => {
    const pass: Pass = {
      name: 'creator',
      run: () => [{ id: 'new', content: 'new', meta: {} }],
    }

    const result = pipeline([pass]).run([])
    const replayed = replayTrace(result.trace)

    expect((replayed[0]!.meta as Record<string, unknown>).__owner).toBe('creator')
  })
})
