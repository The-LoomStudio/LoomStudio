import type { ObservationEntry, ObservationListInput, ObservationPatch, ObservationStore, ObservationSummary, ObservationWrite } from './types.js'
import { createObservationPersistence } from './persistence.js'

const DAY = 24 * 60 * 60 * 1000
const DEFAULT_LIMITS = { records: 1000, entryBytes: 2 * 1024 * 1024, totalBytes: 32 * 1024 * 1024 }

/** Memory capture is synchronous; optional persistence never blocks producer writes. */
export function createObservationStore(options: {
  now?: () => number
  ttlMs?: number
  limits?: Partial<typeof DEFAULT_LIMITS>
  persistencePath?: string
} = {}): ObservationStore {
  const now = options.now ?? Date.now
  const ttl = Math.min(DAY, Math.max(1, options.ttlMs ?? DAY))
  const limits = { ...DEFAULT_LIMITS, ...options.limits }
  const entries = new Map<string, { value: ObservationEntry; bytes: number }>()
  let bytes = 0
  let dropped = 0
  let disposed = false
  let closing: Promise<void> | undefined
  const persistence = options.persistencePath ? createObservationPersistence({
    directory: options.persistencePath,
    // JSON escaping can use six bytes for a character billed as two in memory.
    maxFileBytes: limits.totalBytes * 3 + 1024,
    snapshot() { prune(); return [...entries.values()].map(entry => entry.value) },
    restore(records) {
      if (records.length > DEFAULT_LIMITS.records) throw new Error('Observation snapshot record limit exceeded')
      const restored = records.map(record => restoreObservation(record, limits.entryBytes, ttl))
      const ids = new Set<string>()
      let total = 0
      for (const record of restored) {
        if (ids.has(record.id)) throw new Error('Duplicate observation snapshot identity')
        ids.add(record.id)
        total += measureObservationSize(record, limits.entryBytes)
      }
      if (total > limits.totalBytes) throw new Error('Observation snapshot total budget exceeded')
      const expired = new Set(restored.filter(record => Date.parse(record.expiresAt) <= now()).map(record => record.id))
      for (const record of restored) {
        if (expired.has(record.id) || (record.parentId && expired.has(record.parentId)) || entries.has(record.id)) continue
        save(record)
      }
    },
  }) : undefined
  function remove(id: string) {
    const entry = entries.get(id)
    if (!entry) return
    bytes -= entry.bytes
    entries.delete(id)
    persistence?.changed()
  }
  function removeFamily(id: string) {
    remove(id)
    for (const [key, entry] of entries) if (entry.value.parentId === id) remove(key)
  }
  function prune() {
    const time = now()
    for (const [id, entry] of entries) if (Date.parse(entry.value.expiresAt) <= time) removeFamily(id)
  }
  const timer = setInterval(() => { capture(prune) }, 60_000)
  timer.unref?.()
  function capture(work: () => void) {
    if (disposed) return
    try { work() } catch { dropped += 1 }
  }
  function save(value: ObservationEntry) {
    prune()
    let size: number
    try {
      size = measureObservationSize(value, limits.entryBytes)
    } catch {
      dropped += 1
      // Keep bounded identity/status so the inspector can distinguish missing evidence.
      value = { ...summary(value), availability: 'partial', diagnostic: '观测内容超过容量或无法复制，正文未记录。' }
      size = measureObservationSize(value, limits.entryBytes)
    }
    const copy = structuredClone(value)
    while (entries.size + (entries.has(value.id) ? 0 : 1) > limits.records
      || bytes - (entries.get(value.id)?.bytes ?? 0) + size > limits.totalBytes) {
      const oldest = entries.keys().next().value
      if (oldest === undefined) { dropped += 1; return }
      removeFamily(oldest)
      dropped += 1
    }
    bytes -= entries.get(value.id)?.bytes ?? 0
    entries.set(value.id, { value: copy, bytes: size })
    bytes += size
    persistence?.changed()
  }
  function write(input: ObservationWrite) {
    capture(() => {
      // IDs are single-use; updates must not renew the evidence lifetime.
      if (entries.has(input.id)) { patch(input.id, input); return }
      const time = now()
      save({ ...input, availability: input.availability ?? 'recorded', capturedAt: new Date(time).toISOString(),
        updatedAt: new Date(time).toISOString(), expiresAt: new Date(time + ttl).toISOString() })
    })
  }
  function patch(id: string, patch: ObservationPatch) {
    capture(() => {
      prune()
      const previous = entries.get(id)?.value
      if (!previous) return
      save({ ...previous, ...patch, id: previous.id, kind: previous.kind, parentId: previous.parentId,
        capturedAt: previous.capturedAt, expiresAt: previous.expiresAt, updatedAt: new Date(now()).toISOString(),
        ...(patch.build ? { build: { ...previous.build, ...patch.build } } : {}),
        ...(patch.request ? { request: { ...previous.request, ...patch.request } } : {}),
      })
    })
  }
  return {
    capture, write, patch,
    get(id) { if (disposed) return null; prune(); const value = entries.get(id)?.value; return value ? structuredClone(value) : null },
    list(input: ObservationListInput = {}) {
      if (disposed) return { records: [], dropped }
      prune()
      const records = [...entries.values()].map(entry => entry.value)
        .filter(entry => !entry.parentId && entry.kind !== 'request'
          && (!input.kind || entry.kind === input.kind)
          && (!input.status || entry.status === input.status)
          && (!input.timelineId || entry.timelineId === input.timelineId)
          && (!input.agentSessionId || entry.agentSessionId === input.agentSessionId))
        .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt) || b.id.localeCompare(a.id))
        .filter(entry => !input.cursor || `${entry.capturedAt}|${entry.id}` < input.cursor)
      const limit = Math.max(1, Math.min(100, input.limit ?? 50))
      const page = records.slice(0, limit)
      const last = page.at(-1)
      return { records: page.map(summary), dropped,
        ...(records.length > limit && last ? { nextCursor: `${last.capturedAt}|${last.id}` } : {}) }
    },
    children(parentId) {
      if (disposed) return []
      prune()
      return [...entries.values()].map(entry => entry.value).filter(entry => entry.parentId === parentId)
        .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt) || a.id.localeCompare(b.id)).map(summary)
    },
    ready: () => persistence?.ready() ?? Promise.resolve(),
    persistence: () => persistence?.state() ?? Promise.resolve({ enabled: false, available: false }),
    setPersistence: enabled => persistence?.setEnabled(enabled) ?? Promise.resolve({ enabled: false, available: false }),
    flush: () => persistence?.flush() ?? Promise.resolve(),
    dispose() {
      if (closing) return closing
      disposed = true
      clearInterval(timer)
      closing = (persistence?.close() ?? Promise.resolve()).finally(() => { entries.clear(); bytes = 0 })
      return closing
    },
  }
}

