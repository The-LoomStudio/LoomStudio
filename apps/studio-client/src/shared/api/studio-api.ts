import { createResourceDownloadsClient } from './resource-downloads-client.js'
import type { JsonValue as ClientJsonValue } from '@loom-studio/shared'
import type { ExtensionEntityRef, ExtensionInstallationTarget, ExtensionStorageScope } from '@loom-studio/extension-sdk'
import type { LogHistoryQuery, LogQuery } from '@loom-studio/logging'
import type { ReplaceLoreMountsInput } from '@loom-studio/shared'
import type { TimelineExtensionAdoptionPreview, TimelineExtensionRecoveryPreview } from '../../entities/extension.js'
import type {
  AiGatewayInvokeInput,
  ApplyStateMutationInput,
  HistorySource,
  InspectStateSourcesInput,
  LoomScriptOwner,
  LoreMountSource,
  PortableExtensionPayloadDraft,
  PromptResourceArtifact,
  StateDefinitionDraft,
  StateTarget,
  TextExtractorDraft,
  TextTransformPhase,
  TextTransformRuleDraft
} from '../../entities/index.js'
import { createDefaultTitle } from '../i18n/creation-title.js'
import { createStudioTrpcClient, type StudioRpcInputs, type StudioRpcOutputs, type StudioTrpcClient } from './trpc-client.js'
export type AgentMutationApproval = Pick<Extract<StudioRpcOutputs['application']['agent.run.subscribe']['events'][number], { type: 'mutation-approval-requested' }>, 'requestId' | 'preview'> & { action?: never } | Pick<Extract<StudioRpcOutputs['application']['agent.run.subscribe']['events'][number], { type: 'history-read-approval-requested' }>, 'requestId' | 'action'> & { preview?: never }

type LogsListInput = Omit<LogQuery, 'limit'> & { limit?: number }

export type NetworkSettings = StudioRpcOutputs['settings']['network']['get']
type NetworkProxyMode = NetworkSettings['proxyMode']

// ─── Card DTOs ──────────────────────────────────────────────────────────────

type CreateCardInput = NonNullable<StudioRpcInputs['application']['createCard']>

type UpdateCardInput = NonNullable<StudioRpcInputs['application']['updateCard']>

type UpdateCardPromptResourcesInput = NonNullable<StudioRpcInputs['application']['updateCardPromptResources']>

// ─── Agent Session DTOs ─────────────────────────────────────────────────────

type CreateAgentSessionInput = NonNullable<StudioRpcInputs['application']['createAgentSession']>

type InvokeAgentTurnInput = NonNullable<StudioRpcInputs['application']['invokeAgentTurn']>

type PreviewAgentTurnInput = NonNullable<StudioRpcInputs['application']['previewAgentTurn']>

// ─── Provider & Agent Preset DTOs ──────────────────────────────────────────

type CreateProviderProfileInput = NonNullable<StudioRpcInputs['application']['createProviderProfile']>

type UpdateProviderProfileInput = NonNullable<StudioRpcInputs['application']['updateProviderProfile']>

type CreateAgentPresetInput = NonNullable<StudioRpcInputs['application']['createAgentPreset']>

type UpdateAgentPresetInput = NonNullable<StudioRpcInputs['application']['updateAgentPreset']>

// ─── Narrative DTOs ─────────────────────────────────────────────────────────

type CreateNarrativeTimelineInput = NonNullable<StudioRpcInputs['application']['createNarrativeTimeline']>

type ForkNarrativeBranchInput = NonNullable<StudioRpcInputs['application']['forkNarrativeBranch']>

type SwitchNarrativeBranchInput = NonNullable<StudioRpcInputs['application']['switchNarrativeBranch']>

// ─── Prompt Resource DTOs ───────────────────────────────────────────────────

type CreatePromptResourceInput = NonNullable<StudioRpcInputs['application']['createPromptResource']>

type DuplicatePromptResourceInput = NonNullable<StudioRpcInputs['application']['duplicatePromptResource']>

type CreatePromptResourceAssetInput = NonNullable<StudioRpcInputs['application']['createPromptResourceAsset']>

type UpdatePromptResourceAssetInput = NonNullable<StudioRpcInputs['application']['updatePromptResourceAsset']>

type UpdatePromptResourceAssetsInput = NonNullable<StudioRpcInputs['application']['updatePromptResourceAssets']>

type MovePromptResourceAssetInput = NonNullable<StudioRpcInputs['application']['movePromptResourceAsset']>

type DeletePromptResourceAssetInput = NonNullable<StudioRpcInputs['application']['deletePromptResourceAsset']>

// ─── Card Bundle DTOs ───────────────────────────────────────────────────────

type ImportCardBundleInput = NonNullable<StudioRpcInputs['application']['importCardBundle']>

// ─── Studio API Interface ───────────────────────────────────────────────────

type InspectMacrosInput = NonNullable<StudioRpcInputs['application']['inspectMacros']>

export type StudioApi = ReturnType<typeof createStudioApi>

