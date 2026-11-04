import { subscribeExtensionEvents } from './extension-events.js'

export type DataOperation = {
  entityType: string; entityId: string; kind?: string
  scope?: { store: string; entityType: string; entityId: string }
}

export function subscribeDataCommits(
  onCommit: (operations: DataOperation[]) => void,
  onConnected: () => void,
): () => void {
  const pending = new Map<string, { count: number; next: number; operations: DataOperation[]; bytes: number; timer: ReturnType<typeof setTimeout> }>()
  let totalBytes = 0
  let recovering = false
  const clear = () => {
    for (const batch of pending.values()) clearTimeout(batch.timer)
    pending.clear()
    totalBytes = 0
  }
  const refresh = () => { clear(); if (!recovering) { recovering = true; onConnected() } }
  const unsubscribe = subscribeExtensionEvents({
    onConnected: () => { clear(); recovering = false; onConnected() },
    onError: refresh, events: { 'data.changed': event => {
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
    if (!('chunk' in data)) { onCommit(operations); return }
    const chunk = data.chunk
    if (!chunk || typeof chunk !== 'object' || !('index' in chunk) || !('count' in chunk)
      || !Number.isSafeInteger(chunk.index) || !Number.isSafeInteger(chunk.count)
      || (chunk.index as number) < 0 || (chunk.count as number) < 2 || (chunk.index as number) >= (chunk.count as number)
      || !('changesetId' in data) || typeof data.changesetId !== 'string') { refresh(); return }
    const id = data.changesetId
    const index = chunk.index as number
    const count = chunk.count as number
    let batch = pending.get(id)
    if (index === 0 && !batch) {
      recovering = false
      batch = { count, next: 0, operations: [], bytes: 0, timer: setTimeout(refresh, 10_000) }
      pending.set(id, batch)
    }
    if (!batch) { if (!recovering) refresh(); return }
    if (batch.count !== count || batch.next !== index) { refresh(); return }
    const bytes = new TextEncoder().encode(event.data).byteLength
    if (totalBytes + bytes > 4 * 1024 * 1024) { refresh(); return }
    totalBytes += bytes
    batch.bytes += bytes
    batch.operations.push(...operations)
    batch.next++
    if (batch.next === count) {
      pending.delete(id)
      clearTimeout(batch.timer)
      totalBytes -= batch.bytes
      onCommit(batch.operations)
    }
  } } })
  return () => { clear(); unsubscribe() }
}
