// @vitest-environment happy-dom
import { defaultScheduler, notifyManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCards } from '../../../apps/studio-client/src/features/cards/model/use-cards.js'
import { useCharacterProfileEditor } from '../../../apps/studio-client/src/features/cards/model/use-character-profile-editor.js'
import type { StudioApi } from '../../../apps/studio-client/src/shared/api/studio-api.js'
import { createTranslator } from '../../../apps/studio-client/src/shared/i18n/index.js'
import { renderHook } from '../../support/client/render-hook.js'

type Card = Awaited<ReturnType<StudioApi['cards']['get']>>['card']

vi.mock('sonner', () => ({ toast: { success: vi.fn() } }))

class StubEventSource extends EventTarget {
  static OPEN = 1
  static CLOSED = 2
  readyState = 0
  close() { this.readyState = 2 }
}

const cleanups: Array<() => void> = []

beforeEach(() => {
  notifyManager.setScheduler(queueMicrotask)
  vi.stubGlobal('EventSource', StubEventSource)
})

afterEach(() => {
  cleanups.splice(0).forEach(cleanup => cleanup())
  notifyManager.setScheduler(defaultScheduler)
  vi.unstubAllGlobals()
})

function card(id: string, name: string, version = 1): Card {
  return {
    id, name, version, artifactId: 'fixture-artifact', preset: {}, opening: { id: 'root-opening', content: '' }, lore: { entries: [] },
    createdAt: '2026-09-23', updatedAt: '2026-09-23',
  }
}

function fixture() {
  const failures: unknown[] = []
  let cards = [card('a', 'Original'), card('b', 'Other')]
  const get = vi.fn<StudioApi['cards']['get']>(async id => ({ card: cards.find(item => item.id === id)! }))
  const list = vi.fn<StudioApi['cards']['list']>(async () => ({ cards }))
  const update = vi.fn<StudioApi['cards']['update']>(async input => {
    const current = cards.find(item => item.id === input.cardId)!
    if (input.expectedVersion !== current.version) throw new Error('Card version conflict')
    const updated: Card = {
      ...current,
      name: input.name ?? current.name,
      userName: input.userName ?? current.userName,
      description: input.description ?? current.description,
      version: current.version + 1,
    }
    cards = cards.map(item => item.id === updated.id ? updated : item)
    return { card: updated, mutation: { changesetId: `commit-${updated.version}` } }
  })
  let api = { cards: { get, list, update } } as unknown as StudioApi
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const t = createTranslator('en-US')
  const recordEdit = vi.fn()
  const runAction = async (action: () => Promise<void>) => {
    try { await action() } catch (error) { failures.push(error); throw error }
  }
  const hook = renderHook(
    () => useCards({ api, initialCardName: '', recordEdit, t, runAction }),
    child => createElement(QueryClientProvider, { client }, child),
  )
  let unmounted = false
  const unmount = () => {
    if (unmounted) return
    unmounted = true
    hook.unmount()
    client.clear()
  }
  cleanups.push(unmount)

  return {
    render: () => {
      if (!unmounted) hook.rerender()
      return hook.current
    },
    get, list, update, failures, unmount,
    setCards: (value: Card[]) => { cards = value },
    setApi: (next: StudioApi) => { api = next; hook.rerender() },
    select: async (id: string) => {
      act(() => hook.current.setSelectedCardId(id))
      await vi.waitFor(() => expect(hook.current.selectedCardDetails?.id).toBe(id))
      return hook.current
    },
  }
}

