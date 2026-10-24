import { createObservationStore } from '../observability/store.js'
import { createObservedAiGateway } from '../observability/gateway.js'
import type { ObservationStore } from '../observability/types.js'
import { createNarrativeActivityRegistry } from '../extensions/narrative-activity.js'
import { createExtensionReadonlyFilesRegistry } from '../extensions/readonly-files.js'
import type { AgentStore } from '@loom-studio/application-data'
import { createOfficialProviderAdapterRegistry, type ProviderAdapterRegistry } from '@loom-studio/ai-gateway'
import type { SqliteDataEngine } from '@loom-studio/data-engine'
import type { DocumentStore } from '@loom-studio/document-store'
import type { Logger } from '@loom-studio/logging'
import type { NarrativeStore } from '@loom-studio/application-data'
import type { PromptResourceStore } from '@loom-studio/application-data'
import { createId as createSharedId, nowIso } from '@loom-studio/shared'
import { createStateStore, createWorkspaceStore, type WorkspaceStore, createNarrativeSwipeStore, type StateStore, type NarrativeSwipeStore } from '@loom-studio/application-data'
import { createDocumentBackedAiGateway } from '../providers/gateway.js'
import { createAgentToolRegistry, type AgentToolRegistry } from '../agents/tool-registry.js'
import type { AiGateway, ApplicationRuntimeOptions, BlobStorage, MediaAssetLookup, SourceArtifactStorage } from '../types.js'
import { createMacroProviderRegistry, type MacroProviderRegistry } from '../prompt/macro-provider-registry.js'
import { createPromptProcessorRegistry, type PromptProcessorRegistry } from '../prompt/prompt-processor-registry.js'
import { createStateContentRegistry, type StateContentRegistry } from '../state/state-content-registry.js'
import { createStateContributionRegistry, type StateContributionRegistry } from '../state/state-contribution-registry.js'
import { createTimelineArchiveParticipantRegistry, type TimelineArchiveParticipantRegistry } from '../archive/timeline-archive.js'
import { createNarrativeContextRegistry, type NarrativeContextRegistry } from '../narrative/context-provider.js'

export type ApplicationRuntimeContext = {
  observations: ObservationStore
  onStateChanged?: ApplicationRuntimeOptions['onStateChanged']
  exportExtensionArchive?: ApplicationRuntimeOptions['exportExtensionArchive']
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
  aiCapabilities: ApplicationRuntimeOptions['aiCapabilities']
  agentTools: AgentToolRegistry
  macroProviders: MacroProviderRegistry
  promptProcessors: PromptProcessorRegistry
  stateContent: StateContentRegistry
  stateContributions: StateContributionRegistry
  timelineArchiveParticipants: TimelineArchiveParticipantRegistry
  now(): string
  createId(prefix: string): string
}

export function createApplicationRuntimeContext(options: ApplicationRuntimeOptions): ApplicationRuntimeContext {
  if (!options.promptResources) throw new Error('Prompt Resource Store is required')
  if (!options.dataEngine) throw new Error('Shared Data Engine is required')
  const providerAdapters = options.providerAdapters ?? createOfficialProviderAdapterRegistry({
    aiCapabilities: options.aiCapabilities,
  })
  const agentTools = options.agentTools ?? createAgentToolRegistry([])
  const runtimeNow = () => nowIso(options.clock)
  const runtimeCreateId = (prefix: string) => createSharedId(prefix)
  const observations = options.observations ?? createObservationStore()
  return {
    observations,
    onStateChanged: options.onStateChanged,
    exportExtensionArchive: options.exportExtensionArchive,
    withCardDeletion: options.withCardDeletion,
    withCardDeletions: options.withCardDeletions,
    agents: options.agents,
    dataEngine: options.dataEngine,
    documents: options.documents,
    blobs: options.blobs,
    logger: options.logger,
    runtimeLogger: options.runtimeLogger,
    narratives: options.narratives,
    narrativeActivity: createNarrativeActivityRegistry(options.dataEngine, options.runtimeLogger),
    extensionReadonlyFiles: createExtensionReadonlyFilesRegistry(),
    narrativeContext: options.narrativeContext ?? createNarrativeContextRegistry(),
    promptResources: options.promptResources,
    workspaces: createWorkspaceStore({ engine: options.dataEngine, createId: runtimeCreateId, now: runtimeNow }),
    states: options.states ?? createStateStore({
      engine: options.dataEngine,
      createId: runtimeCreateId,
      now: runtimeNow,
    }),
    swipes: createNarrativeSwipeStore({ engine: options.dataEngine, createId: runtimeCreateId, now: runtimeNow }),
    sourceArtifacts: options.sourceArtifacts,
    mediaAssets: options.mediaAssets,
    secrets: options.secrets,
    providerAdapters,
    aiCapabilities: options.aiCapabilities,
    agentTools,
    macroProviders: options.macroProviders ?? createMacroProviderRegistry(),
    promptProcessors: options.promptProcessors ?? createPromptProcessorRegistry(),
    stateContent: options.stateContent ?? createStateContentRegistry(),
    stateContributions: options.stateContributions ?? createStateContributionRegistry(),
    timelineArchiveParticipants: createTimelineArchiveParticipantRegistry(options.timelineArchiveParticipants),
    gateway: createObservedAiGateway(options.gateway ?? createDocumentBackedAiGateway({
      documents: options.documents,
      secrets: options.secrets,
      providerAdapters,
      observations,
    }), observations),
    now: runtimeNow,
    createId: runtimeCreateId,
  }
}
