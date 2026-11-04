import type { DocumentRecord } from '@loom-studio/document-store'
import type { ApplicationRuntimeContext } from '../foundation/application-context.js'
import { applicationDocumentTypes } from '../foundation/document-types.js'
import { listDocuments } from '../foundation/document-store.js'
import type { ToolDefinition } from './tool-registry.js'
import type { AgentToolContent, AgentToolEntry } from '../types.js'

export function toAgentToolContent(
  definition: ToolDefinition,
  createdAt: string,
  updatedAt: string = createdAt,
  origin?: AgentToolContent['origin'],
): AgentToolContent {
  return {
    owner: structuredClone(definition.owner),
    name: definition.name,
    description: definition.description,
    input: structuredClone(definition.input),
    ...(definition.prompt ? { prompt: structuredClone(definition.prompt) } : {}),
    ...(origin ? { origin: structuredClone(origin) } : {}),
    createdAt,
    updatedAt,
  }
}

export function toAgentToolDefinition(document: DocumentRecord<AgentToolContent>): ToolDefinition {
  return {
    id: document.id,
    owner: structuredClone(document.content.owner),
    name: document.content.name,
    description: document.content.description,
    input: structuredClone(document.content.input),
    ...(document.content.prompt
      ? { prompt: structuredClone(document.content.prompt) }
      : {}),
  }
}

export function toAgentToolEntry(document: DocumentRecord<AgentToolContent>): AgentToolEntry {
  return {
    ...toAgentToolDefinition(document),
    ...(document.content.origin
      ? { origin: structuredClone(document.content.origin) }
      : {}),
    version: document.version,
    createdAt: document.content.createdAt,
    updatedAt: document.content.updatedAt,
  }
}

export async function listAgentToolEntries(
  ctx: Pick<ApplicationRuntimeContext, 'agentTools' | 'documents' | 'now'>,
): Promise<AgentToolEntry[]> {
  const documents = await listDocuments<AgentToolContent>(
    ctx.documents,
    applicationDocumentTypes.agentTool,
  )
  if (documents.length > 0) return documents.map(toAgentToolEntry)
  const timestamp = ctx.now()
  return ctx.agentTools.list().map((definition) => ({
    ...structuredClone(definition),
    version: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  }))
}

export async function refreshAgentToolRegistry(
  ctx: Pick<ApplicationRuntimeContext, 'agentTools' | 'documents'>,
): Promise<void> {
  const documents = await listDocuments<AgentToolContent>(
    ctx.documents,
    applicationDocumentTypes.agentTool,
  )
  if (documents.length === 0) return
  ctx.agentTools.replaceDefinitions(
    documents.map(toAgentToolDefinition),
  )
}

