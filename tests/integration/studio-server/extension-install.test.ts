import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createStudioServer } from '../../../apps/studio-server/src/main.js'
import { resolveLoomStudioLocalPaths } from '../../../apps/studio-server/src/platform/local-paths.js'
import { authenticatedFetch, callRpc } from './helpers.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('Studio Server Extension Package install lifecycle', () => {
  it('installs, restores after restart, and uninstalls without deleting published data', async () => {
    const root = await mkdtemp(join(tmpdir(), 'loom-extension-install-server-'))
    temporaryDirectories.push(root)
    const sourceDirectory = await writeTestPackage(root)
    const localPaths = resolveLoomStudioLocalPaths({ home: join(root, 'home') })

    const first = createStudioServer({ localPaths, extensionRootDirectory: join(root, 'empty-repository') })
    const firstAddress = await first.listen(0)
    const eventResponse = await authenticatedFetch(firstAddress.port, '/extensions/events')
    expect(eventResponse.status).toBe(200)
    expect(eventResponse.headers.get('content-type')).toBe('text/event-stream; charset=utf-8')
    const eventReader = eventResponse.body!.getReader()

    const installed = await callRpc<{ package: Record<string, unknown> }>(firstAddress.port, 'extensions.installPackage', {
      sourceDirectory,
    })
    expect(installed.package).toMatchObject({
      packageId: 'example.installed',
      version: '1.0.0',
      displayName: 'Installed Example',
      description: 'Installed extension fixture',
      author: 'Loom Studio',
      homepage: 'https://example.com/extensions/installed',
      repository: 'https://github.com/example/installed',
      iconUrl: '/extensions/example.installed/1.0.0/icon',
      tags: ['test', 'developer-tool'],
      sourceKinds: ['installed'],
    })
    expect(installed.package).not.toHaveProperty('sources')

    const installedEvent = await readSseEvent(eventReader, 'extensions.changed')
    expect(installedEvent).toMatchObject({
      name: 'extensions.changed',
      payload: {
        packageId: 'example.installed',
        version: '1.0.0',
        action: 'installed',
      },
    })

    const packages = await callRpc<{ items: Array<Record<string, unknown>> }>(firstAddress.port, 'extensions.listPackages', {})
    const installedPackage = packages.items.find(item => item.packageId === 'example.installed')
    expect(installedPackage).toMatchObject(installed.package)
    expect(installedPackage).not.toHaveProperty('sources')
    const clientModule = (installedPackage?.modules as Array<Record<string, unknown>>).find(module => module.moduleId === 'client')
    expect(clientModule).toMatchObject({
      moduleId: 'client',
      runtimeKind: 'client',
      entryUrl: '/extensions/example.installed/1.0.0/files/dist/client.js',
      desired: { enabled: false },
    })

    const icon = await authenticatedFetch(firstAddress.port, '/extensions/example.installed/1.0.0/icon')
    expect(icon.status).toBe(200)
    expect(icon.headers.get('content-type')).toBe('image/png')
    expect(icon.headers.get('cache-control')).toContain('immutable')
    expect(icon.headers.get('x-content-type-options')).toBe('nosniff')
    expect([...new Uint8Array(await icon.arrayBuffer())]).toEqual([137, 80, 78, 71])

    const clientEntry = await authenticatedFetch(firstAddress.port, '/extensions/example.installed/1.0.0/files/dist/client.js?loomClientInstance=test-instance')
    expect(clientEntry.status).toBe(200)
    expect(clientEntry.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
    expect(await clientEntry.text()).toContain('ctx.renderers.register')

    await expect(callRpc(firstAddress.port, 'extensions.enableModule', {
      packageId: 'example.installed',
      moduleId: 'client',
    })).resolves.toMatchObject({ module: { desired: { enabled: true } } })
    await expect(callRpc(firstAddress.port, 'extensions.reloadModule', {
      packageId: 'example.installed',
      moduleId: 'client',
    })).resolves.toMatchObject({ module: { moduleId: 'client', desired: { enabled: true } } })

    await expect(readFile(join(localPaths.extensionInstalledRoot, 'example.installed', '1.0.0', 'manifest.json'), 'utf8')).resolves.toContain('example.installed')

    await callRpc(firstAddress.port, 'extensions.enableModule', {
      packageId: 'example.installed',
      moduleId: 'server',
      grants: { assets: ['assets.publish'] },
    })
    const created = await callRpc<{ assetId: string }>(firstAddress.port, 'example.installed.create', {})
    await eventReader.cancel()
    await first.close()

    const second = createStudioServer({ localPaths, extensionRootDirectory: join(root, 'empty-repository') })
    const secondAddress = await second.listen(0)
    await expect(callRpc(secondAddress.port, 'example.installed.status', {})).resolves.toEqual({ active: true })
    await expect(callRpc(secondAddress.port, 'example.installed.publish', {})).resolves.toMatchObject({ assetId: expect.any(String) })

    await callRpc(secondAddress.port, 'extensions.uninstallPackage', {
      packageId: 'example.installed',
      version: '1.0.0',
    })
    await expect(callRpc(secondAddress.port, 'example.installed.status', {})).rejects.toThrow('method not found')
    const asset = await authenticatedFetch(secondAddress.port, `/assets/${created.assetId}`)
    expect(asset.status).toBe(200)
    expect([...new Uint8Array(await asset.arrayBuffer())]).toEqual([4, 5, 6])
    await expect(callRpc(secondAddress.port, 'docs.get', { id: 'example.installed:data' })).resolves.toMatchObject({
      document: { content: { retained: true } },
    })
    await expect(readFile(join(localPaths.extensionInstalledRoot, 'example.installed', '1.0.0', 'manifest.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(localPaths.extensionStateFile, 'utf8')).resolves.not.toContain('example.installed')
    await second.close()
  })

  it('unlinks a dev Package and clears its persisted grants without deleting its source', async () => {
    const root = await mkdtemp(join(tmpdir(), 'loom-extension-dev-unlink-server-'))
    temporaryDirectories.push(root)
    const sourceDirectory = await writeTestPackage(root)
    const localPaths = resolveLoomStudioLocalPaths({ home: join(root, 'home') })
    await mkdir(localPaths.extensionRoot, { recursive: true })
    await writeFile(localPaths.extensionDevLinksFile, `${JSON.stringify({
      extensions: [{ id: 'example.installed', path: sourceDirectory }],
    }, null, 2)}\n`)

    const server = createStudioServer({ localPaths, extensionRootDirectory: join(root, 'empty-repository') })
    const address = await server.listen(0)
    await callRpc(address.port, 'extensions.enableModule', {
      packageId: 'example.installed',
      moduleId: 'server',
      grants: { assets: ['assets.publish'] },
    })

    await callRpc(address.port, 'extensions.uninstallPackage', {
      packageId: 'example.installed',
      version: '1.0.0',
    })

    await expect(callRpc<{ items: Array<{ packageId: string }> }>(address.port, 'extensions.listPackages', {}))
      .resolves.toMatchObject({ items: [] })
    await expect(callRpc(address.port, 'example.installed.status', {})).rejects.toThrow('method not found')
    await expect(readFile(localPaths.extensionDevLinksFile, 'utf8')).resolves.not.toContain('example.installed')
    await expect(readFile(localPaths.extensionStateFile, 'utf8')).resolves.not.toContain('example.installed')
    await expect(readFile(join(sourceDirectory, 'manifest.json'), 'utf8')).resolves.toContain('example.installed')
    await server.close()
  })
})

async function writeTestPackage(root: string): Promise<string> {
  const directory = join(root, 'package-source')
  await mkdir(join(directory, 'dist'), { recursive: true })
  await writeFile(join(directory, 'manifest.json'), JSON.stringify({
    manifestVersion: 2,
    id: 'example.installed',
    version: '1.0.0',
    displayName: 'Installed Example',
    description: 'Installed extension fixture',
    icon: './icon.png',
    author: 'Loom Studio',
    homepage: 'https://example.com/extensions/installed',
    repository: 'https://github.com/example/installed',
    tags: ['test', 'developer-tool'],
    engines: { studio: '^0.1.0' },
    modules: [
      {
        id: 'server',
        runtime: 'server',
        entry: './dist/index.js',
        capabilities: { 'assets.publish': true },
        contributes: {
          rpc: [
            { name: 'example.installed.create' },
            { name: 'example.installed.publish' },
            { name: 'example.installed.status' },
          ],
          documentTypes: [{ type: 'example.installed.data' }],
        },
      },
      {
        id: 'client',
        runtime: 'client',
        entry: './dist/client.js',
        contributes: {
          renderers: [{ id: 'tail', name: 'Tail', surface: 'narrative.timeline.tail', instanceScope: 'timeline' }],
        },
      },
    ],
  }))
  await writeFile(join(directory, 'icon.png'), new Uint8Array([137, 80, 78, 71]))
  await writeFile(join(directory, 'dist/index.js'), `
export function activate(ctx) {
  ctx.rpc.register('example.installed.status', () => ({ active: true }))
  ctx.rpc.register('example.installed.publish', async () => {
    const asset = await ctx.assets.publish({ bytes: new Uint8Array([7]), kind: 'generated.image', mediaType: 'image/png' })
    return { assetId: asset.id }
  })
  ctx.rpc.register('example.installed.create', async () => {
    await ctx.documents.write({ id: 'example.installed:data', type: 'example.installed.data', content: { retained: true }, expectedVersion: 'new' })
    const asset = await ctx.assets.publish({ bytes: new Uint8Array([4, 5, 6]), kind: 'generated.image', mediaType: 'image/png' })
    return { assetId: asset.id }
  })
}
`)
  await writeFile(join(directory, 'dist/client.js'), `
export function activate(ctx) {
  ctx.renderers.register({ id: 'tail', name: 'Tail', surface: 'narrative.timeline.tail', instanceScope: 'timeline' }, {
    mount(root) { root.textContent = 'client renderer' }
  })
}
`)
  return directory
}

async function readSseEvent(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  eventName: string,
): Promise<Record<string, unknown>> {
  const decoder = new TextDecoder()
  let buffer = ''

  for (;;) {
    const { done, value } = await reader.read()
    if (done) throw new Error(`SSE stream ended before event: ${eventName}`)
    buffer += decoder.decode(value, { stream: true })

    let boundary = buffer.indexOf('\n\n')
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      const event = block.split('\n').find(line => line.startsWith('event: '))?.slice(7)
      const data = block.split('\n').find(line => line.startsWith('data: '))?.slice(6)
      if (event === eventName && data) return JSON.parse(data) as Record<string, unknown>
      boundary = buffer.indexOf('\n\n')
    }
  }
}
