import type { DocumentRecord, DocumentStore, DocumentTransaction } from '@loom-studio/document-store'
import { createId } from '@loom-studio/shared'
import { applicationDocumentTypes } from './document-types.js'
import { listDocuments, readDocument, toVersioned, writeDocument } from './document-store.js'
import type {
  AgentRuntimeProfileContent,
  AgentTranscriptEntryContent,
  ModelProfileContent,
  NarrativeEntryContent,
  ProviderAccountContent,
} from './types.js'

export function assertNonEmpty(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${label} cannot be empty`)
  }
}

export async function readAgentBinding(input: {
  documents: DocumentStore
  agentRuntimeProfileId?: string
}): Promise<{
    agentRuntimeProfile?: DocumentRecord<AgentRuntimeProfileContent>
    modelProfile?: DocumentRecord<ModelProfileContent>
  }> {
  if (!input.agentRuntimeProfileId) return {}

  const agentRuntimeProfile = await readDocument<AgentRuntimeProfileContent>(
    input.documents,
    input.agentRuntimeProfileId,
    applicationDocumentTypes.agentRuntimeProfile,
  )
  const modelProfile = agentRuntimeProfile.content.modelProfileId
    ? await readDocument<ModelProfileContent>(
      input.documents,
      agentRuntimeProfile.content.modelProfileId,
      applicationDocumentTypes.modelProfile,
    )
    : undefined

  return {
    agentRuntimeProfile,
    modelProfile,
  }
}

export async function writeAgentTranscriptEntry(input: {
  documents: DocumentTransaction
  timestamp: string
  narrativeEntry: DocumentRecord<NarrativeEntryContent>
  parentNarrativeEntryId?: string
  parentTranscriptEntryId?: string
}): Promise<DocumentRecord<AgentTranscriptEntryContent>> {
  const parentTranscript = input.parentTranscriptEntryId
    ? undefined
    : input.parentNarrativeEntryId
    ? await findAgentTranscriptByNarrativeEntry(input.documents, input.narrativeEntry.content.sessionId, input.parentNarrativeEntryId)
    : undefined

  return await writeDocument<AgentTranscriptEntryContent>(input.documents, {
    id: createId('agent-transcript'),
    type: applicationDocumentTypes.agentTranscriptEntry,
    content: {
      sessionId: input.narrativeEntry.content.sessionId,
      branchId: input.narrativeEntry.content.branchId,
      runId: input.narrativeEntry.content.runId,
      narrativeEntryId: input.narrativeEntry.id,
      parentTranscriptEntryId: input.parentTranscriptEntryId ?? parentTranscript?.id,
      role: input.narrativeEntry.content.role,
      content: input.narrativeEntry.content.content,
      status: 'mirrored',
      source: 'narrative',
      createdAt: input.timestamp,
    },
    expectedVersion: 'new',
  })
}

export async function readAgentTranscriptForNarrativePath(input: {
  documents: DocumentStore
  sessionId: string
  narrativeEntries: Array<NarrativeEntryContent & { id: string; version: number }>
}): Promise<Array<AgentTranscriptEntryContent & { id: string; version: number }>> {
  const transcriptEntries = await listDocuments<AgentTranscriptEntryContent>(input.documents, applicationDocumentTypes.agentTranscriptEntry)
  const transcriptByNarrativeEntryId = new Map(
    transcriptEntries
      .filter(entry => entry.content.sessionId === input.sessionId)
      .map(entry => [entry.content.narrativeEntryId, entry]),
  )

  return input.narrativeEntries
    .map(entry => transcriptByNarrativeEntryId.get(entry.id))
    .filter((entry): entry is DocumentRecord<AgentTranscriptEntryContent> => Boolean(entry))
    .map(toVersioned)
}

export async function assertProviderAccountExists(documents: DocumentStore, providerAccountId: string): Promise<void> {
  await readDocument<ProviderAccountContent>(documents, providerAccountId, applicationDocumentTypes.providerAccount)
}

export async function assertModelProfileExists(documents: DocumentStore, modelProfileId: string): Promise<void> {
  await readDocument<ModelProfileContent>(documents, modelProfileId, applicationDocumentTypes.modelProfile)
}

async function findAgentTranscriptByNarrativeEntry(
  documents: DocumentTransaction,
  sessionId: string,
  narrativeEntryId: string,
): Promise<DocumentRecord<AgentTranscriptEntryContent> | undefined> {
  const transcriptEntries = await listDocuments<AgentTranscriptEntryContent>(documents, applicationDocumentTypes.agentTranscriptEntry)
  return transcriptEntries.find(entry => entry.content.sessionId === sessionId && entry.content.narrativeEntryId === narrativeEntryId)
}