describe('Card editor effect lifecycle', () => {
  it('shares an in-flight detail read and serves cached reads until a fresh read is requested', async () => {
    const view = fixture()
    await vi.waitFor(() => expect(view.render().cards).toHaveLength(2))
    view.get.mockClear()

    let resolve!: (value: { card: Card }) => void
    view.get.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    const first = view.render().readCardDetails('b')
    const deduped = view.render().readCardDetails('b')
    expect(view.get).toHaveBeenCalledTimes(1)

    resolve({ card: card('b', 'Older B') })
    await expect(Promise.all([first, deduped])).resolves.toEqual([
      { card: card('b', 'Older B') },
      { card: card('b', 'Older B') },
    ])

    await expect(view.render().readCardDetails('b')).resolves.toEqual({ card: card('b', 'Older B') })
    expect(view.get).toHaveBeenCalledTimes(1)

    await expect(view.render().readCardDetails('b', true)).resolves.toEqual({ card: card('b', 'Other') })
    expect(view.get).toHaveBeenCalledTimes(2)
  })

  it('preserves candidate IDs when editing titles and content, adding and deleting alternatives', async () => {
    let selected = { ...card('a', 'Original'), opening: {
      id: 'root-opening', title: 'Root', content: 'Root content',
      alternatives: [{ id: 'alternate-a', title: 'A', content: 'A content' }, { id: 'alternate-b', title: 'B', content: 'B content' }],
    } }
    const update = vi.fn(async (patch: Parameters<Parameters<typeof useCharacterProfileEditor>[0]['onUpdateCardProfile']>[0]) => {
      selected = { ...selected, ...patch, version: selected.version + 1 } as typeof selected
    })
    const hook = renderHook(() => useCharacterProfileEditor({
      selected, onUpdateCardProfile: update, refreshDetail: async () => {}, onRefreshCards: async () => {},
    }))
    cleanups.push(() => hook.unmount())

    act(() => hook.current.setOpeningTitleDraft('New root title'))
    await act(async () => { await hook.current.handleOpeningBlur('title') })
    expect(selected.opening).toMatchObject({ id: 'root-opening', title: 'New root title', content: 'Root content' })
    selected = { ...selected }
    hook.rerender()

    act(() => hook.current.setActiveOpeningIndex(1))
    act(() => hook.current.setOpeningDraft('Edited A'))
    await act(async () => { await hook.current.handleOpeningBlur() })
    expect(selected.opening.alternatives[0]).toEqual({ id: 'alternate-a', title: 'A', content: 'Edited A' })

    await act(async () => { await hook.current.handleAddAlternative() })
    const added = selected.opening.alternatives[2]
    expect(added.id).toBeTruthy()
    expect(['root-opening', 'alternate-a', 'alternate-b']).not.toContain(added.id)
    expect(added.content).toBe('')
    expect(hook.current.activeOpening?.id).toBe(added.id)

    act(() => hook.current.setActiveOpeningIndex(1))
    await act(async () => { await hook.current.handleDeleteAlternative() })
    expect(selected.opening.alternatives.map(candidate => candidate.id)).toEqual(['alternate-b', added.id])
    expect(selected.opening.id).toBe('root-opening')
  })

  it('saves opening messages through the profile editor with the original Card version', async () => {
    const f = fixture()
    await act(async () => { await f.render().refreshCards() })
    const opening = { id: 'root-opening', content: 'Welcome, {{user}}.' }
    await act(async () => {
      await f.render().updateCardProfile({
        cardId: 'a', expectedVersion: 1, name: 'Original', userName: '', description: '', opening,
      })
    })
    expect(f.update).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      cardId: 'a', expectedVersion: 1, opening,
    }))
  })

  it.each(['resolve', 'reject'] as const)('retains a saved detail when an earlier background read later %s', async outcome => {
    const f = fixture()
    await act(async () => { await f.render().refreshCards() })
    await f.select('b')
    let resolve!: (value: { card: Card }) => void
    let reject!: (error: Error) => void
    f.setCards([card('a', 'Original'), card('b', 'External B', 2)])
    f.get.mockReturnValueOnce(new Promise((accept, fail) => { resolve = accept; reject = fail }))
    const background = f.render().readCardDetails('b', true).catch(error => error)
    await act(async () => {
      await f.render().updateCardProfile({ cardId: 'b', expectedVersion: 2, name: 'Saved B', userName: '', description: '' })
    })
    if (outcome === 'resolve') resolve({ card: card('b', 'External B', 2) })
    else reject(new Error('Background read failed'))
    await background
    await act(async () => {})
    expect(f.render().selectedCardDetails).toMatchObject({ id: 'b', name: 'Saved B', version: 3 })
  })

  it('does not replace another selected Card when a profile save completes', async () => {
    const f = fixture()
    await act(async () => { await f.render().refreshCards() })
    await f.select('a')
    let resolve!: (value: Awaited<ReturnType<StudioApi['cards']['update']>>) => void
    f.update.mockReturnValueOnce(new Promise(accept => { resolve = accept }))
    let pending!: Promise<void>
    act(() => { pending = f.render().updateCardProfile({ cardId: 'a', expectedVersion: 1, name: 'Saved A', userName: '', description: '' }) })
    await f.select('b')
    resolve({ card: card('a', 'Saved A', 2), mutation: { changesetId: 'save' } })
    await act(async () => { await pending })
    const state = f.render()
    expect(state.selectedCardId).toBe('b')
    expect(state.selectedCardDetails).toMatchObject({ id: 'b', name: 'Other' })
    expect(state.cards.find(item => item.id === 'a')).toMatchObject({ version: 2, name: 'Saved A' })
  })

  it('preserves the caller CAS baseline after a remote refresh', async () => {
    const f = fixture()
    await act(async () => { await f.render().refreshCards() })
    const pendingPatch = { cardId: 'a', expectedVersion: 1, name: 'Local unsaved', userName: '', description: '' }
    f.setCards([card('a', 'External update', 2)])
    await act(async () => { await f.render().refreshCards() })
    await act(async () => {
      await expect(f.render().updateCardProfile(pendingPatch)).rejects.toThrow('Card version conflict')
    })
    expect(f.update).toHaveBeenCalledWith(pendingPatch)
    expect(f.render().selectedCard).toMatchObject({ name: 'External update', version: 2 })
  })

  it('publishes the saved version without depending on a catalog refresh', async () => {
    const f = fixture()
    await act(async () => { await f.render().refreshCards() })
    await f.select('a')
    f.list.mockRejectedValueOnce(new Error('List failed'))
    await act(async () => {
      await f.render().updateCardProfile({ cardId: 'a', expectedVersion: 1, name: 'Saved edit', userName: '', description: '' })
    })
    const saved = f.render().selectedCard!
    expect(saved).toMatchObject({ name: 'Saved edit', version: 2 })
    await act(async () => {
      await f.render().updateCardProfile({ cardId: 'a', expectedVersion: saved.version, name: saved.name, userName: '', description: 'Next edit' })
    })
    expect(f.update).toHaveBeenLastCalledWith(expect.objectContaining({ expectedVersion: 2, description: 'Next edit' }))
    expect(f.list).toHaveBeenCalledTimes(1)
  })

  it.each(['selection', 'api', 'unmount'] as const)('does not publish a late navigation detail after %s changes', async change => {
    const f = fixture()
    await act(async () => { await f.render().refreshCards() })
    await f.select('a')
    let resolve!: (value: { card: Card }) => void
    f.get.mockReturnValueOnce(new Promise(accept => { resolve = accept }))
    act(() => f.render().setSelectedCardId('b'))
    if (change === 'selection') await f.select('a')
    else if (change === 'api') {
      act(() => f.setApi({ cards: { list: async () => ({ cards: [] }) } } as unknown as StudioApi))
      await act(async () => {})
    } else f.unmount()
    resolve({ card: card('b', 'Late') })
    await act(async () => {})
    if (change !== 'unmount') {
      expect(f.render().selectedCardDetails?.id).not.toBe('b')
      expect(f.render().selectedCardId).toBe(change === 'selection' ? 'a' : undefined)
    }
  })
})
