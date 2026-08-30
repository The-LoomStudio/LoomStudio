import { describe, expect, it } from 'vitest'
import { runPasses, type Pass } from '@loom/core'

describe('trace', () => {
  it('records error status in trace', () => {
    const bad: Pass = {
      name: 'bad',
      run: () => {
        throw new Error('boom')
      },
    }

    const result = runPasses({ passes: [bad], fragments: [{ id: 'f1', content: 'hello', meta: {} }] })

    expect(result.status).toBe('error')
    expect(result.trace.status).toBe('error')
    expect(result.trace.error?.message).toBe('boom')
  })
})
