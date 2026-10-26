import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useCards } from '../../../apps/studio-client/src/features/cards/model/use-cards.js'
import { useCharacterProfileEditor } from '../../../apps/studio-client/src/features/cards/model/use-character-profile-editor.js'
type Card = Awaited<ReturnType<StudioApi['cards']['get']>>['card']
import type { StudioApi } from '../../../apps/studio-client/src/shared/api/studio-api.js'
import { createTranslator } from '../../../apps/studio-client/src/shared/i18n/index.js'

const hooks = vi.hoisted(() => ({
  cursor: 0, values: [] as unknown[], effects: [] as (() => void)[], dirty: false,
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn() } }))
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = hooks.cursor++
    if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? initial() : initial
    return [hooks.values[index], (update: unknown) => {
      const next = typeof update === 'function' ? update(hooks.values[index]) : update
      if (!Object.is(next, hooks.values[index])) hooks.dirty = true
      hooks.values[index] = next
    }]
  },
  useRef: (initial: unknown) => {
    const index = hooks.cursor++
    if (!(index in hooks.values)) hooks.values[index] = { current: initial }
    return hooks.values[index]
  },
  useCallback: (callback: unknown, deps: unknown[]) => {
    const index = hooks.cursor++
    const previous = hooks.values[index] as { deps: unknown[]; callback: unknown } | undefined
    if (!previous || deps.some((dep, i) => !Object.is(dep, previous.deps[i]))) {
      hooks.values[index] = { deps, callback }
    }
    return (hooks.values[index] as { callback: unknown }).callback
  },
  useEffect: (effect: () => void | (() => void), deps: unknown[]) => {
    const index = hooks.cursor++
    const previous = hooks.values[index] as { deps: unknown[]; cleanup?: () => void } | undefined
    if (previous && deps.every((dep, i) => Object.is(dep, previous.deps[i]))) return
    const entry = { deps, cleanup: undefined as (() => void) | undefined }
    hooks.values[index] = entry
    hooks.effects.push(() => { previous?.cleanup?.(); entry.cleanup = effect() || undefined })
  },
}))

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
  let api = {
    cards: { get, list, update },
  } as unknown as StudioApi
  const render = () => {
    for (let attempt = 0; attempt < 10; attempt++) {
      hooks.cursor = 0
      hooks.dirty = false
      const result = useCards({
        api, initialCardName: '', recordEdit: vi.fn(), t: createTranslator('en-US'),
        runAction: async action => {
          try { await action() } catch (error) { failures.push(error); throw error }
        },
      })
      for (const effect of hooks.effects.splice(0)) effect()
      if (!hooks.dirty) return result
    }
    throw new Error('Hook effects did not settle')
  }
  const unmount = () => {
    for (const value of hooks.values) (value as { cleanup?: () => void } | undefined)?.cleanup?.()
  }
  return { render, get, list, update, failures, unmount, setCards: (value: Card[]) => { cards = value },
    setApi: (next: StudioApi) => { api = next },
    select: async (id: string) => {
      render().setSelectedCardId(id)
      render()
      await Promise.resolve()
      await Promise.resolve()
      return render()
    },
  }
}

beforeEach(() => { hooks.cursor = 0; hooks.values = []; hooks.effects = []; hooks.dirty = false })

