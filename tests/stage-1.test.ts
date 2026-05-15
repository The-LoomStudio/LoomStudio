import { createInMemoryDiagnosticsRegistry } from '@loom-studio/diagnostics'
import { createInMemoryDocumentStore } from '@loom-studio/document-store'
import type { ExtensionHost } from '@loom-studio/extension-host'
import { createKernel } from '@loom-studio/kernel'
import type { LoomRunner } from '@loom-studio/loom-runner'
import { createInMemoryTraceAuditStore } from '@loom-studio/trace-audit'
import { createErrorResponse, parseRpcRequest } from '@loom-studio/transport'
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

describe('stage 1 kernel rpc', () => {
  it('registers and calls system.ping', async () => {
    const { kernel } = createTestKernel()
    await kernel.start()

    const result = await kernel.callRpc<{ ok: true; echo: string }>('system.ping', { echo: 'hello' })

    expect(result.ok).toBe(true)
    expect(result.echo).toBe('hello')
  })

  it('returns minimal system info without business runtime capabilities', async () => {
    const { kernel } = createTestKernel()
    await kernel.start()

    const result = await kernel.callRpc<{ capabilities: { documents: boolean; loomRun: boolean } }>('system.getInfo', {})

    expect(result.capabilities.documents).toBe(true)
    expect(result.capabilities.loomRun).toBe(false)
    expect(JSON.stringify(result)).not.toContain('chat')
    expect(JSON.stringify(result)).not.toContain('provider')
  })

  it('exposes system.introspect', async () => {
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

  it('exposes platform service getters', () => {
    const { kernel, documents, diagnostics, traceAudit } = createTestKernel()

    expect(kernel.getDocumentStore()).toBe(documents)
    expect(kernel.getDiagnostics()).toBe(diagnostics)
    expect(kernel.getTraceAudit()).toBe(traceAudit)
  })
})

describe('stage 1 document store', () => {
  it('creates, updates, lists, and tombstones documents', async () => {
    const documents = createInMemoryDocumentStore()
    const created = await documents.write({
      id: 'example.doc:1',
      type: 'example.doc',
      content: { value: 'a' },
      expectedVersion: 'new',
    })

    expect(created.documents[0]?.version).toBe(1)

    const updated = await documents.write({
      id: 'example.doc:1',
      type: 'example.doc',
      content: { value: 'b' },
      expectedVersion: 1,
    })

    expect(updated.documents[0]?.version).toBe(2)

    const listed = await documents.list({ type: 'example.doc' })
    expect(listed.items).toHaveLength(1)

    await documents.delete({ id: 'example.doc:1', expectedVersion: 2 })

    const afterDelete = await documents.list({ type: 'example.doc' })
    expect(afterDelete.items).toHaveLength(0)

    const tombstones = await documents.list({ type: 'example.doc', includeTombstone: true })
    expect(tombstones.items[0]?.meta.tombstone).toBeDefined()
  })

  it('emits docs.changed with document change summary when writing through kernel rpc', async () => {
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

  it('emits docs.changed when deleting through kernel rpc', async () => {
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

  it('returns diagnostics.list as a page result', async () => {
    const { kernel, diagnostics } = createTestKernel()
    diagnostics.add({ severity: 'info', code: 'test.info', message: 'hello', source: 'test' })
    await kernel.start()

    const result = await kernel.callRpc<{ items: unknown[] }>('diagnostics.list', {})

    expect(result.items).toHaveLength(1)
  })
})

describe('stage 1 transport helpers', () => {
  it('parses rpc request and serializes invalid request errors', () => {
    const request = parseRpcRequest({ jsonrpc: '2.0', id: '1', method: 'system.ping', params: {}, meta: { correlationId: 'corr-1' } })
    expect(request.method).toBe('system.ping')
    expect(request.meta?.correlationId).toBe('corr-1')

    const response = createErrorResponse(null, new Error('bad'), 'rpc.invalid_request', {
      clientId: 'client-1',
      correlationId: 'corr-1',
      callId: 'call-1',
    })
    expect(response.error?.code).toBe('rpc.invalid_request')
    expect(response.error?.message).toBe('bad')
    expect(response.meta?.callId).toBe('call-1')
  })
})
