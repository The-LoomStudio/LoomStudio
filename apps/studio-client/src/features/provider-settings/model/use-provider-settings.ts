import type { ClientJsonValue } from '@loom-studio/client-bridge'
import { useState, type FormEvent } from 'react'
import type { StudioApi } from '../../../shared/api/studio-api.js'
import type { Translator } from '../../../shared/i18n/index.js'
import type { AgentRuntimeProfile, ModelProfile, ProviderAccount } from '../../../entities/index.js'
import { normalizeOpenAICompatibleBaseUrl } from './provider-base-url.js'

const selectedAgentRuntimeProfileStorageKey = 'loom.studio.selectedAgentRuntimeProfileId'

export type GatewayForm = {
  baseUrl: string
  apiKey: string
  model: string
  temperature: string
  maxTokens: string
}

type UseProviderSettingsInput = {
  api: StudioApi
  initialGatewayForm: GatewayForm
  runAction: (action: () => Promise<void>) => Promise<void>
  t: Translator
}

export function useProviderSettings(input: UseProviderSettingsInput) {
  const [gatewayForm, setGatewayForm] = useState(input.initialGatewayForm)
  const [selectedAgentRuntimeProfileId, setSelectedAgentRuntimeProfileId] = useState<string | undefined>(() => readStoredAgentRuntimeProfileId())
  const [gatewayProfileSummary, setGatewayProfileSummary] = useState<string>()
  const [providerAccounts, setProviderAccounts] = useState<ProviderAccount[]>([])
  const [modelProfiles, setModelProfiles] = useState<ModelProfile[]>([])
  const [agentRuntimeProfiles, setAgentRuntimeProfiles] = useState<AgentRuntimeProfile[]>([])

  async function refreshProviderAccounts() {
    const result = await input.api.providerAccounts.list()
    setProviderAccounts(result.providerAccounts)
  }

  async function refreshModelProfiles() {
    const result = await input.api.modelProfiles.list()
    setModelProfiles(result.modelProfiles)
  }

  async function refreshAgentRuntimeProfiles() {
    const result = await input.api.agentRuntimeProfiles.list()
    setAgentRuntimeProfiles(result.agentRuntimeProfiles)
    setSelectedAgentRuntimeProfileId(current => {
      const selectedId = chooseAgentRuntimeProfileId({
        currentId: current,
        profiles: result.agentRuntimeProfiles,
        storedId: readStoredAgentRuntimeProfileId(),
      })
      writeStoredAgentRuntimeProfileId(selectedId)
      return selectedId
    })
  }

  async function refreshProviderSettings() {
    await refreshProviderAccounts()
    await refreshModelProfiles()
    await refreshAgentRuntimeProfiles()
  }

  async function createGatewayProfile(event: FormEvent) {
    event.preventDefault()
    const normalizedBaseUrl = normalizeOpenAICompatibleBaseUrl(gatewayForm.baseUrl)
    setGatewayForm(current => ({ ...current, baseUrl: normalizedBaseUrl }))

    await input.runAction(async () => {
      const providerAccount = await input.api.providerAccounts.create(jsonObject({
        providerExtensionId: 'official.openai-compatible',
        displayName: `OpenAI Compatible / ${gatewayForm.model}`,
        config: jsonObject({
          baseUrl: normalizedBaseUrl,
        }),
        secretRefs: jsonObject({
          apiKey: gatewayForm.apiKey.startsWith('env:') ? gatewayForm.apiKey : `plain:${gatewayForm.apiKey}`,
        }),
      }))
      const modelProfile = await input.api.modelProfiles.create(jsonObject({
        providerAccountId: providerAccount.providerAccount.id,
        displayName: gatewayForm.model,
        providerModelId: gatewayForm.model,
        config: readGatewayModelConfig(gatewayForm, input.t),
      }))
      const agentRuntimeProfile = await input.api.agentRuntimeProfiles.create(jsonObject({
        name: `Narrative / ${gatewayForm.model}`,
        purpose: 'narrative',
        modelProfileId: modelProfile.modelProfile.id,
      }))

      selectAgentRuntimeProfile(agentRuntimeProfile.agentRuntimeProfile.id)
      setGatewayProfileSummary(`${modelProfile.modelProfile.providerModelId} / ${shortId(agentRuntimeProfile.agentRuntimeProfile.id)}`)
      await refreshProviderSettings()
    })
  }

  async function updateProviderAccount(providerAccountId: string, updates: { displayName?: string; config?: Record<string, ClientJsonValue>; secretRefs?: Record<string, string> }) {
    await input.runAction(async () => {
      await input.api.providerAccounts.update(jsonObject({ providerAccountId, ...updates }))
      await refreshProviderAccounts()
    })
  }

  async function deleteProviderAccount(providerAccountId: string) {
    await input.runAction(async () => {
      await input.api.providerAccounts.delete(providerAccountId)
      await refreshProviderAccounts()
      await refreshModelProfiles()
    })
  }

  async function updateModelProfile(modelProfileId: string, updates: { displayName?: string; providerModelId?: string; config?: Record<string, ClientJsonValue> }) {
    await input.runAction(async () => {
      await input.api.modelProfiles.update(jsonObject({ modelProfileId, ...updates }))
      await refreshModelProfiles()
    })
  }

  async function deleteModelProfile(modelProfileId: string) {
    await input.runAction(async () => {
      await input.api.modelProfiles.delete(modelProfileId)
      await refreshModelProfiles()
    })
  }

  async function pingModelProfile(modelProfileId: string): Promise<string> {
    return await input.api.modelProfiles.ping(modelProfileId)
  }

  async function createAgentRuntimeProfile(profileInput: { name: string; purpose: string; presetId?: string; modelProfileId?: string }) {
    await input.runAction(async () => {
      const result = await input.api.agentRuntimeProfiles.create(jsonObject(profileInput))
      await refreshAgentRuntimeProfiles()
      selectAgentRuntimeProfile(result.agentRuntimeProfile.id)
    })
  }

  async function updateAgentRuntimeProfile(agentRuntimeProfileId: string, updates: { name?: string; purpose?: string; modelProfileId?: string }) {
    await input.runAction(async () => {
      await input.api.agentRuntimeProfiles.update(jsonObject({ agentRuntimeProfileId, ...updates }))
      await refreshAgentRuntimeProfiles()
    })
  }

  async function deleteAgentRuntimeProfile(agentRuntimeProfileId: string) {
    await input.runAction(async () => {
      await input.api.agentRuntimeProfiles.delete(agentRuntimeProfileId)
      await refreshAgentRuntimeProfiles()
    })
  }

  return {
    gatewayForm,
    setGatewayForm,
    selectedAgentRuntimeProfileId,
    setSelectedAgentRuntimeProfileId: selectAgentRuntimeProfile,
    gatewayProfileSummary,
    providerAccounts,
    modelProfiles,
    agentRuntimeProfiles,
    refreshProviderSettings,
    refreshProviderAccounts,
    refreshModelProfiles,
    refreshAgentRuntimeProfiles,
    createGatewayProfile,
    updateProviderAccount,
    deleteProviderAccount,
    updateModelProfile,
    deleteModelProfile,
    pingModelProfile,
    createAgentRuntimeProfile,
    updateAgentRuntimeProfile,
    deleteAgentRuntimeProfile,
  }

  function selectAgentRuntimeProfile(id: string | undefined) {
    setSelectedAgentRuntimeProfileId(id)
    writeStoredAgentRuntimeProfileId(id)
  }
}

