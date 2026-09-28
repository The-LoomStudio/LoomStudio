import type { DocumentStore } from '@loom-studio/document-store'
import type { NarrativeStore, PromptResourceStore, StateStore } from '@loom-studio/application-data'
import type { ExtensionHostOptions } from '@loom-studio/extension-host'
import { applicationDocumentTypes, extensionInstallationId } from '@loom-studio/application-runtime'
import { isRecord, type JsonObject } from '@loom-studio/shared'
import type { StudioEvent } from '@loom-studio/transport'

type EventSubscriberIdentity = Parameters<NonNullable<ExtensionHostOptions['subscribeEvents']>>[2]
type EventStores = {
  documents: DocumentStore
  narratives?: Pick<NarrativeStore, 'getTimeline' | 'getBranch' | 'getNode'>
  states?: Pick<StateStore, 'getScopeById' | 'getScopeForRevision'>
  promptResources?: Pick<PromptResourceStore, 'getResourceMetadataAtVersion'>
}

export async function projectExtensionEvent(
  stores: EventStores,
  event: StudioEvent,
  subscriber: EventSubscriberIdentity,
): Promise<StudioEvent | undefined> {
  if (subscriber.kind !== 'extension' || subscriber.target?.kind !== 'card') return event
  if (event.meta.installationId || event.name === 'state.changed'
    || event.name === 'system.ready' || event.name === 'system.stopping') return event
  const payload = event.payload
  if (!isRecord(payload)) return undefined
  if (event.name === 'extensions.changed') {
    return payload.packageId === subscriber.packageId && isRecord(payload.target)
      && payload.target.kind === 'card' && payload.target.cardId === subscriber.target.cardId ? event : undefined
  }
  if (event.name === 'entity.lifecycle.changed') {
    return isRecord(payload.root) && payload.root.kind === 'card' && payload.root.id === subscriber.target.cardId
      ? event : undefined
  }
  const dataEvent = event.name === 'data.changed'
  // Workspace invalidation/count/failure notices have no committed resource scope to project.
  if (!dataEvent && event.name !== 'docs.changed' && event.name !== 'docs.rollback.completed') return undefined
  if (!Array.isArray(payload.operations)) throw new Error(`Missing committed operations: ${event.name}`)
  const installationId = extensionInstallationId(subscriber.packageId, subscriber.target)
  const operations: JsonObject[] = []
  for (const item of payload.operations) {
    if (!isRecord(item)) throw new Error(`Invalid committed operation: ${event.name}`)
    if (dataEvent && item.store === 'prompt-resources') {
      const source = item.entityType === 'prompt-resource' ? { id: item.entityId, version: item.toVersion }
        : isRecord(item.scope) && item.scope.store === 'prompt-resources' && item.scope.entityType === 'prompt-resource'
          ? { id: item.scope.entityId, version: item.scope.version } : undefined
      if (source && typeof source.id === 'string' && typeof source.version === 'number') {
        const metadata = await stores.promptResources?.getResourceMetadataAtVersion(source.id, source.version)
        const origin = metadata?.origin
        if (isRecord(origin) && origin.kind === 'extension-package' && origin.packageId === subscriber.packageId
          && origin.installationId === installationId) operations.push(item as JsonObject)
      }
      continue
    }
    if (dataEvent && item.store !== 'documents') {
      if (await operationCardId(stores, item) === subscriber.target.cardId) operations.push(item as JsonObject)
      continue
    }
    const id = dataEvent ? item.entityId : item.documentId
    if (typeof id !== 'string' || typeof item.toVersion !== 'number') {
      throw new Error(`Missing committed document identity: ${event.name}`)
    }
    const document = await stores.documents.get(id, { version: item.toVersion, includeTombstone: true })
    if (!document) continue
    let owned = document.meta.ownerExtensionId === subscriber.packageId && document.meta.ownerInstallationId === installationId
    if (document.meta.ownerExtensionId === undefined && isRecord(document.content)) {
      const content = document.content
      switch (document.type) {
        case applicationDocumentTypes.agentTool:
        case applicationDocumentTypes.textTransformRule:
        case applicationDocumentTypes.textExtractor:
        case applicationDocumentTypes.loomScriptMount: {
          const origin = content.origin
          owned = isRecord(origin) && origin.kind === 'extension-package'
            && origin.packageId === subscriber.packageId && origin.installationId === installationId
          break
        }
        case applicationDocumentTypes.portableExtensionPayload:
          owned = content.packageId === subscriber.packageId && content.ownerInstallationId === installationId
          break
        case applicationDocumentTypes.extensionInstallation:
          owned = document.id === installationId && content.packageId === subscriber.packageId
            && isRecord(content.target) && content.target.kind === 'card' && content.target.cardId === subscriber.target.cardId
          break
      }
    }
    if (owned) operations.push(item as JsonObject)
  }
  if (operations.length === 0) return undefined
  return {
    ...event,
    payload: {
      changesetId: payload.changesetId as string,
      ...(typeof payload.targetChangesetId === 'string' ? { targetChangesetId: payload.targetChangesetId } : {}),
      operations,
      ...(!dataEvent ? {
        documents: operations.map(operation => ({
          id: operation.documentId!, type: operation.type!, version: operation.toVersion!,
          tombstoned: operation.kind === 'delete',
        })),
      } : {}),
    },
  }
}

async function operationCardId(stores: EventStores, operation: Record<string, unknown>): Promise<string | undefined> {
  if (typeof operation.entityId !== 'string') throw new Error('Missing committed entity identity')
  const id = operation.entityId
  const options = { includeDeleted: true }
  let timelineId: string | undefined
  if (operation.store === 'narrative') {
    if (operation.entityType === 'narrative.timeline') timelineId = id
    else if (operation.entityType === 'narrative.branch') timelineId = (await stores.narratives?.getBranch(id, options))?.timelineId
    else if (operation.entityType === 'narrative.node') timelineId = (await stores.narratives?.getNode(id, options))?.timelineId
  } else if (operation.store === 'agent') {
    const scope = operation.scope
    if (isRecord(scope) && scope.store === 'narrative' && scope.entityType === 'narrative.timeline' && typeof scope.entityId === 'string') {
      timelineId = scope.entityId
    }
  } else if (operation.store === 'state') {
    const scope = operation.entityType === 'state.scope' ? await stores.states?.getScopeById(id, options)
      : operation.entityType === 'state.revision' ? await stores.states?.getScopeForRevision(id, options)
        : undefined
    if (scope?.kind === 'timeline') timelineId = scope.ownerId
  }
  return timelineId ? (await stores.narratives?.getTimeline(timelineId, options))?.createdFrom?.cardId : undefined
}
