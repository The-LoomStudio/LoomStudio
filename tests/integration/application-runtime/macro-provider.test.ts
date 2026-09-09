import {
  createApplicationRuntime,
  createMacroProviderRegistry,
} from '@loom-studio/application-runtime'
import { createAgentStore } from '@loom-studio/agent-store'
import { officialFakeModelId } from '@loom-studio/ai-gateway'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { createNarrativeStore } from '@loom-studio/narrative-store'
import { createPromptResourceStore } from '@loom-studio/prompt-resource-store'
import { createVariableRenderContext, renderVariableMacros } from '@loom-studio/shared'
import { describe, expect, it } from 'vitest'

function createTestRuntime() {
  let nextId = 0
  let nextTime = 0
  const createId = (prefix: string) => `${prefix}-${++nextId}`
  const now = () => `2026-09-09T00:00:${String(nextTime++).padStart(2, '0')}.000Z`
  const engine = createSqliteDataEngine({ filename: ':memory:', createId, now })
  const documents = createSqliteDocumentStore({ engine })
  const promptResources = createPromptResourceStore({ engine, createId, now })
  const macroProviders = createMacroProviderRegistry()
  const runtime = createApplicationRuntime({ dataEngine: engine, documents, promptResources, macroProviders })
  return { engine, runtime, macroProviders }
}

