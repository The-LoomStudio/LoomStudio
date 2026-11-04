import { join } from 'node:path'
import { createBlobStore } from '@loom-studio/asset-store'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createAgentStore } from '@loom-studio/application-data'
import {
  createObservationStore,
  createAgentToolRegistry,
  createOfficialAgentToolRegistry,
  createApplicationRuntime,
  officialReadStateTool,
  officialUpdateStateTool,
  officialEditNarrativeTool,
  officialAppendNarrativeTool,
  type ApplicationRuntimeOptions,
  type PresetToolMountInput,
  type ToolDefinition,
} from '@loom-studio/application-runtime'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { createPromptResourceStore } from '@loom-studio/application-data'
import { createNarrativeStore } from '@loom-studio/application-data'
import { createMemoryLogSink, createRootLogger } from '@loom-studio/logging'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { callApplicationRpc as handleAgentsRpc } from '../../support/trpc-caller.js'

const readContextTool: ToolDefinition = {
  id: 'official/read_context',
  owner: { namespace: 'official' },
  name: 'read_context',
  description: 'Read deterministic context for {{User}}.',
  input: {
    kind: 'structured',
    schema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
      additionalProperties: false,
    },
  },
  prompt: {
    parameterDescriptions: {
      query: 'Query selected by {{User}}.',
    },
    guidance: 'Return only context visible to {{User}}.',
  },
}

const testContentTool: ToolDefinition = {
  id: 'official/test_content',
  owner: { namespace: 'official' },
  name: 'test_content',
  description: 'Exercise deterministic content tool calling.',
  input: {
    kind: 'hybrid',
    metadataSchema: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['success', 'error'] },
        label: { type: 'string' },
      },
      required: ['mode'],
      additionalProperties: false,
    },
    rawField: 'content',
    mediaType: 'text/plain',
  },
}

