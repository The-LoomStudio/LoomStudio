import { useRef, useState } from 'react'
import type { AgentPreset, AgentToolDefinition, ProviderModelSelection } from '../../../entities/index.js'
import type { StudioApi } from '../../../shared/api/studio-api.js'
import { safeLocalStorage } from '../../../shared/browser/safe-local-storage.js'
import { collectPages } from '../../../shared/api/collect-pages.js'

const selectedAgentPresetStorageKey = 'loom.studio.selectedAgentPresetId'

type UseAgentPresetsInput = {
  api: StudioApi
  runAction: (action: () => Promise<void>) => Promise<void>
  refreshResources: () => Promise<void>
}

export function useAgentPresets(input: UseAgentPresetsInput) {
  const [agentPresets, setAgentPresets] = useState<AgentPreset[]>([])
  const [tools, setTools] = useState<AgentToolDefinition[]>([])
  const [selectedAgentPresetId, setSelectedAgentPresetId] = useState<string | undefined>(() => readStoredAgentPresetId())
  const reads = useRef({ request: 0, write: 0 })
  const selectionRequest = useRef(0)

  async function refreshAgentPresets(): Promise<void> {
    const request = ++reads.current.request
    const write = reads.current.write
    const [profileResult, toolResult] = await Promise.all([
      collectPages(async cursor => {
        const result = await input.api.agentPresets.list({ cursor, limit: 100 })
        return { items: result.agentPresets, nextCursor: result.nextCursor }
      }),
      input.api.agentTools.list(),
    ])
    if (request !== reads.current.request) return
    if (write !== reads.current.write) return refreshAgentPresets()
    setAgentPresets(profileResult)
    setTools(toolResult.tools)
    setSelectedAgentPresetId(current => {
      const selectedId = chooseAgentPresetId({
        currentId: current,
        profiles: profileResult,
        storedId: readStoredAgentPresetId(),
      })
      writeStoredAgentPresetId(selectedId)
      return selectedId
    })
  }

  async function createAgentPreset(profileInput: { name: string; model?: ProviderModelSelection; delivery?: 'stream' | 'complete' }) {
    const selection = ++selectionRequest.current
    let created = false
    try {
      await input.runAction(async () => {
        const result = await input.api.agentPresets.create({
          name: profileInput.name,
          model: profileInput.model,
          delivery: profileInput.delivery,
        })
        created = true
        reads.current.write += 1
        setAgentPresets(current => [result.agentPreset, ...current.filter(profile => profile.id !== result.agentPreset.id)])
        if (selection === selectionRequest.current) selectAgentPreset(result.agentPreset.id)
        await Promise.all([refreshAgentPresets(), input.refreshResources()])
      })
    } catch (error) {
      if (!created) throw error
      // Creation committed; the operation reporter has already surfaced the refresh failure.
    }
    return created
  }

  async function updateAgentPreset(agentPresetId: string, updates: { name?: string; model?: ProviderModelSelection | null; delivery?: 'stream' | 'complete' }) {
    const current = agentPresets.find(preset => preset.id === agentPresetId)
    if (!current) throw new Error(`Agent Preset not found: ${agentPresetId}`)
    await input.runAction(async () => {
      const result = await input.api.agentPresets.update({
        agentPresetId,
        expectedVersion: current.version,
        ...updates,
      })
      reads.current.write += 1
      setAgentPresets(current => current.map(profile => profile.id === agentPresetId ? result.agentPreset : profile))
      await Promise.all([refreshAgentPresets(), input.refreshResources()])
    })
  }

  async function deleteAgentPreset(agentPresetId: string) {
    await input.runAction(async () => {
      await input.api.agentPresets.delete(agentPresetId)
      reads.current.write += 1
      setAgentPresets(current => current.filter(profile => profile.id !== agentPresetId))
      await Promise.all([refreshAgentPresets(), input.refreshResources()])
    })
  }

  async function updateAgentTool(tool: AgentToolDefinition) {
    await input.runAction(async () => {
      const result = await input.api.agentTools.update({
        toolId: tool.id,
        expectedVersion: tool.version,
        definition: {
          id: tool.id,
          owner: tool.owner,
          name: tool.name,
          description: tool.description,
          input: tool.input,
          ...(tool.prompt ? { prompt: tool.prompt } : {}),
        },
      })
      reads.current.write += 1
      setTools(current => current.map(item => item.id === result.tool.id ? result.tool : item))
    })
  }

  function selectAgentPreset(id: string | undefined) {
    selectionRequest.current += 1
    setSelectedAgentPresetId(id)
    writeStoredAgentPresetId(id)
  }

  return {
    tools,
    agentPresets,
    selectedAgentPresetId,
    createAgentPreset,
    deleteAgentPreset,
    refreshAgentPresets,
    selectAgentPreset,
    updateAgentPreset,
    updateAgentTool,
  }
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
