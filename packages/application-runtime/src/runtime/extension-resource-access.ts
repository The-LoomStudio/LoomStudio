import type { DocumentStore } from '@loom-studio/document-store'
import type { NarrativeStore } from '@loom-studio/application-data'
import { isRecord } from '@loom-studio/shared'
import { applicationDocumentTypes } from '../foundation/document-types.js'
import { listDocuments } from '../foundation/document-store.js'
import type { ExtensionInstallationContent, ExtensionInstallationTarget } from '../types.js'

export async function assertExtensionTimelineAccess(
  narratives: Pick<NarrativeStore, 'getTimeline'> | undefined,
  target: ExtensionInstallationTarget | undefined,
  timelineId: string | undefined,
): Promise<void> {
  if (target?.kind !== 'card') return
  const timeline = timelineId ? await narratives?.getTimeline(timelineId) : undefined
  if (!timeline || timeline.deletedAt || timeline.createdFrom?.cardId !== target.cardId) {
    throw new Error('Requested data is outside this Card installation')
  }
}

export async function readAvailableExtensionInstallations(
  documents: DocumentStore,
  cardId?: string,
): Promise<ReadonlyMap<string, string>> {
  const card = cardId ? await documents.get(cardId) : undefined
  const installations = await listDocuments<ExtensionInstallationContent>(documents, applicationDocumentTypes.extensionInstallation)
  return new Map(installations.filter(({ content }) => content.target.kind === 'global'
    || (content.target.kind === 'card' && card?.type === applicationDocumentTypes.cardSource && content.target.cardId === cardId))
    .map(installation => [installation.id, installation.content.packageId]))
}

export function isExtensionResourceAvailable(
  origin: unknown,
  installations?: ReadonlyMap<string, string>,
): boolean {
  if (!isRecord(origin) || origin.kind !== 'extension-package' || origin.installationId === undefined) return true
  return typeof origin.installationId === 'string' && typeof origin.packageId === 'string'
    && installations?.get(origin.installationId) === origin.packageId
}
