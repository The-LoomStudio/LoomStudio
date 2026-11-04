import { serializeLoomScriptMetadata, loomScriptMountSchema } from '@loom-studio/shared/loom-scripts'
import { createApplicationRuntime } from '@loom-studio/application-runtime'
import { createBlobStore } from '@loom-studio/asset-store'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { createPromptResourceStore } from '@loom-studio/application-data'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { callApplicationRpc } from '../../support/trpc-caller.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('Loom Script Application RPC', () => {
  it('previews exactly the selected Narrative or Agent source for rules and extractors', async () => {
    const runtime = await createRuntime()
    for (const targets of [['narrative'], ['agent-session'], ['narrative', 'agent-session']] as const) {
      const script = serializeLoomScriptMetadata({
        formatVersion: 1, metadataId: 'preview.source', name: 'Preview source', scriptVersion: '1.0.0',
        runtime: 'declarative', requestedCapabilities: [], contributions: [
          { kind: 'text-transform', id: 'replace', rule: { name: 'Replace', enabled: true, orderIndex: 0,
            targets: [...targets], phases: ['display'], matcher: { kind: 'regex', pattern: 'Alice', flags: 'g' },
            effect: { kind: 'replace', replacement: 'Bob' } } },
          { kind: 'text-extractor', id: 'extract', extractor: { name: 'Extract', enabled: true, orderIndex: 0,
            targets: [...targets], matcher: { kind: 'regex', pattern: '(Alice|Bob)', flags: 'g', contentGroup: 1 },
            parser: 'text', strategy: 'latest-valid', artifactType: 'preview.text' } },
        ],
      })
      for (const previewSource of ['narrative', 'agent-session'] as const) {
        const result = await callApplicationRpc(runtime, 'application.previewLoomScript', {
          source: script, text: 'Alice', previewSource,
        }) as Awaited<ReturnType<typeof runtime.previewLoomScript>>
        const active = (targets as readonly string[]).includes(previewSource)
        expect(result.output).toBe(active ? 'Bob' : 'Alice')
        expect(result.matches).toHaveLength(active ? 1 : 0)
        expect(result.extractions[0]?.values).toEqual(active ? ['Bob'] : [])
      }
      const compatible = await callApplicationRpc(runtime, 'application.previewLoomScript', { source: script, text: 'Alice' }) as Awaited<ReturnType<typeof runtime.previewLoomScript>>
      expect(compatible.output).toBe((targets as readonly string[]).includes('narrative') ? 'Bob' : 'Alice')
    }
    await expect(callApplicationRpc(runtime, 'application.previewLoomScript', { source: source(), text: '', previewSource: 'unknown' })).rejects.toThrow()
  })

  it('imports directly into a scope in one registered mutation', async () => {
    const runtime = await createRuntime()
    const target = { kind: 'card', cardId: 'role' }
    const imported = await callApplicationRpc(runtime, 'application.importLoomScript', {
      owner: target, fileName: 'rpc.loom.js', source: source(), mount: { target, orderIndex: 4 },
    }) as any
    const listed = await callApplicationRpc(runtime, 'application.listLoomScriptMounts', { target }) as any
    expect(listed.mounts).toEqual([expect.objectContaining({ scriptDocumentId: imported.script.id,
      target, orderIndex: 4, enabled: false, grantedCapabilities: [] })])
  })

  it('imports, exports, mounts, enables, and grants through the registered RPC methods', async () => {
    const runtime = await createRuntime()
    const imported = await callApplicationRpc(runtime, 'application.importLoomScript', {
      owner: { kind: 'workspace', workspaceId: 'workspace-1' },
      fileName: 'rpc.loom.js',
      source: source(),
    }) as any
    const exported = await callApplicationRpc(runtime, 'application.exportLoomScript', { scriptDocumentId: imported.script.id }) as any
    expect(exported.artifact.source).toBe(source())

    const created = await callApplicationRpc(runtime, 'application.createLoomScriptMount', {
      target: { kind: 'workspace', workspaceId: 'workspace-1' },
      scriptDocumentId: imported.script.id,
      orderIndex: 1,
    }) as any
    expect(created.mount).toMatchObject({ enabled: false, grantedCapabilities: [] })
    const updated = await callApplicationRpc(runtime, 'application.updateLoomScriptMount', {
      mountId: created.mount.id,
      expectedVersion: created.mount.version,
      enabled: true,
      orderIndex: 1,
      grantedCapabilities: ['state.read'],
    }) as any
    expect(updated.mount).toMatchObject({ enabled: true, grantedCapabilities: ['state.read'] })
    expect(loomScriptMountSchema.parse(updated.mount)).toEqual(updated.mount)
    const listed = await callApplicationRpc(runtime, 'application.listLoomScriptMounts', {
      target: { kind: 'workspace', workspaceId: 'workspace-1' }, scriptDocumentId: imported.script.id,
    }) as any
    expect(listed.mounts).toEqual([updated.mount])

    // Ownership is not a mount target; invalid writes must preserve existing grants.
    await expect(callApplicationRpc(runtime, 'application.createLoomScriptMount', {
      target: { kind: 'extension', packageId: 'example', installationId: 'installation-1' },
      scriptDocumentId: imported.script.id, orderIndex: 0,
    })).rejects.toThrow()
    await expect(callApplicationRpc(runtime, 'application.updateLoomScriptMount', {
      mountId: created.mount.id, expectedVersion: updated.mount.version,
      enabled: true, orderIndex: 1, grantedCapabilities: ['state.write'],
    })).rejects.toThrow('unique requested capabilities')
    const afterRejected = await callApplicationRpc(runtime, 'application.listLoomScriptMounts', {
      scriptDocumentId: imported.script.id,
    }) as any
    expect(afterRejected.mounts).toEqual(listed.mounts)


    const resolved = await callApplicationRpc(runtime, 'application.resolveLoomScriptRendererMounts', {
      workspaceId: 'workspace-1',
    }) as any
    expect(resolved.mounts).toHaveLength(1)
    expect(resolved.mounts[0]).toMatchObject({
      mountId: created.mount.id,
      enabled: true,
      grantedCapabilities: ['state.read'],
      script: {
        id: imported.script.id,
        version: imported.script.version,
        metadataId: 'rpc.script',
        scriptVersion: '1.0.0',
      },
    })
    expect(resolved.mounts[0].source).toBe(source())
  })
})

function source(): string {
  return [
    '// ==LoomScript==',
    '// @format       1',
    '// @id           rpc.script',
    '// @name         RPC Script',
    '// @version      1.0.0',
    '// @runtime      client-sandbox',
    '// @capability   state.read',
    '// @contribution {"kind":"renderer","id":"rpc-panel","surface":"shell.workspace-panel","scope":"workspace","inputs":["artifact:rpc.data"]}',
    '// ==/LoomScript==',
    'export const renderers = {}',
  ].join('\n')
}

async function createRuntime() {
  let sequence = 0
  const createId = (prefix: string) => `${prefix}-${++sequence}`
  const now = () => '2026-09-11T00:00:00.000Z'
  const engine = createSqliteDataEngine({ filename: ':memory:', createId, now })
  const rootDirectory = await mkdtemp(join(tmpdir(), 'loom-script-rpc-'))
  roots.push(rootDirectory)
  return createApplicationRuntime({
    dataEngine: engine,
    documents: createSqliteDocumentStore({ engine }),
    promptResources: createPromptResourceStore({ engine, createId, now }),
    blobs: createBlobStore({ engine, rootDirectory, createId, now }),
  })
}
