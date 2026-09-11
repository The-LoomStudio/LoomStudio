import { createApplicationRuntime } from '@loom-studio/application-runtime'
import { createBlobStore } from '@loom-studio/blob-store'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { createPromptResourceStore } from '@loom-studio/prompt-resource-store'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseLoomScriptSource, serializeLoomScriptMetadata } from '../../../packages/application-runtime/src/scripts/loom-script-codec.js'
import { resolveLoomScriptRendererMounts, snapshotLoomScriptMounts } from '../../../packages/application-runtime/src/scripts/loom-script-resolution.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('Loom Script codec and store', () => {
  it('parses multiple contributions and serializes canonical Metadata', () => {
    const metadata = parseLoomScriptSource(source())
    expect(metadata.contributions.map(item => item.renderer.id)).toEqual(['status-panel', 'status-tail'])
    expect(parseLoomScriptSource(`${serializeLoomScriptMetadata(metadata)}\nexport const renderers = {}`)).toEqual(metadata)
  })

  it.each([
    ['missing field', source().replace('// @name         Alice UI\n', ''), 'Missing Loom Script Metadata field: @name'],
    ['duplicate field', source().replace('// @name         Alice UI', '// @name         Alice UI\n// @name         Again'), 'Duplicate Loom Script Metadata field: @name'],
    ['unknown field', source().replace('// @name         Alice UI', '// @name         Alice UI\n// @kind         renderer'), 'Unknown Loom Script Metadata field: @kind'],
    ['duplicate contribution', source().replace('"id":"status-tail"', '"id":"status-panel"'), 'Duplicate Loom Script contribution id'],
    ['invalid input', source().replace('match:alice.status', 'network:anywhere'), 'Unsupported Loom Script contribution input'],
  ])('rejects %s', (_label, input, message) => {
    expect(() => parseLoomScriptSource(input)).toThrow(message)
  })

  it('atomically stores source bytes, exports byte-exact text, and keeps Mount grants independent', async () => {
    const fixture = await createFixture()
    const runtime = createApplicationRuntime(fixture) as any
    const imported = await runtime.importLoomScript({
      owner: { kind: 'card', cardId: 'card-1' },
      fileName: 'alice.loom.js',
      source: source('\r\n'),
    })
    const exported = await runtime.exportLoomScript({ scriptDocumentId: imported.script.id })
    expect(exported.artifact.source).toBe(source('\r\n'))
    expect(imported.script.metadataId).toBe('alice.presentation')
    expect(imported.script.id).not.toBe(imported.script.metadataId)

    const createdMount = await runtime.createLoomScriptMount({
      target: { kind: 'card', cardId: 'card-1' },
      scriptDocumentId: imported.script.id,
      orderIndex: 4,
    })
    expect(createdMount.mount).toMatchObject({ enabled: false, grantedCapabilities: [] })
    const updatedMount = await runtime.updateLoomScriptMount({
      mountId: createdMount.mount.id,
      expectedVersion: createdMount.mount.version,
      enabled: true,
      orderIndex: 4,
      grantedCapabilities: ['state.read'],
    })
    expect(updatedMount.mount).toMatchObject({ enabled: true, grantedCapabilities: ['state.read'] })
  })

  it('rejects invalid Metadata without a partial Document and rejects differing digest for the same owner id', async () => {
    const fixture = await createFixture()
    const runtime = createApplicationRuntime(fixture) as any
    await expect(runtime.importLoomScript({
      owner: { kind: 'card', cardId: 'card-1' },
      fileName: 'broken.loom.js',
      source: 'export const renderers = {}',
    })).rejects.toThrow('Metadata must start')
    await expect(fixture.documents.list({ type: 'airp.loomScript' })).resolves.toMatchObject({ items: [] })

    await runtime.importLoomScript({ owner: { kind: 'card', cardId: 'card-1' }, fileName: 'alice.loom.js', source: source() })
    await expect(runtime.importLoomScript({
      owner: { kind: 'card', cardId: 'card-1' },
      fileName: 'alice-other.loom.js',
      source: source().replace('export const value = 1', 'export const value = 2'),
    })).rejects.toThrow('Metadata id conflict for owner')
    await expect(runtime.importLoomScript({
      owner: { kind: 'card', cardId: 'card-2' },
      fileName: 'alice.loom.js',
      source: source().replace('export const value = 1', 'export const value = 2'),
    })).resolves.toBeTruthy()
  })

  it('resolves a Timeline snapshot from the frozen Script revision after the author updates the Card Script', async () => {
    const fixture = await createFixture()
    const runtime = createApplicationRuntime(fixture) as any
    const imported = await runtime.importLoomScript({
      owner: { kind: 'card', cardId: 'card-1' },
      fileName: 'alice.loom.js',
      source: source(),
    })
    const createdMount = await runtime.createLoomScriptMount({
      target: { kind: 'card', cardId: 'card-1' },
      scriptDocumentId: imported.script.id,
      orderIndex: 0,
    })
    await runtime.updateLoomScriptMount({
      mountId: createdMount.mount.id,
      expectedVersion: createdMount.mount.version,
      enabled: true,
      orderIndex: 0,
      grantedCapabilities: ['state.read'],
    })
    const frozen = await snapshotLoomScriptMounts(fixture, { kind: 'card', cardId: 'card-1' })

    await runtime.updateLoomScript({
      scriptDocumentId: imported.script.id,
      expectedVersion: imported.script.version,
      fileName: 'alice.loom.js',
      source: source().replace('export const value = 1', 'export const value = 2'),
    })

    const resolved = await resolveLoomScriptRendererMounts(fixture, { currentTargets: [], frozenMounts: frozen })
    expect(resolved).toHaveLength(1)
    expect(resolved[0]).toMatchObject({ enabled: true, script: { version: imported.script.version } })
    expect(resolved[0]?.source).toContain('export const value = 1')
  })
})

function source(newline = '\n'): string {
  return [
    '// ==LoomScript==',
    '// @format       1',
    '// @id           alice.presentation',
    '// @name         Alice UI',
    '// @version      1.0.0',
    '// @runtime      client-sandbox',
    '// @capability   state.read',
    '// @contribution {"kind":"renderer","id":"status-panel","surface":"narrative.entry.inline","scope":"node","inputs":["match:alice.status"]}',
    '// @contribution {"kind":"renderer","id":"status-tail","surface":"narrative.timeline.tail","scope":"timeline","inputs":["artifact:alice.summary"]}',
    '// ==/LoomScript==',
    'export const value = 1',
    '',
  ].join(newline)
}

async function createFixture() {
  let sequence = 0
  const createId = (prefix: string) => `${prefix}-${++sequence}`
  const now = () => '2026-09-11T00:00:00.000Z'
  const engine = createSqliteDataEngine({ filename: ':memory:', createId, now })
  const rootDirectory = await mkdtemp(join(tmpdir(), 'loom-script-test-'))
  roots.push(rootDirectory)
  return {
    dataEngine: engine,
    documents: createSqliteDocumentStore({ engine }),
    promptResources: createPromptResourceStore({ engine, createId, now }),
    blobs: createBlobStore({ engine, rootDirectory, createId, now }),
  }
}
