import type { AgentStore } from '@loom-studio/agent-store'
import type { SqliteDataEngine } from '@loom-studio/data-engine'
import type { DocumentStore } from '@loom-studio/document-store'
import type { Logger } from '@loom-studio/logging'
import type { NarrativeStore } from '@loom-studio/narrative-store'
import { createId as createSharedId, nowIso } from '@loom-studio/shared'
import { createDocumentBackedAiGateway, providerToGateway } from './gateway.js'
import type { AiGateway, ApplicationRuntimeOptions } from './types.js'

export type ApplicationRuntimeContext = {
  agents?: AgentStore
  dataEngine?: SqliteDataEngine
  documents: DocumentStore
  logger?: Logger
  narratives?: NarrativeStore
  gateway: AiGateway
  now(): string
  createId(prefix: string): string
}

export function createApplicationRuntimeContext(options: ApplicationRuntimeOptions): ApplicationRuntimeContext {
  return {
    agents: options.agents,
    dataEngine: options.dataEngine,
    documents: options.documents,
    logger: options.logger,
    narratives: options.narratives,
    gateway: options.gateway ?? (options.provider ? providerToGateway(options.provider) : createDocumentBackedAiGateway({ documents: options.documents })),
    now: () => nowIso(options.clock),
    createId: prefix => createSharedId(prefix),
  }
}
