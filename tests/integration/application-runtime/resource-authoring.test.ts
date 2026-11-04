import { describe, expect, it } from 'vitest'
import { createSqliteDataEngine } from '../../../packages/data-engine/src/index.js'
import { createPromptResourceStore } from '../../../packages/application-data/src/index.js'
import { createSqliteDocumentStore } from '../../../packages/document-store/src/index.js'
import { createApplicationRuntime } from '../../../packages/application-runtime/src/index.js'
import { extensionInstallationId, installedExtensionContributionId } from '@loom-studio/extension-sdk'
import { createOfficialAgentToolRegistry, officialAgentToolDefinitions } from '../../../packages/application-runtime/src/agents/official-tools/index.js'
import { applicationDocumentTypes } from '../../../packages/application-runtime/src/foundation/document-types.js'
import type { AuthoringResource } from '@loom-studio/shared'

function setup() {
  let sequence = 0
  const createId = (prefix: string) => `${prefix}-${++sequence}`
  const engine = createSqliteDataEngine({ filename: ':memory:', createId, now: () => new Date().toISOString() })
  const store = createPromptResourceStore({ engine, createId })
  const documents = createSqliteDocumentStore({ engine })
  const agentTools = createOfficialAgentToolRegistry()
  const runtime = createApplicationRuntime({ dataEngine: engine, documents, promptResources: store, agentTools })
  return { engine, store, runtime, documents }
}
const draft = (id: string, resourceKind: 'preset' | 'lore' = 'preset'): AuthoringResource => ({
  format: 'loom.resource.authoring', schemaVersion: 1, id, resourceKind,
  rootNode: { id: `${id}-root`, kind: 'module', label: id, children: [{ id: `${id}-entry`, kind: 'entry', label: 'Text', body: 'before' }] },
})

