import type { ClientBridge, ClientJsonValue } from '@loom-studio/client-bridge'
import type { LogLevel, LogPage } from '@loom-studio/logging'
import type {
  AgentTranscript,
  CreateAgentRuntimeProfileResult,
  CreateCardResult,
  DeleteCardResult,
  CreateModelProfileResult,
  CreateProviderAccountResult,
  CreateSessionResult,
  DeleteAgentRuntimeProfileResult,
  DeleteModelProfileResult,
  DeleteProviderAccountResult,
  ForkBranchResult,
  ExportCardBundleResult,
  GetImportBundleResult,
  GetPromptResourceResult,
  ImportCardBundleResult,
  ListAgentRuntimeProfilesResult,
  ListCardsResult,
  ListModelProfilesResult,
  ListProviderAccountsResult,
  ListCardPromptResourcesResult,
  MutationReceipt,
  PromptPreview,
  RunDetails,
  SessionDetails,
  SubmitTurnResult,
  Timeline,
  UpdatePromptResourceResult,
  UpdateCardResult,
  UpdateAgentRuntimeProfileResult,
  UpdateModelProfileResult,
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

export type StudioApi = {
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
    list(): Promise<ListCardsResult>
    create(input: JsonObject): Promise<CreateCardResult>
    update(input: JsonObject): Promise<UpdateCardResult>
    delete(cardId: string): Promise<DeleteCardResult>
    export(cardId: string): Promise<ExportCardBundleResult>
  }
  providerAccounts: {
    list(): Promise<ListProviderAccountsResult>
    create(input: JsonObject): Promise<CreateProviderAccountResult>
    update(input: JsonObject): Promise<UpdateProviderAccountResult>
    delete(providerAccountId: string): Promise<DeleteProviderAccountResult>
  }
  modelProfiles: {
    list(): Promise<ListModelProfilesResult>
    create(input: JsonObject): Promise<CreateModelProfileResult>
    update(input: JsonObject): Promise<UpdateModelProfileResult>
    delete(modelProfileId: string): Promise<DeleteModelProfileResult>
    ping(modelProfileId: string): Promise<string>
  }
  agentRuntimeProfiles: {
    list(): Promise<ListAgentRuntimeProfilesResult>
    create(input: JsonObject): Promise<CreateAgentRuntimeProfileResult>
    update(input: JsonObject): Promise<UpdateAgentRuntimeProfileResult>
    delete(agentRuntimeProfileId: string): Promise<DeleteAgentRuntimeProfileResult>
  }
  sessions: {
    createFromCard(input: JsonObject): Promise<CreateSessionResult>
    get(sessionId: string): Promise<SessionDetails>
    fork(input: { sessionId: string; fromEntryId: string; title: string }): Promise<ForkBranchResult>
  }
  timeline: {
    get(input: JsonObject): Promise<Timeline>
  }
  agentTranscript: {
    get(input: JsonObject): Promise<AgentTranscript>
  }
  runs: {
    get(runId: string): Promise<RunDetails>
  }
  prompt: {
    preview(input: JsonObject): Promise<PromptPreview>
  }
  promptResources: {
    get(resourceId: string): Promise<GetPromptResourceResult>
    listForCard(cardId: string): Promise<ListCardPromptResourcesResult>
    updateAsset(input: JsonObject): Promise<UpdatePromptResourceResult>
    updateAssets(input: JsonObject): Promise<UpdatePromptResourceResult>
    createAsset(input: JsonObject): Promise<UpdatePromptResourceResult>
    moveAsset(input: JsonObject): Promise<UpdatePromptResourceResult>
    deleteAsset(input: JsonObject): Promise<UpdatePromptResourceResult>
  }
  cardBundles: {
    import(input: JsonObject): Promise<ImportCardBundleResult>
  }
  turns: {
    submit(input: JsonObject): Promise<SubmitTurnResult>
  }
}

