import { createClientBridge, type ClientBridge } from '@loom-studio/client-bridge'
import { createInMemoryDiagnosticsRegistry } from '@loom-studio/diagnostics'
import { createInMemoryDocumentStore } from '@loom-studio/document-store'
import { createExtensionHost } from '@loom-studio/extension-host'
import { createKernel, type Kernel } from '@loom-studio/kernel'
import { createLoomRunner } from '@loom-studio/loom-runner'
import { createId } from '@loom-studio/shared'
import { createInMemoryTraceAuditStore } from '@loom-studio/trace-audit'
import { createErrorResponse, createSuccessResponse, parseRpcRequest, type RpcResponse, type StudioEvent } from '@loom-studio/transport'
import { describe, expect, it } from 'vitest'

function createHarness() {
  const diagnostics = createInMemoryDiagnosticsRegistry()
  const documents = createInMemoryDocumentStore()
  const traceAudit = createInMemoryTraceAuditStore()
  const loomRunner = createLoomRunner({ traceAudit })
  let kernel: Kernel
  const extensionHost = createExtensionHost({
    documents,
    diagnostics,
    callRpc: (method, params, context) => kernel.callRpc(method, params, context),
    registerRpc: (name, ownerExtensionId, handler) => {
      const handle = kernel.registerExtensionRpc(name, ownerExtensionId, handler)
      return { name, ownerExtensionId, handler, dispose: handle.dispose }
    },
    emitEvent: (name, payload, ownerExtensionId) => {
      kernel.getEventBus().emit(name, payload, { source: `extension:${ownerExtensionId}` })
    },
    emitDocumentChange: (result, ownerExtensionId) => {
      kernel.getEventBus().emit('docs.changed', summarizeDocumentChange(result), { source: `extension:${ownerExtensionId}` })
    },
  })

  kernel = createKernel({
    documents,
    diagnostics,
    traceAudit,
    extensionHost,
    loomRunner,
    environment: 'test',
  })

  return { kernel, documents, diagnostics, traceAudit }
}

function createBridge(kernel: Kernel): ClientBridge {
  return createClientBridge({ endpoint: 'memory://kernel', fetch: createKernelFetch(kernel) })
}

function createKernelFetch(kernel: Kernel): typeof fetch {
  return (async (_input: RequestInfo | URL, init?: RequestInit) => {
    let rpcId = null
    const context = {
      clientId: 'document-scenario-client',
      correlationId: createId('corr'),
      callId: createId('call'),
    }

    try {
      const request = parseRpcRequest(JSON.parse(String(init?.body ?? '{}')))
      rpcId = request.id
      const result = await kernel.callRpc(request.method, request.params, context)
      return jsonResponse(createSuccessResponse(request.id, result, context))
    } catch (error) {
      return jsonResponse(createErrorResponse(rpcId, error, 'rpc.invalid_request', context))
    }
  }) as typeof fetch
}

