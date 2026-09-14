import { useState } from 'react'

const EMPTY_SELECTIONS: Record<string, string> = {}

type UseMacroSelectionInput = {
  cardId?: string
  endpoint: string
  presetId?: string
}

export function useMacroSelection(input: UseMacroSelectionInput) {
  const [choice, setChoice] = useState<{ key: string; values: Record<string, string> }>({ key: '', values: {} })

  function targetKey(timelineId?: string, branchId?: string): string {
    return JSON.stringify([input.endpoint, timelineId ?? input.cardId, branchId, input.presetId])
  }

  function getSelections(timelineId?: string, branchId?: string): Record<string, string> {
    return choice.key === targetKey(timelineId, branchId) ? choice.values : EMPTY_SELECTIONS
  }

  function selectSource(key: string, name: string, sourceId: string | undefined): void {
    setChoice(current => {
      const values = { ...(current.key === key ? current.values : {}) }
      if (sourceId === undefined) delete values[name]
      else values[name] = sourceId
      return { key, values }
    })
  }

  function activate(key: string): void {
    setChoice(current => current.key === key ? current : { key, values: {} })
  }

  return {
    activate,
    getSelections,
    readSelections: (key: string) => choice.key === key ? choice.values : EMPTY_SELECTIONS,
    selectSource,
    targetKey,
  }
}
