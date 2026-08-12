import { createClientBridge, type ClientBridge } from '@loom-studio/client-bridge'
import { createInMemoryDiagnosticsRegistry } from '@loom-studio/diagnostics'
import { createDocumentDataCommitSource, createInMemoryDocumentStore } from '@loom-studio/document-store'
import { createExtensionHost } from '@loom-studio/extension-host'
import { createKernel, type Kernel } from '@loom-studio/kernel'
import { createLoomRunner } from '@loom-studio/loom-runner'
import { createId } from '@loom-studio/shared'
import { createInMemoryTraceAuditStore } from '@loom-studio/trace-audit'
import { createErrorResponse, createSuccessResponse, parseRpcRequest, type RpcResponse, type StudioEvent } from '@loom-studio/transport'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

type Harness = ReturnType<typeof createHarness>

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
    dataCommits: createDocumentDataCommitSource(documents),
    diagnostics,
    traceAudit,
    extensionHost,
    loomRunner,
    environment: 'test',
  })

  return { kernel, extensionHost, diagnostics, documents, traceAudit }
}

function createBridge(kernel: Kernel): ClientBridge {
  return createClientBridge({ endpoint: 'memory://kernel', fetch: createKernelFetch(kernel) })
}

function createKernelFetch(kernel: Kernel): typeof fetch {
  return (async (_input: RequestInfo | URL, init?: RequestInit) => {
    let rpcId = null
    const context = {
      clientId: 'scenario-client',
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

describe('MVP whitepaper scenarios', () => {
  it('S1: Client -> Extension B -> Extension A -> Document -> Client readback', async () => {
    const harness = createHarness()
    const events: StudioEvent[] = []
    await harness.kernel.start()
    harness.kernel.getEventBus().subscribe(['docs.changed'], event => events.push(event))
    await harness.extensionHost.discover(createExtensionFixture('scenario-provider', {
      id: 'example.provider',
      rpc: [{ name: 'example.provider.getValue' }],
      source: `export function activate(ctx) { ctx.rpc.register('example.provider.getValue', () => ({ value: 42 })) }`,
    }))
    await harness.extensionHost.discover(createExtensionFixture('scenario-consumer', {
      id: 'example.consumer',
      rpc: [{ name: 'example.consumer.compose' }],
      source: `export function activate(ctx) { ctx.rpc.register('example.consumer.compose', async () => { const result = await ctx.rpc.call('example.provider.getValue'); const written = await ctx.documents.write({ id: 'example.consumer:composed', type: 'example.consumer.note', content: { value: result.value + 1 }, expectedVersion: 'new' }); return { documentId: written.documents[0].id, value: result.value + 1 } }) }`,
    }))
    await harness.extensionHost.activateAll()
    const bridge = createBridge(harness.kernel)
    await bridge.connect()

    const introspect = await bridge.call<{ methods: Array<{ name: string; owner: string }> }>('system.introspect')
    const composed = await bridge.call<{ documentId: string; value: number }>('example.consumer.compose')
    const document = await bridge.call<{ document: { id: string; content: { value: number }; meta: { ownerExtensionId?: string; createdBy: { kind: string; id: string } } } }>('docs.get', { id: composed.documentId })

    expect(introspect.methods).toContainEqual({ name: 'example.provider.getValue', owner: 'extension:example.provider' })
    expect(introspect.methods).toContainEqual({ name: 'example.consumer.compose', owner: 'extension:example.consumer' })
    expect(composed).toEqual({ documentId: 'example.consumer:composed', value: 43 })
    expect(document.document).toMatchObject({
      id: 'example.consumer:composed',
      content: { value: 43 },
      meta: {
        ownerExtensionId: 'example.consumer',
        createdBy: { kind: 'extension', id: 'example.consumer' },
      },
    })
    expect(events.some(event => event.name === 'docs.changed')).toBe(true)
  })

  it('S2: Manifest declared RPC missing should produce diagnostic', async () => {
    const harness = createHarness()
    await harness.kernel.start()
    await harness.extensionHost.discover(createExtensionFixture('scenario-missing-declared', {
      id: 'example.missingDeclared',
      rpc: [{ name: 'example.missingDeclared.echo' }],
      source: `export function activate() {}`,
    }))

    const summary = await harness.extensionHost.activate('example.missingDeclared')
    const diagnostics = harness.extensionHost.diagnostics('example.missingDeclared')

    expect(summary.state).not.toBe('active')
    expect(diagnostics.some(diagnostic => diagnostic.code === 'extension.rpc_declared_but_not_registered')).toBe(true)
  })

  it('S3: Client-only data panel simulation reads backend data through ClientBridge', async () => {
    const harness = createHarness()
    await harness.kernel.start()
    const bridge = createBridge(harness.kernel)
    await bridge.connect()
    await bridge.call('docs.write', {
      id: 'panel:doc',
      type: 'example.panel.note',
      content: { panel: true },
      expectedVersion: 'new',
    })
    await bridge.call('loom.run', {
      fragments: [{ id: 'panel-fragment', content: 'panel trace', meta: {} }],
      passes: [{ name: 'uppercase' }],
      trace: { enabled: true },
    })

    const data = await loadPanelData(bridge)

    expect(data.documents.items).toContainEqual(expect.objectContaining({ id: 'panel:doc' }))
    expect(Array.isArray(data.diagnostics.items)).toBe(true)
    expect(data.diagnostics.items).toContainEqual(expect.objectContaining({ code: 'loom/cross-owner-write' }))
    expect(data.traces.items).toHaveLength(1)
  })

  it.fails('S4 deferred: Audit should record RPC activity', async () => {
    const harness = createHarness()
    await harness.kernel.start()
    const bridge = createBridge(harness.kernel)
    await bridge.connect()

    await bridge.call('system.ping', { echo: 'audit' })
    await bridge.call('docs.write', {
      id: 'audit:doc',
      type: 'example.audit.note',
      content: { audit: true },
      expectedVersion: 'new',
    })
    await bridge.call('loom.run', {
      fragments: [{ id: 'audit-fragment', content: 'audit trace', meta: {} }],
      passes: [{ name: 'uppercase' }],
      trace: { enabled: true },
    })
    const audit = await bridge.call<{ items: Array<{ action: string }> }>('audit.list')

    expect(audit.items.length).toBeGreaterThan(0)
  })
})

async function loadPanelData(bridge: ClientBridge): Promise<{
  documents: { items: unknown[] }
  diagnostics: { items: unknown[] }
  traces: { items: unknown[] }
}> {
  const documents = await bridge.call<{ items: unknown[] }>('docs.list')
  const diagnostics = await bridge.call<{ items: unknown[] }>('diagnostics.list')
  const traces = await bridge.call<{ items: unknown[] }>('trace.list')
  return { documents, diagnostics, traces }
}

function createExtensionFixture(name: string, input: { id: string; rpc: Array<{ name: string }>; source: string }): string {
  const root = join(process.cwd(), '.loomstudio-dev/scenario-extensions', name)
  mkdirSync(join(root, 'dist'), { recursive: true })
  writeFileSync(join(root, 'manifest.json'), JSON.stringify({
    manifestVersion: 1,
    id: input.id,
    version: '0.0.0',
    displayName: input.id,
    engines: { studio: '^0.1.0' },
    server: { entry: './dist/index.js' },
    contributes: { rpc: input.rpc },
  }))
  writeFileSync(join(root, 'dist/index.js'), input.source)
  return root
}

function jsonResponse(response: RpcResponse): Response {
  return new Response(JSON.stringify(response), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}
