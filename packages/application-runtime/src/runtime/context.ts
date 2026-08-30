import type { DocumentRecord, DocumentStore, DocumentTransaction, SqliteDocumentStore } from '@loom-studio/document-store'
import type { NarrativeStore } from '@loom-studio/narrative-store'
import type { AgentStore } from '@loom-studio/agent-store'
import type { SecretStore } from '@loom-studio/secret-store'
import type { AiGatewayCapabilityRegistry } from '@loom-studio/ai-gateway'
import type { JsonValue } from '@loom-studio/shared'
import type { ApplicationRuntimeContext } from '../foundation/application-context.js'
import { applicationDocumentTypes } from '../foundation/document-types.js'
import type { RuntimeRequestContext } from '../types.js'

export const applicationActor = { kind: 'kernel', id: 'application-runtime' } as const

export function requireNarratives(ctx: ApplicationRuntimeContext): NarrativeStore {
  if (!ctx.narratives) throw new Error('Narrative Store is not configured')
  return ctx.narratives
}

export function requireAgents(ctx: ApplicationRuntimeContext): AgentStore {
  if (!ctx.agents) throw new Error('Agent Store is not configured')
  return ctx.agents
}

export function requireSecrets(ctx: ApplicationRuntimeContext): SecretStore {
  if (!ctx.secrets) throw new Error('Secret Store is not configured')
  return ctx.secrets
}

export function requireAiCapabilities(ctx: ApplicationRuntimeContext): AiGatewayCapabilityRegistry {
  if (!ctx.aiCapabilities) throw new Error('AI Gateway capabilities are not configured')
  return ctx.aiCapabilities
}

export function requireDocumentParticipant(ctx: ApplicationRuntimeContext): SqliteDocumentStore {
  const participant = ctx.documents as Partial<SqliteDocumentStore>
  if (typeof participant.participateTransaction !== 'function') {
    throw new Error('Shared Sqlite Document Store participant is required')
  }
  return ctx.documents as SqliteDocumentStore
}

export function narrativeWriteContext(requestContext: RuntimeRequestContext | undefined, reason: string) {
  return {
    actor: requestContext?.actor ?? (requestContext?.clientId
      ? { kind: 'client' as const, id: requestContext.clientId }
      : applicationActor),
    reason,
    correlationId: requestContext?.correlationId,
    callId: requestContext?.callId,
    parentCallId: requestContext?.parentCallId,
  }
}

export const agentWriteContext = narrativeWriteContext

export function secretWriteContext(requestContext: RuntimeRequestContext | undefined, reason: string) {
  return {
    actor: requestContext?.actor ?? (requestContext?.clientId
      ? { kind: 'client' as const, id: requestContext.clientId }
      : applicationActor),
    reason,
    correlationId: requestContext?.correlationId,
    callId: requestContext?.callId,
    parentCallId: requestContext?.parentCallId,
  }
}

export function promptResourceWriteContext(requestContext: RuntimeRequestContext | undefined) {
  return {
    actor: requestContext?.actor ?? (requestContext?.clientId
      ? { kind: 'client' as const, id: requestContext.clientId }
      : applicationActor),
    correlationId: requestContext?.correlationId,
    callId: requestContext?.callId,
    parentCallId: requestContext?.parentCallId,
  }
}

export type ExtensionStorageScopeRef =
  | { kind: 'card'; cardId: string }
  | { kind: 'timeline'; timelineId: string }
  | { kind: 'agent-session'; agentSessionId: string }

export async function tombstoneExtensionStorageScope(
  documents: DocumentStore | DocumentTransaction,
  scope: ExtensionStorageScopeRef,
): Promise<void> {
  for (const type of [applicationDocumentTypes.extensionConfig, applicationDocumentTypes.extensionRecord]) {
    const matches: DocumentRecord[] = []
    let cursor: string | undefined
    do {
      const page = await documents.list({ type, cursor, limit: 200 })
      matches.push(...page.items.filter(document => hasExtensionStorageScope(document.content, scope)))
      cursor = page.nextCursor
    } while (cursor)
    for (const document of matches) {
      await documents.delete({
        id: document.id,
        expectedVersion: document.version,
        reason: `extension.storage.scope.deleted:${scope.kind}`,
      })
    }
  }
}

function hasExtensionStorageScope(content: JsonValue, scope: ExtensionStorageScopeRef): boolean {
  if (!content || typeof content !== 'object' || Array.isArray(content)) return false
  const storedScope = (content as Record<string, unknown>).scope
  if (!storedScope || typeof storedScope !== 'object' || Array.isArray(storedScope)) return false
  const scopeObj = storedScope as Record<string, unknown>
  if (scope.kind === 'card') {
    return scopeObj.kind === 'card' && scopeObj.cardId === scope.cardId
  }
  if (scope.kind === 'timeline') {
    return scopeObj.kind === 'timeline' && scopeObj.timelineId === scope.timelineId
  }
  return scopeObj.kind === 'agent-session' && scopeObj.agentSessionId === scope.agentSessionId
}
