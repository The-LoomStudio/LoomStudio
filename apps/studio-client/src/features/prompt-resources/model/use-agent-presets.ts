import { useEffect, useState } from 'react'
import type { AgentPreset } from '../../../entities/index.js'
import { safeLocalStorage } from '../../../shared/browser/safe-local-storage.js'
const selectedAgentPresetStorageKey = 'loom.studio.selectedAgentPresetId'
export function useAgentPresets(input: { resources: AgentPreset[] }) {
  const agentPresets = input.resources.filter(resource => resource.resourceKind === 'preset')
  const [selectedAgentPresetId, setSelectedAgentPresetId] = useState<string | undefined>(() => readStoredAgentPresetId())
  useEffect(() => {
    setSelectedAgentPresetId(current => {
      const selectedId = chooseAgentPresetId({ currentId: current, profiles: agentPresets, storedId: readStoredAgentPresetId() })
      writeStoredAgentPresetId(selectedId)
      return selectedId
    })
  }, [input.resources])

  function selectAgentPreset(id: string | undefined) {
    setSelectedAgentPresetId(id)
    writeStoredAgentPresetId(id)
  }

  return { agentPresets, selectedAgentPresetId, selectAgentPreset }
}
export function chooseAgentPresetId(input: {
  currentId?: string
  profiles: AgentPreset[]
  storedId?: string
}): string | undefined {
  if (input.currentId) return input.currentId
  if (input.storedId) return input.storedId
  return input.profiles[0]?.id
}

function readStoredAgentPresetId(): string | undefined {
  const value = safeLocalStorage.getItem(selectedAgentPresetStorageKey)
  return value && value.trim().length > 0 ? value : undefined
}

function writeStoredAgentPresetId(id: string | undefined): void {
  if (id) safeLocalStorage.setItem(selectedAgentPresetStorageKey, id)
  else safeLocalStorage.removeItem(selectedAgentPresetStorageKey)
}