describe('resource authoring Runtime', () => {
  it('updates the original tree, preserves host metadata and leaves no-op versions untouched', async () => {
    const { engine, store, runtime } = setup()
    try {
      const metadata = { model: { providerId: 'local', modelId: 'model' }, approvalPolicy: 'always', delivery: 'complete', historyPolicy: 'ephemeral', textUses: [{ id: 'rule', kind: 'rule', enabled: true }], future: { key: 'keep' } }
      await store.createResource({ actor: { kind: 'system', id: 'test' }, id: 'preset', resourceKind: 'preset', rootNode: draft('preset').rootNode, metadata })
      const captured = await runtime.captureResourceAuthoring({ resourceId: 'preset' })
      expect(captured.resource).not.toHaveProperty('delivery')
      const resource = structuredClone(captured.resource)
      resource.rootNode.children = []
      resource.useGlobalLore = false
      const input = { resources: [{ resource, expectedVersion: captured.version, expectedDigest: captured.digest }] }
      const applied = (await runtime.applyResourceAuthoring(input)).resources[0]!
      expect((await store.getResource('preset'))?.metadata).toEqual({ ...metadata, useGlobalLore: false })
      expect(applied.resource.rootNode.children ?? []).toEqual([])
      const noop = await runtime.applyResourceAuthoring({ resources: [{ resource: applied.resource, expectedVersion: applied.version, expectedDigest: applied.digest }] })
      expect(noop.resources[0]?.version).toBe(applied.version)
      await expect(runtime.applyResourceAuthoring(input)).rejects.toThrow('changed since export')
    } finally { await engine.close() }
  })
  it('creates a batch and its Lore references atomically, then rejects stale mount baselines', async () => {
    const { engine, store, runtime } = setup()
    try {
      const lore = draft('lore', 'lore')
      const preset = { ...draft('preset'), loreMounts: [{ kind: 'external' as const, resourceId: 'lore' }] }
      const created = await runtime.applyResourceAuthoring({ resources: [{ resource: preset, create: true }, { resource: lore, create: true }] })
      const snapshot = created.resources.find(item => item.resource.id === 'preset')!
      expect(await store.listLoreMounts({ source: { kind: 'preset', id: 'preset' } })).toHaveLength(1)
      await store.replaceLoreMounts({ expectedMountIds: (await store.listLoreMounts({ source: { kind: 'preset', id: 'preset' } })).map(mount => mount.id), actor: { kind: 'system', id: 'test' }, source: { kind: 'preset', id: 'preset' }, mounts: [] })
      expect((await store.getResource('preset'))?.version).toBe(snapshot.version)
      await expect(runtime.applyResourceAuthoring({ resources: [{ resource: snapshot.resource, expectedVersion: snapshot.version, expectedDigest: snapshot.digest }] })).rejects.toThrow('changed since export')
      const currentLore = created.resources.find(item => item.resource.id === 'lore')!
      currentLore.resource.rootNode.label = 'must not commit'
      await expect(runtime.applyResourceAuthoring({ resources: [
        { resource: currentLore.resource, expectedVersion: currentLore.version, expectedDigest: currentLore.digest },
        { resource: snapshot.resource, expectedVersion: snapshot.version, expectedDigest: snapshot.digest },
      ] })).rejects.toThrow('changed since export')
      expect((await store.getResource('lore'))?.label).toBe('lore')
    } finally { await engine.close() }
  })
  it('rolls back created resources when a mount write fails inside the transaction', async () => {
    const { engine, store, runtime } = setup()
    try {
      const reference = { kind: 'external' as const, resourceId: 'new-lore' }
      await expect(runtime.applyResourceAuthoring({ resources: [
        { resource: { ...draft('new-preset'), loreMounts: [reference, reference] }, create: true },
        { resource: draft('new-lore', 'lore'), create: true },
      ] })).rejects.toThrow()
      expect(await store.getResource('new-preset')).toBeNull()
      expect(await store.getResource('new-lore')).toBeNull()
    } finally { await engine.close() }
  })

  it('treats file format defaults as a no-op for sparse stored nodes', async () => {
    const { engine, store, runtime } = setup()
    try {
      await store.createResource({ actor: { kind: 'system', id: 'test' }, id: 'sparse', resourceKind: 'preset', rootNode: {
        id: 'sparse-root', kind: 'module', label: 'Sparse', children: [
          { id: 'empty-message', kind: 'message', label: 'Message' },
          { id: 'empty-folder', kind: 'folder', label: 'Folder', capabilities: {} },
          { id: 'empty-entry', kind: 'entry', label: 'Entry' },
        ],
      } })
      const snapshot = await runtime.captureResourceAuthoring({ resourceId: 'sparse' })
      expect(snapshot.resource.rootNode.children?.[0]).toMatchObject({ children: [], capabilities: { roleHint: 'system' } })
      expect(snapshot.resource.rootNode.children?.[2]?.body).toBe('')
      const { projectResourceAuthoring, restoreResourceAuthoring } = await import('../../../apps/studio-server/src/codecs/resource-authoring.js')
      const resource = restoreResourceAuthoring(projectResourceAuthoring(snapshot.resource))
      const result = await runtime.applyResourceAuthoring({ resources: [{ resource, expectedVersion: snapshot.version, expectedDigest: snapshot.digest }] })
      expect(result.resources[0]?.version).toBe(snapshot.version)
    } finally { await engine.close() }
  })

  it('keeps host, package and external Tool references portable across authoring Apply', async () => {
    const { engine, store, runtime, documents } = setup()
    try {
      const target = { kind: 'global' as const }
      const timestamp = new Date().toISOString()
      const owner = { kind: 'extension-package' as const, packageId: 'test.owner', packageVersion: '1.0.0',
        contributionId: 'preset', installationId: extensionInstallationId('test.owner', target) }
      for (const packageId of ['test.owner', 'test.dependency']) {
        await documents.write({ id: extensionInstallationId(packageId, target), type: applicationDocumentTypes.extensionInstallation,
          expectedVersion: 'new', actor: { kind: 'system', id: 'test' }, content: {
            packageId, packageVersion: '1.0.0', target, createdAt: timestamp, updatedAt: timestamp,
            ...(packageId === 'test.owner' ? { dependencies: [{ id: 'test.dependency', version: '^1.0.0' }] } : {}),
          } })
        await documents.write({ id: installedExtensionContributionId(packageId, target, `${packageId}/tool`), type: applicationDocumentTypes.agentTool,
          expectedVersion: 'new', actor: { kind: 'system', id: 'test' }, content: {
            owner: { namespace: packageId }, name: 'tool', description: 'test tool', input: { kind: 'structured', schema: { type: 'object' } },
            createdAt: timestamp, updatedAt: timestamp, origin: { ...owner, packageId, contributionId: `${packageId}/tool`, installationId: extensionInstallationId(packageId, target) },
          } })
      }
      await store.createResource({ actor: { kind: 'system', id: 'test' }, id: 'portable', resourceKind: 'preset',
        rootNode: draft('portable').rootNode, metadata: { origin: owner } })
      const references = [
        { kind: 'host' as const, toolId: officialAgentToolDefinitions[0].id },
        { kind: 'package' as const, contributionId: 'test.owner/tool' },
        { kind: 'external' as const, packageId: 'test.dependency', contributionId: 'test.dependency/tool', target: 'global' as const },
      ]
      const snapshot = await runtime.captureResourceAuthoring({ resourceId: 'portable' })
      snapshot.resource.toolMounts = references.map((reference, orderIndex) => ({ reference, orderIndex, defaultEnabled: true }))
      await runtime.applyResourceAuthoring({ resources: [{ resource: snapshot.resource, expectedVersion: snapshot.version, expectedDigest: snapshot.digest }] })
      const captured = await runtime.captureResourceAuthoring({ resourceId: 'portable' })
      expect(captured.resource.toolMounts?.map(mount => mount.reference)).toEqual(references)
      expect(captured.resource.toolMounts?.every(mount => mount.toolId === undefined)).toBe(true)
      const stored = await store.listPresetToolMounts({ presetResourceId: 'portable' })
      expect(stored.map(mount => mount.toolId)).toEqual([references[0].toolId,
        installedExtensionContributionId('test.owner', target, 'test.owner/tool'), installedExtensionContributionId('test.dependency', target, 'test.dependency/tool')])
      expect(stored.map(mount => mount.origin.toolReference)).toEqual(references)
      const { projectResourceAuthoring, restoreResourceAuthoring } = await import('../../../apps/studio-server/src/codecs/resource-authoring.js')
      const roundTrip = restoreResourceAuthoring(projectResourceAuthoring(captured.resource))
      const unchanged = await runtime.applyResourceAuthoring({ resources: [{ resource: roundTrip, expectedVersion: captured.version, expectedDigest: captured.digest }] })
      expect(unchanged.resources[0]?.version).toBe(captured.version)
      const broken = structuredClone(captured.resource)
      broken.toolMounts![2].reference = { kind: 'external', packageId: 'undeclared', contributionId: 'tool', target: 'global' }
      await expect(runtime.applyResourceAuthoring({ resources: [{ resource: broken, expectedVersion: captured.version, expectedDigest: captured.digest }] })).rejects.toThrow('dependency is not declared')
      expect((await runtime.captureResourceAuthoring({ resourceId: 'portable' })).digest).toBe(captured.digest)
    } finally { await engine.close() }
  })

  it('blocks uninstall of a global Tool provider after authoring adds a Card consumer mount', async () => {
    const { engine, store, runtime } = setup()
    try {
      await runtime.importExtensionPackageResources({
        packageId: 'test.provider', packageVersion: '1.0.0', promptResources: [], transformRules: [], textExtractors: [],
        agentTools: [{ contribution: { id: 'test.provider/tool', source: 'tool.json' },
          definition: { name: 'tool', description: 'Provider tool', input: { kind: 'structured', schema: { type: 'object' } } } }],
      })
      const { card } = await runtime.createCard({ name: 'Consumer Card' })
      const consumer = await runtime.importExtensionPackageResources({
        packageId: 'test.consumer', packageVersion: '1.0.0', target: { kind: 'card', cardId: card.id },
        dependencies: [{ id: 'test.provider', version: '^1.0.0' }], agentTools: [], transformRules: [], textExtractors: [],
        promptResources: [{ contribution: { id: 'test.consumer.preset', resourceKind: 'preset', source: 'preset.json' },
          artifact: { format: 'loom.promptResource', schemaVersion: 2, resourceKind: 'preset',
            rootNode: { id: 'test.consumer.root', kind: 'module', label: 'Consumer' } } }],
      })
      const resourceId = consumer.promptResources[0]!.resourceId
      const snapshot = await runtime.captureResourceAuthoring({ resourceId })
      snapshot.resource.toolMounts = [{ reference: { kind: 'external', packageId: 'test.provider', contributionId: 'test.provider/tool', target: 'global' },
        orderIndex: 0, defaultEnabled: true }]
      await runtime.applyResourceAuthoring({ resources: [{ resource: snapshot.resource, expectedVersion: snapshot.version, expectedDigest: snapshot.digest }] })
      const [mount] = await store.listPresetToolMounts({ presetResourceId: resourceId })
      expect(mount?.origin).toMatchObject({ kind: 'manual', consumerInstallationId: consumer.installationId })
      expect(mount?.origin).not.toHaveProperty('packageId')
      const provider = (await runtime.listExtensionInstallations()).installations.find(item => item.packageId === 'test.provider')!
      await expect(runtime.uninstallExtensionInstallation({ packageId: 'test.provider', expectedInstallationVersion: provider.version })).rejects.toThrow('dependency cannot be uninstalled')
      expect((await runtime.captureResourceAuthoring({ resourceId })).resource.toolMounts).toEqual(snapshot.resource.toolMounts)
    } finally { await engine.close() }
  })

})
