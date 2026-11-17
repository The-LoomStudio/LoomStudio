import type { DocumentRecord } from '@loom-studio/kernel/document-store'
import { describe, expect, it, vi } from 'vitest'
import { toCardSource } from '../../../packages/application-runtime/src/cards/card.js'
import { createCardsRuntimeMethods } from '../../../packages/application-runtime/src/runtime/cards-runtime.js'
import type { CardSourceContent } from '../../../packages/application-runtime/src/types.js'

describe('Invalid card summary isolation', () => {
  it('returns valid and invalid records together without loosening strict Card reads', async () => {
    const content: CardSourceContent = {
      artifactId: 'author-work', name: 'Valid card', preset: {},
      opening: { id: 'opening', content: 'Welcome' }, lore: { entries: [] },
      createdAt: '2026-10-14T00:00:00Z', updatedAt: '2026-10-14T01:00:00Z',
    }
    const good = { id: 'good', version: 2, content } as DocumentRecord<CardSourceContent>
    const bad = { id: 'bad', version: 7, content: {
      ...content, name: 'Broken card', media: { avatarAssetId: 'author-avatar' },
      opening: { entries: [{ content: 'Legacy content' }] },
    } } as unknown as DocumentRecord<CardSourceContent>
    const list = vi.fn(async () => ({ items: [good, bad], nextCursor: 'next-page' }))
    const runtime = createCardsRuntimeMethods({ documents: { list } } as unknown as Parameters<typeof createCardsRuntimeMethods>[0])

    const result = await runtime.listCards({ limit: 2 })
    expect(result.nextCursor).toBe('next-page')
    expect(result.cards).toHaveLength(2)
    expect(result.cards[0]).toMatchObject({ id: 'good', version: 2, name: 'Valid card', openingPreview: 'Welcome' })
    expect(result.cards[0]).not.toHaveProperty('validationError')
    expect(result.cards[1]).toMatchObject({ id: 'bad', version: 7, name: 'Broken card', artifactId: 'author-work',
      media: { avatarAssetId: 'author-avatar' }, validationError: 'Opening must contain a single string content' })
    expect(() => toCardSource(bad)).toThrow('Opening must contain a single string content')
    expect(bad.content.opening).toEqual({ entries: [{ content: 'Legacy content' }] })
  })
})