describe('Native Function Tool Loop', () => {
  it('recovers a failed response after an applied interjection without resubmitting its user entry', async () => {
    let calls = 0
    let fixture: Awaited<ReturnType<typeof createFixture>>
    fixture = await createFixture({ execute: vi.fn(), invokeChat: async request => {
      if (++calls === 1) await fixture.runtime.submitAgentInterjection({ agentSessionId: fixture.sessionId, requestId: 'recover-receipt', input: 'RECOVER_ME', mode: 'discussion' })
      if (calls === 2) throw new Error('Provider unavailable')
      if (calls === 3) expect(request.request.messages.filter(message => message.role === 'user' && message.content === 'RECOVER_ME')).toHaveLength(1)
      return { provider: 'test', model: 'test-model', text: 'done', message: { role: 'assistant', content: 'done' } }
    } })
    await expect(fixture.runtime.invokeAgentTurn({ agentSessionId: fixture.sessionId, input: 'Start' })).rejects.toThrow('Provider unavailable')
    const recovered = await fixture.runtime.prepareAgentRunRecovery({ agentSessionId: fixture.sessionId })
    expect(recovered).toBeDefined()
    await fixture.runtime.invokeAgentTurn(recovered!.request, { agentRun: { runId: 'explicit-recovery', continuation: recovered!.continuation, onEvent() {} } })
    const page = await fixture.runtime.getAgentTranscriptPage({ agentSessionId: fixture.sessionId })
    expect(page.entries.filter(item => item.entry.kind === 'message' && item.entry.content === 'RECOVER_ME')).toHaveLength(1)
    expect(page.entries.filter(item => item.entry.kind === 'interjection-applied')).toHaveLength(1)
    expect(calls).toBe(3)
  })

  it('handles a receipt after runtime completion before publishing the Run terminal state', async () => {
    let calls = 0
    const fixture = await createFixture({ execute: vi.fn(), invokeChat: async () => {
      calls++
      return { provider: 'test', model: 'test-model', text: 'done', message: { role: 'assistant', content: 'done' } }
    } })
    const invoke = fixture.runtime.invokeAgentTurn.bind(fixture.runtime)
    let first = true
    vi.spyOn(fixture.runtime, 'invokeAgentTurn').mockImplementation(async (input, context) => {
      const result = await invoke(input, context)
      if (first) {
        first = false
        const receipt = await handleAgentsRpc(fixture.runtime, 'application.submitAgentInterjection', { agentSessionId: fixture.sessionId,
          requestId: 'finish-boundary', input: 'LATE_RECEIPT', mode: 'discussion' }) as { runId: string }
        expect(receipt.runId).toBe(context!.agentRun!.runId)
      }
      return result
    })
    const run = await handleAgentsRpc(fixture.runtime, 'application.agent.run.create', { agentSessionId: fixture.sessionId, input: 'Start' }) as { runId: string }
    await vi.waitFor(async () => expect(await handleAgentsRpc(fixture.runtime, 'application.agent.run.state', run)).toMatchObject({ state: 'completed' }))
    const page = await fixture.runtime.getAgentTranscriptPage({ agentSessionId: fixture.sessionId })
    expect(page.entries.filter(item => item.entry.kind === 'message' && item.entry.content === 'LATE_RECEIPT')).toHaveLength(1)
    expect(calls).toBe(2)
  })

  it.each(['resume', 'abandon'] as const)('leaves pending receipts untouched on pause, then handles explicit %s', async action => {
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    let calls = 0
    const fixture = await createFixture({ execute: vi.fn(), invokeChat: async request => {
      if (++calls === 1) { entered.resolve(); await release.promise }
      else expect(request.request.messages.some(item => item.content === 'AFTER_PAUSE')).toBe(action === 'resume')
      return { provider: 'test', model: 'test-model', text: 'done', message: { role: 'assistant', content: 'done' } }
    } })
    const first = await handleAgentsRpc(fixture.runtime, 'application.agent.run.create', { agentSessionId: fixture.sessionId, input: 'Start' }) as { runId: string }
    await entered.promise
    await handleAgentsRpc(fixture.runtime, 'application.agent.run.pause', first)
    await handleAgentsRpc(fixture.runtime, 'application.submitAgentInterjection', { agentSessionId: fixture.sessionId,
      requestId: 'pause-receipt', input: 'AFTER_PAUSE', mode: 'discussion' })
    release.resolve()
    await vi.waitFor(async () => expect(await handleAgentsRpc(fixture.runtime, 'application.agent.run.state', first)).toMatchObject({ state: 'suspended' }))
    expect(calls).toBe(1)
    const page = await fixture.runtime.getAgentTranscriptPage({ agentSessionId: fixture.sessionId })
    expect(page.entries.some(item => item.entry.kind === 'interjection-applied')).toBe(false)
    let next: { runId: string }
    if (action === 'resume') next = await handleAgentsRpc(fixture.runtime, 'application.agent.run.resume', first) as { runId: string }
    else {
      await handleAgentsRpc(fixture.runtime, 'application.agent.run.abandon', first)
      next = await handleAgentsRpc(fixture.runtime, 'application.agent.run.create', { agentSessionId: fixture.sessionId, input: 'Explicit fresh work' }) as { runId: string }
    }
    await vi.waitFor(async () => expect(await handleAgentsRpc(fixture.runtime, 'application.agent.run.state', next)).toMatchObject({ state: 'completed' }))
    expect(calls).toBe(2)
  })

  it('projects a narrative interjection only after the active tool has finished', async () => {
    let calls = 0
    let target: { timelineId: string; branchId: string }
    let fixture: Awaited<ReturnType<typeof createFixture>>
    fixture = await createFixture({ execute: async ({ invocation, scope }) => {
      const cursor = scope!.narrativeSource!.cursorNodeId
      const before = await fixture.runtime.getNarrativePage(target)
      await fixture.runtime.submitAgentInterjection({ agentSessionId: target.timelineId, requestId: 'story-receipt', input: 'USER_STORY_INPUT', mode: 'narrative', narrativeTarget: target })
      expect(scope!.narrativeSource!.cursorNodeId).toBe(cursor)
      expect((await fixture.runtime.getNarrativePage(target)).branch.headNodeId).toBe(before.branch.headNodeId)
      return { invocationId: invocation.id, toolId: invocation.toolId, status: 'completed', content: [] }
    }, invokeChat: async () => {
      if (++calls === 1) return toolCall('story-tool', 'read_context', { query: 'read' })
      expect((await fixture.runtime.getNarrativePage(target)).nodes.at(-1)?.body.raw).toBe('USER_STORY_INPUT')
      return { provider: 'test', model: 'test-model', text: 'done', message: { role: 'assistant', content: 'done' } }
    } })
    const original = await fixture.runtime.getAgentTranscriptPage({ agentSessionId: fixture.sessionId })
    const card = (await fixture.runtime.createCard({ name: 'Interjection story', opening: '' })).card
    const created = await fixture.runtime.createNarrativeTimeline({ cardId: card.id, openingContent: '' })
    target = { timelineId: created.timeline.id, branchId: created.branch.id }
    await fixture.runtime.updateAgentSession({ agentSessionId: target.timelineId, agentPresetId: original.session.agentPresetId! })
    await fixture.runtime.invokeAgentTurn({ agentSessionId: target.timelineId, input: 'Start', narrativeTarget: target })
    const page = await fixture.runtime.getAgentTranscriptPage({ agentSessionId: target.timelineId })
    expect(page.entries.filter(item => item.entry.kind === 'message' && item.entry.content === 'USER_STORY_INPUT')).toHaveLength(1)
    expect(calls).toBe(2)
  })

  it('persists ordered interjections without interrupting the current tool batch and replays each once', async () => {
    let calls = 0
    let fixture: Awaited<ReturnType<typeof createFixture>>
    fixture = await createFixture({
      execute: async ({ invocation }) => {
        const first = { agentSessionId: fixture.sessionId, requestId: 'during-tool-1', input: 'FIRST_INSERT', mode: 'discussion' as const }
        const receipt = await fixture.runtime.submitAgentInterjection(first)
        expect(await fixture.runtime.submitAgentInterjection(first)).toEqual(receipt)
        await fixture.runtime.submitAgentInterjection({ ...first, requestId: 'during-tool-2', input: 'SECOND_INSERT' })
        const page = await fixture.runtime.getAgentTranscriptPage({ agentSessionId: fixture.sessionId })
        expect(page.entries.filter(item => item.entry.kind === 'interjection-applied')).toHaveLength(0)
        return { invocationId: invocation.id, toolId: invocation.toolId, status: 'completed', content: [{ type: 'text', text: 'TOOL_FINISHED' }] }
      },
      invokeChat: async request => {
        if (++calls === 1) return toolCall('receipt-tool', 'read_context', { query: 'read' })
        const messages = request.request.messages
        const tool = messages.findIndex(item => item.role === 'tool' && item.content?.includes('TOOL_FINISHED'))
        const first = messages.findIndex(item => item.role === 'user' && item.content === 'FIRST_INSERT')
        const second = messages.findIndex(item => item.role === 'user' && item.content === 'SECOND_INSERT')
        expect(tool).toBeGreaterThan(-1)
        expect(first).toBeGreaterThan(tool)
        expect(second).toBeGreaterThan(first)
        expect(messages.filter(item => item.content === 'FIRST_INSERT')).toHaveLength(1)
        return { provider: 'test', model: 'test-model', text: 'done', message: { role: 'assistant', content: 'done' } }
      },
    })
    await fixture.runtime.invokeAgentTurn({ agentSessionId: fixture.sessionId, input: 'Begin' })
    const page = await fixture.runtime.getAgentTranscriptPage({ agentSessionId: fixture.sessionId })
    expect(page.entries.filter(item => item.entry.kind === 'user-interjection')).toHaveLength(2)
    expect(page.entries.filter(item => item.entry.kind === 'interjection-applied')).toHaveLength(2)
    expect(calls).toBe(2)
  })

  it('continues after a final response when an interjection arrived during that response', async () => {
    let calls = 0
    let fixture: Awaited<ReturnType<typeof createFixture>>
    fixture = await createFixture({ execute: vi.fn(), invokeChat: async request => {
      if (++calls === 1) {
        await fixture.runtime.submitAgentInterjection({ agentSessionId: fixture.sessionId, requestId: 'during-model', input: 'NEW_REQUEST', mode: 'discussion' })
        expect(request.request.messages.some(item => item.content === 'NEW_REQUEST')).toBe(false)
      } else {
        expect(request.request.messages.slice(-3)).toEqual([
          { role: 'assistant', content: 'COMPLETE_FIRST_RESPONSE' }, expect.objectContaining({ role: 'system' }), { role: 'user', content: 'NEW_REQUEST' },
        ])
      }
      const text = calls === 1 ? 'COMPLETE_FIRST_RESPONSE' : 'SECOND_RESPONSE'
      return { provider: 'test', model: 'test-model', text, message: { role: 'assistant', content: text } }
    } })
    const result = await fixture.runtime.invokeAgentTurn({ agentSessionId: fixture.sessionId, input: 'Begin' })
    expect(result.entries.assistant.entry).toMatchObject({ content: 'SECOND_RESPONSE' })
    expect(calls).toBe(2)
  })

  it('executes a native call with whitespace-only assistant text and returns its paired result', async () => {
    let calls = 0
    const fixture = await createFixture({
      execute: ({ invocation }) => ({ invocationId: invocation.id, toolId: invocation.toolId, status: 'completed', content: [] }),
      invokeChat: async request => {
        if (++calls === 1) {
          const response = toolCall('whitespace-call', 'read_context', { query: 'test' })
          return { ...response, message: { ...response.message, content: ' \n ' } }
        }
        expect(request.request.messages).toContainEqual(expect.objectContaining({ role: 'tool', tool_call_id: 'whitespace-call', content: 'completed' }))
        return { provider: 'test', model: 'test-model', text: 'done', finishReason: 'stop', message: { role: 'assistant', content: 'done' } }
      },
    })
    try {
      await fixture.runtime.invokeAgentTurn({ agentSessionId: fixture.sessionId, input: 'test' })
      expect(calls).toBe(2)
    } finally { fixture.close() }
  })

  it.each(['count', 'bytes'] as const)('bounds producer tool evidence (%s) without interrupting tool execution', async budget => {
    let calls = 0
    const fixture = await createFixture({
      execute: ({ invocation, scope }) => {
        if (budget === 'bytes') scope?.observeToolEvent?.({ kind: 'receipt', content: 'x'.repeat(1024 * 1024) })
        for (let index = 0; index < 140; index += 1) scope?.observeToolEvent?.({ kind: 'receipt', index })
        return { invocationId: invocation.id, toolId: invocation.toolId, status: 'completed', content: [{ type: 'text', text: 'done' }] }
      },
      invokeChat: async () => ++calls === 1 ? toolCall('bounded', 'read_context', { query: 'test' }) : {
        provider: 'test', model: 'test-model', text: 'done', finishReason: 'stop', message: { role: 'assistant', content: 'done' },
      },
    })
    try {
      await expect(fixture.runtime.invokeAgentTurn({ agentSessionId: fixture.sessionId, input: 'test' }))
        .resolves.toMatchObject({ entries: { assistant: { entry: { content: 'done' } } } })
      const run = fixture.observations.list({ kind: 'run' }).records[0]!
      const request = fixture.observations.children(run.id).find(entry => entry.kind === 'request' && entry.providerStep === 1)!
      const evidence = fixture.observations.get(request.id)!
      expect(evidence.availability).toBe('partial')
      expect(evidence.request?.toolExecutions?.[0]?.events).toHaveLength(budget === 'count' ? 128 : 1)
      if (budget === 'bytes') expect(evidence.request?.toolExecutions?.[0]?.resultOmitted).toBe(true)
      expect(evidence.request?.toolExecutions?.[0]?.status).toBe('completed')
      expect(calls).toBe(2)
    } finally { fixture.close() }
  })

  it('stops an output-limited step with no visible progress and preserves native reasoning', async () => {
    let calls = 0
    const fixture = await createFixture({ execute: vi.fn(), invokeChat: async () => {
      calls++
      if (calls > 1) throw new Error('Must not request the same empty continuation')
      return { provider: 'test', model: 'test', text: '', reasoning: 'Budget consumed while thinking', finishReason: 'length', message: { role: 'assistant' } }
    } })
    try {
      await expect(fixture.runtime.invokeAgentTurn({ agentSessionId: fixture.sessionId, input: 'Work' }))
        .rejects.toThrow('automatic continuation stopped')
      expect(calls).toBe(1)
      const { entries } = await fixture.runtime.getAgentTranscriptPage({ agentSessionId: fixture.sessionId })
      expect(entries).toEqual(expect.arrayContaining([expect.objectContaining({ entry: expect.objectContaining({
        kind: 'reasoning', source: 'provider-native', content: 'Budget consumed while thinking', replay: 'omit',
      }) })]))
    } finally { fixture.close() }
  })

  it.each([false, true])('returns invalid native input to the model without executing it (SDK diagnostic: %s)', async sdkError => {
    let calls = 0
    const execute = vi.fn()
    const fixture = await createFixture({ execute, invokeChat: async input => {
      if (++calls === 1) return { provider: 'test', model: 'test', text: '', finishReason: 'tool_call',
        message: { role: 'assistant', tool_calls: [{ id: 'bad', type: 'function', function: { name: 'read_context', arguments: '{broken' } }] },
        ...(sdkError ? { toolCallErrors: { bad: { code: 'tool.invalid_input', message: 'SDK could not parse tool input' } } } : {}) }
      expect(input.request.messages).toEqual(expect.arrayContaining([expect.objectContaining({ role: 'tool', tool_call_id: 'bad', content: expect.any(String) })]))
      const assistant = input.request.messages.find(message => message.role === 'assistant' && message.tool_calls?.length)
      expect(() => JSON.parse(assistant!.role === 'assistant' ? assistant!.tool_calls![0]!.function.arguments : '')).not.toThrow()
      return { provider: 'test', model: 'test', text: 'Corrected response', reasoning: 'Reviewed failure', finishReason: 'stop', message: { role: 'assistant', content: 'Corrected response' } }
    } })
    try {
      await fixture.runtime.invokeAgentTurn({ agentSessionId: fixture.sessionId, input: 'Read context' })
      expect(execute).not.toHaveBeenCalled()
      expect(calls).toBe(2)
      const { entries } = await fixture.runtime.getAgentTranscriptPage({ agentSessionId: fixture.sessionId })
      expect(entries).toEqual(expect.arrayContaining([expect.objectContaining({ entry: expect.objectContaining({
        kind: 'tool-result', status: 'failed', error: expect.objectContaining({ code: 'tool.invalid_input' }),
      }) }), expect.objectContaining({ entry: expect.objectContaining({ kind: 'reasoning', content: 'Reviewed failure', source: 'provider-native' }) })]))
    } finally { fixture.close() }
  })

  it('continues beyond eight Provider rounds until a final response', async () => {
    let calls = 0
    let tools = 0
    const fixture = await createFixture({
      execute: async ({ invocation }) => {
        tools++
        return { invocationId: invocation.id, toolId: invocation.toolId, status: 'completed', content: [] }
      },
      invokeChat: async () => ++calls <= 10 ? toolCall(`call-${calls}`, 'read_context', { query: 'next' }) : {
        provider: 'test', model: 'test-model', text: 'Done.', finishReason: 'stop', message: { role: 'assistant', content: 'Done.' },
      },
    })
    try {
      await fixture.runtime.invokeAgentTurn({ agentSessionId: fixture.sessionId, input: 'Complete the work' })
      expect(calls).toBe(11)
      expect(tools).toBe(10)
      const transcript = await fixture.runtime.getAgentTranscriptPage({ agentSessionId: fixture.sessionId })
      expect(transcript.entries.some(item => item.entry.kind === 'run-state' && item.entry.state === 'completed')).toBe(true)
    } finally { fixture.close() }
  })

  it('allows a tool to wait beyond thirty seconds without an application timeout', async () => {
    let calls = 0
    const started = Promise.withResolvers<void>()
    const fixture = await createFixture({
      execute: async ({ invocation }) => {
        const waiting = new Promise(resolve => setTimeout(resolve, 31_000))
        started.resolve()
        await waiting
        return { invocationId: invocation.id, toolId: invocation.toolId, status: 'completed', content: [] }
      },
      invokeChat: async () => ++calls === 1 ? toolCall('long-call', 'read_context', { query: 'image' }) : {
        provider: 'test', model: 'test-model', text: 'Done.', finishReason: 'stop', message: { role: 'assistant', content: 'Done.' },
      },
    })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const turn = fixture.runtime.invokeAgentTurn({ agentSessionId: fixture.sessionId, input: 'Wait for the tool' })
      await started.promise
      await vi.advanceTimersByTimeAsync(31_001)
      await turn
      const transcript = await fixture.runtime.getAgentTranscriptPage({ agentSessionId: fixture.sessionId })
      expect(transcript.entries.find(item => item.entry.kind === 'tool-result')?.entry).toMatchObject({ status: 'completed' })
    } finally { vi.useRealTimers(); fixture.close() }
  })

  it('delivers a completed prompt beyond the replay budget until the Client acknowledges it', async () => {
    const fixture = await createFixture({
      execute: async ({ invocation }) => ({
        invocationId: invocation.id, toolId: invocation.toolId, status: 'completed', content: [],
      }),
      invokeChat: async () => ({
        provider: 'test', model: 'test-model', text: 'Done.',
        finishReason: 'stop', message: { role: 'assistant', content: 'Done.' },
      }),
    })
    try {
      const invoke = vi.spyOn(fixture.runtime, 'invokeAgentTurn')
      const input = 'context '.repeat(75 * 1024)
      const { runId } = await handleAgentsRpc(fixture.runtime, 'application.agent.run.create', {
        agentSessionId: fixture.sessionId, input,
      }) as { runId: string }
      await vi.waitFor(async () => {
        expect(await handleAgentsRpc(fixture.runtime, 'application.agent.run.state', { runId }))
          .toMatchObject({ state: 'completed' })
      })
      const result = await invoke.mock.results[0]!.value
      expect(Buffer.byteLength(JSON.stringify(result))).toBeGreaterThan(1024 * 1024)
      const batch = await handleAgentsRpc(fixture.runtime, 'application.agent.run.subscribe', { runId, cursor: 0 })
      expect(batch).toMatchObject({
        done: true, state: 'completed', replayExpired: true,
        events: [{ type: 'completed', result: JSON.parse(JSON.stringify(result)) }],
      })
      expect(await handleAgentsRpc(fixture.runtime, 'application.agent.run.subscribe', { runId, cursor: 0 }))
        .toEqual(batch)
      expect(await handleAgentsRpc(fixture.runtime, 'application.agent.run.acknowledge-completion', { runId }))
        .toMatchObject({ accepted: true })
      expect(await handleAgentsRpc(fixture.runtime, 'application.agent.run.acknowledge-completion', { runId }))
        .toMatchObject({ accepted: false })
      expect(await handleAgentsRpc(fixture.runtime, 'application.agent.run.subscribe', { runId, cursor: 0 }))
        .toMatchObject({ done: true, state: 'completed', replayExpired: true, events: [] })
      const transcript = await fixture.runtime.getAgentTranscriptPage({ agentSessionId: fixture.sessionId })
      expect(transcript.entries).toEqual(expect.arrayContaining([
        expect.objectContaining({ entry: expect.objectContaining({ kind: 'message', role: 'assistant', content: 'Done.' }) }),
      ]))
    } finally { fixture.close() }
  })
  it('continues a Timeline root Run after its own narrative tool appends a transcript entry', async () => {
    let steps = 0
    let narrativeAnnounced = false
    const fixture = await createFixture({
      execute: async ({ invocation, scope }) => {
        if (steps === 1) await scope!.narrative!.appendNode({ content: 'Root story.' })
        else await scope!.narrative!.editNode({ floor: 1, content: 'Edited story.' })
        return { invocationId: invocation.id, toolId: invocation.toolId, status: 'completed', content: [] }
      },
      invokeChat: async () => {
        if (steps++ % 2 === 0) return toolCall('append-root', 'read_context', { query: 'write' })
        expect(narrativeAnnounced).toBe(true)
        return { provider: 'test', model: 'test-model', text: 'Done.', finishReason: 'stop', message: { role: 'assistant', content: 'Done.' } }
      },
    })
    try {
      const original = await fixture.runtime.getAgentTranscriptPage({ agentSessionId: fixture.sessionId })
      const { card } = await fixture.runtime.createCard({ name: 'Root writer' })
      const { timeline, branch } = await fixture.runtime.createNarrativeTimeline({ cardId: card.id })
      await fixture.runtime.updateAgentSession({ agentSessionId: timeline.id, agentPresetId: original.session.agentPresetId, narrativeMode: 'declared' })
      await fixture.runtime.invokeAgentTurn({ agentSessionId: timeline.id, input: 'Write.', narrativeTarget: { timelineId: timeline.id, branchId: branch.id } }, { agentRun: { runId: 'root-live', onEvent: event => {
        if (event.type === 'transcript-appended' && event.entries.some(item => item.entry.kind === 'message' && item.entry.purpose === 'narrative')) narrativeAnnounced = true
      } } })
      const page = await fixture.runtime.getAgentTranscriptPage({ agentSessionId: timeline.id })
      expect(page.entries.find(item => item.entry.kind === 'tool-result')?.entry).toMatchObject({ status: 'completed' })
      expect(page.entries).toEqual(expect.arrayContaining([
        expect.objectContaining({ entry: expect.objectContaining({ kind: 'tool-result', status: 'completed' }) }),
        expect.objectContaining({ entry: expect.objectContaining({ kind: 'run-state', state: 'completed' }) }),
      ]))
      expect(steps).toBe(2)
      await fixture.runtime.invokeAgentTurn({ agentSessionId: timeline.id, input: 'Next.', narrativeTarget: { timelineId: timeline.id, branchId: branch.id } })
      expect((await fixture.runtime.getNarrativePage({ timelineId: timeline.id, branchId: branch.id })).nodes[0]?.body.raw).toBe('Edited story.')
    } finally { fixture.close() }
  })

  it.each(['success', 'conflict', 'storage'] as const)('persists the official append ToolResult and real Narrative outcome (%s)', async scenario => {
    let steps = 0
    const requests: unknown[][] = []
    const fixture = await createFixture({
      agentTools: createOfficialAgentToolRegistry(),
      tools: [officialAppendNarrativeTool],
      invokeChat: async input => {
        requests.push(input.request.messages)
        return steps++ === 0
          ? toolCall('append-story', 'append_narrative', { content: 'Tool story.' })
          : { provider: 'test', model: 'test-model', text: 'Done.', finishReason: 'stop', message: { role: 'assistant', content: 'Done.' } }
      },
    })
    try {
      const { card } = await fixture.runtime.createCard({ name: 'Append story' })
      const timeline = await fixture.runtime.createNarrativeTimeline({ cardId: card.id })
      const appendNode = fixture.narratives.appendNode.bind(fixture.narratives)
      const append = vi.spyOn(fixture.narratives, 'appendNode')
      if (scenario === 'conflict') {
        append.mockImplementationOnce(async input => {
          await appendNode({ ...input, nodeId: 'concurrent-node', body: { format: 'loom-markdown.v1', raw: 'Concurrent story.' } })
          return appendNode(input)
        })
      }
      if (scenario === 'storage') {
        fixture.engine.database.exec(`CREATE TRIGGER fail_tool_append BEFORE INSERT ON narrative_nodes
          BEGIN SELECT RAISE(ABORT, 'test storage failure'); END`)
      }
      const result = await fixture.runtime.invokeAgentTurn({
        agentSessionId: fixture.sessionId, input: 'Write.',
        narrativeTarget: { timelineId: timeline.timeline.id, branchId: timeline.branch.id },
      })
      expect(append).toHaveBeenCalledTimes(1)
      expect(requests).toHaveLength(2)
      const transcript = await fixture.runtime.getAgentTranscriptPage({ agentSessionId: fixture.sessionId })
      const toolResult = transcript.entries.find(entry => entry.entry.kind === 'tool-result')!.entry
      expect(toolResult).toMatchObject({ kind: 'tool-result', status: scenario === 'success' ? 'completed' : 'failed' })
      const page = await fixture.runtime.getNarrativePage({ timelineId: timeline.timeline.id })
      expect(page.nodes.map(node => node.body.raw)).toEqual(scenario === 'success' ? ['Tool story.'] : scenario === 'conflict' ? ['Concurrent story.'] : [])
      if (scenario === 'success') {
        expect(toolResult).toMatchObject({ content: [{ type: 'json', value: { floor: page.nodes[0]!.floor, path: `/narrative/${page.nodes[0]!.floor}.md` } }] })
        const changeset = fixture.engine.database.prepare('SELECT reason FROM changesets WHERE id = ?').get(page.nodes[0]!.source!.changesetId!)
        expect(changeset).toEqual({ reason: 'application.tool.appendNarrative' })
      } else {
        expect(JSON.stringify(requests[1])).toContain(scenario === 'conflict' ? 'The Narrative head changed after this task started' : 'test storage failure')
        if (scenario === 'conflict') expect(toolResult).toMatchObject({ error: { code: 'narrative.swipe_source_changed' } })
      }
      expect(result.mutation.scope).toBe('agent-session-transcript')
    } finally { await fixture.close() }
  })

  it.each(['shared', 'intervening', 'outside'] as const)('isolates Narrative tool edits from other branches (%s)', async scenario => {
    const interveningEdit = scenario === 'intervening'
    let nodeId = ''
    let steps = 0
    const fixture = await createFixture({
      agentTools: createOfficialAgentToolRegistry(),
      tools: [officialEditNarrativeTool],
      invokeChat: async () => steps++ === 0
        ? toolCall('edit-branch-node', 'edit_narrative', { floor: scenario === 'outside' ? 2 : 1, content: 'Agent edit' })
        : { provider: 'test', model: 'test-model', text: 'Done.', finishReason: 'stop', message: { role: 'assistant', content: 'Done.' } },
    })
    try {
      const { card } = await fixture.runtime.createCard({
        name: 'Branch isolation', opening: { content: 'Original' },
      })
      const timeline = await fixture.runtime.createNarrativeTimeline({ cardId: card.id })
      if (scenario === 'outside') {
        const appended = await fixture.runtime.appendNarrativeInput({ timelineId: timeline.timeline.id, branchId: timeline.branch.id,
          nodeId: 'other-branch-history', expectedHeadNodeId: timeline.branch.headNodeId!, content: 'Other branch only',
        })
        timeline.nodes.push(appended.node)
        timeline.branch = appended.branch
      }
      nodeId = (scenario === 'outside' ? timeline.nodes[1] : timeline.nodes[0])!.id
      const { branch } = await fixture.runtime.forkNarrativeBranch({
        timelineId: timeline.timeline.id, fromBranchId: timeline.branch.id, fromNodeId: timeline.nodes[0]!.id,
      })
      const getPage = fixture.narratives.getPage.bind(fixture.narratives)
      const getNode = fixture.narratives.getNode.bind(fixture.narratives)
      let injected = false
      vi.spyOn(fixture.narratives, 'getNode').mockImplementation(async id => {
        const node = await getNode(id)
        if (interveningEdit && !injected && id === nodeId) {
          injected = true
          await fixture.runtime.editNarrativeNode({
            timelineId: timeline.timeline.id, branchId: branch.id, nodeId,
            expectedHeadNodeId: branch.headNodeId!, expectedRaw: 'Original', raw: 'User edit',
          })
        }
        return node
      })
      await fixture.runtime.invokeAgentTurn({
        agentSessionId: fixture.sessionId, input: 'Edit only this branch.',
        narrativeTarget: { timelineId: timeline.timeline.id, branchId: branch.id },
      })
      const transcript = await fixture.runtime.getAgentTranscriptPage({ agentSessionId: fixture.sessionId })
      const result = transcript.entries.find(entry => entry.entry.kind === 'tool-result')?.entry
      expect(result, JSON.stringify(result)).toMatchObject({ kind: 'tool-result', status: scenario === 'shared' ? 'completed' : 'failed' })
      const original = await getPage({ timelineId: timeline.timeline.id, branchId: timeline.branch.id })
      const edited = await getPage({ timelineId: timeline.timeline.id, branchId: branch.id })
      expect(original.nodes.map(node => node.body.raw)).toEqual(scenario === 'outside' ? ['Original', 'Other branch only'] : ['Original'])
      expect(edited.nodes.map(node => node.body.raw)).toEqual([scenario === 'shared' ? 'Agent edit' : interveningEdit ? 'User edit' : 'Original'])
      expect(edited.nodes[0]!.id).not.toBe(nodeId)
      if (interveningEdit) {
        expect(injected).toBe(true)
        expect(result).toMatchObject({ error: { code: 'narrative.swipe_source_changed' } })
      } else if (scenario === 'outside') {
        expect(JSON.stringify(result)).toContain('floor 2 is unavailable')
      } else expect(result).toMatchObject({ content: [{ type: 'json', value: { floor: 1, path: '/narrative/1.md' } }] })
    } finally {
      await fixture.close()
    }
  })

  it('skips a missing mounted tool with a warning in turn preview', async () => {
    const registry = createAgentToolRegistry([readContextTool])
    const fixture = await createFixture({
      agentTools: registry,
      invokeChat: async () => { throw new Error('Preview must not invoke the provider') },
    })
    try {
      registry.replaceDefinitions([])
      const result = await fixture.runtime.previewAgentTurn({ agentSessionId: fixture.sessionId, input: 'Hello' })
      expect(result.toolPromptBuildTrace.diagnostics).toContainEqual(expect.objectContaining({
        severity: 'warning', code: 'tool.missing', toolId: readContextTool.id,
      }))
      expect(result.toolPromptBuildTrace.effectiveOrder).toEqual([])
      expect(result.promptBuildTrace.diagnostics).toContainEqual(expect.objectContaining({
        severity: 'warning', code: 'tool.missing', toolId: readContextTool.id,
      }))
    } finally {
      fixture.close()
    }
  })

  it.each([
    { metadata: '{}', status: 'completed', executions: 1 },
    { metadata: '{"unexpected":"must not be discarded"}', status: 'failed', executions: 0 },
  ] as const)('handles freeform Content metadata $metadata without silently dropping arguments', async ({ metadata, status, executions }) => {
    let executed = 0
    let steps = 0
    const fixture = await createFixture({
      tool: {
        id: 'test/freeform', owner: { namespace: 'test' }, name: 'raw_text', description: 'Accept raw text.',
        input: { kind: 'freeform', mediaType: 'text/plain' },
      },
      execute: ({ invocation }) => {
        executed++
        expect(invocation.arguments).toBeUndefined()
        expect(invocation.rawInput).toBe('story')
        return { invocationId: invocation.id, toolId: invocation.toolId, status: 'completed', content: [] }
      },
      invokeChat: async () => ({
        provider: 'test', model: 'test-model', text: '', finishReason: 'stop',
        message: {
          role: 'assistant',
          content: steps++ === 0
            ? `<loom_tool name="raw_text"><metadata>${metadata}</metadata><content>story</content></loom_tool>`
            : 'Done.',
        },
      }),
    })
    try {
      await fixture.runtime.invokeAgentTurn({ agentSessionId: fixture.sessionId, input: 'Write.' })
      const page = await fixture.runtime.getAgentTranscriptPage({ agentSessionId: fixture.sessionId })
      expect(executed).toBe(executions)
      expect(page.entries.filter(entry => entry.entry.kind === 'tool-result').map(entry => entry.entry))
        .toEqual([expect.objectContaining({ status })])
      const records = fixture.logs.list()
      expect(records.filter(record => record.event === 'step.started').map(record => record.data?.providerStep)).toEqual([1, 2])
      expect(records.some(record => record.event === `tool.${status}`)).toBe(true)
      expect(records.at(-1)).toMatchObject({ event: 'run.completed', data: { providerStep: 2, toolCount: 1 } })
      expect(new Set(records.map(record => record.data?.runId)).size).toBe(1)
    } finally {
      fixture.close()
    }
  })

  it('reads, updates, and reads Timeline State again across Provider steps', async () => {
    const requests: unknown[][] = []
    const onStateChanged = vi.fn()
    let target!: { scope: 'timeline'; timelineId: string; branchId: string }
    let initialRevisionId = ''
    const fixture = await createFixture({
      agentTools: createOfficialAgentToolRegistry(),
      tools: [officialReadStateTool, officialUpdateStateTool],
      onStateChanged,
      invokeChat: async input => {
        requests.push(input.request.messages)
        if (requests.length === 1) return toolCall('read-initial', 'read_state', { target })
        if (requests.length === 2) return toolCall('update-gold', 'update_state', {
          target,
          expectedRevisionId: initialRevisionId,
          operations: [{ op: 'increment', path: '/characters/alice/gold', by: -3 }],
        })
        if (requests.length === 3) return toolCall('read-updated', 'read_state', { target, paths: ['/characters/alice/gold'] })
        return {
          provider: 'test', model: 'test-model', text: 'Gold is now 7.', finishReason: 'stop',
          message: { role: 'assistant', content: 'Gold is now 7.' },
        }
      },
    })
    const card = await fixture.runtime.importCardBundle({ artifact: statefulCardArtifact() })
    const timeline = await fixture.runtime.createNarrativeTimeline({ cardId: card.card.id })
    target = { scope: 'timeline', timelineId: timeline.timeline.id, branchId: timeline.branch.id }
    initialRevisionId = (await fixture.runtime.getStateSnapshot({ target })).snapshot.revisionId

    await fixture.runtime.invokeAgentTurn({ agentSessionId: fixture.sessionId, input: 'Spend three gold.', narrativeTarget: { ...target } })

    expect(requests).toHaveLength(4)
    expect((requests[3] as Array<{ role?: string; content?: string }>).findLast(message => message.role === 'tool')?.content)
      .toContain('"/characters/alice/gold":7')
    await expect(fixture.runtime.getStateSnapshot({ target })).resolves.toMatchObject({
      snapshot: { value: { characters: { alice: { gold: 7 } } } },
    })
    expect(onStateChanged).toHaveBeenCalledTimes(1)
    expect(onStateChanged).toHaveBeenCalledWith({
      target,
      revisionId: (await fixture.runtime.getStateSnapshot({ target })).snapshot.revisionId,
      changesetId: expect.any(String),
      paths: ['/characters/alice/gold'],
    })
    fixture.close()
  })

  it('keeps prototype-like keys as own data through the official State tool', async () => {
    const key = 'fr008Agent'
    let target!: { scope: 'timeline'; timelineId: string; branchId: string }
    let revisionId = ''
    const requests: unknown[][] = []
    const fixture = await createFixture({
      agentTools: createOfficialAgentToolRegistry(),
      tools: [officialUpdateStateTool],
      invokeChat: async input => {
        requests.push(input.request.messages)
        if (requests.length === 1) return toolCall('prototype-write', 'update_state', {
          target,
          expectedRevisionId: revisionId,
          operations: [
            { op: 'set', path: `/__proto__/${key}`, value: true },
            { op: 'set', path: `/constructor/prototype/${key}`, value: 7 },
          ],
        })
        return {
          provider: 'test', model: 'test-model', text: 'Done.', finishReason: 'stop',
          message: { role: 'assistant', content: 'Done.' },
        }
      },
    })
    try {
      const card = await fixture.runtime.importCardBundle({ artifact: statefulCardArtifact() })
      const timeline = await fixture.runtime.createNarrativeTimeline({ cardId: card.card.id })
      target = { scope: 'timeline', timelineId: timeline.timeline.id, branchId: timeline.branch.id }
      revisionId = (await fixture.runtime.getStateSnapshot({ target })).snapshot.revisionId
      await fixture.runtime.invokeAgentTurn({
        agentSessionId: fixture.sessionId,
        input: 'Write the supplied State keys.',
        narrativeTarget: { ...target },
      })
      expect(requests).toHaveLength(2)
      const { snapshot } = await fixture.runtime.getStateSnapshot({ target })
      expect(snapshot.revisionId).not.toBe(revisionId)
      expect(Object.hasOwn(snapshot.value, '__proto__')).toBe(true)
      expect(JSON.parse(JSON.stringify(snapshot.value))).toMatchObject(JSON.parse(
        `{"__proto__":{"${key}":true},"constructor":{"prototype":{"${key}":7}}}`,
      ))
      expect(Object.hasOwn(Object.prototype, key)).toBe(false)
    } finally {
      fixture.close()
      Reflect.deleteProperty(Object.prototype, key)
    }
  })

  it('updates state in a single step using dot notation without target or revision lock', async () => {
    const requests: unknown[][] = []
    const onStateChanged = vi.fn()
    let target!: { scope: 'timeline'; timelineId: string; branchId: string }
    const fixture = await createFixture({
      agentTools: createOfficialAgentToolRegistry(),
      tools: [officialUpdateStateTool],
      onStateChanged,
      invokeChat: async input => {
        requests.push(input.request.messages)
        if (requests.length === 1) {
          // 模型直接发起增量修改：无需 target，无需 expectedRevisionId，纯属性点语法
          return toolCall('update-gold-fast', 'update_state', {
            increment: { 'characters.alice.gold': -3 },
          })
        }
        return {
          provider: 'test', model: 'test-model', text: '已消耗 3 枚金币。', finishReason: 'stop',
          message: { role: 'assistant', content: '已消耗 3 枚金币。' },
        }
      },
    })
    const card = await fixture.runtime.importCardBundle({ artifact: statefulCardArtifact() })
    const timeline = await fixture.runtime.createNarrativeTimeline({ cardId: card.card.id })
    target = { scope: 'timeline', timelineId: timeline.timeline.id, branchId: timeline.branch.id }

    await fixture.runtime.invokeAgentTurn({
      agentSessionId: fixture.sessionId,
      input: '扣除爱丽丝 3 个金币。',
      narrativeTarget: { ...target },
    })

    expect(requests).toHaveLength(2)
    expect(onStateChanged).toHaveBeenCalledTimes(1)
    expect(onStateChanged).toHaveBeenCalledWith({
      target,
      revisionId: (await fixture.runtime.getStateSnapshot({ target })).snapshot.revisionId,
      changesetId: expect.any(String),
      paths: ['/characters/alice/gold'],
    })
    await expect(fixture.runtime.getStateSnapshot({ target })).resolves.toMatchObject({
      snapshot: {
        value: {
          characters: {
            alice: {
              gold: 7,
            },
          },
        },
      },
    })
    fixture.close()
  })

  it('keeps a committed State Tool mutation when a later Provider step fails', async () => {
    const onStateChanged = vi.fn()
    let target!: { scope: 'timeline'; timelineId: string; branchId: string }
    let initialRevisionId = ''
    let calls = 0
    const fixture = await createFixture({
      agentTools: createOfficialAgentToolRegistry(),
      tools: [officialUpdateStateTool],
      onStateChanged,
      invokeChat: async () => {
        calls += 1
        if (calls === 1) return toolCall('update-before-failure', 'update_state', {
          target, expectedRevisionId: initialRevisionId,
          operations: [{ op: 'increment', path: '/characters/alice/gold', by: -3 }],
        })
        throw new Error('provider disconnected')
      },
    })
    const card = await fixture.runtime.importCardBundle({ artifact: statefulCardArtifact() })
    const timeline = await fixture.runtime.createNarrativeTimeline({ cardId: card.card.id })
    target = { scope: 'timeline', timelineId: timeline.timeline.id, branchId: timeline.branch.id }
    initialRevisionId = (await fixture.runtime.getStateSnapshot({ target })).snapshot.revisionId

    await expect(fixture.runtime.invokeAgentTurn({
      agentSessionId: fixture.sessionId, input: 'Spend three gold.', narrativeTarget: { ...target },
    })).rejects.toThrow('provider disconnected')
    expect(onStateChanged).toHaveBeenCalledTimes(1)
    expect(onStateChanged).toHaveBeenCalledWith({
      target,
      revisionId: (await fixture.runtime.getStateSnapshot({ target })).snapshot.revisionId,
      changesetId: expect.any(String),
      paths: ['/characters/alice/gold'],
    })
    await expect(fixture.runtime.getStateSnapshot({ target })).resolves.toMatchObject({
      snapshot: { value: { characters: { alice: { gold: 7 } } } },
    })
    fixture.close()
  })
  it('runs native then content tools in one turn before returning the final answer', async () => {
    const requests: Array<{ messages: unknown[]; tools?: unknown[] }> = []
    const fixture = await createFixture({
      tools: [readContextTool, testContentTool],
      execute: ({ invocation }) => ({
        invocationId: invocation.id,
        toolId: invocation.toolId,
        status: 'completed',
        content: [{ type: 'text', text: `result:${invocation.toolId}` }],
        ...(invocation.toolId === readContextTool.id ? {
          contextMounts: [{
            id: 'context-weather',
            name: 'Weather',
            virtualPath: '/context/Weather.md',
            mediaType: 'text/plain',
            zoneId: 'lore.stable',
            slotKey: 'setting:weather',
            sourceKind: 'lore',
            sourceId: 'setting-weather',
            promptState: 'not-triggered' as const,
            content: 'Fresh weather context.',
          }],
        } : {}),
      }),
      invokeChat: async (input) => {
        requests.push({ messages: input.request.messages, tools: input.request.tools })
        if (requests.length === 1) {
          return {
            provider: 'test',
            model: 'test-model',
            text: '',
            finishReason: 'tool_call',
            message: {
              role: 'assistant',
              tool_calls: [{
                id: 'provider-native-call',
                type: 'function',
                function: { name: 'read_context', arguments: '{"query":"first"}' },
              }],
            },
          }
        }
        if (requests.length === 2) {
          return {
            provider: 'test',
            model: 'test-model',
            text: '',
            finishReason: 'stop',
            message: {
              role: 'assistant',
              content: '<loom_tool name="test_content"><metadata>{"mode":"success","label":"second"}</metadata><content>raw body</content></loom_tool>',
            },
          }
        }
        return {
          provider: 'test',
          model: 'test-model',
          text: 'Both tools finished.',
          finishReason: 'stop',
          message: { role: 'assistant', content: 'Both tools finished.' },
        }
      },
    })

    const result = await fixture.runtime.invokeAgentTurn({
      agentSessionId: fixture.sessionId,
      input: 'Run both tools in order.',
    })
    const entries = (await fixture.runtime.getAgentTranscriptPage({
      agentSessionId: fixture.sessionId,
    })).entries.map(entry => entry.entry)

    expect(requests).toHaveLength(3)
    const observedRun = fixture.observations.list({ kind: 'run' }).records[0]!
    const observedRequests = fixture.observations.children(observedRun.id).filter(entry => entry.kind === 'request')
      .sort((a, b) => a.providerStep! - b.providerStep!)
    expect(observedRequests).toHaveLength(3)
    expect(fixture.observations.list({ kind: 'api' }).records).toHaveLength(0)
    observedRequests.forEach((entry, index) => {
      const request = fixture.observations.get(entry.id)!.request!
      expect(request.messages).toEqual(requests[index]!.messages)
      expect(request.tools).toEqual(requests[index]!.tools)
      expect(request.phase).toBe('completed')
    })
    expect(fixture.observations.get(observedRequests[0]!.id)!.request!.toolExecutions).toEqual([
      expect.objectContaining({ status: 'completed', events: [expect.objectContaining({ kind: 'approval' })],
        result: expect.objectContaining({ contextMounts: [expect.objectContaining({ id: 'context-weather' })] }) }),
    ])
    expect(requests[1]?.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'tool', tool_call_id: 'provider-native-call' }),
      { role: 'system', content: '[Fresh Context: Weather]\nFresh weather context.' },
    ]))
    const contentInvocation = entries.find(entry => entry.kind === 'tool-invocation' && entry.transport === 'content')
    if (contentInvocation?.kind !== 'tool-invocation') throw new Error('Missing content tool invocation')
    expect(entries).toContainEqual(expect.objectContaining({ kind: 'tool-result', invocationId: contentInvocation.invocationId }))
    expect(requests[2]?.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'user',
        content: expect.stringContaining(`<loom_tool_result invocation_id="${contentInvocation.invocationId}"`),
      }),
    ]))
    expect(requests[2]?.messages).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ content: expect.stringContaining('Fresh weather context.') }),
    ]))
    expect(entries.filter(entry => entry.kind === 'tool-invocation')).toHaveLength(2)
    expect(entries.filter(entry => entry.kind === 'tool-result')).toHaveLength(2)
    expect(result.entries.assistant.entry).toMatchObject({
      kind: 'message',
      content: 'Both tools finished.',
    })
    fixture.close()
  })

  it('persists invocation and result, replays the Provider call id, and continues to stop', async () => {
    const requests: Array<{ messages: unknown[]; tools?: unknown[] }> = []
    const fixture = await createFixture({
      execute: ({ invocation }) => ({
        invocationId: invocation.id,
        toolId: invocation.toolId,
        status: 'completed',
        content: [
          {
            type: 'text',
            text: `result:${String(invocation.arguments?.query)}`,
          },
        ],
      }),
      invokeChat: async (input) => {
        requests.push({
          messages: input.request.messages,
          tools: input.request.tools,
        })
        if (requests.length === 1) {
          return {
            provider: 'test',
            model: 'test-model',
            text: '',
            finishReason: 'stop',
            providerCallId: 'provider-step-1',
            message: {
              role: 'assistant',
              tool_calls: [
                {
                  id: 'provider-call-1',
                  type: 'function',
                  function: {
                    name: 'read_context',
                    arguments: '{"query":"weather"}',
                  },
                },
              ],
            },
          }
        }
        return {
          provider: 'test',
          model: 'test-model',
          text: 'Final answer.',
          finishReason: 'stop',
          providerCallId: 'provider-step-2',
          message: { role: 'assistant', content: 'Final answer.' },
        }
      },
    })

    const result = await fixture.runtime.invokeAgentTurn({
      agentSessionId: fixture.sessionId,
      input: 'Use the tool.',
    })
    const page = await fixture.runtime.getAgentTranscriptPage({
      agentSessionId: fixture.sessionId,
    })

    expect(requests[0]?.tools).toEqual([
      expect.objectContaining({
        name: 'read_context',
        description:
          'Read deterministic context for User.\n\nReturn only context visible to User.',
        inputSchema: expect.objectContaining({
          properties: {
            query: {
              type: 'string',
              description: 'Query selected by User.',
            },
          },
        }),
      }),
    ])
    expect((requests[0]?.messages as Array<{ content?: string }>).some(message => message.content?.includes('read_context'))).toBe(false)
    expect(requests[1]?.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'assistant',
          tool_calls: [expect.objectContaining({ id: 'provider-call-1' })],
        }),
        {
          role: 'tool',
          tool_call_id: 'provider-call-1',
          content: 'result:weather',
        },
      ]),
    )
    expect(page.entries.map((entry) => entry.entry)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'tool-invocation',
          toolId: readContextTool.id,
          providerItemId: 'provider-call-1',
        }),
        expect.objectContaining({
          kind: 'tool-result',
          toolId: readContextTool.id,
          status: 'completed',
        }),
        expect.objectContaining({ kind: 'run-state', state: 'completed' }),
      ]),
    )
    expect(result.entries.assistant.entry).toMatchObject({
      kind: 'message',
      content: 'Final answer.',
    })
    fixture.close()
  })

  it.each(['user-stop', 'user-pause'])('terminates every persisted call without executing queued tools (%s)', async reason => {
    const controller = new AbortController()
    let markStarted!: () => void
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    let executions = 0
    const fixture = await createFixture({
      execute: async ({ invocation, signal }) => {
        executions += 1
        markStarted()
        return (await new Promise((resolve, reject) => {
          if (signal.aborted)
            return reject(new DOMException('Aborted', 'AbortError'))
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          )
        })) as never
      },
      invokeChat: async () => ({
        provider: 'test',
        model: 'test-model',
        text: '',
        finishReason: 'tool_call',
        message: {
          role: 'assistant',
          tool_calls: [
            {
              id: 'provider-call-abort',
              type: 'function',
              function: { name: 'read_context', arguments: '{"query":"wait"}' },
            },
            {
              id: 'provider-call-queued',
              type: 'function',
              function: { name: 'read_context', arguments: '{"query":"queued"}' },
            },
          ],
        },
      }),
    })

    const turn = fixture.runtime.invokeAgentTurn(
      { agentSessionId: fixture.sessionId, input: 'Wait.' },
      { abortSignal: controller.signal },
    )
    await started
    controller.abort(reason)
    await expect(turn).rejects.toMatchObject({ name: 'AbortError' })
    const entries = (
      await fixture.runtime.getAgentTranscriptPage({
        agentSessionId: fixture.sessionId,
      })
    ).entries.map((entry) => entry.entry)
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'tool-result',
          status: 'aborted',
          syntheticReason: 'interrupt',
        }),
        expect.objectContaining({
          kind: 'run-state',
          state: reason === 'user-pause' ? 'suspended' : 'aborted',
          reason,
        }),
      ]),
    )
    expect(executions).toBe(1)
    const invocations = entries.filter(entry => entry.kind === 'tool-invocation')
    const results = entries.filter(entry => entry.kind === 'tool-result')
    expect(results).toHaveLength(2)
    expect(results.map(entry => entry.invocationId).sort()).toEqual(invocations.map(entry => entry.invocationId).sort())
    fixture.close()
  })

  it('rejects an overlapping direct Run before invoking the Provider and releases the Session after completion', async () => {
    let release!: () => void
    let started!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const providerStarted = new Promise<void>(resolve => { started = resolve })
    let calls = 0
    const fixture = await createFixture({
      execute: ({ invocation }) => ({ invocationId: invocation.id, toolId: invocation.toolId, status: 'completed', content: [] }),
      invokeChat: async () => {
        calls += 1
        started()
        await gate
        return { provider: 'test', model: 'test-model', text: 'Done.', finishReason: 'stop', message: { role: 'assistant', content: 'Done.' } }
      },
    })
    try {
      const first = fixture.runtime.invokeAgentTurn({ agentSessionId: fixture.sessionId, input: 'First' })
      await providerStarted
      await expect(fixture.runtime.invokeAgentTurn({ agentSessionId: fixture.sessionId, input: 'Overlap' }))
        .rejects.toMatchObject({ code: 'agent.session_busy' })
      expect(calls).toBe(1)
      release()
      await first
      await fixture.runtime.invokeAgentTurn({ agentSessionId: fixture.sessionId, input: 'Next' })
      expect(calls).toBe(2)
    } finally {
      release()
      fixture.close()
    }
  })

  it('resumes a paused multi-tool step with paired terminated calls and permits work handoff', async () => {
    let started!: () => void
    let release!: () => void
    const toolStarted = new Promise<void>(resolve => { started = resolve })
    const toolGate = new Promise<void>(resolve => { release = resolve })
    let executions = 0
    const requests: unknown[][] = []
    const fixture = await createFixture({
      execute: async ({ invocation }) => {
        executions += 1
        started()
        await toolGate
        return { invocationId: invocation.id, toolId: invocation.toolId, status: 'completed', content: [] }
      },
      invokeChat: async ({ request }) => {
        requests.push(request.messages)
        return requests.length === 1
          ? {
              provider: 'test', model: 'test-model', text: '', finishReason: 'tool_call',
              message: {
                role: 'assistant',
                tool_calls: ['waiting', 'queued'].map(id => ({
                  id, type: 'function', function: { name: 'read_context', arguments: '{"query":"wait"}' },
                })),
              },
            }
          : { provider: 'test', model: 'test-model', text: 'Recovered.', finishReason: 'stop', message: { role: 'assistant', content: 'Recovered.' } }
      },
    })
    try {
      const paused = await handleAgentsRpc(fixture.runtime, 'application.agent.run.create', {
        agentSessionId: fixture.sessionId, input: 'Wait.',
      }) as { runId: string }
      await toolStarted
      await handleAgentsRpc(fixture.runtime, 'application.agent.run.pause', { runId: paused.runId })
      await expect.poll(async () => (await handleAgentsRpc(fixture.runtime, 'application.agent.run.state', { runId: paused.runId }) as { state: string }).state)
        .toBe('suspended')
      const resumed = await handleAgentsRpc(fixture.runtime, 'application.agent.run.resume', { runId: paused.runId }) as { runId: string; accepted: boolean }
      expect(resumed.accepted).toBe(true)
      await expect.poll(async () => (await handleAgentsRpc(fixture.runtime, 'application.agent.run.state', { runId: resumed.runId }) as { state: string }).state)
        .toBe('completed')
      expect(executions).toBe(1)
      expect(requests[1]).toEqual(expect.arrayContaining([
        expect.objectContaining({ role: 'tool', tool_call_id: 'waiting' }),
        expect.objectContaining({ role: 'tool', tool_call_id: 'queued' }),
      ]))
      const page = await fixture.runtime.getAgentTranscriptPage({ agentSessionId: fixture.sessionId })
      expect(page.entries.filter(entry => entry.entry.kind === 'message' && entry.entry.role === 'user')).toHaveLength(1)
      expect(page.entries.map(entry => entry.entry)).toContainEqual(expect.objectContaining({
        kind: 'run-state', state: 'running', sourceRunId: paused.runId,
        recovery: expect.objectContaining({ version: 1, userEntryId: expect.any(String) }),
      }))
      await fixture.runtime.appendAgentTranscriptEntries({
        agentSessionId: fixture.sessionId, expectedEntryCount: page.session.entryCount,
        entries: [{ entry: { kind: 'work-summary', content: 'Recovered without replaying old tools.', boundary: { sourceThroughSequence: page.session.entryCount, retiredThroughSequence: page.session.entryCount } } }],
      })
    } finally { release(); fixture.close() }
  })

  it('parses a Content Tool despite Provider stop and replays its result as runtime user content', async () => {
    const requests: Array<{ messages: unknown[]; tools?: unknown[] }> = []
    const fixture = await createFixture({
      tool: testContentTool,
      mounts: [{
        toolId: testContentTool.id,
        orderIndex: 0,
        defaultEnabled: true,
        content: { targetAnchorId: '@chat.tools', localDepth: 7 },
      }],
      execute: ({ invocation }) => ({
        invocationId: invocation.id,
        toolId: invocation.toolId,
        status: 'completed',
        content: [
          {
            type: 'json',
            value: {
              label: invocation.arguments?.label ?? '',
              echo: invocation.rawInput ?? '',
            },
          },
        ],
      }),
      invokeChat: async (input) => {
        requests.push({
          messages: input.request.messages,
          tools: input.request.tools,
        })
        if (requests.length === 1) {
          return {
            provider: 'test',
            model: 'test-model',
            text: '',
            finishReason: 'stop',
            providerCallId: 'provider-content-step-1',
            message: {
              role: 'assistant',
              content:
                '<loom_tool name="test_content"><metadata>{"mode":"success","label":"example"}</metadata><content>raw\nbody</content></loom_tool>',
            },
          }
        }
        return {
          provider: 'test',
          model: 'test-model',
          text: 'Content tool finished.',
          finishReason: 'stop',
          providerCallId: 'provider-content-step-2',
          message: { role: 'assistant', content: 'Content tool finished.' },
        }
      },
    })

    const turn = await fixture.runtime.invokeAgentTurn({
      agentSessionId: fixture.sessionId,
      input: 'Use the content test tool.',
    })
    const entries = (
      await fixture.runtime.getAgentTranscriptPage({
        agentSessionId: fixture.sessionId,
      })
    ).entries.map((entry) => entry.entry)

    const contentInvocation = entries.find(entry => entry.kind === 'tool-invocation' && entry.transport === 'content')
    if (contentInvocation?.kind !== 'tool-invocation') throw new Error('Missing content tool invocation')
    expect(entries).toContainEqual(expect.objectContaining({ kind: 'tool-result', invocationId: contentInvocation.invocationId }))
    expect(requests[0]?.tools).toBeUndefined()
    expect(turn.projection.messages.some(msg => msg.fragmentIds.includes('runtime.agent-tools.contribution.0'))).toBe(true)
    expect(requests[0]?.messages).toEqual(
      expect.arrayContaining([expect.objectContaining({
        role: 'system',
        content: expect.stringContaining('<loom_tool name="tool_name">'),
      })]),
    )
    expect(requests[1]?.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'assistant',
          content: expect.stringContaining('<loom_tool name="test_content">'),
        }),
        expect.objectContaining({
          role: 'user',
          content: expect.stringContaining(
            `<loom_tool_result invocation_id="${contentInvocation.invocationId}"`,
          ),
        }),
      ]),
    )
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'tool-invocation',
          toolId: testContentTool.id,
          transport: 'content',
          arguments: { mode: 'success', label: 'example' },
          rawInput: 'raw\nbody',
        }),
        expect.objectContaining({
          kind: 'tool-result',
          toolId: testContentTool.id,
          status: 'completed',
        }),
        expect.objectContaining({ kind: 'run-state', state: 'completed' }),
      ]),
    )
    expect(entries).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'message',
          content: expect.stringContaining('<loom_tool'),
        }),
      ]),
    )
    fixture.close()
  })

  it('projects and extracts actual runtime Narrative and samples every processing phase through workers', async () => {
    const fixture = await createFixture({ execute: vi.fn(), invokeChat: async () => { throw new Error('No provider call expected') } })
    try {
      for (const phase of ['prompt', 'display', 'classify'] as const) await fixture.runtime.upsertTextTransformRule({
        ruleId: `workspace.${phase}`, rule: { name: phase, owner: { kind: 'workspace' }, enabled: true, orderIndex: 0,
          matcher: { kind: 'regex', pattern: '(?<=R)AW', flags: 'g' }, effect: { kind: 'replace', replacement: phase },
          targets: ['narrative'], phases: [phase] },
      })
      const { card } = await fixture.runtime.createCard({ name: 'Projection source' })
      const { timeline, branch } = await fixture.runtime.createNarrativeTimeline({ cardId: card.id, openingContent: 'RAW' })
      const source = { kind: 'narrative' as const, timelineId: timeline.id, branchId: branch.id }
      const original = await fixture.runtime.getAgentTranscriptPage({ agentSessionId: fixture.sessionId })
      for (const phase of ['prompt', 'display', 'classify'] as const) {
        const sample = await fixture.runtime.sampleNarrative({ timelineId: timeline.id, branchId: branch.id,
          selection: { kind: 'tail', count: 1 }, processing: { phase, ...(phase === 'prompt' ? { presetId: original.session.agentPresetId } : {}) } })
        expect(sample.text).toBe(`R${phase}`)
        expect(sample.nodes[0]!.body.raw).toBe('RAW')
      }
      await fixture.runtime.upsertTextExtractor({ extractorId: 'workspace.extract', extractor: {
        name: 'Extract', owner: { kind: 'workspace' }, enabled: true, orderIndex: 0, targets: ['narrative'],
        matcher: { kind: 'regex', pattern: '(?<=R)display', flags: 'g' }, parser: 'text', strategy: 'all-matches', artifactType: 'text/plain',
      } })
      expect((await fixture.runtime.projectHistory({ source, phase: 'display' })).snapshot.entries[0]!.text).toBe('Rdisplay')
      const inspection = await fixture.runtime.inspectTextPipeline({ source, phase: 'display' })
      expect(inspection.snapshot.entries[0]!.text).toBe('Rdisplay')
      expect(inspection.artifacts).toHaveLength(1)
      expect((await fixture.runtime.extractHistory({ source, extractorId: 'workspace.extract' })).extraction.values).toEqual(['display'])
    } finally { fixture.close() }
  })

  it('fails isolated classification without saving raw partial Narrative or adopting it', async () => {
    const raw = `${'a'.repeat(20_000)}!`
    const fixture = await createFixture({ execute: vi.fn(), invokeChat: async request => {
      request.onEvent?.({ type: 'text-delta', runId: 'classification-fixture', delta: raw })
      return { provider: 'test', model: 'test-model', text: raw, finishReason: 'stop', message: { role: 'assistant', content: raw } }
    } })
    try {
      await fixture.runtime.upsertTextTransformRule({ ruleId: 'workspace.deadline', rule: {
        name: 'Deadline', owner: { kind: 'workspace' }, enabled: true, orderIndex: 0,
        matcher: { kind: 'regex', pattern: '(a+)+$', flags: '' }, effect: { kind: 'replace', replacement: 'X' },
        targets: ['agent-session'], phases: ['classify'],
      } })
      const original = await fixture.runtime.getAgentTranscriptPage({ agentSessionId: fixture.sessionId })
      const { card } = await fixture.runtime.createCard({ name: 'Isolated writer' })
      const { timeline, branch } = await fixture.runtime.createNarrativeTimeline({ cardId: card.id })
      await fixture.runtime.updateAgentSession({ agentSessionId: timeline.id, agentPresetId: original.session.agentPresetId, narrativeMode: 'automatic' })
      await expect(fixture.runtime.invokeAgentTurn({ agentSessionId: timeline.id, input: 'Write.',
        narrativeTarget: { timelineId: timeline.id, branchId: branch.id } })).rejects.toMatchObject({ code: 'text.execution_timeout' })
      const page = await fixture.runtime.getAgentTranscriptPage({ agentSessionId: timeline.id })
      expect(page.entries.filter(item => item.entry.kind === 'message' && item.entry.role === 'assistant')).toEqual([])
      expect(page.entries).toEqual(expect.arrayContaining([
        expect.objectContaining({ entry: expect.objectContaining({ kind: 'run-state', state: 'failed', reason: expect.stringContaining('execution deadline') }) }),
      ]))
      const projected = await fixture.runtime.projectHistory({ source: { kind: 'narrative', timelineId: timeline.id, branchId: branch.id }, phase: 'display' })
      expect(projected.snapshot.entries).toEqual([])
    } finally { fixture.close() }
  }, 15_000)

  it('promotes reasoning before scanning content tools and ignores fake calls inside reasoning', async () => {
    let calls = 0
    const executed: string[] = []
    const fixture = await createFixture({
      tool: testContentTool,
      execute: ({ invocation }) => {
        executed.push(invocation.rawInput ?? '')
        return { invocationId: invocation.id, toolId: invocation.toolId, status: 'completed', content: [{ type: 'text', text: 'ok' }] }
      },
      invokeChat: async () => {
        calls += 1
        if (calls === 1) return {
          provider: 'test', model: 'test-model', text: '', finishReason: 'stop', providerCallId: 'reasoning-step',
          message: { role: 'assistant', content: '<think>draft <loom_tool name="test_content"><metadata>{"mode":"success"}</metadata><content>fake</content></loom_tool></think>visible<loom_tool name="test_content"><metadata>{"mode":"success"}</metadata><content>real</content></loom_tool>' },
        }
        return { provider: 'test', model: 'test-model', text: 'done', finishReason: 'stop', message: { role: 'assistant', content: 'done' } }
      },
    })
    await fixture.runtime.upsertTextTransformRule({
      ruleId: 'workspace.think',
      rule: {
        name: 'Think promotion', owner: { kind: 'workspace' }, enabled: true, orderIndex: 0,
        matcher: { kind: 'regex', pattern: '<think>([\\s\\S]*?)</think>', flags: 'g' },
        effect: { kind: 'promote-reasoning', contentGroup: 1, visibility: 'collapsed', replay: 'omit', dialect: 'think' },
        targets: ['agent-session'], phases: ['classify'],
      },
    })

    await fixture.runtime.invokeAgentTurn({ agentSessionId: fixture.sessionId, input: 'test' })
    const entries = (await fixture.runtime.getAgentTranscriptPage({ agentSessionId: fixture.sessionId })).entries.map(item => item.entry)

    expect(executed).toEqual(['real'])
    expect(entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'reasoning', content: expect.stringContaining('fake'), source: 'assistant-content' }),
      expect.objectContaining({ kind: 'message', role: 'assistant', content: 'visible' }),
      expect.objectContaining({ kind: 'tool-invocation', rawInput: 'real' }),
    ]))
    fixture.close()
  })

  it('rejects a native call for a content-only tool and lets the Provider retry with content protocol', async () => {
    let requestCount = 0
    const fixture = await createFixture({
      tool: testContentTool,
      execute: ({ invocation }) => ({
        invocationId: invocation.id,
        toolId: invocation.toolId,
        status: 'completed',
        content: [{ type: 'text', text: invocation.rawInput ?? '' }],
      }),
      invokeChat: async () => {
        requestCount += 1
        if (requestCount === 1) {
          return {
            provider: 'test',
            model: 'test-model',
            text: '',
            finishReason: 'tool_call',
            message: {
              role: 'assistant',
              tool_calls: [{
                id: 'wrong-native-call',
                type: 'function',
                function: {
                  name: 'test_content',
                  arguments: '{"mode":"success","content":"wrong transport"}',
                },
              }],
            },
          }
        }
        if (requestCount === 2) {
          return {
            provider: 'test',
            model: 'test-model',
            text: '',
            finishReason: 'stop',
            message: {
              role: 'assistant',
              content: '<loom_tool name="test_content"><metadata>{"mode":"success"}</metadata><content>correct transport</content></loom_tool>',
            },
          }
        }
        return {
          provider: 'test',
          model: 'test-model',
          text: 'Content retry finished.',
          finishReason: 'stop',
          message: { role: 'assistant', content: 'Content retry finished.' },
        }
      },
    })

    await fixture.runtime.invokeAgentTurn({
      agentSessionId: fixture.sessionId,
      input: 'Use the content tool.',
    })
    const entries = (await fixture.runtime.getAgentTranscriptPage({
      agentSessionId: fixture.sessionId,
    })).entries.map(entry => entry.entry)

    expect(requestCount).toBe(3)
    expect(entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'tool-result',
        status: 'failed',
        error: expect.objectContaining({ code: 'tool.transport_mismatch' }),
      }),
      expect.objectContaining({
        kind: 'tool-invocation',
        transport: 'content',
        rawInput: 'correct transport',
      }),
      expect.objectContaining({ kind: 'tool-result', status: 'completed' }),
    ]))
    fixture.close()
  })
})

