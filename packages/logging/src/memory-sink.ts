import type { LogLevel, LogRecord, LogSink } from './types.js'

export type LogQuery = {
  cursor?: string
  limit: number
  levels?: LogLevel[]
  namespacePrefix?: string
  service?: string
  instanceId?: string
  since?: string
  until?: string
}

export type LogGap = {
  reason: 'evicted' | 'reset'
  dropped?: number
}

export type LogPage = {
  items: LogRecord[]
  cursor: string
  hasMore: boolean
  gap?: LogGap
}

export type LogReader = {
  query(input: LogQuery): LogPage
}

export type MemoryLogSink = LogSink & LogReader & {
  list(): LogRecord[]
  getStats(): {
    size: number
    capacity: number
    dropped: number
  }
  clear(): void
}

type MemoryEntry = {
  sequence: number
  record: LogRecord
}

export function createMemoryLogSink(options: { capacity: number; cursorId?: string }): MemoryLogSink {
  if (!Number.isInteger(options.capacity) || options.capacity <= 0) {
    throw new Error('Memory log capacity must be a positive integer')
  }
  if (options.cursorId !== undefined && (options.cursorId.length === 0 || options.cursorId.includes(':'))) {
    throw new Error('Memory log cursorId must be non-empty and cannot contain a colon')
  }

  const records = new Array<MemoryEntry | undefined>(options.capacity)
  let cursorId = options.cursorId ?? createCursorId()
  let nextSequence = 1
  let start = 0
  let size = 0
  let dropped = 0

  return {
    name: 'memory',
    write: record => {
      const index = (start + size) % options.capacity
      records[index] = {
        sequence: nextSequence++,
        record: structuredClone(record),
      }

      if (size < options.capacity) {
        size += 1
      } else {
        start = (start + 1) % options.capacity
        dropped += 1
      }
    },
    list: () => readEntries(records, start, size, options.capacity).map(entry => structuredClone(entry.record)),
    query: input => {
      if (!Number.isInteger(input.limit) || input.limit <= 0) {
        throw new Error('Log query limit must be a positive integer')
      }

      const entries = readEntries(records, start, size, options.capacity)
      const oldestSequence = entries[0]?.sequence ?? nextSequence
      const newestSequence = nextSequence - 1
      const cursor = input.cursor ? parseCursor(input.cursor) : undefined
      let afterSequence = oldestSequence - 1
      let gap: LogGap | undefined

      if (!cursor && dropped > 0) {
        gap = { reason: 'evicted', dropped }
      } else if (cursor && (cursor.cursorId !== cursorId || cursor.sequence > newestSequence)) {
        gap = { reason: 'reset' }
      } else if (cursor && cursor.sequence < oldestSequence - 1) {
        gap = { reason: 'evicted', dropped: oldestSequence - cursor.sequence - 1 }
      } else if (cursor) {
        afterSequence = cursor.sequence
      }

      const items: LogRecord[] = []
      let scannedSequence = afterSequence
      for (const entry of entries) {
        if (entry.sequence <= afterSequence) continue
        scannedSequence = entry.sequence
        if (!matchesQuery(entry.record, input)) continue
        items.push(structuredClone(entry.record))
        if (items.length === input.limit) break
      }

      if (scannedSequence < afterSequence) scannedSequence = afterSequence
      if (entries.length === 0) scannedSequence = newestSequence

      return {
        items,
        cursor: formatCursor(cursorId, scannedSequence),
        hasMore: scannedSequence < newestSequence,
        ...(gap ? { gap } : {}),
      }
    },
    getStats: () => ({ size, capacity: options.capacity, dropped }),
    clear: () => {
      records.fill(undefined)
      cursorId = createCursorId()
      nextSequence = 1
      start = 0
      size = 0
      dropped = 0
    },
  }
}

function readEntries(records: Array<MemoryEntry | undefined>, start: number, size: number, capacity: number): MemoryEntry[] {
  return Array.from({ length: size }, (_, index) => records[(start + index) % capacity]!)
}

function matchesQuery(record: LogRecord, query: LogQuery): boolean {
  if (query.levels && !query.levels.includes(record.level)) return false
  if (query.namespacePrefix && record.namespace !== query.namespacePrefix && !record.namespace.startsWith(`${query.namespacePrefix}.`)) return false
  if (query.service && record.service !== query.service) return false
  if (query.instanceId && record.instanceId !== query.instanceId) return false
  if (query.since && record.timestamp < query.since) return false
  if (query.until && record.timestamp > query.until) return false
  return true
}

function createCursorId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
}

function formatCursor(cursorId: string, sequence: number): string {
  return `memory:${cursorId}:${sequence}`
}

function parseCursor(value: string): { cursorId: string; sequence: number } {
  const match = /^memory:([^:]+):(\d+)$/.exec(value)
  if (!match) throw new Error('Invalid log cursor')
  const sequence = Number(match[2])
  if (!Number.isSafeInteger(sequence)) throw new Error('Invalid log cursor')
  return { cursorId: match[1]!, sequence }
}
