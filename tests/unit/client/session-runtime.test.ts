import { readBranchById } from '../../../apps/studio-client/src/features/session-runtime/model/use-session-runtime.js'
import type { Branch } from '../../../apps/studio-client/src/entities/index.js'
import { describe, expect, it } from 'vitest'

describe('session runtime model', () => {
  it('reads a branch by id without changing branch order', () => {
    const branches: Branch[] = [
      { id: 'main', version: 1, title: 'Main' },
      { id: 'fork', version: 2, title: 'Fork' },
    ]

    expect(readBranchById(branches, 'fork')).toBe(branches[1])
    expect(readBranchById(branches, 'missing')).toBeUndefined()
    expect(branches.map(branch => branch.id)).toEqual(['main', 'fork'])
  })
})
