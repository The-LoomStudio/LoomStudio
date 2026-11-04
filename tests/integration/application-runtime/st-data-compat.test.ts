import { createBlobStore } from '@loom-studio/asset-store'
import { mkdtempSync, rmSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi, onTestFinished } from 'vitest'
import { createAgentStore, createNarrativeStore, createPromptResourceStore } from '@loom-studio/application-data'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import {
  createApplicationRuntime, createPromptProcessorRegistry, createStateContributionRegistry,
  createStateContentRegistry, type ApplicationRuntimeOptions, type RuntimeRequestContext,
} from '@loom-studio/application-runtime'
import type { ExtensionActivationContext } from '@loom-studio/extension-sdk'
// This suite deliberately exercises the shipped worker, not an in-process parser substitute.
import { registerStDataRuntime } from '../../../extensions/st-data-compat/dist/runtime/register.js'
import { convertSillyTavernCard } from '../../../extensions/st-data-compat/src/normalizer/card.js'

function open(filename: string, invokeChat: NonNullable<ApplicationRuntimeOptions['gateway']>['invokeChat']) {
  const engine = createSqliteDataEngine({ filename, createId: prefix => `${prefix}-${randomUUID()}`, now: () => new Date().toISOString() })
  const blobDirectory = mkdtempSync(join(tmpdir(), 'loom-st-data-compat-blobs-'))
  onTestFinished(() => rmSync(blobDirectory, { recursive: true, force: true }))
  const blobs = createBlobStore({ engine, rootDirectory: blobDirectory, createId: prefix => `${prefix}-${randomUUID()}`, now: () => new Date().toISOString() })
  const agents = createAgentStore({ engine })
  const documents = createSqliteDocumentStore({ engine })
  const promptProcessors = createPromptProcessorRegistry()
  const stateContributions = createStateContributionRegistry()
  const stateContent = createStateContentRegistry()
  registerStDataRuntime({
    prompt: { registerProcessor: processor => promptProcessors.register(processor) },
    state: {
      contribute: (contribution, options) => stateContributions.register({
        contribution, initialize: options?.initialize,
        packageId: 'sillytavern.importer', packageVersion: '0.1.0', moduleId: 'server', instanceId: 'test',
      }),
      registerContentHandler: handler => stateContent.register(handler, {
        packageId: 'sillytavern.importer', target: { kind: 'global' },
      }),
    },
  } as ExtensionActivationContext)
  const runtime = createApplicationRuntime({
    blobs, dataEngine: engine, agents, documents, narratives: createNarrativeStore({ engine }),
    promptResources: createPromptResourceStore({ engine }), promptProcessors, stateContributions, stateContent,
    gateway: { invokeChat },
  })
  return { engine, agents, runtime, stateContent, promptProcessors }
}

async function setup(runtime: ReturnType<typeof open>['runtime'], extraLore = '') {
  await runtime.initialize()
  const converted = convertSillyTavernCard({
    spec: 'chara_card_v2', spec_version: '2.0',
    data: {
      name: 'MVU fixture', description: '', personality: '', scenario: '', first_mes: 'Start', mes_example: '',
      creator_notes: '', system_prompt: '', post_history_instructions: '', alternate_greetings: [],
      tags: [], creator: '', character_version: '', extensions: {},
      character_book: { name: 'State Book', entries: [
        { id: 1, keys: [], content: 'hp: 10', comment: '[initvar]', enabled: false, insertion_order: 0 },
        ...(extraLore ? [{ id: 3, keys: [], content: extraLore, comment: 'Unrelated lore', enabled: false, insertion_order: 2 }] : []),
        { id: 2, keys: [], content: 'HP=<%- getvar("stat_data.hp") %>', comment: 'Current HP', enabled: true, constant: true, insertion_order: 1 },
      ] },
    },
  })
  const { card } = await runtime.importCardBundle({ artifact: converted.artifact })
  const { timeline, branch } = await runtime.createNarrativeTimeline({ cardId: card.id })
  const preset = (await runtime.createPromptResource({ resourceKind: 'preset', name: 'MVU Test' })).resource
  const provider = (await runtime.createProviderProfile({
    providerExtensionId: 'official.openai-compatible', displayName: 'Fixture', config: {}, enabledModelIds: ['test'],
  })).providerProfile
  await runtime.updateAgentPreset({ agentPresetId: preset.id, expectedVersion: preset.version,
    model: { providerProfileId: provider.id, modelId: 'test' } })
  const { session } = await runtime.createAgentSession({ agentPresetId: preset.id, timelineId: timeline.id })
  return { session, target: { timelineId: timeline.id, branchId: branch.id } }
}

const answer = "Damage. _.add('hp', -3);"
const response = (text = answer) => ({ provider: 'fixture', model: 'test', text, message: { role: 'assistant' as const, content: text } })
const hp = (value: Record<string, any>) => value.mvu.stat_data.hp

