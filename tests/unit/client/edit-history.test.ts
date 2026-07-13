import {
  completeRedo,
  completeUndo,
  createEditHistoryState,
  readRedoEntry,
  readUndoEntry,
  recordEdit,
} from '../../../apps/studio-client/src/features/edit-history/model/history-model.js'
import { describe, expect, it } from 'vitest'

describe('edit history model', () => {
  it('moves changeset targets between undo and redo stacks', () => {
    const recorded = recordEdit(createEditHistoryState(), {
      label: 'Update Card',
      changesetId: 'change-update',
      anchor: { documentId: 'card-1' },
    })
    const undone = completeUndo(recorded, 'change-undo')
    const redone = completeRedo(undone, 'change-redo')

    expect(readUndoEntry(recorded)?.changesetId).toBe('change-update')
    expect(readRedoEntry(undone)).toMatchObject({
      label: 'Update Card',
      changesetId: 'change-undo',
      anchor: { documentId: 'card-1' },
    })
    expect(readUndoEntry(redone)?.changesetId).toBe('change-redo')
    expect(redone.redoStack).toEqual([])
  })

  it('clears redo when a new edit is recorded after undo', () => {
    const first = recordEdit(createEditHistoryState(), { label: 'First', changesetId: 'change-1' })
    const undone = completeUndo(first, 'change-undo-1')
    const second = recordEdit(undone, { label: 'Second', changesetId: 'change-2' })

    expect(second.undoStack.map(entry => entry.changesetId)).toEqual(['change-2'])
    expect(second.redoStack).toEqual([])
  })

  it('treats sorting as a first-class reversible changeset', () => {
    const sorted = recordEdit(createEditHistoryState(), {
      label: 'Reorder Entries',
      changesetId: 'change-sort',
      anchor: { documentId: 'setting-1', subjectId: 'entry-b' },
    })
    const undone = completeUndo(sorted, 'change-sort-undo')

    expect(readRedoEntry(undone)).toEqual({
      label: 'Reorder Entries',
      changesetId: 'change-sort-undo',
      anchor: { documentId: 'setting-1', subjectId: 'entry-b' },
    })
  })
})