export function chooseAgentRuntimeProfileId(input: {
  currentId?: string
  profiles: AgentRuntimeProfile[]
  storedId?: string
}): string | undefined {
  if (input.currentId && input.profiles.some(profile => profile.id === input.currentId)) return input.currentId
  if (input.storedId && input.profiles.some(profile => profile.id === input.storedId)) return input.storedId
  return input.profiles[0]?.id
}

export function readGatewayModelConfig(form: Pick<GatewayForm, 'temperature' | 'maxTokens'>, t: Translator): Record<string, ClientJsonValue> {
  return jsonObject({
    temperature: readOptionalFormNumber(form.temperature, t) as ClientJsonValue | undefined,
    max_tokens: readOptionalFormNumber(form.maxTokens, t) as ClientJsonValue | undefined,
  })
}

function readOptionalFormNumber(value: string, t: Translator): number | undefined {
  const trimmed = value.trim()
  if (trimmed.length === 0) return undefined
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed)) {
    throw new Error(t('error.expectedNumber', { value }))
  }
  return parsed
}

function jsonObject(value: Record<string, ClientJsonValue | undefined>): Record<string, ClientJsonValue> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Record<string, ClientJsonValue>
}

function shortId(id: string): string {
  return id.slice(0, 13)
}

function readStoredAgentRuntimeProfileId(): string | undefined {
  try {
    const storage = globalThis.localStorage
    const value = storage?.getItem(selectedAgentRuntimeProfileStorageKey)
    return value && value.trim().length > 0 ? value : undefined
  } catch {
    return undefined
  }
}

function writeStoredAgentRuntimeProfileId(id: string | undefined): void {
  try {
    const storage = globalThis.localStorage
    if (!storage) return
    if (id) storage.setItem(selectedAgentRuntimeProfileStorageKey, id)
    else storage.removeItem(selectedAgentRuntimeProfileStorageKey)
  } catch {
    // Browser storage can be unavailable in private contexts.
  }
}