describe('STBridge complete data path', () => {
  it('initializes imported initvar, renders latest State, accepts original commands, reloads and follows native revert', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'loom-mvu-'))
    const filename = join(directory, 'data.sqlite')
    const invoke = vi.fn<NonNullable<ApplicationRuntimeOptions['gateway']>['invokeChat']>(async input => {
      expect(input.request.messages.some(message => message.content?.includes('HP=10'))).toBe(true)
      return response()
    })
    let fixture = open(filename, invoke)
    try {
      const { session, target } = await setup(fixture.runtime)
      const stateTarget = { scope: 'timeline' as const, ...target }
      const original = (await fixture.runtime.getStateSnapshot({ target: stateTarget })).snapshot
      expect(hp(original.value)).toBe(10)
      await fixture.runtime.invokeAgentTurn({ agentSessionId: session.id, input: 'Attack', narrativeTarget: target })
      expect(hp((await fixture.runtime.getStateSnapshot({ target: stateTarget })).snapshot.value)).toBe(7)
      await fixture.engine.close()
      fixture = open(filename, invoke)
      const restored = (await fixture.runtime.getStateSnapshot({ target: stateTarget })).snapshot
      expect(hp(restored.value)).toBe(7)
      const preview = await fixture.runtime.previewAgentTurn({ agentSessionId: session.id, input: 'Next', narrativeTarget: target })
      expect(preview.messages.some(message => message.content?.includes('HP=7'))).toBe(true)
      const mutation = await fixture.runtime.applyStateMutation({
        target: stateTarget, expectedRevisionId: restored.revisionId,
        operations: [{ op: 'set', path: '/mvu/stat_data/hp', value: 2 }],
      })
      await fixture.runtime.revertChangeset({ changesetId: mutation.mutation.changesetId })
      expect(hp((await fixture.runtime.getStateSnapshot({ target: stateTarget })).snapshot.value)).toBe(7)
      const reverted = await fixture.runtime.previewAgentTurn({ agentSessionId: session.id, input: 'After revert', narrativeTarget: target })
      expect(reverted.messages.some(message => message.content?.includes('HP=7'))).toBe(true)
      expect(invoke).toHaveBeenCalledOnce()
    } finally { await fixture.engine.close(); await rm(directory, { recursive: true, force: true }) }
  })

  it('keeps current Timeline storage, EJS reads, updates and revert on the /mvu address after reload', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'loom-mvu-legacy-'))
    const filename = join(directory, 'data.sqlite')
    let fixture = open(filename, async () => response())
    try {
      const { session, target } = await setup(fixture.runtime)
      await fixture.engine.close()
      fixture = open(filename, async () => response())
      await fixture.runtime.initialize()
      const stateTarget = { scope: 'timeline' as const, ...target }
      const storedHp = (value: Record<string, any>) => value.mvu.stat_data.hp
      const original = (await fixture.runtime.getStateSnapshot({ target: stateTarget })).snapshot
      expect(original.value).not.toHaveProperty('entities.stCompatibility')
      expect(storedHp(original.value)).toBe(10)
      const preview = await fixture.runtime.previewAgentTurn({ agentSessionId: session.id, input: 'Next', narrativeTarget: target })
      expect(preview.messages.some(message => message.content?.includes('HP=10'))).toBe(true)
      await fixture.runtime.invokeAgentTurn({ agentSessionId: session.id, input: 'Attack', narrativeTarget: target })
      const updated = (await fixture.runtime.getStateSnapshot({ target: stateTarget })).snapshot
      expect(storedHp(updated.value)).toBe(7)
      expect(updated.value).not.toHaveProperty('entities.stCompatibility')
      const changed = await fixture.runtime.applyStateMutation({
        target: stateTarget, expectedRevisionId: updated.revisionId,
        operations: [{ op: 'set', path: '/mvu/stat_data/hp', value: 2 }],
      })
      await fixture.runtime.revertChangeset({ changesetId: changed.mutation.changesetId })
      expect(storedHp((await fixture.runtime.getStateSnapshot({ target: stateTarget })).snapshot.value)).toBe(7)
    } finally { await fixture.engine.close(); await rm(directory, { recursive: true, force: true }) }
  })

  it('does not send unrelated large worldbook bodies to the MVU initializer', async () => {
    const fixture = open(':memory:', async () => response())
    try {
      const { target } = await setup(fixture.runtime, 'x'.repeat(2_100_000))
      const snapshot = (await fixture.runtime.getStateSnapshot({ target: { scope: 'timeline', ...target } })).snapshot
      expect(hp(snapshot.value)).toBe(10)
      expect(snapshot.value.entities).toBeUndefined()
    } finally { await fixture.engine.close() }
  })

  it('replays an accepted State commit after transcript failure without re-running MVU or the Provider', async () => {
    const invoke = vi.fn(async () => response())
    const fixture = open(':memory:', invoke)
    try {
      const { session, target } = await setup(fixture.runtime)
      const process = vi.spyOn(fixture.stateContent, 'process')
      const append = fixture.agents.appendEntries.bind(fixture.agents)
      let fail = true
      vi.spyOn(fixture.agents, 'appendEntries').mockImplementation(async input => {
        if (fail && input.entries.some(item => item.entry.kind === 'run-state' && item.entry.state === 'completed')) {
          fail = false
          throw new Error('Simulated transcript failure after State commit')
        }
        return append(input)
      })
      await expect(fixture.runtime.invokeAgentTurn({
        agentSessionId: session.id, input: 'Attack', narrativeTarget: target,
      }, { agentRun: { runId: 'mvu-original', onEvent: () => {} } })).rejects.toThrow('Simulated transcript failure')
      const stateTarget = { scope: 'timeline' as const, ...target }
      const before = (await fixture.runtime.getStateSnapshot({ target: stateTarget })).snapshot
      expect(hp(before.value)).toBe(7)
      const recovery = await fixture.runtime.prepareAgentRunRecovery({ agentSessionId: session.id })
      expect(recovery?.continuation.recovery.phase).toBe('content')
      await fixture.runtime.invokeAgentTurn(recovery!.request, {
        agentRun: { runId: 'mvu-resume', onEvent: () => {}, continuation: recovery!.continuation },
      })
      expect((await fixture.runtime.getStateSnapshot({ target: stateTarget })).snapshot.revisionId).toBe(before.revisionId)
      expect(invoke).toHaveBeenCalledOnce()
      expect(process).toHaveBeenCalledOnce()
    } finally { await fixture.engine.close() }
  })

  it('waits for complete output and combines a length continuation', async () => {
    let step = 0
    const fixture = open(':memory:', async () => ++step === 1
      ? { ...response("_.add('hp',"), finishReason: 'length' }
      : response(' -3);'))
    try {
      const { session, target } = await setup(fixture.runtime)
      await fixture.runtime.invokeAgentTurn({ agentSessionId: session.id, input: 'Attack', narrativeTarget: target })
      expect(hp((await fixture.runtime.getStateSnapshot({ target: { scope: 'timeline', ...target } })).snapshot.value)).toBe(7)
    } finally { await fixture.engine.close() }
  })

  it('ignores commands in classified reasoning and never runs model-output EJS', async () => {
    const fixture = open(':memory:', async () => response("<think>_.add('hp', -90);</think><% throw Error('not a template') %>_.add('hp', -3);"))
    try {
      const { session, target } = await setup(fixture.runtime)
      await fixture.runtime.upsertTextTransformRule({
        ruleId: 'workspace.think',
        rule: {
          name: 'Think', owner: { kind: 'workspace' }, enabled: true, orderIndex: 0,
          matcher: { kind: 'regex', pattern: '<think>([\\s\\S]*?)</think>', flags: 'g' },
          effect: { kind: 'promote-reasoning', contentGroup: 1, visibility: 'collapsed', replay: 'omit', dialect: 'think' },
          targets: ['agent-session'], phases: ['classify'],
        },
      })
      await fixture.runtime.invokeAgentTurn({ agentSessionId: session.id, input: 'Attack', narrativeTarget: target })
      expect(hp((await fixture.runtime.getStateSnapshot({ target: { scope: 'timeline', ...target } })).snapshot.value)).toBe(7)
    } finally { await fixture.engine.close() }
  })

  it('does not commit a streamed partial and resumes its split command only once', async () => {
    let step = 0
    const controller = new AbortController()
    const fixture = open(':memory:', async input => {
      if (++step > 1) return response(' -3);')
      input.onEvent?.({ type: 'text-delta', runId: 'provider-partial', delta: "_.add('hp'," })
      controller.abort('user-pause')
      throw Object.assign(new Error('Paused'), { name: 'AbortError' })
    })
    try {
      const { session, target } = await setup(fixture.runtime)
      let checkpoint: Parameters<NonNullable<NonNullable<RuntimeRequestContext['agentRun']>['onSuspended']>>[0] | undefined
      const create = vi.spyOn(fixture.promptProcessors, 'create')
      await expect(fixture.runtime.invokeAgentTurn({
        agentSessionId: session.id, input: 'Attack', narrativeTarget: target,
      }, { abortSignal: controller.signal, agentRun: {
        runId: 'stream-original', onEvent: () => {}, onSuspended: value => { checkpoint = value },
      } })).rejects.toThrow('Paused')
      const stateTarget = { scope: 'timeline' as const, ...target }
      expect(hp((await fixture.runtime.getStateSnapshot({ target: stateTarget })).snapshot.value)).toBe(10)
      expect(checkpoint?.recovery?.pendingAssistantContent).toBe("_.add('hp',")
      await fixture.runtime.invokeAgentTurn(checkpoint!.recovery!.request, {
        agentRun: { runId: 'stream-resume', onEvent: () => {}, continuation: checkpoint! },
      })
      expect(hp((await fixture.runtime.getStateSnapshot({ target: stateTarget })).snapshot.value)).toBe(7)
      expect(create).toHaveBeenCalledOnce()
    } finally { await fixture.engine.close() }
  })
})
