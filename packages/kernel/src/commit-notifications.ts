import { isJsonObject, serializeError, type JsonObject, type JsonValue } from '@loom-studio/shared'
import type { CreateKernelOptions, EventBus, EventEmitOptions } from './types.js'

const COMPACT_OPERATION_CAP = 64
const COMPACT_BYTE_CAP = 32 * 1024

function utf8Bytes(value: JsonValue): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8')
}

function scopeKey(scope: JsonValue | undefined): string {
  if (!isJsonObject(scope)) return ''
  return JSON.stringify([
    scope.store ?? null,
    scope.entityType ?? null,
    scope.entityId ?? null,
    scope.version ?? null,
    scope.cardId ?? null,
    scope.timelineId ?? null,
    scope.installationId ?? null,
  ])
}

type CollapsedGroup = {
  first: JsonObject
  count: number
}

function collapseOperationsByScope(operations: JsonValue[]): JsonObject[] {
  const groups = new Map<string, CollapsedGroup>()
  for (const item of operations) {
    if (!isJsonObject(item)) continue
    const key = JSON.stringify([item.store ?? null, item.kind ?? null, item.entityType ?? null, scopeKey(item.scope)])
    const existing = groups.get(key)
    if (existing) {
      existing.count++
      continue
    }
    groups.set(key, { first: item, count: 1 })
  }

  const collapsed: JsonObject[] = []
  for (const { first, count } of groups.values()) {
    if (count === 1) {
      collapsed.push({
        ...(first.store !== undefined ? { store: first.store } : {}),
        ...(first.kind !== undefined ? { kind: first.kind } : {}),
        ...(first.entityType !== undefined ? { entityType: first.entityType } : {}),
        ...(first.entityId !== undefined ? { entityId: first.entityId } : {}),
        ...(first.scope !== undefined ? { scope: first.scope } : {}),
        ...(first.fromVersion !== undefined ? { fromVersion: first.fromVersion } : {}),
        ...(first.toVersion !== undefined ? { toVersion: first.toVersion } : {}),
      })
      continue
    }
    const scope = isJsonObject(first.scope) ? first.scope : undefined
    const entityId = typeof scope?.entityId === 'string' ? scope.entityId : first.entityId
    collapsed.push({
      ...(first.store !== undefined ? { store: first.store } : {}),
      ...(first.kind !== undefined ? { kind: first.kind } : {}),
      ...(first.entityType !== undefined ? { entityType: first.entityType } : {}),
      ...(entityId !== undefined ? { entityId } : {}),
      ...(scope ? { scope } : {}),
      count,
    })
  }
  return collapsed
}

function attributionScope(scope: JsonValue | undefined): JsonObject | undefined {
  if (!isJsonObject(scope)) return undefined
  const next: JsonObject = {}
  if (typeof scope.cardId === 'string') next.cardId = scope.cardId
  if (typeof scope.timelineId === 'string') next.timelineId = scope.timelineId
  if (typeof scope.installationId === 'string') next.installationId = scope.installationId
  return Object.keys(next).length > 0 ? next : undefined
}

function attributionScopeKey(scope: JsonObject | undefined): string {
  if (!scope) return ''
  return JSON.stringify([
    scope.cardId ?? null,
    scope.timelineId ?? null,
    scope.installationId ?? null,
  ])
}

function collapseOperationsByStoreScope(operations: JsonObject[]): JsonObject[] {
  const groups = new Map<string, { store?: JsonValue; scope?: JsonObject; kinds: Set<JsonValue>; entityTypes: Set<JsonValue>; count: number }>()
  for (const item of operations) {
    const scope = attributionScope(item.scope)
    const key = JSON.stringify([item.store ?? null, attributionScopeKey(scope)])
    const itemCount = typeof item.count === 'number' ? item.count : 1
    const existing = groups.get(key)
    if (existing) {
      if (item.kind !== undefined) existing.kinds.add(item.kind)
      if (item.entityType !== undefined) existing.entityTypes.add(item.entityType)
      existing.count += itemCount
      continue
    }
    groups.set(key, {
      ...(item.store !== undefined ? { store: item.store } : {}),
      ...(scope ? { scope } : {}),
      kinds: new Set(item.kind !== undefined ? [item.kind] : []),
      entityTypes: new Set(item.entityType !== undefined ? [item.entityType] : []),
      count: itemCount,
    })
  }
  return [...groups.values()].map(group => ({
    ...(group.store !== undefined ? { store: group.store } : {}),
    kind: group.kinds.size === 1 ? [...group.kinds][0]! : 'update',
    entityType: group.entityTypes.size === 1 ? [...group.entityTypes][0]! : `${String(group.store ?? 'data')}.*`,
    entityId: '*',
    ...(group.scope ? { scope: group.scope } : {}),
    count: group.count,
  }))
}

function collapseOperationsByStore(operations: JsonObject[]): JsonObject[] {
  const groups = new Map<string, number>()
  for (const item of operations) {
    const store = String(item.store ?? 'unknown')
    const itemCount = typeof item.count === 'number' ? item.count : 1
    groups.set(store, (groups.get(store) ?? 0) + itemCount)
  }
  return [...groups.entries()].map(([store, count]) => ({
    store,
    kind: 'update',
    entityType: `${store}.*`,
    entityId: '*',
    count,
  }))
}

/** Keep commit notifications within a single small frame; collapse large commits by scope with overflow=true. */
export function compactCommitPayload(payload: JsonValue, budget: number): JsonValue {
  if (!isJsonObject(payload) || !Array.isArray(payload.operations)) return payload
  const effectiveCap = Math.min(COMPACT_BYTE_CAP, budget)
  if (payload.operations.length <= COMPACT_OPERATION_CAP && utf8Bytes(payload) <= effectiveCap) {
    return payload
  }

  const { operations: rawOperations, ...base } = payload
  const byScope = collapseOperationsByScope(rawOperations)
  const scopePayload: JsonObject = { ...base, operations: byScope, overflow: true }
  if (utf8Bytes(scopePayload) <= effectiveCap) return scopePayload

  const byStoreScope = collapseOperationsByStoreScope(byScope)
  const storeScopePayload: JsonObject = { ...base, operations: byStoreScope, overflow: true }
  if (utf8Bytes(storeScopePayload) <= budget) return storeScopePayload

  const byStore = collapseOperationsByStore(byStoreScope)
  const storePayload: JsonObject = { ...base, operations: byStore, overflow: true }
  if (utf8Bytes(storePayload) <= budget) return storePayload

  return { ...base, operations: [], overflow: true }
}

export function publishCommitNotification(
  eventBus: EventBus,
  diagnostics: CreateKernelOptions['diagnostics'],
  name: string,
  payload: () => JsonValue,
  context: EventEmitOptions,
): void {
  try {
    const definition = eventBus.definitions().find(item => item.definition.name === name)!.definition
    const budget = definition.maxPayloadBytes ?? COMPACT_BYTE_CAP
    eventBus.emit(name, compactCommitPayload(payload(), budget), context)
  } catch (error) {
    diagnostics.add({
      severity: 'error',
      code: 'event.commit_notification_failed',
      source: 'kernel',
      message: `Data committed; notification failed: ${name}`,
      details: { eventName: name, error: serializeError(error, 'event.commit_notification_failed') },
    })
  }
}
