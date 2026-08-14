import { describe, expect, it } from 'vitest'
import { isTimelineNearBottom } from './narrative-timeline.js'

describe('NarrativeTimeline.isTimelineNearBottom', () => {
  it('follows composer growth only near the latest messages', () => {
    expect(isTimelineNearBottom({ clientHeight: 600, scrollHeight: 1200, scrollTop: 560 })).toBe(true)
    expect(isTimelineNearBottom({ clientHeight: 600, scrollHeight: 1200, scrollTop: 400 })).toBe(false)
  })
})
