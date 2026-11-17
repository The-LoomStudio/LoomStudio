import { createObservationStore } from '../observability/store.js'
import { createObservedAiGateway } from '../observability/gateway.js'
import type { ObservationStore } from '../observability/types.js'
import { createNarrativeActivityRegistry } from '../extensions/narrative-activity.js'
import { createExtensionReadonlyFilesRegistry } from '../extensions/readonly-files.js'
import type { AgentStore, NarrativeStore, PromptResourceStore, StateStore, NarrativeSwipeStore, WorkspaceStore } from '../data/index.js'
import { createStateStore, createWorkspaceStore, createNarrativeSwipeStore } from '../data/index.js'
import {
  createAiGatewayCapabilityRegistry,
  createOfficialProviderAdapterRegistry,
  registerOfficialFakeAiProvider,
  type AiGatewayCapabilityRegistry,
  type ProfiledAiGateway,
  type ProviderAdapterRegistry,
} from '@loom-studio/ai-gateway'
import type { SqliteDataEngine } from '@loom-studio/kernel/data-engine'
import type { DocumentStore } from '@loom-studio/kernel/document-store'
import type {
  ExtensionEntityRef,
  ExtensionInstallationTarget,
  ExtensionStorageScope,
  ExtensionTimelineTarget,
} from '@loom-studio/extension-sdk'
import type { Logger } from '@loom-studio/logging'
import { createId as createSharedId, nowIso } from '@loom-studio/shared'
import { createUnifiedAiGateway, type UnifiedAiGateway } from '../providers/gateway.js'
import { createOfficialAgentToolRegistry } from '../agents/official-tools/index.js'
import type { AgentToolRegistry } from '../agents/tool-registry.js'
import type { AiGateway, ApplicationRuntimeOptions, BlobStorage, MediaAssetLookup, SourceArtifactStorage } from '../types.js'
import { createMacroProviderRegistry, type MacroProviderRegistry } from '../prompt/macro-provider-registry.js'
import { createPromptProcessorRegistry, type PromptProcessorRegistry } from '../prompt/prompt-processor-registry.js'
import { createStateContentRegistry, type StateContentRegistry } from '../state/state-content-registry.js'
import { createStateContributionRegistry, type StateContributionRegistry } from '../state/state-contribution-registry.js'
import { createTimelineArchiveParticipantRegistry, type TimelineArchiveParticipantRegistry } from '../archive/timeline-archive.js'
import { createNarrativeContextRegistry, type NarrativeContextRegistry } from '../narrative/context-provider.js'
import { applicationDocumentTypes } from './document-types.js'

export type ApplicationExtensionPorts = {
  aiCapabilities: AiGatewayCapabilityRegistry
  aiGateway: UnifiedAiGateway
  profiledAiGateway: ProfiledAiGateway
  providerAdapters: ProviderAdapterRegistry
  agentTools: AgentToolRegistry
  macroProviders: MacroProviderRegistry
  promptProcessors: PromptProcessorRegistry
  stateContent: StateContentRegistry
  narrativeContext: NarrativeContextRegistry
  stateContributions: StateContributionRegistry
  stores: {
    documents: DocumentStore
    narratives?: NarrativeStore
    states: StateStore
    promptResources: PromptResourceStore
  }
}

export type ApplicationScopeValidator = {
  validateStorageScope(
    scope: ExtensionStorageScope,
    target: ExtensionInstallationTarget,
    execution?: ExtensionTimelineTarget,
  ): Promise<void>
  validateEntityRef(
    ref: ExtensionEntityRef,
    target: ExtensionInstallationTarget,
    execution?: ExtensionTimelineTarget,
  ): Promise<void>
}

