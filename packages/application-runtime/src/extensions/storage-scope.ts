import type { DocumentTransaction } from '@loom-studio/document-store'
import type { SqliteDataTransaction } from '@loom-studio/data-engine'
import type { ApplicationRuntimeContext } from '../foundation/application-context.js'
import { applicationDocumentTypes } from '../foundation/document-types.js'
import type { ExtensionInstallationTarget, ExtensionStorageScope } from '../types.js'

export async function validateApplicationExtensionStorageScope(
  ctx: Pick<ApplicationRuntimeContext, 'documents' | 'narratives' | 'agents'>,
  scope: ExtensionStorageScope,
  target?: ExtensionInstallationTarget,
  dataTx?: SqliteDataTransaction,
  documents: Pick<DocumentTransaction, 'get'> = ctx.documents,
): Promise<void> {
  if (target?.kind === 'card' && (scope.kind === 'global' || (scope.kind === 'card' && scope.cardId !== target.cardId))) throw new Error('Storage scope is outside this Card installation')
  if (scope.kind === 'global') return
  if (scope.kind === 'card') {
    const card = await documents.get(scope.cardId)
    if (!card || card.type !== applicationDocumentTypes.cardSource || card.meta.tombstone) throw new Error(`Card not found: ${scope.cardId}`)
    return
  }
  if (scope.kind === 'timeline') {
    const timeline = dataTx
      ? ctx.narratives?.transaction(dataTx).getTimeline(scope.timelineId)
      : await ctx.narratives?.getTimeline(scope.timelineId)
    if (!timeline || timeline.deletedAt) throw new Error(`Narrative Timeline not found: ${scope.timelineId}`)
    if (target?.kind === 'card' && timeline.createdFrom?.cardId !== target.cardId) throw new Error('Timeline is outside this Card installation')
    return
  }
  const session = dataTx
    ? ctx.agents?.transaction(dataTx).getSession(scope.agentSessionId)
    : await ctx.agents?.getSession(scope.agentSessionId)
  if (!session || session.deletedAt) throw new Error(`Agent Session not found: ${scope.agentSessionId}`)
  if (target?.kind === 'card') {
    const timeline = session.timelineId
      ? dataTx
        ? ctx.narratives?.transaction(dataTx).getTimeline(session.timelineId)
        : await ctx.narratives?.getTimeline(session.timelineId)
      : undefined
    if (!timeline || timeline.deletedAt || timeline.createdFrom?.cardId !== target.cardId) throw new Error('Session is outside this Card installation')
  }
}

