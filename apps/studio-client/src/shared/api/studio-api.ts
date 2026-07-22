import type { ClientBridge, ClientJsonValue } from '@loom-studio/client-bridge'
import type { Logger, LogLevel, LogPage } from '@loom-studio/logging'
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
  ExportWorkspaceArtifactResult,
  GetPromptWorkspaceResult,
  ImportWorkspaceArtifactResult,
  ListAgentRuntimeProfilesResult,
  ListCardsResult,
  ListModelProfilesResult,
  ListProviderAccountsResult,
  ListPromptWorkspacesResult,
  MutationReceipt,
  PromptPreview,
  RunDetails,
  SessionDetails,
  SubmitTurnResult,
  Timeline,
  UpdatePromptWorkspaceResult,
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
  cards: {
    list(): Promise<ListCardsResult>
    create(input: JsonObject): Promise<CreateCardResult>
    update(input: JsonObject): Promise<UpdateCardResult>
    delete(cardId: string): Promise<DeleteCardResult>
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
  promptWorkspaces: {
    import(input: JsonObject): Promise<ImportWorkspaceArtifactResult>
    get(workspaceId: string): Promise<GetPromptWorkspaceResult>
    list(input?: JsonObject): Promise<ListPromptWorkspacesResult>
    updateAsset(input: JsonObject): Promise<UpdatePromptWorkspaceResult>
    updateAssets(input: JsonObject): Promise<UpdatePromptWorkspaceResult>
    createAsset(input: JsonObject): Promise<UpdatePromptWorkspaceResult>
    moveAsset(input: JsonObject): Promise<UpdatePromptWorkspaceResult>
    deleteAsset(input: JsonObject): Promise<UpdatePromptWorkspaceResult>
    updateProjectionOrderProfile(input: JsonObject): Promise<UpdatePromptWorkspaceResult>
    export(workspaceId: string): Promise<ExportWorkspaceArtifactResult>
  }
  turns: {
    submit(input: JsonObject): Promise<SubmitTurnResult>
  }
}

export function withClientBridgeLogging(bridge: ClientBridge, logger: Logger): ClientBridge {
  return {
    ...bridge,
    call: <T = ClientJsonValue>(method: string, params?: ClientJsonValue) => logRpcFailure(logger, method, () => bridge.call<T>(method, params)),
    callWithMeta: <T = ClientJsonValue>(method: string, params?: ClientJsonValue) => logRpcFailure(logger, method, () => bridge.callWithMeta<T>(method, params)),
    request: async request => {
      const startedAt = performance.now()
      try {
        const response = await bridge.request(request)
        if (response.error) logRpcError(logger, request.method, startedAt, response.error)
        return response
      } catch (error) {
        logRpcError(logger, request.method, startedAt, error)
        throw error
      }
    },
  }
}

async function logRpcFailure<T>(logger: Logger, method: string, call: () => Promise<T>): Promise<T> {
  const startedAt = performance.now()
  try {
    return await call()
  } catch (error) {
    logRpcError(logger, method, startedAt, error)
    throw error
  }
}

function logRpcError(logger: Logger, method: string, startedAt: number, error: unknown): void {
  const durationMs = Number((performance.now() - startedAt).toFixed(2))
  logger.error(`${method} failed after ${durationMs} ms`, {
    event: 'rpc.failed',
    data: {
      method,
      durationMs,
      failureType: readFailureType(error),
      ...readErrorCode(error),
    },
  })
}

function readFailureType(error: unknown): string {
  return error instanceof Error ? error.name : typeof error
}

function readErrorCode(error: unknown): { errorCode?: string } {
  if (typeof error !== 'object' || error === null || !('code' in error)) return {}
  const code = error.code
  return typeof code === 'string' || typeof code === 'number' ? { errorCode: String(code) } : {}
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
    cards: {
      list: () => bridge.call<ListCardsResult>('application.listCards', {}),
      create: input => bridge.call<CreateCardResult>('application.createCard', input),
      update: input => bridge.call<UpdateCardResult>('application.updateCard', input),
      delete: cardId => bridge.call<DeleteCardResult>('application.deleteCard', { cardId }),
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
    promptWorkspaces: {
      import: input => bridge.call<ImportWorkspaceArtifactResult>('application.importWorkspaceArtifact', input),
      get: workspaceId => bridge.call<GetPromptWorkspaceResult>('application.getPromptWorkspace', { workspaceId }),
      list: input => bridge.call<ListPromptWorkspacesResult>('application.listPromptWorkspaces', input ?? {}),
      createAsset: input => bridge.call<UpdatePromptWorkspaceResult>('application.createPromptAsset', input),
      updateAsset: input => bridge.call<UpdatePromptWorkspaceResult>('application.updatePromptAsset', input),
      updateAssets: input => bridge.call<UpdatePromptWorkspaceResult>('application.updatePromptAssets', input),
      moveAsset: input => bridge.call<UpdatePromptWorkspaceResult>('application.movePromptAsset', input),
      deleteAsset: input => bridge.call<UpdatePromptWorkspaceResult>('application.deletePromptAsset', input),
      updateProjectionOrderProfile: input => bridge.call<UpdatePromptWorkspaceResult>('application.updateProjectionOrderProfile', input),
      export: workspaceId => bridge.call<ExportWorkspaceArtifactResult>('application.exportWorkspaceArtifact', { workspaceId }),
    },
    turns: {
      submit: input => bridge.call<SubmitTurnResult>('application.submitTurn', input),
    },
  }
}
