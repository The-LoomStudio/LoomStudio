type EditOperationAnchor = {
  documentId: string
  subjectId?: string
}

export type HistoryEntry = {
  label: string
  changesetId: string
  anchor?: EditOperationAnchor
}

export type EditHistoryState = {
  undoStack: HistoryEntry[]
  redoStack: HistoryEntry[]
}

export function createEditHistoryState(): EditHistoryState {
  return { undoStack: [], redoStack: [] }
}

export function recordEdit(state: EditHistoryState, entry: HistoryEntry): EditHistoryState {
  return {
    undoStack: [...state.undoStack, entry],
    redoStack: [],
  }
}

export function readUndoEntry(state: EditHistoryState): HistoryEntry | undefined {
  return state.undoStack.at(-1)
}

export function readRedoEntry(state: EditHistoryState): HistoryEntry | undefined {
  return state.redoStack.at(-1)
}

export function completeUndo(state: EditHistoryState, entry: HistoryEntry, revertedChangesetId: string): EditHistoryState {
  return {
    undoStack: state.undoStack.filter(item => item.changesetId !== entry.changesetId),
    redoStack: [...state.redoStack, { ...entry, changesetId: revertedChangesetId }],
  }
}

export function completeRedo(state: EditHistoryState, entry: HistoryEntry, revertedChangesetId: string): EditHistoryState {
  return {
    undoStack: [...state.undoStack, { ...entry, changesetId: revertedChangesetId }],
    redoStack: state.redoStack.filter(item => item.changesetId !== entry.changesetId),
  }
}
