import type { AgentStore } from '@loom-studio/agent-store'
import type { SqliteDataEngine } from '@loom-studio/data-engine'
import type { DocumentStore } from '@loom-studio/document-store'
import type { Logger } from '@loom-studio/logging'
import type { NarrativeStore } from '@loom-studio/narrative-store'
import type { PromptResourceStore } from '@loom-studio/prompt-resource-store'
import { createId as createSharedId, nowIso } from '@loom-studio/shared'
import { createDocumentBackedAiGateway, providerToGateway } from './gateway.js'
import type { AiGateway, ApplicationRuntimeOptions, MediaAssetLookup, SourceArtifactStorage } from './types.js'

export type ApplicationRuntimeContext = {
  agents?: AgentStore
  dataEngine: SqliteDataEngine
  documents: DocumentStore
  logger?: Logger
  narratives?: NarrativeStore
  promptResources: PromptResourceStore
  sourceArtifacts?: SourceArtifactStorage
  mediaAssets?: MediaAssetLookup
  secrets: ApplicationRuntimeOptions['secrets']
  gateway: AiGateway
  now(): string
  createId(prefix: string): string
}

export function createApplicationRuntimeContext(options: ApplicationRuntimeOptions): ApplicationRuntimeContext {
  if (!options.promptResources) throw new Error('Prompt Resource Store is required')
  if (!options.dataEngine) throw new Error('Shared Data Engine is required')
  return {
    agents: options.agents,
    dataEngine: options.dataEngine,
    documents: options.documents,
    logger: options.logger,
    narratives: options.narratives,
    promptResources: options.promptResources,
    sourceArtifacts: options.sourceArtifacts,
    mediaAssets: options.mediaAssets,
    secrets: options.secrets,
    gateway: options.gateway ?? (options.provider ? providerToGateway(options.provider) : createDocumentBackedAiGateway({
      documents: options.documents,
      secrets: options.secrets,
    })),
    now: () => nowIso(options.clock),
    createId: prefix => createSharedId(prefix),
  }
}
