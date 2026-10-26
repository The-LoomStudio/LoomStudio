import { onTestFinished } from 'vitest'
import { createClientBridge } from '../../../apps/studio-client/src/shared/api/client-bridge.js'
import { createInMemoryDiagnosticsRegistry } from '@loom-studio/diagnostics'
import { createInMemoryDocumentStore } from '@loom-studio/document-store'
import { createExtensionHost } from '@loom-studio/extension-host'
import { createKernel, type Kernel } from '@loom-studio/kernel'
import { createId } from '@loom-studio/shared'
import type { StudioEvent } from '@loom-studio/extension-sdk'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function createHarness() {
  const diagnostics = createInMemoryDiagnosticsRegistry()
  const documents = createInMemoryDocumentStore()
  let kernel: Kernel
  const extensionHost = createExtensionHost({
    documents,
    diagnostics,
    registerStateContribution: () => ({ dispose() {} }),
    registerMacroProvider: () => ({ dispose() {} }),
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

function createKernelFetch(kernel: Kernel): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const context = {
      clientId: 'platform-smoke-client',
      correlationId: createId('corr'),
      callId: createId('call'),
    }

    try {
      const path = new URL(String(input)).pathname.split('/').at(-1)!
      const data = init?.body === undefined ? undefined : JSON.parse(String(init.body))
      const request = path === 'kernel.invoke' ? data : { method: path, params: data }
      const result = await kernel.callRpc(request.method, request.params, context)
      return jsonResponse({ result: { data: result } })
    } catch (error) {
      return jsonResponse({ error: { message: error instanceof Error ? error.message : String(error), code: -32603, data: { code: 'INTERNAL_SERVER_ERROR', httpStatus: 500 } } })
    }
  }) as typeof fetch
}

describe('platform capability integration smoke', () => {
  it('runs the headless client path across kernel, documents, extension rpc, and diagnostics', async () => {
    const { kernel, extensionHost } = createHarness()
    const events: StudioEvent[] = []
    await kernel.start()
    kernel.getEventBus().subscribe(['docs.changed', 'diagnostics.updated'], (event: StudioEvent) => { events.push(event) })
    await extensionHost.discover(join(process.cwd(), 'tests/fixtures/extensions/echo'))
    await extensionHost.activate('example.echo', 'server')
    const bridge = createClientBridge({ endpoint: 'http://kernel/trpc', fetch: createKernelFetch(kernel) })

    const introspect = await bridge.call<{ methods: Array<{ name: string; owner: string }>; events: string[] }>('system.introspect')
    const writeResult = await bridge.call<{ documents: Array<{ id: string; content: { ok: boolean } }> }>('docs.write', {
      id: 'platform-smoke:doc',
      type: 'example.platform-smoke.note',
      content: { ok: true },
      expectedVersion: 'new',
    })
    const documents = await bridge.call<{ items: Array<{ id: string; content: { ok: boolean } }> }>('docs.list', { type: 'example.platform-smoke.note' })
    const echo = await bridge.call<{ packageId: string; moduleId: string; echo: { message: string } }>('example.echo.echo', { message: 'platform-smoke' })
    await extensionHost.dispose('example.echo', 'server')
    const diagnostics = await bridge.call<{ items: Array<{ code: string }> }>('diagnostics.list')

    expect(introspect.methods).toContainEqual({ name: 'example.echo.echo', owner: 'extension:example.echo/server' })
    expect(introspect.methods).toContainEqual({ name: 'system.ping', owner: 'kernel' })
    expect(introspect.events).toContain('docs.changed')
    expect(introspect.events).toContain('diagnostics.updated')
    expect(writeResult.documents[0]).toMatchObject({ id: 'platform-smoke:doc', content: { ok: true } })
    expect(documents.items[0]).toMatchObject({ id: 'platform-smoke:doc', content: { ok: true } })
    expect(events.some(event => event.name === 'docs.changed')).toBe(true)
    expect(echo).toEqual({ packageId: 'example.echo', moduleId: 'server', echo: { message: 'platform-smoke' } })
    expect(diagnostics.items.some(diagnostic => diagnostic.code === 'example.echo.disposed')).toBe(true)
  })

  it('keeps runtime/provider/chat methods out of the kernel surface', async () => {
    const { kernel } = createHarness()
    await kernel.start()
    const surface = JSON.stringify(kernel.getPublicSurface())

    expect(surface).not.toContain('chat.send')
    expect(surface).not.toContain('provider.invoke')
  })
})

function jsonResponse(response: unknown): Response {
  return new Response(JSON.stringify(response), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}
