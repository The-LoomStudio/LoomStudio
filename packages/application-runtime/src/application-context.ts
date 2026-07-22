import type { DocumentStore } from '@loom-studio/document-store'
import type { Logger } from '@loom-studio/logging'
import { createId as createSharedId, nowIso } from '@loom-studio/shared'
import { createDocumentBackedAiGateway, providerToGateway } from './gateway.js'
import type { AiGateway, ApplicationRuntimeOptions } from './types.js'

export type ApplicationRuntimeContext = {
  documents: DocumentStore
  logger?: Logger
  gateway: AiGateway
  now(): string
  createId(prefix: string): string
}

export function createApplicationRuntimeContext(options: ApplicationRuntimeOptions): ApplicationRuntimeContext {
  return {
    documents: options.documents,
    logger: options.logger,
    gateway: options.gateway ?? (options.provider ? providerToGateway(options.provider) : createDocumentBackedAiGateway({ documents: options.documents })),
    now: () => nowIso(options.clock),
    createId: prefix => createSharedId(prefix),
  }
}