describe('application macro provider integration', () => {
  it('freezes provider context and exposes selected/conflicting/error sources', async () => {
    const { engine, runtime, macroProviders } = createTestRuntime()
    const card = await runtime.createCard({ name: 'Macro Card', macros: { greeting: 'card' } })
    const preset = await runtime.createPromptResource({ resourceKind: 'preset', name: 'Macro Preset' })
    const presetMacros = await runtime.updatePromptResourceMacros({
      resourceId: preset.resource.id,
      expectedVersion: preset.resource.version,
      macros: { greeting: 'preset' },
    })
    let frozen = false
    macroProviders.register({
      id: 'provider.echo',
      name: 'dynamic',
      sourceLabel: 'test/provider',
      resolve: context => {
        frozen = Object.isFrozen(context) && Object.isFrozen(context.global)
        return context.cardId ? 'resolved' : 'missing-card'
      },
    })
    macroProviders.register({
      id: 'provider.failure',
      name: 'broken',
      sourceLabel: 'test/provider',
      resolve: () => { throw new Error('provider failed') },
    })
    macroProviders.register({ id: 'provider.tone.upper', name: 'Tone', sourceLabel: 'test/provider', resolve: () => 'upper' })
    macroProviders.register({ id: 'provider.tone.lower', name: 'tone', sourceLabel: 'test/provider', resolve: () => 'lower' })
    macroProviders.register({ id: 'provider.prototype.root', name: '__proto__', sourceLabel: 'test/provider', resolve: () => 'root-safe' })
    macroProviders.register({ id: 'provider.prototype', name: '__proto__.x', sourceLabel: 'test/provider', resolve: () => 'safe' })
    macroProviders.register({ id: 'provider.to-string', name: 'toString', sourceLabel: 'test/provider', resolve: () => 'string-safe' })
    macroProviders.register({ id: 'provider.parent', name: 'a', sourceLabel: 'test/provider', resolve: () => 'parent' })
    macroProviders.register({ id: 'provider.child', name: 'a.b', sourceLabel: 'test/provider', resolve: () => 'child' })

    const inspection = await runtime.inspectMacros({
      cardId: card.card.id,
      presetId: preset.resource.id,
    })
    expect(frozen).toBe(true)
    expect(inspection.macroInspection.entries.find(entry => entry.name === 'greeting')).toMatchObject({ status: 'conflict' })
    expect(inspection.macroInspection.entries.find(entry => entry.name === 'dynamic')).toMatchObject({ value: 'resolved', status: 'resolved' })
    expect(inspection.macroInspection.entries.find(entry => entry.name === 'broken')).toMatchObject({ status: 'error' })
    expect(inspection.macroInspection.entries.find(entry => entry.name === 'Tone')).toMatchObject({ status: 'conflict' })
    expect(inspection.macroInspection.entries.find(entry => entry.name === '__proto__.x')).toMatchObject({ value: 'safe', status: 'resolved' })
    expect(inspection.macroInspection.entries.find(entry => entry.name === '__proto__')).toMatchObject({ value: 'root-safe', status: 'resolved' })
    expect(inspection.macroInspection.entries.find(entry => entry.name === 'toString')).toMatchObject({ value: 'string-safe', status: 'resolved' })
    expect(Object.hasOwn(inspection.macroInspection.snapshot.computed, '__proto__.x')).toBe(true)
    expect(inspection.macroInspection.entries.find(entry => entry.name === 'a')).toMatchObject({ value: 'parent', status: 'resolved' })
    expect(inspection.macroInspection.entries.find(entry => entry.name === 'a.b')).toMatchObject({ value: 'child', status: 'resolved' })
    const conflictContext = createVariableRenderContext({
      global: inspection.macroInspection.snapshot.global,
      timeline: inspection.macroInspection.snapshot.timeline,
      computed: inspection.macroInspection.snapshot.computed,
      aliases: inspection.macroInspection.snapshot.aliases,
    })
    conflictContext.snapshot.macroDiagnostics = inspection.macroInspection.snapshot.macroDiagnostics
    expect(renderVariableMacros('{{tone}}', conflictContext)).toBe('{{tone}}')
    expect(conflictContext.trace.diagnostics).toEqual([{ severity: 'warning', code: 'macro.conflict', path: 'tone' }])
    expect(renderVariableMacros('{{__proto__}} {{__proto__.x}} {{toString}}', conflictContext)).toBe('root-safe safe string-safe')
    expect(inspection.macroInspection.entries.find(entry => entry.name === 'char.name')).toMatchObject({ value: 'Macro Card', status: 'resolved' })
    expect(inspection.macroInspection.entries.find(entry => entry.name === 'bot.name')).toMatchObject({ value: 'Macro Card', status: 'resolved' })
    const stateRegistry = createMacroProviderRegistry()
    const stateContext = createVariableRenderContext({ global: { stats: { hp: 42, enabled: true, empty: null } } })
    const stateInspection = await stateRegistry.inspect({ snapshot: stateContext.snapshot, context: { global: stateContext.snapshot.global }, capturedAt: '2026-09-09T00:00:00.000Z' })
    expect(stateInspection.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'global.stats.hp', value: '42' }),
      expect.objectContaining({ name: 'global.stats.enabled', value: 'true' }),
      expect.objectContaining({ name: 'global.stats.empty', value: 'null' }),
    ]))
    expect(stateInspection.entries.some(entry => entry.name === 'stats.hp')).toBe(false)

    const selected = await runtime.inspectMacros({
      cardId: card.card.id,
      presetId: preset.resource.id,
      macroSelections: { greeting: `card:${card.card.id}` },
    })
    expect(selected.macroInspection.entries.find(entry => entry.name === 'greeting')).toMatchObject({
      selectedSourceId: `card:${card.card.id}`,
      value: 'card',
      status: 'resolved',
    })
    expect(presetMacros.resource.macros).toEqual({ greeting: 'preset' })
    await expect(runtime.updateCard({ cardId: card.card.id, expectedVersion: card.card.version, macros: { greeting: 'updated' } })).resolves.toMatchObject({
      card: { macros: { greeting: 'updated' }, version: card.card.version + 1 },
    })
    await expect(runtime.updateCard({ cardId: card.card.id, expectedVersion: card.card.version, macros: { greeting: 'stale' } })).rejects.toThrow('Document version conflict')
    const exportedCard = await runtime.exportCardBundle({ cardId: card.card.id })
    const importedCard = await runtime.importCardBundle({ artifact: exportedCard.artifact })
    expect(importedCard.card.macros).toEqual({ greeting: 'updated' })
    const exportedPreset = await runtime.exportPromptResource({ resourceId: preset.resource.id })
    expect(exportedPreset.artifact.macros).toEqual({ greeting: 'preset' })
    const importedPreset = await runtime.importPromptResource({ artifact: exportedPreset.artifact })
    expect(importedPreset.resource.macros).toEqual({ greeting: 'preset' })
    engine.close()
  })

  it('uses frozen Timeline Card macros and one provider result in Preview and Invoke', async () => {
    let nextId = 0
    let nextTime = 0
    const createId = (prefix: string) => `${prefix}-${++nextId}`
    const now = () => `2026-09-09T00:01:${String(nextTime++).padStart(2, '0')}.000Z`
    const engine = createSqliteDataEngine({ filename: ':memory:', createId, now })
    const documents = createSqliteDocumentStore({ engine })
    const agents = createAgentStore({ engine, createId, now })
    const narratives = createNarrativeStore({ engine, createId, now })
    const promptResources = createPromptResourceStore({ engine, createId, now })
    const macroProviders = createMacroProviderRegistry()
    let providerCalls = 0
    macroProviders.register({
      id: 'provider.build-count',
      name: 'dynamic',
      sourceLabel: 'test/provider',
      resolve: () => `dynamic-${++providerCalls}`,
    })
    const runtime = createApplicationRuntime({
      agents,
      narratives,
      dataEngine: engine,
      documents,
      promptResources,
      macroProviders,
      gateway: {
        invokeChat: async input => ({
          provider: 'test',
          model: 'test-model',
          text: 'Done.',
          finishReason: 'stop' as const,
          message: { role: 'assistant' as const, content: 'Done.' },
          raw: { messages: input.request.messages },
        }),
      },
    })
    const card = await runtime.createCard({ name: 'Frozen Card', macros: { greeting: 'card-v1' } })
    const timeline = await runtime.createNarrativeTimeline({ cardId: card.card.id })
    const preset = await runtime.createPromptResource({ resourceKind: 'preset', name: 'Macro Prompt' })
    const presetWithBody = await runtime.createPromptResourceAsset({
      resourceId: preset.resource.id,
      targetAssetId: preset.resource.rootNode.id,
      position: 'inside',
      asset: { id: 'macro-body', label: 'Macro Body', category: 'preset', kind: 'entry', body: 'Card={{greeting}} Dynamic={{dynamic}}' },
    })
    await runtime.updatePromptResourceMacros({
      resourceId: presetWithBody.resource.id,
      expectedVersion: presetWithBody.resource.version,
      macros: { greeting: 'preset-v1' },
    })
    await runtime.updateCard({ cardId: card.card.id, expectedVersion: card.card.version, macros: { greeting: 'card-v2' } })
    const provider = await runtime.createProviderProfile({
      providerExtensionId: 'official.fake',
      displayName: 'Macro Provider',
      config: {},
      enabledModelIds: [officialFakeModelId],
    })
    const profile = await runtime.createAgentProfile({
      name: 'Macro Profile',
      presetId: presetWithBody.resource.id,
      model: { providerProfileId: provider.providerProfile.id, modelId: officialFakeModelId },
    })
    const session = await runtime.createAgentSession({ agentProfileId: profile.agentProfile.id, timelineId: timeline.timeline.id })
    const selection = { greeting: `card:${card.card.id}` }
    const conflictPreview = await runtime.previewAgentTurn({
      agentSessionId: session.session.id,
      input: 'Conflict',
      narrativeTarget: { timelineId: timeline.timeline.id, branchId: timeline.branch.id, commit: false },
    })
    expect(providerCalls).toBe(1)
    expect(conflictPreview.messages).toContainEqual(expect.objectContaining({ role: 'system', content: 'Card={{greeting}} Dynamic=dynamic-1' }))
    expect(conflictPreview.macroInspection.entries.find(entry => entry.name === 'greeting')).toMatchObject({ status: 'conflict' })
    const preview = await runtime.previewAgentTurn({
      agentSessionId: session.session.id,
      input: 'Preview',
      macroSelections: selection,
      narrativeTarget: { timelineId: timeline.timeline.id, branchId: timeline.branch.id, commit: false },
    })
    expect(providerCalls).toBe(2)
    expect(preview.messages).toContainEqual(expect.objectContaining({ role: 'system', content: 'Card=card-v1 Dynamic=dynamic-2' }))
    expect(preview.macroInspection.entries.find(entry => entry.name === 'greeting')).toMatchObject({ value: 'card-v1', selectedSourceId: `card:${card.card.id}`, status: 'resolved' })
    const invoked = await runtime.invokeAgentTurn({
      agentSessionId: session.session.id,
      input: 'Invoke',
      macroSelections: selection,
      narrativeTarget: { timelineId: timeline.timeline.id, branchId: timeline.branch.id, commit: false },
    })
    expect(providerCalls).toBe(3)
    expect(invoked.macroInspection.entries.find(entry => entry.name === 'dynamic')).toMatchObject({ value: 'dynamic-3', status: 'resolved' })
    engine.close()
  })
})
