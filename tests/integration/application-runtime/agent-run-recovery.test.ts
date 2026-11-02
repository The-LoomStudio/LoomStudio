import { registerAgentExecutor, readInterruptedAgentRuns } from '../../../packages/application-runtime/src/agents/run-recovery.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createAgentStore, createNarrativeStore, createPromptResourceStore } from '@loom-studio/application-data'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { createAgentToolRegistry, createApplicationRuntime, createPromptProcessorRegistry, type ApplicationRuntimeOptions, type ToolDefinition } from '@loom-studio/application-runtime'
import { describe, expect, it, vi } from 'vitest'
import { callApplicationRpc as handleAgentsRpc } from '../../support/trpc-caller.js'

const tool: ToolDefinition = {
  id: 'official/checkpoint_probe', owner: { namespace: 'official' }, name: 'checkpoint_probe',
  description: 'Record one controlled side effect.',
  input: { kind: 'structured', schema: { type: 'object', properties: {} } },
}

type Execute = NonNullable<Parameters<typeof createAgentToolRegistry>[1]>[number]['execute']

function open(filename: string, invokeChat: NonNullable<ApplicationRuntimeOptions['gateway']>['invokeChat'], execute = vi.fn<Execute>(async ({ invocation }) => ({
  invocationId: invocation.id, toolId: invocation.toolId, status: 'completed', content: [{ type: 'text', text: 'Persisted result.' }],
}))) {
  const engine = createSqliteDataEngine({ filename, createId: prefix => `${prefix}-${randomUUID()}`, now: () => new Date().toISOString() })
  const agents = createAgentStore({ engine })
  const documents = createSqliteDocumentStore({ engine })
  const promptResources = createPromptResourceStore({ engine })
  const promptProcessors = createPromptProcessorRegistry()
  const runtime = createApplicationRuntime({
    dataEngine: engine, agents, documents, promptResources, narratives: createNarrativeStore({ engine }),
    gateway: { invokeChat }, agentTools: createAgentToolRegistry([tool], [{ toolId: tool.id, execute }]),
    promptProcessors,
  })
  return { engine, agents, runtime, execute, promptProcessors }
}

async function setup(runtime: ReturnType<typeof open>['runtime']) {
  await runtime.initialize()
  const preset = (await runtime.createPromptResource({ resourceKind: 'preset', name: 'Recovery' })).resource
  const provider = (await runtime.createProviderProfile({
    providerExtensionId: 'official.openai-compatible', displayName: 'Recovery', config: {}, enabledModelIds: ['original', 'other'],
  })).providerProfile
  await runtime.replacePresetToolMounts({ presetId: preset.id, mounts: [{ toolId: tool.id, orderIndex: 0, defaultEnabled: true }] })
  await runtime.updateAgentPreset({
    agentPresetId: preset.id, expectedVersion: (await runtime.getPromptResource({ resourceId: preset.id })).resource.version,
    model: { providerProfileId: provider.id, modelId: 'original' },
  })
  const { card } = await runtime.createCard({ name: 'Recovery Card' })
  const { timeline, branch } = await runtime.createNarrativeTimeline({ cardId: card.id })
  const { session } = await runtime.createAgentSession({ agentPresetId: preset.id, timelineId: timeline.id })
  return { preset, provider, session, target: { timelineId: timeline.id, branchId: branch.id } }
}

