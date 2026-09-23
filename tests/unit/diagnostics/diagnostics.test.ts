import { createInMemoryDiagnosticsRegistry } from '@loom-studio/diagnostics'
import { describe, expect, it } from 'vitest'

describe('bounded runtime diagnostics', () => {
  it('aggregates repeated failures with the latest context and first occurrence identity', () => {
    const registry = createInMemoryDiagnosticsRegistry()
    const first = registry.add({
      source: 'extension', packageId: 'example.one', moduleId: 'server',
      severity: 'error', code: 'extension.failed', message: 'first',
      createdAt: '2026-09-01T00:00:00.000Z', details: { attempt: 0 },
    })
    for (let attempt = 1; attempt < 1000; attempt++) {
      registry.add({
        source: 'extension', packageId: 'example.one', moduleId: 'server',
        severity: 'error', code: 'extension.failed', message: `attempt ${attempt}`,
        createdAt: '2026-09-02T00:00:00.000Z', details: { attempt },
        correlationId: `call-${attempt}`,
      })
    }
    expect(registry.list()).toHaveLength(1)
    expect(registry.list()[0]).toMatchObject({
      id: first.id, createdAt: first.createdAt, occurrences: 1000,
      lastSeenAt: '2026-09-02T00:00:00.000Z', message: 'attempt 999',
      correlationId: 'call-999', details: { attempt: 999 },
    })
  })

  it('keeps explicit fault identities, modules and documents separate', () => {
    const registry = createInMemoryDiagnosticsRegistry()
    const base = { source: 'event-hub', severity: 'error' as const, code: 'failed', message: 'failure' }
    registry.add({ ...base, id: 'subscription-a' })
    registry.add({ ...base, id: 'subscription-b' })
    registry.add({ ...base, id: 'subscription-a' })
    registry.add({ ...base, moduleId: 'one' })
    registry.add({ ...base, moduleId: 'two' })
    registry.add({ ...base, documentId: 'one' })
    registry.add({ ...base, documentId: 'two' })
    expect(registry.list()).toHaveLength(6)
    expect(registry.list().find(item => item.id === 'subscription-a')?.occurrences).toBe(2)
    expect(registry.list({ moduleId: 'one' })).toHaveLength(1)
  })

  it('keeps one noisy source bounded without evicting the other source', () => {
    const registry = createInMemoryDiagnosticsRegistry()
    registry.add({ source: 'quiet', severity: 'warning', code: 'important', message: 'keep' })
    for (let index = 0; index < 2000; index++) {
      registry.add({ source: 'noisy', severity: 'error', code: `failure-${index}`, message: 'failure' })
    }
    expect(registry.list({ source: 'quiet' })).toHaveLength(1)
    expect(registry.list({ source: 'noisy' })).toHaveLength(100)
    expect(registry.list({ source: 'noisy' })[0]?.code).toBe('failure-1900')
    expect(registry.list().at(-1)?.code).toBe('failure-1999')
  })

  it('bounds total retention and resets aggregation on clear', () => {
    const registry = createInMemoryDiagnosticsRegistry()
    for (let index = 0; index < 1200; index++) {
      registry.add({ source: `source-${index}`, severity: 'info', code: 'status', message: 'status' })
    }
    expect(registry.list()).toHaveLength(1000)
    expect(registry.list()[0]?.source).toBe('source-200')
    registry.clear()
    expect(registry.list()).toEqual([])
    expect(registry.add({ source: 'source-1199', severity: 'info', code: 'status', message: 'new' }).occurrences).toBe(1)
  })
})