export function createStudioApi(bridge: ClientBridge): StudioApi {
  return {
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
      list: () => bridge.call<ListCardsResult>('application.listCards', {}),
      create: input => bridge.call<CreateCardResult>('application.createCard', input),
      update: input => bridge.call<UpdateCardResult>('application.updateCard', input),
      delete: cardId => bridge.call<DeleteCardResult>('application.deleteCard', { cardId }),
      export: cardId => bridge.call<ExportCardBundleResult>('application.exportCardArtifact', { cardId }),
    },
    providerAccounts: {
      list: () => bridge.call<ListProviderAccountsResult>('application.listProviderAccounts', {}),
      create: input => bridge.call<CreateProviderAccountResult>('application.createProviderAccount', input),
      update: input => bridge.call<UpdateProviderAccountResult>('application.updateProviderAccount', input),
      delete: providerAccountId => bridge.call<DeleteProviderAccountResult>('application.deleteProviderAccount', { providerAccountId }),
    },
    modelProfiles: {
      list: () => bridge.call<ListModelProfilesResult>('application.listModelProfiles', {}),
      create: input => bridge.call<CreateModelProfileResult>('application.createModelProfile', input),
      update: input => bridge.call<UpdateModelProfileResult>('application.updateModelProfile', input),
      delete: modelProfileId => bridge.call<DeleteModelProfileResult>('application.deleteModelProfile', { modelProfileId }),
      ping: async modelProfileId => {
        const result = await bridge.call<{ text: string }>('application.pingModelProfile', { modelProfileId })
        return result.text
      },
    },
    agentRuntimeProfiles: {
      list: () => bridge.call<ListAgentRuntimeProfilesResult>('application.listAgentRuntimeProfiles', {}),
      create: input => bridge.call<CreateAgentRuntimeProfileResult>('application.createAgentRuntimeProfile', input),
      update: input => bridge.call<UpdateAgentRuntimeProfileResult>('application.updateAgentRuntimeProfile', input),
      delete: agentRuntimeProfileId => bridge.call<DeleteAgentRuntimeProfileResult>('application.deleteAgentRuntimeProfile', { agentRuntimeProfileId }),
    },
    sessions: {
      createFromCard: input => bridge.call<CreateSessionResult>('application.createSessionFromCard', input),
      get: sessionId => bridge.call<SessionDetails>('application.getSession', { sessionId }),
      fork: input => bridge.call<ForkBranchResult>('application.forkBranch', input),
    },
    timeline: {
      get: input => bridge.call<Timeline>('application.getTimeline', input),
    },
    agentTranscript: {
      get: input => bridge.call<AgentTranscript>('application.getAgentTranscript', input),
    },
    runs: {
      get: runId => bridge.call<RunDetails>('application.getRun', { runId }),
    },
    prompt: {
      preview: input => bridge.call<PromptPreview>('application.previewPrompt', input),
    },
    promptResources: {
      get: resourceId => bridge.call<GetPromptResourceResult>('application.getPromptResource', { resourceId }),
      listForCard: cardId => bridge.call<ListCardPromptResourcesResult>('application.listCardPromptResources', { cardId }),
      createAsset: input => bridge.call<UpdatePromptResourceResult>('application.createPromptResourceAsset', input),
      updateAsset: input => bridge.call<UpdatePromptResourceResult>('application.updatePromptResourceAsset', input),
      updateAssets: input => bridge.call<UpdatePromptResourceResult>('application.updatePromptResourceAssets', input),
      moveAsset: input => bridge.call<UpdatePromptResourceResult>('application.movePromptResourceAsset', input),
      deleteAsset: input => bridge.call<UpdatePromptResourceResult>('application.deletePromptResourceAsset', input),
    },
    cardBundles: {
      import: input => bridge.call<ImportCardBundleResult>('application.importCardBundle', input),
    },
    turns: {
      submit: input => bridge.call<SubmitTurnResult>('application.submitTurn', input),
    },
  }
}
