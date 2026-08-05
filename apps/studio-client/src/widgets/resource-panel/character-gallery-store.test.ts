import { describe, expect, it } from 'vitest'
import { sanitizeCharacterGalleryState } from './character-gallery-store.js'

describe('sanitizeCharacterGalleryState', () => {
  it('keeps only one-level valid groups and assignments', () => {
    expect(sanitizeCharacterGalleryState({
      activeGroupId: 'urban',
      assignments: { cardA: 'urban', cardB: 'missing' },
      groups: [{ id: 'urban', name: '都市', order: 1 }, { id: '', name: 'invalid', order: 0 }],
    })).toEqual({
      activeGroupId: 'urban',
      assignments: { cardA: 'urban' },
      groups: [{ id: 'urban', name: '都市', order: 1 }],
    })
  })
})
