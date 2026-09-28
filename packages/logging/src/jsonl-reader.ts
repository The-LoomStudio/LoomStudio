import { constants, type Dirent } from 'node:fs'
import { lstat, open, readdir } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { LogRecord } from './types.js'
import type { LogHistoryPage, LogHistoryReader } from './history-types.js'
import { matchesLogQuery } from './memory-sink.js'
import { readLogQuery } from './query.js'

type SnapshotFile = { name: string; size: number; ino: number; dev: number }
type Snapshot = { files: SnapshotFile[]; filter: string; expires: number }
const filePattern = /^\d{4}-\d{2}-\d{2}-.+-\d+\.\d+\.jsonl$/
const pageBytes = 2 * 1024 * 1024
const maxLineBytes = 256 * 1024

export function createJsonlLogReader(options: { directory: string }): LogHistoryReader {
  const snapshots = new Map<string, Snapshot>()
  return {
    query: async (input, signal) => {
      const query = readLogQuery(input)
      if (!query.since || !query.until) throw new Error('History queries require since and until')
      if (Date.parse(query.until) - Date.parse(query.since) > 31 * 86_400_000) throw new Error('History query range must not exceed 31 days')
      signal?.throwIfAborted()
      const { cursor, limit, ...filters } = query
      const filter = JSON.stringify(Object.entries(filters).sort(([a], [b]) => a.localeCompare(b)))
      for (const [key, value] of snapshots) if (value.expires <= Date.now()) snapshots.delete(key)
      let id: string
      let index = 0
      let offset = 0
      let discarding = false
      let disappearedDuringDiscovery = 0
      let snapshot: Snapshot
      if (cursor) {
        const match = /^history:([a-f0-9-]{36}):(\d+):(\d+):([01])$/.exec(cursor)
        if (!match) throw new Error('Invalid history cursor')
        id = match[1]!
        const existing = snapshots.get(id)
        if (!existing || existing.filter !== filter) throw new Error('History cursor expired or query changed; start a new search')
        snapshot = existing
        index = Number(match[2])
        offset = Number(match[3])
        discarding = match[4] === '1'
        if (!Number.isSafeInteger(index) || !Number.isSafeInteger(offset) || index > snapshot.files.length || offset > (snapshot.files[index]?.size ?? 0)) throw new Error('Invalid history position')
      } else {
        id = randomUUID()
        let entries: Dirent[]
        try { entries = await readdir(options.directory, { withFileTypes: true }) } catch (error) {
          if (code(error) !== 'ENOENT') throw error
          entries = []
        }
        const files: SnapshotFile[] = []
        for (const entry of entries) {
          signal?.throwIfAborted()
          if (!entry.isFile() || !filePattern.test(entry.name)) continue
          const date = entry.name.slice(0, 10)
          if (date < query.since.slice(0, 10) || date > query.until.slice(0, 10)) continue
          try {
            const stat = await lstat(join(options.directory, entry.name))
            if (stat.isFile()) files.push({ name: entry.name, size: stat.size, ino: stat.ino, dev: stat.dev })
            if (files.length > 4096) throw new Error('Too many history segments; narrow the time range')
          } catch (error) {
            if (code(error) !== 'ENOENT') throw error
            disappearedDuringDiscovery++
          }
        }
        files.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }))
        // ponytail: bounded snapshot metadata, not a persistent index; expired searches restart explicitly.
        if (snapshots.size >= 32) snapshots.delete(snapshots.keys().next().value!)
        snapshot = { files, filter, expires: Date.now() + 10 * 60_000 }
        snapshots.set(id, snapshot)
      }
      const result: LogHistoryPage = { items: [], cursor: '', hasMore: false, scannedBytes: 0, scannedRecords: 0, issues: [] }
      if (disappearedDuringDiscovery) result.issues.push({ reason: 'missing-file', count: disappearedDuringDiscovery })
      const issue = (reason: LogHistoryPage['issues'][number]['reason']) => {
        const existing = result.issues.find(item => item.reason === reason)
        if (existing) existing.count++
        else result.issues.push({ reason, count: 1 })
      }
      while (index < snapshot.files.length && result.items.length < limit && result.scannedBytes < pageBytes) {
        signal?.throwIfAborted()
        const file = snapshot.files[index]!
        let handle
        try { handle = await open(join(options.directory, file.name), constants.O_RDONLY | constants.O_NOFOLLOW) } catch (error) {
          if (code(error) === 'ENOENT') issue('missing-file')
          else if (code(error) === 'ELOOP') issue('changed-file')
          else throw error
          index++
          offset = 0
          discarding = false
          continue
        }
        try {
          const current = await handle.stat()
          if (!current.isFile() || current.ino !== file.ino || current.dev !== file.dev || current.size < file.size) {
            issue('changed-file')
            index++
            offset = 0
            discarding = false
            continue
          }
          let pending = Buffer.alloc(0)
          let oversized = discarding
          let readAt = offset
          let stop = false
          while (readAt < file.size && !stop) {
            signal?.throwIfAborted()
            const buffer = Buffer.alloc(Math.min(64 * 1024, file.size - readAt))
            const { bytesRead } = await handle.read(buffer, 0, buffer.length, readAt)
            if (!bytesRead) { issue('changed-file'); offset = file.size; break }
            readAt += bytesRead
            let start = 0
            for (let pos = 0; pos < bytesRead; pos++) {
              if (buffer[pos] !== 10) continue
              const fragment = buffer.subarray(start, pos)
              const lineBytes = pending.length + fragment.length
              if (oversized || lineBytes > maxLineBytes) {
                if (!oversized) issue('oversized-line')
              }
              else {
                const line = Buffer.concat([pending, fragment]).toString('utf8')
                result.scannedRecords++
                let record: unknown
                try { record = JSON.parse(line) } catch { issue('invalid-line') }
                if (record !== undefined) {
                  if (!isLogRecord(record) || !ownsRecord(file.name, record)) issue('invalid-line')
                  else if (matchesLogQuery(record, query)) result.items.push(record)
                }
              }
              const consumed = readAt - bytesRead + pos + 1 - offset
              result.scannedBytes += consumed
              offset += consumed
              pending = Buffer.alloc(0)
              oversized = false
              discarding = false
              start = pos + 1
              if (result.items.length >= limit || result.scannedBytes >= pageBytes) { stop = true; break }
            }
            if (!stop) {
              const tail = buffer.subarray(start, bytesRead)
              if (!oversized && pending.length + tail.length > maxLineBytes) {
                issue('oversized-line')
                oversized = true
              }
              if (!oversized) pending = Buffer.concat([pending, tail])
              if (oversized && result.scannedBytes + readAt - offset >= pageBytes) {
                // A corrupt giant line must not monopolize a query. Skip only within this file snapshot.
                result.scannedBytes += readAt - offset
                offset = readAt
                discarding = true
                stop = true
              }
            }
          }
          if (!stop && offset < file.size) {
            issue('incomplete-line')
            result.scannedBytes += file.size - offset
            offset = file.size
          }
          if (offset >= file.size) { index++; offset = 0; discarding = false }
        } finally { await handle.close() }
      }
      result.cursor = `history:${id}:${index}:${offset}:${discarding ? 1 : 0}`
      result.hasMore = index < snapshot.files.length
      return result
    },
  }
}

