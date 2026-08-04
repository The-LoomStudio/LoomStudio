import { createClientBridge, type ClientBridge } from '@loom-studio/client-bridge'
import { createInMemoryDiagnosticsRegistry } from '@loom-studio/diagnostics'
import { createInMemoryDocumentStore } from '@loom-studio/document-store'
import { createExtensionHost } from '@loom-studio/extension-host'
import { createKernel, type Kernel } from '@loom-studio/kernel'
import { createLoomRunner } from '@loom-studio/loom-runner'
import { createId } from '@loom-studio/shared'
import { createInMemoryTraceAuditStore } from '@loom-studio/trace-audit'
import { createErrorResponse, createSuccessResponse, parseRpcRequest, type RpcRequest, type RpcResponse } from '@loom-studio/transport'
import { mkdirSync, writeFileSync } from 'node:fs'
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

  return { kernel, extensionHost }
}

function createBridge(kernel: Kernel, calls?: RpcRequest[]): ClientBridge {
  return createClientBridge({ endpoint: 'memory://kernel', source: 'scenario-client', fetch: createKernelFetch(kernel, calls) })
}

function createKernelFetch(kernel: Kernel, calls: RpcRequest[] = []): typeof fetch {
  return (async (_input: RequestInfo | URL, init?: RequestInit) => {
    let rpcId = null
    const context = {
      clientId: 'client-bridge-scenario',
      correlationId: createId('corr'),
      callId: createId('call'),
    }

    try {
      const request = parseRpcRequest(JSON.parse(String(init?.body ?? '{}')))
      calls.push(request)
      rpcId = request.id
      const result = await kernel.callRpc(request.method, request.params, context)
      return jsonResponse(createSuccessResponse(request.id, result, context))
    } catch (error) {
      return jsonResponse(createErrorResponse(rpcId, error, 'rpc.invalid_request', context))
    }
  }) as typeof fetch
}

describe('client bridge data-flow integration', () => {
  it('preserves JSON-RPC request source metadata and monotonic request ids', async () => {
    const { kernel } = createHarness()
    const calls: RpcRequest[] = []
    await kernel.start()
    const bridge = createBridge(kernel, calls)
    await bridge.connect()

    await bridge.call('system.ping', { echo: 'one' })
    await bridge.call('system.ping', { echo: 'two' })

    expect(calls.map(call => call.id)).toEqual(['client-1', 'client-2'])
    expect(calls.map(call => call.meta?.source)).toEqual(['scenario-client', 'scenario-client'])
  })

  it('loads dashboard data through ClientBridge without direct service access', async () => {
    const { kernel, extensionHost } = createHarness()
    await kernel.start()
    await extensionHost.discover(createExtensionFixture('client-dashboard-extension', {
      id: 'example.clientDashboard',
      rpc: [{ name: 'example.clientDashboard.ping' }],
      source: `export function activate(ctx) { ctx.diagnostics.report({ severity: 'info', code: 'example.clientDashboard.ready', message: 'ready' }); ctx.rpc.register('example.clientDashboard.ping', () => ({ ok: true })) }`,
    }))
    await extensionHost.activate('example.clientDashboard')
    const bridge = createBridge(kernel)
    await bridge.connect()
    await bridge.call('docs.write', {
      id: 'client-dashboard:doc',
      type: 'example.clientDashboard.note',
      content: { visible: true },
      expectedVersion: 'new',
    })
    await bridge.call('loom.run', {
      fragments: [{ id: 'client-dashboard-trace', content: 'dashboard trace', meta: { __owner: 'dashboard' } }],
      passes: [{ name: 'uppercase' }],
      trace: { enabled: true },
    })

    const dashboard = await loadDashboardData(bridge)

    expect(dashboard.documents.items).toContainEqual(expect.objectContaining({ id: 'client-dashboard:doc' }))
    expect(dashboard.diagnostics.items).toContainEqual(expect.objectContaining({ code: 'example.clientDashboard.ready' }))
    expect(dashboard.traces.items).toHaveLength(1)
    expect(dashboard.extensions.items).toContainEqual(expect.objectContaining({ id: 'example.clientDashboard', state: 'active' }))
  })

  it('surfaces missing method errors and remains usable afterward', async () => {
    const { kernel } = createHarness()
    await kernel.start()
    const bridge = createBridge(kernel)
    await bridge.connect()

    await expect(bridge.call('missing.method')).rejects.toThrow('RPC method not found: missing.method')
    const ping = await bridge.call<{ ok: boolean }>('system.ping')

    expect(ping.ok).toBe(true)
    expect(bridge.getConnectionState()).toBe('connected')
  })

  it('marks the bridge disconnected without preventing later explicit calls', async () => {
    const { kernel } = createHarness()
    await kernel.start()
    const bridge = createBridge(kernel)
    await bridge.connect()
    await bridge.disconnect()

    const ping = await bridge.call<{ ok: boolean }>('system.ping')

    expect(bridge.getConnectionState()).toBe('disconnected')
    expect(ping.ok).toBe(true)
  })

  it('exposes response metadata for correlation-aware UI diagnostics', async () => {
    const { kernel } = createHarness()
    await kernel.start()
    const bridge = createBridge(kernel)
    await bridge.connect()

    const envelope = await bridge.callWithMeta<{ ok: boolean }>('system.ping')

    expect(envelope.result.ok).toBe(true)
    expect(envelope.meta?.correlationId).toBeDefined()
    expect(envelope.meta?.callId).toBeDefined()
  })
})

async function loadDashboardData(bridge: ClientBridge): Promise<{
  documents: { items: unknown[] }
  diagnostics: { items: unknown[] }
  traces: { items: unknown[] }
  extensions: { items: unknown[] }
}> {
  const documents = await bridge.call<{ items: unknown[] }>('docs.list')
  const diagnostics = await bridge.call<{ items: unknown[] }>('diagnostics.list')
  const traces = await bridge.call<{ items: unknown[] }>('trace.list')
  const extensions = await bridge.call<{ items: unknown[] }>('extensions.list')
  return { documents, diagnostics, traces, extensions }
}

function createExtensionFixture(name: string, input: { id: string; rpc: Array<{ name: string }>; source: string }): string {
  const root = join(process.cwd(), '.loomstudio-dev/client-bridge-scenario-extensions', name)
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
