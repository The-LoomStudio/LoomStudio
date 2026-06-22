import { createInMemoryDiagnosticsRegistry } from '@loom-studio/diagnostics'
import { createInMemoryDocumentStore } from '@loom-studio/document-store'
import type { ExtensionHost } from '@loom-studio/extension-host'
import { createKernel } from '@loom-studio/kernel'
import type { LoomRunner } from '@loom-studio/loom-runner'
import { createInMemoryTraceAuditStore } from '@loom-studio/trace-audit'
import { describe, expect, it } from 'vitest'

function createTestKernel() {
  const diagnostics = createInMemoryDiagnosticsRegistry()
  const documents = createInMemoryDocumentStore()
  const traceAudit = createInMemoryTraceAuditStore()
  const extensionHost: ExtensionHost = {
    list: () => [],
    diagnostics: () => [],
  }
  const loomRunner: LoomRunner = {
    run: async input => ({ fragments: input.fragments }),
  }
  const kernel = createKernel({
    documents,
    diagnostics,
    traceAudit,
    extensionHost,
    loomRunner,
    environment: 'test',
  })

  return { kernel, documents, diagnostics, traceAudit }
}

describe('kernel rpc contract', () => {
  it('serves system.ping through the kernel rpc surface', async () => {
    const { kernel } = createTestKernel()
    await kernel.start()

    const result = await kernel.callRpc<{ ok: true; echo: string }>('system.ping', { echo: 'hello' })

    expect(result.ok).toBe(true)
    expect(result.echo).toBe('hello')
  })

  it('reports only platform capabilities from system.getInfo', async () => {
    const { kernel } = createTestKernel()
    await kernel.start()

    const result = await kernel.callRpc<{ capabilities: { documents: boolean; loomRun: boolean } }>('system.getInfo', {})

    expect(result.capabilities.documents).toBe(true)
    expect(result.capabilities.loomRun).toBe(true)
    expect(JSON.stringify(result)).not.toContain('chat')
    expect(JSON.stringify(result)).not.toContain('provider')
  })

  it('exposes kernel-owned methods and events through system.introspect', async () => {
    const { kernel } = createTestKernel()
    await kernel.start()

    const result = await kernel.callRpc<{ methods: Array<{ name: string }>; events: string[] }>('system.introspect', {})

    expect(result.methods.some(method => method.name === 'system.introspect')).toBe(true)
    expect(result.methods.some(method => method.name === 'docs.write')).toBe(true)
    expect(result.events).toContain('docs.changed')
  })

  it('rejects non-kernel namespace registration', () => {
    const { kernel } = createTestKernel()

    expect(() => kernel.registerKernelRpc('chat.send', () => ({}))).toThrow('Not a Kernel namespace')
  })

  it('rejects duplicate kernel rpc registration', async () => {
    const { kernel } = createTestKernel()
    await kernel.start()

    expect(() => kernel.registerKernelRpc('system.ping', () => ({}))).toThrow('already registered')
  })

  it('exposes injected platform services through getters', () => {
    const { kernel, documents, diagnostics, traceAudit } = createTestKernel()

    expect(kernel.getDocumentStore()).toBe(documents)
    expect(kernel.getDiagnostics()).toBe(diagnostics)
    expect(kernel.getTraceAudit()).toBe(traceAudit)
  })

  it('emits docs.changed after document writes through kernel rpc', async () => {
    const { kernel } = createTestKernel()
    const events: Array<{ name: string; payload: { changesetId: string; documents: Array<{ tombstoned: boolean }> } }> = []
    await kernel.start()
    kernel.getEventBus().subscribe(['docs.changed'], event => events.push(event as never))

    await kernel.callRpc('docs.write', {
      id: 'example.doc:2',
      type: 'example.doc',
      content: { ok: true },
      expectedVersion: 'new',
      actor: { kind: 'extension', id: 'forged' },
      meta: { ownerExtensionId: 'forged' },
    }, { clientId: 'client-1', correlationId: 'corr-1', callId: 'call-1' })

    const document = await kernel.getDocumentStore().get('example.doc:2')

    expect(events[0]?.name).toBe('docs.changed')
    expect(events[0]?.payload.changesetId).toBeDefined()
    expect(events[0]?.payload.documents[0]?.tombstoned).toBe(false)
    expect(document?.meta.createdBy).toEqual({ kind: 'client', id: 'client-1' })
    expect(document?.meta.ownerExtensionId).toBeUndefined()
  })

  it('emits docs.changed with call metadata after document deletes through kernel rpc', async () => {
    const { kernel } = createTestKernel()
    const events: Array<{ payload: { documents: Array<{ tombstoned: boolean }> }; meta: { correlationId?: string; callId?: string } }> = []
    await kernel.start()
    kernel.getEventBus().subscribe(['docs.changed'], event => events.push(event as never))

    await kernel.callRpc('docs.write', {
      id: 'example.doc:3',
      type: 'example.doc',
      content: { ok: true },
      expectedVersion: 'new',
    }, { correlationId: 'corr-2', callId: 'call-2' })

    await kernel.callRpc('docs.delete', {
      id: 'example.doc:3',
      expectedVersion: 1,
    }, { correlationId: 'corr-3', callId: 'call-3' })

    expect(events).toHaveLength(2)
    expect(events[1]?.payload.documents[0]?.tombstoned).toBe(true)
    expect(events[1]?.meta.correlationId).toBe('corr-3')
    expect(events[1]?.meta.callId).toBe('call-3')
  })

  it('serves diagnostics.list as a paged rpc result', async () => {
    const { kernel, diagnostics } = createTestKernel()
    diagnostics.add({ severity: 'info', code: 'test.info', message: 'hello', source: 'test' })
    await kernel.start()

    const result = await kernel.callRpc<{ items: unknown[] }>('diagnostics.list', {})

    expect(result.items).toHaveLength(1)
  })
})
