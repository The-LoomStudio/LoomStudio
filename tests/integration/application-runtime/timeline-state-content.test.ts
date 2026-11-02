import { describe, expect, it, vi } from 'vitest'
import { createApplicationRuntime, createStateContentRegistry, createStateContributionRegistry, createOfficialAgentToolRegistry, applicationDocumentTypes, type ApplicationRuntimeOptions } from '@loom-studio/application-runtime'
import { createAgentStore, createNarrativeStore, createPromptResourceStore } from '@loom-studio/application-data'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { extensionInstallationId } from '@loom-studio/extension-sdk'

const defaultPlayerState = {
  $loom: { players: { User: { components: { loom_profile: { name: 'User', description: '' } } } } },
}

async function setup(withTools = false) {
  let id = 0
  const createId = (prefix: string) => `${prefix}-${++id}`
  const now = () => '2026-10-07T00:00:00.000Z'
  const engine = createSqliteDataEngine({ filename: ':memory:', createId, now })
  const documents = createSqliteDocumentStore({ engine })
  const agents = createAgentStore({ engine, createId, now })
  const stateContent = createStateContentRegistry()
  const stateContributions = createStateContributionRegistry()
  stateContributions.register({
    packageId: 'example.counter', packageVersion: '1.0.0', moduleId: 'server', instanceId: 'counter',
    contribution: {
      id: 'example.counter.state', entityTypes: [], entities: [], componentMounts: [],
      templates: [{ id: 'example.counter.data', templateVersion: 1, schema: { type: 'object' }, initial: { count: 0 } }],
      bindings: [{ path: 'counter', templateId: 'example.counter.data', templateVersion: 1 }],
    },
  })
  const process = vi.fn(async () => ({ value: { count: 1 } }))
  stateContent.register({
    id: 'example.counter/update', contributionId: 'example.counter.state', path: '/counter', process,
  }, { packageId: 'example.counter', target: { kind: 'global' } })
  const invoke = vi.fn<NonNullable<ApplicationRuntimeOptions['gateway']>['invokeChat']>(async () => ({
    provider: 'fixture', model: 'test', text: 'Done.', message: { role: 'assistant' as const, content: 'Done.' },
  }))
  const runtime = createApplicationRuntime({
    dataEngine: engine, documents, agents, stateContent, stateContributions,
    narratives: createNarrativeStore({ engine, createId, now }), promptResources: createPromptResourceStore({ engine, createId, now }),
    gateway: { invokeChat: invoke },
    ...(withTools ? { agentTools: createOfficialAgentToolRegistry() } : {}),
  })
  if (withTools) await runtime.initialize()
  const installationId = extensionInstallationId('example.counter', { kind: 'global' })
  await documents.write({
    id: installationId, type: applicationDocumentTypes.extensionInstallation, expectedVersion: 'new',
    actor: { kind: 'kernel', id: 'test' },
    content: { packageId: 'example.counter', packageVersion: '1.0.0', participation: 'timeline', target: { kind: 'global' },
      source: { kind: 'git', url: 'https://example.com/counter.git' }, createdAt: now(), updatedAt: now() },
  })
  const { card } = await runtime.createCard({ name: 'Counter' })
  await runtime.updateCard({ cardId: card.id, extensionAdoptions: [{ packageId: 'example.counter', target: 'global' }] })
  const { timeline, branch } = await runtime.createNarrativeTimeline({ cardId: card.id })
  const target = { timelineId: timeline.id, branchId: branch.id }
  const preset = (await runtime.createPromptResource({ resourceKind: 'preset', name: 'Test' })).resource
  const provider = (await runtime.createProviderProfile({
    providerExtensionId: 'official.openai-compatible', displayName: 'Fixture', config: {}, enabledModelIds: ['test'],
  })).providerProfile
  await runtime.updateAgentPreset({ agentPresetId: preset.id, expectedVersion: preset.version,
    model: { providerProfileId: provider.id, modelId: 'test' } })
  const { session } = await runtime.createAgentSession({ agentPresetId: preset.id, timelineId: timeline.id })
  const request = { agentSessionId: session.id, input: 'Advance', narrativeTarget: target }
  async function enable(enabled: boolean) {
    const config = await runtime.getTimelineExtensionParticipation(target)
    return runtime.updateTimelineExtensionParticipation({ ...target, installationId, expectedVersion: config.version, enabled })
  }
  const snapshot = () => runtime.getStateSnapshot({ target: { scope: 'timeline', ...target } })
  return { engine, documents, agents, runtime, process, invoke, target, request, session, preset, installationId, enable, snapshot }
}

