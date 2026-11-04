import { describe, expect, it } from 'vitest'
import { createApplicationRuntime, createOfficialAgentToolRegistry, type ImportExtensionPackageResourcesInput } from '@loom-studio/application-runtime'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { createPromptResourceStore } from '@loom-studio/application-data'
import { createId, nowIso, type AgentToolReference } from '@loom-studio/shared'
import { extensionInstallationId, installedExtensionContributionId } from '@loom-studio/extension-sdk'

async function fixture() {
  const engine = createSqliteDataEngine({ filename: ':memory:', createId, now: nowIso })
  const documents = createSqliteDocumentStore({ engine })
  const promptResources = createPromptResourceStore({ engine })
  const runtime = createApplicationRuntime({ dataEngine: engine, documents, promptResources, agentTools: createOfficialAgentToolRegistry() })
  await runtime.initialize()
  return { engine, documents, promptResources, runtime }
}
function pkg(packageId: string, reference?: AgentToolReference): ImportExtensionPackageResourcesInput {
  return { packageId, packageVersion: '1.0.0',
    promptResources: [{ contribution: { id: `${packageId}.preset`, resourceKind: 'preset', source: 'preset.json', ...(reference ? { toolMounts: [{ reference, defaultEnabled: true }] } : {}) },
      artifact: { format: 'loom.promptResource', schemaVersion: 2, resourceKind: 'preset', rootNode: { id: `${packageId}.root`, kind: 'module', label: 'Preset' } } }],
    agentTools: [], transformRules: [], textExtractors: [],
  }
}
function provider() {
  const input = pkg('example.provider')
  input.agentTools = [{ contribution: { id: 'example.provider/read', source: 'read.json' }, definition: { name: 'read', description: 'Read', input: { kind: 'structured', schema: { type: 'object' } } } }]
  return input
}
const external = (target: 'global' | 'card' = 'global'): AgentToolReference => ({ kind: 'external', packageId: 'example.provider', contributionId: 'example.provider/read', target })
const deps = [{ id: 'example.provider', version: '^1.0.0' }]

