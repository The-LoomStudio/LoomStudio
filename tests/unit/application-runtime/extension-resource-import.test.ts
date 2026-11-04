import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createBlobStore } from '@loom-studio/asset-store'
import {
  createApplicationRuntime, createOfficialAgentToolRegistry, composeAgentTurnPrompt,
  officialReadPromptResourceTool, officialSearchPromptResourcesTool,
  type ImportExtensionPackageResourcesInput,
} from '@loom-studio/application-runtime'
import { createAgentStore, createNarrativeStore, createPromptResourceStore } from '@loom-studio/application-data'
import { officialFakeModelId } from '@loom-studio/ai-gateway'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { createId, nowIso } from '@loom-studio/shared'
import { resolveEffectiveTextPipeline } from '../../../packages/application-runtime/src/runtime/transforms-runtime.js'
import { readAvailableExtensionInstallations } from '../../../packages/application-runtime/src/runtime/extension-resource-access.js'
import { isPromptResourceArtifact } from '../../../packages/application-runtime/src/cards/card-bundle-codec.js'

function fixture() {
  const engine = createSqliteDataEngine({ filename: ':memory:', createId, now: nowIso })
  const documents = createSqliteDocumentStore({ engine })
  const promptResources = createPromptResourceStore({ engine })
  const agents = createAgentStore({ engine })
  const narratives = createNarrativeStore({ engine })
  const rootDirectory = mkdtempSync(join(tmpdir(), 'loom-extension-resource-import-'))
  const blobs = createBlobStore({ engine, rootDirectory, createId, now: nowIso })
  onTestFinished(() => rmSync(rootDirectory, { recursive: true, force: true }))
  const requests: unknown[] = []
  const runtime = createApplicationRuntime({
    dataEngine: engine, documents, promptResources, blobs,
    agents, narratives,
    gateway: { invokeChat: async ({ request }) => {
      requests.push(request.messages)
      return { provider: 'test', model: 'test', text: 'Done', message: { role: 'assistant', content: 'Done' } }
    } },
  })
  const input: ImportExtensionPackageResourcesInput = {
    packageId: 'example.writer', packageVersion: '1.0.0',
    promptResources: [{
      contribution: { id: 'example.writer.preset', resourceKind: 'preset', source: 'writer.json' },
      artifact: {
        format: 'loom.promptResource', schemaVersion: 2, resourceKind: 'preset',
        rootNode: { id: 'example.writer.root', kind: 'module', label: 'Writer' },
        macros: { tone: 'gentle' },
        macroOptions: { tone: [{ id: 'direct', label: 'Direct', value: 'direct' }] },
      },
    }],
    agentTools: [], transformRules: [], textExtractors: [],
  }
  return { engine, documents, promptResources, agents, narratives, blobs, runtime, input, requests }
}