function code(error: unknown): unknown {
  return error && typeof error === 'object' && 'code' in error ? error.code : undefined
}

function isLogRecord(value: unknown): value is LogRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (!['debug', 'info', 'warn', 'error'].includes(record.level as string)) return false
  if (!['timestamp', 'service', 'instanceId', 'namespace', 'message'].every(key => typeof record[key] === 'string' && record[key])) return false
  if (!Number.isFinite(Date.parse(record.timestamp as string))) return false
  if (record.data !== undefined && (!record.data || typeof record.data !== 'object' || Array.isArray(record.data))) return false
  for (const key of ['event', 'correlationId', 'callId', 'parentCallId']) if (record[key] !== undefined && typeof record[key] !== 'string') return false
  if (record.error !== undefined && (!record.error || typeof record.error !== 'object' || typeof (record.error as Record<string, unknown>).message !== 'string')) return false
  if (record.extension !== undefined) {
    const identity = record.extension as Record<string, unknown>
    if (!identity || typeof identity !== 'object' || Array.isArray(identity) || typeof identity.packageId !== 'string' || !identity.packageId || !['server', 'client'].includes(identity.runtime as string)) return false
    for (const key of ['moduleId', 'instanceId', 'installationId']) if (identity[key] !== undefined && typeof identity[key] !== 'string') return false
  }
  return true
}

function ownsRecord(name: string, record: LogRecord): boolean {
  const safe = (part: string) => part.replaceAll(/[^a-zA-Z0-9._-]/g, '_')
  return name.startsWith(`${record.timestamp.slice(0, 10)}-${safe(record.service)}-${safe(record.instanceId)}-`)
}
