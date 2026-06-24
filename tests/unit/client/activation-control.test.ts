import { createActivationFacts, toggleActivationTag } from '../../../apps/studio-client/src/features/prompt-build/model/activation-control.js'
import { describe, expect, it } from 'vitest'

describe('activation control model', () => {
  it('builds prompt activation facts from UI control state', () => {
    expect(createActivationFacts({
      mode: 'finalize',
      tags: ['scene:combat'],
    })).toEqual({
      'agent.mode': 'finalize',
      tags: ['scene:combat'],
    })
  })

  it('toggles activation tags without mutating the previous list', () => {
    const tags = ['scene:combat'] as const

    expect(toggleActivationTag([...tags], 'style:cinematic')).toEqual(['scene:combat', 'style:cinematic'])
    expect(toggleActivationTag([...tags], 'scene:combat')).toEqual([])
    expect(tags).toEqual(['scene:combat'])
  })
})