export type ApplicationRuntimeContext = {
  observations: ObservationStore
  onStateChanged?: ApplicationRuntimeOptions['onStateChanged']
  exportExtensionArchive?: ApplicationRuntimeOptions['exportExtensionArchive']
  validatePackageAsset?: ApplicationRuntimeOptions['validatePackageAsset']
  withCardDeletion: ApplicationRuntimeOptions['withCardDeletion']
  withCardDeletions: ApplicationRuntimeOptions['withCardDeletions']
  agents?: AgentStore
  dataEngine: SqliteDataEngine
  documents: DocumentStore
  blobs?: BlobStorage
  logger?: Logger
  runtimeLogger?: Logger
  narratives?: NarrativeStore
  narrativeActivity: ReturnType<typeof createNarrativeActivityRegistry>
  extensionReadonlyFiles: ReturnType<typeof createExtensionReadonlyFilesRegistry>
  narrativeContext: NarrativeContextRegistry
  promptResources: PromptResourceStore
  workspaces: WorkspaceStore
  states: StateStore
  swipes: NarrativeSwipeStore
  sourceArtifacts?: SourceArtifactStorage
  mediaAssets?: MediaAssetLookup
  secrets: ApplicationRuntimeOptions['secrets']
  gateway: AiGateway
  providerAdapters: ProviderAdapterRegistry
  aiCapabilities: AiGatewayCapabilityRegistry
  agentTools: AgentToolRegistry
  macroProviders: MacroProviderRegistry
  promptProcessors: PromptProcessorRegistry
  stateContent: StateContentRegistry
  stateContributions: StateContributionRegistry
  timelineArchiveParticipants: TimelineArchiveParticipantRegistry
  extensionPorts: ApplicationExtensionPorts
  scopeValidator: ApplicationScopeValidator
  now(): string
  createId(prefix: string): string
}

export function createApplicationRuntimeContext(options: ApplicationRuntimeOptions): ApplicationRuntimeContext {
  if (!options.promptResources) throw new Error('Prompt Resource Store is required')
  if (!options.dataEngine) throw new Error('Shared Data Engine is required')

  // 1. Base stores and clocks
  const runtimeNow = () => nowIso(options.clock)
  const runtimeCreateId = (prefix: string) => createSharedId(prefix)
  const observations = options.observations ?? createObservationStore()
  const workspaces = createWorkspaceStore({ engine: options.dataEngine, createId: runtimeCreateId, now: runtimeNow })
  const states = options.states ?? createStateStore({
    engine: options.dataEngine,
    createId: runtimeCreateId,
    now: runtimeNow,
  })
  const swipes = createNarrativeSwipeStore({ engine: options.dataEngine, createId: runtimeCreateId, now: runtimeNow })
  const narrativeActivity = createNarrativeActivityRegistry(options.dataEngine, options.runtimeLogger)
  const extensionReadonlyFiles = createExtensionReadonlyFilesRegistry()
  const timelineArchiveParticipants = createTimelineArchiveParticipantRegistry(options.timelineArchiveParticipants)

  // 2. 7 extension registries (aiCapabilities + official.fake first)
  const aiCapabilities = options.aiCapabilities ?? createAiGatewayCapabilityRegistry()
  if (!options.aiCapabilities && !aiCapabilities.get('official.fake')) {
    registerOfficialFakeAiProvider(aiCapabilities)
  }
  const agentTools = options.agentTools ?? createOfficialAgentToolRegistry()
  const macroProviders = options.macroProviders ?? createMacroProviderRegistry()
  const promptProcessors = options.promptProcessors ?? createPromptProcessorRegistry()
  const stateContent = options.stateContent ?? createStateContentRegistry()
  const narrativeContext = options.narrativeContext ?? createNarrativeContextRegistry()
  const stateContributions = options.stateContributions ?? createStateContributionRegistry()

  // 3. Provider adapters
  const providerAdapters = options.providerAdapters ?? createOfficialProviderAdapterRegistry({
    aiCapabilities,
  })

  // 4. Unified AI Gateway (single-pass observations + statistics + logging)
  const unifiedGateway = createUnifiedAiGateway({
    mediaAssets: options.mediaAssets,
    documents: options.documents,
    secrets: options.secrets,
    resolveProxyUrl: options.resolveProxyUrl,
    providerAdapters,
    aiCapabilities,
    statistics: options.statistics,
    observations,
    providerLogger: options.providerLogger,
    onLog: options.onGatewayLog,
  })
  const gateway = options.gateway ? createObservedAiGateway(options.gateway, observations) : unifiedGateway

  const extensionPorts: ApplicationExtensionPorts = {
    aiCapabilities,
    aiGateway: unifiedGateway,
    profiledAiGateway: unifiedGateway,
    providerAdapters,
    agentTools,
    macroProviders,
    promptProcessors,
    stateContent,
    narrativeContext,
    stateContributions,
    stores: {
      documents: options.documents,
      narratives: options.narratives,
      states,
      promptResources: options.promptResources,
    },
  }

  const scopeValidator = createApplicationScopeValidator({
    documents: options.documents,
    narratives: options.narratives,
    agents: options.agents,
    mediaAssets: options.mediaAssets,
  })

  return {
    observations,
    onStateChanged: options.onStateChanged,
    exportExtensionArchive: options.exportExtensionArchive,
    validatePackageAsset: options.validatePackageAsset,
    withCardDeletion: options.withCardDeletion,
    withCardDeletions: options.withCardDeletions,
    agents: options.agents,
    dataEngine: options.dataEngine,
    documents: options.documents,
    blobs: options.blobs,
    logger: options.logger,
    runtimeLogger: options.runtimeLogger,
    narratives: options.narratives,
    narrativeActivity,
    extensionReadonlyFiles,
    narrativeContext,
    promptResources: options.promptResources,
    workspaces,
    states,
    swipes,
    sourceArtifacts: options.sourceArtifacts,
    mediaAssets: options.mediaAssets,
    secrets: options.secrets,
    providerAdapters,
    aiCapabilities,
    agentTools,
    macroProviders,
    promptProcessors,
    stateContent,
    stateContributions,
    timelineArchiveParticipants,
    gateway,
    extensionPorts,
    scopeValidator,
    now: runtimeNow,
    createId: runtimeCreateId,
  }
}

