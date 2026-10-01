import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAgentStore, createNarrativeStore, createPromptResourceStore } from '@loom-studio/application-data'
import { createApplicationRuntime, createMacroProviderRegistry } from '@loom-studio/application-runtime'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { createId, nowIso, type ChatMessage } from '@loom-studio/shared'
import { describe, expect, it } from 'vitest'

function open(filename = ':memory:') {
  const clock = { createId, now: nowIso }
  const engine = createSqliteDataEngine({ filename, ...clock })
  const documents = createSqliteDocumentStore({ engine })
  const macroProviders = createMacroProviderRegistry()
  const requests: ChatMessage[][] = []
  const runtime = createApplicationRuntime({
    dataEngine: engine, documents, macroProviders,
    narratives: createNarrativeStore({ engine, ...clock }),
    agents: createAgentStore({ engine, ...clock }),
    promptResources: createPromptResourceStore({ engine, ...clock }),
    gateway: { invokeChat: async ({ request }) => {
      requests.push(request.messages)
      return { provider: 'test', model: 'model', text: 'Done', finishReason: 'stop', message: { role: 'assistant', content: 'Done' } }
    } },
  })
  return { engine, documents, runtime, macroProviders, requests }
}

async function setup(f: ReturnType<typeof open>) {
  const { runtime } = f
  const { card } = await runtime.createCard({
    name: 'Card', macros: { tone: 'CARD_TONE' },
    macroOptions: { tone: [{ id: 'card-alternative', label: 'Alternative', value: 'CARD_ALTERNATIVE' }] },
  })
  const story = await runtime.createNarrativeTimeline({ cardId: card.id, openingNodes: [{ content: 'Opening' }] })
  const { resource: initial } = await runtime.createPromptResource({ resourceKind: 'preset', name: 'Preset' })
  const { resource: withBody } = await runtime.createPromptResourceAsset({
    resourceId: initial.id, targetAssetId: initial.rootNode.id, position: 'inside',
    asset: { id: createId('entry'), kind: 'entry', label: 'Tone', body: 'TONE={{tone}}' },
  })
  const { resource: preset } = await runtime.updatePromptResourceMacros({
    resourceId: initial.id, expectedVersion: withBody.version,
    macros: { tone: 'PRESET_DEFAULT' },
    macroOptions: { tone: [
      { id: 'gentle', label: 'Gentle', value: 'GENTLE_TEXT' },
      { id: 'danger', label: 'Danger', value: 'DANGER_TEXT' },
    ] },
  })
  const { providerProfile } = await runtime.createProviderProfile({
    providerExtensionId: 'official.openai-compatible', displayName: 'Test', config: {}, enabledModelIds: ['model'],
  })
  const { agentPreset } = await runtime.updateAgentPreset({
    name: 'Writer', agentPresetId: preset.id, expectedVersion: (await runtime.getPromptResource({ resourceId: preset.id })).resource.version, model: { providerProfileId: providerProfile.id, modelId: 'model' },
  })
  const { session } = await runtime.createAgentSession({ agentPresetId: agentPreset.id, timelineId: story.timeline.id })
  return { card, story, preset: agentPreset, agentPreset, session, target: { timelineId: story.timeline.id, presetId: preset.id } }
}

