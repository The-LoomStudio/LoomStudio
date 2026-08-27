import { describe, expect, it } from 'vitest'
import { clampAgentExpansionHeight } from './agent-composer.js'

describe('AgentComposer.clampAgentExpansionHeight', () => {
  it('keeps pointer and keyboard resizing inside the usable height range', () => {
    expect(clampAgentExpansionHeight(180, 640)).toBe(220)
    expect(clampAgentExpansionHeight(420, 640)).toBe(420)
    expect(clampAgentExpansionHeight(800, 640)).toBe(640)
  })
})
