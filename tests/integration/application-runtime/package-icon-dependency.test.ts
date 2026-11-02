import { describe, expect, it, vi } from 'vitest'
import { createApplicationRuntime, type ImportExtensionPackageResourcesInput } from '@loom-studio/application-runtime'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { createPromptResourceStore } from '@loom-studio/application-data'
import { createId, nowIso, type PromptResourceDisplayMetadata } from '@loom-studio/shared'
import { extensionInstallationId } from '@loom-studio/extension-sdk'

function fixture() {
  const engine = createSqliteDataEngine({ filename: ':memory:', createId, now: nowIso })
  const documents = createSqliteDocumentStore({ engine })
  const promptResources = createPromptResourceStore({ engine })
  const validatePackageAsset = vi.fn(async (input: { path: string }) => { if (input.path !== 'assets/icon.png') throw new Error('Asset file is missing') })
  const runtime = createApplicationRuntime({ dataEngine: engine, documents, promptResources, validatePackageAsset })
  return { engine, documents, promptResources, runtime, validatePackageAsset }
}
function pkg(packageId: string, icon?: PromptResourceDisplayMetadata['icon']): ImportExtensionPackageResourcesInput {
  return { packageId, packageVersion: '1.0.0', promptResources: [{
    contribution: { id: `${packageId}.preset`, resourceKind: 'preset', source: 'preset.json' },
    artifact: { format: 'loom.promptResource', schemaVersion: 2, resourceKind: 'preset', ...(icon ? { metadata: { icon } } : {}), rootNode: { id: `${packageId}.root`, kind: 'module', label: 'Preset' } },
  }], agentTools: [], transformRules: [], textExtractors: [] }
}
const icon = { kind: 'package' as const, packageId: 'example.assets', path: 'assets/icon.png', scope: 'global' as const }
const dependencies = [{ id: 'example.assets', version: '^1.0.0' }]

