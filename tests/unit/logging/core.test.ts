import type { JsonObject } from '@loom-studio/shared'
import { describe, expect, it, vi } from 'vitest'
import { createConsoleLogSink, createMemoryLogSink, createRootLogger, readLogFailure, readLogPresentation, type LogRecord, type LogSink } from '@loom-studio/logging'

describe('logging core', () => {
  it('creates normalized records with bound service and namespace', () => {
    const records: LogRecord[] = []
    const sink: LogSink = {
      name: 'capture',
      write: record => records.push(record),
    }
    const root = createRootLogger({
      service: 'studio-server',
      instanceId: 'server-1',
      sinks: [sink],
      clock: { now: () => new Date('2026-07-22T08:00:00.000Z') },
    })

    root.child('transport').child('rpc').info('RPC call completed', {
      event: 'rpc.completed',
      data: { durationMs: 12, accessToken: 'secret-value', tokenCount: 42 },
      correlationId: 'corr-1',
    })

    expect(records).toEqual([{
      timestamp: '2026-07-22T08:00:00.000Z',
      level: 'info',
      service: 'studio-server',
      instanceId: 'server-1',
      namespace: 'transport.rpc',
      message: 'RPC call completed',
      event: 'rpc.completed',
      data: { durationMs: 12, accessToken: '[REDACTED]', tokenCount: 42 },
      correlationId: 'corr-1',
    }])
  })

  it('normalizes errors and circular data without failing the caller', () => {
    const memory = createMemoryLogSink({ capacity: 2 })
    const root = createRootLogger({ service: 'studio-server', instanceId: 'server-1', sinks: [memory] })
    const circular: Record<string, unknown> = { value: 1 }
    circular.self = circular
    const error = Object.assign(new Error('Provider failed'), { code: 'provider.failed' })

    root.child('runtime.provider').error('Provider request failed', {
      error,
      data: circular as JsonObject,
    })

    expect(memory.list()[0]).toMatchObject({
      data: { value: 1, self: '[Circular]' },
      error: {
        name: 'Error',
        code: 'provider.failed',
        message: 'Provider failed',
      },
    })
  })

  it('keeps dispatching when one sink fails', () => {
    const failures: string[] = []
    const memory = createMemoryLogSink({ capacity: 1 })
    const broken: LogSink = {
      name: 'broken',
      write: () => {
        throw new Error('write failed')
      },
    }
    const root = createRootLogger({
      service: 'studio-server',
      instanceId: 'server-1',
      sinks: [broken, memory],
      onSinkError: failure => failures.push(`${failure.sink}.${failure.operation}`),
    })

    root.child('system').warn('Still running')

    expect(failures).toEqual(['broken.write'])
    expect(memory.list()).toHaveLength(1)
  })

  it('rejects invalid namespaces', () => {
    const root = createRootLogger({ service: 'studio-server', instanceId: 'server-1', sinks: [] })

    expect(() => root.child('Runtime Provider')).toThrow('lowercase dot-separated name')
    expect(() => root.child('runtime..provider')).toThrow('lowercase dot-separated name')
  })
})

describe('memory log sink', () => {
  it('evicts the oldest record and reports dropped entries', () => {
    const memory = createMemoryLogSink({ capacity: 2 })
    const root = createRootLogger({ service: 'studio-server', instanceId: 'server-1', sinks: [memory] })
    const logger = root.child('system')

    logger.info('one')
    logger.info('two')
    logger.info('three')

    expect(memory.list().map(record => record.message)).toEqual(['two', 'three'])
    expect(memory.getStats()).toEqual({ size: 2, capacity: 2, dropped: 1 })
  })

  it('paginates with an opaque cursor', () => {
    const memory = createMemoryLogSink({ capacity: 5, cursorId: 'test-buffer' })
    const root = createRootLogger({ service: 'studio-server', instanceId: 'server-1', sinks: [memory] })
    const logger = root.child('system')
    logger.info('one')
    logger.info('two')
    logger.info('three')

    const first = memory.query({ limit: 2 })
    const second = memory.query({ limit: 2, cursor: first.cursor })

    expect(first).toMatchObject({
      items: [{ message: 'one' }, { message: 'two' }],
      cursor: 'memory:test-buffer:2',
      hasMore: true,
    })
    expect(first.gap).toBeUndefined()
    expect(second).toMatchObject({
      items: [{ message: 'three' }],
      cursor: 'memory:test-buffer:3',
      hasMore: false,
    })
  })

  it('filters records while advancing the cursor to the scanned tail', () => {
    const memory = createMemoryLogSink({ capacity: 5, cursorId: 'test-buffer' })
    const root = createRootLogger({ service: 'studio-server', instanceId: 'server-1', sinks: [memory] })
    root.child('system').debug('debug')
    root.child('runtime.provider').warn('warning')
    root.child('runtime.provider.retry').info('retry')

    const page = memory.query({
      limit: 5,
      levels: ['warn'],
      namespacePrefix: 'runtime.provider',
    })

    expect(page.items.map(record => record.message)).toEqual(['warning'])
    expect(page.cursor).toBe('memory:test-buffer:3')
    expect(page.hasMore).toBe(false)
  })

  it('reports an eviction gap without adding IDs to log records', () => {
    const memory = createMemoryLogSink({ capacity: 2, cursorId: 'test-buffer' })
    const root = createRootLogger({ service: 'studio-server', instanceId: 'server-1', sinks: [memory] })
    const initialCursor = memory.query({ limit: 1 }).cursor
    const logger = root.child('system')
    logger.info('one')
    logger.info('two')
    logger.info('three')

    const page = memory.query({ limit: 5, cursor: initialCursor })

    expect(page.items.map(record => record.message)).toEqual(['two', 'three'])
    expect(page.gap).toEqual({ reason: 'evicted', dropped: 1 })
    expect(page.items.every(record => !('id' in record))).toBe(true)
  })

  it('reports a reset when a cursor belongs to an old buffer generation', () => {
    const memory = createMemoryLogSink({ capacity: 2, cursorId: 'test-buffer' })
    const root = createRootLogger({ service: 'studio-server', instanceId: 'server-1', sinks: [memory] })
    root.child('system').info('before clear')
    const cursor = memory.query({ limit: 1 }).cursor
    memory.clear()
    root.child('system').info('after clear')

    const page = memory.query({ limit: 2, cursor })

    expect(page.items.map(record => record.message)).toEqual(['after clear'])
    expect(page.gap).toEqual({ reason: 'reset' })
  })
})