describe('Extension prompt resource import', () => {
  it('resolves tool Lore references within each installation without adopting or duplicating Lore', async () => {
    const { engine, runtime, input } = fixture()
    try {
      input.promptResources = [{ contribution: { id: 'manual', resourceKind: 'lore', source: 'manual.json' },
        artifact: { format: 'loom.promptResource', schemaVersion: 2, resourceKind: 'lore',
          rootNode: { id: 'example.writer.manual', kind: 'module', label: 'Manual' } } }]
      input.agentTools = [{ contribution: { id: 'example.writer/read', source: 'read.json' },
        definition: { name: 'Read', description: 'Read data', input: { kind: 'structured', schema: { type: 'object' } },
          prompt: { loreRefs: [{ resourceId: 'manual', nodeId: 'example.writer.manual' }] } } }]
      for (const target of [{ kind: 'global' as const }, { kind: 'card' as const, cardId: (await runtime.createCard({ name: 'Copy' })).card.id }]) {
        const installed = await runtime.importExtensionPackageResources({ ...input, target })
        const resource = (await runtime.getPromptResource({ resourceId: installed.promptResources[0]!.resourceId })).resource
        const tool = (await runtime.listAgentTools()).tools.find(tool => tool.id === installed.agentTools[0]!.toolId)!
        expect(tool.prompt?.loreRefs).toEqual([{ resourceId: resource.id, nodeId: resource.rootNode.id }])
      }
    } finally { await engine.close() }
  })

  it('binds a preset icon to its owning package and keeps it after duplication and update', async () => {
    const { engine, runtime, input } = fixture()
    try {
      const icon = { kind: 'package' as const, packageId: input.packageId, path: 'assets/nom.png' }
      const artifact = input.promptResources[0]!.artifact
      if (!isPromptResourceArtifact(artifact)) throw new Error('Invalid fixture artifact')
      artifact.metadata = { icon }
      const result = await runtime.importExtensionPackageResources(input)
      const resourceId = result.promptResources[0]!.resourceId
      const expected = { icon: { ...icon, target: { kind: 'global' } } }
      expect((await runtime.getPromptResource({ resourceId })).resource.metadata).toEqual(expected)
      artifact.metadata = { icon: { ...icon, path: 'assets/nom-updated.png' } }
      const installation = (await runtime.listExtensionInstallations()).installations.find(item => item.id === result.installationId)!
      await runtime.importExtensionPackageResources({ ...input, update: { expectedInstallationVersion: installation.version } })
      const updated = { icon: { ...expected.icon, path: 'assets/nom-updated.png' } }
      expect((await runtime.getPromptResource({ resourceId })).resource.metadata).toEqual(updated)
      expect((await runtime.duplicatePromptResource({ resourceId })).resource.metadata).toEqual(updated)
    } finally { await engine.close() }
  })

  it('keeps missing external Setting mounts through edits and resource export without blocking Preview', async () => {
    const f = fixture()
    const { engine, runtime, input, promptResources } = f
    try {
      input.promptResources.push({
        contribution: { id: 'local-setting', resourceKind: 'lore', source: 'setting.json' },
        artifact: {
          format: 'loom.promptResource', schemaVersion: 2, resourceKind: 'lore',
          rootNode: { id: 'example.writer.local-lore-root', kind: 'module', label: 'Local' },
        },
      })
      input.promptResources[0]!.contribution.loreMounts = [
        { resourceId: 'local-setting' },
        { reference: { kind: 'external', resourceId: 'missing-elsewhere' } },
      ]
      const installed = await runtime.importExtensionPackageResources(input)
      const presetId = installed.promptResources[0]!.resourceId
      const localId = installed.promptResources[1]!.resourceId
      const source = { kind: 'preset' as const, id: presetId }
      const mounts = (await runtime.listLoreMounts({ source })).mounts
      expect(mounts).toMatchObject([
        { loreResourceId: localId, resolvedLoreResourceId: localId, reference: { kind: 'package', contributionId: 'local-setting' } },
        { loreResourceId: 'missing-elsewhere', resolvedLoreResourceId: null, reference: { kind: 'external', resourceId: 'missing-elsewhere' } },
      ])
      expect(await promptResources.getResource('missing-elsewhere')).toBeNull()
      expect(await engine.read(database => database.prepare('PRAGMA foreign_key_check').all())).toEqual([])
      const extra = await runtime.createPromptResource({ resourceKind: 'lore', name: 'Extra' })
      await runtime.replaceLoreMounts({ expectedMountIds: (await runtime.listLoreMounts({ source: source })).mounts.map(mount => mount.id),
        source, mounts: [{ id: mounts[0]!.id }, { id: mounts[1]!.id }, { loreResourceId: extra.resource.id }],
      })
      expect((await runtime.listLoreMounts({ source })).mounts.map(mount => mount.resolvedLoreResourceId ?? mount.loreResourceId))
        .toEqual([localId, 'missing-elsewhere', extra.resource.id])
      const { providerProfile } = await runtime.createProviderProfile({
        providerExtensionId: 'official.fake', displayName: 'Fake', config: {}, enabledModelIds: [officialFakeModelId],
      })
      const preset = (await runtime.getAgentPreset({ agentPresetId: presetId })).agentPreset
      await runtime.updateAgentPreset({
        agentPresetId: presetId, expectedVersion: preset.version,
        model: { providerProfileId: providerProfile.id, modelId: officialFakeModelId },
      })
      const { session } = await runtime.createAgentSession({ agentPresetId: presetId })
      const preview = await runtime.previewAgentTurn({ agentSessionId: session.id, input: 'Hi' })
      expect(preview.promptBuildTrace.diagnostics).toContainEqual(expect.objectContaining({
        code: 'prompt.lore_reference_unresolved', message: expect.stringContaining('missing-elsewhere'),
      }))
      const exported = await runtime.exportPromptResource({ resourceId: presetId })
      expect(exported.artifact.loreMounts).toEqual([
        { kind: 'package', contributionId: 'local-setting' },
        { kind: 'external', resourceId: 'missing-elsewhere' },
        { kind: 'external', resourceId: extra.resource.id },
      ])
      const copied = await runtime.importPromptResource({ artifact: exported.artifact })
      expect((await runtime.listLoreMounts({ source: { kind: 'preset', id: copied.resource.id } })).mounts)
        .toMatchObject([
          { loreResourceId: 'local-setting', resolvedLoreResourceId: null },
          { loreResourceId: 'missing-elsewhere', resolvedLoreResourceId: null },
          { loreResourceId: extra.resource.id, resolvedLoreResourceId: null },
        ])
      await runtime.deletePromptResource({ resourceId: extra.resource.id })
      const beforeEdit = (await runtime.listLoreMounts({ source })).mounts
      await runtime.replaceLoreMounts({ expectedMountIds: (await runtime.listLoreMounts({ source: source })).mounts.map(mount => mount.id), source, mounts: beforeEdit.map(mount => ({ id: mount.id })) })
      expect((await runtime.listLoreMounts({ source })).mounts[2]).toMatchObject({
        loreResourceId: extra.resource.id, resolvedLoreResourceId: null,
        reference: { kind: 'external', resourceId: extra.resource.id },
      })
    } finally { await engine.close() }
  })

  it('resolves an external Card contribution only within the current installation target', async () => {
    const f = fixture()
    const { engine, runtime, input } = f
    try {
      const { card: a } = await runtime.createCard({ name: 'A' })
      const { card: b } = await runtime.createCard({ name: 'B' })
      input.transformRules = [{
        contribution: { id: 'same-name', source: 'same-name.json' },
        artifact: {
          name: 'Same name', enabled: false, orderIndex: 0, targets: ['agent-session'], phases: ['display'],
          matcher: { kind: 'regex', pattern: 'old', flags: 'g' }, effect: { kind: 'replace', replacement: 'new' },
        },
      }]
      const targetB = { kind: 'card' as const, cardId: b.id }
      const installedB = await runtime.importExtensionPackageResources({ ...input, target: targetB })
      input.promptResources[0]!.contribution.textUses = [{
        kind: 'rule', enabled: true,
        reference: {
          kind: 'external', resourceId: installedB.transformRules[0]!.ruleId,
          origin: { packageId: 'example.writer', contributionId: 'same-name', target: 'card' },
        },
      }]
      const targetA = { kind: 'card' as const, cardId: a.id }
      const installedA = await runtime.importExtensionPackageResources({ ...input, target: targetA })
      const presetId = installedA.promptResources[0]!.resourceId
      expect((await runtime.getAgentPreset({ agentPresetId: presetId })).agentPreset.textUses?.[0]?.id)
        .toBe(installedA.transformRules[0]!.ruleId)
      const { timeline } = await runtime.createNarrativeTimeline({ cardId: a.id })
      const { session } = await runtime.createAgentSession({ agentPresetId: presetId, timelineId: timeline.id })
      const pipeline = await resolveEffectiveTextPipeline({ ...f, now: nowIso }, { kind: 'agent-session', sessionId: session.id }, 'display')
      expect(pipeline.rules.map(rule => rule.id)).toEqual([installedA.transformRules[0]!.ruleId])
      expect(pipeline.rules.map(rule => rule.id)).not.toContain(installedB.transformRules[0]!.ruleId)
      const preset = (await runtime.getAgentPreset({ agentPresetId: presetId })).agentPreset
      await runtime.updateAgentPreset({
        agentPresetId: presetId, expectedVersion: preset.version,
        textUses: [{ kind: 'rule', id: installedB.transformRules[0]!.ruleId, enabled: true }],
      })
      const foreign = await resolveEffectiveTextPipeline({ ...f, now: nowIso }, { kind: 'agent-session', sessionId: session.id }, 'display')
      expect(foreign.rules.map(rule => rule.id)).not.toContain(installedB.transformRules[0]!.ruleId)
      expect(foreign.diagnostics).toContainEqual(expect.objectContaining({ code: 'text.use_unresolved', ruleId: installedB.transformRules[0]!.ruleId }))
    } finally { await engine.close() }
  })

  it('maps package Text uses and preserves unresolved external references', async () => {
    const f = fixture()
    const { engine, runtime, input } = f
    try {
      input.transformRules = [{
        contribution: { id: 'replace', source: 'replace.json' },
        artifact: {
          name: 'Replace', enabled: false, orderIndex: 0, targets: ['agent-session'], phases: ['display'],
          matcher: { kind: 'regex', pattern: 'old', flags: 'g' }, effect: { kind: 'replace', replacement: 'new' },
        },
      }]
      input.promptResources[0]!.contribution.textUses = [
        { kind: 'rule', reference: { kind: 'package', contributionId: 'replace' }, enabled: false },
        { kind: 'extractor', reference: { kind: 'external', resourceId: 'other-device-user-resource' }, enabled: true },
      ]
      const installed = await runtime.importExtensionPackageResources(input)
      const presetId = installed.promptResources[0]!.resourceId
      const preset = (await runtime.getAgentPreset({ agentPresetId: presetId })).agentPreset
      expect(preset.textUses).toEqual([
        { kind: 'rule', id: installed.transformRules[0]!.ruleId, reference: { kind: 'package', contributionId: 'replace' }, enabled: false },
        { kind: 'extractor', id: 'other-device-user-resource', reference: { kind: 'external', resourceId: 'other-device-user-resource' }, enabled: true },
      ])
      const edited = (await runtime.updateAgentPreset({
        agentPresetId: presetId, expectedVersion: preset.version,
        textUses: preset.textUses!.map(({ kind, id, enabled, orderIndex }) => ({ kind, id, enabled: !enabled, ...(orderIndex === undefined ? {} : { orderIndex }) })),
      })).agentPreset
      expect(edited.textUses?.map(use => use.reference)).toEqual(preset.textUses?.map(use => use.reference))
      await expect(runtime.updateAgentPreset({
        agentPresetId: presetId, expectedVersion: edited.version,
        textUses: [{ kind: 'extractor', id: 'other-device-user-resource', enabled: true,
          reference: { kind: 'package', contributionId: 'replace' } } as never],
      })).rejects.toThrow('Invalid Preset text use configuration')
      const { session } = await runtime.createAgentSession({ agentPresetId: presetId })
      const pipeline = await resolveEffectiveTextPipeline({ ...f, now: nowIso }, { kind: 'agent-session', sessionId: session.id }, 'display')
      expect(pipeline.rules.map(rule => rule.id)).toEqual([installed.transformRules[0]!.ruleId])
      expect(pipeline.diagnostics).toContainEqual(expect.objectContaining({ code: 'text.use_unresolved', message: expect.stringContaining('other-device-user-resource') }))
      const exported = await runtime.exportPromptResource({ resourceId: presetId })
      const copied = await runtime.importPromptResource({ artifact: exported.artifact })
      expect(copied.resource.textUses).toEqual(edited.textUses)
      const copiedSession = await runtime.createAgentSession({ agentPresetId: copied.resource.id })
      const copiedPipeline = await resolveEffectiveTextPipeline({ ...f, now: nowIso }, { kind: 'agent-session', sessionId: copiedSession.session.id }, 'display')
      expect(copiedPipeline.rules).toEqual([])
      expect(copiedPipeline.diagnostics).toContainEqual(expect.objectContaining({ code: 'text.use_unresolved', message: expect.stringContaining(installed.transformRules[0]!.ruleId) }))
      expect(copiedPipeline.diagnostics).toContainEqual(expect.objectContaining({ code: 'text.use_unresolved', message: expect.stringContaining('other-device-user-resource') }))
    } finally { await engine.close() }
  })

  it('updates one installation atomically while preserving resource identity and local model binding', async () => {
    const { engine, runtime, input, promptResources } = fixture()
    try {
      input.promptResources.push({
        contribution: { id: 'example.writer.old', resourceKind: 'lore', source: 'old.json' },
        artifact: {
          format: 'loom.promptResource', schemaVersion: 2, resourceKind: 'lore',
          rootNode: { id: 'example.writer.old.root', kind: 'module', label: 'Old setting' },
        },
      })
      const { card } = await runtime.createCard({ name: 'Private' })
      const privateInstall = await runtime.importExtensionPackageResources({ ...input, target: { kind: 'card', cardId: card.id } })
      const installed = await runtime.importExtensionPackageResources(input)
      const id = installed.promptResources[0]!.resourceId
      const original = (await runtime.getAgentPreset({ agentPresetId: id })).agentPreset
      const { providerProfile } = await runtime.createProviderProfile({
        providerExtensionId: 'official.fake', displayName: 'Test', config: {}, enabledModelIds: [officialFakeModelId],
      })
      const localModel = { providerProfileId: providerProfile.id, modelId: officialFakeModelId }
      await runtime.updateAgentPreset({
        agentPresetId: id, expectedVersion: original.version, model: localModel,
      })
      const before = (await runtime.getPromptResource({ resourceId: id })).resource
      const installation = (await runtime.listExtensionInstallations()).installations.find(item => item.id === installed.installationId)!
      const replacement = structuredClone(input)
      replacement.packageVersion = '2.0.0'
      replacement.promptResources = [replacement.promptResources[0]!]
      const artifact = replacement.promptResources[0]!.artifact
      if (!isPromptResourceArtifact(artifact)) throw new Error('Invalid fixture artifact')
      artifact.rootNode = {
        id: 'example.writer.new.root', kind: 'module', label: 'New author version',
        children: [{ id: 'example.writer.new.entry', kind: 'entry', label: 'New', body: 'Updated prompt' }],
      }
      delete artifact.macros
      delete artifact.macroOptions
      replacement.promptResources[0]!.artifact = artifact
      await expect(runtime.importExtensionPackageResources(replacement)).rejects.toThrow('explicit migration')
      expect((await runtime.getPromptResource({ resourceId: id })).resource).toEqual(before)

      const updated = await runtime.importExtensionPackageResources({
        ...replacement, update: { expectedInstallationVersion: installation.version },
      })
      expect(updated.promptResources[0]!.resourceId).toBe(id)
      const current = (await runtime.getAgentPreset({ agentPresetId: id })).agentPreset
      expect(current).toMatchObject({ model: localModel, macros: {}, macroOptions: {}, origin: { packageVersion: '2.0.0' } })
      expect((await runtime.getPromptResource({ resourceId: id })).resource.rootNode.label).toBe('New author version')
      expect(await promptResources.getResource(installed.promptResources[1]!.resourceId)).toBeNull()
      expect((await runtime.getPromptResource({ resourceId: privateInstall.promptResources[1]!.resourceId })).resource.rootNode.label).toBe('Old setting')
      await expect(runtime.importExtensionPackageResources({
        ...replacement, update: { expectedInstallationVersion: installation.version },
      })).rejects.toThrow('changed before update')

      const currentInstallation = (await runtime.listExtensionInstallations()).installations.find(item => item.id === installed.installationId)!
      const broken = structuredClone(replacement)
      broken.packageVersion = '3.0.0'
      const brokenArtifact = broken.promptResources[0]!.artifact
      if (!isPromptResourceArtifact(brokenArtifact)) throw new Error('Invalid fixture artifact')
      brokenArtifact.rootNode.kind = 'entry'
      broken.promptResources[0]!.artifact = brokenArtifact
      await expect(runtime.importExtensionPackageResources({
        ...broken, update: { expectedInstallationVersion: currentInstallation.version },
      })).rejects.toThrow()
      expect((await runtime.listExtensionInstallations()).installations.find(item => item.id === installed.installationId)).toEqual(currentInstallation)
      expect((await runtime.getAgentPreset({ agentPresetId: id })).agentPreset).toEqual(current)
    } finally {
      await engine.close()
    }
  })

  it('rejects another Cards enabled tool mount before looking up or executing its handler', async () => {
    const { engine, runtime, input, requests } = fixture()
    try {
      const { card: a } = await runtime.createCard({ name: 'A' })
      const { card: b } = await runtime.createCard({ name: 'B' })
      input.agentTools = [{
        contribution: { id: 'example.writer/read', source: 'read.json' },
        definition: { name: 'read', description: 'Read', input: { kind: 'structured', schema: { type: 'object' } } },
      }]
      const installed = await runtime.importExtensionPackageResources({
        ...input, target: { kind: 'card', cardId: b.id },
      })
      const toolId = installed.agentTools[0]!.toolId
      const { providerProfile } = await runtime.createProviderProfile({
        providerExtensionId: 'official.fake', displayName: 'Test', config: {}, enabledModelIds: [officialFakeModelId],
      })
      const { agentPreset } = await runtime.createAgentPreset({
        name: 'Public', model: { providerProfileId: providerProfile.id, modelId: officialFakeModelId },
      })
      await runtime.replacePresetToolMounts({ expectedMountIds: (await runtime.listPresetToolMounts({ presetId: agentPreset.id })).mounts.map(mount => mount.id),
        presetId: agentPreset.id, mounts: [{ toolId, orderIndex: 0, defaultEnabled: true }],
      })
      const timeline = await runtime.createNarrativeTimeline({ cardId: a.id, openingContent: '' })
      for (const timelineId of [timeline.timeline.id, undefined]) {
        const { session } = await runtime.createAgentSession({ agentPresetId: agentPreset.id, timelineId })
        await expect(runtime.previewAgentTurn({ agentSessionId: session.id, input: 'Continue' }))
          .rejects.toThrow(`Agent Tool is not available in this context: ${toolId}`)
        await expect(runtime.invokeAgentTurn({ agentSessionId: session.id, input: 'Continue' }))
          .rejects.toThrow(`Agent Tool is not available in this context: ${toolId}`)
        expect((await runtime.getAgentTranscriptPage({ agentSessionId: session.id })).entries).toEqual([])
      }
      expect(requests).toEqual([])
    } finally {
      await engine.close()
    }
  })

  it('keeps other Cards Settings out of prompt messages and the CodeAct VFS despite explicit mounts', async () => {
    const { engine, runtime, input, documents, promptResources } = fixture()
    try {
      const { agentPreset: preset } = await runtime.createAgentPreset({ name: 'Public Agent' })
      const { card: a } = await runtime.createCard({ name: 'A' })
      const { card: b } = await runtime.createCard({ name: 'B' })
      const ids: string[] = []
      for (const card of [a, b]) {
        input.promptResources = [{
          contribution: { id: 'example.writer.setting', resourceKind: 'lore', source: 'setting.json' },
          artifact: {
            format: 'loom.promptResource', schemaVersion: 2, resourceKind: 'lore',
            rootNode: { id: 'example.writer.setting.root', kind: 'module', category: 'lore', label: 'Private', children: [{
              id: 'example.writer.setting.body', kind: 'entry', label: card.name,
              body: `PRIVATE_${card.name}`, capabilities: { targetAnchorId: '@chat.system' },
            }] },
          },
        }]
        const installed = await runtime.importExtensionPackageResources({
          ...input, target: { kind: 'card', cardId: card.id },
        })
        ids.push(installed.promptResources[0]!.resourceId)
      }
      await runtime.replaceLoreMounts({ expectedMountIds: (await runtime.listLoreMounts({ source: { kind: 'manual', id: 'global' } })).mounts.map(mount => mount.id), source: { kind: 'manual', id: 'global' }, loreResourceIds: ids })
      await runtime.updateCardPromptResources({ expectedVersion: (await runtime.getCard({ cardId: a.id })).card.version, cardId: a.id, promptResourceIds: [ids[0]!] })
      await runtime.replaceLoreMounts({ expectedMountIds: (await runtime.listLoreMounts({ source: { kind: 'preset', id: preset.id } })).mounts.map(mount => mount.id), source: { kind: 'preset', id: preset.id }, loreResourceIds: [ids[0]!] })
      const bindings = await runtime.getPromptResourceBindings({ resourceId: ids[0]! })
      expect(bindings.cards).toEqual([{ id: a.id, name: 'A' }])
      expect(bindings.loreMounts.map(mount => mount.source)).toEqual(expect.arrayContaining([
        { kind: 'manual', id: 'global' }, { kind: 'preset', id: preset.id },
      ]))
      expect((await runtime.getPromptResourceBindings({ resourceId: ids[1]! })).cards).toEqual([])
      for (const card of [a, b, undefined]) {
        const result = await composeAgentTurnPrompt({
          promptResources, preset, contextResourceIds: ids, agentMessages: [], userInput: 'Continue',
          availableExtensionInstallations: await readAvailableExtensionInstallations(documents, card?.id),
        })
        const messages = JSON.stringify(result.messages)
        expect(messages.includes('PRIVATE_A')).toBe(card?.id === a.id)
        expect(messages.includes('PRIVATE_B')).toBe(card?.id === b.id)
        expect(result.toolExecutionScope.vfsResourceIds).toEqual([
          preset.id, ...(card ? [ids[card.id === a.id ? 0 : 1]] : []),
        ])
        const unavailable = result.promptBuildTrace.diagnostics
          .flatMap(item => typeof item === 'object' && item !== null && 'code' in item
            && item.code === 'prompt.resource_unavailable' && 'resourceId' in item ? [item.resourceId] : [])
        expect(unavailable.sort()).toEqual(ids.filter((_, index) => card?.id !== [a.id, b.id][index]).sort())
      }
    } finally {
      await engine.close()
    }
  })

  it('selects only global and owning-Card rules for both Narrative and Session consumption', async () => {
    const f = fixture()
    const { engine, runtime, input } = f
    try {
      const { card: a } = await runtime.createCard({ name: 'A' })
      const { card: b } = await runtime.createCard({ name: 'B' })
      input.transformRules = [{
        contribution: { id: 'replace', source: 'replace.json' },
        artifact: {
          name: 'Replace', enabled: true, orderIndex: 0, targets: ['narrative', 'agent-session'], phases: ['prompt'],
          matcher: { kind: 'regex', pattern: 'old', flags: 'g' }, effect: { kind: 'replace', replacement: 'new' },
        },
      }]
      input.textExtractors = [{
        contribution: { id: 'state', source: 'state.json' },
        artifact: {
          name: 'State', enabled: true, orderIndex: 0, targets: ['narrative', 'agent-session'],
          matcher: { kind: 'regex', pattern: '<state>([\\s\\S]*?)</state>', flags: 'g', contentGroup: 1 },
          strategy: 'latest-valid', parser: 'key-value-lines',
        },
      }]
      const global = await runtime.importExtensionPackageResources(input)
      const installedA = await runtime.importExtensionPackageResources({ ...input, target: { kind: 'card', cardId: a.id } })
      const installedB = await runtime.importExtensionPackageResources({ ...input, target: { kind: 'card', cardId: b.id } })
      const presetId = global.promptResources[0]!.resourceId
      const ctx = { ...f, now: nowIso }
      for (const [card, own] of [[a, installedA], [b, installedB]] as const) {
        const timeline = await runtime.createNarrativeTimeline({ cardId: card.id, openingContent: '' })
        const { session } = await runtime.createAgentSession({ agentPresetId: presetId, timelineId: timeline.timeline.id })
        for (const source of [
          { kind: 'agent-session' as const, sessionId: session.id },
          { kind: 'narrative' as const, timelineId: timeline.timeline.id, branchId: timeline.branch.id },
        ]) {
          const pipeline = await resolveEffectiveTextPipeline(
            ctx, source, 'prompt', source.kind === 'narrative' ? session.id : undefined,
          )
          expect(pipeline.rules.map(rule => rule.id).sort())
            .toEqual([global.transformRules[0]!.ruleId, own.transformRules[0]!.ruleId].sort())
          expect(pipeline.extractors.map(extractor => extractor.id).sort())
            .toEqual([global.textExtractors[0]!.extractorId, own.textExtractors[0]!.extractorId].sort())
        }
      }
      const { session } = await runtime.createAgentSession({ agentPresetId: presetId })
      const pipeline = await resolveEffectiveTextPipeline(ctx, { kind: 'agent-session', sessionId: session.id }, 'prompt')
      expect(pipeline.rules.map(rule => rule.id)).toEqual([global.transformRules[0]!.ruleId])
      expect(pipeline.extractors.map(extractor => extractor.id)).toEqual([global.textExtractors[0]!.extractorId])
    } finally {
      await engine.close()
    }
  })

  it('filters private resources from tool search and rejects exact-ID reads outside their installation', async () => {
    const { engine, runtime, input, promptResources } = fixture()
    try {
      const { resource: publicResource } = await runtime.createPromptResource({ resourceKind: 'lore', name: 'Public' })
      const { card } = await runtime.createCard({ name: 'Private' })
      input.promptResources = [{
        contribution: { id: 'example.writer.setting', resourceKind: 'lore', source: 'setting.json' },
        artifact: {
          format: 'loom.promptResource', schemaVersion: 2, resourceKind: 'lore',
          rootNode: { id: 'example.writer.private.root', kind: 'module', label: 'Private', children: [
            { id: 'example.writer.private.body', kind: 'entry', label: 'Secret', body: 'PRIVATE_CONTENT' },
          ] },
        },
      }]
      const installed = await runtime.importExtensionPackageResources({
        ...input, target: { kind: 'card', cardId: card.id },
      })
      const privateId = installed.promptResources[0]!.resourceId
      const registry = createOfficialAgentToolRegistry()
      const signal = new AbortController().signal
      const scope = {
        context: [], workspaceResourceAccess: true, promptResources,
        availableExtensionInstallations: new Map<string, string>(),
      }
      const search = await registry.execute({
        id: 'search', toolId: officialSearchPromptResourcesTool.id,
        arguments: { resourceKind: 'lore', limit: 1 }, transport: 'native-function',
      }, signal, scope)
      expect(search).toMatchObject({
        status: 'completed', content: [{ type: 'json', value: { resources: [{ id: publicResource.id }] } }],
      })
      expect(JSON.stringify(search)).not.toContain(privateId)
      const read = {
        id: 'read', toolId: officialReadPromptResourceTool.id,
        arguments: { resourceId: privateId }, transport: 'native-function' as const,
      }
      const denied = await registry.execute(read, signal, scope)
      expect(denied).toMatchObject({ status: 'failed' })
      expect(JSON.stringify(denied)).not.toContain('PRIVATE_CONTENT')
      const allowed = await registry.execute(read, signal, {
        ...scope, availableExtensionInstallations: new Map([[installed.installationId, input.packageId]]),
      })
      expect(allowed).toMatchObject({ status: 'completed' })
      expect(JSON.stringify(allowed)).toContain('PRIVATE_CONTENT')
    } finally {
      await engine.close()
    }
  })

  it('allows a private Agent only in its owning Card and rejects other contexts before execution', async () => {
    const { engine, runtime, input, requests } = fixture()
    try {
      const { card: a } = await runtime.createCard({ name: 'A' })
      const { card: b } = await runtime.createCard({ name: 'B' })
      const installation = await runtime.importExtensionPackageResources({
        ...input, target: { kind: 'card', cardId: a.id },
      })
      const id = installation.promptResources[0]!.resourceId
      const { agentPreset } = await runtime.getAgentPreset({ agentPresetId: id })
      const { providerProfile } = await runtime.createProviderProfile({
        providerExtensionId: 'official.fake', displayName: 'Test', config: {}, enabledModelIds: [officialFakeModelId],
      })
      await runtime.updateAgentPreset({
        agentPresetId: id, expectedVersion: agentPreset.version,
        model: { providerProfileId: providerProfile.id, modelId: officialFakeModelId },
      })
      const timelineA = await runtime.createNarrativeTimeline({ cardId: a.id, openingContent: '' })
      const timelineB = await runtime.createNarrativeTimeline({ cardId: b.id, openingContent: '' })
      const { session: allowed } = await runtime.createAgentSession({
        agentPresetId: id, timelineId: timelineA.timeline.id,
      })
      await runtime.previewAgentTurn({ agentSessionId: allowed.id, input: 'Continue' })
      for (const timelineId of [timelineB.timeline.id, undefined]) {
        const { session } = await runtime.createAgentSession({ agentPresetId: id, timelineId })
        await expect(runtime.previewAgentTurn({ agentSessionId: session.id, input: 'Continue' }))
          .rejects.toThrow(`Agent Preset is not available in this context: ${id}`)
        await expect(runtime.invokeAgentTurn({ agentSessionId: session.id, input: 'Continue' }))
          .rejects.toThrow(`Agent Preset is not available in this context: ${id}`)
        expect((await runtime.getAgentTranscriptPage({ agentSessionId: session.id })).entries).toEqual([])
      }
      expect(requests).toEqual([])
    } finally {
      await engine.close()
    }
  })

  it('previews the target installation without writes and rejects edits after preview', async () => {
    const { engine, runtime, input, promptResources, documents, blobs } = fixture()
    try {
      const installed = await runtime.importExtensionPackageResources(input)
      const card = (await runtime.createCard({ name: 'Other installation' })).card
      const other = await runtime.importExtensionPackageResources({ ...input, target: { kind: 'card', cardId: card.id } })
      const installation = (await runtime.listExtensionInstallations()).installations.find(item => item.id === installed.installationId)!
      const update = { ...input, packageVersion: '2.0.0', update: { expectedInstallationVersion: installation.version } }
      const beforeResources = await promptResources.listResources({ includeTombstone: true })
      const beforeDocuments = await documents.list({ includeTombstone: true })
      const prepareWrite = vi.spyOn(blobs, 'prepareWrite')
      const preview = await runtime.previewExtensionPackageResources(update)
      expect(prepareWrite).not.toHaveBeenCalled()
      expect(await promptResources.listResources({ includeTombstone: true })).toEqual(beforeResources)
      expect(await documents.list({ includeTombstone: true })).toEqual(beforeDocuments)
      expect(preview.items).toEqual([expect.objectContaining({ kind: 'preset', action: 'update', localChanges: 'unknown', resourceId: installed.promptResources[0]!.resourceId })])
      expect(preview.items.some(item => item.resourceId === other.promptResources[0]!.resourceId)).toBe(false)
      const resource = await promptResources.getResource(installed.promptResources[0]!.resourceId)
      await promptResources.mutateResource({ actor: { kind: 'system', id: 'test' }, reason: 'test.preview-edit', resourceId: resource!.id, expectedVersion: resource!.version,
        mutations: [{ kind: 'resource.update', patch: { label: 'Local edit' } }] })
      await expect(runtime.importExtensionPackageResources({ ...update, update: { ...update.update, expectedPreviewFingerprint: preview.fingerprint } })).rejects.toThrow('preview the package update again')
      expect((await runtime.listExtensionInstallations()).installations.find(item => item.id === installed.installationId)!.packageVersion).toBe('1.0.0')
    } finally { await engine.close() }
  })

  it('lists additions and removals from the actual update plan', async () => {
    const { engine, runtime, input } = fixture()
    try {
      await runtime.importExtensionPackageResources(input)
      const installation = (await runtime.listExtensionInstallations()).installations[0]!
      const replacement = structuredClone(input.promptResources[0]!)
      replacement.contribution.id = 'replacement'
      if (isPromptResourceArtifact(replacement.artifact)) replacement.artifact.rootNode.id = 'example.writer.replacement.root'
      const preview = await runtime.previewExtensionPackageResources({ ...input, packageVersion: '2.0.0', promptResources: [replacement], update: { expectedInstallationVersion: installation.version } })
      expect(preview.items.map(item => [item.contributionId, item.action])).toEqual([['replacement', 'add'], [input.promptResources[0]!.contribution.id, 'remove']])
      await runtime.importExtensionPackageResources({ ...input, packageVersion: '2.0.0', promptResources: [replacement], update: { expectedInstallationVersion: installation.version, expectedPreviewFingerprint: preview.fingerprint } })
      expect((await runtime.listExtensionInstallations()).installations[0]!.packageVersion).toBe('2.0.0')
    } finally { await engine.close() }
  })

  it('retains package resources on uninstall and reuses them when the same package is installed again', async () => {
    const { engine, runtime, input } = fixture()
    try {
      const first = await runtime.importExtensionPackageResources(input)
      const before = await runtime.getAgentPreset({ agentPresetId: first.promptResources[0]!.resourceId })
      const installation = (await runtime.listExtensionInstallations()).installations.find(item => item.id === first.installationId)!
      const removed = await runtime.uninstallExtensionInstallation({
        packageId: input.packageId, expectedInstallationVersion: installation.version,
      })
      expect(removed).toMatchObject({ installationId: first.installationId, uninstalled: true, resourcesRetained: true })
      expect((await runtime.listExtensionInstallations()).installations).toEqual([])
      expect(await runtime.getAgentPreset({ agentPresetId: first.promptResources[0]!.resourceId })).toEqual(before)
      const second = await runtime.importExtensionPackageResources(input)
      expect(second.promptResources).toEqual(first.promptResources)
      expect(await runtime.getAgentPreset({ agentPresetId: first.promptResources[0]!.resourceId })).toEqual(before)
      expect((await runtime.listExtensionInstallations()).installations[0]!.version).toBeGreaterThan(installation.version)
    } finally { await engine.close() }
  })

  it('adopts an existing global origin without reclassifying it as Card-owned', async () => {
    const { engine, promptResources, runtime, input } = fixture()
    try {
      const { resource } = await runtime.createPromptResource({ resourceKind: 'preset', name: 'Existing edited resource' })
      await promptResources.mutateResource({
        actor: { kind: 'system', id: 'test' }, reason: 'test.legacy-global-origin',
        resourceId: resource.id, expectedVersion: resource.version,
        mutations: [{
          kind: 'resource.update',
          patch: { metadata: { origin: {
            kind: 'extension-package', packageId: input.packageId, packageVersion: input.packageVersion,
            contributionId: input.promptResources[0]!.contribution.id,
          } } },
        }],
      })
      const before = (await runtime.getAgentPreset({ agentPresetId: resource.id })).agentPreset
      const global = await runtime.importExtensionPackageResources(input)
      expect(global.promptResources[0]!.resourceId).toBe(resource.id)
      expect((await runtime.getAgentPreset({ agentPresetId: resource.id })).agentPreset).toEqual(before)
      const { card } = await runtime.createCard({ name: 'Private' })
      const privateImport = await runtime.importExtensionPackageResources({
        ...input, target: { kind: 'card', cardId: card.id },
      })
      expect(privateImport.promptResources[0]!.resourceId).not.toBe(resource.id)
      await runtime.removeExtensionPackageResources({ packageId: input.packageId })
      expect((await runtime.getAgentPreset({ agentPresetId: privateImport.promptResources[0]!.resourceId })).agentPreset.id)
        .toBe(privateImport.promptResources[0]!.resourceId)
    } finally {
      await engine.close()
    }
  })

  it('rejects an absent Card before writing an installation or resources', async () => {
    const { engine, documents, runtime, input } = fixture()
    try {
      await expect(runtime.importExtensionPackageResources({
        ...input, target: { kind: 'card', cardId: 'missing' },
      })).rejects.toThrow('Document not found')
      expect((await runtime.listPromptResources()).resources).toEqual([])
      expect((await documents.list()).items).toEqual([])
    } finally {
      await engine.close()
    }
  })

  it('isolates resource identities and removal across global and two Card installations', async () => {
    const { engine, documents, runtime, input } = fixture()
    try {
      const { card: cardA } = await runtime.createCard({ name: 'A' })
      const { card: cardB } = await runtime.createCard({ name: 'B' })
      input.promptResources[0]!.artifact = {
        format: 'loom.promptResource', schemaVersion: 2, resourceKind: 'preset',
        rootNode: {
          id: 'example.writer.root', kind: 'module', label: 'Writer',
          children: [{ id: 'example.writer.body', kind: 'entry', label: 'Body', body: 'Keep example.writer.body as text' }],
        },
      }
      input.promptResources.push({
        contribution: { id: 'example.writer.setting', resourceKind: 'lore', source: 'setting.json' },
        artifact: {
          format: 'loom.promptResource', schemaVersion: 2, resourceKind: 'lore',
          rootNode: { id: 'example.writer.setting.root', kind: 'module', label: 'Setting' },
        },
      })
      input.promptResources[0]!.contribution.loreMounts = [{ resourceId: 'example.writer.setting' }]
      input.promptResources[0]!.contribution.toolMounts = [{ toolId: 'example.writer/read' }]
      input.agentTools = [{
        contribution: { id: 'example.writer/read', source: 'read.json' },
        definition: { name: 'read', description: 'Read', input: { kind: 'structured', schema: { type: 'object' } } },
      }]
      input.transformRules = [{
        contribution: { id: 'replace', source: 'replace.json' },
        artifact: {
          name: 'Replace', enabled: true, orderIndex: 0, targets: ['narrative'], phases: ['prompt'],
          matcher: { kind: 'regex', pattern: 'old', flags: 'g' }, effect: { kind: 'replace', replacement: 'new' },
        },
      }]
      input.textExtractors = [{
        contribution: { id: 'state', source: 'state.json' },
        artifact: {
          name: 'State', enabled: true, orderIndex: 0, targets: ['narrative'],
          matcher: { kind: 'regex', pattern: '<state>([\\s\\S]*?)</state>', flags: 'g', contentGroup: 1 },
          strategy: 'latest-valid', parser: 'key-value-lines',
        },
      }]
      const global = await runtime.importExtensionPackageResources(input)
      const targetA = { kind: 'card' as const, cardId: cardA.id }
      const targetB = { kind: 'card' as const, cardId: cardB.id }
      const a = await runtime.importExtensionPackageResources({ ...input, target: targetA })
      const b = await runtime.importExtensionPackageResources({ ...input, packageVersion: '2.0.0', target: targetB })
      expect(new Set([global.installationId, a.installationId, b.installationId]).size).toBe(3)
      const { installations } = await runtime.listExtensionInstallations()
      expect(installations).toHaveLength(3)
      expect(installations).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: global.installationId, packageId: input.packageId, target: { kind: 'global' } }),
        expect.objectContaining({ id: a.installationId, packageId: input.packageId, target: targetA }),
        expect.objectContaining({ id: b.installationId, packageVersion: '2.0.0', target: targetB }),
      ]))
      const imported = [global, a, b]
      expect(new Set(imported.flatMap(item => item.promptResources.map(resource => resource.resourceId))).size).toBe(6)
      expect(new Set(imported.flatMap(item => item.agentTools.map(tool => tool.toolId))).size).toBe(3)
      expect(new Set(imported.flatMap(item => item.transformRules.map(rule => rule.ruleId))).size).toBe(3)
      expect(new Set(imported.flatMap(item => item.textExtractors.map(extractor => extractor.extractorId))).size).toBe(3)
      const snapshots = []
      for (const installation of imported) {
        const id = installation.promptResources[0]!.resourceId
        const { agentPreset } = await runtime.getAgentPreset({ agentPresetId: id })
        expect(agentPreset.origin).toMatchObject({ installationId: installation.installationId, contributionId: 'example.writer.preset' })
        expect(agentPreset.rootNode.children).toHaveLength(1)
        expect(agentPreset.rootNode.children![0]!.body).toBe('Keep example.writer.body as text')
        expect((await runtime.listLoreMounts({ source: { kind: 'preset', id } })).mounts)
          .toMatchObject([{ loreResourceId: installation.promptResources[1]!.resourceId }])
        expect((await runtime.listPresetToolMounts({ presetId: id })).mounts)
          .toMatchObject([{ toolId: installation.agentTools[0]!.toolId }])
        snapshots.push(agentPreset)
      }
      expect(new Set(snapshots.map(resource => resource.rootNode.id)).size).toBe(3)
      expect(snapshots[2]!.origin).toMatchObject({ packageVersion: '2.0.0' })
      expect((await documents.get(a.installationId))?.content).toMatchObject({ packageId: input.packageId, target: targetA })
      const again = await runtime.importExtensionPackageResources({ ...input, target: targetA })
      expect(again.promptResources).toEqual(a.promptResources)
      expect(again.mutation).toBeUndefined()
      const removed = await runtime.removeExtensionPackageResources({ packageId: input.packageId, target: targetA })
      expect(removed.promptResourceIds.sort()).toEqual(a.promptResources.map(resource => resource.resourceId).sort())
      expect(removed.agentToolIds).toEqual([a.agentTools[0]!.toolId])
      expect(removed.textTransformRuleIds).toEqual([a.transformRules[0]!.ruleId])
      expect(removed.textExtractorIds).toEqual([a.textExtractors[0]!.extractorId])
      expect((await runtime.listTextTransformRules()).rules.map(rule => rule.id).sort())
        .toEqual([global.transformRules[0]!.ruleId, b.transformRules[0]!.ruleId].sort())
      expect((await runtime.listTextExtractors()).extractors.map(extractor => extractor.id).sort())
        .toEqual([global.textExtractors[0]!.extractorId, b.textExtractors[0]!.extractorId].sort())
      for (const snapshot of [snapshots[0]!, snapshots[2]!]) {
        expect((await runtime.getAgentPreset({ agentPresetId: snapshot.id })).agentPreset).toEqual(snapshot)
      }
      const restored = await runtime.importExtensionPackageResources({ ...input, target: targetA })
      expect(restored.promptResources).toEqual(a.promptResources)
      expect(restored.agentTools).toEqual(a.agentTools)
      expect(restored.transformRules).toEqual(a.transformRules)
      expect(restored.textExtractors).toEqual(a.textExtractors)
      const presetId = restored.promptResources[0]!.resourceId
      expect((await runtime.getAgentPreset({ agentPresetId: presetId })).agentPreset.rootNode)
        .toEqual(snapshots[1]!.rootNode)
      expect((await runtime.listLoreMounts({ source: { kind: 'preset', id: presetId } })).mounts)
        .toMatchObject([{ loreResourceId: restored.promptResources[1]!.resourceId }])
      expect((await runtime.listPresetToolMounts({ presetId })).mounts)
        .toMatchObject([{ toolId: restored.agentTools[0]!.toolId }])
      expect((await runtime.importExtensionPackageResources({ ...input, target: targetA })).mutation).toBeUndefined()
    } finally {
      await engine.close()
    }
  })

  it('preserves author macros and options without overwriting edits on repeated import', async () => {
    const { engine, runtime, input } = fixture()
    try {
      const imported = await runtime.importExtensionPackageResources(input)
      const id = imported.promptResources[0]!.resourceId
      const { agentPreset } = await runtime.getAgentPreset({ agentPresetId: id })
      expect(agentPreset.macros).toEqual({ tone: 'gentle' })
      expect(agentPreset.macroOptions).toEqual({ tone: [{ id: 'direct', label: 'Direct', value: 'direct' }] })
      const { resource: edited } = await runtime.updatePromptResourceMacros({
        resourceId: id, expectedVersion: agentPreset.version, macros: { tone: 'local' },
      })
      const again = await runtime.importExtensionPackageResources(input)
      expect(again.promptResources).toEqual(imported.promptResources)
      expect(again.mutation).toBeUndefined()
      expect((await runtime.getAgentPreset({ agentPresetId: id })).agentPreset).toEqual(edited)
    } finally {
      await engine.close()
    }
  })

  it.each(['scripts', 'rules', 'malformed-rules'] as const)('rejects nested %s before committing any package resources', async nested => {
    const { engine, documents, runtime, input } = fixture()
    try {
      const second = structuredClone(input.promptResources[0]!)
      second.contribution.id = 'example.writer.second'
      const artifact = second.artifact as Record<string, unknown>
      artifact.rootNode = { id: 'example.writer.second.root', kind: 'module', label: 'Second' }
      if (nested === 'scripts') {
        artifact.scriptAttachments = [{
          orderIndex: 0,
          script: {
            format: 'loom.script', schemaVersion: 1, fileName: 'writer.loom.js',
            source: [
              '// ==LoomScript==', '// @format 1', '// @id example.writer.renderer',
              '// @name Writer', '// @version 1.0.0', '// @runtime client-sandbox',
              '// @contribution {"kind":"renderer","id":"status","surface":"narrative.entry.inline","scope":"node","inputs":["match:status"]}',
              '// ==/LoomScript==', 'export const renderers = {}',
            ].join('\n'),
          },
        }]
      } else if (nested === 'malformed-rules') {
        artifact.textTransformRules = {}
      } else {
        artifact.textTransformRules = [{
          name: 'Nested', enabled: true, orderIndex: 0,
          matcher: { kind: 'regex', pattern: 'old', flags: 'g' },
          effect: { kind: 'replace', replacement: 'new' },
          targets: ['narrative'], phases: ['prompt'],
        }]
      }
      input.promptResources.push(second)
      await expect(runtime.importExtensionPackageResources(input)).rejects.toThrow(
        nested === 'malformed-rules' ? 'artifact is invalid' : 'must not contain nested scripts or rules',
      )
      expect((await runtime.listPromptResources()).resources).toEqual([])
      expect((await documents.list()).items).toEqual([])
    } finally {
      await engine.close()
    }
  })
})
