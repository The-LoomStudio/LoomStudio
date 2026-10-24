import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createObservationStore, measureObservationSize } from '../../../packages/application-runtime/src/observability/store.js'
import { createObservationPersistence } from '../../../packages/application-runtime/src/observability/persistence.js'
import type { ObservationStore } from '../../../packages/application-runtime/src/observability/types.js'

const directories: string[] = []
const stores: ObservationStore[] = []
async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'loom-observations-'))
  directories.push(path)
  return join(path, 'observations')
}
function store(options: Parameters<typeof createObservationStore>[0] = {}) {
  const value = createObservationStore(options)
  stores.push(value)
  return value
}
const record = (id: string) => ({ id, kind: 'run' as const, title: id, status: 'running' as const })
const snapshot = async (path: string) => JSON.parse(await readFile(join(path, 'snapshot.json'), 'utf8'))
afterEach(async () => {
  await Promise.all(stores.splice(0).map(store => store.dispose()))
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('observation persistence', () => {
  it('is unavailable without a path, and defaults off without writing captured content', async () => {
    const memory = store()
    expect(await memory.setPersistence(true)).toEqual({ enabled: false, available: false })
    const path = await directory()
    const observations = store({ persistencePath: path })
    await observations.ready()
    observations.write(record('memory-only'))
    await observations.flush()
    expect(await observations.persistence()).toEqual({ enabled: false, available: true })
    await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(observations.get('memory-only')).not.toBeNull()
  })

  it('enables with existing records, asynchronously captures changes, and restores original lifetimes', async () => {
    const path = await directory()
    let time = 0
    const observations = store({ persistencePath: path, now: () => time, ttlMs: 100 })
    await observations.ready()
    observations.write(record('run'))
    expect(await observations.setPersistence(true)).toEqual({ enabled: true, available: true })
    expect((await snapshot(path)).records[0].id).toBe('run')
    time = 50
    observations.patch('run', { status: 'completed' })
    observations.write({ ...record('request'), kind: 'request', parentId: 'run' })
    await expect.poll(async () => (await snapshot(path)).records.length).toBe(2)
    await observations.dispose()
    expect((await stat(path)).mode & 0o777).toBe(0o700)
    expect((await stat(join(path, 'settings.json'))).mode & 0o777).toBe(0o600)
    expect((await stat(join(path, 'snapshot.json'))).mode & 0o777).toBe(0o600)
    time = 75
    const restored = store({ persistencePath: path, now: () => time, ttlMs: 100 })
    await restored.ready()
    expect(await restored.persistence()).toEqual({ enabled: true, available: true })
    expect(restored.get('run')).toMatchObject({ status: 'completed', capturedAt: new Date(0).toISOString(),
      updatedAt: new Date(50).toISOString(), expiresAt: new Date(100).toISOString() })
    expect(restored.get('request')).not.toBeNull()
    await restored.dispose()
    time = 100
    const expired = store({ persistencePath: path, now: () => time, ttlMs: 100 })
    await expired.ready()
    expect(expired.get('run')).toBeNull()
    expect(expired.get('request')).toBeNull()
    await expired.flush()
    expect((await snapshot(path)).records).toEqual([])
  })

  it('awaits final writes, preserves capacity accounting after restore, and removes logs when disabled', async () => {
    const path = await directory()
    const observations = store({ persistencePath: path, now: () => 0, limits: { records: 2, entryBytes: 2000, totalBytes: 5000 } })
    await observations.ready()
    observations.write(record('a'))
    await observations.setPersistence(true)
    observations.write(record('b'))
    await observations.dispose()
    expect((await snapshot(path)).records.map((record: { id: string }) => record.id)).toEqual(['a', 'b'])
    const restored = store({ persistencePath: path, now: () => 1, limits: { records: 2, entryBytes: 2000, totalBytes: 5000 } })
    await restored.ready()
    restored.write(record('c'))
    expect(restored.get('a')).toBeNull()
    expect(restored.list().records).toHaveLength(2)
    await restored.setPersistence(false)
    expect(restored.get('c')).not.toBeNull()
    expect(await readdir(path)).toEqual(['settings.json'])
    await restored.dispose()
    const disabled = store({ persistencePath: path, now: () => 2 })
    await disabled.ready()
    expect(await disabled.persistence()).toEqual({ enabled: false, available: true })
    expect(disabled.list().records).toEqual([])
  })

  it('serializes disable after an in-flight snapshot and honors the last of concurrent toggles', async () => {
    const path = await directory()
    let snapshotStarted!: () => void
    const started = new Promise<void>(resolve => { snapshotStarted = resolve })
    let watch = false
    const persistence = createObservationPersistence({ directory: path, maxFileBytes: 4096,
      snapshot() { if (watch) snapshotStarted(); return [] }, restore() {} })
    await persistence.setEnabled(true)
    watch = true
    persistence.changed()
    const flushing = persistence.flush()
    await started
    const disabling = persistence.setEnabled(false)
    await Promise.all([flushing, disabling])
    expect(await readdir(path)).toEqual(['settings.json'])
    await Promise.all([persistence.setEnabled(true), persistence.setEnabled(false), persistence.setEnabled(true)])
    expect(await persistence.state()).toEqual({ enabled: true, available: true })
    expect(JSON.parse(await readFile(join(path, 'settings.json'), 'utf8')).enabled).toBe(true)
    expect(await snapshot(path)).toEqual({ version: 1, records: [] })
    await persistence.close()
  })

  it('bills restored evidence against the same byte budget as new records', async () => {
    const path = await directory()
    const request = { response: { message: { role: 'assistant', content: 'x'.repeat(200) } } }
    const size = measureObservationSize({ ...record('a'), request, availability: 'recorded',
      capturedAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(), expiresAt: new Date(86_400_000).toISOString() }, 10000)
    const options = { persistencePath: path, now: () => 0, limits: { records: 10, entryBytes: size + 100, totalBytes: size * 2 + 100 } }
    const observations = store(options)
    await observations.ready()
    observations.write({ ...record('a'), request })
    observations.write({ ...record('b'), request })
    await observations.setPersistence(true)
    await observations.dispose()
    const restored = store(options)
    await restored.ready()
    expect(restored.list().records).toHaveLength(2)
    restored.write({ ...record('c'), request })
    expect(restored.get('a')).toBeNull()
    expect(restored.get('b')).not.toBeNull()
    expect(restored.get('c')).not.toBeNull()
  })

  it('reports disk failures without interrupting capture and can retry an explicit toggle', async () => {
    const path = await directory()
    await writeFile(path, 'blocked directory')
    const observations = store({ persistencePath: path })
    await observations.ready()
    expect((await observations.setPersistence(true)).error).toBeTruthy()
    expect(() => observations.write(record('still-captured'))).not.toThrow()
    expect(observations.get('still-captured')).not.toBeNull()
    await observations.flush()
    expect((await observations.persistence()).error).toBeTruthy()
    await rm(path)
    expect(await observations.setPersistence(true)).toEqual({ enabled: true, available: true })
    expect((await snapshot(path)).records[0].id).toBe('still-captured')
  })

  it.each(['{broken json', JSON.stringify({ version: 1, records: [{ id: 'not-a-record' }] })])('reports corrupt snapshots without restoring invalid records', async content => {
    const path = await directory()
    await mkdir(path)
    await writeFile(join(path, 'settings.json'), JSON.stringify({ version: 1, enabled: true }))
    await writeFile(join(path, 'snapshot.json'), content)
    const observations = store({ persistencePath: path })
    await observations.ready()
    expect((await observations.persistence()).error).toBeTruthy()
    expect(observations.list().records).toEqual([])
    expect(await readFile(join(path, 'snapshot.json'), 'utf8')).toBe(content)
  })

  it('bounds corrupted files before parsing and removes stale snapshots when the saved switch is off', async () => {
    const path = await directory()
    await mkdir(path)
    await writeFile(join(path, 'settings.json'), JSON.stringify({ version: 1, enabled: true }))
    await writeFile(join(path, 'snapshot.json'), 'x'.repeat(5000))
    const observations = store({ persistencePath: path, limits: { totalBytes: 1000 } })
    await observations.ready()
    expect((await observations.persistence()).error).toContain('read budget')
    await observations.dispose()
    await writeFile(join(path, 'settings.json'), JSON.stringify({ version: 1, enabled: false }))
    await writeFile(join(path, 'snapshot.json.tmp'), 'stale evidence')
    const disabled = store({ persistencePath: path })
    await disabled.ready()
    expect(await disabled.persistence()).toEqual({ enabled: false, available: true })
    expect(await readdir(path)).toEqual(['settings.json'])
  })
})
