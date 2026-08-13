import { createInMemoryDiagnosticsRegistry } from '@loom-studio/diagnostics'
import { createDocumentDataCommitSource, createInMemoryDocumentStore } from '@loom-studio/document-store'
import type { ExtensionHost } from '@loom-studio/extension-host'
import { createKernel } from '@loom-studio/kernel'
import { createLoomRunner } from '@loom-studio/loom-runner'
import { createInMemoryTraceAuditStore, type TraceAuditStore } from '@loom-studio/trace-audit'
import { describe, expect, it } from 'vitest'

function createTestKernel(traceAudit: TraceAuditStore = createInMemoryTraceAuditStore()) {
  const diagnostics = createInMemoryDiagnosticsRegistry()
  const documents = createInMemoryDocumentStore()
  const extensionHost: ExtensionHost = {
    discover: async () => { throw new Error('not implemented') },
    activate: async () => { throw new Error('not implemented') },
    activateAll: async () => [],
    reload: async () => { throw new Error('not implemented') },
    dispose: async () => {},
    disposeAll: async () => {},
    list: () => [],
    diagnostics: () => [],
  }
  const loomRunner = createLoomRunner({ traceAudit })
  const kernel = createKernel({
    documents,
    dataCommits: createDocumentDataCommitSource(documents),
    diagnostics,
    traceAudit,
    extensionHost,
    loomRunner,
    environment: 'test',
  })

  return { kernel, diagnostics, traceAudit }
}

describe('loom runner pass execution', () => {
  it('runs a no-op pass', async () => {
    const runner = createLoomRunner()

    const result = await runner.run({
      fragments: [{ id: 'f1', content: 'hello', meta: {} }],
      passes: [{ name: 'noop' }],
    })

    expect(result.fragments[0]).toMatchObject({ id: 'f1', content: 'hello' })
  })

  it('runs an uppercase pass', async () => {
    const runner = createLoomRunner()

    const result = await runner.run({
      fragments: [{ id: 'f1', content: 'hello', meta: {} }],
      passes: [{ name: 'uppercase' }],
    })

    expect(result.fragments[0]).toMatchObject({ id: 'f1', content: 'HELLO' })
  })

  it('reports missing passes as diagnostics', async () => {
    const runner = createLoomRunner()

    const result = await runner.run({
      fragments: [{ id: 'f1', content: 'hello', meta: {} }],
      passes: [{ name: 'missing' }],
    })

    expect(result.diagnostics?.some(diagnostic => diagnostic.code === 'loom/factory-missing')).toBe(true)
  })

  it('reports thrown passes as diagnostics', async () => {
    const runner = createLoomRunner()

    const result = await runner.run({
      fragments: [{ id: 'f1', content: 'hello', meta: {} }],
      passes: [{ name: 'throw' }],
    })

    expect(result.diagnostics?.some(diagnostic => diagnostic.code === 'loom/pass-threw')).toBe(true)
  })

  it('persists trace when trace is enabled', async () => {
    const traceAudit = createInMemoryTraceAuditStore()
    const runner = createLoomRunner({ traceAudit })

    const result = await runner.run({
      fragments: [{ id: 'f1', content: 'hello', meta: {} }],
      passes: [{ name: 'uppercase' }],
      trace: { enabled: true },
    })

    expect(result.traceId).toBeDefined()
    expect(traceAudit.listTraces()).toHaveLength(1)
  })

  it('does not fail run when trace persist fails by default', async () => {
    const runner = createLoomRunner({ traceAudit: failingTraceAudit() })

    const result = await runner.run({
      fragments: [{ id: 'f1', content: 'hello', meta: {} }],
      passes: [{ name: 'uppercase' }],
      trace: { enabled: true },
    })

    expect(result.fragments[0]).toMatchObject({ content: 'HELLO' })
    expect(result.diagnostics?.some(diagnostic => diagnostic.code === 'loom.trace_persist_failed')).toBe(true)
  })

  it('fails run when strict trace persist is enabled', async () => {
    const runner = createLoomRunner({ traceAudit: failingTraceAudit() })

    await expect(runner.run({
      fragments: [{ id: 'f1', content: 'hello', meta: {} }],
      passes: [{ name: 'uppercase' }],
      trace: { enabled: true, strictPersist: true },
    })).rejects.toThrow('persist failed')
  })
})

describe('kernel loom.run rpc contract', () => {
  it('runs loom.run through Kernel RPC and records diagnostics', async () => {
    const { kernel, diagnostics } = createTestKernel()
    await kernel.start()

    const result = await kernel.callRpc<{ fragments: Array<{ content: string }>; diagnostics: unknown[] }>('loom.run', {
      fragments: [{ id: 'f1', content: 'hello', meta: {} }],
      passes: [{ name: 'uppercase' }],
    })

    expect(result.fragments[0]?.content).toBe('HELLO')
    expect(diagnostics.list()).toEqual(result.diagnostics)
  })

  it('rejects forbidden runtime/provider fields', async () => {
    const { kernel } = createTestKernel()
    await kernel.start()

    await expect(kernel.callRpc('loom.run', {
      fragments: [{ id: 'f1', content: 'hello', meta: {} }],
      passes: [{ name: 'noop' }],
      messages: [],
      provider: 'example',
    })).rejects.toThrow('Forbidden loom.run fields')
  })

  it('exposes loom.run through system.introspect', async () => {
    const { kernel } = createTestKernel()
    await kernel.start()

    const result = await kernel.callRpc<{ methods: Array<{ name: string }> }>('system.introspect', {})

    expect(result.methods.some(method => method.name === 'loom.run')).toBe(true)
  })
})

function failingTraceAudit(): TraceAuditStore {
  return {
    appendTrace: () => {
      throw new Error('persist failed')
    },
    listTraces: () => [],
    appendAudit: () => {
      throw new Error('persist failed')
    },
    listAudit: () => [],
  }
}
