import type { JsonValue } from '@loom-studio/shared'
import { serializeError } from '@loom-studio/shared'
import type { CreateKernelOptions, EventBus, EventEmitOptions } from './types.js'

/** Partition paired summaries in linear serialized-byte work; reserve worst-case chunk digits. */
export function splitCommitPayload(payload: JsonValue, budget: number): JsonValue[] {
  const data = payload as Record<string, JsonValue>
  const operations = data.operations as JsonValue[]
  const documents = data.documents as JsonValue[] | undefined
  const { operations: _operations, documents: _documents, ...base } = data
  const bytes = (value: JsonValue) => Buffer.byteLength(JSON.stringify(value), 'utf8')
  const operationBytes = operations.map(bytes)
  const documentBytes = documents?.map(bytes)
  const empty = { ...base, operations: [], ...(documents ? { documents: [] } : {}) }
  const arrayBytes = (sizes: number[]) => sizes.reduce((sum, size) => sum + size, 0) + Math.max(0, sizes.length - 1)
  if (bytes(empty) + arrayBytes(operationBytes) + (documentBytes ? arrayBytes(documentBytes) : 0) <= budget) return [payload]
  const overhead = bytes({ ...empty, chunk: { index: operations.length, count: operations.length } })
  const ranges: Array<[number, number]> = []
  let start = 0
  let size = overhead
  for (let index = 0; index < operations.length; index++) {
    const itemBytes = operationBytes[index]! + (documentBytes?.[index] ?? 0)
    const separator = index > start ? (documents ? 2 : 1) : 0
    if (size + itemBytes + separator > budget) {
      if (index === start) throw new Error('A single commit summary exceeds the notification budget')
      ranges.push([start, index])
      start = index
      size = overhead
    }
    size += itemBytes + (index > start ? (documents ? 2 : 1) : 0)
    if (size > budget) throw new Error('A single commit summary exceeds the notification budget')
  }
  ranges.push([start, operations.length])
  return ranges.map(([from, to], index) => ({ ...base, operations: operations.slice(from, to),
    ...(documents ? { documents: documents.slice(from, to) } : {}), chunk: { index, count: ranges.length } }))
}

export function publishCommitNotification(eventBus: EventBus, diagnostics: CreateKernelOptions['diagnostics'], name: string,
  payload: () => JsonValue, context: EventEmitOptions): void {
  try {
    const definition = eventBus.definitions().find(item => item.definition.name === name)!.definition
    for (const chunk of splitCommitPayload(payload(), definition.maxPayloadBytes!)) eventBus.emit(name, chunk, context)
  } catch (error) {
    diagnostics.add({ severity: 'error', code: 'event.commit_notification_failed', source: 'kernel',
      message: `Data committed; notification failed: ${name}`, details: { eventName: name, error: serializeError(error, 'event.commit_notification_failed') } })
  }
}