describe('console log sink', () => {
  it('uses the matching console level', () => {
    const output = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }
    const root = createRootLogger({
      service: 'studio-client',
      instanceId: 'client-1',
      sinks: [createConsoleLogSink({ console: output })],
      clock: { now: () => new Date('2026-07-22T08:00:00.000Z') },
    })

    root.child('ui.viewer').warn('Viewer buffer truncated', { data: { dropped: 3 } })

    expect(output.warn).toHaveBeenCalledWith(
      '[2026-07-22T08:00:00.000Z] WARN studio-client/ui.viewer',
      'Viewer buffer truncated',
    )
  })

  it('filters console output without affecting other sinks', () => {
    const output = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }
    const memory = createMemoryLogSink({ capacity: 2 })
    const root = createRootLogger({
      service: 'studio-server',
      instanceId: 'server-1',
      sinks: [
        memory,
        createConsoleLogSink({
          console: output,
          filter: record => record.namespace === 'system' || record.level === 'error',
        }),
      ],
    })

    root.child('transport.rpc').info('RPC completed')
    root.child('system').info('Server started')

    expect(memory.list().map(record => record.message)).toEqual(['RPC completed', 'Server started'])
    expect(output.info).toHaveBeenCalledTimes(1)
    expect(output.info.mock.calls[0]?.[1]).toBe('Server started')
  })

  it('keeps references out of compact console output but retains explicit details', () => {
    const output = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const memory = createMemoryLogSink({ capacity: 2 })
    const root = createRootLogger({ service: 'test', instanceId: 'test', sinks: [memory, createConsoleLogSink({ console: output })] })
    root.child('runtime.provider').info('Response completed', {
      data: { runId: 'full-reference', durationMs: 3063.99, detail: 'Step 2 · stop', usage: { inputTokens: 455 } },
      callId: 'call-reference',
    })
    expect(JSON.stringify(output.info.mock.calls)).not.toContain('reference')
    expect(output.info.mock.calls[0]?.[1]).toContain('3.06 s')
    expect(output.info.mock.calls[0]?.[1]).toContain('tokens in 455')
    expect(output.info.mock.calls[0]?.[1]).not.toContain('out 0')
    const record = memory.list()[0]!
    expect(record.callId).toBe('call-reference')
    createConsoleLogSink({ console: output, verbose: true }).write(record)
    expect(output.info.mock.calls[1]?.[2]).toMatchObject({ callId: 'call-reference' })
  })
})

describe('safe operational metadata', () => {
  it('classifies HTTP failures without copying payloads, codes or secret error text', () => {
    const error = Object.assign(new Error('secret response'), { statusCode: 429, code: 'secret-code', responseBody: 'secret-body' })
    expect(readLogFailure(error)).toEqual({ failureType: 'HttpError', failureReason: 'Rate limit exceeded (HTTP 429)', statusCode: 429 })
    expect(readLogFailure(Object.assign(new Error('secret'), { name: 'secret-name' }))).toEqual({ failureType: 'Error', failureReason: 'Operation failed' })
  })

  it('never hides warnings or errors as technical details', () => {
    const record: LogRecord = { timestamp: '', service: 'test', instanceId: 'test', namespace: 'transport.rpc', message: 'Failure', level: 'error', data: { technical: true } }
    expect(readLogPresentation(record).technical).toBe(false)
    expect(readLogPresentation({ ...record, level: 'info' }).technical).toBe(true)
  })
})
