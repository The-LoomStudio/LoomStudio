import { createApplicationRuntime, type ExtensionInstallationContent, type LoomScriptContent } from '@loom-studio/application-runtime'
import { createPromptResourceStore } from '@loom-studio/application-data'
import { createBlobStore } from '@loom-studio/asset-store'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { extensionInstallationId } from '@loom-studio/extension-sdk'
import { unzipSync, zipSync } from 'fflate'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createExtensionScriptArchiveExporter } from '../../../apps/studio-server/src/extensions/extension-script-export.js'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup() })
const packageId = 'example.script-export'
const version = '1.0.0'
const source = [
  '// ==LoomScript==', '// @format 1', '// @id example.panel', '// @name Panel',
  '// @version 1.0.0', '// @runtime client-sandbox',
  '// @contribution {"kind":"renderer","id":"panel","surface":"narrative.timeline.tail","scope":"timeline","inputs":["artifact:panel"]}',
  '// ==/LoomScript==', 'export const value = 1', '',
].join('\r\n')

async function fixture(kind: 'global' | 'card' = 'global', install = true) {
  let sequence = 0
  const createId = (prefix: string) => `${prefix}-${++sequence}`
  const now = () => '2026-10-22T00:00:00.000Z'
  const dataEngine = createSqliteDataEngine({ filename: ':memory:', createId, now })
  const rootDirectory = await mkdtemp(join(tmpdir(), 'loom-script-export-'))
  cleanups.push(async () => { await dataEngine.close(); await rm(rootDirectory, { recursive: true, force: true }) })
  const documents = createSqliteDocumentStore({ engine: dataEngine })
  const blobs = createBlobStore({ engine: dataEngine, rootDirectory, createId, now })
  const exporter = createExtensionScriptArchiveExporter({ documents, blobs })
  const runtime = createApplicationRuntime({
    dataEngine, documents, blobs, exportExtensionArchive: exporter,
    promptResources: createPromptResourceStore({ engine: dataEngine, createId, now }),
  })
  const target = kind === 'card' ? { kind: 'card' as const, cardId: (await runtime.createCard({ name: 'Script export' })).card.id } : { kind: 'global' as const }
  const prefix = kind === 'card' ? 'release/' : ''
  const archive = zipSync({
    [`${prefix}manifest.json`]: Buffer.from(JSON.stringify({
      manifestVersion: 2, id: packageId, version, displayName: 'Scripts', engines: { studio: '^0.1.0' },
      contributes: { loomScripts: [{ id: 'panel', source: './scripts/panel.loom.js' }] },
    })),
    [`${prefix}scripts/panel.loom.js`]: Buffer.from(source),
    [`${prefix}assets/retained.txt`]: Buffer.from('unchanged'),
  })
  let expectedCardVersion: number | undefined
  if (target.kind === 'card') {
    const card = (await runtime.getCard({ cardId: target.cardId })).card
    expectedCardVersion = (await runtime.attachCardExtensionPackage({
      cardId: target.cardId, expectedVersion: card.version,
      archive: { packageId, version, archiveBase64: Buffer.from(archive).toString('base64') },
    })).card.version
  }
  const installationId = extensionInstallationId(packageId, target)
  const imported = install ? await runtime.importExtensionPackageResources({
    packageId, packageVersion: version, target, expectedCardVersion,
    promptResources: [], agentTools: [], transformRules: [], textExtractors: [],
    loomScripts: [{ contribution: { id: 'panel', source: './scripts/panel.loom.js' }, source }],
  }) : undefined
  return { documents, runtime, exporter, target, prefix, archive, installationId, scriptId: imported?.loomScripts?.[0]?.scriptId }
}

describe('saved Extension Script archive export', () => {
  it.each(['global', 'card'] as const)('exports the saved %s contribution bytes without changing source archives or ownership', async kind => {
    const f = await fixture(kind)
    const script = (await f.runtime.getLoomScript({ scriptDocumentId: f.scriptId! })).script
    const edited = source.replace('value = 1', 'value = 2')
    await f.runtime.updateLoomScript({ scriptDocumentId: script.id, expectedVersion: script.version, fileName: 'renamed.loom.js', source: edited })
    await f.runtime.importLoomScript({ owner: { kind: 'user' }, fileName: 'panel.loom.js', source: source.replace('value = 1', 'value = 99') })
    const input = { archive: f.archive, packageId, version, installationId: f.installationId }
    const result = f.target.kind === 'card'
      ? Buffer.from((await f.runtime.exportCardBundle({ cardId: f.target.cardId })).artifact.extensionPackages![0]!.archiveBase64, 'base64')
      : await f.exporter(input)
    const files = unzipSync(result)
    expect(Buffer.from(files[`${f.prefix}scripts/panel.loom.js`]!).toString()).toBe(edited)
    expect(Buffer.from(files[`${f.prefix}assets/retained.txt`]!).toString()).toBe('unchanged')
    expect(Buffer.from(unzipSync(f.archive)[`${f.prefix}scripts/panel.loom.js`]!).toString()).toBe(source)
    expect((await f.runtime.getLoomScript({ scriptDocumentId: script.id })).script.owner).toEqual(script.owner)
    expect(Buffer.from(await f.exporter(input))).toEqual(Buffer.from(result))
    if (f.target.kind === 'card') {
      expect((await f.runtime.getCardExtensionPackage({ cardId: f.target.cardId, packageId })).archive.archiveBase64).toBe(Buffer.from(f.archive).toString('base64'))
    }
  })

  it('preserves the original archive when its installation is absent', async () => {
    const f = await fixture('global', false)
    expect(await f.exporter({ archive: f.archive, packageId, version, installationId: f.installationId })).toBe(f.archive)
  })

  it('rejects an archive version that differs from the installed script version', async () => {
    const f = await fixture()
    const installation = (await f.documents.get(f.installationId))!
    await f.documents.write({
      id: installation.id, type: installation.type, expectedVersion: installation.version,
      content: { ...(installation.content as ExtensionInstallationContent), packageVersion: '2.0.0' },
    })
    await expect(f.exporter({ archive: f.archive, packageId, version, installationId: f.installationId })).rejects.toThrow('version differs')
  })

  it('removes explicitly deleted contributions from the exported manifest', async () => {
    const f = await fixture()
    const script = (await f.documents.get(f.scriptId!))!
    await f.runtime.deleteLoomScript({ scriptDocumentId: script.id, expectedVersion: script.version })
    const result = await f.exporter({ archive: f.archive, packageId, version, installationId: f.installationId })
    expect(JSON.parse(Buffer.from(unzipSync(result)['manifest.json']).toString()).contributes.loomScripts).toEqual([])
  })

  it('rejects an installed contribution with foreign-owner content', async () => {
    const f = await fixture()
    const script = (await f.documents.get(f.scriptId!))!
    await f.documents.write({ id: script.id, type: script.type, expectedVersion: script.version, content: { ...(script.content as LoomScriptContent), owner: { kind: 'user' } } })
    await expect(f.exporter({ archive: f.archive, packageId, version, installationId: f.installationId })).rejects.toThrow('owner does not match')
  })
})