describe('Card editor effect lifecycle', () => {
  it('preserves candidate IDs when editing titles and content, adding and deleting alternatives', async () => {
    let selected = { ...card('a', 'Original'), opening: {
      id: 'root-opening', title: 'Root', content: 'Root content',
      alternatives: [{ id: 'alternate-a', title: 'A', content: 'A content' }, { id: 'alternate-b', title: 'B', content: 'B content' }],
    } }
    const update = vi.fn(async (patch: Parameters<Parameters<typeof useCharacterProfileEditor>[0]['onUpdateCardProfile']>[0]) => {
      selected = { ...selected, ...patch, version: selected.version + 1 } as typeof selected
    })
    const render = () => {
      for (let attempt = 0; attempt < 10; attempt++) {
        hooks.cursor = 0
        hooks.dirty = false
        const result = useCharacterProfileEditor({ selected, onUpdateCardProfile: update,
          refreshDetail: async () => {}, onRefreshCards: async () => {} })
        for (const effect of hooks.effects.splice(0)) effect()
        if (!hooks.dirty) return result
      }
      throw new Error('Profile effects did not settle')
    }
    render().setOpeningTitleDraft('New root title')
    await render().handleOpeningBlur('title')
    expect(selected.opening).toMatchObject({ id: 'root-opening', title: 'New root title', content: 'Root content' })
    render().setActiveOpeningIndex(1)
    render().setOpeningDraft('Edited A')
    await render().handleOpeningBlur()
    expect(selected.opening.alternatives[0]).toEqual({ id: 'alternate-a', title: 'A', content: 'Edited A' })
    await render().handleAddAlternative()
    const added = selected.opening.alternatives[2]
    expect(added.id).toBeTruthy()
    expect(['root-opening', 'alternate-a', 'alternate-b']).not.toContain(added.id)
    expect(added.content).toBe('')
    expect(render().activeOpening?.id).toBe(added.id)
    render().setActiveOpeningIndex(1)
    await render().handleDeleteAlternative()
    expect(selected.opening.alternatives.map(candidate => candidate.id)).toEqual(['alternate-b', added.id])
    expect(selected.opening.id).toBe('root-opening')
  })

  it('saves opening messages through the profile editor with the original Card version', async () => {
    const f = fixture()
    await f.render().refreshCards()
    const opening = { id: 'root-opening', content: 'Welcome, {{user}}.' }
    await f.render().updateCardProfile({
      cardId: 'a', expectedVersion: 1, name: 'Original', userName: '', description: '', opening,
    })
    expect(f.update).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      cardId: 'a', expectedVersion: 1, opening,
    }))
  })

  it.each(['resolve', 'reject'] as const)('retains a saved detail when an earlier background read later %s', async outcome => {
    const f = fixture()
    await f.render().refreshCards()
    await f.select('b')
    let resolve!: (value: { card: Card }) => void
    let reject!: (error: Error) => void
    f.setCards([card('a', 'Original'), card('b', 'External B', 2)])
    f.get.mockReturnValueOnce(new Promise((accept, fail) => { resolve = accept; reject = fail }))
    await f.render().refreshCards()
    f.render()
    await f.render().updateCardProfile({ cardId: 'b', expectedVersion: 2, name: 'Saved B', userName: '', description: '' })
    if (outcome === 'resolve') resolve({ card: card('b', 'External B', 2) })
    else reject(new Error('Background read failed'))
    await Promise.resolve()
    await Promise.resolve()
    expect(f.render().selectedCardDetails).toMatchObject({ id: 'b', name: 'Saved B', version: 3 })
    if (outcome === 'reject') expect(f.failures).toContainEqual(new Error('Background read failed'))
  })

  it('does not replace another selected Card when a profile save completes', async () => {
    const f = fixture()
    await f.render().refreshCards()
    await f.select('a')
    let resolve!: (value: Awaited<ReturnType<StudioApi['cards']['update']>>) => void
    f.update.mockReturnValueOnce(new Promise(accept => { resolve = accept }))
    const pending = f.render().updateCardProfile({ cardId: 'a', expectedVersion: 1, name: 'Saved A', userName: '', description: '' })
    await f.select('b')
    resolve({ card: card('a', 'Saved A', 2), mutation: { changesetId: 'save' } })
    await pending
    const state = f.render()
    expect(state.selectedCardId).toBe('b')
    expect(state.selectedCardDetails).toMatchObject({ id: 'b', name: 'Other' })
    expect(state.cards.find(item => item.id === 'a')).toMatchObject({ version: 2, name: 'Saved A' })
  })

  it('preserves the caller CAS baseline after a remote refresh', async () => {
    const f = fixture()
    await f.render().refreshCards()
    const pendingPatch = { cardId: 'a', expectedVersion: 1, name: 'Local unsaved', userName: '', description: '' }
    f.setCards([card('a', 'External update', 2)])
    await f.render().refreshCards()
    await expect(f.render().updateCardProfile(pendingPatch)).rejects.toThrow('Card version conflict')
    expect(f.update).toHaveBeenCalledWith(pendingPatch)
    expect(f.render().selectedCard).toMatchObject({ name: 'External update', version: 2 })
  })

  it('publishes the saved version without depending on a catalog refresh', async () => {
    const f = fixture()
    await f.render().refreshCards()
    await f.select('a')
    f.list.mockRejectedValueOnce(new Error('List failed'))
    await f.render().updateCardProfile({ cardId: 'a', expectedVersion: 1, name: 'Saved edit', userName: '', description: '' })
    const saved = f.render().selectedCard!
    expect(saved).toMatchObject({ name: 'Saved edit', version: 2 })
    await f.render().updateCardProfile({ cardId: 'a', expectedVersion: saved.version, name: saved.name, userName: '', description: 'Next edit' })
    expect(f.update).toHaveBeenLastCalledWith(expect.objectContaining({ expectedVersion: 2, description: 'Next edit' }))
    expect(f.list).toHaveBeenCalledTimes(1)
  })

  it.each(['selection', 'api', 'unmount'] as const)('does not publish a late navigation detail after %s changes', async change => {
    const f = fixture()
    await f.render().refreshCards()
    await f.select('a')
    let resolve!: (value: { card: Card }) => void
    f.get.mockReturnValueOnce(new Promise(accept => { resolve = accept }))
    f.render().setSelectedCardId('b')
    f.render()
    if (change === 'selection') await f.select('a')
    else if (change === 'api') {
      f.setApi({ cards: { list: async () => ({ cards: [] }) } } as unknown as StudioApi)
      f.render()
    } else f.unmount()
    hooks.dirty = false
    resolve({ card: card('b', 'Late') })
    await Promise.resolve()
    await Promise.resolve()
    expect(hooks.dirty).toBe(false)
    if (change !== 'unmount') {
      expect(f.render().selectedCardDetails?.id).not.toBe('b')
      expect(f.render().selectedCardId).toBe(change === 'selection' ? 'a' : undefined)
    }
  })
})
