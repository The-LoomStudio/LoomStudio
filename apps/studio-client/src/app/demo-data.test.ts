import { describe, expect, it } from 'vitest'
import { createMockSearchAssetModule } from './demo-context-assets.js'
import { createMockTimeline } from './demo-timeline.js'

describe('demo timeline', () => {
  it('creates a continuous 100-floor Markdown conversation', () => {
    const timeline = createMockTimeline()

    expect(timeline).toHaveLength(100)
    expect(timeline[0]).toMatchObject({ id: '__timeline-mock-1', role: 'assistant' })
    expect(timeline[99]).toMatchObject({ id: '__timeline-mock-100', parentEntryId: '__timeline-mock-99', role: 'user' })
    expect(timeline.every((entry, index) => index === 0 || entry.parentEntryId === timeline[index - 1]?.id)).toBe(true)
    expect(timeline.some(entry => entry.content.includes('```yaml'))).toBe(true)
    expect(timeline.some(entry => entry.content.includes('```json'))).toBe(true)
    expect(timeline.some(entry => entry.content.includes('@assets/'))).toBe(true)
  })
})

describe('demo search assets', () => {
  it('creates 800 unique entries across searchable folders', () => {
    const root = createMockSearchAssetModule()
    const entries = root.children?.flatMap(folder => folder.children ?? []) ?? []

    expect(entries).toHaveLength(800)
    expect(new Set(entries.map(entry => entry.id)).size).toBe(800)
    expect(entries.some(entry => entry.body?.includes('维护协议'))).toBe(true)
    expect(root.children?.some(folder => folder.meta?.includes('clocktower'))).toBe(true)
  })
})
