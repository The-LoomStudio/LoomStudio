import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRootLogger, type LogRecord } from '@loom-studio/logging'
import { createJsonlFileSink } from '@loom-studio/logging/node'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('JSONL file sink', () => {
  it('rejects a total limit smaller than one file', () => {
    expect(() => createJsonlFileSink({
      directory: '/tmp/unused-loom-logging-path',
      maxFileBytes: 200,
      maxTotalBytes: 100,
    })).toThrow('maxTotalBytes must be greater than or equal to maxFileBytes')
  })

  it('writes independently parseable records and flushes on close', async () => {
    const directory = await createTemporaryDirectory()
    const sink = createJsonlFileSink({ directory })
    const root = createRootLogger({
      service: 'studio-server',
      instanceId: 'server-1',
      sinks: [sink],
      clock: { now: () => new Date('2026-07-22T08:00:00.000Z') },
    })
    const logger = root.child('system')

    logger.info('Studio server starting', { event: 'server.starting' })
    logger.info('Studio server started', { event: 'server.started', data: { port: 4173 } })
    await root.close()

    const files = await readdir(directory)
    expect(files).toHaveLength(1)
    const records = (await readFile(join(directory, files[0]!), 'utf8'))
      .trim()
      .split('\n')
      .map(line => JSON.parse(line) as LogRecord)
    expect(records.map(record => record.event)).toEqual(['server.starting', 'server.started'])
    expect(records[1]?.data).toEqual({ port: 4173 })
  })

  it('rotates files without splitting a record', async () => {
    const directory = await createTemporaryDirectory()
    const sink = createJsonlFileSink({
      directory,
      maxFileBytes: 260,
      maxTotalBytes: 10_000,
    })
    const root = createRootLogger({
      service: 'studio-server',
      instanceId: 'server-1',
      sinks: [sink],
      clock: { now: () => new Date('2026-07-22T08:00:00.000Z') },
    })
    const logger = root.child('system')

    logger.info('First lifecycle record')
    logger.info('Second lifecycle record')
    logger.info('Third lifecycle record')
    await root.close()

    const files = await readdir(directory)
    expect(files.length).toBeGreaterThan(1)
    const lines = (await Promise.all(files.map(file => readFile(join(directory, file), 'utf8'))))
      .flatMap(content => content.trim().split('\n'))
      .filter(Boolean)
    expect(lines.map(line => (JSON.parse(line) as LogRecord).message)).toEqual([
      'First lifecycle record',
      'Second lifecycle record',
      'Third lifecycle record',
    ])
  })

  it('reports asynchronous filesystem failures', async () => {
    const directory = await createTemporaryDirectory()
    const invalidDirectory = join(directory, 'not-a-directory')
    await writeFile(invalidDirectory, 'file')
    const onError = vi.fn()
    const sink = createJsonlFileSink({ directory: invalidDirectory, onError })
    const root = createRootLogger({ service: 'studio-server', instanceId: 'server-1', sinks: [sink] })

    root.child('system').error('Cannot persist logs')
    await root.flush()

    expect(onError).toHaveBeenCalledOnce()
    expect(sink.getStats().dropped).toBe(1)
  })
})

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'loom-logging-'))
  temporaryDirectories.push(directory)
  return directory
}
