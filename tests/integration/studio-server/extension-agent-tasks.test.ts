import { describe, expect, it, vi } from 'vitest'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { createAgentStore, createNarrativeStore, createPromptResourceStore } from '@loom-studio/application-data'
import { extensionInstallationId } from '@loom-studio/extension-sdk'
import { createApplicationRuntime, createNarrativeContextRegistry } from '@loom-studio/application-runtime'
import { createExtensionAgentTasks } from '../../../apps/studio-server/src/extensions/extension-agent-tasks.js'

describe('extension Agent task ownership', () => {
  it('persists private ownership, fixes preset and Timeline, and rejects foreign owners, branches and deleted Sessions', async () => {
    const clock = { createId: (prefix: string) => `${prefix}-${crypto.randomUUID()}`, now: () => new Date().toISOString() }
    const engine = createSqliteDataEngine({ filename: ':memory:', ...clock })
    try {
      const documents = createSqliteDocumentStore({ engine })
      const runtime = createApplicationRuntime({ dataEngine: engine, documents,
        agents: createAgentStore({ engine, ...clock }), narratives: createNarrativeStore({ engine, ...clock }),
        promptResources: createPromptResourceStore({ engine, ...clock }) })
      const { card } = await runtime.createCard({ name: 'Tasks' })
      const { timeline, branch } = await runtime.createNarrativeTimeline({ cardId: card.id })
      const { agentPreset } = await runtime.createAgentPreset({ name: 'Task preset' })
      const owner = { packageId: 'example.tasks', installationId: 'install-a' }
      const target = { timelineId: timeline.id, branchId: branch.id }
      const tasks = createExtensionAgentTasks({ runtime, documents })
      await expect(tasks.create(owner, target, { presetId: '' })).rejects.toThrow('presetId')
      const created = await tasks.create(owner, target, { presetId: agentPreset.id, title: 'Independent task' })
      expect(created).toMatchObject({ presetId: agentPreset.id, title: 'Independent task', state: 'idle' })
      expect((await runtime.getAgentSession({ agentSessionId: created.sessionId })).session)
        .toMatchObject({ timelineId: timeline.id, agentPresetId: agentPreset.id, summaryPolicy: { enabled: false } })
      const restarted = createExtensionAgentTasks({ runtime, documents })
      await expect(restarted.read(owner, target, created.sessionId)).resolves.toEqual(created)
      for (const operation of ['read', 'cancel', 'dispose'] as const) {
        await expect(restarted[operation]({ ...owner, installationId: 'other' }, target, created.sessionId)).rejects.toThrow('does not belong')
        await expect(restarted[operation](owner, { ...target, branchId: 'other' }, created.sessionId)).rejects.toThrow('does not belong')
      }
      await expect(tasks.invoke({ ...owner, packageId: 'other' }, target, { sessionId: created.sessionId, input: 'hello' })).rejects.toThrow('does not belong')
      await expect(tasks.invoke(owner, target, { sessionId: created.sessionId, input: ' ' })).rejects.toThrow('input is required')
      await documents.write({ id: 'extension-agent-task:forged', type: 'application.extension-agent-task',
        content: { ...owner, ...target, sessionId: 'forged', presetId: agentPreset.id }, meta: { ownerExtensionId: owner.packageId } })
      await expect(tasks.read(owner, target, 'forged')).rejects.toThrow('does not belong')
      await tasks.dispose(owner, target, created.sessionId)
      await expect(runtime.getAgentSession({ agentSessionId: created.sessionId })).rejects.toThrow('not found')
      await expect(tasks.read(owner, target, created.sessionId)).rejects.toThrow('does not belong')
    } finally { engine.close() }
  })
  it.each(['registration', 'receipt'] as const)('closes the Run handoff when %s persistence fails', async failure => {
    const clock = { createId: (prefix: string) => `${prefix}-${crypto.randomUUID()}`, now: () => new Date().toISOString() }
    const engine = createSqliteDataEngine({ filename: ':memory:', ...clock })
    const started = Promise.withResolvers<void>()
    const cancelled = Promise.withResolvers<void>()
    try {
      const documents = createSqliteDocumentStore({ engine })
      const runtime = createApplicationRuntime({ dataEngine: engine, documents,
        agents: createAgentStore({ engine, ...clock }), narratives: createNarrativeStore({ engine, ...clock }),
        promptResources: createPromptResourceStore({ engine, ...clock }),
        gateway: { invokeChat: async ({ abortSignal }) => {
          started.resolve()
          if (failure === 'registration') await new Promise<never>((_resolve, reject) => {
            const abort = () => { cancelled.resolve(); reject(new Error('Provider cancelled')) }
            if (abortSignal!.aborted) abort()
            else abortSignal!.addEventListener('abort', abort, { once: true })
          })
          return { provider: 'test', model: 'test-model', text: 'Recoverable output', message: { role: 'assistant', content: 'Recoverable output' } }
        } },
      })
      const { providerProfile } = await runtime.createProviderProfile({ providerExtensionId: 'official.openai-compatible', displayName: 'Test', config: {}, enabledModelIds: ['test-model'] })
      const { agentPreset } = await runtime.createAgentPreset({ name: 'Task', model: { providerProfileId: providerProfile.id, modelId: 'test-model' } })
      const { card } = await runtime.createCard({ name: 'Tasks' })
      const { timeline, branch } = await runtime.createNarrativeTimeline({ cardId: card.id })
      const owner = { packageId: 'example.tasks', installationId: 'install' }
      const target = { timelineId: timeline.id, branchId: branch.id }
      const tasks = createExtensionAgentTasks({ runtime, documents })
      const { sessionId } = await tasks.create(owner, target, { presetId: agentPreset.id })
      const write = documents.write.bind(documents)
      const spy = vi.spyOn(documents, 'write').mockImplementation(async input => {
        if (input.id === `extension-agent-task:${sessionId}`) {
          const content = input.content as Record<string, unknown>
          if ((failure === 'registration' && content.runId && !content.result) || (failure === 'receipt' && content.result)) {
            await started.promise
            throw new Error('Task persistence failed')
          }
        }
        return write(input)
      })
      await expect(tasks.invoke(owner, target, { sessionId, input: 'Work' })).rejects.toThrow('Task persistence failed')
      spy.mockRestore()
      if (failure === 'registration') await cancelled.promise
      const snapshot = await tasks.read(owner, target, sessionId)
      expect(snapshot.state).toBe(failure === 'registration' ? 'cancelled' : 'completed')
      if (failure === 'receipt') {
        const transcript = await runtime.getAgentTranscriptPage({ agentSessionId: sessionId, limit: 100 })
        expect(transcript.entries.some(item => item.entry.kind === 'message' && item.entry.content === 'Recoverable output')).toBe(true)
      }
      await tasks.dispose(owner, target, sessionId)
    } finally { engine.close() }
  })
  it('runs an independent task through the model and cancels its active run without appending Narrative', async () => {
    const clock = { createId: (prefix: string) => `${prefix}-${crypto.randomUUID()}`, now: () => new Date().toISOString() }
    const engine = createSqliteDataEngine({ filename: ':memory:', ...clock })
    try {
      const documents = createSqliteDocumentStore({ engine })
      const narratives = createNarrativeStore({ engine, ...clock })
      let calls = 0
      const providerStarted = Promise.withResolvers<void>()
      const runtime = createApplicationRuntime({ dataEngine: engine, documents, narratives,
        agents: createAgentStore({ engine, ...clock }), promptResources: createPromptResourceStore({ engine, ...clock }),
        gateway: { invokeChat: async ({ abortSignal: signal }) => {
          calls += 1
          if (calls === 2) {
            providerStarted.resolve()
            await new Promise<never>((_resolve, reject) => {
              signal!.throwIfAborted()
              signal!.addEventListener('abort', () => reject(new Error('Provider cancelled')), { once: true })
            })
          }
          return { provider: 'test', model: 'test-model', text: 'Task output', message: { role: 'assistant', content: 'Task output' } }
        } },
      })
      const { providerProfile } = await runtime.createProviderProfile({ providerExtensionId: 'official.openai-compatible',
        displayName: 'Test', config: {}, enabledModelIds: ['test-model'] })
      const { agentPreset } = await runtime.createAgentPreset({ name: 'Task',
        model: { providerProfileId: providerProfile.id, modelId: 'test-model' } })
      const { card } = await runtime.createCard({ name: 'Task Card' })
      const { timeline, branch } = await runtime.createNarrativeTimeline({ cardId: card.id })
      const target = { timelineId: timeline.id, branchId: branch.id }
      const owner = { packageId: 'example.tasks', installationId: 'install' }
      const tasks = createExtensionAgentTasks({ runtime, documents })
      const { sessionId } = await tasks.create(owner, target, { presetId: agentPreset.id })
      const before = await narratives.listNodes(timeline.id)
      await expect(tasks.invoke(owner, target, { sessionId, input: 'Summarize the supplied text.' }))
        .resolves.toMatchObject({ sessionId, state: 'completed', text: 'Task output' })
      expect(calls).toBe(1)
      expect(await narratives.listNodes(timeline.id)).toEqual(before)
      await expect(tasks.read(owner, target, sessionId)).resolves.toMatchObject({ state: 'completed', lastOutput: 'Task output' })
      const controller = new AbortController()
      const pending = tasks.invoke(owner, target, { sessionId, input: 'Wait for cancellation.' }, controller.signal)
      const rejected = expect(pending).resolves.toMatchObject({ state: 'cancelled' })
      await providerStarted.promise
      controller.abort(new Error('Extension stopped'))
      await rejected
      await vi.waitFor(async () => {
        const task = await tasks.read(owner, target, sessionId)
        expect(['cancelled', 'suspended']).toContain(task.state)
      })
      const transcript = await runtime.getAgentTranscriptPage({ agentSessionId: sessionId, limit: 100 })
      const recoveries = transcript.entries.flatMap(item => item.entry.kind === 'run-state' && item.entry.recovery ? [item.entry.recovery] : [])
      expect(recoveries.length).toBeGreaterThan(0)
      expect(recoveries.every(checkpoint => (checkpoint.request as { contextMode?: string }).contextMode === 'isolated')).toBe(true)
      await tasks.dispose(owner, target, sessionId)
      await expect(runtime.getAgentSession({ agentSessionId: sessionId })).rejects.toThrow('not found')
      expect(calls).toBe(2)
      expect(await narratives.listNodes(timeline.id)).toEqual(before)
    } finally { engine.close() }
  })

  it('resolves an owned contribution and activates common plus exactly one level in the same Preset', async () => {
    const clock = { createId: (prefix: string) => `${prefix}-${crypto.randomUUID()}`, now: () => new Date().toISOString() }
    const engine = createSqliteDataEngine({ filename: ':memory:', ...clock })
    try {
      const documents = createSqliteDocumentStore({ engine })
      const requests: string[] = []
      const narrativeContext = createNarrativeContextRegistry()
      const resolveStory = vi.fn(async () => { throw new Error('Story context must not be read by a task') })
      narrativeContext.register({ id: 'story', resolve: resolveStory })
      const runtime = createApplicationRuntime({ dataEngine: engine, documents, narrativeContext,
        agents: createAgentStore({ engine }), narratives: createNarrativeStore({ engine }),
        promptResources: createPromptResourceStore({ engine }),
        gateway: { invokeChat: async ({ request }) => {
          requests.push(JSON.stringify(request.messages))
          return { provider: 'test', model: 'test-model', text: 'Done', message: { role: 'assistant', content: 'Done' } }
        } },
      })
      const packageId = 'example.summary'
      const contributionId = 'summary-preset'
      const imported = await runtime.importExtensionPackageResources({ packageId, packageVersion: '1.0.0', participation: 'timeline', source: { kind: 'local', directory: '/test/summary' },
        promptResources: [{ contribution: { id: contributionId, resourceKind: 'preset', source: 'summary.json' }, artifact: {
          format: 'loom.promptResource', schemaVersion: 2, resourceKind: 'preset',
          rootNode: { id: `${packageId}.root`, kind: 'module', category: 'preset', label: 'Summary', children: [
            { id: `${packageId}.message`, kind: 'message', label: 'Instructions', capabilities: { roleHint: 'system' }, children: [
            ...['@chat.input', '@memory.workspace', '@chat.narrative', '@lore.stable', '@lore.lower'].map((anchor, index) => ({ id: `${packageId}.anchor-${index}`, kind: 'virtual', label: anchor, capabilities: { targetAnchorId: anchor } })),
            { id: `${packageId}.common`, kind: 'entry', label: 'Common', body: 'COMMON_RULES' },
            ...[1, 2].map(level => ({ id: `${packageId}.level-${level}`, kind: 'entry', label: `Level ${level}`, body: `ONLY_LEVEL_${level}`,
              capabilities: { activation: { kind: 'condition', conditions: [{ fact: 'summary.level', equals: level }] } } })),
          ] } ] },
        } }], agentTools: [], transformRules: [], textExtractors: [],
      })
      const presetId = imported.promptResources[0]!.resourceId
      expect(presetId).not.toBe(contributionId)
      const { providerProfile } = await runtime.createProviderProfile({ providerExtensionId: 'official.openai-compatible',
        displayName: 'Test', config: {}, enabledModelIds: ['test-model'] })
      const preset = (await runtime.getAgentPreset({ agentPresetId: presetId })).agentPreset
      await runtime.updateAgentPreset({ agentPresetId: presetId, expectedVersion: preset.version,
        model: { providerProfileId: providerProfile.id, modelId: 'test-model' } })
      const makeLore = (id: string, body: string) => runtime.importPromptResource({ artifact: {
        format: 'loom.promptResource', schemaVersion: 2, resourceKind: 'lore',
        rootNode: { id, kind: 'module', category: 'lore', label: id, children: [
          { id: `${id}.entry`, kind: 'entry', label: id, body, capabilities: { targetAnchorId: '@lore.stable' } },
        ] },
      } })
      const characterLore = await makeLore('character-lore', 'CHARACTER_BACKGROUND')
      await makeLore('global-lore', 'GLOBAL_LORE_SHOULD_NOT_LEAK')
      const { card } = await runtime.createCard({ name: 'Summary' })
      await runtime.updateCardPromptResources({ expectedVersion: (await runtime.getCard({ cardId: card.id })).card.version, cardId: card.id, promptResourceIds: [characterLore.resource.id] })
      const { timeline, branch } = await runtime.createNarrativeTimeline({ cardId: card.id, openingContent: 'OLD_STORY_SHOULD_NOT_LEAK', extensionAdoptions: [] })
      const target = { timelineId: timeline.id, branchId: branch.id }
      const workspace = await runtime.getTimelineWorkspace(target)
      await runtime.mutateTimelineWorkspace({ ...target, expectedRevisionId: workspace.id, operations: [{ kind: 'write', entryId: 'memory', content: 'WORKSPACE_SHOULD_NOT_LEAK' }] })
      const owner = { packageId, installationId: extensionInstallationId(packageId, { kind: 'global' }) }
      const tasks = createExtensionAgentTasks({ runtime, documents })
      const created = await tasks.create(owner, target, { presetContributionId: contributionId })
      expect(created.presetId).toBe(presetId)
      await expect(tasks.invoke(owner, target, { sessionId: created.sessionId, input: 'Not adopted.' })).resolves.toMatchObject({ state: 'failed', error: { message: expect.stringContaining('not available') } })
      await runtime.adoptTimelineExtension(await runtime.previewTimelineExtensionAdoption({ ...target, installationId: owner.installationId }))
      await expect(tasks.create({ ...owner, packageId: 'other' }, target, { presetContributionId: contributionId })).rejects.toThrow('exactly one owned')
      await expect(tasks.create({ ...owner, installationId: 'other' }, target, { presetContributionId: contributionId })).rejects.toThrow('exactly one owned')
      for (const level of [1, 2]) {
        await tasks.invoke(owner, target, { sessionId: created.sessionId, input: 'Summarize.', activationFacts: { summary: { level } } })
        expect(requests[level - 1]).toContain('Summarize.')
        expect(requests[level - 1]).not.toContain('OLD_STORY_SHOULD_NOT_LEAK')
        expect(requests[level - 1]).not.toContain('WORKSPACE_SHOULD_NOT_LEAK')
        expect(requests[level - 1]).toContain('CHARACTER_BACKGROUND')
        expect(requests[level - 1]).not.toContain('GLOBAL_LORE_SHOULD_NOT_LEAK')
        expect(requests[level - 1]).toContain('COMMON_RULES')
        expect(requests[level - 1]).toContain(`ONLY_LEVEL_${level}`)
        expect(requests[level - 1]).not.toContain(`ONLY_LEVEL_${3 - level}`)
      }
      const enabledPreset = (await runtime.getAgentPreset({ agentPresetId: presetId })).agentPreset
      await runtime.updateAgentPreset({ agentPresetId: presetId, expectedVersion: enabledPreset.version, useCardLore: false })
      const separate = await tasks.create(owner, target, { presetContributionId: contributionId })
      await tasks.invoke(owner, target, { sessionId: separate.sessionId, input: 'No inherited Lore.', activationFacts: { summary: { level: 1 } } })
      expect(requests.at(-1)).not.toContain('CHARACTER_BACKGROUND')
      expect(resolveStory).not.toHaveBeenCalled()
      await expect(runtime.previewAgentTurn({ agentSessionId: created.sessionId, input: 'Ordinary foreground.' })).rejects.toThrow('Story context must not be read by a task')
      expect(resolveStory).toHaveBeenCalledOnce()
    } finally { engine.close() }
  })

  it('retains temporary results until acknowledgement, recovers orphans, and exposes cursor progress', async () => {
    const clock = { createId: (prefix: string) => `${prefix}-${crypto.randomUUID()}`, now: () => new Date().toISOString() }
    const engine = createSqliteDataEngine({ filename: ':memory:', ...clock })
    try {
      const documents = createSqliteDocumentStore({ engine })
      const started = Promise.withResolvers<void>()
      const finish = Promise.withResolvers<void>()
      const runtime = createApplicationRuntime({ dataEngine: engine, documents,
        agents: createAgentStore({ engine, ...clock }), narratives: createNarrativeStore({ engine, ...clock }),
        promptResources: createPromptResourceStore({ engine, ...clock }),
        gateway: { invokeChat: async ({ onEvent }) => {
          onEvent?.({ type: 'text-delta', runId: 'provider', delta: 'Durable output' })
          started.resolve()
          await finish.promise
          return { provider: 'test', model: 'test-model', text: 'Durable output', message: { role: 'assistant', content: 'Durable output' } }
        } },
      })
      const { providerProfile } = await runtime.createProviderProfile({ providerExtensionId: 'official.openai-compatible', displayName: 'Test', config: {}, enabledModelIds: ['test-model'] })
      const { agentPreset } = await runtime.createAgentPreset({ name: 'Temporary', model: { providerProfileId: providerProfile.id, modelId: 'test-model' } })
      const { card } = await runtime.createCard({ name: 'Tasks' })
      const { timeline, branch } = await runtime.createNarrativeTimeline({ cardId: card.id })
      const owner = { packageId: 'test.tasks', installationId: 'test-install' }
      const target = { timelineId: timeline.id, branchId: branch.id }
      const tasks = createExtensionAgentTasks({ runtime, documents })
      const { sessionId } = await tasks.create(owner, target, { presetId: agentPreset.id, lifecycle: 'temporary' })
      await expect(tasks.acknowledge(owner, target, sessionId)).rejects.toThrow('no durable result')
      const pending = tasks.invoke(owner, target, { sessionId, input: 'Summarize' })
      await started.promise
      const progress = await tasks.subscribe(owner, target, { sessionId })
      expect(progress.snapshot.state).toBe('running')
      expect(progress.events).toContainEqual({ type: 'text-delta', delta: 'Durable output' })
      await expect(tasks.subscribe({ ...owner, installationId: 'foreign' }, target, { sessionId })).rejects.toThrow('does not belong')
      finish.resolve()
      const result = await pending
      expect(result).toMatchObject({ state: 'completed', text: 'Durable output' })
      expect((await tasks.subscribe(owner, target, { sessionId, cursor: progress.nextCursor })).snapshot.result).toEqual(result)
      await expect(runtime.getAgentSession({ agentSessionId: sessionId })).resolves.toBeDefined()
      await expect(tasks.invoke(owner, target, { sessionId, input: 'Again' })).rejects.toThrow('only be invoked once')
      // Simulate loss of the extension acknowledgement, then startup recovery.
      // Also cover a crash after transcript completion but before saving the task receipt.
      const receipt = (await documents.get(`extension-agent-task:${sessionId}`))!
      const { result: _result, ...unfinishedReceipt } = receipt.content as Record<string, import('@loom-studio/shared').JsonValue>
      await documents.write({ id: receipt.id, type: receipt.type, expectedVersion: receipt.version, content: unfinishedReceipt })
      const coldRuntime = createApplicationRuntime({ dataEngine: engine, documents,
        agents: createAgentStore({ engine, ...clock }), narratives: createNarrativeStore({ engine, ...clock }),
        promptResources: createPromptResourceStore({ engine, ...clock }) })
      const restarted = createExtensionAgentTasks({ runtime: coldRuntime, documents })
      const victim = await tasks.create(owner, target, { presetId: agentPreset.id })
      await documents.write({ id: 'forged-task', type: 'application.extension-agent-task',
        content: { ...owner, ...target, presetId: agentPreset.id, sessionId: victim.sessionId, lifecycle: 'temporary' },
        meta: { ownerExtensionId: owner.packageId } })
      await restarted.recover()
      await expect(runtime.getAgentSession({ agentSessionId: victim.sessionId })).resolves.toBeDefined()
      await expect(runtime.getAgentSession({ agentSessionId: sessionId })).rejects.toThrow('not found')
      expect((await restarted.read(owner, target, sessionId)).result).toEqual(result)
      expect(await restarted.subscribe(owner, target, { sessionId })).toMatchObject({ done: true, replayExpired: true, snapshot: { result } })
      await expect(restarted.acknowledge({ ...owner, packageId: 'foreign' }, target, sessionId)).rejects.toThrow('does not belong')
      await restarted.acknowledge(owner, target, sessionId)
      await restarted.acknowledge(owner, target, sessionId)
      await expect(restarted.read(owner, target, sessionId)).rejects.toThrow('does not belong')
      // A crash before invocation does not leave an idle Session behind.
      const orphan = await tasks.create(owner, target, { presetId: agentPreset.id, lifecycle: 'temporary' })
      await restarted.recover()
      expect((await restarted.read(owner, target, orphan.sessionId)).result?.state).toBe('interrupted')
      await expect(runtime.getAgentSession({ agentSessionId: orphan.sessionId })).rejects.toThrow('not found')
      await restarted.acknowledge(owner, target, orphan.sessionId)
    } finally { engine.close() }
  })

})