describe('package icon dependencies', () => {
  it('requires explicit scope, declared compatible dependency, and existing asset', async () => {
    const { engine, runtime, validatePackageAsset } = fixture()
    try {
      await runtime.importExtensionPackageResources(pkg('example.assets'))
      const { scope: _scope, ...ambiguous } = icon
      await expect(runtime.importExtensionPackageResources({ ...pkg('example.ambiguous', ambiguous), dependencies })).rejects.toThrow('explicit scope')
      await expect(runtime.importExtensionPackageResources(pkg('example.undeclared', icon))).rejects.toThrow('not declared')
      await expect(runtime.importExtensionPackageResources({ ...pkg('example.version', icon), dependencies: [{ id: icon.packageId, version: '^2.0.0' }] })).rejects.toThrow('version mismatch')
      await expect(runtime.importExtensionPackageResources({ ...pkg('example.missing', { ...icon, path: 'missing.png' }), dependencies })).rejects.toThrow('Asset file is missing')
      const result = await runtime.importExtensionPackageResources({ ...pkg('example.consumer', icon), dependencies })
      const resource = (await runtime.getPromptResource({ resourceId: result.promptResources[0]!.resourceId })).resource
      expect(resource.metadata?.icon).toEqual({ ...icon, target: { kind: 'global' } })
      expect(validatePackageAsset).toHaveBeenCalledWith({ packageId: icon.packageId, packageVersion: '1.0.0', path: icon.path, target: { kind: 'global' } })
    } finally { await engine.close() }
  })
  it('rejects another Card target and does not fall back to a global asset installation', async () => {
    const { engine, runtime } = fixture()
    try {
      const { card: a } = await runtime.createCard({ name: 'A' })
      const { card: b } = await runtime.createCard({ name: 'B' })
      await runtime.importExtensionPackageResources(pkg('example.assets'))
      await runtime.importExtensionPackageResources({ ...pkg('example.assets'), target: { kind: 'card', cardId: b.id } })
      const consumer = { ...pkg('example.consumer', { ...icon, scope: 'card' }), dependencies, target: { kind: 'card' as const, cardId: a.id } }
      await expect(runtime.importExtensionPackageResources(consumer)).rejects.toThrow('Document not found')
      await expect(runtime.importExtensionPackageResources({ ...pkg('example.inject', { ...icon, scope: 'card', target: { kind: 'card', cardId: b.id } }), dependencies, target: consumer.target })).rejects.toThrow('cannot override')
      await expect(runtime.importExtensionPackageResources({ ...pkg('example.global', { ...icon, scope: 'card' }), dependencies })).rejects.toThrow('Global extension')
    } finally { await engine.close() }
  })
  it('keeps author scopes portable and validates changed icons while preserving no-op behavior', async () => {
    const { engine, runtime, validatePackageAsset, promptResources } = fixture()
    try {
      const { card } = await runtime.createCard({ name: 'Consumer' })
      await runtime.importExtensionPackageResources(pkg('example.assets'))
      const imported = await runtime.importExtensionPackageResources({ ...pkg('example.consumer'), dependencies, target: { kind: 'card', cardId: card.id } })
      const resourceId = imported.promptResources[0]!.resourceId
      const captured = await runtime.captureResourceAuthoring({ resourceId })
      const resource = { ...captured.resource, metadata: { icon } }
      const result = (await runtime.applyResourceAuthoring({ resources: [{ resource, expectedVersion: captured.version, expectedDigest: captured.digest }] })).resources[0]!
      expect(result.resource.metadata?.icon).toEqual(icon)
      expect((await promptResources.getResource(resourceId))?.metadata.icon).toEqual({ ...icon, target: { kind: 'global' } })
      const calls = validatePackageAsset.mock.calls.length
      const noop = await runtime.applyResourceAuthoring({ resources: [{ resource: result.resource, expectedVersion: result.version, expectedDigest: result.digest }] })
      expect(noop.resources[0]!.version).toBe(result.version)
      expect(validatePackageAsset.mock.calls).toHaveLength(calls)
      const copy = await runtime.duplicatePromptResource({ resourceId })
      expect(copy.resource.metadata?.icon).toEqual({ ...icon, target: { kind: 'global' } })
    } finally { await engine.close() }
  })
  it('blocks uninstall and updates that break a Card consumers global icon', async () => {
    const { engine, runtime, documents, validatePackageAsset } = fixture()
    try {
      const { card } = await runtime.createCard({ name: 'Consumer' })
      await runtime.importExtensionPackageResources(pkg('example.assets'))
      await runtime.importExtensionPackageResources({ ...pkg('example.consumer', icon), dependencies, target: { kind: 'card', cardId: card.id } })
      const installation = (await documents.get(extensionInstallationId('example.assets', { kind: 'global' })))!
      await expect(runtime.removeExtensionPackageResources({ packageId: 'example.assets', uninstall: true, expectedInstallationVersion: installation.version })).rejects.toThrow('cannot be uninstalled')
      await expect(runtime.importExtensionPackageResources({ ...pkg('example.assets'), packageVersion: '2.0.0', update: { expectedInstallationVersion: installation.version } })).rejects.toThrow('cannot be updated')
      validatePackageAsset.mockRejectedValueOnce(new Error('Asset removed in update'))
      await expect(runtime.importExtensionPackageResources({ ...pkg('example.assets'), packageVersion: '1.1.0', update: { expectedInstallationVersion: installation.version } })).rejects.toThrow('Asset removed in update')
      expect((await documents.get(installation.id))?.version).toBe(installation.version)
    } finally { await engine.close() }
  })
  it('allows explicit same-package Card to global icons without a self dependency', async () => {
    const { engine, runtime, documents, promptResources } = fixture()
    try {
      const { card } = await runtime.createCard({ name: 'Consumer' })
      await runtime.importExtensionPackageResources(pkg('example.assets'))
      const installed = await runtime.importExtensionPackageResources({ ...pkg('example.assets', icon), target: { kind: 'card', cardId: card.id } })
      expect((await promptResources.getResource(installed.promptResources[0]!.resourceId))?.metadata.icon).toEqual({ ...icon, target: { kind: 'global' } })
      const global = (await documents.get(extensionInstallationId('example.assets', { kind: 'global' })))!
      await expect(runtime.removeExtensionPackageResources({ packageId: 'example.assets', uninstall: true, expectedInstallationVersion: global.version })).rejects.toThrow('cannot be uninstalled')
    } finally { await engine.close() }
  })

  it('allows a personal preset to reference an installed global icon without inventing an extension owner', async () => {
    const { engine, runtime, promptResources } = fixture()
    try {
      await runtime.importExtensionPackageResources(pkg('example.assets'))
      const personal = await runtime.createPromptResource({ name: 'Personal', resourceKind: 'preset' })
      const captured = await runtime.captureResourceAuthoring({ resourceId: personal.resource.id })
      const { scope: _scope, ...globalIcon } = icon
      const updated = (await runtime.applyResourceAuthoring({ resources: [{ resource: { ...captured.resource, metadata: { icon: globalIcon } }, expectedVersion: captured.version, expectedDigest: captured.digest }] })).resources[0]!
      expect((await promptResources.getResource(personal.resource.id))?.metadata).toMatchObject({ icon: { ...globalIcon, target: { kind: 'global' } } })
      expect((await promptResources.getResource(personal.resource.id))?.metadata.origin).toBeUndefined()
      await expect(runtime.applyResourceAuthoring({ resources: [{ resource: { ...updated.resource, metadata: { icon: { ...icon, scope: 'card' } } }, expectedVersion: updated.version, expectedDigest: updated.digest }] })).rejects.toThrow('no Card installation context')
    } finally { await engine.close() }
  })

})
