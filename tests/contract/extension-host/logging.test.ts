import { createMemoryLogSink, createRootLogger, queryExtensionLogs, type ExtensionLogPage } from '@loom-studio/logging'
import { extensionInstallationId } from '@loom-studio/extension-sdk'
import { createInMemoryDiagnosticsRegistry } from '@loom-studio/diagnostics'
import { createInMemoryDocumentStore } from '@loom-studio/document-store'
import { createExtensionHost, type ExtensionHostOptions } from '@loom-studio/extension-host'
import { describe, expect, it } from 'vitest'
import { createExtensionFixture, createExtensionHostHarness, manifest } from './helpers.js'

describe('extension host logging contract', () => {
  it('binds private module writes, lifecycle logs and queries to the installation', async () => {
    const logs = createMemoryLogSink({ capacity: 100 })
    const logger = createRootLogger({ service: 'test', instanceId: 'scoped', sinks: [logs] })
    const pages = new Map<string, ExtensionLogPage>()
    const host = createExtensionHost({
      documents: createInMemoryDocumentStore(), diagnostics: createInMemoryDiagnosticsRegistry(), logger: logger.child('extension'),
      callRpc: async () => null,
      registerRpc: () => { throw new Error('No RPC contributions') },
      queryLogs: async (packageId, input, installationId) => {
        const page = await queryExtensionLogs({ current: logs }, packageId, input, 'server', installationId)
        pages.set(installationId ?? 'global', page)
        return page
      },
    })
    const packageId = 'example.privateLogs'
    const directory = createExtensionFixture('private-logs', {
      manifest: manifest(packageId, []),
      source: `export async function activate(ctx) {
        ctx.logger.info('own message')
        await ctx.logs.query({ limit: 100 })
      }`,
    })
    try {
      for (const target of [{ kind: 'global' }, { kind: 'card', cardId: 'a' }, { kind: 'card', cardId: 'b' }] as const) {
        await host.discover(directory, target)
        expect((await host.activate(packageId, 'server', target)).state).toBe('active')
        const id = target.kind === 'card' ? extensionInstallationId(packageId, target) : undefined
        expect(pages.get(id ?? 'global')!.items.some(item => item.message === 'own message')).toBe(true)
        expect(pages.get(id ?? 'global')!.items.every(item => item.extension?.installationId === id)).toBe(true)
      }
    } finally {
      await host.disposeAll()
    }
    const a = extensionInstallationId(packageId, { kind: 'card', cardId: 'a' })
    const page = await queryExtensionLogs({ current: logs }, packageId, { limit: 100 }, 'server', a)
    expect(page.items.some(item => item.event === 'extension.activation.completed')).toBe(true)
    expect(page.items.every(item => item.extension?.installationId === a)).toBe(true)
  })

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
    const summary = await extensionHost.activate('example.loggingFailure', 'server')
    await extensionHost.dispose('example.loggingFailure', 'server')

    const page = logs.list().filter(item => item.namespace === 'extension.loader')
    expect(summary.state).toBe('disabled')
    expect(page.map(item => item.event)).toEqual([
      'extension.discovered',
      'extension.activation.started',
      'extension.activation.failed',
      'extension.disposed',
    ])
    expect(page[0]?.message).toBe('example.loggingFailure discovered')
    expect(page[2]?.message).toBe('example.loggingFailure/server activation failed')
    expect(page[0]?.extension).toEqual({ packageId: 'example.loggingFailure', runtime: 'server' })
    expect(page[1]?.extension).toMatchObject({ packageId: 'example.loggingFailure', moduleId: 'server', runtime: 'server' })
    expect(page[2]?.extension).toEqual({ packageId: 'example.loggingFailure', moduleId: 'server', instanceId: page[2]?.extension?.instanceId, runtime: 'server' })
    expect(page[3]?.extension).toMatchObject({ packageId: 'example.loggingFailure', moduleId: 'server', runtime: 'server' })
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
      source: `export function activate(ctx) {
        ctx.logger.info('legacy extension message', { event: 'legacy.data.event', phase: 'active' })
        ctx.logger.child('worker').log('info', 'sync completed', { event: 'sync.completed', data: { count: 12, packageId: 'spoofed' } })
        ctx.rpc.register('example.loggingDegraded.echo', () => null)
      }`,
    })

    await extensionHost.discover(activeDirectory)
    await extensionHost.discover(degradedDirectory)
    await extensionHost.activateAll()

    const completed = logs.list().filter(item => item.namespace === 'extension.loader' && item.event === 'extension.activation.completed')
    expect(completed.map(item => item.data?.state)).toEqual(['active', 'degraded'])
    expect(completed[0]?.message).toBe('example.loggingActive/server activation completed')
    expect(completed[1]?.message).toBe('example.loggingDegraded/server activation completed')
    const legacy = logs.list().find(item => item.message === 'legacy extension message')
    expect(legacy?.event).toBe('extension.runtime.log')
    expect(legacy?.data).toMatchObject({ event: 'legacy.data.event', phase: 'active', component: '' })
    expect(legacy?.extension).toMatchObject({ packageId: 'example.loggingDegraded', moduleId: 'server', runtime: 'server' })
    const child = logs.list().find(item => item.event === 'extension.sync.completed')
    expect(child?.namespace).toBe('extension.loader.worker')
    expect(child?.data).toMatchObject({ component: 'worker', count: 12, packageId: 'spoofed' })
    expect(child?.extension).toMatchObject({ packageId: 'example.loggingDegraded', moduleId: 'server', runtime: 'server' })
  })

  it('queries only the host-owned package logs and keeps logs RPC reserved', async () => {
    let queryCall: { packageId: string; input: unknown } | undefined
    const queryLogs: NonNullable<ExtensionHostOptions['queryLogs']> = async (packageId, input) => {
      queryCall = { packageId, input }
      return { items: [], cursor: 'memory:test:0', hasMore: false, sources: ['current'] }
    }
    const extensionHost = createExtensionHost({
      documents: createInMemoryDocumentStore(),
      diagnostics: createInMemoryDiagnosticsRegistry(),
      queryLogs,
      callRpc: async () => null,
      registerRpc: (name, ownerPackageId, ownerModuleId, handler, ownerInstanceId) => ({
        name,
        ownerPackageId,
        ownerModuleId,
        ownerInstanceId,
        handler,
        dispose: () => undefined,
      }),
    })
    const directory = createExtensionFixture('logging-query-extension', {
      manifest: manifest('example.loggingQuery', []),
      source: `export async function activate(ctx) {
        await ctx.logs.query({ limit: 1 })
        try {
          await ctx.rpc.call('logs.list')
        } catch (error) {
          if (error instanceof Error && error.message.includes('reserved Studio namespace RPC')) return
          throw error
        }
        throw new Error('logs RPC was not rejected')
      }`,
    })

    await extensionHost.discover(directory)
    const summary = await extensionHost.activate('example.loggingQuery', 'server')

    expect(summary.state).toBe('active')
    expect(queryCall).toEqual({ packageId: 'example.loggingQuery', input: { limit: 1 } })
  })
})
