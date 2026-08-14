import { describe, expect, it, vi } from 'vitest'
import { createMockCards } from './character-panel.js'
import { removeOrphanCharacterMedia, replaceCharacterMedia } from './character-panel-model.js'
import { beginCharacterProfileClose, finishCharacterProfileClose, openCharacterProfile } from './character-profile-navigation-model.js'

describe('createMockCards', () => {
  it('creates a stable visual-development gallery without duplicate ids', () => {
    const cards = createMockCards(100)

    expect(cards).toHaveLength(100)
    expect(new Set(cards.map(card => card.id)).size).toBe(100)
    expect(cards.every(card => card.id.startsWith('__gallery-mock-') && card.name.length > 0)).toBe(true)
  })
})

describe('character media model', () => {
  it('revokes replaced media and keeps the other target for the same card', () => {
    const revoke = vi.fn()
    const result = replaceCharacterMedia({
      cardId: 'card-a',
      mediaByCardId: { 'card-a': { avatar: 'blob:old-avatar', background: 'blob:background' } },
      nextUrl: 'blob:new-avatar',
      revoke,
      target: 'avatar',
    })

    expect(revoke).toHaveBeenCalledWith('blob:old-avatar')
    expect(result).toEqual({ 'card-a': { avatar: 'blob:new-avatar', background: 'blob:background' } })
  })

  it('removes deleted cards and immediately revokes their blob urls', () => {
    const revoke = vi.fn()
    const media = {
      'card-a': { avatar: 'blob:avatar-a' },
      'card-b': { avatar: 'blob:avatar-b', background: 'https://example.test/background.png' },
    }

    expect(removeOrphanCharacterMedia({ knownCardIds: new Set(['card-a']), mediaByCardId: media, revoke })).toEqual({
      'card-a': { avatar: 'blob:avatar-a' },
    })
    expect(revoke).toHaveBeenCalledTimes(1)
    expect(revoke).toHaveBeenCalledWith('blob:avatar-b')
  })
})

describe('character profile navigation model', () => {
  it('does not let an old close transition clear a profile opened afterwards', () => {
    const initial = { cardId: 'card-a', leaving: false, transitionId: 0 }
    const closing = beginCharacterProfileClose(initial)
    const opened = openCharacterProfile(closing, 'card-b')

    expect(finishCharacterProfileClose(opened, closing.transitionId)).toEqual(opened)
    expect(opened).toMatchObject({ cardId: 'card-b', leaving: false })
  })
})