function restoreObservation(value: unknown, entryBytes: number, ttl: number): ObservationEntry {
  measureObservationSize(value, entryBytes)
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid observation snapshot record')
  const entry = value as Record<string, unknown>
  for (const key of ['id', 'title', 'capturedAt', 'updatedAt', 'expiresAt']) {
    if (typeof entry[key] !== 'string') throw new Error(`Invalid observation snapshot ${key}`)
  }
  if (!['run', 'build', 'api', 'request'].includes(entry.kind as string)
    || !['running', 'completed', 'failed', 'aborted', 'suspended'].includes(entry.status as string)
    || !['recorded', 'partial'].includes(entry.availability as string)) throw new Error('Invalid observation snapshot identity/status')
  for (const key of ['parentId', 'agentPresetId', 'agentSessionId', 'timelineId', 'branchId', 'buildId', 'diagnostic']) {
    if (entry[key] !== undefined && typeof entry[key] !== 'string') throw new Error(`Invalid observation snapshot ${key}`)
  }
  for (const key of ['build', 'request', 'origin', 'output']) {
    if (entry[key] !== undefined && (!entry[key] || typeof entry[key] !== 'object' || Array.isArray(entry[key]))) throw new Error(`Invalid observation snapshot ${key}`)
  }
  const request = entry.request as ObservationEntry['request']
  if (request?.assistantContent !== undefined && typeof request.assistantContent !== 'string') throw new Error('Invalid observation assistant content')
  if (request?.toolExecutions !== undefined && (!Array.isArray(request.toolExecutions)
    || request.toolExecutions.some(tool => !tool || typeof tool.name !== 'string'))) throw new Error('Invalid observation tool executions')
  const capturedAt = Date.parse(entry.capturedAt as string)
  const updatedAt = Date.parse(entry.updatedAt as string)
  const expiresAt = Date.parse(entry.expiresAt as string)
  if (![capturedAt, updatedAt, expiresAt].every(Number.isFinite) || updatedAt < capturedAt || expiresAt < capturedAt) throw new Error('Invalid observation snapshot lifetime')
  return { ...value, expiresAt: new Date(Math.min(expiresAt, capturedAt + ttl)).toISOString() } as ObservationEntry
}