function createApplicationScopeValidator(deps: {
  documents: DocumentStore
  narratives?: NarrativeStore
  agents?: AgentStore
  mediaAssets?: MediaAssetLookup
}): ApplicationScopeValidator {
  return {
    validateStorageScope: async (scope, target, execution) => {
      if (scope.kind === 'global') return
      if (scope.kind === 'card') {
        const card = await deps.documents.get(scope.cardId)
        if (!card || card.type !== applicationDocumentTypes.cardSource || card.meta.tombstone) {
          throw new Error(`Card not found: ${scope.cardId}`)
        }
        return
      }
      if (scope.kind === 'timeline') {
        const timeline = await deps.narratives?.getTimeline(scope.timelineId)
        if (!timeline || timeline.deletedAt) throw new Error(`Narrative Timeline not found: ${scope.timelineId}`)
        if (target.kind === 'card' && timeline.createdFrom?.cardId !== target.cardId) {
          throw new Error('Narrative Timeline is outside the extension Card installation')
        }
        return
      }
      const session = await deps.agents?.getSession(scope.agentSessionId)
      if (!session || session.deletedAt) throw new Error(`Agent Session not found: ${scope.agentSessionId}`)
      if (execution && session.timelineId !== execution.timelineId) {
        throw new Error('Agent Session is outside the current Timeline')
      }
      if (target.kind === 'card') {
        const timeline = session.timelineId ? await deps.narratives?.getTimeline(session.timelineId) : undefined
        if (!timeline || timeline.deletedAt || timeline.createdFrom?.cardId !== target.cardId) {
          throw new Error('Agent Session is outside the extension Card installation')
        }
      }
    },

    validateEntityRef: async (ref, target, execution) => {
      if (execution && ref.kind === 'agent-message'
        && (await deps.agents?.getSession(ref.agentSessionId))?.timelineId !== execution.timelineId) {
        throw new Error('Agent Message is outside the current Timeline')
      }
      if (target.kind === 'card' && ref.kind !== 'asset') {
        const timelineId = ref.kind === 'agent-message'
          ? (await deps.agents?.getSession(ref.agentSessionId))?.timelineId
          : ref.timelineId
        const timeline = timelineId ? await deps.narratives?.getTimeline(timelineId) : undefined
        if (!timeline || timeline.deletedAt || timeline.createdFrom?.cardId !== target.cardId) {
          throw new Error('Entity reference is outside the extension Card installation')
        }
      }
      if (ref.kind === 'narrative-node') {
        const node = await deps.narratives?.getNode(ref.nodeId)
        if (!node || node.timelineId !== ref.timelineId) throw new Error(`Narrative Node not found in Timeline: ${ref.nodeId}`)
        return
      }
      if (ref.kind === 'agent-message') {
        const entry = await deps.agents?.getEntry(ref.messageId)
        if (!entry || entry.agentSessionId !== ref.agentSessionId) throw new Error(`Agent Message not found in Session: ${ref.messageId}`)
        return
      }
      if (ref.kind === 'asset') {
        if (!await deps.mediaAssets?.get(ref.assetId)) throw new Error(`Media Asset not found: ${ref.assetId}`)
        return
      }
      const timeline = await deps.narratives?.getTimeline(ref.timelineId)
      if (!timeline || timeline.deletedAt) throw new Error(`Narrative Timeline not found: ${ref.timelineId}`)
    },
  }
}
