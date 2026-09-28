import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useCards } from '../../../apps/studio-client/src/features/cards/model/use-cards.js'
import type { Card } from '../../../apps/studio-client/src/entities/index.js'
import type { StudioApi } from '../../../apps/studio-client/src/shared/api/studio-api.js'
import { createTranslator } from '../../../apps/studio-client/src/shared/i18n/index.js'
import type { FormEvent } from 'react'

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
    id, name, version, opening: { entries: [] }, settingLayer: { entries: [] },
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
  const api = {
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
  return { render, get, list, update, failures, unmount, setCards: (value: Card[]) => { cards = value } }
}

beforeEach(() => { hooks.cursor = 0; hooks.values = []; hooks.effects = []; hooks.dirty = false })

describe('Card editor effect lifecycle', () => {
  it.each(['resolve', 'reject'] as const)('retains a saved detail when an earlier background read later %s', async outcome => {
    const f = fixture()
    await f.render().refreshCards()
    let state = f.render()
    let resolve!: (value: { card: Card }) => void
    let reject!: (error: Error) => void
    f.get.mockReturnValueOnce(new Promise((accept, fail) => { resolve = accept; reject = fail }))
    state.setSelectedCardId('b')
    f.render()
    await f.render().selectCard('b')
    state = f.render()
    state.setCardDraft({ ...state.cardDraft, name: 'Saved B' })
    await f.render().updateCard({ preventDefault() {} } as FormEvent)
    if (outcome === 'resolve') resolve({ card: card('b', 'Old B', 1) })
    else reject(new Error('Background read failed'))
    await Promise.resolve()
    await Promise.resolve()
    expect(f.render().selectedCardDetails).toMatchObject({ id: 'b', name: 'Saved B', version: 2 })
    if (outcome === 'reject') expect(f.failures).toContainEqual(new Error('Background read failed'))
  })

  it.each(['edit', 'switch'] as const)('retains a newer %s while an earlier save completes', async action => {
    const f = fixture()
    await f.render().refreshCards()
    let state = f.render()
    state.setCardDraft({ ...state.cardDraft, name: 'First save' })
    let resolve!: (value: Awaited<ReturnType<StudioApi['cards']['update']>>) => void
    f.update.mockReturnValueOnce(new Promise(accept => { resolve = accept }))
    const pending = f.render().updateCard({ preventDefault() {} } as FormEvent)
    state = f.render()
    if (action === 'edit') state.setCardDraft({ ...state.cardDraft, name: 'New unsaved input' })
    else state.setSelectedCardId('b')
    f.render()
    const saved = card('a', 'First save', 2)
    f.setCards([saved, card('b', 'Other')])
    resolve({ card: saved, mutation: { changesetId: 'first-save' } })
    await pending
    state = f.render()
    expect(state.selectedCardId).toBe(action === 'edit' ? 'a' : 'b')
    expect(state.cardDraft.name).toBe(action === 'edit' ? 'New unsaved input' : 'Other')
    if (action === 'edit') {
      await state.updateCard({ preventDefault() {} } as FormEvent)
      expect(f.update).toHaveBeenLastCalledWith(expect.objectContaining({ expectedVersion: 2, name: 'New unsaved input' }))
    }
  })

  it('saves a dirty draft against its original version after a remote refresh', async () => {
    const f = fixture()
    await f.render().refreshCards()
    let state = f.render()
    state.setCardDraft({ ...state.cardDraft, name: 'Local unsaved' })
    f.setCards([card('a', 'External update', 2)])
    await f.render().refreshCards()
    state = f.render()
    await expect(state.updateCard({ preventDefault() {} } as FormEvent)).rejects.toThrow('Card version conflict')
    expect(f.update).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 1, name: 'Local unsaved' }))
    expect(f.render().cardDraft.name).toBe('Local unsaved')
  })

  it('advances the saved baseline even if the following refresh fails', async () => {
    const f = fixture()
    await f.render().refreshCards()
    let state = f.render()
    state.setCardDraft({ ...state.cardDraft, name: 'Saved edit' })
    f.list.mockRejectedValueOnce(new Error('List failed'))
    await expect(f.render().updateCard({ preventDefault() {} } as FormEvent)).rejects.toThrow('List failed')
    state = f.render()
    expect(state.selectedCard).toMatchObject({ name: 'Saved edit', version: 2 })
    state.setCardDraft({ ...state.cardDraft, description: 'Next edit' })
    await f.render().updateCard({ preventDefault() {} } as FormEvent)
    expect(f.update).toHaveBeenLastCalledWith(expect.objectContaining({ expectedVersion: 2, description: 'Next edit' }))
  })

  it.each([false, true])('refreshes a pristine draft but retains dirty input (dirty=%s)', async dirty => {
    const f = fixture()
    await f.render().refreshCards()
    let state = f.render()
    expect(state.cardDraft.name).toBe('Original')
    if (dirty) {
      state.setCardDraft({ ...state.cardDraft, name: 'Local unsaved' })
      state = f.render()
    }
    f.setCards([card('a', 'External update', 2), card('b', 'Other')])
    await state.refreshCards()
    state = f.render()
    expect(state.selectedCard?.name).toBe('External update')
    expect(state.cardDraft.name).toBe(dirty ? 'Local unsaved' : 'External update')
    state.setSelectedCardId('b')
    expect(f.render().cardDraft.name).toBe('Other')
  })

  it('does not publish a pending explicit selection after cleanup', async () => {
    const f = fixture()
    await f.render().refreshCards()
    const state = f.render()
    let resolve!: (value: { card: Card }) => void
    f.get.mockReturnValueOnce(new Promise(accept => { resolve = accept }))
    const pending = state.selectCard('b')
    f.unmount()
    hooks.dirty = false
    resolve({ card: card('b', 'Late') })
    await pending
    expect(hooks.dirty).toBe(false)
  })
})
