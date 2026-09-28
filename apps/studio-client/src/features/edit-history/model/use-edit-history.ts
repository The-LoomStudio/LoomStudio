import { useCallback, useRef, useState } from 'react'
import type { MutationReceipt } from '../../../entities/index.js'
import {
  completeRedo,
  completeUndo,
  createEditHistoryState,
  readRedoEntry,
  readUndoEntry,
  recordEdit,
  type HistoryEntry,
} from './history-model.js'

type UseEditHistoryInput = {
  revertChangeset(changesetId: string): Promise<MutationReceipt>
}

export function useEditHistory(input: UseEditHistoryInput) {
  const [state, setState] = useState(createEditHistoryState)
  const stateRef = useRef(state)
  const pendingRef = useRef(false)
  const generationRef = useRef(0)

  const updateState = useCallback((next: typeof state) => {
    stateRef.current = next
    setState(next)
  }, [])

  const record = useCallback((entry: HistoryEntry) => {
    updateState(recordEdit(stateRef.current, entry))
  }, [updateState])

  const clear = useCallback(() => {
    generationRef.current += 1
    updateState(createEditHistoryState())
  }, [updateState])

  const undo = useCallback(async (): Promise<HistoryEntry | undefined> => {
    if (pendingRef.current) return undefined
    const entry = readUndoEntry(stateRef.current)
    if (!entry) return undefined
    const generation = generationRef.current
    pendingRef.current = true
    try {
      const mutation = await input.revertChangeset(entry.changesetId)
      if (generation !== generationRef.current) return undefined
      updateState(completeUndo(stateRef.current, entry, mutation.changesetId))
      return entry
    } finally {
      pendingRef.current = false
    }
  }, [input.revertChangeset, updateState])

  const redo = useCallback(async (): Promise<HistoryEntry | undefined> => {
    if (pendingRef.current) return undefined
    const entry = readRedoEntry(stateRef.current)
    if (!entry) return undefined
    const generation = generationRef.current
    pendingRef.current = true
    try {
      const mutation = await input.revertChangeset(entry.changesetId)
      if (generation !== generationRef.current) return undefined
      updateState(completeRedo(stateRef.current, entry, mutation.changesetId))
      return entry
    } finally {
      pendingRef.current = false
    }
  }, [input.revertChangeset, updateState])

  return {
    canUndo: state.undoStack.length > 0,
    canRedo: state.redoStack.length > 0,
    clear,
    record,
    undo,
    redo,
  }
}