async function createFixture(input: {
  tool?: ToolDefinition
  tools?: ToolDefinition[]
  mounts?: PresetToolMountInput[]
  execute?: NonNullable<
    Parameters<typeof createAgentToolRegistry>[1]
  >[number]['execute']
  invokeChat: NonNullable<ApplicationRuntimeOptions['gateway']>['invokeChat']
  agentTools?: ReturnType<typeof createAgentToolRegistry>
  onStateChanged?: ApplicationRuntimeOptions['onStateChanged']
}) {
  const tools = input.tools ?? [input.tool ?? readContextTool]
  let nextId = 0
  const createId = (prefix: string) => `${prefix}-${++nextId}`
  const now = () => '2026-08-23T00:00:00.000Z'
  const engine = createSqliteDataEngine({ filename: ':memory:', createId, now })
  const rootDirectory = mkdtempSync(join(tmpdir(), 'loom-native-tool-loop-'))
  const blobs = createBlobStore({ engine, rootDirectory, createId, now })
  onTestFinished(async () => { await engine.close(); rmSync(rootDirectory, { recursive: true, force: true }) })
  const documents = createSqliteDocumentStore({ engine })
  const agents = createAgentStore({ engine, createId, now })
  const promptResources = createPromptResourceStore({ engine, createId, now })
  const narratives = createNarrativeStore({ engine, createId, now })
  const logs = createMemoryLogSink({ capacity: 100 })
  const logger = createRootLogger({ service: 'test', instanceId: 'test', sinks: [logs] })
  const observations = createObservationStore()
  const runtime = createApplicationRuntime({ blobs,
    observations,
    agents,
    agentTools: input.agentTools ?? createAgentToolRegistry(
      tools,
      tools.map(tool => ({ toolId: tool.id, execute: input.execute! })),
    ),
    dataEngine: engine,
    documents,
    narratives,
    promptResources,
    gateway: { invokeChat: input.invokeChat },
    runtimeLogger: logger.child('runtime'),
    onStateChanged: input.onStateChanged,
  })
  const preset = await runtime.createPromptResource({
    resourceKind: 'preset',
    name: 'Tool Preset',
  })
  const provider = await runtime.createProviderProfile({
    providerExtensionId: 'official.openai-compatible',
    displayName: 'Tool Provider',
    config: {},
    enabledModelIds: ['test-model'],
  })
  await runtime.replacePresetToolMounts({ expectedMountIds: (await runtime.listPresetToolMounts({ presetId: preset.resource.id })).mounts.map(mount => mount.id),
    presetId: preset.resource.id,
    mounts: input.mounts ?? tools.map((tool, orderIndex) => ({
      toolId: tool.id,
      orderIndex,
      defaultEnabled: true,
      ...(tool.prompt?.provider ? { provider: tool.prompt.provider } : {}),
      ...(tool.input.kind === 'structured' || !tool.prompt?.content ? {} : { content: tool.prompt.content }),
    })),
  })
  const profile = await runtime.updateAgentPreset({
    name: 'Tool Agent',
    agentPresetId: preset.resource.id, expectedVersion: (await runtime.getPromptResource({ resourceId: preset.resource.id })).resource.version,
    model: {
      providerProfileId: provider.providerProfile.id,
      modelId: 'test-model',
    },
  })
  const sessionId = (
    await runtime.createAgentSession({
      agentPresetId: profile.agentPreset.id,
    })
  ).session.id
  return {
    engine,
    runtime,
    observations,
    narratives,
    logs,
    sessionId,
    close: () => { observations.dispose(); engine.close() },
  }
}

function toolCall(id: string, name: string, args: unknown) {
  return {
    provider: 'test', model: 'test-model', text: '', finishReason: 'tool_call' as const,
    message: {
      role: 'assistant' as const,
      tool_calls: [{ id, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } }],
    },
  }
}

function statefulCardArtifact() {
  return {
    schemaVersion: 4 as const,
    artifactId: 'state-tool-card',
    displayName: 'State Tool Card',
    card: { name: 'Alice' },
    contextAssets: [],
    stateTemplates: [{
      id: 'template.tool-person', templateVersion: 1,
      schema: {
        type: 'object', properties: { gold: { type: 'number', minimum: 0 } },
        required: ['gold'], additionalProperties: false,
      },
      initial: { gold: 10 },
    }],
    timelineStateBindings: [{ path: 'characters.alice', templateId: 'template.tool-person', templateVersion: 1 }],
  }
}
