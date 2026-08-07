import { describe, expect, it } from 'vitest'
import {
  createMockConversationMarkers,
  readConversationPreview,
  readConversationTickWidth,
  readConversationTrackOffset,
  readConversationWheelStep,
} from './conversation-navigator-model.js'

describe('conversation navigator model', () => {
  it('creates a bounded dock wave', () => {
    const widths = [0, 1, 2, 3, 4].map(readConversationTickWidth)
    expect(widths[0]).toBe(26)
    expect(widths[0]).toBeGreaterThan(widths[1]!)
    expect(widths[1]).toBeGreaterThan(widths[2]!)
    expect(widths[4]).toBeLessThan(6.3)
  })

  it('centers the first and last entries with track overflow on either side', () => {
    expect(readConversationTrackOffset(60, 0, 11)).toBe(324.5)
    expect(readConversationTrackOffset(60, 99, 11)).toBe(-764.5)
  })

  it('turns wheel distance into bounded multi-entry navigation', () => {
    expect(readConversationWheelStep(12)).toBe(0)
    expect(readConversationWheelStep(36)).toBe(1)
    expect(readConversationWheelStep(-180)).toBe(-5)
  })

  it('reduces markdown to a compact preview', () => {
    expect(readConversationPreview('### Title\n\n```json\n{"ok":true}\n```')).toBe('Title {"ok":true}')
  })

  it('only creates semantic demo markers for the timeline mock', () => {
    expect(createMockConversationMarkers(['entry-1'])).toEqual([])
    expect(createMockConversationMarkers(Array.from({ length: 80 }, (_, index) => `__timeline-mock-${index + 1}`))).toHaveLength(4)
  })
})
