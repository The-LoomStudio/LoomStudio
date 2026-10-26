import type { JsonValue as ClientJsonValue } from '@loom-studio/shared'
import { useRef, useState, type FormEvent } from 'react'
import { useExplicitCatalog } from '../../../shared/api/use-explicit-catalog.js'
import type { StudioApi } from '../../../shared/api/studio-api.js'
import type {
  AiGatewayInvokeInput,
  AiGatewayInvokeResult,
  ModelProfile,
  ProviderAccount,
} from '../../../entities/index.js'
import { normalizeOpenAICompatibleBaseUrl } from './provider-base-url.js'
import { collectPages } from '../../../shared/api/collect-pages.js'

type ProviderAccountDraft = {
  displayName: string
  baseUrl: string
  apiKey: string
}

type UseProviderSettingsInput = {
  api: StudioApi
  endpoint: string
  initialProviderAccountDraft: ProviderAccountDraft
  runAction: (action: () => Promise<void>) => Promise<void>
}

export function useProviderSettings(input: UseProviderSettingsInput) {
  const [providerAccountDraft, setProviderAccountDraft] = useState(input.initialProviderAccountDraft)
  const modelQueueRef = useRef(Promise.resolve())
  const accounts = useExplicitCatalog(['provider-settings', input.endpoint, 'accounts'], readProviderAccounts)
  const providers = useExplicitCatalog(['provider-settings', input.endpoint, 'providers'], () => input.api.aiGateway.listProviders())
  const capabilities = useExplicitCatalog(['provider-settings', input.endpoint, 'capabilities'], () => collectPages(async cursor => {
    const result = await input.api.aiCapabilityProfiles.list({ cursor, limit: 100 })
    return { items: result.profiles, nextCursor: result.nextCursor }
  }))
  const providerAccounts = accounts.items
  const modelProfiles = projectModelProfiles(providerAccounts)

  function readProviderAccounts() {
    return collectPages(async cursor => {
      const result = await input.api.providerAccounts.list({ cursor, limit: 100 })
      return { items: result.providerProfiles, nextCursor: result.nextCursor }
    })
  }

  const { refresh: refreshProviderAccounts, publish: setProviderAccounts } = accounts
  const { refresh: refreshAiProviders } = providers
  const { refresh: refreshAiCapabilityProfiles, publish: setAiCapabilityProfiles } = capabilities

  async function refreshProviderSettings() {
    await Promise.all([refreshProviderAccounts(), refreshAiProviders(), refreshAiCapabilityProfiles()])
  }

  async function invokeAiCapability(
    request: Omit<AiGatewayInvokeInput, 'signal' | 'caller'>,
  ): Promise<AiGatewayInvokeResult> {
    return await input.api.aiGateway.invoke(request)
  }

  async function createProviderAccount(event: FormEvent) {
    event.preventDefault()
    const normalizedBaseUrl = normalizeOpenAICompatibleBaseUrl(providerAccountDraft.baseUrl)
    setProviderAccountDraft(current => ({ ...current, baseUrl: normalizedBaseUrl }))

    await input.runAction(async () => {
      await commitAccountCreation({
        providerExtensionId: 'official.openai-compatible',
        displayName: providerAccountDraft.displayName.trim(),
        config: {
          baseUrl: normalizedBaseUrl,
        },
        enabledModelIds: [],
        ...(providerAccountDraft.apiKey.trim()
          ? { credential: { apiKey: providerAccountDraft.apiKey.trim() } }
          : {}),
      })
      setProviderAccountDraft({
        displayName: '',
        baseUrl: '',
        apiKey: '',
      })
      await refreshProviderSettings()
    })
  }

  async function createAiProviderAccount(request: {
    providerExtensionId: string
    displayName: string
    config: Record<string, ClientJsonValue>
    credential?: Record<string, string>
  }): Promise<string | undefined> {
    let providerProfileId: string | undefined
    try {
      await input.runAction(async () => {
        providerProfileId = (await commitAccountCreation(request)).id
        await refreshProviderAccounts()
      })
    } catch (error) {
      // A refresh failure is already reported and must not invite duplicate creation.
      if (!providerProfileId) throw error
    }
    return providerProfileId
  }

  async function createAiCapabilityProfile(request: {
    providerProfileId: string
    capabilityId: string
    displayName: string
    config: Record<string, ClientJsonValue>
  }): Promise<string | undefined> {
    let profileId: string | undefined
    try {
      await input.runAction(async () => {
        const result = await input.api.aiCapabilityProfiles.create(request)
        profileId = result.profile.id
        setAiCapabilityProfiles(current => [result.profile, ...current.filter(profile => profile.id !== result.profile.id)])
        await refreshAiCapabilityProfiles()
      })
    } catch (error) {
      if (!profileId) throw error
    }
    return profileId
  }

  async function updateAiProviderAccount(request: {
    providerProfileId: string
    displayName: string
    config: Record<string, ClientJsonValue>
    credential?: Record<string, string>
  }): Promise<void> {
    await input.runAction(async () => {
      await commitAccountUpdate({
        providerProfileId: request.providerProfileId,
        displayName: request.displayName,
        config: request.config,
      }, request.credential)
      await refreshProviderAccounts()
    })
  }

  async function updateAiCapabilityProfile(request: {
    profileId: string
    providerProfileId?: string
    displayName: string
    config: Record<string, ClientJsonValue>
  }): Promise<void> {
    await input.runAction(async () => {
      const result = await input.api.aiCapabilityProfiles.update(request)
      setAiCapabilityProfiles(current => [result.profile, ...current.filter(profile => profile.id !== result.profile.id)])
      await refreshAiCapabilityProfiles()
    })
  }

  async function createModelProfile(providerAccountId: string, providerModelId: string) {
    const model = providerModelId.trim()
    if (!model) return
    const task = modelQueueRef.current.then(async () => {
      await input.runAction(async () => {
        const profiles = await readProviderAccounts()
        const account = profiles.find(item => item.id === providerAccountId)
        if (!account) throw new Error(`Provider Profile not found: ${providerAccountId}`)
        if (account.enabledModelIds.includes(model)) return
        await commitAccountUpdate({
          providerProfileId: providerAccountId,
          enabledModelIds: [...new Set([...account.enabledModelIds, model])],
        })
        await refreshProviderAccounts()
      })
    })
    modelQueueRef.current = task.catch(() => {})
    await task
  }

  async function updateProviderAccount(providerAccountId: string, updates: { displayName?: string; config?: Record<string, ClientJsonValue> }) {
    await input.runAction(async () => {
      await commitAccountUpdate({ providerProfileId: providerAccountId, ...updates })
      await refreshProviderAccounts()
    })
  }

  async function updateProviderConnection(providerAccountId: string, connection: { displayName: string; baseUrl: string; apiKey?: string }): Promise<boolean> {
    const normalizedBaseUrl = normalizeOpenAICompatibleBaseUrl(connection.baseUrl)
    let succeeded = false
    await input.runAction(async () => {
      const account = providerAccounts.find(item => item.id === providerAccountId)
      if (!account) throw new Error(`Provider Profile not found: ${providerAccountId}`)
      await commitAccountUpdate({
        providerProfileId: providerAccountId,
        displayName: connection.displayName.trim(),
        config: { ...account.config, baseUrl: normalizedBaseUrl },
      }, connection.apiKey?.trim() ? { apiKey: connection.apiKey.trim() } : undefined)
      await refreshProviderAccounts()
      succeeded = true
    })
    return succeeded
  }

  async function deleteProviderAccount(providerAccountId: string) {
    await input.runAction(async () => {
      await input.api.providerAccounts.delete(providerAccountId)
      setProviderAccounts(current => current.filter(profile => profile.id !== providerAccountId))
      await refreshProviderAccounts()
    })
  }

  async function updateModelProfile(modelProfileId: string, updates: { displayName?: string; providerModelId?: string; config?: Record<string, ClientJsonValue>; tokenMultiplier?: number }) {
    await input.runAction(async () => {
      const current = modelProfiles.find(model => model.id === modelProfileId)
      const account = current && providerAccounts.find(item => item.id === current.providerAccountId)
      if (!current || !account) throw new Error(`Provider model not found: ${modelProfileId}`)
      const nextModelId = updates.providerModelId?.trim() || current.providerModelId
      await commitAccountUpdate({
        providerProfileId: account.id,
        ...(updates.tokenMultiplier !== undefined ? {
          expectedVersion: current.version,
          tokenMultipliers: { ...account.tokenMultipliers, [current.providerModelId]: updates.tokenMultiplier },
        } : {}),
        enabledModelIds: account.enabledModelIds.map(modelId => modelId === current.providerModelId ? nextModelId : modelId),
      })
      await refreshProviderAccounts()
    })
  }

  async function deleteModelProfile(modelProfileId: string) {
    await input.runAction(async () => {
      const current = modelProfiles.find(model => model.id === modelProfileId)
      const account = current && providerAccounts.find(item => item.id === current.providerAccountId)
      if (!current || !account) return
      await commitAccountUpdate({
        providerProfileId: account.id,
        enabledModelIds: account.enabledModelIds.filter(modelId => modelId !== current.providerModelId),
      })
      await refreshProviderAccounts()
    })
  }

  async function commitAccountCreation(request: Parameters<StudioApi['providerAccounts']['create']>[0]) {
    const { providerProfile } = await input.api.providerAccounts.create(request)
    publishProviderAccount(providerProfile)
    return providerProfile
  }

  async function commitAccountUpdate(request: Parameters<StudioApi['providerAccounts']['update']>[0], nextCredential?: Record<string, string>) {
    const { providerProfile } = await input.api.providerAccounts.update(request)
    publishProviderAccount(providerProfile)
    if (nextCredential && Object.keys(nextCredential).length > 0) {
      const { credential } = await input.api.providerAccounts.replaceCredential(request.providerProfileId, nextCredential)
      setProviderAccounts(current => current.map(profile => profile.id === request.providerProfileId ? { ...profile, credential } : profile))
    }
  }

  function publishProviderAccount(profile: ProviderAccount) {
    setProviderAccounts(current => [profile, ...current.filter(item => item.id !== profile.id)])
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
    providerAccountsLoaded: accounts.loaded,
    modelProfiles,
    aiProviders: providers.items,
    aiCapabilityProfiles: capabilities.items,
    refreshProviderSettings,
    refreshAiProviders,
    refreshProviderAccounts,
    refreshModelProfiles: refreshProviderAccounts,
    createProviderAccount,
    createAiProviderAccount,
    createAiCapabilityProfile,
    updateAiProviderAccount,
    updateAiCapabilityProfile,
    createModelProfile,
    updateProviderAccount,
    updateProviderConnection,
    deleteProviderAccount,
    updateModelProfile,
    deleteModelProfile,
    listProviderModels,
    pingModelProfile,
    invokeAiCapability,
  }
}

function projectModelProfiles(accounts: ProviderAccount[]): ModelProfile[] {
  return accounts.flatMap(account => account.enabledModelIds.map(modelId => ({
    id: `${account.id}:${modelId}`,
    version: account.version,
    providerAccountId: account.id,
    displayName: modelId,
    providerModelId: modelId,
    tokenMultiplier: account.tokenMultipliers?.[modelId] ?? 1,
  })))
}
