import { describe, expect, it } from 'vitest'
import { appendMockAgentTurn, forkMockAgentBranch, INITIAL_AGENT_BRANCHES } from './agent-composer-model.js'

describe('agent composer mock branches', () => {
  it('appends a turn only to the active Agent branch', () => {
    const next = appendMockAgentTurn(INITIAL_AGENT_BRANCHES, 'review', '继续检查。', 'next')

    expect(next[0]).toBe(INITIAL_AGENT_BRANCHES[0])
    expect(next[1]?.items.at(-2)).toMatchObject({ role: 'user', content: '继续检查。' })
    expect(next[1]?.items.at(-1)).toMatchObject({ role: 'assistant' })
  })

  it('forks Agent transcript without changing the source branch', () => {
    const next = forkMockAgentBranch(INITIAL_AGENT_BRANCHES, 'main', 'assistant-1', 'fork-1', 'Branch 1')

    expect(next).toHaveLength(3)
    expect(next[0]).toBe(INITIAL_AGENT_BRANCHES[0])
    expect(next[2]).toMatchObject({ id: 'fork-1', label: 'Branch 1' })
    expect(next[2]?.items.map(item => item.id)).toEqual(['user-1', 'assistant-1'])
  })
})
