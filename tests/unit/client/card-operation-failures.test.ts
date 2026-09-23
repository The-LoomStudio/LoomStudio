import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FormEvent } from 'react'
import { useAsyncOperations } from '../../../apps/studio-client/src/shared/hooks/use-async-operations.js'
import { useCards } from '../../../apps/studio-client/src/features/cards/model/use-cards.js'
import type { StudioApi } from '../../../apps/studio-client/src/shared/api/studio-api.js'
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
