import { createClientBridge } from '@loom-studio/client-bridge'
import { createInMemoryDiagnosticsRegistry } from '@loom-studio/diagnostics'
import { createInMemoryDocumentStore } from '@loom-studio/document-store'
import { createExtensionHost } from '@loom-studio/extension-host'
import { createKernel, type Kernel } from '@loom-studio/kernel'
import { createLoomRunner } from '@loom-studio/loom-runner'
import { createId } from '@loom-studio/shared'
import { createInMemoryTraceAuditStore } from '@loom-studio/trace-audit'
import { createErrorResponse, createSuccessResponse, parseRpcRequest, type RpcResponse, type StudioEvent } from '@loom-studio/transport'
import { join } from 'node:path'
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
  })

  kernel = createKernel({
    documents,
    diagnostics,
    traceAudit,
    extensionHost,
    loomRunner,
    environment: 'test',
  })

  return { kernel, extensionHost, traceAudit }
}

function createKernelFetch(kernel: Kernel): typeof fetch {
  return (async (_input: RequestInfo | URL, init?: RequestInit) => {
    let rpcId = null
    const context = {
      clientId: 'platform-smoke-client',
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

describe('platform capability integration smoke', () => {
  it('runs the headless client path across kernel, documents, extension rpc, loom, trace, and diagnostics', async () => {
    const { kernel, extensionHost, traceAudit } = createHarness()
    const events: StudioEvent[] = []
    await kernel.start()
    kernel.getEventBus().subscribe(['docs.changed', 'diagnostics.updated'], event => events.push(event))
    await extensionHost.discover(join(process.cwd(), 'extensions/example-echo'))
    await extensionHost.activateAll()
    const bridge = createClientBridge({ endpoint: 'memory://kernel', fetch: createKernelFetch(kernel) })
    await bridge.connect()

    const introspect = await bridge.call<{ methods: Array<{ name: string; owner: string }>; events: string[] }>('system.introspect')
    const writeResult = await bridge.call<{ documents: Array<{ id: string; content: { ok: boolean } }> }>('docs.write', {
      id: 'platform-smoke:doc',
      type: 'example.platform-smoke.note',
      content: { ok: true },
      expectedVersion: 'new',
    })
    const documents = await bridge.call<{ items: Array<{ id: string; content: { ok: boolean } }> }>('docs.list', { type: 'example.platform-smoke.note' })
    const echo = await bridge.call<{ extensionId: string; echo: { message: string } }>('example.echo.echo', { message: 'platform-smoke' })
    const runResult = await bridge.call<{ fragments: Array<{ content: string }>; traceId?: string }>('loom.run', {
      fragments: [{ id: 'platform-smoke-fragment', content: 'hello platform smoke', meta: { __owner: 'platform-smoke' } }],
      passes: [{ name: 'uppercase' }],
      trace: { enabled: true },
    })
    await bridge.call('loom.run', {
      fragments: [{ id: 'platform-smoke-diagnostic', content: 'diagnostic', meta: {} }],
      passes: [{ name: 'missing' }],
    })
    const diagnostics = await bridge.call<{ items: Array<{ code: string }> }>('diagnostics.list')
    const traces = await bridge.call<{ items: Array<{ id: string }> }>('trace.list')

    expect(introspect.methods).toContainEqual({ name: 'example.echo.echo', owner: 'extension:example.echo' })
    expect(introspect.methods).toContainEqual({ name: 'loom.run', owner: 'kernel' })
    expect(introspect.events).toContain('docs.changed')
    expect(introspect.events).toContain('diagnostics.updated')
    expect(writeResult.documents[0]).toMatchObject({ id: 'platform-smoke:doc', content: { ok: true } })
    expect(documents.items[0]).toMatchObject({ id: 'platform-smoke:doc', content: { ok: true } })
    expect(events.some(event => event.name === 'docs.changed')).toBe(true)
    expect(echo).toEqual({ extensionId: 'example.echo', echo: { message: 'platform-smoke' } })
    expect(runResult.fragments[0]?.content).toBe('HELLO PLATFORM SMOKE')
    expect(runResult.traceId).toBeDefined()
    expect(traceAudit.listTraces()).toHaveLength(1)
    expect(traces.items).toHaveLength(1)
    expect(diagnostics.items.some(diagnostic => diagnostic.code === 'loom/factory-missing')).toBe(true)
    expect(events.some(event => event.name === 'diagnostics.updated')).toBe(true)
  })

  it('keeps runtime/provider/chat fields out of the kernel loom.run contract', async () => {
    const { kernel } = createHarness()
    await kernel.start()
    const surface = JSON.stringify(kernel.getPublicSurface())

    expect(surface).not.toContain('chat.send')
    expect(surface).not.toContain('provider.invoke')
    await expect(kernel.callRpc('loom.run', {
      fragments: [{ id: 'bad', content: 'bad', meta: {} }],
      passes: [{ name: 'noop' }],
      messages: [],
      provider: 'example',
    })).rejects.toThrow('Forbidden loom.run fields')
  })
})

function jsonResponse(response: RpcResponse): Response {
  return new Response(JSON.stringify(response), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}
