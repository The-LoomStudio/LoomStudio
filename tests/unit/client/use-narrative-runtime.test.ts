import { describe, expect, it } from 'vitest'
import type { NarrativeBranch, NarrativeTimeline } from '../../../apps/studio-client/src/entities/index.js'
import { readComposerDraftKey, resolveNarrativeBranch } from '../../../apps/studio-client/src/features/narrative-runtime/model/use-narrative-runtime.js'

describe('readComposerDraftKey', () => {
  it('isolates temporary drafts by branch and falls back to the selected card before a session exists', () => {
    const timeline = { id: 'timeline-1' } as NarrativeTimeline
    const branchA = { id: 'branch-a' } as NarrativeBranch
    const branchB = { id: 'branch-b' } as NarrativeBranch

    expect(readComposerDraftKey(timeline, branchA)).toBe('timeline-1:branch-a')
    expect(readComposerDraftKey(timeline, branchB)).toBe('timeline-1:branch-b')
    expect(readComposerDraftKey(undefined, undefined, 'card-1')).toBe('card:card-1')
  })
})

describe('resolveNarrativeBranch', () => {
  const branches = [
    { id: 'branch-main' },
    { id: 'branch-fork' },
  ] as NarrativeBranch[]

  it('uses an existing requested branch and falls back to the active branch', () => {
    expect(resolveNarrativeBranch(branches, 'branch-main', 'branch-fork')?.id).toBe('branch-fork')
    expect(resolveNarrativeBranch(branches, 'branch-main', 'missing')?.id).toBe('branch-main')
    expect(resolveNarrativeBranch([], 'branch-main')).toBeUndefined()
  })
})
