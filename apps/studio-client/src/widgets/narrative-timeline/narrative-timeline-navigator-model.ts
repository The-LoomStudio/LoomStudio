type NarrativeTimelineMarkerKind = 'fork' | 'memory' | 'checkpoint' | 'compression'

export type NarrativeTimelineMarker = {
  entryId: string
  kind: NarrativeTimelineMarkerKind
}

export function readNarrativeTimelineTickWidth(distance: number): number {
  return 6 + 20 * Math.exp(-(distance ** 2) / 3.6)
}

export function readNarrativeTimelineTrackOffset(visibleSlots: number, centerIndex: number, tickStep: number): number {
  return visibleSlots * tickStep / 2 - (centerIndex + 0.5) * tickStep
}

export function readNarrativeTimelineWindow(
  itemCount: number,
  centerIndex: number,
  visibleCount: number,
  overscan = 8,
): { end: number; start: number } {
  if (itemCount <= 0) return { end: 0, start: 0 }
  const size = Math.min(itemCount, Math.max(1, visibleCount))
  const center = Math.min(itemCount - 1, Math.max(0, centerIndex))
  const visibleStart = Math.min(itemCount - size, Math.max(0, center - Math.floor(size / 2)))
  return {
    start: Math.max(0, visibleStart - overscan),
    end: Math.min(itemCount, visibleStart + size + overscan),
  }
}

export function readNarrativeTimelineWheelStep(delta: number): number {
  if (Math.abs(delta) < 24) return 0
  return Math.sign(delta) * Math.min(5, Math.max(1, Math.round(Math.abs(delta) / 36)))
}

export function readNarrativeTimelinePreview(content: string, maxLength = 180): string {
  const plainText = content
    .replace(/```[^\n]*\n?/g, '')
    .replace(/[`*_>#-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  return plainText.length <= maxLength ? plainText : `${plainText.slice(0, maxLength).trimEnd()}…`
}