describe('extension Tool references', () => {
  it('resolves host and legacy package references and preserves their portable identity', async () => {
    const { engine, runtime, promptResources } = await fixture()
    try {
      const host = await runtime.importExtensionPackageResources(pkg('example.host', { kind: 'host', toolId: 'official/read_context' }))
      expect((await promptResources.listPresetToolMounts({ presetResourceId: host.promptResources[0]!.resourceId }))[0]).toMatchObject({ toolId: 'official/read_context', origin: { toolReference: { kind: 'host', toolId: 'official/read_context' } } })
      const input = provider()
      input.promptResources[0]!.contribution.toolMounts = [{ toolId: 'example.provider/read' }]
      const local = await runtime.importExtensionPackageResources(input)
      expect((await promptResources.listPresetToolMounts({ presetResourceId: local.promptResources[0]!.resourceId }))[0]).toMatchObject({ toolId: 'example.provider/read', origin: { toolReference: { kind: 'package', contributionId: 'example.provider/read' } } })
      await expect(runtime.importExtensionPackageResources(pkg('example.fake', { kind: 'host', toolId: 'official/pretend' }))).rejects.toThrow('Host Tool is unavailable')
    } finally { await engine.close() }
  })
  it('requires a declared compatible installed dependency and protects consumers on uninstall/update', async () => {
    const { engine, runtime, documents } = await fixture()
    try {
      await expect(runtime.importExtensionPackageResources({ ...pkg('example.missing', external()), dependencies: deps })).rejects.toThrow('Document not found')
      await runtime.importExtensionPackageResources(provider())
      await expect(runtime.importExtensionPackageResources(pkg('example.undeclared', external()))).rejects.toThrow('not declared')
      await expect(runtime.importExtensionPackageResources({ ...pkg('example.version', external()), dependencies: [{ id: 'example.provider', version: '^2.0.0' }] })).rejects.toThrow('version mismatch')
      await runtime.importExtensionPackageResources({ ...pkg('example.consumer', external()), dependencies: deps })
      const installationId = extensionInstallationId('example.provider', { kind: 'global' })
      const version = (await documents.get(installationId))!.version
      await expect(runtime.uninstallExtensionInstallation({ packageId: 'example.provider', expectedInstallationVersion: version })).rejects.toThrow('cannot be uninstalled')
      await expect(runtime.importExtensionPackageResources({ ...provider(), packageVersion: '2.0.0', update: { expectedInstallationVersion: version } })).rejects.toThrow('cannot be updated')
      expect((await documents.get(installationId))?.version).toBe(version)
    } finally { await engine.close() }
  })
  it('resolves card references only within the current card and never falls back to global', async () => {
    const { engine, runtime, promptResources, documents } = await fixture()
    try {
      const { card: a } = await runtime.createCard({ name: 'A' })
      const { card: b } = await runtime.createCard({ name: 'B' })
      await runtime.importExtensionPackageResources(provider())
      await runtime.importExtensionPackageResources({ ...provider(), target: { kind: 'card', cardId: b.id } })
      const consumer = { ...pkg('example.card-consumer', external('card')), dependencies: deps, target: { kind: 'card' as const, cardId: a.id } }
      await expect(runtime.importExtensionPackageResources(consumer)).rejects.toThrow('Document not found')
      await runtime.importExtensionPackageResources({ ...provider(), target: { kind: 'card', cardId: a.id } })
      const result = await runtime.importExtensionPackageResources(consumer)
      expect((await promptResources.listPresetToolMounts({ presetResourceId: result.promptResources[0]!.resourceId }))[0]?.toolId).toBe(installedExtensionContributionId('example.provider', consumer.target, 'example.provider/read'))
      const installation = await documents.get(extensionInstallationId('example.provider', consumer.target))
      await expect(runtime.uninstallExtensionInstallation({ packageId: 'example.provider', target: consumer.target, expectedInstallationVersion: installation!.version })).rejects.toThrow('cannot be uninstalled')
      await expect(runtime.importExtensionPackageResources({ ...pkg('example.global-consumer', external('card')), dependencies: deps })).rejects.toThrow('requires the current Card')
    } finally { await engine.close() }
  })
  it('protects a global provider used from a Card without blocking an unrelated Card provider', async () => {
    const { engine, runtime, documents } = await fixture()
    try {
      const { card: a } = await runtime.createCard({ name: 'A' })
      const { card: b } = await runtime.createCard({ name: 'B' })
      await runtime.importExtensionPackageResources(provider())
      await runtime.importExtensionPackageResources({ ...provider(), target: { kind: 'card', cardId: b.id } })
      await runtime.importExtensionPackageResources({ ...pkg('example.card-global', external()), dependencies: deps, target: { kind: 'card', cardId: a.id } })
      const global = await documents.get(extensionInstallationId('example.provider', { kind: 'global' }))
      await expect(runtime.uninstallExtensionInstallation({ packageId: 'example.provider', expectedInstallationVersion: global!.version })).rejects.toThrow('cannot be uninstalled')
      const separate = await documents.get(extensionInstallationId('example.provider', { kind: 'card', cardId: b.id }))
      await runtime.uninstallExtensionInstallation({ packageId: 'example.provider', target: { kind: 'card', cardId: b.id }, expectedInstallationVersion: separate!.version })
      expect(await documents.get(separate!.id)).toBeNull()
    } finally { await engine.close() }
  })

  it('checks explicit Framework dependencies without tool mounts and protects their global installation', async () => {
    const { engine, runtime, documents } = await fixture()
    try {
      const { card } = await runtime.createCard({ name: 'Framework consumer' })
      const consumer = { ...pkg('example.framework-consumer'), target: { kind: 'card' as const, cardId: card.id },
        dependencies: [{ id: 'example.provider', version: '^1.0.0', target: 'global' as const }] }
      await expect(runtime.importExtensionPackageResources(consumer)).rejects.toThrow('Document not found')
      await runtime.importExtensionPackageResources(provider())
      await runtime.importExtensionPackageResources(consumer)
      await expect(runtime.checkExtensionDependencyConsumers({ packageId: 'example.provider' })).rejects.toThrow('cannot be uninstalled')
      await expect(runtime.checkExtensionDependencyConsumers({ packageId: 'example.provider', nextVersion: '2.0.0' })).rejects.toThrow('cannot be updated')
      await expect(runtime.checkExtensionDependencyConsumers({ packageId: 'example.provider', nextVersion: '1.1.0' })).resolves.toBeUndefined()
      const global = await documents.get(extensionInstallationId('example.provider', { kind: 'global' }))
      await expect(runtime.uninstallExtensionInstallation({ packageId: 'example.provider', expectedInstallationVersion: global!.version })).rejects.toThrow('cannot be uninstalled')
      await expect(runtime.importExtensionPackageResources({ ...pkg('example.wrong-scope', external('card')), target: consumer.target, dependencies: consumer.dependencies })).rejects.toThrow('target mismatch')
      await expect(runtime.importExtensionPackageResources({ ...pkg('example.global'), dependencies: [{ id: 'example.provider', version: '^1.0.0', target: 'card' }] })).rejects.toThrow('Global extension cannot depend')
    } finally { await engine.close() }
  })

  it('keeps Card Framework references portable and prevents removing their default Preset', async () => {
    const { engine, runtime, documents } = await fixture()
    try {
      const artifact = { schemaVersion: 4 as const, artifactId: 'framework-card', displayName: 'Framework Card',
        card: { name: 'Framework Card', extensionDependencies: [{ id: 'example.provider', version: '^1.0.0', target: 'global' as const }],
          defaultPreset: { packageId: 'example.provider', contributionId: 'example.provider.preset', target: 'global' as const } }, contextAssets: [] }
      await expect(runtime.importCardBundle({ artifact })).rejects.toThrow('Document not found')
      expect((await runtime.listCards({})).cards).toHaveLength(0)
      const installed = await runtime.importExtensionPackageResources(provider())
      expect(await runtime.validateCardFramework({ card: artifact.card })).toEqual({ presetId: installed.promptResources[0]!.resourceId })
      const imported = await runtime.importCardBundle({ artifact })
      expect(imported.card.defaultPreset).toEqual(artifact.card.defaultPreset)
      const exported = await runtime.exportCardBundle({ cardId: imported.card.id })
      expect(exported.artifact.card.extensionDependencies).toEqual(artifact.card.extensionDependencies)
      expect(exported.artifact.contextAssets).toHaveLength(0)
      await expect(runtime.checkExtensionDependencyConsumers({ packageId: 'example.provider' })).rejects.toThrow('Framework Card')
      const version = (await documents.get(extensionInstallationId('example.provider', { kind: 'global' })))!.version
      await expect(runtime.importExtensionPackageResources({ ...provider(), promptResources: [], update: { expectedInstallationVersion: version } })).rejects.toThrow('contribution cannot be removed')
      await expect(runtime.removeExtensionPackageResources({ packageId: 'example.provider' })).rejects.toThrow('resources cannot be removed')
      await runtime.deleteCard({ cardId: imported.card.id })
      await expect(runtime.checkExtensionDependencyConsumers({ packageId: 'example.provider' })).resolves.toBeUndefined()
    } finally { await engine.close() }
  })

})
