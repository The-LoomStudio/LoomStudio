import { describe, expect, it } from 'vitest'
import { createMockCards } from './resource-panel.js'

describe('createMockCards', () => {
  it('creates a stable visual-development gallery without duplicate ids', () => {
    const cards = createMockCards(100)

    expect(cards).toHaveLength(100)
    expect(new Set(cards.map(card => card.id)).size).toBe(100)
    expect(cards.every(card => card.id.startsWith('__gallery-mock-') && card.name.length > 0)).toBe(true)
  })
})
