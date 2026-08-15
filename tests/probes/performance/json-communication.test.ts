import { createClientBridge, type ClientBridge } from '@loom-studio/client-bridge'
import { createInMemoryDiagnosticsRegistry } from '@loom-studio/diagnostics'
import { createDocumentDataCommitSource, createInMemoryDocumentStore } from '@loom-studio/document-store'
import { createExtensionHost } from '@loom-studio/extension-host'
import { createKernel, type Kernel } from '@loom-studio/kernel'
import { createLoomRunner } from '@loom-studio/loom-runner'
import { createId } from '@loom-studio/shared'
import { createInMemoryTraceAuditStore } from '@loom-studio/trace-audit'
import { createErrorResponse, createSuccessResponse, parseRpcRequest, type RpcResponse } from '@loom-studio/transport'
import { describe, expect, it } from 'vitest'

type Measurement = {
  name: string
  count: number
  totalMs: number
  avgMs: number
  p95Ms: number
  maxMs: number
}

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
    registerRpc: (name, ownerPackageId, ownerModuleId, handler, ownerInstanceId) => {
      const handle = kernel.registerExtensionRpc(name, ownerPackageId, ownerModuleId, handler, ownerInstanceId)
      return { name, ownerPackageId, ownerModuleId, ownerInstanceId, handler, dispose: handle.dispose }
    },
    emitEvent: (name, payload, publisher) => {
      kernel.getEventBus().emit(name, payload, {
        publisher,
        source: publisher.kind === 'extension' ? `extension:${publisher.packageId}/${publisher.moduleId}` : publisher.kind,
      })
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

  return { kernel }
}

function createBridge(kernel: Kernel): ClientBridge {
  return createClientBridge({ endpoint: 'memory://kernel', fetch: createKernelFetch(kernel) })
}

function createKernelFetch(kernel: Kernel): typeof fetch {
  return (async (_input: RequestInfo | URL, init?: RequestInit) => {
    let rpcId = null
    const context = {
      clientId: 'json-performance-client',
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

describe('JSON communication performance probes', () => {
  it('P1: measures sequential system.ping JSON-RPC baseline', async () => {
    const { kernel } = createHarness()
    await kernel.start()
    const bridge = createBridge(kernel)
    await bridge.connect()

    const measurement = await measure('100 sequential system.ping', 100, async index => {
      await bridge.call('system.ping', { echo: `ping-${index}` })
    })

    reportMeasurement(measurement)
    expect(measurement.count).toBe(100)
    expect(measurement.avgMs).toBeGreaterThanOrEqual(0)
  })

  it('P2: measures small JSON docs.write throughput through ClientBridge', async () => {
    const { kernel } = createHarness()
    await kernel.start()
    const bridge = createBridge(kernel)
    await bridge.connect()

    const measurement = await measure('100 sequential small docs.write', 100, async index => {
      await bridge.call('docs.write', {
        id: `perf-small:${index}`,
        type: 'example.perf.small',
        content: { index, label: `document-${index}`, flags: [true, false, true] },
        expectedVersion: 'new',
      })
    })
    const listed = await bridge.call<{ items: unknown[] }>('docs.list', { type: 'example.perf.small', limit: 100 })

    reportMeasurement(measurement)
    expect(listed.items).toHaveLength(100)
    expect(measurement.count).toBe(100)
  })

  it('P3: probes medium JSON payload round trip without strict timing assertions', async () => {
    const { kernel } = createHarness()
    await kernel.start()
    const bridge = createBridge(kernel)
    await bridge.connect()
    const content = createJsonPayload(128 * 1024)

    const write = await measure('1 medium docs.write 128KiB JSON', 1, async () => {
      await bridge.call('docs.write', {
        id: 'perf-medium:128k',
        type: 'example.perf.medium',
        content,
        expectedVersion: 'new',
      })
    })
    const read = await measure('1 medium docs.get 128KiB JSON', 1, async () => {
      await bridge.call('docs.get', { id: 'perf-medium:128k' })
    })

    reportMeasurement(write)
    reportMeasurement(read)
    expect(write.count).toBe(1)
    expect(read.count).toBe(1)
  })

  it('P4: measures docs.list pagination over 500 small JSON documents', async () => {
    const { kernel } = createHarness()
    await kernel.start()
    const bridge = createBridge(kernel)
    await bridge.connect()

    for (let index = 0; index < 500; index += 1) {
      await bridge.call('docs.write', {
        id: `perf-page:${index}`,
        type: 'example.perf.page',
        content: { index },
        expectedVersion: 'new',
      })
    }

    let cursor: string | undefined
    let pages = 0
    let total = 0
    const measurement = await measure('docs.list 500 docs in pages of 50', 10, async () => {
      const page = await bridge.call<{ items: unknown[]; nextCursor?: string }>('docs.list', {
        type: 'example.perf.page',
        limit: 50,
        ...(cursor ? { cursor } : {}),
      })
      pages += 1
      total += page.items.length
      cursor = page.nextCursor
    })

    reportMeasurement(measurement)
    expect(pages).toBe(10)
    expect(total).toBe(500)
    expect(cursor).toBeUndefined()
  })
})

async function measure(name: string, count: number, action: (index: number) => Promise<void>): Promise<Measurement> {
  const samples: number[] = []
  const started = performance.now()

  for (let index = 0; index < count; index += 1) {
    const itemStarted = performance.now()
    await action(index)
    samples.push(performance.now() - itemStarted)
  }

  const totalMs = performance.now() - started
  const sorted = [...samples].sort((left, right) => left - right)
  const p95Index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1)

  return {
    name,
    count,
    totalMs,
    avgMs: totalMs / count,
    p95Ms: sorted[p95Index] ?? 0,
    maxMs: sorted.at(-1) ?? 0,
  }
}

function reportMeasurement(measurement: Measurement): void {
  console.info(`[perf] ${measurement.name}: count=${measurement.count} total=${measurement.totalMs.toFixed(2)}ms avg=${measurement.avgMs.toFixed(2)}ms p95=${measurement.p95Ms.toFixed(2)}ms max=${measurement.maxMs.toFixed(2)}ms`)
}

function createJsonPayload(sizeBytes: number): { kind: string; text: string } {
  return {
    kind: 'json-payload-probe',
    text: 'x'.repeat(sizeBytes),
  }
}

function jsonResponse(response: RpcResponse): Response {
  return new Response(JSON.stringify(response), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}
