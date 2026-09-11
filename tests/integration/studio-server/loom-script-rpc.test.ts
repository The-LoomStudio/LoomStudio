import { createApplicationRuntime } from '@loom-studio/application-runtime'
import { createBlobStore } from '@loom-studio/blob-store'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { createPromptResourceStore } from '@loom-studio/prompt-resource-store'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { callApplicationRpc } from '../../../apps/studio-server/src/rpc/handlers/application/index.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('Loom Script Application RPC', () => {
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
