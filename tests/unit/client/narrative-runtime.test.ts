import { readNarrativeBranchById } from '../../../apps/studio-client/src/features/narrative-runtime/model/use-narrative-runtime.js'
import type { NarrativeBranch } from '../../../apps/studio-client/src/entities/index.js'
import { describe, expect, it } from 'vitest'

describe('narrative runtime model', () => {
  it('reads a branch by id without changing branch order', () => {
    const branches = [
      { id: 'main', title: 'Main' },
      { id: 'fork', title: 'Fork' },
    ] as NarrativeBranch[]

    expect(readNarrativeBranchById(branches, 'fork')).toBe(branches[1])
    expect(readNarrativeBranchById(branches, 'missing')).toBeUndefined()
    expect(branches.map(branch => branch.id)).toEqual(['main', 'fork'])
  })
})
