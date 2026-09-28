import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FormEvent } from 'react'
import { useAsyncOperations } from '../../../apps/studio-client/src/shared/hooks/use-async-operations.js'
import { useCards } from '../../../apps/studio-client/src/features/cards/model/use-cards.js'
import type { StudioApi } from '../../../apps/studio-client/src/shared/api/studio-api.js'
import type { Card } from '../../../apps/studio-client/src/entities/index.js'
import { createTranslator } from '../../../apps/studio-client/src/shared/i18n/index.js'

const hooks = vi.hoisted(() => ({
  cursor: 0,
  values: [] as unknown[],
  dispatch: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }))
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useCallback: (callback: unknown) => callback,
  useEffect: () => undefined,
  useReducer: (_reducer: unknown, initial: unknown, init: (value: unknown) => unknown) => [init(initial), hooks.dispatch],
  useState: (initial: unknown) => {
    const index = hooks.cursor++
    if (!(index in hooks.values)) hooks.values[index] = initial
    return [hooks.values[index], (value: unknown) => {
      hooks.values[index] = typeof value === 'function' ? value(hooks.values[index]) : value
    }]
  },
  useRef: (initial: unknown) => {
    const index = hooks.cursor++
    if (!(index in hooks.values)) hooks.values[index] = { current: initial }
    return hooks.values[index]
  },
}))

beforeEach(() => { hooks.cursor = 0; hooks.values = []; hooks.dispatch.mockClear() })
afterEach(() => { vi.unstubAllGlobals() })

