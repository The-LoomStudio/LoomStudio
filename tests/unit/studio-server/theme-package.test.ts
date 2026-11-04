import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInMemoryDiagnosticsRegistry } from '@loom-studio/diagnostics'
import { createInMemoryDocumentStore } from '@loom-studio/document-store'
import { createExtensionHost } from '@loom-studio/extension-host'
import { expect, it, onTestFinished } from 'vitest'
import { createServerExtensionManager } from '../../../apps/studio-server/src/extensions/extension-manager.js'
import { createExtensionStateStore } from '../../../apps/studio-server/src/extensions/extension-state-store.js'

it('installs the official theme package and serves its CSS and palette previews without enabling JS', async () => {
  const root = await mkdtemp(join(tmpdir(), 'loom-theme-package-'))
  const source = fileURLToPath(new URL('../../../official/extensions/themes/', import.meta.url))
  const diagnostics = createInMemoryDiagnosticsRegistry()
  const documents = createInMemoryDocumentStore()
  onTestFinished(() => documents.close())
  const host = createExtensionHost({
    documents, diagnostics,
    callRpc: async () => null,
    registerRpc: () => { throw new Error('A newly installed theme must not register server RPC') },
  })
  try {
    const manager = createServerExtensionManager({
      host, diagnostics,
      stateStore: createExtensionStateStore({ filename: join(root, 'state.json'), now: () => '2026-10-17T00:00:00.000Z' }),
      repositoryDirectory: join(root, 'empty-repository'),
      installedDirectory: join(root, 'installed'),
      devLinksFile: join(root, 'dev-links.json'),
      readCardPackage: async () => { throw new Error('No Card package in this fixture') },
      listInstallations: async () => ({ installations: [] }),
      uninstallInstallation: async () => { throw new Error('Not used') },
      previewPackageResources: async () => { throw new Error('Not used') },
      importPackageResources: async () => ({ installationId: 'fixture', promptResources: [], agentTools: [], transformRules: [], textExtractors: [] }),
      removePackageResources: async ({ packageId }) => ({ packageId, promptResourceIds: [], agentToolIds: [], textTransformRuleIds: [], textExtractorIds: [], detachedReferences: { cards: 0, timelines: 0, presetToolMounts: 0 } }),
    })
    await manager.initialize()
    expect(manager.listPackages()).toEqual([])
    const installed = await manager.installPackage(source)
    const catalog = manager.listPackages()
    expect(catalog).toHaveLength(1)
    expect(catalog[0].resources?.themes).toEqual(installed.resources?.themes)
    expect(installed.packageId).toBe('official.themes')
    expect(catalog[0].resources?.themes).toHaveLength(11)
    expect(catalog[0].resources?.themes?.some(theme => theme.id === 'paper' || theme.id === 'tide')).toBe(false)
    expect(catalog[0].resources?.themes).toContainEqual(expect.objectContaining({ id: 'nord', previewColors: ['#2e3440', '#3b4252', '#88c0d0'] }))
    for (const theme of catalog[0].resources?.themes ?? []) {
      const css = await readFile(join(source, theme.css), 'utf8')
      expect(theme.previewColors).toHaveLength(3)
      for (const [index, token] of ['background', 'surface', 'accent'].entries()) {
        const declaration = css.split(`--loom-color-${token}:`)[1]?.split(';')[0]
        expect(declaration).toContain(theme.previewColors![index])
      }
      if (theme.id !== 'catppuccin') {
        expect(css).not.toMatch(/font-family|border-radius|backdrop-filter|url\(/)
      }
    }
    expect(catalog[0].resources?.styles).toEqual([
      expect.objectContaining({ id: 'smooth-motion', css: './motion.css', moduleId: 'motion', supportsCssOnly: true }),
      expect.objectContaining({ id: 'mint', css: './mint.css' }),
      expect.objectContaining({ id: 'amber', css: './amber.css' }),
    ])
    expect(catalog[0].modules).toEqual([expect.objectContaining({ moduleId: 'motion', runtimeKind: 'client', desired: expect.objectContaining({ enabled: false }) })])

    const revision = installed.fileRevision ?? installed.version
    for (const path of [...(catalog[0].resources?.themes ?? []).map(theme => theme.css), './motion.css', './mint.css', './amber.css', './client.js']) {
      const served = await manager.readPackageFile(installed.packageId, revision, path)
      const original = await readFile(join(source, path))
      expect(Buffer.from(served.bytes).equals(original)).toBe(true)
      expect(served.mediaType).toBe(path.endsWith('.css') ? 'text/css; charset=utf-8' : path.endsWith('.js') ? 'text/javascript; charset=utf-8' : path.endsWith('.png') ? 'image/png' : 'image/svg+xml')
      expect((await readFile(join(root, 'installed', installed.packageId, path))).equals(original)).toBe(true)
    }
  } finally {
    await host.disposeAll()
    await rm(root, { recursive: true, force: true })
  }
})

it('installs a module-free static background package and exposes its catalog and image', async () => {
  const root = await mkdtemp(join(tmpdir(), 'loom-background-package-'))
  const source = join(root, 'background-source')
  const image = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><path fill="#123" d="M0 0h1v1H0z"/></svg>')
  const backgrounds = [{ id: 'scene', name: '场景', description: '静态背景', image: './Assets/scene.svg' }]
  const diagnostics = createInMemoryDiagnosticsRegistry()
  const documents = createInMemoryDocumentStore()
  onTestFinished(() => documents.close())
  const host = createExtensionHost({
    documents, diagnostics,
    callRpc: async () => null,
    registerRpc: () => { throw new Error('A static background must not register server RPC') },
  })
  try {
    await mkdir(join(source, 'Assets'), { recursive: true })
    await writeFile(join(source, 'Assets/scene.svg'), image)
    await writeFile(join(source, 'manifest.json'), JSON.stringify({
      manifestVersion: 2, id: 'fixture.backgrounds', version: '1.0.0', displayName: '背景来源',
      engines: { studio: '^0.1.0' }, modules: [], contributes: { backgrounds },
    }))
    const manager = createServerExtensionManager({
      host, diagnostics,
      stateStore: createExtensionStateStore({ filename: join(root, 'state.json'), now: () => '2026-10-17T00:00:00.000Z' }),
      repositoryDirectory: join(root, 'empty-repository'),
      installedDirectory: join(root, 'installed'),
      devLinksFile: join(root, 'dev-links.json'),
      readCardPackage: async () => { throw new Error('No Card package in this fixture') },
      listInstallations: async () => ({ installations: [] }),
      uninstallInstallation: async () => { throw new Error('Not used') },
      previewPackageResources: async () => { throw new Error('Not used') },
      importPackageResources: async () => ({ installationId: 'fixture', promptResources: [], agentTools: [], transformRules: [], textExtractors: [] }),
      removePackageResources: async ({ packageId }) => ({ packageId, promptResourceIds: [], agentToolIds: [], textTransformRuleIds: [], textExtractorIds: [], detachedReferences: { cards: 0, timelines: 0, presetToolMounts: 0 } }),
    })
    await manager.initialize()
    const installed = await manager.installPackage(source)
    expect(installed.modules).toEqual([])
    expect(manager.listPackages()).toEqual([
      expect.objectContaining({
        packageId: 'fixture.backgrounds', displayName: '背景来源', modules: [],
        resources: expect.objectContaining({ backgrounds }),
      }),
    ])
    const served = await manager.readPackageFile(installed.packageId, installed.fileRevision ?? installed.version, backgrounds[0].image)
    expect(served.mediaType).toBe('image/svg+xml')
    expect(Buffer.from(served.bytes)).toEqual(image)
    expect(await readFile(join(root, 'installed', installed.packageId, 'Assets/scene.svg'))).toEqual(image)
  } finally {
    await host.disposeAll()
    await rm(root, { recursive: true, force: true })
  }
})
