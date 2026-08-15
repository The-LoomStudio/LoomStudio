import type { ClientBridge, ClientJsonValue } from '@loom-studio/client-bridge'
import type { LogLevel, LogPage } from '@loom-studio/logging'
import type {
  AgentMessagePage,
  CreateAgentProfileResult,
  CreateAgentSessionResult,
  CreateCardResult,
  CreateNarrativeTimelineResult,
  CreatePromptResourceResult,
  DeleteCardResult,
  CreateProviderAccountResult,
  DeleteAgentProfileResult,
  DeleteProviderAccountResult,
  DeletePromptResourceResult,
  ForkNarrativeBranchResult,
  ExportCardBundleResult,
  ExportPromptResourceResult,
  GetCardResult,
  GetImportBundleResult,
  GetNarrativeTimelineResult,
  GetPromptResourceResult,
  ImportCardBundleResult,
  InvokeAgentTurnResult,
  ListAgentProfilesResult,
  ListCardsResult,
  ListProviderAccountsResult,
  ListCardPromptResourcesResult,
  ListPromptResourcesResult,
  ListNarrativeTimelinesResult,
  MutationReceipt,
  NarrativePage,
  PreviewAgentTurnResult,
  PromptResourceArtifact,
  SwitchNarrativeBranchResult,
  UpdatePromptResourceResult,
  UpdateCardResult,
  UpdateAgentProfileResult,
  UpdateProviderAccountResult,
} from '../../entities/index.js'

type JsonObject = { [key: string]: ClientJsonValue }

export type LogsListInput = {
  cursor?: string
  limit?: number
  levels?: LogLevel[]
  namespacePrefix?: string
  service?: string
  instanceId?: string
  since?: string
  until?: string
}

export type NetworkProxyMode = 'system' | 'direct' | 'manual'

export type NetworkSettings = {
  proxyMode: NetworkProxyMode
  proxyUrl?: string
  systemProxyDetected: boolean
}

export type StudioApi = {
  settings: {
    getNetwork(): Promise<NetworkSettings>
    updateNetwork(input: { proxyMode: NetworkProxyMode; proxyUrl?: string }): Promise<NetworkSettings>
  }
  logs: {
    list(input?: LogsListInput): Promise<LogPage>
  }
  history: {
    revert(changesetId: string): Promise<MutationReceipt>
  }
  importBundles: {
    get(importBundleId: string): Promise<GetImportBundleResult>
  }
  cards: {
    get(cardId: string): Promise<GetCardResult>
    list(input?: { cursor?: string; limit?: number }): Promise<ListCardsResult>
    create(input: JsonObject): Promise<CreateCardResult>
    update(input: JsonObject): Promise<UpdateCardResult>
    updatePromptResources(input: JsonObject): Promise<UpdateCardResult>
    delete(cardId: string): Promise<DeleteCardResult>
    export(cardId: string): Promise<ExportCardBundleResult>
  }
  agentSessions: {
    create(input: JsonObject): Promise<CreateAgentSessionResult>
    get(agentSessionId: string): Promise<{ session: import('../../entities/index.js').AgentSession }>
    getMessages(input: { agentSessionId: string; cursor?: string; limit?: number }): Promise<AgentMessagePage>
    invoke(input: JsonObject): Promise<InvokeAgentTurnResult>
    preview(input: JsonObject): Promise<PreviewAgentTurnResult>
  }
  providerAccounts: {
    list(): Promise<ListProviderAccountsResult>
    create(input: JsonObject): Promise<CreateProviderAccountResult>
    update(input: JsonObject): Promise<UpdateProviderAccountResult>
    replaceCredential(providerProfileId: string, credential: Record<string, string>): Promise<{ credential: { configured: boolean; updatedAt?: string } }>
    delete(providerAccountId: string): Promise<DeleteProviderAccountResult>
  }
  providerModels: {
    list(providerProfileId: string): Promise<string[]>
    ping(providerProfileId: string, modelId: string): Promise<string>
  }
  agentProfiles: {
    list(): Promise<ListAgentProfilesResult>
    create(input: JsonObject): Promise<CreateAgentProfileResult>
    update(input: JsonObject): Promise<UpdateAgentProfileResult>
    delete(agentProfileId: string): Promise<DeleteAgentProfileResult>
  }
  narratives: {
    createFromCard(input: JsonObject): Promise<CreateNarrativeTimelineResult>
    get(timelineId: string): Promise<GetNarrativeTimelineResult>
    list(input?: { createdFromCardId?: string; cursor?: string; limit?: number }): Promise<ListNarrativeTimelinesResult>
    getPage(input: { timelineId: string; branchId?: string; cursor?: string; limit?: number }): Promise<NarrativePage>
    fork(input: { timelineId: string; fromBranchId: string; fromNodeId: string; title?: string }): Promise<ForkNarrativeBranchResult>
    switch(input: { timelineId: string; branchId: string; expectedActiveBranchId?: string }): Promise<SwitchNarrativeBranchResult>
  }
  promptResources: {
    get(resourceId: string): Promise<GetPromptResourceResult>
    list(resourceKind?: 'preset' | 'setting'): Promise<ListPromptResourcesResult>
    create(input: JsonObject): Promise<CreatePromptResourceResult>
    duplicate(input: JsonObject): Promise<CreatePromptResourceResult>
    delete(resourceId: string): Promise<DeletePromptResourceResult>
    import(artifact: PromptResourceArtifact): Promise<CreatePromptResourceResult>
    export(resourceId: string): Promise<ExportPromptResourceResult>
    listForCard(cardId: string): Promise<ListCardPromptResourcesResult>
    updateAsset(input: JsonObject): Promise<UpdatePromptResourceResult>
    updateAssets(input: JsonObject): Promise<UpdatePromptResourceResult>
    updatePresetSettings(input: JsonObject): Promise<UpdatePromptResourceResult>
    createAsset(input: JsonObject): Promise<UpdatePromptResourceResult>
    moveAsset(input: JsonObject): Promise<UpdatePromptResourceResult>
    deleteAsset(input: JsonObject): Promise<UpdatePromptResourceResult>
  }
  cardBundles: {
    import(input: JsonObject): Promise<ImportCardBundleResult>
  }
}