describe('Card operation failure propagation', () => {
  it.each(['list', 'related'] as const)('retains a committed import when %s refresh fails', async stage => {
    const card: Card = {
      id: 'imported-card', version: 3, name: 'Imported',
      opening: { entries: [] }, settingLayer: { entries: [] },
      createdAt: '2026-09-23', updatedAt: '2026-09-23',
    }
    const failure = new Error('Refresh failed')
    const list = stage === 'list'
      ? vi.fn().mockRejectedValue(failure)
      : vi.fn().mockResolvedValue({ cards: [card] })
    const onCardsImported = vi.fn().mockRejectedValue(failure)
    const update = vi.fn().mockResolvedValue({ card: { ...card, version: 4 }, mutation: { changesetId: 'save' } })
    const api = { cards: { list, update } } as unknown as StudioApi
    const fetch = vi.fn(async () => new Response(JSON.stringify({ card })))
    vi.stubGlobal('fetch', fetch)
    const render = () => {
      hooks.cursor = 0
      return useCards({
        api, initialCardName: '', recordEdit: vi.fn(), onCardsImported, t: createTranslator('en-US'),
        runAction: action => action(),
      })
    }
    await expect(render().importCards([new File(['image'], 'card.png')])).rejects.toBe(failure)
    const current = render()
    expect(current.cards).toEqual([expect.objectContaining({ id: card.id, version: card.version })])
    expect(current.selectedCardId).toBe(card.id)
    expect(current.selectedCardDetails).toEqual(card)
    expect(current.cardDraft.name).toBe(card.name)
    expect(fetch).toHaveBeenCalledOnce()
    list.mockResolvedValue({ cards: [{ ...card, version: 4 }] })
    await current.updateCard({ preventDefault() {} } as FormEvent)
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ cardId: card.id, expectedVersion: 3 }))
  })

  it.each(['a', 'b'] as const)('invalidates a pending selection only when its card %s was deleted', async deletedId => {
    const card = (id: string): Card => ({
      id, name: id, version: 1, opening: { entries: [] }, settingLayer: { entries: [] },
      createdAt: '2026-09-23', updatedAt: '2026-09-23',
    })
    let resolve!: (value: { card: Card }) => void
    const api = {
      cards: {
        list: vi.fn().mockResolvedValueOnce({ cards: [card('a'), card('b')] })
          .mockResolvedValue({ cards: [card(deletedId === 'a' ? 'b' : 'a')] }),
        get: () => new Promise<{ card: Card }>(accept => { resolve = accept }),
        deleteMany: async () => ({ deleted: true, cardIds: [deletedId], mutation: { changesetId: 'delete' } }),
      },
    } as unknown as StudioApi
    const render = () => {
      hooks.cursor = 0
      return useCards({
        api, initialCardName: '', recordEdit: vi.fn(), t: createTranslator('en-US'),
        runAction: action => action(),
      })
    }
    await render().refreshCards()
    const pending = render().selectCard('a')
    await render().deleteCards([deletedId])
    resolve({ card: card('a') })
    await pending
    const current = render()
    expect(current.selectedCardId).toBe(deletedId === 'a' ? 'b' : 'a')
    if (deletedId === 'a') expect(current.selectedCardDetails?.id).not.toBe('a')
    else expect(current.selectedCardDetails?.id).toBe('a')
  })

  it.each(['create', 'import'] as const)('does not replace a later selection when %s finishes', async operation => {
    const card = (id: string): Card => ({
      id, name: id, version: 1, opening: { entries: [] }, settingLayer: { entries: [] },
      createdAt: '2026-09-23', updatedAt: '2026-09-23',
    })
    let release!: () => void
    const pendingWrite = new Promise<void>(resolve => { release = resolve })
    const created = card('created')
    const api = {
      cards: {
        create: async () => { await pendingWrite; return { card: created, mutation: { changesetId: 'commit' } } },
        get: async (id: string) => ({ card: card(id) }),
        list: async () => ({ cards: [card('other'), created] }),
      },
    } as unknown as StudioApi
    vi.stubGlobal('fetch', vi.fn(async () => {
      await pendingWrite
      return new Response(JSON.stringify({ card: created }))
    }))
    const render = () => {
      hooks.cursor = 0
      return useCards({
        api, initialCardName: '', recordEdit: vi.fn(), t: createTranslator('en-US'),
        runAction: action => action(),
      })
    }
    const pending = operation === 'create'
      ? render().createCard()
      : render().importCards([new File(['image'], 'card.png', { type: 'image/png' })])
    await render().selectCard('other')
    render().setCardDraft({ name: 'Other draft', userName: '', description: '' })
    release()
    await pending
    const current = render()
    expect(current.cards.some(card => card.id === 'created')).toBe(true)
    expect(current.selectedCardId).toBe('other')
    expect(current.selectedCardDetails?.id).toBe('other')
    expect(current.cardDraft.name).toBe('Other draft')
  })

  it.each([
    ['macros', false], ['macros', true], ['state', false], ['state', true],
  ] as const)('refreshes an overlapping list after %s commits (initial=%s)', async (operation, initial) => {
    const original: Card = {
      id: 'card', name: 'Card', version: 1, opening: { entries: [] }, settingLayer: { entries: [] },
      createdAt: '2026-09-23', updatedAt: '2026-09-23',
    }
    const other = { ...original, id: 'other' }
    const updated = { ...original, version: 2 }
    let resolveOld!: (value: { cards: Card[] }) => void
    const pendingList = new Promise<{ cards: Card[] }>(resolve => { resolveOld = resolve })
    const list = vi.fn()
    if (!initial) list.mockResolvedValueOnce({ cards: [original, other] })
    list.mockReturnValueOnce(pendingList).mockResolvedValueOnce({ cards: [updated, other] })
    const update = vi.fn().mockResolvedValue({ card: updated, mutation: { changesetId: 'commit' } })
    const api = { cards: { list, update } } as unknown as StudioApi
    const render = () => {
      hooks.cursor = 0
      return useCards({
        api, initialCardName: '', recordEdit: vi.fn(), t: createTranslator('en-US'),
        runAction: action => action(),
      })
    }
    if (!initial) await render().refreshCards()
    const read = render().refreshCards()
    if (operation === 'macros') await render().updateCardMacros({ cardId: 'card', expectedVersion: 1, macros: {} })
    else await render().updateCardStateConfig({
      cardId: 'card', expectedVersion: 1, stateDefinitionIds: [], stateEntityTypes: [],
      timelineStateEntities: [], timelineComponentMounts: [], stateContributionIds: [], timelineStateBindings: [],
    })
    resolveOld({ cards: [original, other] })
    await read
    expect(render().cards.map(card => [card.id, card.version])).toEqual([['card', 2], ['other', 1]])
    expect(update).toHaveBeenCalledTimes(1)
    expect(list).toHaveBeenCalledTimes(initial ? 2 : 3)
  })

  it.each(['media', 'resources'] as const)('retains the committed %s update without replacing another card editor', async operation => {
    const card = (id: string): Card => ({
      id, name: id, version: 1, opening: { entries: [] }, settingLayer: { entries: [] },
      createdAt: '2026-09-23', updatedAt: '2026-09-23',
    })
    const cards = [card('a'), card('b')]
    let resolve!: (value: Awaited<ReturnType<StudioApi['cards']['update']>>) => void
    const committed = new Promise<Awaited<ReturnType<StudioApi['cards']['update']>>>(accept => { resolve = accept })
    const update = vi.fn().mockReturnValue(committed)
    const failure = new Error('List refresh failed')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ asset: { id: 'asset' } }))))
    const api = {
      cards: {
        list: vi.fn().mockResolvedValueOnce({ cards }).mockRejectedValue(failure),
        get: async (id: string) => ({ card: cards.find(item => item.id === id)! }),
        update, updatePromptResources: update,
      },
    } as unknown as StudioApi
    const render = () => {
      hooks.cursor = 0
      return useCards({
        api, initialCardName: '', recordEdit: vi.fn(), t: createTranslator('en-US'),
        runAction: action => action(),
      })
    }
    await render().refreshCards()
    await render().selectCard('a')
    const pending = operation === 'media'
      ? render().updateCardMedia('a', 'avatar', new File(['image'], 'a.png', { type: 'image/png' }))
      : render().replaceCardPromptResources('a', ['resource'])
    await render().selectCard('b')
    render().setCardDraft({ name: 'B draft', userName: '', description: '' })
    resolve({ card: { ...cards[0]!, version: 2, media: { avatarAssetId: 'asset' }, promptResourceIds: ['resource'] }, mutation: { changesetId: 'commit' } })
    await expect(pending).rejects.toBe(failure)
    const current = render()
    expect(current.cards.find(item => item.id === 'a')?.version).toBe(2)
    expect(current.selectedCardId).toBe('b')
    expect(current.selectedCardDetails?.id).toBe('b')
    expect(current.cardDraft.name).toBe('B draft')
    if (operation === 'media') expect(update).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 1 }))
  })

  it.each(['upload', 'import'] as const)('stops the remaining %s steps after the API changes', async operation => {
    let resolveResponse!: (value: Response) => void
    const response = new Promise<Response>(resolve => { resolveResponse = resolve })
    const fetchMock = vi.fn().mockReturnValueOnce(response)
    vi.stubGlobal('fetch', fetchMock)
    const get = vi.fn()
    const update = vi.fn()
    const onCardsImported = vi.fn()
    let api = { cards: { get, update } } as unknown as StudioApi
    const render = () => {
      hooks.cursor = 0
      return useCards({
        api, initialCardName: '', recordEdit: vi.fn(), onCardsImported, t: createTranslator('en-US'),
        runAction: action => action(),
      })
    }
    const file = new File(['image'], 'card.png', { type: 'image/png' })
    const pending = operation === 'upload'
      ? render().updateCardMedia('card', 'avatar', file)
      : render().importCards([file, file])
    api = { cards: { get: vi.fn(), update: vi.fn() } } as unknown as StudioApi
    render()
    resolveResponse(new Response(JSON.stringify({
      asset: { id: 'committed-asset' }, card: { id: 'committed-card', name: 'Imported' },
    }), { status: 200 }))
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(get).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(onCardsImported).not.toHaveBeenCalled()
  })

  it.each(['create', 'update', 'delete', 'macros'] as const)(
    'isolates the editor and late %s result after an API switch',
    async operation => {
      const card = (name: string): Card => ({
        id: 'same-id', name, version: 1, opening: { entries: [] }, settingLayer: { entries: [] },
        createdAt: '2026-09-23', updatedAt: '2026-09-23',
      })
      let resolveWrite!: (value: unknown) => void
      const write = new Promise(resolve => { resolveWrite = resolve })
      const recordEdit = vi.fn()
      const onCardsDeleted = vi.fn()
      let api = {
        cards: {
          list: async () => ({ cards: [card('Old API')] }),
          get: async () => ({ card: card('Old API') }),
          create: () => write, update: () => write, deleteMany: () => write,
        },
      } as unknown as StudioApi
      const render = () => {
        hooks.cursor = 0
        return useCards({
          api, initialCardName: '', recordEdit, onCardsDeleted, t: createTranslator('en-US'),
          runAction: action => action(),
        })
      }
      await render().refreshCards()
      await render().selectCard('same-id')
      const old = render()
      const pending = operation === 'create' ? old.createCard()
        : operation === 'update' ? old.updateCard({ preventDefault() {} } as FormEvent)
          : operation === 'delete' ? old.deleteCards(['same-id'], { includePromptResources: true })
            : old.updateCardMacros({ cardId: 'same-id', expectedVersion: 1, macros: { char: 'old' } })
      api = {
        cards: {
          list: async () => ({ cards: [card('New API')] }),
          get: async () => ({ card: card('New API') }),
        },
      } as unknown as StudioApi
      const switched = render()
      expect(switched.selectedCardId).toBeUndefined()
      expect(switched.selectedCardDetails).toBeUndefined()
      expect(switched.cardDraft).toEqual({ name: '', userName: '', description: '' })
      await switched.refreshCards()
      await render().selectCard('same-id')
      render().setCardDraft({ name: 'New draft', userName: '', description: '' })
      resolveWrite({
        card: card('Late old API'), deleted: true, cardIds: ['same-id'],
        mutation: { changesetId: 'old-source-commit' },
      })
      await pending
      const current = render()
      expect(current.cards[0]?.name).toBe('New API')
      expect(current.selectedCardId).toBe('same-id')
      expect(current.selectedCardDetails?.name).toBe('New API')
      expect(current.cardDraft.name).toBe('New draft')
      expect(recordEdit).not.toHaveBeenCalled()
      expect(onCardsDeleted).not.toHaveBeenCalled()
    },
  )

  it('hides the previous API list immediately and ignores its late refresh', async () => {
    const card = (name: string): Card => ({
      id: 'same-id', name, version: 1, opening: { entries: [] }, settingLayer: { entries: [] },
      createdAt: '2026-09-23', updatedAt: '2026-09-23',
    })
    let resolveOld!: (value: { cards: Card[] }) => void
    const oldResult = new Promise<{ cards: Card[] }>(resolve => { resolveOld = resolve })
    let api = {
      cards: { list: vi.fn().mockResolvedValueOnce({ cards: [card('Old API')] }).mockReturnValueOnce(oldResult) },
    } as unknown as StudioApi
    const render = () => {
      hooks.cursor = 0
      return useCards({
        api, initialCardName: '', recordEdit: vi.fn(), t: createTranslator('en-US'),
        runAction: action => action(),
      })
    }
    await render().refreshCards()
    expect(render().cards[0]?.name).toBe('Old API')
    const pending = render().refreshCards()
    api = { cards: { list: vi.fn().mockResolvedValue({ cards: [card('New API')] }) } } as unknown as StudioApi
    expect(render().cards).toEqual([])
    resolveOld({ cards: [card('Late old API')] })
    await pending
    expect(render().cards).toEqual([])
    await render().refreshCards()
    expect(render().cards[0]?.name).toBe('New API')
  })

  it.each(['new-selection', 'direct-selection', 'api-switch'] as const)(
    'does not publish a late card selection after %s',
    async change => {
      const card = (id: string): Card => ({
        id, name: id, version: 1, opening: { entries: [] }, settingLayer: { entries: [] },
        createdAt: '2026-09-23', updatedAt: '2026-09-23',
      })
      let resolveOld!: (value: { card: Card }) => void
      const oldResult = new Promise<{ card: Card }>(resolve => { resolveOld = resolve })
      const get = vi.fn(async (id: string) => id === 'old' ? oldResult : { card: card(id) })
      let api = { cards: { get } } as unknown as StudioApi
      const render = () => {
        hooks.cursor = 0
        return useCards({
          api, initialCardName: '', recordEdit: vi.fn(), t: createTranslator('en-US'),
          runAction: action => action(),
        })
      }
      const pending = render().selectCard('old')
      if (change === 'new-selection') await render().selectCard('new')
      else if (change === 'direct-selection') render().setSelectedCardId('new')
      else {
        api = { cards: { get: vi.fn() } } as unknown as StudioApi
        render()
      }
      resolveOld({ card: card('old') })
      await pending
      const current = render()
      expect(current.selectedCardId).toBe(change === 'api-switch' ? undefined : 'new')
      expect(current.selectedCardDetails?.id).not.toBe('old')
      expect(current.cardDraft.name).not.toBe('old')
    },
  )

  it.each(['deleted', 'other'] as const)('keeps a committed deletion after refresh failure with %s selected', async selectedId => {
    const failure = new Error('List refresh failed')
    const cards: Card[] = ['deleted', 'other'].map(id => ({
      id, name: id, version: 1, opening: { entries: [] }, settingLayer: { entries: [] },
      createdAt: '2026-09-23', updatedAt: '2026-09-23',
    }))
    const recordEdit = vi.fn()
    const deleteMany = vi.fn().mockResolvedValue({
      deleted: true, cardIds: ['deleted'], mutation: { changesetId: 'delete-commit' },
    })
    const api = {
      cards: {
        list: vi.fn().mockResolvedValueOnce({ cards }).mockRejectedValue(failure),
        get: vi.fn(async (id: string) => ({ card: cards.find(card => card.id === id)! })),
        deleteMany,
      },
    } as unknown as StudioApi
    const render = () => {
      hooks.cursor = 0
      return useCards({
        api, initialCardName: '', recordEdit, t: createTranslator('en-US'),
        runAction: action => action(),
      })
    }
    await render().refreshCards()
    await render().selectCard(selectedId)
    await expect(render().deleteCards(['deleted'])).rejects.toBe(failure)
    const current = render()
    expect(current.cards.map(card => card.id)).toEqual(['other'])
    expect(current.selectedCardId).toBe(selectedId === 'deleted' ? undefined : 'other')
    expect(current.selectedCardDetails?.id).toBe(selectedId === 'deleted' ? undefined : 'other')
    expect(recordEdit).toHaveBeenCalledWith(expect.objectContaining({ changesetId: 'delete-commit' }))
    expect(deleteMany).toHaveBeenCalledTimes(1)
  })

  it('retains a committed new card when the following list refresh fails', async () => {
    const failure = new Error('List refresh failed')
    const card: Card = {
      id: 'created-card', version: 1, name: 'New card',
      opening: { entries: [] }, settingLayer: { entries: [] },
      createdAt: '2026-09-23', updatedAt: '2026-09-23',
    }
    const recordEdit = vi.fn()
    const create = vi.fn().mockResolvedValue({ card, mutation: { changesetId: 'create-commit' } })
    const api = {
      cards: { create, list: vi.fn().mockRejectedValue(failure) },
    } as unknown as StudioApi
    const render = () => {
      hooks.cursor = 0
      return useCards({
        api, initialCardName: '', recordEdit, t: createTranslator('en-US'),
        runAction: action => action(),
      })
    }
    await expect(render().createCard()).rejects.toBe(failure)
    const current = render()
    expect(current.selectedCardId).toBe(card.id)
    expect(current.selectedCardDetails).toEqual(card)
    expect(current.selectedCard).toMatchObject({ id: card.id, version: 1, name: card.name })
    expect(current.cards[0]).not.toHaveProperty('opening')
    expect(current.cardDraft.name).toBe(card.name)
    expect(recordEdit).toHaveBeenCalledWith(expect.objectContaining({ changesetId: 'create-commit' }))
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('preserves rejection while reporting the original failure, including successful void actions', async () => {
    const operations = useAsyncOperations()
    const failure = new Error('Write rejected')
    await expect(operations.run('cards', async () => { throw failure })).rejects.toBe(failure)
    expect(hooks.dispatch).toHaveBeenLastCalledWith(expect.objectContaining({
      scope: 'cards', type: 'finish', error: 'Write rejected', recordError: true,
    }))
    await expect(operations.run('cards', async () => undefined)).resolves.toBeUndefined()
    await expect(operations.runReported('bootstrap', async () => { throw failure })).resolves.toBeUndefined()
    expect(hooks.dispatch).toHaveBeenCalledTimes(6)
  })

  it.each(['save', 'upload', 'import'] as const)('lets the %s caller retain its editor and observe failure', async operation => {
    const failure = new Error(`${operation} failed`)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(failure))
    const recordEdit = vi.fn()
    const api = {
      cards: {
        update: vi.fn().mockRejectedValue(failure),
        list: async () => ({ cards: [] }),
        get: async () => ({ card: {
          id: 'card', version: 1, name: 'Original', opening: { entries: [] }, settingLayer: { entries: [] },
          createdAt: '2026-09-23', updatedAt: '2026-09-23',
        } }),
      },
    } as unknown as StudioApi
    const render = () => {
      hooks.cursor = 0
      const operations = useAsyncOperations()
      return useCards({
        api, initialCardName: '', recordEdit, t: createTranslator('en-US'),
        runAction: action => operations.run('cards', action).then(() => undefined),
      })
    }
    let cards = render()
    await cards.selectCard('card')
    cards.setCardDraft({ name: 'Unsaved name', userName: 'User', description: 'Draft body' })
    cards = render()
    const closeEditor = vi.fn()
    const reportLocalError = vi.fn()
    const file = new File(['image'], 'card.png', { type: 'image/png' })
    const pending = operation === 'save'
      ? cards.updateCard({ preventDefault() {} } as FormEvent)
      : operation === 'upload'
        ? cards.updateCardMedia('card', 'avatar', file)
        : cards.importCards([file])
    await pending.then(closeEditor).catch(reportLocalError)
    expect(closeEditor).not.toHaveBeenCalled()
    expect(reportLocalError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining(failure.message) }))
    expect(recordEdit).not.toHaveBeenCalled()
    expect(render().cardDraft).toEqual({ name: 'Unsaved name', userName: 'User', description: 'Draft body' })
    expect(hooks.dispatch).toHaveBeenLastCalledWith(expect.objectContaining({
      scope: 'cards', type: 'finish', error: expect.stringContaining(failure.message),
    }))
  })
})