describe('Timeline + Preset macro configuration', () => {
  it('persists candidate references across restart, Sessions and branches; isolates other playthroughs and keeps overrides temporary', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'loom-macro-config-'))
    const filename = join(directory, 'test.sqlite')
    let f = open(filename)
    try {
      const s = await setup(f)
      const selection = { tone: { sourceId: `preset:${s.preset.id}`, optionId: 'danger' } }
      const initial = await f.runtime.inspectMacros({ timelineTarget: { timelineId: s.target.timelineId }, presetId: s.preset.id })
      expect(initial.macroInspection.entries.find(entry => entry.name === 'tone')).toMatchObject({ value: 'PRESET_DEFAULT', status: 'resolved' })
      expect(initial.macroInspection.entries.find(entry => entry.name === 'tone')?.candidates).toEqual(expect.arrayContaining([
        expect.objectContaining({ sourceId: `card:${s.card.id}`, sourceLabel: 'Card' }),
        expect.objectContaining({ sourceId: `preset:${s.preset.id}`, sourceLabel: 'Writer' }),
      ]))
      const saved = await f.runtime.updateTimelinePresetConfig({ ...s.target, expectedVersion: 0, macroSelections: selection })
      expect(saved.config).toMatchObject({ ...s.target, version: 1, macroSelections: selection })
      expect(JSON.stringify(saved.config)).not.toContain('DANGER_TEXT')
      await expect(f.runtime.updateTimelinePresetConfig({ ...s.target, expectedVersion: 0, macroSelections: {} })).rejects.toThrow(/already exists/)
      const artifact = (await f.runtime.exportPromptResource({ resourceId: s.preset.id })).artifact
      const importedPreset = await f.runtime.importPromptResource({ artifact })
      expect(importedPreset.resource.macroOptions).toEqual(s.preset.macroOptions)
      const exportedCard = await f.runtime.exportCardBundle({ cardId: s.card.id })
      expect((await f.runtime.importCardBundle({ artifact: exportedCard.artifact })).card.macroOptions).toEqual(s.card.macroOptions)
      expect((await f.runtime.getCard({ cardId: s.card.id })).card.macros).toEqual(s.card.macros)
      f.engine.close()
      f = open(filename)
      const preview = await f.runtime.previewAgentTurn({ agentSessionId: s.session.id, input: 'Continue' })
      expect(preview.macroInspection.entries.find(entry => entry.name === 'tone')?.candidates).toEqual(expect.arrayContaining([
        expect.objectContaining({ sourceId: `preset:${s.preset.id}`, sourceLabel: 'Writer' }),
      ]))
      await f.runtime.invokeAgentTurn({ agentSessionId: s.session.id, input: 'Continue' })
      expect(f.requests[0]).toEqual(preview.messages)
      expect(JSON.stringify(preview.messages)).toContain('TONE=DANGER_TEXT')
      const { session } = await f.runtime.createAgentSession({ agentPresetId: s.agentPreset.id, timelineId: s.target.timelineId })
      const { branch } = await f.runtime.forkNarrativeBranch({
        timelineId: s.target.timelineId, fromBranchId: s.story.branch.id, fromNodeId: s.story.nodes[0]!.id,
      })
      await f.runtime.switchNarrativeBranch({ timelineId: s.target.timelineId, branchId: branch.id })
      expect(JSON.stringify((await f.runtime.previewAgentTurn({ agentSessionId: session.id, input: 'Branch' })).messages)).toContain('TONE=DANGER_TEXT')
      const other = await f.runtime.createNarrativeTimeline({ cardId: s.card.id })
      expect((await f.runtime.getTimelinePresetConfig({ ...s.target, timelineId: other.timeline.id })).config).toMatchObject({ version: 0, macroSelections: {} })
      expect((await f.runtime.getTimelinePresetConfig({ ...s.target, presetId: importedPreset.resource.id })).config).toMatchObject({ version: 0, macroSelections: {} })
      const override = await f.runtime.previewAgentTurn({
        agentSessionId: session.id, input: 'Temporary', macroSelections: { tone: `card:${s.card.id}` },
      })
      expect(JSON.stringify(override.messages)).toContain('TONE=CARD_TONE')
      expect((await f.runtime.getTimelinePresetConfig(s.target)).config.macroSelections).toEqual(selection)
      const pickedCard = await f.runtime.updateTimelinePresetConfig({
        ...s.target, expectedVersion: saved.config.version,
        macroSelections: { tone: { sourceId: `card:${s.card.id}`, optionId: 'card-alternative' } },
      })
      expect(JSON.stringify((await f.runtime.previewAgentTurn({ agentSessionId: session.id, input: 'Card choice' })).messages)).toContain('TONE=CARD_ALTERNATIVE')
      await f.runtime.updateTimelinePresetConfig({ ...s.target, expectedVersion: pickedCard.config.version, macroSelections: {} })
      expect(JSON.stringify((await f.runtime.previewAgentTurn({ agentSessionId: session.id, input: 'Reset' })).messages)).toContain('TONE=PRESET_DEFAULT')
    } finally {
      f.engine.close()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('follows a candidate edit but does not silently replace a removed choice, even when only one source remains', async () => {
    const f = open()
    try {
      const s = await setup(f)
      await f.runtime.updateTimelinePresetConfig({
        ...s.target, expectedVersion: 0, macroSelections: { tone: { sourceId: `preset:${s.preset.id}`, optionId: 'danger' } },
      })
      const edited = await f.runtime.updatePromptResourceMacros({
        resourceId: s.preset.id, expectedVersion: s.preset.version, macros: { tone: 'PRESET_DEFAULT' },
        macroOptions: { tone: [{ id: 'danger', label: 'Renamed', value: 'EDITED_TEXT' }] },
      })
      const read = () => f.runtime.previewAgentTurn({ agentSessionId: s.session.id, input: 'Continue' })
      expect(JSON.stringify((await read()).messages)).toContain('TONE=EDITED_TEXT')
      await f.runtime.updatePromptResourceMacros({
        resourceId: s.preset.id, expectedVersion: edited.resource.version, macros: {}, macroOptions: {},
      })
      const invalid = await read()
      expect(invalid.macroInspection.entries.find(entry => entry.name === 'tone')).toMatchObject({ status: 'error' })
      expect(JSON.stringify(invalid.messages)).not.toContain('TONE=CARD_TONE')
      await expect(f.runtime.invokeAgentTurn({ agentSessionId: s.session.id, input: 'Continue' })).rejects.toThrow(/Selected macro is unavailable/)
      expect(f.requests).toHaveLength(0)
      await expect(f.runtime.updateTimelinePresetConfig({
        ...s.target, expectedVersion: 1, macroSelections: { tone: { sourceId: `preset:${s.preset.id}`, optionId: 'gone' } },
      })).rejects.toThrow(/candidate is unavailable/)
      expect((await f.runtime.getTimelinePresetConfig(s.target)).config.version).toBe(1)
    } finally { f.engine.close() }
  })

  it('archives selections, rebinds them to the restored Timeline and deletes only the target playthrough configuration', async () => {
    const f = open()
    try {
      const s = await setup(f)
      const selection = { tone: { sourceId: `preset:${s.preset.id}`, optionId: 'gentle' } }
      await f.runtime.updateTimelinePresetConfig({ ...s.target, expectedVersion: 0, macroSelections: selection })
      const { archive } = await f.runtime.exportTimelineArchive({ timelineId: s.target.timelineId })
      expect(archive.macroConfigurations).toEqual([{ presetId: s.preset.id, macroSelections: selection }])
      const restored = await f.runtime.importTimelineArchive({ source: JSON.stringify(archive) })
      expect((await f.runtime.getTimelinePresetConfig({ ...s.target, timelineId: restored.timelineId })).config.macroSelections).toEqual(selection)
      const { session } = await f.runtime.createAgentSession({ agentPresetId: s.agentPreset.id, timelineId: restored.timelineId })
      expect(JSON.stringify((await f.runtime.previewAgentTurn({ agentSessionId: session.id, input: 'Restored' })).messages)).toContain('TONE=GENTLE_TEXT')
      await f.runtime.deleteNarrativeTimeline({ timelineId: s.target.timelineId })
      const records = await f.documents.list({ type: 'airp.timelinePresetConfig' })
      expect(records.items).toHaveLength(1)
      expect(records.items[0]?.content).toMatchObject({ timelineId: restored.timelineId })
      await expect(f.runtime.importTimelineArchive({
        source: JSON.stringify({ ...archive, macroConfigurations: [archive.macroConfigurations![0], archive.macroConfigurations![0]] }),
      })).rejects.toThrow(/Duplicate archived macro configuration/)
    } finally { f.engine.close() }
  })

  it('does not leave a configuration behind when the Timeline is deleted during candidate evaluation', async () => {
    const f = open()
    try {
      const s = await setup(f)
      let reached!: () => void
      const entered = new Promise<void>(resolve => { reached = resolve })
      let release!: () => void
      const waiting = new Promise<void>(resolve => { release = resolve })
      f.macroProviders.register({ id: 'test.delayed', name: 'dynamic', sourceLabel: 'Delayed', resolve: async () => {
        reached()
        await waiting
        return 'VALUE'
      } })
      const pending = f.runtime.updateTimelinePresetConfig({
        ...s.target, expectedVersion: 0, macroSelections: { dynamic: 'test.delayed' },
      })
      const failure = expect(pending).rejects.toThrow(/timeline not found/)
      await entered
      await f.runtime.deleteNarrativeTimeline({ timelineId: s.target.timelineId })
      release()
      await failure
      expect((await f.documents.list({ type: 'airp.timelinePresetConfig' })).items).toEqual([])
    } finally { f.engine.close() }
  })

  it('preserves a Card selection reference on restore but reports the missing source Card instead of substituting the Preset', async () => {
    const f = open()
    try {
      const s = await setup(f)
      const selection = { tone: { sourceId: `card:${s.card.id}`, optionId: 'card-alternative' } }
      await f.runtime.updateTimelinePresetConfig({ ...s.target, expectedVersion: 0, macroSelections: selection })
      const { archive } = await f.runtime.exportTimelineArchive({ timelineId: s.target.timelineId })
      const restored = await f.runtime.importTimelineArchive({ source: JSON.stringify(archive) })
      const target = { ...s.target, timelineId: restored.timelineId }
      expect((await f.runtime.getTimelinePresetConfig(target)).config.macroSelections).toEqual(selection)
      const { session } = await f.runtime.createAgentSession({ agentPresetId: s.agentPreset.id, timelineId: restored.timelineId })
      const preview = await f.runtime.previewAgentTurn({ agentSessionId: session.id, input: 'Restored' })
      expect(preview.macroInspection.entries.find(entry => entry.name === 'tone')).toMatchObject({ status: 'error' })
      expect(JSON.stringify(preview.messages)).not.toContain('TONE=PRESET_DEFAULT')
      await expect(f.runtime.invokeAgentTurn({ agentSessionId: session.id, input: 'Restored' })).rejects.toThrow(/Selected macro is unavailable/)
      await f.runtime.updateTimelinePresetConfig({ ...target, expectedVersion: 1, macroSelections: {} })
      expect(JSON.stringify((await f.runtime.previewAgentTurn({ agentSessionId: session.id, input: 'Reset' })).messages)).toContain('TONE=PRESET_DEFAULT')
    } finally { f.engine.close() }
  })
})
