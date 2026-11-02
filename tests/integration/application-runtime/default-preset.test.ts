import { join } from 'node:path'
import { createAssetStore, createBlobStore } from '@loom-studio/asset-store'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createAgentStore, createNarrativeStore, createPromptResourceStore } from '@loom-studio/application-data'
import type { AiGatewayRequest } from '@loom-studio/ai-gateway'
import { createAgentToolRegistry, createApplicationRuntime, composeAgentTurnPrompt, createPromptProcessorRegistry, type ToolDefinition } from '@loom-studio/application-runtime'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import type { PromptResourceNode } from '../../../packages/application-runtime/src/cards/workspace-types.js'
import type { PromptActivation } from '../../../packages/application-runtime/src/prompt/prompt-activation.js'
import { describe, expect, it, onTestFinished } from 'vitest'
import { playerEntity, playerProfilePath, playerProfileTemplateId } from '@loom-studio/shared'

function createFixture(tools: ToolDefinition[] = []) {
  let sequence = 0
  const createId = (prefix: string) => `${prefix}-${++sequence}`
  const now = () => '2026-09-21T00:00:00.000Z'
  const engine = createSqliteDataEngine({ filename: ':memory:', createId, now })
  const rootDirectory = mkdtempSync(join(tmpdir(), 'loom-default-preset-'))
  const blobs = createBlobStore({ engine, rootDirectory, createId, now })
  const assets = createAssetStore({ engine, blobs, createId, now })
  onTestFinished(async () => { await engine.close(); rmSync(rootDirectory, { recursive: true, force: true }) })
  const promptResources = createPromptResourceStore({ engine, createId, now })
  const calls: Array<Pick<AiGatewayRequest, 'messages' | 'tools'>> = []
  const promptProcessors = createPromptProcessorRegistry()
  const runtime = createApplicationRuntime({ blobs,
    mediaAssets: { get: id => assets.getMediaAsset(id) },
    dataEngine: engine,
    documents: createSqliteDocumentStore({ engine }),
    agents: createAgentStore({ engine, createId, now }),
    narratives: createNarrativeStore({ engine, createId, now }),
    promptResources,
    promptProcessors,
    agentTools: createAgentToolRegistry(tools, tools.map(tool => ({
      toolId: tool.id,
      execute: ({ invocation }) => ({
        invocationId: invocation.id, toolId: tool.id, status: 'completed' as const, content: [],
      }),
    }))),
    gateway: {
      invokeChat: async input => {
        calls.push(structuredClone({ messages: input.request.messages, tools: input.request.tools }))
        return {
          provider: 'fake', model: 'test-model',
          message: { role: 'assistant', content: 'SESSION_REPLY' }, text: 'SESSION_REPLY',
        }
      },
    },
  })
  return { engine, runtime, promptResources, calls, promptProcessors, assets }
}

function flatten(node: PromptResourceNode): PromptResourceNode[] {
  return [node, ...(node.children ?? []).flatMap(flatten)]
}

