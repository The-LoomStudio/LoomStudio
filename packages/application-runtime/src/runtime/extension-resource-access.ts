import type { DocumentStore } from '@loom-studio/kernel/document-store'
import type { NarrativeStore } from '../data/index.js'
import { isRecord } from '@loom-studio/shared'
import { applicationDocumentTypes } from '../foundation/document-types.js'
import { listDocuments } from '../foundation/document-store.js'
import type { ExtensionInstallationContent, ExtensionInstallationTarget } from '../types.js'
import { readTimelineExtensionParticipation } from '../extensions/timeline-participation.js'
import { recordPromptExtensionDependency, registerPromptExtensionLease } from '../extensions/prompt-dependencies.js'

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
  timelineId?: string | null,
): Promise<ReadonlyMap<string, string>> {
  const card = cardId ? await documents.get(cardId) : undefined
  const installations = await listDocuments<ExtensionInstallationContent>(documents, applicationDocumentTypes.extensionInstallation)
  // undefined is authoring/discovery; null is runtime consumption without a Timeline.
  const participation = timelineId ? await readTimelineExtensionParticipation(documents, timelineId) : undefined
  return new Map(installations.filter(({ id, version, content }) => {
    if (content.target.kind === 'card'
      && (card?.type !== applicationDocumentTypes.cardSource || content.target.cardId !== cardId)) return false
    if (timelineId === undefined || content.participation !== 'timeline') return true
    const entry = participation?.entries.find(entry => entry.installationId === id && entry.enabled
      && entry.packageId === content.packageId && entry.packageVersion === content.packageVersion
      && entry.installationVersion === version)
    if (entry) registerPromptExtensionLease({
      timelineId: timelineId!, installationId: id, installationVersion: version, generation: entry.generation,
    })
    return Boolean(entry)
  })
    .map(installation => [installation.id, installation.content.packageId]))
}

export function isExtensionResourceAvailable(
  origin: unknown,
  installations?: ReadonlyMap<string, string>,
): boolean {
  if (!isRecord(origin) || origin.kind !== 'extension-package') return true
  const available = typeof origin.installationId === 'string' && typeof origin.packageId === 'string'
    && installations?.get(origin.installationId) === origin.packageId
  if (available) recordPromptExtensionDependency(origin.installationId as string)
  return available
}