describe('Timeline State content acceptance', () => {
  it.each([false, true])('refreshes script attachment access and carries tool dependencies into recovery (paused before read: %s)', async pauseBeforeRead => {
    const f = await setup(true)
    try {
      await f.documents.write({
        id: 'counter-script', type: applicationDocumentTypes.loomScript, expectedVersion: 'new',
        content: { owner: { kind: 'preset', presetId: f.preset.id },
          source: { fileName: 'COUNTER_ATTACHMENT.js', blobId: 'not-read-by-directory-listing', mediaType: 'text/javascript' } },
      })
      await f.documents.write({
        id: 'counter-script-mount', type: applicationDocumentTypes.loomScriptMount, expectedVersion: 'new',
        content: { target: { kind: 'preset', presetId: f.preset.id }, scriptDocumentId: 'counter-script', orderIndex: 0,
          origin: { kind: 'extension-package', packageId: 'example.counter', installationId: f.installationId, contributionId: 'script' } },
      })
      await f.runtime.replacePresetToolMounts({
        presetId: f.preset.id, mounts: [{ toolId: 'official/codeact_json', defaultEnabled: true, orderIndex: 0 }],
      })
      f.invoke.mockImplementationOnce(async () => {
        if (pauseBeforeRead) await f.enable(false)
        return { provider: 'fixture', model: 'test', text: '', message: { role: 'assistant', content: '',
          tool_calls: [{ id: 'read', type: 'function', function: { name: 'codeact_json', arguments: JSON.stringify({ code: 'print(await ctx.ls("/attachments"));' }) } }] } }
      }).mockImplementationOnce(async input => {
        const toolMessage = input.request.messages.findLast(message => message.role === 'tool')!
        expect(String(toolMessage.content).includes('COUNTER_ATTACHMENT')).toBe(!pauseBeforeRead)
        if (pauseBeforeRead) return { provider: 'fixture', model: 'test', text: 'Done.', message: { role: 'assistant', content: 'Done.' } }
        throw new Error('Interrupted after indirect read')
      })
      if (pauseBeforeRead) {
        await f.runtime.invokeAgentTurn(f.request)
      } else {
        await expect(f.runtime.invokeAgentTurn(f.request)).rejects.toThrow('Interrupted after indirect read')
        const recovery = (await f.runtime.prepareAgentRunRecovery({ agentSessionId: f.session.id }))!
        expect(recovery.continuation.recovery.promptExtensionLeases).toEqual([
          expect.objectContaining({ installationId: f.installationId }),
        ])
        await f.enable(false)
        await f.enable(true)
        await expect(f.runtime.invokeAgentTurn(recovery.request, {
          agentRun: { runId: 'indirect-resume', onEvent: () => {}, continuation: recovery.continuation },
        })).rejects.toThrow('no longer active')
      }
      expect(f.invoke).toHaveBeenCalledTimes(2)
    } finally { await f.engine.close() }
  })

  async function installPrompt(f: Awaited<ReturnType<typeof setup>>) {
    const setting = (await f.runtime.createPromptResource({ resourceKind: 'lore', name: 'Counter instructions' })).resource
    await f.runtime.createPromptResourceAsset({
      resourceId: setting.id, targetAssetId: setting.rootNode.id, position: 'inside',
      asset: { id: 'instructions', kind: 'entry', label: 'Instructions', body: 'COUNTER_PROMPT' },
    })
    const resources = createPromptResourceStore({ engine: f.engine })
    const stored = (await resources.getResource(setting.id))!
    await resources.mutateResource({
      resourceId: stored.id, expectedVersion: stored.version,
      mutations: [{ kind: 'resource.update', patch: { metadata: { ...stored.metadata,
        origin: { kind: 'extension-package', packageId: 'example.counter',
          installationId: f.installationId, contributionId: 'instructions' } } } }],
      actor: { kind: 'kernel', id: 'test' },
    })
    await f.runtime.replaceLoreMounts({ source: { kind: 'preset', id: f.preset.id }, loreResourceIds: [setting.id] })
    return setting.id
  }

  it('reports resource eligibility without importing, mounting or deleting carried resources', async () => {
    const f = await setup()
    try {
      const id = await installPrompt(f)
      const input = { timelineId: f.target.timelineId, installationId: f.installationId }
      expect((await f.runtime.inspectTimelineExtensionResources(input)).resources).toMatchObject([
        { id, kind: 'lore', eligible: true, contributionId: 'instructions' },
      ])
      await f.enable(false)
      expect((await f.runtime.inspectTimelineExtensionResources(input)).resources).toMatchObject([{ id, eligible: false }])
      await f.documents.delete({ id: f.installationId, expectedVersion: 1, actor: { kind: 'kernel', id: 'test' } })
      expect((await f.runtime.inspectTimelineExtensionResources(input)).resources).toMatchObject([{ id, eligible: false }])
      expect((await f.runtime.listLoreMounts({ source: { kind: 'preset', id: f.preset.id } })).mounts).toHaveLength(1)
    } finally { await f.engine.close() }
  })

  it('rejects an accepted extension Prompt after pause and re-enable instead of sending it on recovery', async () => {
    const f = await setup()
    try {
      await installPrompt(f)
      f.invoke.mockImplementationOnce(async () => { throw new Error('Provider interrupted') })
      await expect(f.runtime.invokeAgentTurn(f.request, {
        agentRun: { runId: 'prompt-original', onEvent: () => {} },
      })).rejects.toThrow('Provider interrupted')
      const recovery = (await f.runtime.prepareAgentRunRecovery({ agentSessionId: f.session.id }))!
      expect(recovery.continuation.recovery.promptExtensionLeases).toEqual([
        expect.objectContaining({ timelineId: f.target.timelineId, installationId: f.installationId }),
      ])
      await f.enable(false)
      await f.enable(true)
      await expect(f.runtime.invokeAgentTurn(recovery.request, {
        agentRun: { runId: 'prompt-resume', onEvent: () => {}, continuation: recovery.continuation },
      })).rejects.toThrow('no longer active')
      expect(f.invoke).toHaveBeenCalledOnce()
      expect(f.process).not.toHaveBeenCalled()
    } finally { await f.engine.close() }
  })

  it('does not accept a Provider response after its Prompt source was paused in flight', async () => {
    const f = await setup()
    try {
      await installPrompt(f)
      f.invoke.mockImplementationOnce(async () => {
        await f.enable(false)
        return { provider: 'fixture', model: 'test', text: 'Late.', message: { role: 'assistant', content: 'Late.' } }
      })
      await expect(f.runtime.invokeAgentTurn(f.request)).rejects.toThrow('no longer active')
      expect(f.process).not.toHaveBeenCalled()
      expect((await f.snapshot()).snapshot.value).toEqual({ ...defaultPlayerState, counter: { count: 0 } })
    } finally { await f.engine.close() }
  })

  it('does not run paused handlers, then applies a newly enabled operation with its target', async () => {
    const f = await setup()
    try {
      await f.enable(false)
      await f.runtime.invokeAgentTurn(f.request)
      expect(f.process).not.toHaveBeenCalled()
      expect((await f.snapshot()).snapshot.value).toEqual({ ...defaultPlayerState, counter: { count: 0 } })
      await f.enable(true)
      await f.runtime.invokeAgentTurn(f.request)
      expect(f.process).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        target: { scope: 'timeline', ...f.target }, value: { count: 0 },
      }))
      expect((await f.snapshot()).snapshot.value).toEqual({ ...defaultPlayerState, counter: { count: 1 } })
    } finally { f.engine.close() }
  })

  it('persists the original lease and rejects paused-then-resumed operations during recovery without rerunning code', async () => {
    const f = await setup()
    try {
      const initial = await f.snapshot()
      const config = await f.runtime.getTimelineExtensionParticipation(f.target)
      const append = f.agents.appendEntries.bind(f.agents)
      let paused = false
      vi.spyOn(f.agents, 'appendEntries').mockImplementation(async input => {
        const result = await append(input)
        if (!paused && input.entries.some(item => item.entry.kind === 'run-state' && item.entry.recovery?.phase === 'content')) {
          paused = true
          await f.enable(false)
          await f.enable(true)
        }
        return result
      })
      await expect(f.runtime.invokeAgentTurn(f.request, {
        agentRun: { runId: 'original', onEvent: () => {} },
      })).rejects.toThrow('no longer active')
      expect(await f.snapshot()).toEqual(initial)
      const recovery = await f.runtime.prepareAgentRunRecovery({ agentSessionId: f.session.id })
      expect(recovery?.continuation.recovery.acceptedContent?.extensionLeases).toEqual([{
        timelineId: f.target.timelineId, installationId: f.installationId,
        installationVersion: config.entries[0]!.installationVersion, generation: config.entries[0]!.generation,
      }])
      await expect(f.runtime.invokeAgentTurn(recovery!.request, {
        agentRun: { runId: 'resume', onEvent: () => {}, continuation: recovery!.continuation },
      })).rejects.toThrow('no longer active')
      expect(await f.snapshot()).toEqual(initial)
      expect(f.process).toHaveBeenCalledOnce()
      expect(f.invoke).toHaveBeenCalledOnce()
    } finally { f.engine.close() }
  })
})
