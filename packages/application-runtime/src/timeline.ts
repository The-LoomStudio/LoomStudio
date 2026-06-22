import type { DocumentRecord, DocumentStore } from '@loom-studio/document-store'
import { applicationDocumentTypes } from './document-types.js'
import { listDocuments, readDocument, toVersioned } from './document-store.js'
import type { NarrativeBranchContent, NarrativeEntryContent, SessionContent } from './types.js'

export async function readBranchPath(documents: DocumentStore, sessionId: string, headEntryId?: string): Promise<Array<NarrativeEntryContent & { id: string; version: number }>> {
  if (!headEntryId) return []

  const entries = await listDocuments<NarrativeEntryContent>(documents, applicationDocumentTypes.narrativeEntry)
  const entriesById = new Map(entries.filter(entry => entry.content.sessionId === sessionId).map(entry => [entry.id, entry]))
  const path: Array<DocumentRecord<NarrativeEntryContent>> = []
  let cursor: string | undefined = headEntryId

  while (cursor) {
    const entry = entriesById.get(cursor)
    if (!entry) {
      throw new Error(`Narrative parent entry not found: ${cursor}`)
    }

    path.push(entry)
    cursor = entry.content.parentEntryId
  }

  return path.reverse().map(toVersioned)
}

export async function findBranchContainingEntry(documents: DocumentStore, sessionId: string, entryId: string): Promise<DocumentRecord<NarrativeBranchContent>> {
  const entry = await readDocument<NarrativeEntryContent>(documents, entryId, applicationDocumentTypes.narrativeEntry)
  if (entry.content.sessionId !== sessionId) {
    throw new Error(`Entry does not belong to session: ${entryId}`)
  }

  return readDocument<NarrativeBranchContent>(documents, entry.content.branchId, applicationDocumentTypes.narrativeBranch)
}

export async function readSessionBranch(
  documents: DocumentStore,
  sessionId: string,
  branchId?: string,
): Promise<{
  session: DocumentRecord<SessionContent>
  branch: DocumentRecord<NarrativeBranchContent>
}> {
  const session = await readDocument<SessionContent>(documents, sessionId, applicationDocumentTypes.session)
  const branch = await readDocument<NarrativeBranchContent>(documents, branchId ?? session.content.activeBranchId, applicationDocumentTypes.narrativeBranch)
  assertSameSession(session.id, branch.content.sessionId)

  return { session, branch }
}

export function assertSameSession(expectedSessionId: string, actualSessionId: string): void {
  if (expectedSessionId !== actualSessionId) {
    throw new Error(`Branch does not belong to session: ${actualSessionId}`)
  }
}

