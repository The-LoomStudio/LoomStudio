import type { AgentStore } from '@loom-studio/agent-store'
import { createOfficialProviderAdapterRegistry, type ProviderAdapterRegistry } from '@loom-studio/ai-gateway'
import type { SqliteDataEngine } from '@loom-studio/data-engine'
import type { DocumentStore } from '@loom-studio/document-store'
import type { Logger } from '@loom-studio/logging'
import type { NarrativeStore } from '@loom-studio/narrative-store'
import type { PromptResourceStore } from '@loom-studio/prompt-resource-store'
import { createId as createSharedId, nowIso } from '@loom-studio/shared'
import { createStateStore, type StateStore } from '@loom-studio/state-store'
import { createDocumentBackedAiGateway, providerToGateway } from './gateway.js'
import { createAgentToolRegistry, type AgentToolRegistry } from './agent/tool-registry.js'
import type { AiGateway, ApplicationRuntimeOptions, MediaAssetLookup, SourceArtifactStorage } from './types.js'

export type ApplicationRuntimeContext = {
  agents?: AgentStore
  dataEngine: SqliteDataEngine
  documents: DocumentStore
  logger?: Logger
  narratives?: NarrativeStore
  promptResources: PromptResourceStore
  states: StateStore
  sourceArtifacts?: SourceArtifactStorage
  mediaAssets?: MediaAssetLookup
  secrets: ApplicationRuntimeOptions['secrets']
  gateway: AiGateway
  providerAdapters: ProviderAdapterRegistry
  agentTools: AgentToolRegistry
  now(): string
  createId(prefix: string): string
}

export function createApplicationRuntimeContext(options: ApplicationRuntimeOptions): ApplicationRuntimeContext {
  if (!options.promptResources) throw new Error('Prompt Resource Store is required')
  if (!options.dataEngine) throw new Error('Shared Data Engine is required')
  const providerAdapters = options.providerAdapters ?? createOfficialProviderAdapterRegistry()
  const agentTools = options.agentTools ?? createAgentToolRegistry([])
  const runtimeNow = () => nowIso(options.clock)
  const runtimeCreateId = (prefix: string) => createSharedId(prefix)
  return {
    agents: options.agents,
    dataEngine: options.dataEngine,
    documents: options.documents,
    logger: options.logger,
    narratives: options.narratives,
    promptResources: options.promptResources,
    states: options.states ?? createStateStore({
      engine: options.dataEngine,
      createId: runtimeCreateId,
      now: runtimeNow,
    }),
    sourceArtifacts: options.sourceArtifacts,
    mediaAssets: options.mediaAssets,
    secrets: options.secrets,
    providerAdapters,
    agentTools,
    gateway: options.gateway ?? (options.provider ? providerToGateway(options.provider) : createDocumentBackedAiGateway({
      documents: options.documents,
      secrets: options.secrets,
      providerAdapters,
    })),
    now: runtimeNow,
    createId: runtimeCreateId,
  }
}
