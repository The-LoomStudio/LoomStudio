import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useEditHistory } from '../../../apps/studio-client/src/features/edit-history/model/use-edit-history.js'
import type { EditHistoryState } from '../../../apps/studio-client/src/features/edit-history/model/history-model.js'
import type { MutationReceipt } from '../../../apps/studio-client/src/entities/index.js'

const hooks = vi.hoisted(() => ({ state: undefined as EditHistoryState | undefined }))
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useState: (initial: () => EditHistoryState) => {
    hooks.state = initial()
    return [hooks.state, (next: EditHistoryState) => { hooks.state = next }]
  },
  useRef: (current: unknown) => ({ current }),
  useCallback: (callback: unknown) => callback,
}))
beforeEach(() => { hooks.state = undefined })
const a = { label: 'A', changesetId: 'edit-a', anchor: { documentId: 'a' } }
const b = { label: 'B', changesetId: 'edit-b', anchor: { documentId: 'b' } }

describe('edit history completion identity', () => {
  it('moves only the requested undo entry when another edit is recorded in flight', async () => {
    const pending = Promise.withResolvers<MutationReceipt>()
    const revertChangeset = vi.fn(() => pending.promise)
    const history = useEditHistory({ revertChangeset })
    history.record(a)
    const undo = history.undo()
    history.record(b)
    pending.resolve({ changesetId: 'undo-a' })
    expect(await undo).toEqual(a)
    expect(hooks.state).toEqual({
      undoStack: [b], redoStack: [{ ...a, changesetId: 'undo-a' }],
    })
    expect(revertChangeset).toHaveBeenCalledWith('edit-a')
  })

  it('records the committed redo without consuming a newer edit', async () => {
    const pending = Promise.withResolvers<MutationReceipt>()
    const revertChangeset = vi.fn<(id: string) => Promise<MutationReceipt>>()
      .mockResolvedValueOnce({ changesetId: 'undo-a' }).mockReturnValueOnce(pending.promise)
    const history = useEditHistory({ revertChangeset })
    history.record(a)
    await history.undo()
    const redo = history.redo()
    history.record(b)
    pending.resolve({ changesetId: 'redo-a' })
    await redo
    expect(hooks.state).toEqual({
      undoStack: [b, { ...a, changesetId: 'redo-a' }], redoStack: [],
    })
  })

  it('does not issue another history operation while one is pending', async () => {
    const pending = Promise.withResolvers<MutationReceipt>()
    const revertChangeset = vi.fn(() => pending.promise)
    const history = useEditHistory({ revertChangeset })
    history.record(a)
    const undo = history.undo()
    expect(await history.undo()).toBeUndefined()
    expect(await history.redo()).toBeUndefined()
    expect(revertChangeset).toHaveBeenCalledTimes(1)
    pending.resolve({ changesetId: 'undo-a' })
    await undo
  })

  it('does not repopulate cleared history or return a stale navigation anchor', async () => {
    const pending = Promise.withResolvers<MutationReceipt>()
    const history = useEditHistory({ revertChangeset: () => pending.promise })
    history.record(a)
    const undo = history.undo()
    history.clear()
    history.record(b)
    pending.resolve({ changesetId: 'undo-a' })
    expect(await undo).toBeUndefined()
    expect(hooks.state).toEqual({ undoStack: [b], redoStack: [] })
  })

  it('preserves history on failure and releases the submission lock', async () => {
    const failure = new Error('Revert conflict')
    const revertChangeset = vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce({ changesetId: 'undo-a' })
    const history = useEditHistory({ revertChangeset })
    history.record(a)
    await expect(history.undo()).rejects.toBe(failure)
    expect(hooks.state).toEqual({ undoStack: [a], redoStack: [] })
    await history.undo()
    expect(revertChangeset).toHaveBeenCalledTimes(2)
    expect(hooks.state?.redoStack).toEqual([{ ...a, changesetId: 'undo-a' }])
  })
})
