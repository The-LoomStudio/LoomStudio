import { chmod, mkdir, open, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ObservationEntry, ObservationPersistenceState } from './types.js'

/** One writer and one dirty bit: producer traffic never creates a disk-write queue. */
export function createObservationPersistence(options: {
  directory: string
  maxFileBytes: number
  snapshot(): ObservationEntry[]
  restore(records: unknown[]): void
}) {
  const settingsFile = join(options.directory, 'settings.json')
  const snapshotFile = join(options.directory, 'snapshot.json')
  let enabled = false
  let dirty = false
  let settingsDirty = false
  let stopped = false
  let ioError: string | undefined
  let recoveryError: string | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let writing: Promise<void> | undefined
  const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 1000)
  const state = (): ObservationPersistenceState => ({ enabled, available: true,
    ...((recoveryError || ioError) ? { error: [recoveryError, ioError].filter(Boolean).join('; ') } : {}) })
  const ready = initialize()

  async function initialize() {
    try {
      const settings = await readJson(settingsFile, 1024)
      if (settings !== undefined) {
        if (!isRecord(settings) || settings.version !== 1 || typeof settings.enabled !== 'boolean') throw new Error('Invalid observation persistence settings')
        enabled = settings.enabled
      }
      if (!enabled) {
        await removeSnapshot()
        return
      }
      const snapshot = await readJson(snapshotFile, options.maxFileBytes)
      if (snapshot !== undefined) {
        if (!isRecord(snapshot) || snapshot.version !== 1 || !Array.isArray(snapshot.records)) throw new Error('Invalid observation snapshot')
        options.restore(snapshot.records)
        // Restore may discard every expired record; rewrite even when memory stayed empty.
        changed()
      }
      await rm(`${snapshotFile}.tmp`, { force: true })
    } catch (error) { recoveryError = errorText(error) }
  }
  async function atomicWrite(filename: string, content: string) {
    await mkdir(options.directory, { recursive: true, mode: 0o700 })
    await chmod(options.directory, 0o700)
    const temporary = `${filename}.tmp`
    try {
      await writeFile(temporary, content, { mode: 0o600 })
      await chmod(temporary, 0o600)
      await rename(temporary, filename)
    } finally {
      await rm(temporary, { force: true })
    }
  }
  async function removeSnapshot() {
    const results = await Promise.allSettled([rm(snapshotFile, { force: true }), rm(`${snapshotFile}.tmp`, { force: true })])
    const errors = results.filter(result => result.status === 'rejected').map(result => result.reason)
    if (errors.length) throw new Error(errors.map(errorText).join('; '))
  }
  async function commit() {
    const failures: string[] = []
    if (settingsDirty) {
      // Read the desired state once per pass. A concurrent toggle sets dirty again.
      const savedEnabled = enabled
      try {
        await atomicWrite(settingsFile, JSON.stringify({ version: 1, enabled: savedEnabled }))
        if (enabled === savedEnabled) settingsDirty = false
      } catch (error) { failures.push(errorText(error)) }
    }
    try {
      if (enabled) {
        const content = JSON.stringify({ version: 1, records: options.snapshot() })
        if (Buffer.byteLength(content, 'utf8') > options.maxFileBytes) throw new Error('Observation snapshot exceeds disk budget')
        await atomicWrite(snapshotFile, content)
      } else await removeSnapshot()
    } catch (error) { failures.push(errorText(error)) }
    ioError = failures.length ? failures.join('; ') : undefined
  }
  function drain(): Promise<void> {
    if (timer) { clearTimeout(timer); timer = undefined }
    if (writing) return writing
    writing = (async () => {
      await ready
      while (dirty) {
        dirty = false
        await commit()
        // A failed disk must not cause a hot retry loop. A later write or toggle retries.
        if (ioError && !dirty) break
      }
    })().catch(error => { ioError = errorText(error) }).finally(() => {
      writing = undefined
      if (dirty) return drain()
    })
    return writing
  }
  function changed() {
    if (stopped || !enabled) return
    dirty = true
    if (writing || timer) return
    timer = setTimeout(() => { timer = undefined; void drain() }, 250)
    timer.unref?.()
  }
  return {
    ready: () => ready,
    async state() { await ready; return state() },
    changed,
    async setEnabled(value: boolean) {
      await ready
      if (stopped) return { ...state(), error: 'Observation store is closed' }
      enabled = value
      settingsDirty = true
      dirty = true
      await drain()
      if (!ioError) recoveryError = undefined
      return state()
    },
    async flush() { await ready; if (writing || enabled || settingsDirty) await drain() },
    async close() { stopped = true; await ready; if (writing || enabled || settingsDirty) await drain(); else if (timer) clearTimeout(timer) },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

async function readJson(filename: string, maxBytes: number): Promise<unknown> {
  let file
  try { file = await open(filename, 'r') }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
  try {
    const stats = await file.stat()
    if (!stats.isFile() || stats.size > maxBytes) throw new Error('Observation persistence file exceeds read budget')
    const buffer = Buffer.alloc(stats.size + 1)
    let length = 0
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, length)
      if (!bytesRead) break
      length += bytesRead
    }
    if (length > stats.size) throw new Error('Observation persistence file changed while reading')
    return JSON.parse(buffer.subarray(0, length).toString('utf8'))
  } finally { await file.close() }
}
