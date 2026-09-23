import { describe, expect, it } from 'vitest'
import { createApplicationRuntime } from '@loom-studio/application-runtime'
import { createPromptResourceStore } from '@loom-studio/application-data'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { handleWorkspacesRpc } from '../../../apps/studio-server/src/rpc/handlers/application/workspaces.js'

describe('Prompt Resource editing baseline', () => {
  it.each(['single', 'batch'] as const)('rejects stale %s edits through the RPC handler without replacing committed content', async mode => {
    let sequence = 0
    const createId = (prefix: string) => `${prefix}-${++sequence}`
    const now = () => new Date(0).toISOString()
    const engine = createSqliteDataEngine({ filename: ':memory:', createId, now })
    try {
      const documents = createSqliteDocumentStore({ engine })
      const promptResources = createPromptResourceStore({ engine, createId, now })
      const runtime = createApplicationRuntime({ dataEngine: engine, documents, promptResources })
      const { resource } = await runtime.createPromptResource({ resourceKind: 'setting', name: 'Original' })
      const { resource: latest } = await runtime.updatePromptResourceAsset({
        resourceId: resource.id, assetId: resource.rootNode.id, expectedVersion: resource.version, label: 'Agent edit',
      })
      const submit = (expectedVersion: number) => handleWorkspacesRpc(
        runtime,
        mode === 'single' ? 'application.updatePromptResourceAsset' : 'application.updatePromptResourceAssets',
        {
          resourceId: resource.id, expectedVersion,
          ...(mode === 'single'
            ? { assetId: resource.rootNode.id, label: 'User edit' }
            : { updates: [{ assetId: resource.rootNode.id, label: 'User edit' }] }),
        },
      )
      await expect(submit(resource.version)).rejects.toMatchObject({ code: 'prompt_resource.conflict' })
      const unchanged = (await runtime.getPromptResource({ resourceId: resource.id })).resource
      expect(unchanged.version).toBe(latest.version)
      expect(unchanged.rootNode.label).toBe('Agent edit')
      await expect(submit(0)).rejects.toMatchObject({ code: 'prompt_resource.expected_version_invalid' })
      await submit(latest.version)
      const saved = (await runtime.getPromptResource({ resourceId: resource.id })).resource
      expect(saved.version).toBe(latest.version + 1)
      expect(saved.rootNode.label).toBe('User edit')
    } finally {
      engine.close()
    }
  })
})