describe('bundled default preset', () => {
  it('copies a template avatar reference and validates custom profile media before creating a story', async () => {
    const { engine, runtime, assets } = createFixture()
    try {
      const image = (await assets.createMediaAsset({ kind: 'user.avatar', source: new TextEncoder().encode('image'),
        mediaType: 'image/png', actor: { kind: 'client', id: 'test' } })).asset
      const created = await runtime.createUserProfile({ expectedVersion: 0, name: 'Avatar user', description: '' })
      const profileId = created.config.currentProfileId!
      await runtime.updateUserProfile({ profileId, expectedVersion: created.config.version, avatarAssetId: image.id })
      const { card } = await runtime.createCard({ name: 'Avatar world' })
      const story = await runtime.createNarrativeTimeline({ cardId: card.id })
      await runtime.updateUserProfile({ profileId, expectedVersion: 2, avatarAssetId: null })
      const result = await runtime.getStateSnapshot({ target: { scope: 'timeline', timelineId: story.timeline.id, branchId: story.branch.id } })
      expect(result.playerProfile?.avatarAssetId).toBe(image.id)
      const before = await runtime.listNarrativeTimelines()
      await expect(runtime.createNarrativeTimeline({ cardId: card.id, playerProfile: { name: 'Invalid', description: '', avatarAssetId: 'missing' } }))
        .rejects.toThrow('Media Asset not found')
      expect(await runtime.listNarrativeTimelines()).toEqual(before)
    } finally { engine.close() }
  })

  it('freezes each story profile, reads branch edits in macros and Provider messages, and keeps unbound Agents global', async () => {
    const { engine, runtime, calls } = createFixture()
    try {
      const first = (await runtime.createUserProfile({ expectedVersion: 0, name: '林间', description: 'FIXED_FIRST' })).config
      const firstId = first.currentProfileId!
      const { resource: preset } = await runtime.createPromptResource({ resourceKind: 'preset', name: 'Writer' })
      const { resource: lore } = await runtime.createPromptResource({ resourceKind: 'lore', name: 'User relationships' })
      await runtime.createPromptResourceAsset({
        resourceId: lore.id, targetAssetId: lore.rootNode.id, position: 'inside',
        asset: { id: 'user-context', kind: 'entry', label: 'User context', body: '{{User}} is her brother.', capabilities: { targetAnchorId: '@user.context' } },
      })
      await runtime.replaceLoreMounts({ source: { kind: 'preset', id: preset.id }, loreResourceIds: [lore.id] })
      const { providerProfile } = await runtime.createProviderProfile({ providerExtensionId: 'official.openai-compatible', displayName: 'Test', config: {}, enabledModelIds: ['test-model'] })
      await runtime.updateAgentPreset({ agentPresetId: preset.id, name: 'Writer', expectedVersion: (await runtime.getPromptResource({ resourceId: preset.id })).resource.version, model: { providerProfileId: providerProfile.id, modelId: 'test-model' } })
      const { card } = await runtime.createCard({ name: 'Story', userName: 'CARD_AUTHOR', opening: '{{User}} enters.' })
      const storyA = await runtime.createNarrativeTimeline({ cardId: card.id })
      const storyB = await runtime.createNarrativeTimeline({ cardId: card.id, playerProfile: { name: '舟客', description: 'STORY_SECOND' } })
      expect(storyA.nodes[0]!.body.raw).toBe('林间 enters.')
      expect(storyB.nodes[0]!.body.raw).toBe('舟客 enters.')
      const sessions = await Promise.all([storyA, storyB].map(story => runtime.createAgentSession({ agentPresetId: preset.id, timelineId: story.timeline.id })))
      const before = await runtime.previewAgentTurn({ agentSessionId: sessions[0]!.session.id, input: 'Continue' })
      expect(before.messages.some(message => message.content === 'FIXED_FIRST\n\n林间 is her brother.')).toBe(true)
      const second = (await runtime.createUserProfile({ expectedVersion: first.version, name: '旅人', description: 'FIXED_SECOND' })).config
      for (const [index, { session }] of sessions.entries()) {
        const preview = await runtime.previewAgentTurn({ agentSessionId: session.id, input: 'Continue' })
        expect(preview.messages.some(message => message.content === (index === 0 ? 'FIXED_FIRST\n\n林间 is her brother.' : 'STORY_SECOND\n\n舟客 is her brother.'))).toBe(true)
        expect(preview.macroInspection.entries.find(entry => entry.name === 'user')?.value).toBe(index === 0 ? '林间' : '舟客')
      }
      const target = { scope: 'timeline' as const, timelineId: storyA.timeline.id, branchId: storyA.branch.id }
      const state = await runtime.getStateSnapshot({ target })
      const profilePointer = `/${playerProfilePath.replaceAll('.', '/')}`
      await runtime.applyStateMutation({ target, expectedRevisionId: state.snapshot.revisionId,
        operations: [{ op: 'set', path: `${profilePointer}/name`, value: '医师' }, { op: 'set', path: `${profilePointer}/description`, value: 'STORY_EDITED' }] })
      expect((await runtime.getStateSnapshot({ target })).playerProfile).toEqual({ name: '医师', description: 'STORY_EDITED' })
      expect((await runtime.inspectMacros({ timelineTarget: target })).macroInspection.entries.find(entry => entry.name === 'user')?.value).toBe('医师')
      const replaced = await runtime.replaceNarrativeOpening({ timelineId: storyB.timeline.id, branchId: storyB.branch.id,
        expectedHeadNodeId: storyB.branch.headNodeId ?? null, openingContent: '{{user}} returns.' })
      expect(replaced.nodes[0]!.body.raw).toBe('舟客 returns.')
      await runtime.invokeAgentTurn({ agentSessionId: sessions[0]!.session.id, input: 'Continue' })
      expect(calls[0]!.messages.some(message => message.content === 'STORY_EDITED\n\n医师 is her brother.')).toBe(true)
      expect((await runtime.getNarrativePage({ timelineId: storyA.timeline.id })).nodes[0]!.body.raw).toBe('林间 enters.')
      expect((await runtime.getCard({ cardId: card.id })).card.userName).toBe('CARD_AUTHOR')
      const restored = (await runtime.selectUserProfile({ expectedVersion: second.version, profileId: firstId })).config
      expect((await runtime.inspectMacros({ cardId: card.id })).macroInspection.entries.find(entry => entry.name === 'user.description')?.value).toBe('FIXED_FIRST')
      const isolated = await runtime.previewAgentTurn({ agentSessionId: sessions[0]!.session.id, input: 'Continue', contextMode: 'isolated' })
      expect(isolated.macroInspection.entries.find(entry => entry.name === 'user.description')?.value).toBe('')
      expect(isolated.macroInspection.entries.find(entry => entry.name === 'user')?.value).toBe('User')
      await runtime.deleteUserProfile({ expectedVersion: restored.version, profileId: firstId })
      expect((await runtime.inspectMacros({ cardId: card.id })).macroInspection.entries.find(entry => entry.name === 'user')?.value).toBe('User')
      expect((await runtime.getStateSnapshot({ target })).playerProfile?.name).toBe('医师')
    } finally { engine.close() }
  })

  it('keeps player profiles through branch forks, recovery and Timeline archive round trips', async () => {
    const { engine, runtime } = createFixture()
    try {
      const { card } = await runtime.createCard({ name: 'World', opening: 'Start' })
      const story = await runtime.createNarrativeTimeline({ cardId: card.id, playerProfile: { name: 'Original', description: 'Background' } })
      const target = { scope: 'timeline' as const, timelineId: story.timeline.id, branchId: story.branch.id }
      const state = await runtime.getStateSnapshot({ target })
      const path = `/${playerProfilePath.replaceAll('.', '/')}/name`
      const fork = await runtime.forkNarrativeBranch({ timelineId: story.timeline.id, fromBranchId: story.branch.id, fromNodeId: story.nodes[0]!.id })
      const forkTarget = { ...target, branchId: fork.branch.id }
      const changed = await runtime.applyStateMutation({ target: forkTarget, expectedRevisionId: state.snapshot.revisionId,
        operations: [{ op: 'set', path, value: 'Forked' }] })
      expect((await runtime.getStateSnapshot({ target })).playerProfile?.name).toBe('Original')
      expect((await runtime.getStateSnapshot({ target: forkTarget })).playerProfile?.name).toBe('Forked')
      await expect(runtime.applyStateMutation({ target: forkTarget, expectedRevisionId: changed.snapshot.revisionId,
        operations: [{ op: 'remove', path: '/$loom' }] })).rejects.toThrow('Bound Timeline State is missing')
      await runtime.revertChangeset({ changesetId: changed.mutation.changesetId })
      const reverted = await runtime.getStateSnapshot({ target: forkTarget })
      expect(reverted.playerProfile?.name).toBe('Original')
      await runtime.applyStateMutation({ target: forkTarget, expectedRevisionId: reverted.snapshot.revisionId,
        operations: [{ op: 'set', path, value: 'Forked' }] })
      const { archive } = await runtime.exportTimelineArchive({ timelineId: story.timeline.id })
      expect(archive.runtimeContext?.stateBindings.some(binding => binding.path === playerProfilePath)).toBe(true)
      const invalidArchive = structuredClone(archive)
      invalidArchive.state.revisions[0]!.snapshot.$loom = {
        players: { User: { components: { loom_profile: { name: 'Original', description: 'Background', hp: 10 } } } },
      }
      await expect(runtime.importTimelineArchive({ source: JSON.stringify(invalidArchive) })).rejects.toThrow('Additional property is not allowed')
      const imported = await runtime.importTimelineArchive({ source: JSON.stringify(archive) })
      const importedTarget = { ...target, timelineId: imported.timelineId, branchId: imported.idMap.branchIds[fork.branch.id]! }
      expect((await runtime.getStateSnapshot({ target: importedTarget })).playerProfile?.name).toBe('Forked')
      expect((await runtime.inspectMacros({ timelineTarget: importedTarget })).macroInspection.entries.find(entry => entry.name === 'user')?.value).toBe('Forked')
      const legacyArchive = structuredClone(archive)
      delete legacyArchive.runtimeContext
      for (const revision of legacyArchive.state.revisions) delete revision.snapshot.$loom
      const legacy = await runtime.importTimelineArchive({ source: JSON.stringify(legacyArchive) })
      const legacyTarget = { ...target, timelineId: legacy.timelineId, branchId: legacy.idMap.branchIds[story.branch.id]! }
      await runtime.createUserProfile({ expectedVersion: 0, name: 'Global', description: 'Legacy profile' })
      expect((await runtime.getStateSnapshot({ target: legacyTarget })).playerProfile).toBeUndefined()
      expect((await runtime.inspectMacros({ timelineTarget: legacyTarget })).macroInspection.entries.find(entry => entry.name === 'user')?.value).toBe('Global')
    } finally { engine.close() }
  })

  it('mounts author components on the built-in player and exports references without private profile contents', async () => {
    const { engine, runtime } = createFixture()
    try {
      const { card } = await runtime.createCard({ name: 'Author world', opening: '{{user}} arrives' })
      const template = { id: 'world.stats', templateVersion: 1, componentKey: 'stats',
        schema: { type: 'object', properties: { hp: { type: 'number', minimum: 0 } }, required: ['hp'], additionalProperties: false }, initial: { hp: 100 } }
      const mount = { templateId: template.id, templateVersion: 1, componentKey: 'stats', target: { kind: 'entity' as const, entity: playerEntity } }
      await runtime.updateCard({ cardId: card.id, stateTemplates: [template], timelineComponentMounts: [mount],
        stateEntityTypes: [{ id: 'person', collectionPath: 'people' }], timelineStateEntities: [{ typeId: 'person', entityId: 'User' }] })
      const story = await runtime.createNarrativeTimeline({ cardId: card.id, playerProfile: { name: 'PRIVATE_NAME', description: 'PRIVATE_DESCRIPTION' } })
      const target = { scope: 'timeline' as const, timelineId: story.timeline.id, branchId: story.branch.id }
      const state = await runtime.getStateSnapshot({ target })
      expect(state.snapshot.value).toMatchObject({ $loom: { players: { User: { components: { stats: { hp: 100 } } } } }, people: { User: { components: {} } } })
      const exported = await runtime.exportCardBundle({ cardId: card.id })
      expect(JSON.stringify(exported)).not.toContain('PRIVATE_')
      expect(exported.artifact.state?.contribution.entities).toEqual([{ typeId: 'person', entityId: 'User' }])
      const imported = await runtime.importCardBundle({ artifact: exported.artifact })
      const roundTrip = await runtime.createNarrativeTimeline({ cardId: imported.card.id })
      expect((await runtime.getStateSnapshot({ target: { ...target, timelineId: roundTrip.timeline.id, branchId: roundTrip.branch.id } })).snapshot.value)
        .toMatchObject({ $loom: { players: { User: { components: { stats: { hp: 100 } } } } } })
      await expect(runtime.updateCard({ cardId: card.id, stateTemplates: [{ ...template, id: playerProfileTemplateId }] })).rejects.toThrow('reserved')
      await expect(runtime.updateCard({ cardId: card.id, timelineStateBindings: [{ templateId: template.id, templateVersion: 1, path: '$loom.players.User' }] })).rejects.toThrow('reserved')
      await expect(runtime.updateCard({ cardId: card.id, timelineStateBindings: [{ templateId: template.id, templateVersion: 1, path: '*.*.*.components.*' }] })).rejects.toThrow('reserved')
    } finally { engine.close() }
  })

  it('runs registered processing in Preview and real Agent requests without changing stored resources', async () => {
    const { engine, runtime, calls, promptProcessors, promptResources } = createFixture()
    const modes: string[] = []
    promptProcessors.register({
      id: 'test/template',
      create: context => {
        modes.push(context.mode)
        return {
          prepare: entries => entries.map(entry => ({ id: entry.id, active: true })),
          render: entry => `PROCESSED:${entry.content}`,
        }
      },
    })
    try {
      const { resource: preset } = await runtime.createPromptResource({ resourceKind: 'preset', name: 'Processed' })
      await runtime.createPromptResourceAsset({
        resourceId: preset.id, targetAssetId: preset.rootNode.id, position: 'inside',
        asset: { id: 'template', kind: 'entry', label: 'Template', body: 'AUTHOR_SOURCE',
          capabilities: { processorId: 'test/template', activation: { kind: 'manual' } } },
      })
      const { providerProfile } = await runtime.createProviderProfile({
        providerExtensionId: 'official.openai-compatible', displayName: 'Test', config: {}, enabledModelIds: ['test-model'],
      })
      const { agentPreset } = await runtime.updateAgentPreset({
        name: 'Writer', agentPresetId: preset.id,
        expectedVersion: (await runtime.getPromptResource({ resourceId: preset.id })).resource.version,
        model: { providerProfileId: providerProfile.id, modelId: 'test-model' },
      })
      const { session } = await runtime.createAgentSession({ agentPresetId: agentPreset.id })
      const preview = await runtime.previewAgentTurn({ agentSessionId: session.id, input: 'hello' })
      const result = await runtime.invokeAgentTurn({ agentSessionId: session.id, input: 'hello' })
      expect(modes).toEqual(['preview', 'runtime'])
      expect(preview.messages.some(message => message.content?.includes('PROCESSED:AUTHOR_SOURCE'))).toBe(true)
      expect(calls[0]!.messages).toEqual(preview.messages)
      const observations = await runtime.listObservations({ kind: 'run', agentSessionId: session.id })
      const run = observations.records.find(record => record.status === 'completed')!
      expect(run).toBeDefined()
      const detail = await runtime.getObservation({ id: run.id })
      const build = detail!.children.find(record => record.kind === 'build')!
      const request = detail!.children.find(record => record.kind === 'request')!
      expect(build).toBeDefined()
      expect(request).toBeDefined()
      expect((await runtime.getObservationRequest({ id: request.id }))?.request?.messages).toEqual(calls[0]!.messages)
      expect((await runtime.getObservationBuild({ id: build.id }))?.build?.sources).toContainEqual(expect.objectContaining({
        original: 'AUTHOR_SOURCE', rendered: 'PROCESSED:AUTHOR_SOURCE', resourceId: preset.id,
      }))
      expect(result.promptBuildTrace.executions).toEqual([
        { processorId: 'test/template', stage: 'prepare' },
        { processorId: 'test/template', stage: 'render', entryId: expect.any(String) },
      ])
      const stored = await runtime.getPromptResource({ resourceId: preset.id })
      expect(flatten(stored.resource.rootNode).find(node => node.label === 'Template')?.body).toBe('AUTHOR_SOURCE')
      const accepted = await composeAgentTurnPrompt({
        agentMessages: [], promptResources, contextResourceIds: [],
        preset: stored.resource, userInput: 'hello',
        processing: { registry: promptProcessors, context: { mode: 'runtime', signal: new AbortController().signal } },
      })
      expect(accepted.processingSnapshot?.projection).not.toHaveProperty('observation')
      expect(accepted.processingSnapshot?.sourceNodes.some(node => node.evidence)).toBe(false)
      expect(accepted.promptBuildTrace.observation?.sources).toContainEqual(expect.objectContaining({
        resourceId: stored.resource.id, version: stored.resource.version, original: 'AUTHOR_SOURCE', rendered: 'PROCESSED:AUTHOR_SOURCE',
      }))
      const resumed = await composeAgentTurnPrompt({
        agentMessages: [], promptResources, contextResourceIds: [],
        preset: stored.resource, userInput: 'hello',
        processing: { registry: promptProcessors, context: { mode: 'runtime', signal: new AbortController().signal } },
        resumeMessages: [{ role: 'user', content: 'CHECKPOINT' }],
        resumeProcessingSnapshot: accepted.processingSnapshot,
      })
      expect(modes).toEqual(['preview', 'runtime', 'runtime'])
      expect(resumed.messages.map(message => message.content)).toEqual(['CHECKPOINT'])
      expect(resumed.promptBuildTrace.executions).toEqual([])
      expect(resumed.toolExecutionScope.context).toEqual(accepted.toolExecutionScope.context)
      await runtime.updatePromptResourceAsset({
        resourceId: preset.id, assetId: flatten(stored.resource.rootNode).find(node => node.label === 'Template')!.id,
        body: 'EDITED_AFTER_BUILD',
      })
      expect((await runtime.getObservationBuild({ id: build.id }))?.build?.sources).toContainEqual(expect.objectContaining({
        original: 'AUTHOR_SOURCE', rendered: 'PROCESSED:AUTHOR_SOURCE',
      }))
    } finally {
      engine.close()
    }
  })
  it.each(['ordered', 'empty'] as const)('uses effective history transforms in provider requests (%s)', async mode => {
    const { engine, runtime, calls } = createFixture()
    try {
      const { resource: preset } = await runtime.createPromptResource({ resourceKind: 'preset', name: 'Transforms' })
      const { card } = await runtime.createCard({ name: 'Story', opening: 'HISTORY_RAW' })
      const { timeline } = await runtime.createNarrativeTimeline({ cardId: card.id })
      const { providerProfile } = await runtime.createProviderProfile({
        providerExtensionId: 'official.openai-compatible', displayName: 'Test', config: {}, enabledModelIds: ['test-model'],
      })
      const { agentPreset } = await runtime.updateAgentPreset({
        name: 'Writer', agentPresetId: preset.id, expectedVersion: (await runtime.getPromptResource({ resourceId: preset.id })).resource.version,
        model: { providerProfileId: providerProfile.id, modelId: 'test-model' },
      })
      const { session } = await runtime.createAgentSession({ agentPresetId: agentPreset.id, timelineId: timeline.id })
      await runtime.invokeAgentTurn({ agentSessionId: session.id, input: 'HISTORY_RAW' })
      for (const [ruleId, orderIndex, pattern, replacement] of [
        ['finish', 0, 'HISTORY_INTERMEDIATE', mode === 'empty' ? '' : 'HISTORY_FINAL'],
        ['start', 1, 'HISTORY_RAW', 'HISTORY_INTERMEDIATE'],
      ] as const) {
        await runtime.upsertTextTransformRule({
          ruleId,
          rule: {
            name: ruleId, owner: { kind: 'preset', presetId: preset.id }, enabled: true, orderIndex,
            matcher: { kind: 'regex', pattern, flags: 'g' },
            effect: { kind: 'replace', replacement },
            targets: ['narrative', 'agent-session'], phases: ['prompt'],
          },
        })
      }
      const page = await runtime.getNarrativePage({ timelineId: timeline.id })
      for (const source of [
        { kind: 'agent-session' as const, sessionId: session.id },
        { kind: 'narrative' as const, timelineId: timeline.id, branchId: page.branch.id },
      ]) {
        await runtime.upsertTextPipelineOverride({
          source, phase: 'prompt',
          consumerAgentSessionId: source.kind === 'narrative' ? session.id : undefined,
          disabledRuleIds: [], orderedRuleIds: ['start', 'finish'],
        })
      }
      const preview = await runtime.previewAgentTurn({ agentSessionId: session.id, input: 'CURRENT_INPUT' })
      await runtime.invokeAgentTurn({ agentSessionId: session.id, input: 'CURRENT_INPUT' })
      expect(calls[1]!.messages).toEqual(preview.messages)
      expect(preview.promptBuildTrace.observation?.transformations).toContainEqual(expect.objectContaining({
        kind: 'history-projection', before: 'HISTORY_RAW', after: mode === 'empty' ? '' : 'HISTORY_FINAL', appliedRuleIds: ['start', 'finish'],
      }))
      const contents = preview.messages.map(message => message.content)
      expect(contents.filter(content => content === 'HISTORY_FINAL')).toHaveLength(mode === 'ordered' ? 2 : 0)
      expect(JSON.stringify(contents)).not.toMatch(/HISTORY_RAW|HISTORY_INTERMEDIATE/)
      expect(contents).toContain('SESSION_REPLY')
      expect(contents).toContain('CURRENT_INPUT')
      const canonical = await runtime.getAgentTranscriptPage({ agentSessionId: session.id })
      expect(canonical.entries.filter(entry => entry.entry.kind === 'message').map(entry => entry.entry.kind === 'message' && entry.entry.content)).toContain('HISTORY_RAW')
      const projected = await runtime.projectHistory({ source: { kind: 'agent-session', sessionId: session.id }, phase: 'prompt' })
      expect(projected.snapshot.matches).toHaveLength(2)
      expect(projected.snapshot.entries.some(entry => entry.text.includes('HISTORY_RAW'))).toBe(false)
      expect((await runtime.getNarrativePage({ timelineId: timeline.id })).nodes[0]!.body.raw).toBe('HISTORY_RAW')
    } finally {
      engine.close()
    }
  })

  it('connects native sources to the final provider request without merging Session messages', async () => {
    const tools: ToolDefinition[] = [
      {
        id: 'test/native', owner: { namespace: 'test' }, name: 'native_read',
        description: 'NATIVE_SCHEMA_ONLY',
        input: { kind: 'structured', schema: { type: 'object', properties: {} } },
      },
      {
        id: 'test/content', owner: { namespace: 'test' }, name: 'content_write',
        description: 'CONTENT_TOOL_DEFINITION',
        input: { kind: 'freeform', mediaType: 'text/plain' },
      },
    ]
    const { engine, runtime, calls } = createFixture(tools)
    try {
      const { resource: preset } = await runtime.createPromptResource({ resourceKind: 'preset', name: 'Default Copy' })
      await runtime.replacePresetToolMounts({
        presetId: preset.id,
        mounts: tools.map((tool, index) => ({ toolId: tool.id, orderIndex: index, defaultEnabled: true })),
      })
      const { resource: setting } = await runtime.createPromptResource({ resourceKind: 'lore', name: 'Story' })
      for (const [id, anchor, activation] of [
        ['STABLE_SETTING', '@lore.stable', { kind: 'always' as const }],
        ['DYNAMIC_SETTING', '@lore.lower', { kind: 'keyword' as const, keywords: ['CURRENT_INPUT'] }],
      ] satisfies Array<[string, string, PromptActivation]>) {
        await runtime.createPromptResourceAsset({
          resourceId: setting.id, targetAssetId: setting.rootNode.id, position: 'inside',
          asset: { id, kind: 'entry', label: id, body: id, capabilities: { targetAnchorId: anchor, activation } },
        })
      }
      await runtime.replaceLoreMounts({ source: { kind: 'preset', id: preset.id }, loreResourceIds: [setting.id] })
      const { card } = await runtime.createCard({ name: 'Story', opening: 'NARRATIVE_RAW' })
      const { timeline } = await runtime.createNarrativeTimeline({ cardId: card.id })
      await runtime.upsertTextTransformRule({
        ruleId: 'narrative-prompt-rule',
        rule: {
          name: 'Projection', owner: { kind: 'preset', presetId: preset.id }, enabled: true, orderIndex: 0,
          matcher: { kind: 'regex', pattern: 'NARRATIVE_RAW', flags: 'g' },
          effect: { kind: 'replace', replacement: 'NARRATIVE_PROJECTED' },
          targets: ['narrative'], phases: ['prompt'],
        },
      })
      const { providerProfile } = await runtime.createProviderProfile({
        providerExtensionId: 'official.openai-compatible', displayName: 'Test', config: {}, enabledModelIds: ['test-model'],
      })
      const { agentPreset } = await runtime.updateAgentPreset({
        name: 'Writer', agentPresetId: preset.id, expectedVersion: (await runtime.getPromptResource({ resourceId: preset.id })).resource.version,
        model: { providerProfileId: providerProfile.id, modelId: 'test-model' },
      })
      const { session } = await runtime.createAgentSession({ agentPresetId: agentPreset.id, timelineId: timeline.id })
      await runtime.invokeAgentTurn({ agentSessionId: session.id, input: 'PREVIOUS_USER' })
      const preview = await runtime.previewAgentTurn({ agentSessionId: session.id, input: 'CURRENT_INPUT' })
      await runtime.invokeAgentTurn({ agentSessionId: session.id, input: 'CURRENT_INPUT' })
      const request = calls[1]!
      expect(request.messages).toEqual(preview.messages)
      expect(request.messages.map(message => message.role)).toEqual([
        'system', 'system', 'system', 'system', 'system', 'user', 'assistant', 'system', 'user',
      ])
      const contents = request.messages.map(message => message.content)
      expect(contents[0]).toContain('清晰自然')
      expect(contents[1]).toContain('CONTENT_TOOL_DEFINITION')
      expect(contents[2]).toContain('<lore>\n\nSTABLE_SETTING\n\n</lore>')
      expect(contents.slice(3)).toEqual([
        'NARRATIVE_PROJECTED', expect.stringContaining('共同工作记忆'), 'PREVIOUS_USER', 'SESSION_REPLY', 'DYNAMIC_SETTING', 'CURRENT_INPUT',
      ])
      expect(request.messages.slice(0, 4)).toEqual(calls[0]!.messages.slice(0, 4))
      expect(JSON.stringify(request.messages)).not.toMatch(/NARRATIVE_RAW|NATIVE_SCHEMA_ONLY|\{\{/)
      expect(preview.macroInspection.entries.filter(entry => entry.name.startsWith('writing.')))
        .toHaveLength(3)
      expect(JSON.stringify(request.tools)).toContain('NATIVE_SCHEMA_ONLY')
      expect(JSON.stringify(request.tools)).not.toContain('CONTENT_TOOL_DEFINITION')
      expect(preview.toolExposures.map(tool => tool.transport)).toEqual(['native-function', 'content'])
      expect((await runtime.getNarrativePage({ timelineId: timeline.id })).nodes[0]!.body.raw).toBe('NARRATIVE_RAW')
    } finally {
      engine.close()
    }
  })

  it('instantiates independent nodes and macros for new and duplicated resources', async () => {
    const { engine, runtime } = createFixture()
    try {
      const first = (await runtime.createPromptResource({ resourceKind: 'preset', name: 'First' })).resource
      const second = (await runtime.createPromptResource({ resourceKind: 'preset', name: 'Second' })).resource
      const copy = (await runtime.duplicatePromptResource({ resourceId: first.id, name: 'Copy' })).resource
      const ids = [first, second, copy].flatMap(resource => flatten(resource.rootNode).map(node => node.id))
      expect(new Set(ids).size).toBe(ids.length)
      const firstEntry = flatten(copy.rootNode).find(node => node.kind === 'entry')!
      const updated = await runtime.updatePromptResourceAsset({ resourceId: copy.id, assetId: firstEntry.id, body: 'COPY_ONLY' })
      await runtime.updatePromptResourceMacros({
        resourceId: copy.id, expectedVersion: updated.resource.version, macros: { 'writing.style': 'COPY_STYLE' },
      })
      expect((await runtime.getPromptResource({ resourceId: first.id })).resource).toEqual(first)
      expect((await runtime.getPromptResource({ resourceId: second.id })).resource).toEqual(second)
      const changed = (await runtime.getPromptResource({ resourceId: copy.id })).resource
      expect(flatten(changed.rootNode).find(node => node.id === firstEntry.id)?.body).toBe('COPY_ONLY')
      expect(changed.macros?.['writing.style']).toBe('COPY_STYLE')
    } finally {
      engine.close()
    }
  })

  it('routes reserved contributions to separate ordered regions and leaves empty regions absent', async () => {
    const { engine, runtime, promptResources } = createFixture()
    try {
      const { resource: preset } = await runtime.createPromptResource({ resourceKind: 'preset', name: 'Slots' })
      const anchors = [
        '@memory.narrative', '@memory.session', '@runtime.state', '@memory.recalled',
        '@tools.dynamic', '@prompt.tail', '@fresh.tail', '@runtime.workspace', '@runtime.notices',
      ]
      const result = await composeAgentTurnPrompt({
        preset, promptResources, contextResourceIds: [], agentMessages: [], userInput: 'LATEST_INPUT',
        externalRuntime: {
          sourceNodes: [],
          contributions: anchors.map(anchor => ({
            id: anchor, sourceRef: { kind: 'runtime', sourceId: 'test', sourceNodeId: anchor },
            content: anchor, capabilities: { targetAnchorId: anchor },
          })),
        },
      })
      expect(result.messages.map(message => message.content).slice(2)).toEqual([
        '@memory.narrative', '@memory.session', '@runtime.state\n\n@memory.recalled\n\n@tools.dynamic',
        'LATEST_INPUT', '@prompt.tail\n\n@fresh.tail', '@runtime.workspace', '@runtime.notices',
      ])
      const empty = await composeAgentTurnPrompt({ preset, promptResources, contextResourceIds: [], agentMessages: [], userInput: 'LATEST_INPUT' })
      expect(empty.messages).toHaveLength(3)
    } finally {
      engine.close()
    }
  })

  it('keeps new inline entries at their tree position and honors ancestor switches and activation', async () => {
    const { engine, runtime, promptResources } = createFixture()
    try {
      const { resource: preset } = await runtime.createPromptResource({ resourceKind: 'preset', name: 'Editing' })
      const inputBlock = preset.rootNode.children!.find(node => node.capabilities?.roleHint === 'user')!
      const inserted = await runtime.createPromptResourceAsset({
        resourceId: preset.id, targetAssetId: inputBlock.id, position: 'inside',
        asset: { id: 'inline-example', kind: 'entry', label: 'After input', body: 'INLINE_AFTER_INPUT' },
      })
      const compile = async (userInput: string) => composeAgentTurnPrompt({
        preset: (await runtime.getPromptResource({ resourceId: preset.id })).resource,
        promptResources, contextResourceIds: [], agentMessages: [], userInput,
      })
      expect(flatten(inserted.resource.rootNode).find(node => node.body === 'INLINE_AFTER_INPUT')?.capabilities?.targetAnchorId)
        .toBeUndefined()
      expect((await compile('CURRENT')).messages.at(-1))
        .toMatchObject({ role: 'user', content: 'CURRENT\n\nINLINE_AFTER_INPUT' })
      await runtime.updatePromptResourceAsset({
        resourceId: preset.id, assetId: inputBlock.id,
        capabilities: { roleHint: 'user', activation: { kind: 'keyword', keywords: ['MATCH'] } },
      })
      expect(JSON.stringify((await compile('NO')).messages)).not.toContain('INLINE_AFTER_INPUT')
      expect(JSON.stringify((await compile('MATCH')).messages)).toContain('INLINE_AFTER_INPUT')
      await runtime.updatePromptResourceAsset({ resourceId: preset.id, assetId: inputBlock.id, enabled: false })
      expect(JSON.stringify((await compile('MATCH')).messages)).not.toContain('INLINE_AFTER_INPUT')
    } finally {
      engine.close()
    }
  })
})
