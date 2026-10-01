import type { ClientJsonValue } from '@loom-studio/client-bridge'
import { useRef, useState, type FormEvent } from 'react'
import type { StudioApi } from '../../../shared/api/studio-api.js'
import type {
  AiGatewayInvokeInput,
  AiGatewayInvokeResult,
  AiCapabilityProfile,
  ModelProfile,
  ProviderAccount,
  RegisteredAiGatewayProvider,
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
  initialProviderAccountDraft: ProviderAccountDraft
  runAction: (action: () => Promise<void>) => Promise<void>
}

export function useProviderSettings(input: UseProviderSettingsInput) {
  const [providerAccountDraft, setProviderAccountDraft] = useState(input.initialProviderAccountDraft)
  const [providerAccounts, setProviderAccounts] = useState<ProviderAccount[]>([])
  const [providerAccountsLoaded, setProviderAccountsLoaded] = useState(false)
  const [modelProfiles, setModelProfiles] = useState<ModelProfile[]>([])
  const [aiProviders, setAiProviders] = useState<RegisteredAiGatewayProvider[]>([])
  const [aiCapabilityProfiles, setAiCapabilityProfiles] = useState<AiCapabilityProfile[]>([])
  const modelQueueRef = useRef(Promise.resolve())
  const providerReads = useRef({ request: 0, write: 0 })
  const capabilityReads = useRef({ request: 0, write: 0 })
  const aiProviderRequest = useRef(0)

  async function refreshProviderAccounts(): Promise<void> {
    const request = ++providerReads.current.request
    const write = providerReads.current.write
    const profiles = await readProviderAccounts()
    if (request !== providerReads.current.request) return
    if (write !== providerReads.current.write) return refreshProviderAccounts()
    setProviderAccounts(profiles)
    setModelProfiles(projectModelProfiles(profiles))
    setProviderAccountsLoaded(true)
  }

  async function readProviderAccounts() {
    return await collectPages(async cursor => {
      const result = await input.api.providerAccounts.list({ cursor, limit: 100 })
      return { items: result.providerProfiles, nextCursor: result.nextCursor }
    })
  }

  async function refreshModelProfiles() {
    await refreshProviderAccounts()
  }

  async function refreshProviderSettings() {
    await Promise.all([
      refreshProviderAccounts(),
      refreshAiProviders(),
      refreshAiCapabilityProfiles(),
    ])
  }

  async function refreshAiProviders() {
    const request = ++aiProviderRequest.current
    const providers = await input.api.aiGateway.listProviders()
    if (request !== aiProviderRequest.current) return
    setAiProviders(providers)
  }

  async function refreshAiCapabilityProfiles(): Promise<void> {
    const request = ++capabilityReads.current.request
    const write = capabilityReads.current.write
    const profiles = await collectPages(async cursor => {
      const result = await input.api.aiCapabilityProfiles.list({ cursor, limit: 100 })
      return { items: result.profiles, nextCursor: result.nextCursor }
    })
    if (request !== capabilityReads.current.request) return
    if (write !== capabilityReads.current.write) return refreshAiCapabilityProfiles()
    setAiCapabilityProfiles(profiles)
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
      const result = await input.api.providerAccounts.create({
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
      publishProviderAccount(result.providerProfile)
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
        const result = await input.api.providerAccounts.create({
          ...request,
        })
        providerProfileId = result.providerProfile.id
        publishProviderAccount(result.providerProfile)
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
        capabilityReads.current.write += 1
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
      const result = await input.api.providerAccounts.update({
        providerProfileId: request.providerProfileId,
        displayName: request.displayName,
        config: request.config,
      })
      publishProviderAccount(result.providerProfile)
      if (request.credential && Object.keys(request.credential).length > 0) {
        const { credential } = await input.api.providerAccounts.replaceCredential(request.providerProfileId, request.credential)
        providerReads.current.write += 1
        setProviderAccounts(current => current.map(profile => profile.id === request.providerProfileId ? { ...profile, credential } : profile))
      }
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
      capabilityReads.current.write += 1
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
        const result = await input.api.providerAccounts.update({
          providerProfileId: providerAccountId,
          enabledModelIds: [...new Set([...account.enabledModelIds, model])],
        })
        publishProviderAccount(result.providerProfile)
        await refreshProviderAccounts()
      })
    })
    modelQueueRef.current = task.catch(() => {})
    await task
  }

  async function updateProviderAccount(providerAccountId: string, updates: { displayName?: string; config?: Record<string, ClientJsonValue> }) {
    await input.runAction(async () => {
      const result = await input.api.providerAccounts.update({ providerProfileId: providerAccountId, ...updates })
      publishProviderAccount(result.providerProfile)
      await refreshProviderAccounts()
    })
  }

  async function updateProviderConnection(providerAccountId: string, connection: { displayName: string; baseUrl: string; apiKey?: string }): Promise<boolean> {
    const normalizedBaseUrl = normalizeOpenAICompatibleBaseUrl(connection.baseUrl)
    let succeeded = false
    await input.runAction(async () => {
      const account = providerAccounts.find(item => item.id === providerAccountId)
      if (!account) throw new Error(`Provider Profile not found: ${providerAccountId}`)
      const result = await input.api.providerAccounts.update({
        providerProfileId: providerAccountId,
        displayName: connection.displayName.trim(),
        config: { ...account.config, baseUrl: normalizedBaseUrl },
      })
      publishProviderAccount(result.providerProfile)
      if (connection.apiKey?.trim()) {
        const { credential } = await input.api.providerAccounts.replaceCredential(providerAccountId, { apiKey: connection.apiKey.trim() })
        providerReads.current.write += 1
        setProviderAccounts(current => current.map(profile => profile.id === providerAccountId ? { ...profile, credential } : profile))
      }
      await refreshProviderAccounts()
      succeeded = true
    })
    return succeeded
  }

  async function deleteProviderAccount(providerAccountId: string) {
    await input.runAction(async () => {
      await input.api.providerAccounts.delete(providerAccountId)
      providerReads.current.write += 1
      setProviderAccounts(current => current.filter(profile => profile.id !== providerAccountId))
      setModelProfiles(current => current.filter(model => model.providerAccountId !== providerAccountId))
      await refreshProviderAccounts()
    })
  }

  async function updateModelProfile(modelProfileId: string, updates: { displayName?: string; providerModelId?: string; config?: Record<string, ClientJsonValue>; tokenMultiplier?: number }) {
    await input.runAction(async () => {
      const current = modelProfiles.find(model => model.id === modelProfileId)
      const account = current && providerAccounts.find(item => item.id === current.providerAccountId)
      if (!current || !account) throw new Error(`Provider model not found: ${modelProfileId}`)
      const nextModelId = updates.providerModelId?.trim() || current.providerModelId
      const result = await input.api.providerAccounts.update({
        providerProfileId: account.id,
        ...(updates.tokenMultiplier !== undefined ? {
          expectedVersion: current.version,
          tokenMultipliers: { ...account.tokenMultipliers, [current.providerModelId]: updates.tokenMultiplier },
        } : {}),
        enabledModelIds: account.enabledModelIds.map(modelId => modelId === current.providerModelId ? nextModelId : modelId),
      })
      publishProviderAccount(result.providerProfile)
      await refreshProviderAccounts()
    })
  }

  async function deleteModelProfile(modelProfileId: string) {
    await input.runAction(async () => {
      const current = modelProfiles.find(model => model.id === modelProfileId)
      const account = current && providerAccounts.find(item => item.id === current.providerAccountId)
      if (!current || !account) return
      const result = await input.api.providerAccounts.update({
        providerProfileId: account.id,
        enabledModelIds: account.enabledModelIds.filter(modelId => modelId !== current.providerModelId),
      })
      publishProviderAccount(result.providerProfile)
      await refreshProviderAccounts()
    })
  }

  function publishProviderAccount(profile: ProviderAccount) {
    providerReads.current.write += 1
    setProviderAccounts(current => [profile, ...current.filter(item => item.id !== profile.id)])
    setModelProfiles(current => [
      ...projectModelProfiles([profile]),
      ...current.filter(model => model.providerAccountId !== profile.id),
    ])
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
    aiProviders,
    aiCapabilityProfiles,
    refreshProviderSettings,
    refreshAiProviders,
    refreshProviderAccounts,
    refreshModelProfiles,
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
