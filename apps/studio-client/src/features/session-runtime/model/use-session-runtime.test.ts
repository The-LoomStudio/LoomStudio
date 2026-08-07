import { describe, expect, it } from 'vitest'
import type { Branch, Session } from '../../../entities/index.js'
import { readComposerDraftKey, resolveSessionBranch } from './use-session-runtime.js'

describe('readComposerDraftKey', () => {
  it('isolates temporary drafts by branch and falls back to the selected card before a session exists', () => {
    const session = { id: 'session-1' } as Session
    const branchA = { id: 'branch-a' } as Branch
    const branchB = { id: 'branch-b' } as Branch

    expect(readComposerDraftKey(session, branchA)).toBe('session-1:branch-a')
    expect(readComposerDraftKey(session, branchB)).toBe('session-1:branch-b')
    expect(readComposerDraftKey(undefined, undefined, 'card-1')).toBe('card:card-1')
  })
})

describe('resolveSessionBranch', () => {
  const branches = [
    { id: 'branch-main', version: 1 },
    { id: 'branch-fork', version: 1 },
  ] as Branch[]

  it('uses an existing requested branch and falls back to the active branch', () => {
    expect(resolveSessionBranch(branches, 'branch-main', 'branch-fork')?.id).toBe('branch-fork')
    expect(resolveSessionBranch(branches, 'branch-main', 'missing')?.id).toBe('branch-main')
    expect(resolveSessionBranch([], 'branch-main')).toBeUndefined()
  })
})
