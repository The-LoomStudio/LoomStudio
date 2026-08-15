import type { ClientJsonValue } from '@loom-studio/client-bridge'
import { useState, type FormEvent } from 'react'
import { toClientJsonObject } from '../../../shared/api/client-json-object.js'
import type { StudioApi } from '../../../shared/api/studio-api.js'
import type { ModelProfile, ProviderAccount } from '../../../entities/index.js'
import { normalizeOpenAICompatibleBaseUrl } from './provider-base-url.js'

export type ProviderAccountDraft = {
  displayName: string
  baseUrl: string
  apiKey: string
}

type UseProviderSettingsInput = {
  api: StudioApi
  initialProviderAccountDraft: ProviderAccountDraft
  runAction: (action: () => Promise<void>) => Promise<void>
}

export function useProviderSettings(input: UseProviderSettingsInput) {
  const [providerAccountDraft, setProviderAccountDraft] = useState(input.initialProviderAccountDraft)
  const [providerAccounts, setProviderAccounts] = useState<ProviderAccount[]>([])
  const [providerAccountsLoaded, setProviderAccountsLoaded] = useState(false)
  const [modelProfiles, setModelProfiles] = useState<ModelProfile[]>([])

  async function refreshProviderAccounts() {
    const result = await input.api.providerAccounts.list()
    setProviderAccounts(result.providerAccounts)
    setModelProfiles(projectModelProfiles(result.providerAccounts))
    setProviderAccountsLoaded(true)
  }

  async function refreshModelProfiles() {
    await refreshProviderAccounts()
  }

  async function refreshProviderSettings() {
    await refreshProviderAccounts()
  }

  async function createProviderAccount(event: FormEvent) {
    event.preventDefault()
    const normalizedBaseUrl = normalizeOpenAICompatibleBaseUrl(providerAccountDraft.baseUrl)
    setProviderAccountDraft(current => ({ ...current, baseUrl: normalizedBaseUrl }))

    await input.runAction(async () => {
      await input.api.providerAccounts.create(toClientJsonObject({
        providerExtensionId: 'official.openai-compatible',
        displayName: providerAccountDraft.displayName.trim(),
        config: toClientJsonObject({
          baseUrl: normalizedBaseUrl,
        }),
        enabledModelIds: [],
        ...(providerAccountDraft.apiKey.trim()
          ? { credential: toClientJsonObject({ apiKey: providerAccountDraft.apiKey }) }
          : {}),
      }))
      await refreshProviderSettings()
    })
  }

  async function createModelProfile(providerAccountId: string, providerModelId: string) {
    const model = providerModelId.trim()
    if (!model) return
    await input.runAction(async () => {
      const account = providerAccounts.find(item => item.id === providerAccountId)
      if (!account) throw new Error(`Provider Profile not found: ${providerAccountId}`)
      await input.api.providerAccounts.update(toClientJsonObject({
        providerProfileId: providerAccountId,
        enabledModelIds: [...new Set([...account.enabledModelIds, model])],
      }))
      await refreshProviderAccounts()
    })
  }

  async function updateProviderAccount(providerAccountId: string, updates: { displayName?: string; config?: Record<string, ClientJsonValue> }) {
    await input.runAction(async () => {
      await input.api.providerAccounts.update(toClientJsonObject({ providerProfileId: providerAccountId, ...updates }))
      await refreshProviderAccounts()
    })
  }

  async function updateProviderConnection(providerAccountId: string, connection: { displayName: string; baseUrl: string; apiKey?: string }): Promise<boolean> {
    const normalizedBaseUrl = normalizeOpenAICompatibleBaseUrl(connection.baseUrl)
    let succeeded = false
    await input.runAction(async () => {
      const account = providerAccounts.find(item => item.id === providerAccountId)
      if (!account) throw new Error(`Provider Profile not found: ${providerAccountId}`)
      await input.api.providerAccounts.update(toClientJsonObject({
        providerProfileId: providerAccountId,
        displayName: connection.displayName.trim(),
        config: toClientJsonObject({ ...account.config, baseUrl: normalizedBaseUrl }),
      }))
      if (connection.apiKey?.trim()) {
        await input.api.providerAccounts.replaceCredential(providerAccountId, { apiKey: connection.apiKey.trim() })
      }
      await refreshProviderAccounts()
      succeeded = true
    })
    return succeeded
  }

  async function deleteProviderAccount(providerAccountId: string) {
    await input.runAction(async () => {
      await input.api.providerAccounts.delete(providerAccountId)
      await refreshProviderAccounts()
    })
  }

  async function updateModelProfile(modelProfileId: string, updates: { displayName?: string; providerModelId?: string; config?: Record<string, ClientJsonValue> }) {
    await input.runAction(async () => {
      const current = modelProfiles.find(model => model.id === modelProfileId)
      const account = current && providerAccounts.find(item => item.id === current.providerAccountId)
      if (!current || !account) throw new Error(`Provider model not found: ${modelProfileId}`)
      const nextModelId = updates.providerModelId?.trim() || current.providerModelId
      await input.api.providerAccounts.update(toClientJsonObject({
        providerProfileId: account.id,
        enabledModelIds: account.enabledModelIds.map(modelId => modelId === current.providerModelId ? nextModelId : modelId),
      }))
      await refreshProviderAccounts()
    })
  }

  async function deleteModelProfile(modelProfileId: string) {
    await input.runAction(async () => {
      const current = modelProfiles.find(model => model.id === modelProfileId)
      const account = current && providerAccounts.find(item => item.id === current.providerAccountId)
      if (!current || !account) return
      await input.api.providerAccounts.update(toClientJsonObject({
        providerProfileId: account.id,
        enabledModelIds: account.enabledModelIds.filter(modelId => modelId !== current.providerModelId),
      }))
      await refreshProviderAccounts()
    })
  }

  async function pingModelProfile(modelProfileId: string): Promise<string> {
    const model = modelProfiles.find(item => item.id === modelProfileId)
    if (!model) throw new Error(`Provider model not found: ${modelProfileId}`)
    return await input.api.providerModels.ping(model.providerAccountId, model.providerModelId)
  }

  async function listProviderModels(providerAccountId: string): Promise<string[]> {
    return await input.api.providerModels.list(providerAccountId)
  }

  return {
    providerAccountDraft,
    setProviderAccountDraft,
    providerAccounts,
    providerAccountsLoaded,
    modelProfiles,
    refreshProviderSettings,
    refreshProviderAccounts,
    refreshModelProfiles,
    createProviderAccount,
    createModelProfile,
    updateProviderAccount,
    updateProviderConnection,
    deleteProviderAccount,
    updateModelProfile,
    deleteModelProfile,
    listProviderModels,
    pingModelProfile,
  }
}

function projectModelProfiles(accounts: ProviderAccount[]): ModelProfile[] {
  return accounts.flatMap(account => account.enabledModelIds.map(modelId => ({
    id: `${account.id}:${modelId}`,
    version: account.version,
    providerAccountId: account.id,
    displayName: modelId,
    providerModelId: modelId,
  })))
}