export function createStudioApi(trpc: StudioTrpcClient = createStudioTrpcClient()) {
  const providerProfiles = {
    list: (input?: { cursor?: string; limit?: number }) => trpc.application['listProviderProfiles'].query((input ?? {})),
    create: (input: CreateProviderProfileInput) => trpc.application['createProviderProfile'].mutate(input),
    update: (input: UpdateProviderProfileInput) => trpc.application['updateProviderProfile'].mutate(input),
    replaceCredential: (providerProfileId: string, credential: Record<string, string>) => trpc.application['replaceProviderCredential'].mutate({
      providerProfileId,
      credential,
    }),
    delete: (providerProfileId: string) => trpc.application['deleteProviderProfile'].mutate({
      providerProfileId,
    }),
  }

  return {
    dashboard: {
      usage: (input: StudioRpcInputs['dashboard']['usage']) => trpc.dashboard.usage.query(input),
      usageRequests: (input: StudioRpcInputs['dashboard']['usageRequests']) => trpc.dashboard.usageRequests.query(input),
      play: (input: StudioRpcInputs['dashboard']['play']) => trpc.dashboard.play.query(input),
      resources: () => trpc.dashboard.resources.query(),
      storage: (refresh = false) => trpc.dashboard.storage.query({ refresh }),
      database: () => trpc.dashboard.database.query(),
    },
    observations: {
      references: (input: StudioRpcInputs['application']['observations.references']) => trpc.application['observations.references'].query(input),
      persistence: () => trpc.application['observations.persistence'].query(),
      setPersistence: (enabled: boolean) => trpc.application['observations.setPersistence'].mutate({ enabled }),
      list: (input: import('../../entities/observation.js').ObservationListInput = {}) => trpc.application['observations.list'].query(input),
      get: (id: string) => trpc.application['observations.get'].query({ id }),
      getRequest: (id: string) => trpc.application['observations.getRequest'].query({ id }),
      getBuild: (id: string) => trpc.application['observations.getBuild'].query({ id }),
    },
    globalSearch: {
      search: (input: StudioRpcInputs['application']['searchResources'], signal?: AbortSignal) => trpc.application.searchResources.query(input, { signal }),
      scopes: (input: StudioRpcInputs['application']['listGlobalSearchScopes'], signal?: AbortSignal) => trpc.application.listGlobalSearchScopes.query(input, { signal }),
    },
    officialContent: {
      list: () => trpc.official.listContent.query(undefined),
      install: (input: { packageId: string; digest: string }) => trpc.official.installContent.mutate(input),
      export: (input: { packageId: string; digest: string }) => trpc.official.exportContent.query(input),
    },
    resourceDownloads: createResourceDownloadsClient(trpc),
    extensions: {
      listRecoveryRecords: () => trpc.extensions.listRecoveryRecords.query(),
      listModuleBatches: () => trpc.extensions.listModuleBatches.query(),
      getModuleBatch: (batchId: string) => trpc.extensions.getModuleBatch.query({ batchId }),
      startModuleBatch: (input: StudioRpcInputs['extensions']['startModuleBatch']) => trpc.extensions.startModuleBatch.mutate(input),
      previewPackageResources: (input: StudioRpcInputs['extensions']['previewPackageResources']) => trpc.extensions.previewPackageResources.query(input),
      previewRemoteInstall: (sources: import('@loom-studio/extension-sdk').ExtensionDownloadSource[]) => trpc.extensions.previewRemoteInstall.mutate({ sources }),
      previewPackageZip: (base64: string) => trpc.extensions.previewPackageZip.mutate({ base64 }),
      commitRemoteInstall: (token: string) => trpc.extensions.commitRemoteInstall.mutate({ token }),
      checkRemoteUpdate: (packageId: string) => trpc.extensions.checkRemoteUpdate.query({ packageId }),
      previewRemoteChange: (input: { packageId: string; ref?: string; rollback?: boolean }) => trpc.extensions.previewRemoteChange.mutate(input),
      officialSetup: () => trpc.extensions.officialSetup.query(undefined),
      finishOfficialSetup: () => trpc.extensions.finishOfficialSetup.mutate(undefined),
      list: (target?: ExtensionInstallationTarget) => trpc.extensions.listPackages.query(target ? { target } : {}),
      installCard: (input: { cardId: string; packageId: string; expectedCardVersion: number }) => trpc.extensions.installCardPackage.mutate(input),
      updateCard: (input: { cardId: string; packageId: string; expectedCardVersion: number; packageVersion: string; expectedInstallationVersion: number; expectedPreviewFingerprint?: string; keepPromptResourceIds?: string[] }) => trpc.extensions.updateCardPackage.mutate(input),
      uninstallCard: (input: { cardId: string; packageId: string; expectedInstallationVersion: number }) => trpc.extensions.uninstallCardPackage.mutate(input),
      installZip: (base64: string) => trpc.extensions.installPackageZip.mutate({ base64 }),
      enable: (packageId: string, moduleId: string, grants?: { ui?: Array<'ui.notify'>; 'events.subscribe'?: import('@loom-studio/extension-sdk').EventCapabilityCategory[]; assets?: Array<'assets.read' | 'assets.publish'> }, target?: ExtensionInstallationTarget) => trpc.extensions.enableModule.mutate({ packageId, moduleId, ...(grants ? { grants } : {}), ...(target ? { target } : {}) }),
      disable: (packageId: string, moduleId: string, target?: ExtensionInstallationTarget) => trpc.extensions.disableModule.mutate({ packageId, moduleId, ...(target ? { target } : {}) }),
      reload: (packageId: string, moduleId: string, target?: ExtensionInstallationTarget) => trpc.extensions.reloadModule.mutate({ packageId, moduleId, ...(target ? { target } : {}) }),
      uninstall: (packageId: string, version?: string, deleteData?: boolean) => trpc.extensions.uninstallPackage.mutate({ packageId, ...(version ? { version } : {}), ...(deleteData ? { deleteData } : {}) }),
      importResources: (packageId: string) => trpc.extensions.importPackageResources.mutate({ packageId }),
      listCharacters: (packageId: string) => trpc.extensions.listCharacters.query({ packageId }),
      previewCharacter: (packageId: string, characterId: string) => trpc.extensions.previewCharacter.query({ packageId, characterId }),
      importCharacter: (input: { packageId: string; characterId: string; digest: string; allowDuplicate?: boolean }) => trpc.extensions.importCharacter.mutate(input),
      exportPackage: (input: { packageId: string; version: string }) => trpc.extensions.exportPackage.query(input),
      importCardResources: (input: { cardId: string; packageId: string; expectedCardVersion: number }) => trpc.extensions.importCardPackageResources.mutate(input),
      updateCardResources: (input: { cardId: string; packageId: string; expectedCardVersion: number; packageVersion: string; expectedInstallationVersion: number; expectedPreviewFingerprint?: string; keepPromptResourceIds?: string[] }) => trpc.extensions.updateCardPackageResources.mutate(input),
      removeCardResources: (input: { cardId: string; packageId: string; expectedInstallationVersion: number }) => trpc.extensions.removeCardPackageResources.mutate(input),
      updateResources: (input: { packageId: string; packageVersion: string; expectedInstallationVersion: number; expectedPreviewFingerprint?: string; keepPromptResourceIds?: string[] }) => trpc.extensions.updatePackageResources.mutate(input),
      removeResources: (packageId: string) => trpc.extensions.removePackageResources.mutate({ packageId }),
      diagnostics: (packageId?: string, moduleId?: string) => trpc.extensions.getDiagnostics.query({
        ...(packageId ? { packageId } : {}),
        ...(moduleId ? { moduleId } : {}),
      }),
    },
    extensionRuntime: {
      importConvertedBatch: (input: { packageId: string; target: ExtensionInstallationTarget; sessionId: string }) => trpc.extensions.importConvertedBatch.mutate(input),
      listConfigs: (input: { packageId: string; target?: ExtensionInstallationTarget; scope?: ExtensionStorageScope }) => trpc.application['listExtensionConfigs'].query(input),
      getConfig: (input: { packageId: string; target?: ExtensionInstallationTarget; scope: ExtensionStorageScope; key: string }) => trpc.application['getExtensionConfig'].query(input),
      upsertConfig: (input: { packageId: string; target?: ExtensionInstallationTarget; scope: ExtensionStorageScope; key: string; value: ClientJsonValue; expectedVersion?: number }) => trpc.application['upsertExtensionConfig'].mutate(input),
      listRecords: (input: { packageId: string; target?: ExtensionInstallationTarget; scope?: ExtensionStorageScope; recordType?: string; binding?: ExtensionEntityRef }) => trpc.application['listExtensionRecords'].query(input),
      getRecord: (packageId: string, recordId: string, target?: ExtensionInstallationTarget) => trpc.application['getExtensionRecord'].query({ packageId, recordId, ...(target ? { target } : {}) }),
      call: (method: string, params?: ClientJsonValue) => trpc.kernel.invoke.mutate({ method, params }),
      callInstalled: (input: { packageId: string; target: ExtensionInstallationTarget; method: string; params?: ClientJsonValue }) => trpc.extensions.callPackageRpc.mutate(input),
    },
    settings: {
      getNetwork: () => trpc.settings.network.get.query(undefined),
      updateNetwork: (input: { proxyMode: NetworkProxyMode; proxyUrl?: string }) => trpc.settings.network.update.mutate(input),
    },
    logs: {
      list: (input?: LogsListInput) => trpc.logs.list.query((input ?? {})),
      history: (input: LogHistoryQuery, signal?: AbortSignal) => trpc.logs.history.query(input, { signal }),
    },
    history: {
      revert: async (changesetId: string) => {
        const result = await trpc.application['revertChangeset'].mutate({ changesetId })
        return result.mutation
      },
    },
    states: {
      inspectSources: (input: InspectStateSourcesInput) => trpc.application['inspectStateSources'].query(input),
      get: (target: StateTarget, extensionTarget?: ExtensionInstallationTarget) => trpc.application['getStateSnapshot'].query({ target, ...(extensionTarget ? { extensionTarget } : {}) }),
      apply: (input: ApplyStateMutationInput) => trpc.application['applyStateMutation'].mutate(input),
      listDefinitions: (kind?: StateDefinitionDraft['kind'], ids?: string[]) => trpc.application['listStateDefinitions'].query({
        ...(kind !== undefined ? { kind } : {}), ...(ids !== undefined ? { ids } : {}),
      }),
      getDefinition: (definitionId: string) => trpc.application['getStateDefinition'].query({ definitionId }),
      upsertDefinition: (input: { definitionId: string; expectedVersion?: number; definition: StateDefinitionDraft }) => trpc.application['upsertStateDefinition'].mutate(input),
      deleteDefinition: (input: { definitionId: string; expectedVersion?: number }) => trpc.application['deleteStateDefinition'].mutate(input),
    },
    macros: {
      inspect: (input: InspectMacrosInput) => trpc.application['inspectMacros'].query(input),
      getConfig: (input: { timelineId: string; presetId: string }) => trpc.application['getTimelinePresetConfig'].query(input),
      updateConfig: (input: { timelineId: string; presetId: string; expectedVersion: number; macroSelections: import('@loom-studio/shared').MacroSelectionMap }) => trpc.application['updateTimelinePresetConfig'].mutate(input),
    },
    loomScripts: {
      remove: (input: StudioRpcInputs['application']['deleteLoomScript']) => trpc.application.deleteLoomScript.mutate(input),
      reorder: (input: StudioRpcInputs['application']['reorderLoomScripts']) => trpc.application.reorderLoomScripts.mutate(input),
      preview: (input: StudioRpcInputs['application']['previewLoomScript']) => trpc.application.previewLoomScript.query(input),
      listConfigs: (input: StudioRpcInputs['application']['listLoomScriptConfigs']) => trpc.application.listLoomScriptConfigs.query(input),
      upsertConfig: (input: StudioRpcInputs['application']['upsertLoomScriptConfig']) => trpc.application.upsertLoomScriptConfig.mutate(input),
      getSettings: (input: StudioRpcInputs['application']['getLoomScriptSettings']) => trpc.application.getLoomScriptSettings.query(input),
      removeMount: (input: StudioRpcInputs['application']['deleteLoomScriptMount']) => trpc.application.deleteLoomScriptMount.mutate(input),
      import: (input: StudioRpcInputs['application']['importLoomScript']) => trpc.application['importLoomScript'].mutate(input),
      update: (input: { scriptDocumentId: string; expectedVersion: number; fileName: string; source: string }) => trpc.application['updateLoomScript'].mutate(input),
      get: (scriptDocumentId: string) => trpc.application['getLoomScript'].query({ scriptDocumentId }),
      getSummary: (scriptDocumentId: string) => trpc.application['getLoomScriptSummary'].query({ scriptDocumentId }),
      list: (owner?: LoomScriptOwner) => trpc.application['listLoomScripts'].query(owner ? { owner } : {}),
      export: (scriptDocumentId: string) => trpc.application['exportLoomScript'].query({ scriptDocumentId }),
      createMount: (input: StudioRpcInputs['application']['createLoomScriptMount']) => trpc.application.createLoomScriptMount.mutate(input),
      updateMount: (input: StudioRpcInputs['application']['updateLoomScriptMount']) => trpc.application.updateLoomScriptMount.mutate(input),
      refreshMount: (input: StudioRpcInputs['application']['refreshLoomScriptMount']) => trpc.application.refreshLoomScriptMount.mutate(input),
      listMounts: (target?: Exclude<StudioRpcInputs['application']['listLoomScriptMounts'], void>['target']) => trpc.application.listLoomScriptMounts.query(target ? { target } : {}),
      resolveRendererMounts: (input?: { workspaceId?: string; timelineId?: string; presetId?: string; cardId?: string }) => trpc.application.resolveLoomScriptRendererMounts.query(input ?? {}),
      reconcileRuntime: (input?: StudioRpcInputs['application']['reconcileLoomScriptRuntime']) => trpc.application.reconcileLoomScriptRuntime.mutate(input ?? {}),
    },
    textTransforms: {
      previewCardOpening: (input: { cardId: string; presetId?: string; text: string }) => trpc.application['previewCardOpeningDisplay'].query(input),
      listRules: (owner?: TextTransformRuleDraft['owner']) => trpc.application['listTextTransformRules'].query(owner !== undefined ? { owner } : {}),
      listRuleSummaries: (owner?: TextTransformRuleDraft['owner']) => trpc.application['listTextTransformRuleSummaries'].query(owner !== undefined ? { owner } : {}),
      getRule: (ruleId: string) => trpc.application['getTextTransformRule'].query({ ruleId }),
      upsertRule: (input: { ruleId: string; expectedVersion?: number; rule: TextTransformRuleDraft }) => trpc.application['upsertTextTransformRule'].mutate(input),
      deleteRule: (input: { ruleId: string; expectedVersion?: number }) => trpc.application['deleteTextTransformRule'].mutate(input),
      listExtractors: () => trpc.application['listTextExtractors'].query(undefined),
      listExtractorSummaries: () => trpc.application['listTextExtractorSummaries'].query(undefined),
      getExtractor: (extractorId: string) => trpc.application['getTextExtractor'].query({ extractorId }),
      upsertExtractor: (input: { extractorId: string; expectedVersion?: number; extractor: TextExtractorDraft }) => trpc.application['upsertTextExtractor'].mutate(input),
      deleteExtractor: (input: { extractorId: string; expectedVersion?: number }) => trpc.application['deleteTextExtractor'].mutate(input),
      getOverride: (input: { source: HistorySource; phase: TextTransformPhase; consumerAgentSessionId?: string }) => trpc.application['getTextPipelineOverride'].query(input),
      upsertOverride: (input: { source: HistorySource; phase: TextTransformPhase; consumerAgentSessionId?: string; expectedVersion?: number; disabledRuleIds: string[]; orderedRuleIds: string[] }) => trpc.application['upsertTextPipelineOverride'].mutate(input),
      deleteOverride: (input: { source: HistorySource; phase: TextTransformPhase; consumerAgentSessionId?: string; expectedVersion?: number }) => trpc.application['deleteTextPipelineOverride'].mutate(input),
      project: (input: { source: HistorySource; phase: TextTransformPhase; entryIds?: string[]; streamingEntries?: Array<{ id: string; text: string; role?: 'user' | 'assistant' }>; consumerAgentSessionId?: string; extensionTarget?: ExtensionInstallationTarget }) => trpc.application['projectHistory'].mutate(input),
      inspectTextPipeline: (input: { source: HistorySource; phase: TextTransformPhase; consumerAgentSessionId?: string; traceEntryId?: string }) => trpc.application['inspectTextPipeline'].query(input),
      extract: (input: { source: HistorySource; phase?: TextTransformPhase; extractorId: string; consumerAgentSessionId?: string; extensionTarget?: ExtensionInstallationTarget }) => trpc.application['extractHistory'].mutate(input),
      listRenderers: () => trpc.application['listRenderers'].query(undefined),
    },
    directories: {
      importDirectory: (directory: string, token: string) => trpc.directories.import.mutate({ directory, token }),
      previewApply: (cardId: string) => trpc.directories.previewApply.query({ cardId }),
      apply: (cardId: string, token: string) => trpc.directories.applyChanges.mutate({ cardId, token }),
      attachment: (directory: string, path: string) => trpc.directories.attachment.query({ directory, path }),
      list: () => trpc.directories.list.query(undefined),
      scan: () => trpc.directories.scan.query(undefined),
      open: (directory: string) => trpc.directories.open.query({ directory }),
    },
    userBackgrounds: {
      get: () => trpc.application.getUserBackgrounds.query(undefined),
      add: (input: StudioRpcInputs['application']['addUserBackground']) => trpc.application.addUserBackground.mutate(input),
      remove: (input: StudioRpcInputs['application']['removeUserBackground']) => trpc.application.removeUserBackground.mutate(input),
    },
    userProfiles: {
      get: () => trpc.application.getUserProfiles.query(undefined),
      create: (input: StudioRpcInputs['application']['createUserProfile']) => trpc.application.createUserProfile.mutate(input),
      update: (input: StudioRpcInputs['application']['updateUserProfile']) => trpc.application.updateUserProfile.mutate(input),
      select: (input: StudioRpcInputs['application']['selectUserProfile']) => trpc.application.selectUserProfile.mutate(input),
      delete: (input: StudioRpcInputs['application']['deleteUserProfile']) => trpc.application.deleteUserProfile.mutate(input),
    },
    cards: {
      get: (cardId: string) => trpc.application['getCard'].query({ cardId }),
      list: (input?: { cursor?: string; limit?: number }) => trpc.application['listCards'].query((input ?? {})),
      fork: (input: { cardId: string; expectedVersion: number }) => trpc.application['forkCard'].mutate(input),
      create: (input: CreateCardInput) => trpc.application['createCard'].mutate(input),
      update: (input: UpdateCardInput) => trpc.application['updateCard'].mutate(input),
      updatePromptResources: (input: UpdateCardPromptResourcesInput) => trpc.application['updateCardPromptResources'].mutate(input),
      attachExtensionPackage: (input: { cardId: string; expectedVersion: number; archive: { packageId: string; version: string; archiveBase64: string } }) => trpc.application['attachCardExtensionPackage'].mutate(input),
      detachExtensionPackage: (input: { cardId: string; expectedVersion: number; packageId: string }) => trpc.application['detachCardExtensionPackage'].mutate(input),
      previewDeletion: (cardId: string) => trpc.application['previewCardDeletion'].query({ cardId }),
      delete: (cardId: string, options?: { includePlayData?: boolean; includePromptResources?: boolean }) => trpc.application['deleteCard'].mutate({
        cardId,
        ...(options?.includePlayData ? { includePlayData: true } : {}),
        ...(options?.includePromptResources ? { includePromptResources: true } : {}),
      }),
      deleteMany: (cardIds: string[], options?: { includePlayData?: boolean; includePromptResources?: boolean }) => trpc.application['deleteCards'].mutate({
        cardIds,
        ...(options?.includePlayData ? { includePlayData: true } : {}),
        ...(options?.includePromptResources ? { includePromptResources: true } : {}),
      }),
      export: (cardId: string) => trpc.application['exportCardBundle'].query({ cardId }),
      previewDirectory: (cardId: string) => trpc.directories.previewCard.query({ cardId }),
      saveDirectory: (cardId: string, token: string) => trpc.directories.saveCard.mutate({ cardId, token }),
      recoverDirectory: (cardId: string) => trpc.directories.recoverCard.mutate({ cardId }),
    },
    workspace: {
      get: (input: StudioRpcInputs['application']['getTimelineWorkspace']) => trpc.application.getTimelineWorkspace.query(input),
      read: (input: StudioRpcInputs['application']['readWorkspaceFile']) => trpc.application.readWorkspaceFile.query(input),
      mutate: (input: StudioRpcInputs['application']['mutateTimelineWorkspace']) => trpc.application.mutateTimelineWorkspace.mutate(input),
    },
    agentSessions: {
      summaryTasks: (agentSessionId: string) => trpc.application.listAgentSessionSummaryTasks.query({ agentSessionId }),
      summaryStatus: (agentSessionId: string) => trpc.application.getAgentSessionSummaryStatus.query({ agentSessionId }),
      updateSummary: (input: { agentSessionId: string; branchId?: string; expectedSummaryId: string; expectedEntryCount: number; content: string }) => trpc.application.updateAgentSessionSummary.mutate({ ...input, branchId: input.branchId }),
      memory: (input: { agentSessionId: string; branchId?: string }) => trpc.application.getAgentSessionMemory.query({ ...input, branchId: input.branchId }),
      summarize: (input: { agentSessionId: string; branchId?: string }) => trpc.application.summarizeAgentSession.mutate({ ...input, branchId: input.branchId }),
      cancelSummary: (agentSessionId: string) => trpc.application.cancelAgentSessionSummary.mutate({ agentSessionId }),

      listRuns: (input?: { timelineId?: string }, signal?: AbortSignal) => trpc.application['agent.run.list'].query(input ?? {}, { signal }),
      create: (input: CreateAgentSessionInput) => trpc.application['createAgentSession'].mutate({
        ...input, title: input.title ?? createDefaultTitle('session'),
      }),
      list: (input?: { agentPresetId?: string; timelineId?: string; standalone?: boolean; cursor?: string; limit?: number }) => trpc.application['listAgentSessions'].query((input ?? {})),
      get: (agentSessionId: string) => trpc.application['getAgentSession'].query({ agentSessionId }),
      getTranscript: (input: { agentSessionId: string; cursor?: string; limit?: number; selectedCandidates?: boolean }) => trpc.application['getAgentTranscriptPage'].query(input),
      reviseInput: (input: NonNullable<StudioRpcInputs['application']['reviseAgentInput']>) => trpc.application['reviseAgentInput'].mutate(input),
      submitInterjection: (input: NonNullable<StudioRpcInputs['application']['submitAgentInterjection']>) => trpc.application['submitAgentInterjection'].mutate(input),
      invoke: (input: InvokeAgentTurnInput) => trpc.application['invokeAgentTurn'].mutate(input),
      createRun: (input: InvokeAgentTurnInput) => trpc.application['agent.run.create'].mutate(input),
      subscribeRun: (runId: string, cursor?: number, agentSessionId?: string) => trpc.application['agent.run.subscribe'].query({ runId, ...(cursor === undefined ? {} : { cursor }), ...(agentSessionId === undefined ? {} : { agentSessionId }) }),
      acknowledgeRunCompletion: (runId: string) => trpc.application['agent.run.acknowledge-completion'].mutate({ runId }),
      cancelRun: (runId: string, reason?: string) => trpc.application['agent.run.cancel'].mutate({ runId, ...(reason ? { reason } : {}) }),
      abandonRun: (runId: string, agentSessionId?: string) => trpc.application['agent.run.abandon'].mutate({ runId, agentSessionId }),
      pauseRun: (runId: string) => trpc.application['agent.run.pause'].mutate({ runId }),
      resumeRun: (runIdOrOptions: string | { runId?: string; agentSessionId?: string }) => trpc.application['agent.run.resume'].mutate(typeof runIdOrOptions === 'string' ? { runId: runIdOrOptions } : runIdOrOptions),
      approveHistoryRead: (runId: string, requestId: string, allow: boolean, reason?: string) => trpc.application['agent.run.history-read-approval'].mutate({
        runId, requestId, allow, ...(reason ? { reason } : {}),
      }),
      approveMutation: (runId: string, requestId: string, allow: boolean, reason?: string) => trpc.application['agent.run.mutation-approval'].mutate({
        runId, requestId, allow, ...(reason ? { reason } : {}),
      }),
      runState: (runId: string, agentSessionId?: string) => trpc.application['agent.run.state'].query({ runId, agentSessionId }),
      preview: (input: PreviewAgentTurnInput) => trpc.application['previewAgentTurn'].query(input),
      delete: (agentSessionId: string) => trpc.application['deleteAgentSession'].mutate({ agentSessionId }),
      update: (input: NonNullable<StudioRpcInputs['application']['updateAgentSession']>) => trpc.application['updateAgentSession'].mutate(input),
    },
    providerProfiles,
    providerAccounts: providerProfiles,
    aiCapabilityProfiles: {
      list: (input?: { providerProfileId?: string; capabilityId?: string; cursor?: string; limit?: number }) => trpc.application['listAiCapabilityProfiles'].query((input ?? {})),
      create: (input: { providerProfileId: string; capabilityId: string; displayName: string; config?: Record<string, ClientJsonValue> }) => trpc.application['createAiCapabilityProfile'].mutate(input),
      update: (input: { profileId: string; providerProfileId?: string; displayName?: string; config?: Record<string, ClientJsonValue> }) => trpc.application['updateAiCapabilityProfile'].mutate(input),
      delete: (profileId: string) => trpc.application['deleteAiCapabilityProfile'].mutate({ profileId }),
    },
    providerModels: {
      list: async (providerProfileId: string) => {
        const result = await trpc.application['listProviderModels'].query({ providerProfileId })
        return result.modelIds
      },
      ping: async (providerProfileId: string, modelId: string) => {
        const result = await trpc.application['pingProviderModel'].mutate({ providerProfileId, modelId })
        return result.text
      },
    },
    aiGateway: {
      listProviders: async () => {
        const result = await trpc.ai.providers.list.query(undefined)
        return result.providers
      },
      invoke: (input: Omit<AiGatewayInvokeInput, 'signal' | 'caller'>) => trpc.ai.invoke.mutate(input),
      createRun: (input: Omit<AiGatewayInvokeInput, 'signal' | 'caller'>) => trpc.ai.run.create.mutate(input),
      subscribe: (runId: string, cursor?: number) => trpc.ai.run.subscribe.query({ runId, ...(cursor === undefined ? {} : { cursor }) }),
      cancel: (runId: string, reason?: string) => trpc.ai.run.cancel.mutate({ runId, ...(reason ? { reason } : {}) }),
      state: (runId: string) => trpc.ai.run.state.query({ runId }),
    },
    agentPresets: {
      list: (input?: { cursor?: string; limit?: number }) => trpc.application['listAgentPresets'].query((input ?? {})),
      create: (input: CreateAgentPresetInput) => trpc.application['createAgentPreset'].mutate(input),
      update: (input: UpdateAgentPresetInput) => trpc.application['updateAgentPreset'].mutate(input),
      delete: (agentPresetId: string) => trpc.application['deleteAgentPreset'].mutate({ agentPresetId }),
    },
    agentTools: {
      list: () => trpc.application['listAgentTools'].query(undefined),
      getSummary: (toolId: string) => trpc.application['getAgentToolSummary'].query({ toolId }),
      update: (input: StudioRpcInputs['application']['updateAgentTool']) => trpc.application['updateAgentTool'].mutate(input),
    },
    narratives: {
      getSwipes: (input: StudioRpcInputs['application']['getNarrativeSwipes']) => trpc.application['getNarrativeSwipes'].query(input),
      selectSwipe: (input: StudioRpcInputs['application']['selectNarrativeSwipe']) => trpc.application['selectNarrativeSwipe'].mutate(input),
      getEffectivePreview: (input: { timelineId: string; branchId: string }) => trpc.application['getEffectiveNarrativePreview'].query(input),
      appendInput: (input: { timelineId: string; branchId: string; nodeId: string; expectedHeadNodeId: string | null; content: string; attachments?: import('@loom-studio/shared').ChatAttachment[] }) => trpc.application['appendNarrativeInput'].mutate(input),
      editNode: (input: { timelineId: string; branchId: string; nodeId: string; expectedHeadNodeId: string; expectedRaw: string; raw: string }) => trpc.application['editNarrativeNode'].mutate(input),
      create: (input: CreateNarrativeTimelineInput) => trpc.application['createNarrativeTimeline'].mutate({
        ...input, title: input.title ?? createDefaultTitle('timeline'),
      }),
      importHistory: (input: { cardId: string; title?: string; messages: Array<{ content: string; createdAt?: string }> }) => trpc.application['importNarrativeHistory'].mutate(input),
      replaceOpening: (input: StudioRpcInputs['application']['replaceNarrativeOpening']) => trpc.application['replaceNarrativeOpening'].mutate(input),
      get: (timelineId: string) => trpc.application['getNarrativeTimeline'].query({ timelineId }),
      list: (input?: { createdFromCardId?: string; cursor?: string; limit?: number }) => trpc.application['listNarrativeTimelines'].query((input ?? {})),
      getPage: (input: { timelineId: string; branchId?: string; cursor?: string; limit?: number }) => trpc.application['getNarrativePage'].query(input),
      exportArchive: (timelineId: string) => trpc.application['exportTimelineArchive'].query({ timelineId }),
      importArchive: (source: string) => trpc.application['importTimelineArchive'].mutate({ source }),
      fork: (input: ForkNarrativeBranchInput) => trpc.application['forkNarrativeBranch'].mutate(input),
      switch: (input: SwitchNarrativeBranchInput) => trpc.application['switchNarrativeBranch'].mutate(input),
      delete: (timelineId: string) => trpc.application['deleteNarrativeTimeline'].mutate({ timelineId }),
      update: (input: { timelineId: string; title?: string }) => trpc.application['updateNarrativeTimeline'].mutate(input),
    },
    promptResources: {
      getBindings: (resourceId: string) => trpc.application['getPromptResourceBindings'].query({ resourceId }),
      updateMacros: (input: { resourceId: string; expectedVersion: number; macros: Record<string, string>; macroOptions?: import('@loom-studio/shared').MacroOptions }) => trpc.application['updatePromptResourceMacros'].mutate(input),
      get: (resourceId: string) => trpc.application['getPromptResource'].query({ resourceId }),
      list: (resourceKind?: 'preset' | 'lore', signal?: AbortSignal) => trpc.application['listPromptResources'].query(resourceKind ? { resourceKind } : {}, { signal }),
      create: (input: CreatePromptResourceInput) => trpc.application['createPromptResource'].mutate(input),
      duplicate: (input: DuplicatePromptResourceInput) => trpc.application['duplicatePromptResource'].mutate(input),
      delete: (resourceId: string) => trpc.application['deletePromptResource'].mutate({ resourceId }),
      import: (artifact: PromptResourceArtifact, name?: string) => trpc.application['importPromptResource'].mutate({
        artifact: artifact,
        ...(name ? { name } : {}),
      }),
      export: (resourceId: string) => trpc.application['exportPromptResource'].query({ resourceId }),
      importZip: (base64: string) => trpc.application['importPromptResourceZip'].mutate({ base64 }),
      exportZip: (resourceId: string) => trpc.application['exportPromptResourceZip'].query({ resourceId }),
      createAsset: (input: CreatePromptResourceAssetInput) => trpc.application['createPromptResourceAsset'].mutate(input),
      updateAsset: (input: UpdatePromptResourceAssetInput) => trpc.application['updatePromptResourceAsset'].mutate(input),
      updateAssets: (input: UpdatePromptResourceAssetsInput) => trpc.application['updatePromptResourceAssets'].mutate(input),
      listLoreMounts: (source?: LoreMountSource) => trpc.application['listLoreMounts'].query(source ? { source } : {}),
      replaceLoreMounts: (input: ReplaceLoreMountsInput) => trpc.application['replaceLoreMounts'].mutate(input),
      listPresetToolMounts: (input?: StudioRpcInputs['application']['listPresetToolMounts']) => trpc.application.listPresetToolMounts.query((input ?? {})),
      replacePresetToolMounts: (input: StudioRpcInputs['application']['replacePresetToolMounts']) => trpc.application.replacePresetToolMounts.mutate(input),
      moveAsset: (input: MovePromptResourceAssetInput) => trpc.application['movePromptResourceAsset'].mutate(input),
      deleteAsset: (input: DeletePromptResourceAssetInput) => trpc.application['deletePromptResourceAsset'].mutate(input),
    },
    cardBundles: {
      import: (input: ImportCardBundleInput) => trpc.application['importCardBundle'].mutate(input),
    },
    extensionInstallations: {
      list: () => trpc.application['listExtensionInstallations'].query(undefined),
    },
    timelineExtensions: {
      inspectResources: (input: { timelineId: string; installationId: string }) => trpc.application['inspectTimelineExtensionResources'].query(input),
      get: (input: { timelineId: string }) => trpc.application['getTimelineExtensionParticipation'].query(input),
      update: (input: { timelineId: string; installationId: string; expectedVersion: number; enabled: boolean }) => trpc.application['updateTimelineExtensionParticipation'].mutate(input),
      previewAdoption: (input: { timelineId: string; branchId: string; installationId: string }) => trpc.application['previewTimelineExtensionAdoption'].query(input),
      previewStateInitialization: (input: { timelineId: string; branchId: string; installationId: string }) => trpc.application['previewTimelineExtensionStateInitialization'].query(input),
      initializeState: (input: TimelineExtensionAdoptionPreview) => trpc.application['initializeTimelineExtensionState'].mutate(input),
      adopt: (input: TimelineExtensionAdoptionPreview) => trpc.application['adoptTimelineExtension'].mutate(input),
      previewRecovery: (input: { timelineId: string; installationId: string }) => trpc.application['previewTimelineExtensionRecovery'].query(input),
      recover: (input: TimelineExtensionRecoveryPreview & { acceptSourceChange?: boolean }) => trpc.application['recoverTimelineExtension'].mutate(input),
    },
    portableExtensionPayloads: {
      list: (packageId?: string) => trpc.application['listPortableExtensionPayloads'].query(packageId ? { packageId } : {}),
      get: (payloadId: string) => trpc.application['getPortableExtensionPayload'].query({ payloadId }),
      create: (input: { artifactPayloadId?: string; payload: PortableExtensionPayloadDraft }) => trpc.application['createPortableExtensionPayload'].mutate(input),
      update: (input: { payloadId: string; expectedVersion: number; payload: PortableExtensionPayloadDraft }) => trpc.application['updatePortableExtensionPayload'].mutate(input),
      delete: (input: { payloadId: string; expectedVersion: number }) => trpc.application['deletePortableExtensionPayload'].mutate(input),
      replaceCardBindings: (input: { cardId: string; expectedVersion: number; payloadIds: string[] }) => trpc.application['replaceCardPortableExtensionPayloads'].mutate(input),
    },
  }
}
