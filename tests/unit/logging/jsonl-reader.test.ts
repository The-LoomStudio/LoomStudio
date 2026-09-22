import { mkdtemp, writeFile, appendFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createJsonlLogReader } from '../../../packages/logging/src/jsonl-reader.js'
import { createMemoryLogSink } from '../../../packages/logging/src/memory-sink.js'
import { createRootLogger } from '../../../packages/logging/src/logger.js'
import { createExtensionLogWriter } from '../../../packages/logging/src/extension-logger.js'
import { queryExtensionLogs } from '../../../packages/logging/src/query.js'
import type { LogRecord } from '../../../packages/logging/src/types.js'

const directories: string[] = []
const range = { since: '2026-09-22T00:00:00.000Z', until: '2026-09-22T23:59:59.999Z', limit: 1 }
const record = (message: string): LogRecord => ({ timestamp: '2026-09-22T10:00:00.000Z', level: 'info', service: 'test', instanceId: 'one', namespace: 'test', message })
const lines = (...messages: string[]) => messages.map(message => JSON.stringify(record(message))).join('\n') + '\n'
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'loom-log-reader-'))
  directories.push(directory)
  return { directory, reader: createJsonlLogReader({ directory }), path: (segment = 0) => join(directory, `2026-09-22-test-one-1.${segment}.jsonl`) }
}
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))) })

describe('JSONL history reader', () => {
  it('pages a bounded snapshot across numeric segments without admitting later appends', async () => {
    const { reader, path } = await setup()
    await writeFile(path(2), lines('second'))
    await writeFile(path(), lines('first', 'next'))
    let page = await reader.query(range)
    expect(page.items.map(item => item.message)).toEqual(['first'])
    await appendFile(path(), lines('not in snapshot'))
    page = await reader.query({ ...range, cursor: page.cursor })
    expect(page.items.map(item => item.message)).toEqual(['next'])
    page = await reader.query({ ...range, cursor: page.cursor })
    expect(page.items.map(item => item.message)).toEqual(['second'])
    expect(page.hasMore).toBe(false)
  })
  it('reports corrupt lines, incomplete tails and removed segments', async () => {
    const { reader, path } = await setup()
    await writeFile(path(), lines('first'))
    await writeFile(path(1), lines('removed'))
    await writeFile(path(2), 'bad json\n' + lines('valid') + '{"timestamp":')
    const first = await reader.query(range)
    await rm(path(1))
    const next = await reader.query({ ...range, cursor: first.cursor, limit: 20 })
    expect(next.items.map(item => item.message)).toEqual(['valid'])
    expect(next.issues).toEqual(expect.arrayContaining([
      { reason: 'missing-file', count: 1 }, { reason: 'invalid-line', count: 1 }, { reason: 'incomplete-line', count: 1 },
    ]))
  })
  it('bounds giant lines and keeps discarding their tail across pages', async () => {
    const { reader, path } = await setup()
    await writeFile(path(), 'x'.repeat(3 * 1024 * 1024) + JSON.stringify(record('fake tail')) + '\n' + lines('valid'))
    const first = await reader.query(range)
    expect(first.items).toEqual([])
    expect(first.hasMore).toBe(true)
    expect(first.scannedBytes).toBeLessThanOrEqual(2 * 1024 * 1024)
    const next = await reader.query({ ...range, cursor: first.cursor })
    expect(next.items.map(item => item.message)).toEqual(['valid'])
  })
  it('rejects cursor reuse with changed filters, arbitrary paths and symlinks', async () => {
    const { reader, path, directory } = await setup()
    await writeFile(path(), lines('first', 'next'))
    const first = await reader.query(range)
    await expect(reader.query({ ...range, text: 'different', cursor: first.cursor })).rejects.toThrow('query changed')
    await expect(reader.query({ ...range, cursor: '../../secret' })).rejects.toThrow('Invalid')
    await expect(reader.query({ ...range, path: '/etc/passwd' } as never)).rejects.toThrow('Unknown')
    await rm(path())
    await writeFile(join(directory, 'outside'), lines('secret'))
    await symlink(join(directory, 'outside'), path())
    const next = await reader.query({ ...range, cursor: first.cursor })
    expect(next.items).toEqual([])
    expect(next.issues).toContainEqual({ reason: 'changed-file', count: 1 })
  })
  it('reports scan continuation even when a selective query has no matches and supports abort', async () => {
    const { reader, path } = await setup()
    await writeFile(path(), lines(...Array.from({ length: 20_000 }, () => 'unrelated')))
    const page = await reader.query({ ...range, text: 'missing' })
    expect(page.items).toEqual([])
    expect(page.hasMore).toBe(true)
    await expect(reader.query(range, AbortSignal.abort())).rejects.toThrow()
  })
})

describe('extension log ownership', () => {
  it('keeps legacy data separate and prevents identity override and cross-package reads', async () => {
    const memory = createMemoryLogSink({ capacity: 500 })
    const root = createRootLogger({ service: 'test', instanceId: 'one', sinks: [memory] })
    const log = createExtensionLogWriter(root.child('extension'), { packageId: 'ours', runtime: 'server' })
    log.info('legacy', { packageId: 'other', event: 'payload' })
    log.child('sync').log('info', 'structured', { event: 'sync.completed', data: { count: 2 }, extension: { packageId: 'other' } } as never)
    root.child('extension').info('old untrusted', { data: { packageId: 'ours' } })
    const page = await queryExtensionLogs({ current: memory }, 'ours', { limit: 10 }, 'server')
    expect(page.items.map(item => item.message)).toEqual(['legacy', 'structured'])
    expect(page.items[1]?.event).toBe('extension.sync.completed')
    await expect(queryExtensionLogs({ current: memory }, 'ours', { limit: 10, packageId: 'other' } as never, 'server')).rejects.toThrow('cannot set')
  })
  it('bounds extension records and shares the package rate budget across children and activations', () => {
    const memory = createMemoryLogSink({ capacity: 500 })
    const root = createRootLogger({ service: 'test', instanceId: 'one', sinks: [memory] })
    const writer = root.child('extension')
    const log = createExtensionLogWriter(writer, { packageId: 'ours', runtime: 'client' })
    log.info('big', { value: 'x'.repeat(20_000) })
    for (let index = 0; index < 250; index++) log.child('sync').info('event')
    createExtensionLogWriter(writer, { packageId: 'ours', moduleId: 'other-module', runtime: 'client' }).info('must still be limited')
    expect(memory.list()[0]?.data?.logDataOmitted).toBe(true)
    expect(memory.list()).toHaveLength(201)
    expect(memory.list().at(-1)?.event).toBe('extension.logs.limited')
  })
})