export function observationSummary(entry: ObservationEntry): ObservationSummary { return summary(entry) }
function summary({ build: _build, request, ...rest }: ObservationEntry): ObservationSummary {
  const output = summarizeOutput(request)
  return structuredClone({ ...rest, ...(output ? { output } : {}) })
}

function summarizeOutput(request: ObservationEntry['request']): ObservationSummary['output'] {
  if (!request || (request.assistantContent === undefined && request.response === undefined && !request.toolExecutions?.length)) return undefined
  const asRecord = (value: unknown): Record<string, unknown> | undefined =>
    value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
  const message = asRecord(asRecord(request.response)?.message)
  const toolNames = new Set<string>()
  const addName = (name: unknown) => {
    // Provider output is untrusted. Bound summary size without inventing truncated tool names.
    if (typeof name === 'string' && name.length > 0 && name.length <= 256 && toolNames.size < 128) toolNames.add(name)
  }
  const calls = message?.tool_calls
  if (Array.isArray(calls)) for (const call of calls.slice(0, 128)) addName(asRecord(asRecord(call)?.function)?.name)
  for (const execution of request.toolExecutions?.slice(0, 128) ?? []) addName(execution.name)
  const hasText = request.assistantContent !== undefined
    ? request.assistantContent.trim().length > 0
    : message?.role === 'assistant' && typeof message.content === 'string' && message.content.trim().length > 0
  return { toolNames: [...toolNames], hasText }
}

// Check the budget before cloning/serializing. Also bound nesting and node count so
// cyclic or adversarial provider/tool data cannot stall the business operation.
export function measureObservationSize(value: unknown, limit: number, limits: { nodes: number; depth: number } = { nodes: 100_000, depth: 64 }): number {
  let bytes = 0
  let nodes = 0
  const ancestors = new Set<object>()
  function visit(item: unknown, depth: number): void {
    if (++nodes > limits.nodes || depth > limits.depth) throw new Error('Observation structure limit')
    if (typeof item === 'string') bytes += Buffer.byteLength(item, 'utf8') + item.length * 2 + 8
    else if (item === null || item === undefined || typeof item === 'boolean' || typeof item === 'number') bytes += 16
    else if (typeof item === 'object') {
      if (ancestors.has(item)) throw new Error('Cyclic observation')
      if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null)
        throw new Error('Observation must be plain data')
      ancestors.add(item)
      bytes += 32
      for (const key of Object.keys(item)) {
        bytes += key.length * 2 + 8
        visit((item as Record<string, unknown>)[key], depth + 1)
      }
      ancestors.delete(item)
    } else throw new Error('Observation must be data')
    if (bytes > limit) throw new Error('Observation size limit')
  }
  visit(value, 0)
  return bytes
}
