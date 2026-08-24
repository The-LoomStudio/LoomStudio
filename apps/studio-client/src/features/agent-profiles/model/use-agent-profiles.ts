import { useState } from 'react'
import type { AgentProfile, AgentToolDefinition, PromptResource, ProviderModelSelection } from '../../../entities/index.js'
import type { StudioApi } from '../../../shared/api/studio-api.js'
import { safeLocalStorage } from '../../../shared/browser/safe-local-storage.js'

const selectedAgentProfileStorageKey = 'loom.studio.selectedAgentProfileId'

type UseAgentProfilesInput = {
  api: StudioApi
  runAction: (action: () => Promise<void>) => Promise<void>
}

export function useAgentProfiles(input: UseAgentProfilesInput) {
  const [agentProfiles, setAgentProfiles] = useState<AgentProfile[]>([])
  const [presets, setPresets] = useState<PromptResource[]>([])
  const [tools, setTools] = useState<AgentToolDefinition[]>([])
  const [selectedAgentProfileId, setSelectedAgentProfileId] = useState<string | undefined>(() => readStoredAgentProfileId())

  async function refreshAgentProfiles() {
    const [profileResult, presetResult, toolResult] = await Promise.all([
      input.api.agentProfiles.list(),
      input.api.promptResources.list('preset'),
      input.api.agentTools.list(),
    ])
    setAgentProfiles(profileResult.agentProfiles)
    setPresets(presetResult.resources)
    setTools(toolResult.tools)
    setSelectedAgentProfileId(current => {
      const selectedId = chooseAgentProfileId({
        currentId: current,
        profiles: profileResult.agentProfiles,
        storedId: readStoredAgentProfileId(),
      })
      writeStoredAgentProfileId(selectedId)
      return selectedId
    })
  }

  async function createAgentProfile(profileInput: { name: string; presetId?: string; model: ProviderModelSelection; toolOverrides?: Record<string, boolean> }) {
    await input.runAction(async () => {
      const presetId = profileInput.presetId ?? await ensureDefaultPreset()
      const result = await input.api.agentProfiles.create({
        name: profileInput.name,
        presetId,
        model: profileInput.model,
        toolOverrides: profileInput.toolOverrides,
      })
      await refreshAgentProfiles()
      selectAgentProfile(result.agentProfile.id)
    })
  }

  async function updateAgentProfile(agentProfileId: string, updates: { name?: string; presetId?: string; model?: ProviderModelSelection; toolOverrides?: Record<string, boolean> }) {
    await input.runAction(async () => {
      await input.api.agentProfiles.update({
        agentProfileId,
        ...updates,
      })
      await refreshAgentProfiles()
    })
  }

  async function deleteAgentProfile(agentProfileId: string) {
    await input.runAction(async () => {
      await input.api.agentProfiles.delete(agentProfileId)
      await refreshAgentProfiles()
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
      setTools(current => current.map(item => item.id === result.tool.id ? result.tool : item))
    })
  }

  function selectAgentProfile(id: string | undefined) {
    setSelectedAgentProfileId(id)
    writeStoredAgentProfileId(id)
  }

  async function ensureDefaultPreset(): Promise<string> {
    const existing = presets.find(preset => preset.origin?.key === 'loom-assistant-preset') ?? presets[0]
    if (existing) return existing.id
    throw new Error('Official Loom Studio Preset is unavailable')
  }

  return {
    presets,
    tools,
    agentProfiles,
    selectedAgentProfileId,
    createAgentProfile,
    deleteAgentProfile,
    refreshAgentProfiles,
    selectAgentProfile,
    updateAgentProfile,
    updateAgentTool,
  }
}

export function chooseAgentProfileId(input: {
  currentId?: string
  profiles: AgentProfile[]
  storedId?: string
}): string | undefined {
  if (input.currentId && input.profiles.some(profile => profile.id === input.currentId)) return input.currentId
  if (input.storedId && input.profiles.some(profile => profile.id === input.storedId)) return input.storedId
  return input.profiles[0]?.id
}

function readStoredAgentProfileId(): string | undefined {
  const value = safeLocalStorage.getItem(selectedAgentProfileStorageKey)
  return value && value.trim().length > 0 ? value : undefined
}

function writeStoredAgentProfileId(id: string | undefined): void {
  if (id) safeLocalStorage.setItem(selectedAgentProfileStorageKey, id)
  else safeLocalStorage.removeItem(selectedAgentProfileStorageKey)
}
