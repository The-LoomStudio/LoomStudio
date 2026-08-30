import { describe, expect, it } from 'vitest'
import {
  readNarrativeTimelinePreview,
  readNarrativeTimelineTickWidth,
  readNarrativeTimelineTrackOffset,
  readNarrativeTimelineWindow,
  readNarrativeTimelineWheelStep,
} from '../../../apps/studio-client/src/widgets/narrative-timeline/narrative-timeline-navigator-model.js'

describe('narrative timeline navigator model', () => {
  it('creates a bounded dock wave', () => {
    const widths = [0, 1, 2, 3, 4].map(readNarrativeTimelineTickWidth)
    expect(widths[0]).toBe(26)
    expect(widths[0]).toBeGreaterThan(widths[1]!)
    expect(widths[1]).toBeGreaterThan(widths[2]!)
    expect(widths[4]).toBeLessThan(6.3)
  })

  it('centers the first and last entries with track overflow on either side', () => {
    expect(readNarrativeTimelineTrackOffset(60, 0, 11)).toBe(324.5)
    expect(readNarrativeTimelineTrackOffset(60, 99, 11)).toBe(-764.5)
  })

  it('turns wheel distance into bounded multi-entry navigation', () => {
    expect(readNarrativeTimelineWheelStep(12)).toBe(0)
    expect(readNarrativeTimelineWheelStep(36)).toBe(1)
    expect(readNarrativeTimelineWheelStep(-180)).toBe(-5)
  })

  it('limits long conversations to a centered window with overscan', () => {
    expect(readNarrativeTimelineWindow(1_000, 500, 100)).toEqual({ start: 442, end: 558 })
    expect(readNarrativeTimelineWindow(1_000, 0, 100)).toEqual({ start: 0, end: 108 })
    expect(readNarrativeTimelineWindow(1_000, 999, 100)).toEqual({ start: 892, end: 1_000 })
  })

  it('reduces markdown to a compact preview', () => {
    expect(readNarrativeTimelinePreview('### Title\n\n```json\n{"ok":true}\n```')).toBe('Title {"ok":true}')
  })

})