describe('durable Agent Run recovery', () => {
  it.each([false, true])('reconciles stale markers but preserves live ownership (live=%s)', async live => {
    const gateway = vi.fn<NonNullable<ApplicationRuntimeOptions['gateway']>['invokeChat']>(async () => ({
      provider: 'test', model: 'test', text: 'Done', message: { role: 'assistant', content: 'Done' },
    }))
    const fixture = open(':memory:', gateway)
    const release = live ? registerAgentExecutor('stale-run') : () => {}
    try {
      const { session } = await setup(fixture.runtime)
      await fixture.agents.appendEntries({ actor: { kind: 'kernel', id: 'fixture' }, agentSessionId: session.id, expectedEntryCount: 0,
        entries: [
          { runId: 'stale-run', entry: { kind: 'run-state', state: 'running', recovery: { executor: { pid: process.pid, id: 'stale-run' } } } },
          { runId: 'later-failure', entry: { kind: 'run-state', state: 'failed', reason: 'Blocked by stale run' } },
        ] })
      const next = fixture.runtime.invokeAgentTurn({ agentSessionId: session.id, input: 'A fresh request' })
      if (live) {
        await expect(next).rejects.toMatchObject({ code: 'agent.session_busy' })
        expect(gateway).not.toHaveBeenCalled()
      } else {
        await next
        expect(gateway).toHaveBeenCalledTimes(1)
        const entries = await fixture.agents.listEntries(session.id)
        expect(entries.filter(item => item.runId === 'stale-run').at(-1)?.entry).toMatchObject({ kind: 'run-state', state: 'aborted' })
        await fixture.runtime.invokeAgentTurn({ agentSessionId: session.id, input: 'Another request' })
        expect(gateway).toHaveBeenCalledTimes(2)
      }
    } finally { release(); fixture.engine.close() }
  })

  it('finds an executing marker outside the adopted Timeline history', async () => {
    const fixture = open(':memory:', vi.fn())
    try {
      const { target } = await setup(fixture.runtime)
      const session = (await fixture.agents.getSession(target.timelineId))!
      await fixture.agents.appendEntries({ actor: { kind: 'kernel', id: 'fixture' }, agentSessionId: session.id,
        expectedEntryCount: session.entryCount,
        entries: [{ runId: 'unadopted-run', entry: { kind: 'run-state', state: 'running', recovery: { executor: { pid: process.pid, id: 'unadopted-run' } } } }] })
      await fixture.engine.transact({ actor: { kind: 'kernel', id: 'fixture' } }, async tx => {
        fixture.agents.transaction(tx).setTimelineHead({ agentSessionId: session.id, headEntryId: session.headEntryId ?? null })
      })
      expect((await fixture.agents.getEntryPage({ agentSessionId: session.id })).entries.some(item => item.runId === 'unadopted-run')).toBe(false)
      expect((await readInterruptedAgentRuns(fixture.agents, session.id, 'next-run')).interrupted).toEqual(['unadopted-run'])
    } finally { fixture.engine.close() }
  })

  it('finds an acknowledged send from its durable checkpoint after server replacement', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'loom-send-recovery-'))
    const filename = join(directory, 'data.sqlite')
    let calls = 0
    const invokeChat = async () => {
      calls++
      return { provider: 'test', model: 'test', text: 'Done', message: { role: 'assistant' as const, content: 'Done' } }
    }
    const first = open(filename, invokeChat)
    let second: ReturnType<typeof open> | undefined
    try {
      const { session } = await setup(first.runtime)
      const request = { requestId: 'durable-send', agentSessionId: session.id, input: 'Persist once' }
      const created = await handleAgentsRpc(first.runtime, 'application.agent.run.create', request) as { runId: string }
      for (let n = 0; n < 100; n++) {
        const state = await handleAgentsRpc(first.runtime, 'application.agent.run.state', { runId: created.runId }) as { state: string }
        if (state.state !== 'running') break
        await new Promise<void>(resolve => setTimeout(resolve, 5))
      }
      expect(calls).toBe(1)
      second = open(filename, invokeChat)
      expect(await handleAgentsRpc(second.runtime, 'application.agent.run.create', request)).toEqual(created)
      expect(calls).toBe(1)
      const { entries } = await second.runtime.getAgentTranscriptPage({ agentSessionId: session.id })
      expect(entries.filter(entry => entry.entry.kind === 'message' && entry.entry.role === 'user')).toHaveLength(1)
      await expect(handleAgentsRpc(second.runtime, 'application.agent.run.create', { ...request, input: 'Changed' })).rejects.toThrow('different input')
    } finally { second?.engine.close(); first.engine.close(); await rm(directory, { recursive: true, force: true }) }
  })
  it('does not strand a running marker when a provider emits only whitespace before failure', async () => {
    const fixture = open(':memory:', async input => {
      input.onEvent?.({ type: 'text-delta', runId: 'provider-run', delta: ' ' })
      throw new Error('Provider failed')
    })
    try {
      const { session } = await setup(fixture.runtime)
      await expect(fixture.runtime.invokeAgentTurn({ agentSessionId: session.id, input: 'Work.' })).rejects.toThrow('Provider failed')
      const page = await fixture.agents.getEntryPage({ agentSessionId: session.id, limit: 100 })
      expect(page.entries.findLast(entry => entry.entry.kind === 'run-state')?.entry).toMatchObject({ state: 'failed' })
      expect(page.entries.some(entry => entry.entry.kind === 'message' && entry.entry.role === 'assistant')).toBe(false)
      await expect(fixture.runtime.invokeAgentTurn({ agentSessionId: session.id, input: 'Retry.' })).rejects.toThrow('Provider failed')
    } finally { fixture.engine.close() }
  })

  it('records a minimal terminal state if recovery persistence fails', async () => {
    const fixture = open(':memory:', async () => { throw new Error('Provider failed') })
    try {
      const { session } = await setup(fixture.runtime)
      const append = fixture.agents.appendEntries.bind(fixture.agents)
      vi.spyOn(fixture.agents, 'appendEntries').mockImplementation(input => {
        if (input.entries.some(item => item.entry.kind === 'run-state' && item.entry.state === 'failed' && item.entry.recovery))
          throw new Error('Recovery persistence rejected')
        return append(input)
      })
      await expect(fixture.runtime.invokeAgentTurn({ agentSessionId: session.id, input: 'Work.' })).rejects.toThrow('Provider failed')
      const page = await fixture.agents.getEntryPage({ agentSessionId: session.id, limit: 100 })
      expect(page.entries.findLast(entry => entry.entry.kind === 'run-state')?.entry).toMatchObject({ state: 'failed' })
      await expect(fixture.runtime.invokeAgentTurn({ agentSessionId: session.id, input: 'Retry.' })).rejects.toThrow('Provider failed')
    } finally { fixture.engine.close() }
  })
  it('persists processed sources and resumes without executing an unloaded processor', async () => {
    let calls = 0
    const fixture = open(':memory:', async input => {
      expect(input.request.messages.some(message => message.content?.includes('ACCEPTED_TEMPLATE'))).toBe(true)
      if (++calls === 1) throw new Error('Interrupted after prompt acceptance')
      return { provider: 'test', model: 'original', text: 'Recovered.', message: { role: 'assistant', content: 'Recovered.' } }
    })
    const create = vi.fn(() => ({ render: () => 'ACCEPTED_TEMPLATE' }))
    const handle = fixture.promptProcessors.register({ id: 'test/recovery', create })
    try {
      const { session, preset } = await setup(fixture.runtime)
      await fixture.runtime.createPromptResourceAsset({
        resourceId: preset.id, targetAssetId: preset.rootNode.id, position: 'inside',
        asset: { id: 'template', kind: 'entry', label: 'Template', body: 'RAW_TEMPLATE', capabilities: { processorId: 'test/recovery' } },
      })
      await expect(fixture.runtime.invokeAgentTurn({ agentSessionId: session.id, input: 'Work.' }, {
        agentRun: { runId: 'processed-original', onEvent: () => {} },
      })).rejects.toThrow('Interrupted after prompt acceptance')
      handle.dispose()
      const recovery = await fixture.runtime.prepareAgentRunRecovery({ agentSessionId: session.id })
      expect(recovery?.continuation.recovery.processedPrompt?.contributions.some(entry => entry.content === 'ACCEPTED_TEMPLATE')).toBe(true)
      await fixture.runtime.invokeAgentTurn(recovery!.request, {
        agentRun: { runId: 'processed-resume', onEvent: () => {}, continuation: recovery!.continuation },
      })
      expect(create).toHaveBeenCalledOnce()
      expect(calls).toBe(2)
    } finally { fixture.engine.close() }
  })
  it('retains a cold checkpoint when preparation fails and resumes after the model is restored', async () => {
    let calls = 0
    const fixture = open(':memory:', async () => {
      if (++calls === 1) throw new Error('Initial interruption')
      return { provider: 'test', model: 'original', text: 'Recovered.', message: { role: 'assistant', content: 'Recovered.' } }
    })
    try {
      const { session, provider } = await setup(fixture.runtime)
      await expect(fixture.runtime.invokeAgentTurn({ agentSessionId: session.id, input: 'Work.' }, {
        agentRun: { runId: 'cold-original', onEvent: () => {} },
      })).rejects.toThrow('Initial interruption')
      await fixture.runtime.updateProviderProfile({ providerProfileId: provider.id, enabledModelIds: ['other'] })
      const invoke = vi.spyOn(fixture.runtime, 'invokeAgentTurn')
      const failed = await handleAgentsRpc(fixture.runtime, 'application.agent.run.resume', { agentSessionId: session.id }) as { runId: string }
      await expect(invoke.mock.results[0]!.value).rejects.toThrow('Provider model is not enabled')
      await fixture.runtime.updateProviderProfile({ providerProfileId: provider.id, enabledModelIds: ['original', 'other'] })
      await handleAgentsRpc(fixture.runtime, 'application.agent.run.resume', { runId: failed.runId })
      await invoke.mock.results[1]!.value
      expect(calls).toBe(2)
      const page = await fixture.agents.getEntryPage({ agentSessionId: session.id })
      expect(page.entries.filter(entry => entry.entry.kind === 'message' && entry.entry.role === 'user')).toHaveLength(1)
      expect(page.entries.at(-1)?.entry).toMatchObject({ kind: 'run-state', state: 'completed' })
    } finally { fixture.engine.close() }
  })

  it('allows only one concurrent recovery and rejects a stale takeover without another Provider call', async () => {
    let calls = 0
    const started = Promise.withResolvers<void>()
    const finish = Promise.withResolvers<void>()
    const fixture = open(':memory:', async () => {
      if (++calls === 1) throw new Error('Initial failure')
      started.resolve()
      await finish.promise
      return { provider: 'test', model: 'original', text: 'Done.', message: { role: 'assistant', content: 'Done.' } }
    })
    try {
      const { session } = await setup(fixture.runtime)
      await expect(fixture.runtime.invokeAgentTurn({ agentSessionId: session.id, input: 'Work.' }, {
        agentRun: { runId: 'failed-run', onEvent: () => {} },
      })).rejects.toThrow('Initial failure')
      const [left, right] = await Promise.all([
        fixture.runtime.prepareAgentRunRecovery({ agentSessionId: session.id }),
        fixture.runtime.prepareAgentRunRecovery({ agentSessionId: session.id }),
      ])
      const first = fixture.runtime.invokeAgentTurn(left!.request, {
        agentRun: { runId: 'first-recovery', onEvent: () => {}, continuation: left!.continuation },
      })
      await started.promise
      await expect(fixture.runtime.invokeAgentTurn(right!.request, {
        agentRun: { runId: 'competing-recovery', onEvent: () => {}, continuation: right!.continuation },
      })).rejects.toMatchObject({ code: 'agent.session_busy' })
      finish.resolve()
      await first
      const before = await fixture.agents.getEntryPage({ agentSessionId: session.id })
      await expect(fixture.runtime.invokeAgentTurn(right!.request, {
        agentRun: { runId: 'stale-recovery', onEvent: () => {}, continuation: right!.continuation },
      })).rejects.toMatchObject({ code: 'agent.entry_count_conflict' })
      expect(calls).toBe(2)
      expect(await fixture.agents.getEntryPage({ agentSessionId: session.id })).toEqual(before)
    } finally {
      finish.resolve()
      fixture.engine.close()
    }
  })

  it.each(['missing', 'invalid'])('rejects a %s checkpoint rather than guessing a prompt', async mode => {
    const gateway = vi.fn<NonNullable<ApplicationRuntimeOptions['gateway']>['invokeChat']>()
    const fixture = open(':memory:', gateway)
    try {
      const { session } = await setup(fixture.runtime)
      await fixture.agents.appendEntries({
        actor: { kind: 'kernel', id: 'fixture' }, agentSessionId: session.id, expectedEntryCount: 0,
        entries: [
          { runId: 'legacy', entry: { kind: 'message', role: 'user', content: 'Work.' } },
          { runId: 'legacy', entry: { kind: 'run-state', state: 'running', ...(mode === 'invalid' ? { recovery: { version: 999 } } : {}) } },
        ],
      })
      await expect(fixture.runtime.prepareAgentRunRecovery({ agentSessionId: session.id }))
        .rejects.toMatchObject({ code: `agent.recovery_checkpoint_${mode}` })
      expect(gateway).not.toHaveBeenCalled()
    } finally { fixture.engine.close() }
  })

  it.each(['model', 'tools'])('rejects changed %s without invoking a replacement or modifying the Transcript', async changed => {
    const gateway = vi.fn<NonNullable<ApplicationRuntimeOptions['gateway']>['invokeChat']>(async () => { throw new Error('Original failure') })
    const fixture = open(':memory:', gateway)
    try {
      const { session, provider, preset } = await setup(fixture.runtime)
      await expect(fixture.runtime.invokeAgentTurn({ agentSessionId: session.id, input: 'Work.' }, {
        agentRun: { runId: 'model-run', onEvent: () => {} },
      })).rejects.toThrow('Original failure')
      const recovered = await fixture.runtime.prepareAgentRunRecovery({ agentSessionId: session.id })
      if (changed === 'model') await fixture.runtime.updateProviderProfile({ providerProfileId: provider.id, enabledModelIds: ['other'] })
      else await fixture.runtime.replacePresetToolMounts({ presetId: preset.id, mounts: [] })
      const before = await fixture.agents.getEntryPage({ agentSessionId: session.id })
      await expect(fixture.runtime.invokeAgentTurn(recovered!.request, {
        agentRun: { runId: 'model-recovery', onEvent: () => {}, continuation: recovered!.continuation },
      })).rejects.toThrow(changed === 'model' ? 'Provider model is not enabled: original' : 'Agent tool contract changed')
      expect(gateway).toHaveBeenCalledOnce()
      expect(await fixture.agents.getEntryPage({ agentSessionId: session.id })).toEqual(before)
    } finally { fixture.engine.close() }
  })

  it('keeps partial text paired with its durable context and links the resumed assistant entry', async () => {
    let calls = 0
    const fixture = open(':memory:', async input => {
      if (++calls === 1) {
        input.onEvent?.({ type: 'text-delta', runId: 'provider-run', delta: 'The opening fragment.' })
        throw new Error('Stream interrupted')
      }
      expect(input.request.messages.at(-1)?.content).toContain('The opening fragment.')
      expect(input.request.messages.some(message => message.role === 'user' && message.content === 'Write.')).toBe(true)
      return { provider: 'test', model: 'original', text: 'The continuation.', message: { role: 'assistant', content: 'The continuation.' } }
    })
    try {
      const { session } = await setup(fixture.runtime)
      await expect(fixture.runtime.invokeAgentTurn({ agentSessionId: session.id, input: 'Write.' }, {
        agentRun: { runId: 'partial-run', onEvent: () => {} },
      })).rejects.toThrow('Stream interrupted')
      const recovered = await fixture.runtime.prepareAgentRunRecovery({ agentSessionId: session.id })
      expect(recovered?.continuation.partialEntryId).toBeDefined()
      const result = await fixture.runtime.invokeAgentTurn(recovered!.request, {
        agentRun: { runId: 'partial-recovered', onEvent: () => {}, continuation: recovered!.continuation },
      })
      expect(result.entries.assistant.entry).toMatchObject({
        kind: 'message', content: 'The continuation.', continuesEntryId: recovered!.continuation.partialEntryId,
      })
      expect(calls).toBe(2)
    } finally { fixture.engine.close() }
  })

  it.each([false, true])('resumes with the current preset model without repeating user or completed tools (afterTool=%s)', async afterTool => {
    const root = await mkdtemp(join(tmpdir(), 'loom-run-recovery-'))
    const filename = join(root, 'state.sqlite')
    let calls = 0
    const first = open(filename, async () => {
      if (afterTool && ++calls === 1) return {
        provider: 'test', model: 'original', text: '', finishReason: 'tool_call',
        message: { role: 'assistant', tool_calls: [{ id: 'effect', type: 'function', function: { name: tool.name, arguments: '{}' } }] },
      }
      throw new Error('Controlled interruption')
    })
    let reopened: ReturnType<typeof open> | undefined
    try {
      const { preset, provider, session, target } = await setup(first.runtime)
      await expect(first.runtime.invokeAgentTurn({ agentSessionId: session.id, input: 'Continue this work.', narrativeTarget: target }, {
        agentRun: { runId: 'original-run', onEvent: () => {} },
      })).rejects.toThrow('Controlled interruption')
      const page = await first.agents.getEntryPage({ agentSessionId: session.id, limit: 100 })
      const checkpoint = page.entries.findLast(entry => entry.entry.kind === 'run-state' && entry.entry.recovery)!
      if (checkpoint.entry.kind !== 'run-state') throw new Error('Checkpoint missing')
      // Simulate an executor disappearing after its durable boundary, with more than one page of telemetry.
      await first.agents.appendEntries({
        actor: { kind: 'kernel', id: 'fixture' }, agentSessionId: session.id, expectedEntryCount: page.session.entryCount,
        entries: [
          ...Array.from({ length: 110 }, () => ({
            runId: 'original-run', entry: { kind: 'reasoning' as const, content: 'telemetry', source: 'provider-native' as const, visibility: 'hidden' as const, replay: 'omit' as const },
          })),
          { runId: 'original-run', entry: { kind: 'run-state', state: 'running', recovery: checkpoint.entry.recovery } },
        ],
      })
      const replacement = (await first.runtime.createProviderProfile({
        providerExtensionId: 'official.openai-compatible', displayName: 'Replacement', config: {}, enabledModelIds: ['replacement-model'],
      })).providerProfile
      await first.runtime.updateAgentPreset({
        agentPresetId: preset.id, expectedVersion: (await first.runtime.getPromptResource({ resourceId: preset.id })).resource.version,
        model: { providerProfileId: replacement.id, modelId: 'replacement-model' },
      })
      first.engine.close()
      const gateway = vi.fn<NonNullable<ApplicationRuntimeOptions['gateway']>['invokeChat']>(async () => ({
        provider: 'test', model: 'original', text: 'Recovered.', finishReason: 'stop',
        message: { role: 'assistant', content: 'Recovered.' },
      }))
      reopened = open(filename, gateway, first.execute)
      await reopened.runtime.initialize()
      const invoke = vi.spyOn(reopened.runtime, 'invokeAgentTurn')
      expect(await handleAgentsRpc(reopened.runtime, 'application.agent.run.resume', { agentSessionId: session.id }))
        .toMatchObject({ accepted: true, sourceRunId: 'original-run' })
      await invoke.mock.results[0]!.value
      expect(gateway).toHaveBeenCalledOnce()
      expect(gateway.mock.calls[0]![0].model).toEqual({ providerProfileId: replacement.id, modelId: 'replacement-model' })
      expect(gateway.mock.calls[0]![0].request.metadata?.providerStep).toBe(afterTool ? 2 : 1)
      expect(invoke.mock.calls[0]![0].narrativeTarget).toEqual(target)
      expect(first.execute).toHaveBeenCalledTimes(afterTool ? 1 : 0)
      const resumedMessages = gateway.mock.calls[0]![0].request.messages
      expect(resumedMessages).toEqual(checkpoint.entry.recovery!.messages)
      if (afterTool) expect(resumedMessages).toContainEqual(expect.objectContaining({ role: 'tool', tool_call_id: 'effect', content: 'Persisted result.' }))
      const final = await reopened.agents.getEntryPage({ agentSessionId: session.id, limit: 100 })
      expect(final.nextCursor).toBeDefined()
      const earlier = await reopened.agents.getEntryPage({ agentSessionId: session.id, cursor: final.nextCursor, limit: 100 })
      expect(earlier.nextCursor).toBeUndefined()
      expect([...earlier.entries, ...final.entries].filter(entry => entry.entry.kind === 'message' && entry.entry.role === 'user')).toHaveLength(1)
      expect(final.entries.at(-1)?.entry).toMatchObject({ kind: 'run-state', state: 'completed' })
      expect(await reopened.runtime.prepareAgentRunRecovery({ agentSessionId: session.id })).toBeUndefined()
    } finally {
      if (reopened) reopened.engine.close()
      else first.engine.close()
      await rm(root, { recursive: true, force: true })
    }
  })

  it.each(['alive', 'missing', 'permission'])('checks another process owner conservatively (%s)', async state => {
    const fixture = open(':memory:', async () => { throw new Error('Interrupted') })
    try {
      const { session } = await setup(fixture.runtime)
      await expect(fixture.runtime.invokeAgentTurn({ agentSessionId: session.id, input: 'Work.' }, {
        agentRun: { runId: 'foreign-run', onEvent: () => {} },
      })).rejects.toThrow('Interrupted')
      const page = await fixture.agents.getEntryPage({ agentSessionId: session.id })
      const latest = page.entries.at(-1)!
      if (latest.entry.kind !== 'run-state' || !latest.entry.recovery) throw new Error('Missing checkpoint')
      const recovery = structuredClone(latest.entry.recovery)
      recovery.executor = { pid: process.pid + 100000, id: 'foreign-run' }
      await fixture.agents.appendEntries({
        actor: { kind: 'kernel', id: 'fixture' }, agentSessionId: session.id, expectedEntryCount: page.session.entryCount,
        entries: [{ runId: 'foreign-run', entry: { kind: 'run-state', state: 'running', recovery } }],
      })
      const probe = vi.spyOn(process, 'kill').mockImplementationOnce(() => {
        if (state === 'alive') return true
        throw Object.assign(new Error('Owner probe'), { code: state === 'missing' ? 'ESRCH' : 'EPERM' })
      })
      try {
        const resumed = fixture.runtime.prepareAgentRunRecovery({ agentSessionId: session.id })
        if (state === 'missing') await expect(resumed).resolves.toMatchObject({ continuation: { sourceRunId: 'foreign-run' } })
        else await expect(resumed).rejects.toMatchObject({
          code: state === 'alive' ? 'agent.recovery_executor_active' : 'agent.recovery_executor_unknown',
        })
        expect(probe).toHaveBeenCalledExactlyOnceWith(process.pid + 100000, 0)
      } finally { probe.mockRestore() }
    } finally { fixture.engine.close() }
  })

  it('refuses takeover of a live executor and refuses an unresolved tool outcome after it ends', async () => {
    const started = Promise.withResolvers<void>()
    const finish = Promise.withResolvers<void>()
    const fixture = open(':memory:', async () => {
      started.resolve()
      await finish.promise
      throw new Error('Provider failed')
    })
    try {
      const { session } = await setup(fixture.runtime)
      const pending = fixture.runtime.invokeAgentTurn({ agentSessionId: session.id, input: 'Work.' }, {
        agentRun: { runId: 'live-run', onEvent: () => {} },
      })
      const settled = pending.catch(error => error)
      await started.promise
      await expect(fixture.runtime.prepareAgentRunRecovery({ agentSessionId: session.id })).rejects.toMatchObject({ code: 'agent.recovery_executor_active' })
      finish.resolve()
      await settled
      const page = await fixture.agents.getEntryPage({ agentSessionId: session.id })
      await fixture.agents.appendEntries({
        actor: { kind: 'kernel', id: 'fixture' }, agentSessionId: session.id, expectedEntryCount: page.session.entryCount,
        entries: [{ runId: 'live-run', entry: {
          kind: 'tool-invocation', invocationId: 'unresolved', toolId: tool.id, exposedName: tool.name,
          transport: 'native-function', arguments: {}, status: 'running',
        } }],
      })
      await expect(fixture.runtime.prepareAgentRunRecovery({ agentSessionId: session.id })).rejects.toMatchObject({ code: 'agent.recovery_tool_outcome_unknown' })
      const interrupted = await fixture.agents.getEntryPage({ agentSessionId: session.id })
      const checkpointEntry = interrupted.entries.find(item => item.entry.kind === 'run-state' && item.entry.recovery)?.entry
      if (checkpointEntry?.kind !== 'run-state' || !checkpointEntry.recovery) throw new Error('Missing recovery checkpoint')
      const checkpoint = checkpointEntry.recovery
      await fixture.agents.appendEntries({ actor: { kind: 'kernel', id: 'fixture' }, agentSessionId: session.id,
        expectedEntryCount: interrupted.session.entryCount,
        entries: [{ runId: 'live-run', entry: { kind: 'run-state', state: 'running', recovery: { ...checkpoint, phase: 'tools' } } }],
      })
      await expect(fixture.runtime.prepareAgentRunRecovery({ agentSessionId: session.id })).rejects.toMatchObject({ code: 'agent.recovery_tool_outcome_unknown' })
      expect(await handleAgentsRpc(fixture.runtime, 'application.agent.run.state', { runId: 'live-run', agentSessionId: session.id }))
        .toMatchObject({ runId: 'live-run', state: 'suspended' })
      expect(await handleAgentsRpc(fixture.runtime, 'application.agent.run.abandon', { runId: 'live-run', agentSessionId: session.id }))
        .toMatchObject({ accepted: true })
      expect(await fixture.runtime.prepareAgentRunRecovery({ agentSessionId: session.id })).toBeUndefined()
      expect((await fixture.agents.getEntryPage({ agentSessionId: session.id })).entries.at(-1)!.entry)
        .toMatchObject({ kind: 'run-state', state: 'discarded' })

    } finally {
      finish.resolve()
      fixture.engine.close()
    }
  })
})
