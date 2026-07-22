import { createMemoryLogSink, createRootLogger } from '@loom-studio/logging'
import { describe, expect, it } from 'vitest'
import { createExtensionFixture, createExtensionHostHarness, manifest } from './helpers.js'

describe('extension host logging contract', () => {
  it('records lifecycle summaries without plugin paths or failure messages', async () => {
    const logs = createMemoryLogSink({ capacity: 20 })
    const root = createRootLogger({ service: 'test', instanceId: 'test-1', sinks: [logs] })
    const { kernel, extensionHost } = createExtensionHostHarness({ logger: root.child('extension.loader') })
    await kernel.start()
    const directory = createExtensionFixture('logging-failure-extension', {
      manifest: manifest('example.loggingFailure', []),
      source: `export function activate() { throw new Error('private plugin failure text') }`,
    })

    await extensionHost.discover(directory)
    const summary = await extensionHost.activate('example.loggingFailure')
    await extensionHost.dispose('example.loggingFailure')

    const page = logs.list().filter(item => item.namespace === 'extension.loader')
    expect(summary.state).toBe('disabled')
    expect(page.map(item => item.event)).toEqual([
      'extension.discovered',
      'extension.activation.started',
      'extension.activation.failed',
      'extension.disposed',
    ])
    expect(page[0]?.message).toBe('example.loggingFailure discovered · v0.0.0')
    expect(page[2]?.message).toMatch(/^example\.loggingFailure activation failed after \d+(?:\.\d+)? ms$/)
    expect(JSON.stringify(page)).not.toContain(directory)
    expect(JSON.stringify(page)).not.toContain('private plugin failure text')
  })

  it('records active and degraded activation outcomes', async () => {
    const logs = createMemoryLogSink({ capacity: 20 })
    const root = createRootLogger({ service: 'test', instanceId: 'test-2', sinks: [logs] })
    const { kernel, extensionHost } = createExtensionHostHarness({ logger: root.child('extension.loader') })
    await kernel.start()
    const activeDirectory = createExtensionFixture('logging-active-extension', {
      manifest: manifest('example.loggingActive', []),
      source: 'export function activate() {}',
    })
    const degradedDirectory = createExtensionFixture('logging-degraded-extension', {
      manifest: manifest('example.loggingDegraded', []),
      source: `export function activate(ctx) { ctx.rpc.register('example.loggingDegraded.echo', () => null) }`,
    })

    await extensionHost.discover(activeDirectory)
    await extensionHost.discover(degradedDirectory)
    await extensionHost.activateAll()

    const completed = logs.list().filter(item => item.namespace === 'extension.loader' && item.event === 'extension.activation.completed')
    expect(completed.map(item => item.data?.state)).toEqual(['active', 'degraded'])
    expect(completed[0]?.message).toMatch(/^example\.loggingActive activated · active · \d+(?:\.\d+)? ms$/)
    expect(completed[1]?.message).toMatch(/^example\.loggingDegraded activated · degraded · \d+(?:\.\d+)? ms$/)
  })
})
