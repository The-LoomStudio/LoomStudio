export type DataOperation = {
  entityType: string; entityId: string; kind?: string
  scope?: { store: string; entityType: string; entityId: string }
}

export function subscribeDataCommits(
  onCommit: (operations: DataOperation[]) => void,
  onConnected: () => void,
): () => void {
  const events = new EventSource('/extensions/events')
  events.addEventListener('open', onConnected)
  events.addEventListener('data.changed', event => {
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
        entityType: item.entityType, entityId: item.entityId,
        ...(typeof item.kind === 'string' ? { kind: item.kind } : {}),
        ...(item.scope && typeof item.scope.store === 'string'
          && typeof item.scope.entityType === 'string' && typeof item.scope.entityId === 'string'
          ? { scope: { store: item.scope.store, entityType: item.scope.entityType, entityId: item.scope.entityId } } : {}),
      }))
    onCommit(operations)
  })
  return () => events.close()
}
