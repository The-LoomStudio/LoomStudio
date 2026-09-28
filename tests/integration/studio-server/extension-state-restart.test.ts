import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createStudioServer } from '../../../apps/studio-server/src/main.js'
import { resolveLoomStudioLocalPaths } from '../../../apps/studio-server/src/platform/local-paths.js'
import { createMemorySecretBackend } from '../../../packages/secret-store/src/index.js'
import { authenticatedFetch, callRpc } from './helpers.js'
import type { ApplyStateMutationResult, StateChangeEvent } from '@loom-studio/application-runtime'
import { unzipSync, zipSync } from 'fflate'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('Studio Server Extension state restart', () => {
  it('restores isolated Card modules and cleans up only the uninstalled or deleted Card', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'loom-card-extension-restart-')))
    temporaryDirectories.push(root)
    const options = {
      localPaths: resolveLoomStudioLocalPaths({ home: join(root, 'home'), environment: {} }),
      extensionRootDirectory: join(root, 'empty-repository'),
      secretBackend: createMemorySecretBackend(),
    }
    const packageId = 'example.card-lifecycle'
    const archive = {
      packageId, version: '1.0.0',
      archiveBase64: Buffer.from(zipSync({
        'manifest.json': new TextEncoder().encode(JSON.stringify({
          manifestVersion: 2, id: packageId, version: '1.0.0', displayName: 'Card lifecycle',
          engines: { studio: '^0.1.0' },
          modules: [{
            id: 'server', runtime: 'server', entry: './index.mjs',
            capabilities: { 'events.subscribe': ['state'] },
            contributes: { rpc: [{ name: `${packageId}.status` }] },
          }, { id: 'client', runtime: 'client', entry: './client.mjs' }],
        })),
        'index.mjs': new TextEncoder().encode(`
export function activate(ctx) {
  ctx.rpc.register('${packageId}.status', () => ({ grants: ctx.permissions.events.subscribe }))
}
`),
        'client.mjs': new TextEncoder().encode("export { activate } from './helper.mjs'"),
        'helper.mjs': new TextEncoder().encode('export function activate() {}'),
      })).toString('base64'),
    }
    const cards: Array<{ id: string; version: number }> = []
    const status = (port: number, cardId: string) => callRpc(port, 'extensions.callPackageRpc', {
      packageId, target: { kind: 'card', cardId }, method: `${packageId}.status`,
    })
    const first = createStudioServer(options)
    try {
      const { port } = await first.listen(0)
      for (const name of ['A', 'B']) {
        const { card } = await callRpc<{ card: { id: string; version: number } }>(port, 'application.importCardBundle', {
          artifact: { schemaVersion: 4, artifactId: name, displayName: name, card: { name }, contextAssets: [], extensionPackages: [archive] },
        })
        cards.push(card)
        const target = { kind: 'card', cardId: card.id }
        await callRpc(port, 'extensions.installCardPackage', { cardId: card.id, packageId, expectedCardVersion: card.version })
        await expect(status(port, card.id)).rejects.toThrow()
        await expect(callRpc(port, 'extensions.enableModule', { packageId, moduleId: 'client', target })).resolves.toMatchObject({
          module: { target, desired: { enabled: true } },
        })
        await callRpc(port, 'extensions.enableModule', {
          packageId, moduleId: 'server', target, grants: { 'events.subscribe': name === 'A' ? ['state'] : [] },
        })
      }
      await expect(callRpc(port, 'extensions.listPackages', {})).resolves.toEqual({ items: [] })
      await expect(callRpc(port, `${packageId}.status`, {})).rejects.toThrow()
      await expect(status(port, cards[0]!.id)).resolves.toEqual({ grants: ['state'] })
      await expect(status(port, cards[1]!.id)).resolves.toEqual({ grants: [] })
      const target = { kind: 'card', cardId: cards[0]!.id }
      await callRpc(port, 'extensions.disableModule', { packageId, moduleId: 'server', target })
      await expect(status(port, cards[0]!.id)).rejects.toThrow()
      await expect(status(port, cards[1]!.id)).resolves.toEqual({ grants: [] })
      await callRpc(port, 'extensions.enableModule', { packageId, moduleId: 'server', target })
      await callRpc(port, 'extensions.reloadModule', { packageId, moduleId: 'server', target })
      const files = unzipSync(Buffer.from(archive.archiveBase64, 'base64'))
      const manifest = JSON.parse(new TextDecoder().decode(files['manifest.json'])) as {
        version: string; modules: Array<{ id: string; runtime: string; entry: string; capabilities?: Record<string, unknown> }>
      }
      manifest.version = '2.0.0'
      manifest.modules.push({ id: 'new-server', runtime: 'server', entry: './new.mjs' })
      files['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest))
      files['index.mjs'] = new TextEncoder().encode(`
export function activate(ctx) {
  ctx.rpc.register('${packageId}.status', () => ({ grants: ctx.permissions.events.subscribe, updated: true }))
}
`)
      files['new.mjs'] = new TextEncoder().encode('export function activate() {}')
      files['helper.mjs'] = new TextEncoder().encode('export function activate() { return "new archive" }')
      const attach = async (expectedVersion: number) => callRpc<{ card: { version: number } }>(port, 'application.attachCardExtensionPackage', {
        cardId: cards[0]!.id, expectedVersion,
        archive: { ...archive, version: '2.0.0', archiveBase64: Buffer.from(zipSync(files)).toString('base64') },
      })
      const attached = await attach(cards[0]!.version)
      const installedVersion = async () => {
        const { installations } = await callRpc<{ installations: Array<{ version: number; target: { cardId: string } }> }>(
          port, 'application.listExtensionInstallations', {},
        )
        return installations.find(item => item.target.cardId === cards[0]!.id)!.version
      }
      const update = {
        cardId: cards[0]!.id, packageId, packageVersion: '2.0.0',
        expectedCardVersion: attached.card.version, expectedInstallationVersion: await installedVersion(),
      }
      await expect(callRpc(port, 'extensions.updateCardPackage', { ...update, expectedInstallationVersion: update.expectedInstallationVersion + 1 })).rejects.toThrow('installation changed')
      await expect(status(port, cards[0]!.id)).resolves.toEqual({ grants: ['state'] })
      await expect(callRpc(port, 'extensions.updateCardPackage', update)).resolves.toMatchObject({
        package: { version: '2.0.0', modules: expect.arrayContaining([
          expect.objectContaining({ moduleId: 'new-server', desired: expect.objectContaining({ enabled: false }) }),
        ]) },
      })
      await expect(status(port, cards[0]!.id)).resolves.toEqual({ grants: ['state'], updated: true })
      await expect(status(port, cards[1]!.id)).resolves.toEqual({ grants: [] })
      const clientEntry = async () => {
        const result = await callRpc<{ items: Array<{ modules: Array<{ moduleId: string; entryUrl?: string }> }> }>(
          port, 'extensions.listPackages', { target },
        )
        return result.items[0]!.modules.find(module => module.moduleId === 'client')!.entryUrl!
      }
      const beforeEntry = await clientEntry()
      expect(await (await authenticatedFetch(port, beforeEntry)).text()).toContain("./helper.mjs")
      const dependencyPath = (entry: string) => new URL('./helper.mjs', `http://127.0.0.1:${port}${entry}`).pathname
      expect(await (await authenticatedFetch(port, dependencyPath(beforeEntry))).text()).toContain('new archive')
      manifest.modules[0]!.capabilities!['state.write'] = true
      files['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest))
      files['helper.mjs'] = new TextEncoder().encode('export function activate() { return "same version update" }')
      const changedPermissions = await attach(attached.card.version)
      await callRpc(port, 'extensions.updateCardPackage', {
        ...update, expectedCardVersion: changedPermissions.card.version, expectedInstallationVersion: await installedVersion(),
      })
      const afterEntry = await clientEntry()
      expect(afterEntry).not.toBe(beforeEntry)
      expect(dependencyPath(afterEntry)).not.toBe(dependencyPath(beforeEntry))
      expect((await authenticatedFetch(port, beforeEntry)).status).toBe(404)
      expect((await authenticatedFetch(port, dependencyPath(beforeEntry))).status).toBe(404)
      expect(await (await authenticatedFetch(port, dependencyPath(afterEntry))).text()).toContain('same version update')
      await expect(status(port, cards[0]!.id)).rejects.toThrow()
      await callRpc(port, 'extensions.enableModule', { packageId, moduleId: 'server', target })
      await callRpc(port, 'application.detachCardExtensionPackage', {
        cardId: cards[0]!.id, expectedVersion: changedPermissions.card.version, packageId,
      })
    } finally {
      await first.close()
    }
    const second = createStudioServer(options)
    try {
      const { port } = await second.listen(0)
      await expect(status(port, cards[0]!.id)).resolves.toEqual({ grants: ['state'], updated: true })
      await expect(status(port, cards[1]!.id)).resolves.toEqual({ grants: [] })
      const { installations } = await callRpc<{ installations: Array<{ version: number; target: { cardId: string } }> }>(
        port, 'application.listExtensionInstallations', {},
      )
      await callRpc(port, 'extensions.uninstallCardPackage', {
        cardId: cards[0]!.id, packageId,
        expectedInstallationVersion: installations.find(item => item.target.cardId === cards[0]!.id)!.version,
      })
      await expect(status(port, cards[0]!.id)).rejects.toThrow()
      await expect(status(port, cards[1]!.id)).resolves.toEqual({ grants: [] })
      await callRpc(port, 'application.deleteCard', { cardId: cards[1]!.id })
      await expect(status(port, cards[1]!.id)).rejects.toThrow()
      await expect(callRpc(port, 'application.listExtensionInstallations', {})).resolves.toEqual({ installations: [] })
    } finally {
      await second.close()
    }
    const third = createStudioServer(options)
    try {
      const { port } = await third.listen(0)
      for (const card of cards) await expect(callRpc(port, 'extensions.listPackages', { target: { kind: 'card', cardId: card.id } })).resolves.toEqual({ items: [] })
    } finally {
      await third.close()
    }
  })

  it('restores an enabled module and its state subscription grant after recreating the server', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'loom-extension-state-restart-')))
    temporaryDirectories.push(root)
    const sourceDirectory = join(root, 'package-source')
    await mkdir(sourceDirectory)
    await writeFile(join(sourceDirectory, 'manifest.json'), JSON.stringify({
      manifestVersion: 2,
      id: 'example.state',
      version: '1.0.0',
      displayName: 'State Subscription',
      engines: { studio: '^0.1.0' },
      modules: [{
        id: 'server',
        runtime: 'server',
        entry: './index.js',
        capabilities: { 'events.subscribe': ['state'], 'state.write': true },
        contributes: { rpc: [{ name: 'example.state.status' }, { name: 'example.state.changes' }, { name: 'example.state.write' }] },
      }],
    }))
    await writeFile(join(sourceDirectory, 'index.js'), `
export function activate(ctx) {
  const changes = []
  ctx.state.subscribe({}, event => { changes.push(event) })
  ctx.rpc.register('example.state.changes', () => changes)
  ctx.rpc.register('example.state.write', input => ctx.state.write(input))
  ctx.rpc.register('example.state.status', () => ({
    active: true,
    grants: ctx.permissions.events.subscribe,
  }))
}
`)
    const options = {
      localPaths: resolveLoomStudioLocalPaths({ home: join(root, 'home'), environment: {} }),
      extensionRootDirectory: join(root, 'empty-repository'),
      secretBackend: createMemorySecretBackend(),
    }
    const first = createStudioServer(options)
    try {
      const { port } = await first.listen(0)
      await callRpc(port, 'extensions.installPackage', { sourceDirectory })
      await expect(callRpc(port, 'extensions.enableModule', {
        packageId: 'example.state',
        moduleId: 'server',
        grants: { 'events.subscribe': ['state'] },
      })).resolves.toMatchObject({
        module: { desired: { enabled: true, grants: { 'events.subscribe': ['state'] } } },
      })
      await expect(callRpc(port, 'example.state.status', {})).resolves.toEqual({ active: true, grants: ['state'] })
      const initial = await callRpc<{ snapshot: { revisionId: string } }>(port, 'application.getStateSnapshot', { target: { scope: 'global' } })
      const ui = await callRpc<ApplyStateMutationResult>(port, 'application.applyStateMutation', {
        target: { scope: 'global' }, expectedRevisionId: initial.snapshot.revisionId,
        operations: [{ op: 'set', path: '/subscriptionProbe', value: 1 }],
      })
      const extensionInput = {
        target: { scope: 'global' }, expectedRevisionId: ui.snapshot.revisionId,
        operations: [{ op: 'set', path: '/subscriptionProbe', value: 2 }], idempotencyKey: 'extension-once',
      }
      const extension = await callRpc<{ snapshot: { revisionId: string }; changesetId: string }>(port, 'example.state.write', extensionInput)
      await callRpc(port, 'example.state.write', extensionInput)
      const changes = await callRpc<StateChangeEvent[]>(port, 'example.state.changes', {})
      expect(changes).toEqual([
        { target: { scope: 'global' }, revisionId: ui.snapshot.revisionId, changesetId: ui.mutation.changesetId, paths: ['/subscriptionProbe'] },
        { target: { scope: 'global' }, revisionId: extension.snapshot.revisionId, changesetId: extension.changesetId, paths: ['/subscriptionProbe'] },
      ])
      const card = await callRpc<{ card: { id: string } }>(port, 'application.createCard', { name: 'State events' })
      const timeline = await callRpc<{ timeline: { id: string }; branch: { id: string } }>(port, 'application.createNarrativeTimeline', { cardId: card.card.id })
      const target = { scope: 'timeline', timelineId: timeline.timeline.id, branchId: timeline.branch.id }
      const timelineState = await callRpc<{ snapshot: { revisionId: string } }>(port, 'application.getStateSnapshot', { target })
      const changed = await callRpc<ApplyStateMutationResult>(port, 'application.applyStateMutation', {
        target, expectedRevisionId: timelineState.snapshot.revisionId,
        operations: [{ op: 'set', path: '/subscriptionProbe', value: 3 }],
      })
      expect(await callRpc<StateChangeEvent[]>(port, 'example.state.changes', {})).toEqual([
        ...changes,
        { target, revisionId: changed.snapshot.revisionId, changesetId: changed.mutation.changesetId, paths: ['/subscriptionProbe'] },
      ])
    } finally {
      await first.close()
    }

    const second = createStudioServer(options)
    try {
      const { port } = await second.listen(0)
      await expect(callRpc(port, 'example.state.status', {})).resolves.toEqual({ active: true, grants: ['state'] })
      await expect(callRpc(port, 'extensions.listPackages', {})).resolves.toMatchObject({
        items: [{
          packageId: 'example.state',
          modules: [{
            moduleId: 'server',
            desired: { enabled: true, grants: { 'events.subscribe': ['state'] } },
          }],
        }],
      })
    } finally {
      await second.close()
    }
  })
})
