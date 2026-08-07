export type ConversationMarkerKind = 'fork' | 'memory' | 'checkpoint' | 'compression'

export type ConversationMarker = {
  entryId: string
  kind: ConversationMarkerKind
}

export function readConversationTickWidth(distance: number): number {
  return 6 + 20 * Math.exp(-(distance ** 2) / 3.6)
}

export function readConversationTrackOffset(visibleSlots: number, centerIndex: number, tickStep: number): number {
  return visibleSlots * tickStep / 2 - (centerIndex + 0.5) * tickStep
}

export function readConversationWindow(
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

export function readConversationWheelStep(delta: number): number {
  if (Math.abs(delta) < 24) return 0
  return Math.sign(delta) * Math.min(5, Math.max(1, Math.round(Math.abs(delta) / 36)))
}

export function readConversationPreview(content: string, maxLength = 180): string {
  const plainText = content
    .replace(/```[^\n]*\n?/g, '')
    .replace(/[`*_>#-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  return plainText.length <= maxLength ? plainText : `${plainText.slice(0, maxLength).trimEnd()}…`
}

export function createMockConversationMarkers(entryIds: string[]): ConversationMarker[] {
  if (!entryIds.some(id => id.startsWith('__timeline-mock-'))) return []

  return [
    { entryId: entryIds[17], kind: 'checkpoint' },
    { entryId: entryIds[39], kind: 'memory' },
    { entryId: entryIds[63], kind: 'compression' },
    { entryId: entryIds[79], kind: 'fork' },
  ].filter((marker): marker is ConversationMarker => Boolean(marker.entryId))
}
