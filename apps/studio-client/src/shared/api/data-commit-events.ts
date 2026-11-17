import { subscribeExtensionEvents } from './extension-events.js'

export type DataOperationScope = {
  store: string
  entityType: string
  entityId: string
  cardId?: string
  timelineId?: string
  installationId?: string
}

export type DataOperation = {
  entityType: string
  entityId: string
  kind?: string
  scope?: DataOperationScope
}

function parseOperationScope(scope: unknown): { scope: DataOperationScope } | undefined {
  if (!scope || typeof scope !== 'object') return undefined
  const record = scope as Record<string, unknown>
  if (typeof record.store !== 'string' || typeof record.entityType !== 'string' || typeof record.entityId !== 'string') {
    return undefined
  }
  return {
    scope: {
      store: record.store,
      entityType: record.entityType,
      entityId: record.entityId,
      ...(typeof record.cardId === 'string' ? { cardId: record.cardId } : {}),
      ...(typeof record.timelineId === 'string' ? { timelineId: record.timelineId } : {}),
      ...(typeof record.installationId === 'string' ? { installationId: record.installationId } : {}),
    },
  }
}

export function subscribeDataCommits(
  onCommit: (operations: DataOperation[]) => void,
  onConnected: () => void,
): () => void {
  return subscribeExtensionEvents({
    onConnected,
    events: {
      'data.changed': event => {
        let payload: unknown
        try {
          payload = JSON.parse(event.data)
        } catch {
          return
        }
        if (!payload || typeof payload !== 'object' || !('payload' in payload)) return
        const data = payload.payload
        if (!data || typeof data !== 'object' || !('operations' in data) || !Array.isArray(data.operations)) return
        const operations: DataOperation[] = data.operations
          .filter((item): item is DataOperation =>
            item && typeof item === 'object' && typeof item.entityType === 'string' && typeof item.entityId === 'string')
          .map(item => ({
            entityType: item.entityType,
            entityId: item.entityId,
            ...(typeof item.kind === 'string' ? { kind: item.kind } : {}),
            ...(parseOperationScope(item.scope) ?? {}),
          }))
        if ('overflow' in data && data.overflow === true) {
          onConnected()
          return
        }
        onCommit(operations)
      },
    },
  })
}