export function createStudioApi(bridge: ClientBridge): StudioApi {
  return {
    settings: {
      getNetwork: () => bridge.call<NetworkSettings>('settings.network.get', {}),
      updateNetwork: input => bridge.call<NetworkSettings>('settings.network.update', input),
    },
    logs: {
      list: input => bridge.call<LogPage>('logs.list', (input ?? {}) as unknown as ClientJsonValue),
    },
    history: {
      revert: async changesetId => {
        const result = await bridge.call<{ changesetId: string }>('docs.revertChangeset', { changesetId })
        return { changesetId: result.changesetId }
      },
    },
    importBundles: {
      get: importBundleId => bridge.call<GetImportBundleResult>('application.getImportBundle', { importBundleId }),
    },
    cards: {
      get: cardId => bridge.call<GetCardResult>('application.getCard', { cardId }),
      list: input => bridge.call<ListCardsResult>('application.listCards', input ?? {}),
      create: input => bridge.call<CreateCardResult>('application.createCard', input),
      update: input => bridge.call<UpdateCardResult>('application.updateCard', input),
      updatePromptResources: input => bridge.call<UpdateCardResult>('application.updateCardPromptResources', input),
      delete: cardId => bridge.call<DeleteCardResult>('application.deleteCard', { cardId }),
      export: cardId => bridge.call<ExportCardBundleResult>('application.exportCardArtifact', { cardId }),
    },
    agentSessions: {
      create: input => bridge.call<CreateAgentSessionResult>('application.createAgentSession', input),
      get: agentSessionId => bridge.call('application.getAgentSession', { agentSessionId }),
      getMessages: input => bridge.call<AgentMessagePage>('application.getAgentMessagePage', input),
      invoke: input => bridge.call<InvokeAgentTurnResult>('application.invokeAgentTurn', input),
      preview: input => bridge.call<PreviewAgentTurnResult>('application.previewAgentTurn', input),
    },
    providerAccounts: {
      list: async () => {
        const result = await bridge.call<{ providerProfiles: ListProviderAccountsResult['providerAccounts']; nextCursor?: string }>('application.listProviderProfiles', {})
        return { providerAccounts: result.providerProfiles, nextCursor: result.nextCursor }
      },
      create: async input => {
        const result = await bridge.call<{ providerProfile: CreateProviderAccountResult['providerAccount'] }>('application.createProviderProfile', input)
        return { providerAccount: result.providerProfile }
      },
      update: async input => {
        const result = await bridge.call<{ providerProfile: UpdateProviderAccountResult['providerAccount'] }>('application.updateProviderProfile', input)
        return { providerAccount: result.providerProfile }
      },
      replaceCredential: (providerProfileId, credential) => bridge.call('application.replaceProviderCredential', {
        providerProfileId,
        credential,
      }),
      delete: async providerAccountId => {
        const result = await bridge.call<{ deleted: true }>('application.deleteProviderProfile', { providerProfileId: providerAccountId })
        return result
      },
    },
    providerModels: {
      list: async providerProfileId => {
        const result = await bridge.call<{ modelIds: string[] }>('application.listProviderModels', { providerProfileId })
        return result.modelIds
      },
      ping: async (providerProfileId, modelId) => {
        const result = await bridge.call<{ text: string }>('application.pingProviderModel', { providerProfileId, modelId })
        return result.text
      },
    },
    agentProfiles: {
      list: () => bridge.call<ListAgentProfilesResult>('application.listAgentProfiles', {}),
      create: input => bridge.call<CreateAgentProfileResult>('application.createAgentProfile', input),
      update: input => bridge.call<UpdateAgentProfileResult>('application.updateAgentProfile', input),
      delete: agentProfileId => bridge.call<DeleteAgentProfileResult>('application.deleteAgentProfile', { agentProfileId }),
    },
    narratives: {
      createFromCard: input => bridge.call<CreateNarrativeTimelineResult>('application.createNarrativeTimelineFromCard', input),
      get: timelineId => bridge.call<GetNarrativeTimelineResult>('application.getNarrativeTimeline', { timelineId }),
      list: input => bridge.call<ListNarrativeTimelinesResult>('application.listNarrativeTimelines', input ?? {}),
      getPage: input => bridge.call<NarrativePage>('application.getNarrativePage', input),
      fork: input => bridge.call<ForkNarrativeBranchResult>('application.forkNarrativeBranch', input),
      switch: input => bridge.call<SwitchNarrativeBranchResult>('application.switchNarrativeBranch', input),
    },
    promptResources: {
      get: resourceId => bridge.call<GetPromptResourceResult>('application.getPromptResource', { resourceId }),
      list: resourceKind => bridge.call<ListPromptResourcesResult>('application.listPromptResources', resourceKind ? { resourceKind } : {}),
      create: input => bridge.call<CreatePromptResourceResult>('application.createPromptResource', input),
      duplicate: input => bridge.call<CreatePromptResourceResult>('application.duplicatePromptResource', input),
      delete: resourceId => bridge.call<DeletePromptResourceResult>('application.deletePromptResource', { resourceId }),
      import: artifact => bridge.call<CreatePromptResourceResult>('application.importPromptResource', { artifact: artifact as unknown as ClientJsonValue }),
      export: resourceId => bridge.call<ExportPromptResourceResult>('application.exportPromptResource', { resourceId }),
      listForCard: cardId => bridge.call<ListCardPromptResourcesResult>('application.listCardPromptResources', { cardId }),
      createAsset: input => bridge.call<UpdatePromptResourceResult>('application.createPromptResourceAsset', input),
      updateAsset: input => bridge.call<UpdatePromptResourceResult>('application.updatePromptResourceAsset', input),
      updateAssets: input => bridge.call<UpdatePromptResourceResult>('application.updatePromptResourceAssets', input),
      updatePresetSettings: input => bridge.call<UpdatePromptResourceResult>('application.updatePresetSettings', input),
      moveAsset: input => bridge.call<UpdatePromptResourceResult>('application.movePromptResourceAsset', input),
      deleteAsset: input => bridge.call<UpdatePromptResourceResult>('application.deletePromptResourceAsset', input),
    },
    cardBundles: {
      import: input => bridge.call<ImportCardBundleResult>('application.importCardBundle', input),
    },
  }
}