describe('document, trace, and diagnostics integration', () => {
  it('preserves document history, tombstones deletes, and emits docs.changed', async () => {
    const { kernel } = createHarness()
    const events: StudioEvent[] = []
    await kernel.start()
    kernel.getEventBus().subscribe(['docs.changed'], event => events.push(event))
    const bridge = createBridge(kernel)
    await bridge.connect()

    await bridge.call('docs.write', {
      id: 'doc-scenario:revision',
      type: 'example.documentScenario.note',
      content: { version: 1 },
      expectedVersion: 'new',
    })
    await bridge.call('docs.write', {
      id: 'doc-scenario:revision',
      type: 'example.documentScenario.note',
      content: { version: 2 },
      expectedVersion: 1,
    })
    const firstRevision = await bridge.call<{ document: { version: number; content: { version: number } } }>('docs.get', { id: 'doc-scenario:revision', version: 1 })
    const current = await bridge.call<{ document: { version: number; content: { version: number } } }>('docs.get', { id: 'doc-scenario:revision' })
    await bridge.call('docs.delete', { id: 'doc-scenario:revision', expectedVersion: 2, reason: 'scenario tombstone' })
    const afterDelete = await bridge.call<{ document: unknown | null }>('docs.get', { id: 'doc-scenario:revision' })
    const tombstone = await bridge.call<{ document: { version: number; meta: { tombstone?: { reason?: string } } } }>('docs.get', { id: 'doc-scenario:revision', includeTombstone: true })

    expect(firstRevision.document).toMatchObject({ version: 1, content: { version: 1 } })
    expect(current.document).toMatchObject({ version: 2, content: { version: 2 } })
    expect(afterDelete.document).toBeNull()
    expect(tombstone.document).toMatchObject({ version: 3, meta: { tombstone: { reason: 'scenario tombstone' } } })
    expect(events.map(event => event.name)).toEqual(['docs.changed', 'docs.changed', 'docs.changed'])
  })

  it('rejects stale document writes and preserves the current document', async () => {
    const { kernel } = createHarness()
    await kernel.start()
    const bridge = createBridge(kernel)
    await bridge.connect()

    await bridge.call('docs.write', {
      id: 'doc-scenario:conflict',
      type: 'example.documentScenario.note',
      content: { stable: true },
      expectedVersion: 'new',
    })

    await expect(bridge.call('docs.write', {
      id: 'doc-scenario:conflict',
      type: 'example.documentScenario.note',
      content: { stable: false },
      expectedVersion: 999,
    })).rejects.toThrow('Document version conflict')

    const current = await bridge.call<{ document: { version: number; content: { stable: boolean } } }>('docs.get', { id: 'doc-scenario:conflict' })
    expect(current.document).toMatchObject({ version: 1, content: { stable: true } })
  })

  it('filters documents by ownerExtensionId', async () => {
    const { kernel, documents } = createHarness()
    await kernel.start()

    await documents.write({
      id: 'owner:a',
      type: 'example.owner.note',
      content: { owner: 'a' },
      expectedVersion: 'new',
      meta: { ownerExtensionId: 'example.ownerA' },
      actor: { kind: 'extension', id: 'example.ownerA' },
    })
    await documents.write({
      id: 'owner:b',
      type: 'example.owner.note',
      content: { owner: 'b' },
      expectedVersion: 'new',
      meta: { ownerExtensionId: 'example.ownerB' },
      actor: { kind: 'extension', id: 'example.ownerB' },
    })

    const bridge = createBridge(kernel)
    await bridge.connect()
    const result = await bridge.call<{ items: Array<{ id: string; meta: { ownerExtensionId?: string } }> }>('docs.list', { ownerExtensionId: 'example.ownerA' })

    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({ id: 'owner:a', meta: { ownerExtensionId: 'example.ownerA' } })
  })

  it('exposes loom.run traces through trace.list without storing them as normal documents', async () => {
    const { kernel } = createHarness()
    await kernel.start()
    const bridge = createBridge(kernel)
    await bridge.connect()

    const run = await bridge.call<{ traceId?: string }>('loom.run', {
      fragments: [{ id: 'trace-scenario', content: 'trace visible', meta: { __owner: 'trace-scenario' } }],
      passes: [{ name: 'uppercase' }],
      trace: { enabled: true },
    })
    const traces = await bridge.call<{ items: Array<{ id: string }> }>('trace.list')
    const docs = await bridge.call<{ items: Array<{ type: string }> }>('docs.list', { type: 'system.trace' })

    expect(run.traceId).toBeDefined()
    expect(traces.items).toHaveLength(1)
    expect(docs.items).toHaveLength(0)
  })

  it('makes loom.run diagnostics queryable and emits diagnostics.updated', async () => {
    const { kernel } = createHarness()
    const events: StudioEvent[] = []
    await kernel.start()
    kernel.getEventBus().subscribe(['diagnostics.updated'], event => events.push(event))
    const bridge = createBridge(kernel)
    await bridge.connect()

    await bridge.call('loom.run', {
      fragments: [{ id: 'diagnostic-scenario', content: 'diagnostic', meta: {} }],
      passes: [{ name: 'missing' }],
    })
    const diagnostics = await bridge.call<{ items: Array<{ code: string; source: string }> }>('diagnostics.list')

    expect(diagnostics.items).toContainEqual(expect.objectContaining({ code: 'loom/factory-missing', source: 'loom-runner' }))
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ name: 'diagnostics.updated' })
  })
})

function jsonResponse(response: RpcResponse): Response {
  return new Response(JSON.stringify(response), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function summarizeDocumentChange(result: { changesetId: string; operations: unknown; documents: Array<{ id: string; type: string; version: number; meta: { tombstone?: unknown } }> }): StudioEvent['payload'] {
  return {
    changesetId: result.changesetId,
    operations: result.operations as StudioEvent['payload'],
    documents: result.documents.map(document => ({
      id: document.id,
      type: document.type,
      version: document.version,
      tombstoned: Boolean(document.meta.tombstone),
    })),
  }
}
