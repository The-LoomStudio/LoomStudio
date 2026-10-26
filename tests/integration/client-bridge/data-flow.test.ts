import { onTestFinished } from 'vitest'
import { createClientBridge, type ClientBridge } from '../../../apps/studio-client/src/shared/api/client-bridge.js'
import { createInMemoryDiagnosticsRegistry } from '@loom-studio/diagnostics'
import { createInMemoryDocumentStore } from '@loom-studio/document-store'
import { createExtensionHost } from '@loom-studio/extension-host'
import { createKernel, type Kernel } from '@loom-studio/kernel'
import { createId } from '@loom-studio/shared'

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function createHarness() {
  const diagnostics = createInMemoryDiagnosticsRegistry()
  const documents = createInMemoryDocumentStore()
  let kernel: Kernel
  const extensionHost = createExtensionHost({
    documents,
    diagnostics,
    callRpc: (method, params, context) => kernel.callRpc(method, params, context),
    registerRpc: (name, ownerPackageId, ownerModuleId, handler, ownerInstanceId) => {
      const handle = kernel.registerExtensionRpc(name, ownerPackageId, ownerModuleId, handler, ownerInstanceId)
      return { name, ownerPackageId, ownerModuleId, ownerInstanceId, handler, dispose: handle.dispose }
    },
    emitEvent: (name, payload, publisher) => {
      return kernel.getEventBus().emit(name, payload, {
        publisher,
        source: publisher.kind === 'extension' ? `extension:${publisher.packageId}/${publisher.moduleId}` : publisher.kind,
      })
    },
  })

  kernel = createKernel({
    documents,
    dataCommits: documents,
    diagnostics,
    extensionHost,
  })

  onTestFinished(async () => {
    try {
      await kernel.stop()
      await extensionHost.disposeAll()
    } finally {
      await documents.close()
    }
  })

  return { kernel, extensionHost }
}

function createBridge(kernel: Kernel, calls?: Array<{ method: string; params?: import('@loom-studio/shared').JsonValue }>): ClientBridge {
  return createClientBridge({ endpoint: 'http://kernel/trpc', fetch: createKernelFetch(kernel, calls) })
}

function createKernelFetch(kernel: Kernel, calls: Array<{ method: string; params?: import('@loom-studio/shared').JsonValue }> = []): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const context = {
      clientId: 'client-bridge-scenario',
      correlationId: createId('corr'),
      callId: createId('call'),
    }

    try {
      const path = new URL(String(input)).pathname.split('/').at(-1)!
      const data = init?.body === undefined ? undefined : JSON.parse(String(init.body))
      const request = path === 'kernel.invoke' ? data : { method: path, params: data }
      calls.push(request)
      const result = await kernel.callRpc(request.method, request.params, context)
      return jsonResponse({ result: { data: result } })
    } catch (error) {
      return jsonResponse({ error: { message: error instanceof Error ? error.message : String(error), code: -32603, data: { code: 'INTERNAL_SERVER_ERROR', httpStatus: 500 } } })
    }
  }) as typeof fetch
}

describe('client bridge data-flow integration', () => {
  it('keeps each request payload associated with its call', async () => {
    const { kernel } = createHarness()
    const calls: Array<{ method: string; params?: import('@loom-studio/shared').JsonValue }> = []
    await kernel.start()
    const bridge = createBridge(kernel, calls)
    await bridge.call('system.ping', { echo: 'one' })
    await bridge.call('system.ping', { echo: 'two' })

    expect(calls).toEqual([{ method: 'system.ping', params: { echo: 'one' } }, { method: 'system.ping', params: { echo: 'two' } }])
  })

  it('loads dashboard data through ClientBridge without direct service access', async () => {
    const { kernel, extensionHost } = createHarness()
    await kernel.start()
    await extensionHost.discover(createExtensionFixture('client-dashboard-extension', {
      id: 'example.clientDashboard',
      rpc: [{ name: 'example.clientDashboard.ping' }],
      source: `export function activate(ctx) { ctx.diagnostics.report({ severity: 'info', code: 'example.clientDashboard.ready', message: 'ready' }); ctx.rpc.register('example.clientDashboard.ping', () => ({ ok: true })) }`,
    }))
    await extensionHost.activate('example.clientDashboard', 'server')
    const bridge = createBridge(kernel)
    await bridge.call('docs.write', {
      id: 'client-dashboard:doc',
      type: 'example.clientDashboard.note',
      content: { visible: true },
      expectedVersion: 'new',
    })
    await expect(bridge.call('example.clientDashboard.ping')).resolves.toEqual({ ok: true })

    const dashboard = await loadDashboardData(bridge)

    expect(dashboard.documents.items).toContainEqual(expect.objectContaining({ id: 'client-dashboard:doc' }))
    expect(dashboard.diagnostics.items).toContainEqual(expect.objectContaining({ code: 'example.clientDashboard.ready' }))
    expect(dashboard.extensions.items).toContainEqual(expect.objectContaining({ packageId: 'example.clientDashboard', moduleId: 'server', state: 'active' }))
  })

  it.each(['missing.method', 'loom.run', 'trace.list', 'audit.list'])('surfaces unavailable method %s and remains usable afterward', async method => {
    const { kernel } = createHarness()
    await kernel.start()
    const bridge = createBridge(kernel)
    await expect(bridge.call(method)).rejects.toThrow(`RPC method not found: ${method}`)
    const ping = await bridge.call<{ ok: boolean }>('system.ping')

    expect(ping.ok).toBe(true)
  })
})

async function loadDashboardData(bridge: ClientBridge): Promise<{
  documents: { items: unknown[] }
  diagnostics: { items: unknown[] }
  extensions: { items: unknown[] }
}> {
  const documents = await bridge.call<{ items: unknown[] }>('docs.list')
  const diagnostics = await bridge.call<{ items: unknown[] }>('diagnostics.list')
  const extensions = await bridge.call<{ items: unknown[] }>('extensions.listPackages')
  return { documents, diagnostics, extensions }
}

function createExtensionFixture(name: string, input: { id: string; rpc: Array<{ name: string }>; source: string }): string {
  const root = join(process.cwd(), '.loomstudio-dev/client-bridge-scenario-extensions', name)
  mkdirSync(join(root, 'dist'), { recursive: true })
  writeFileSync(join(root, 'manifest.json'), JSON.stringify({
    manifestVersion: 2,
    id: input.id,
    version: '0.0.0',
    displayName: input.id,
    engines: { studio: '^0.1.0' },
    modules: [{
      id: 'server',
      runtime: 'server',
      entry: './dist/index.js',
      contributes: { rpc: input.rpc },
    }],
  }))
  writeFileSync(join(root, 'dist/index.js'), input.source)
  return root
}

function jsonResponse(response: unknown): Response {
  return new Response(JSON.stringify(response), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}
