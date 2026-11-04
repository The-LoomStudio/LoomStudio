import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAsyncOperations } from '../../../apps/studio-client/src/shared/hooks/use-async-operations.js'
import { useCards } from '../../../apps/studio-client/src/features/cards/model/use-cards.js'
import type { StudioApi } from '../../../apps/studio-client/src/shared/api/studio-api.js'
type Card = Awaited<ReturnType<StudioApi['cards']['get']>>['card']
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
  it.each([
    ['import', 'list'], ['import', 'related'], ['fork', 'list'], ['fork', 'related'],
  ] as const)('retains a committed %s when %s refresh fails', async (operation, stage) => {
    const card: Card = {
      id: 'imported-card', artifactId: 'work-imported', version: 3, name: 'Imported', preset: {}, opening: { id: 'root-opening', content: '' }, lore: { entries: [] },
      createdAt: '2026-09-23', updatedAt: '2026-09-23',
    }
    const failure = new Error('Refresh failed')
    const list = stage === 'list'
      ? vi.fn().mockRejectedValue(failure)
      : vi.fn().mockResolvedValue({ cards: [card] })
    const onCardsImported = vi.fn().mockRejectedValue(failure)
    const update = vi.fn().mockResolvedValue({ card: { ...card, version: 4 }, mutation: { changesetId: 'save' } })
    const fork = vi.fn().mockResolvedValue({ card })
    const api = { cards: { list, update, fork } } as unknown as StudioApi
    const fetch = vi.fn(async () => new Response(JSON.stringify({ card })))
    vi.stubGlobal('fetch', fetch)
    const render = () => {
      hooks.cursor = 0
      return useCards({
        api, initialCardName: '', recordEdit: vi.fn(), onCardsImported, t: createTranslator('en-US'),
        runAction: action => action(),
      })
    }
    const pending = operation === 'import'
      ? render().importCards([new File(['image'], 'card.png')])
      : render().forkCard('original', 1)
    if (operation === 'import') await expect(pending).rejects.toThrow('Imported characters are preserved: Refresh failed')
    else await expect(pending).rejects.toBe(failure)
    const current = render()
    expect(current.cards).toEqual([expect.objectContaining({ id: card.id, version: card.version })])
    expect(current.selectedCardId).toBe(card.id)
    expect(current.selectedCardDetails).toEqual(card)
    if (operation === 'import') expect(fetch).toHaveBeenCalledOnce()
    else expect(fork).toHaveBeenCalledExactlyOnceWith({ cardId: 'original', expectedVersion: 1 })
    list.mockResolvedValue({ cards: [{ ...card, version: 4 }] })
    await current.updateCardProfile({ cardId: card.id, expectedVersion: card.version, name: card.name, userName: '', description: '' })
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ cardId: card.id, expectedVersion: 3 }))
  })

  it('preserves per-file failures alongside post-import refresh failures', async () => {
    const card: Card = { id: 'imported', version: 1, name: 'Imported', artifactId: 'fixture-artifact', preset: {}, opening: { id: 'root-opening', content: '' }, lore: { entries: [] }, createdAt: '', updatedAt: '' }
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ card })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'Invalid card' } }), { status: 400 })))
    const api = { cards: { list: vi.fn().mockRejectedValue(new Error('Refresh failed')) } } as unknown as StudioApi
    const render = () => {
      hooks.cursor = 0
      return useCards({ api, initialCardName: '', recordEdit: vi.fn(), t: createTranslator('en-US'), runAction: action => action() })
    }
    await expect(render().importCards([new File([''], 'good.png'), new File([''], 'bad.png')])).rejects.toThrow(
      'bad.png: Invalid card\nCatalog refresh after import failed. Imported characters are preserved: Refresh failed',
    )
    expect(render().cards.map(item => item.id)).toContain('imported')
  })
  it.each(['create', 'import', 'fork'] as const)('does not replace a later selection when %s finishes', async operation => {
    const card = (id: string): Card => ({
      id, name: id, version: 1, artifactId: 'fixture-artifact', preset: {}, opening: { id: 'root-opening', content: '' }, lore: { entries: [] },
      createdAt: '2026-09-23', updatedAt: '2026-09-23',
    })
    let release!: () => void
    const pendingWrite = new Promise<void>(resolve => { release = resolve })
    const created = card('created')
    const api = {
      cards: {
        create: async () => { await pendingWrite; return { card: created, mutation: { changesetId: 'commit' } } },
        fork: async () => { await pendingWrite; return { card: created } },
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
      : operation === 'fork' ? render().forkCard('original', 1)
      : render().importCards([new File(['image'], 'card.png', { type: 'image/png' })])
    render().setSelectedCardId('other')
    release()
    await pending
    const current = render()
    expect(current.cards.some(card => card.id === 'created')).toBe(true)
    expect(current.selectedCardId).toBe('other')
  })

  it.each([
    ['macros', false], ['macros', true], ['state', false], ['state', true],
  ] as const)('refreshes an overlapping list after %s commits (initial=%s)', async (operation, initial) => {
    const original: Card = {
      id: 'card', name: 'Card', version: 1, artifactId: 'fixture-artifact', preset: {}, opening: { id: 'root-opening', content: '' }, lore: { entries: [] },
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
      id, name: id, version: 1, artifactId: 'fixture-artifact', preset: {}, opening: { id: 'root-opening', content: '' }, lore: { entries: [] },
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
    render().setSelectedCardId('a')
    const pending = operation === 'media'
      ? render().updateCardMedia('a', 'avatar', new File(['image'], 'a.png', { type: 'image/png' }))
      : render().replaceCardPromptResources('a', ['resource'], cards[0]!.version)
    render().setSelectedCardId('b')
    resolve({ card: { ...cards[0]!, version: 2, media: { avatarAssetId: 'asset' }, promptResourceIds: ['resource'] }, mutation: { changesetId: 'commit' } })
    await expect(pending).rejects.toBe(failure)
    const current = render()
    expect(current.cards.find(item => item.id === 'a')?.version).toBe(2)
    expect(current.selectedCardId).toBe('b')
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
        id: 'same-id', name, version: 1, artifactId: 'fixture-artifact', preset: {}, opening: { id: 'root-opening', content: '' }, lore: { entries: [] },
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
      render().setSelectedCardId('same-id')
      const old = render()
      const pending = operation === 'create' ? old.createCard()
        : operation === 'update' ? old.updateCardProfile({ cardId: 'same-id', expectedVersion: 1, name: 'Saved', userName: '', description: '' })
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
      await switched.refreshCards()
      render().setSelectedCardId('same-id')
      resolveWrite({
        card: card('Late old API'), deleted: true, cardIds: ['same-id'],
        mutation: { changesetId: 'old-source-commit' },
      })
      await pending
      const current = render()
      expect(current.cards[0]?.name).toBe('New API')
      expect(current.selectedCardId).toBe('same-id')
      expect(current.selectedCard?.name).toBe('New API')
      expect(recordEdit).not.toHaveBeenCalled()
      expect(onCardsDeleted).not.toHaveBeenCalled()
    },
  )

  it('hides the previous API list immediately and ignores its late refresh', async () => {
    const card = (name: string): Card => ({
      id: 'same-id', name, version: 1, artifactId: 'fixture-artifact', preset: {}, opening: { id: 'root-opening', content: '' }, lore: { entries: [] },
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

  it.each(['deleted', 'other'] as const)('keeps a committed deletion after refresh failure with %s selected', async selectedId => {
    const failure = new Error('List refresh failed')
    const cards: Card[] = ['deleted', 'other'].map(id => ({
      id, name: id, version: 1, artifactId: 'fixture-artifact', preset: {}, opening: { id: 'root-opening', content: '' }, lore: { entries: [] },
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
    render().setSelectedCardId(selectedId)
    const onCommitted = vi.fn((deletedIds: readonly string[]) => {
      expect(deletedIds).toEqual(['deleted'])
      expect(render().cards.map(card => card.id)).toEqual(['other'])
      expect(render().selectedCardId).toBe(selectedId === 'deleted' ? undefined : 'other')
    })
    await expect(render().deleteCards(['deleted'], undefined, onCommitted)).rejects.toBe(failure)
    expect(onCommitted).toHaveBeenCalledExactlyOnceWith(['deleted'])
    const current = render()
    expect(current.cards.map(card => card.id)).toEqual(['other'])
    expect(current.selectedCardId).toBe(selectedId === 'deleted' ? undefined : 'other')
    expect(recordEdit).toHaveBeenCalledWith(expect.objectContaining({ changesetId: 'delete-commit' }))
    expect(deleteMany).toHaveBeenCalledTimes(1)
  })

  it('retains a committed new card when the following list refresh fails', async () => {
    const failure = new Error('List refresh failed')
    const card: Card = {
      id: 'created-card', version: 1, name: 'New card',
      artifactId: 'fixture-artifact', preset: {}, opening: { id: 'root-opening', content: '' }, lore: { entries: [] },
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
          id: 'card', version: 1, name: 'Original', artifactId: 'fixture-artifact', preset: {}, opening: { id: 'root-opening', content: '' }, lore: { entries: [] },
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
    cards.setSelectedCardId('card')
    cards = render()
    const closeEditor = vi.fn()
    const reportLocalError = vi.fn()
    const file = new File(['image'], 'card.png', { type: 'image/png' })
    const pending = operation === 'save'
      ? cards.updateCardProfile({ cardId: 'card', expectedVersion: 1, name: 'Unsaved name', userName: 'User', description: 'Draft body' })
      : operation === 'upload'
        ? cards.updateCardMedia('card', 'avatar', file)
        : cards.importCards([file])
    await pending.then(closeEditor).catch(reportLocalError)
    expect(closeEditor).not.toHaveBeenCalled()
    expect(reportLocalError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining(failure.message) }))
    expect(recordEdit).not.toHaveBeenCalled()
    expect(hooks.dispatch).toHaveBeenLastCalledWith(expect.objectContaining({
      scope: 'cards', type: 'finish', error: expect.stringContaining(failure.message),
    }))
  })
})
