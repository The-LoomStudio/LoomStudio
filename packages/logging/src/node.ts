import { createWriteStream, type WriteStream } from 'node:fs'
import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { LogRecord, LogSink } from './types.js'

const defaultMaxFileBytes = 10 * 1024 * 1024
const defaultMaxTotalBytes = 100 * 1024 * 1024
const defaultMaxAgeDays = 7
const defaultMaxPendingRecords = 1_000

export type JsonlFileSink = LogSink & {
  getStats(): {
    queued: number
    dropped: number
  }
}

export type CreateJsonlFileSinkOptions = {
  directory: string
  maxFileBytes?: number
  maxTotalBytes?: number
  maxAgeDays?: number
  maxPendingRecords?: number
  onError?: (error: unknown) => void
}

type PendingLine = {
  date: string
  service: string
  instanceId: string
  line: string
  bytes: number
}

export function createJsonlFileSink(options: CreateJsonlFileSinkOptions): JsonlFileSink {
  const maxFileBytes = readPositiveInteger(options.maxFileBytes ?? defaultMaxFileBytes, 'maxFileBytes')
  const maxTotalBytes = readPositiveInteger(options.maxTotalBytes ?? defaultMaxTotalBytes, 'maxTotalBytes')
  const maxAgeDays = readPositiveInteger(options.maxAgeDays ?? defaultMaxAgeDays, 'maxAgeDays')
  const maxPendingRecords = readPositiveInteger(options.maxPendingRecords ?? defaultMaxPendingRecords, 'maxPendingRecords')
  if (maxTotalBytes < maxFileBytes) throw new Error('maxTotalBytes must be greater than or equal to maxFileBytes')
  const queue: PendingLine[] = []
  let stream: WriteStream | undefined
  let currentPath: string | undefined
  let currentKey: string | undefined
  let currentBytes = 0
  let currentSegment = 0
  let pumping: Promise<void> | undefined
  let failure: unknown
  let closed = false
  let dropped = 0

  const reportFailure = (error: unknown): void => {
    if (failure) return
    failure = error
    dropped += queue.length
    queue.length = 0
    stream?.destroy()
    try {
      if (options.onError) options.onError(error)
      else process.stderr.write(`[logging] JSONL sink failed: ${error instanceof Error ? error.message : String(error)}\n`)
    } catch {
      // stderr is the final fallback; there is no safe recursive recovery path here.
    }
  }

  const startPump = (): void => {
    if (pumping || failure || closed || queue.length === 0) return
    pumping = pump().catch(reportFailure).finally(() => {
      pumping = undefined
      if (queue.length > 0 && !failure && !closed) startPump()
    })
  }

  const pump = async (): Promise<void> => {
    while (queue.length > 0) {
      if (failure) throw failure
      const item = queue[0]!
      await ensureStream(item)
      if (!stream) throw new Error('JSONL stream is unavailable')

      const accepted = stream.write(item.line, 'utf8')
      currentBytes += item.bytes
      queue.shift()
      if (!accepted) await waitForDrain(stream)
    }
  }

  const ensureStream = async (item: PendingLine): Promise<void> => {
    const key = `${item.date}:${item.service}:${item.instanceId}`
    if (stream && currentKey === key && currentBytes + item.bytes <= maxFileBytes) return

    if (stream) await closeCurrentStream()
    if (currentKey !== key) currentSegment = 0
    else currentSegment += 1

    await mkdir(options.directory, { recursive: true })
    const prefix = [item.date, safeFilePart(item.service), safeFilePart(item.instanceId), String(process.pid)].join('-')
    let path = join(options.directory, `${prefix}.${currentSegment}.jsonl`)
    let size = await readFileSize(path)
    while (size > 0 && size + item.bytes > maxFileBytes) {
      currentSegment += 1
      path = join(options.directory, `${prefix}.${currentSegment}.jsonl`)
      size = await readFileSize(path)
    }

    const nextStream = createWriteStream(path, { flags: 'a', encoding: 'utf8' })
    await waitForOpen(nextStream)
    nextStream.on('error', reportFailure)
    stream = nextStream
    currentPath = path
    currentKey = key
    currentBytes = size
    await pruneLogFiles(options.directory, currentPath, maxTotalBytes, maxAgeDays)
  }

  const closeCurrentStream = async (): Promise<void> => {
    const active = stream
    stream = undefined
    currentPath = undefined
    if (!active || active.destroyed) return
    await new Promise<void>((resolve, reject) => {
      active.once('error', reject)
      active.end(resolve)
    })
  }

  const flush = async (): Promise<void> => {
    while (pumping) await pumping
    if (failure) throw failure
    if (!stream || stream.destroyed) return
    await new Promise<void>((resolve, reject) => {
      stream!.write('', error => error ? reject(error) : resolve())
    })
  }

  return {
    name: 'jsonl-file',
    write: record => {
      if (failure) throw failure
      if (closed) throw new Error('JSONL sink is closed')
      if (queue.length >= maxPendingRecords) {
        dropped += 1
        return
      }

      const line = `${JSON.stringify(record)}\n`
      queue.push({
        date: readRecordDate(record),
        service: record.service,
        instanceId: record.instanceId,
        line,
        bytes: Buffer.byteLength(line),
      })
      startPump()
    },
    flush,
    close: async () => {
      if (closed) return
      await flush()
      closed = true
      await closeCurrentStream()
    },
    getStats: () => ({ queued: queue.length, dropped }),
  }
}

async function waitForOpen(stream: WriteStream): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const handleOpen = () => {
      stream.off('error', handleError)
      resolve()
    }
    const handleError = (error: Error) => {
      stream.off('open', handleOpen)
      reject(error)
    }
    stream.once('open', handleOpen)
    stream.once('error', handleError)
  })
}

async function waitForDrain(stream: WriteStream): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const handleDrain = () => {
      stream.off('error', handleError)
      resolve()
    }
    const handleError = (error: Error) => {
      stream.off('drain', handleDrain)
      reject(error)
    }
    stream.once('drain', handleDrain)
    stream.once('error', handleError)
  })
}

async function pruneLogFiles(directory: string, activePath: string, maxTotalBytes: number, maxAgeDays: number): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = (await Promise.all(entries
    .filter(entry => entry.isFile() && entry.name.endsWith('.jsonl'))
    .map(async entry => {
      const path = join(directory, entry.name)
      const info = await stat(path)
      return { path, size: info.size, modifiedAt: info.mtimeMs }
    })))
    .sort((left, right) => left.modifiedAt - right.modifiedAt)
  const expiresBefore = Date.now() - maxAgeDays * 24 * 60 * 60 * 1_000
  let totalBytes = files.reduce((total, file) => total + file.size, 0)

  for (const file of files) {
    if (file.path === activePath) continue
    if (file.modifiedAt >= expiresBefore && totalBytes <= maxTotalBytes) continue
    await rm(file.path)
    totalBytes -= file.size
  }
}

async function readFileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size
  } catch (error) {
    if (isNotFoundError(error)) return 0
    throw error
  }
}

function readRecordDate(record: LogRecord): string {
  const date = record.timestamp.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Invalid log timestamp: ${record.timestamp}`)
  return date
}

function safeFilePart(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9._-]/g, '_')
}

function readPositiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer`)
  return value
}

function isNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}
