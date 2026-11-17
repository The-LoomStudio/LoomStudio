import { createKernelBridge } from '../../support/kernel-bridge.js'
import { createExtensionFixture, createExtensionHostHarness as createKernelHarness, manifest } from '../../contract/extension-host/helpers.js'

import { describe, expect, it } from 'vitest'

async function setupPerfExtension() {
  const harness = createKernelHarness()
  await harness.kernel.start()
  const dir = createExtensionFixture('perf-docs', {
    manifest: manifest(
      'perf',
      [{ name: 'perf.write' }, { name: 'perf.get' }, { name: 'perf.list' }],
      ['perf.small', 'perf.medium', 'perf.page'],
    ),
    source: `export function activate(ctx) {
      ctx.rpc.register('perf.write', params => ctx.documents.write(params))
      ctx.rpc.register('perf.get', async params => ({ document: await ctx.documents.get(params.id, params) }))
      ctx.rpc.register('perf.list', async params => {
        const all = await ctx.documents.list({ type: params.type, limit: 1000 })
        const offset = params.cursor ? Number(params.cursor) : 0
        const items = all.slice(offset, offset + (params.limit ?? 100))
        const nextOffset = offset + items.length
        return { items, ...(nextOffset < all.length ? { nextCursor: String(nextOffset) } : {}) }
      })
    }`,
  })
  await harness.extensionHost.discover(dir)
  await harness.extensionHost.activate('perf', 'server')
  return { ...harness, bridge: createKernelBridge(harness.kernel) }
}

type Measurement = {
  name: string
  count: number
  totalMs: number
  avgMs: number
  p95Ms: number
  maxMs: number
}

describe('JSON communication performance probes', () => {
  it('P1: measures sequential system.ping in-process bridge baseline', async () => {
    const { kernel } = createKernelHarness()
    await kernel.start()
    const bridge = createKernelBridge(kernel)

    const measurement = await measure('100 sequential system.ping', 100, async index => {
      await bridge.call('system.ping', { echo: `ping-${index}` })
    })

    reportMeasurement(measurement)
    expect(measurement.count).toBe(100)
  })

  it('P2: measures small JSON document write throughput through ClientBridge -> extensions.invoke', async () => {
    const { bridge } = await setupPerfExtension()

    const measurement = await measure('100 sequential small perf.write', 100, async index => {
      await bridge.call('perf.write', {
        id: `perf-small:${index}`,
        type: 'perf.small',
        content: { index, label: `document-${index}`, flags: [true, false, true] },
        expectedVersion: 'new',
      })
    })
    const listed = await bridge.call<{ items: unknown[] }>('perf.list', { type: 'perf.small', limit: 100 })

    reportMeasurement(measurement)
    expect(listed.items).toHaveLength(100)
    expect(measurement.count).toBe(100)
  })

  it('P3: probes medium JSON payload round trip without strict timing assertions', async () => {
    const { bridge } = await setupPerfExtension()
    const content = createJsonPayload(128 * 1024)

    const write = await measure('1 medium perf.write 128KiB JSON', 1, async () => {
      await bridge.call('perf.write', {
        id: 'perf-medium:128k',
        type: 'perf.medium',
        content,
        expectedVersion: 'new',
      })
    })
    const read = await measure('1 medium perf.get 128KiB JSON', 1, async () => {
      const result = await bridge.call<{ document: { content: unknown } | null }>('perf.get', { id: 'perf-medium:128k' })
      expect(result.document?.content).toEqual(content)
    })

    reportMeasurement(write)
    reportMeasurement(read)
    expect(write.count).toBe(1)
    expect(read.count).toBe(1)
  })

  it('P4: measures perf.list pagination over 500 small JSON documents', async () => {
    const { bridge } = await setupPerfExtension()

    for (let index = 0; index < 500; index += 1) {
      await bridge.call('perf.write', {
        id: `perf-page:${index}`,
        type: 'perf.page',
        content: { index },
        expectedVersion: 'new',
      })
    }

    let cursor: string | undefined
    let pages = 0
    let total = 0
    const measurement = await measure('perf.list 500 docs in pages of 50', 10, async () => {
      const page = await bridge.call<{ items: unknown[]; nextCursor?: string }>('perf.list', {
        type: 'perf.page',
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
