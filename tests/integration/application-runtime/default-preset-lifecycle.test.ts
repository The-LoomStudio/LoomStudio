import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAgentStore, createNarrativeStore, createPromptResourceStore } from '@loom-studio/application-data'
import type { AiGatewayRequest, AiGatewayResult } from '@loom-studio/ai-gateway'
import { createAgentToolRegistry, createApplicationRuntime, type ToolDefinition } from '@loom-studio/application-runtime'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import type { ChatMessage } from '@loom-studio/shared'
import type { PromptResourceNode } from '../../../packages/application-runtime/src/cards/workspace-types.js'
import { beforeAll, describe, expect, it } from 'vitest'

const actor = { kind: 'system' as const, id: 'lifecycle-test' }
const tools: ToolDefinition[] = [
  { id: 'test/read', owner: { namespace: 'test' }, name: 'read_story', description: 'READ_STORY_NATIVE',
    input: { kind: 'structured', schema: { type: 'object', properties: {} } } },
  { id: 'test/write', owner: { namespace: 'test' }, name: 'write_story', description: 'WRITE_STORY_CONTENT',
    input: { kind: 'freeform', mediaType: 'text/plain' } },
]
const readCall = (id: string): ChatMessage => ({
  role: 'assistant', tool_calls: [{ id, type: 'function', function: { name: 'read_story', arguments: '{}' } }],
})
const writeCall = (text: string): ChatMessage => ({
  role: 'assistant', content: `<loom_tool name="write_story"><metadata>{}</metadata><content>${text}</content></loom_tool>`,
})
const flatten = (node: PromptResourceNode): PromptResourceNode[] => [node, ...(node.children ?? []).flatMap(flatten)]
const project = (text: string) => text.replaceAll('RAW:', 'PROMPT:')
const visible = (messages: ChatMessage[]) => messages.map(message => {
  // Provider payloads also carry fragmentIds for inspection; compare all protocol fields, not random IDs.
  if (message.role === 'tool') return { role: message.role, content: message.content, tool_call_id: message.tool_call_id }
  if (message.role === 'assistant' && message.tool_calls) return { role: message.role, tool_calls: message.tool_calls, ...(message.content ? { content: message.content } : {}) }
  return { role: message.role, content: message.content }
})

async function simulateLifecycle() {
  const directory = await mkdtemp(join(tmpdir(), 'loom-prompt-lifecycle-'))
  const filename = join(directory, 'test.sqlite')
  let sequence = 0
  const options = { createId: (prefix: string) => `${prefix}-${++sequence}`, now: () => '2026-09-21T00:00:00.000Z' }
  const requests: Array<Pick<AiGatewayRequest, 'messages' | 'tools'>> = []
  const toolEvents: Array<{ kind: 'read' | 'write'; result: string; invocationId: string; nodeId?: string }> = []
  const replies: Array<ChatMessage | Error> = [
    readCall('read-before-write'), writeCall('RAW:WRITTEN_IN_RUN_ONE'), readCall('read-after-write'),
    { role: 'assistant', content: 'RUN_ONE_DONE' },
    writeCall('RAW:COMMITTED_BEFORE_FAILURE'), new Error('SIMULATED_PROVIDER_FAILURE'),
    { role: 'assistant', content: 'RECOVERED_AFTER_RESTART' },
  ]
  function open() {
    const engine = createSqliteDataEngine({ filename, ...options })
    const narratives = createNarrativeStore({ engine, ...options })
    const agents = createAgentStore({ engine, ...options })
    const promptResources = createPromptResourceStore({ engine, ...options })
    const runtime = createApplicationRuntime({
      dataEngine: engine, agents, narratives, promptResources,
      documents: createSqliteDocumentStore({ engine }),
      agentTools: createAgentToolRegistry(tools, tools.map(tool => ({
        toolId: tool.id,
        execute: async ({ invocation, scope }) => {
          if (!scope?.narrative) throw new Error('Missing narrative capability')
          if (tool.id === 'test/read') {
            const page = await narratives.getPage({
              timelineId: scope.narrative.timelineId, branchId: scope.narrative.branchId, limit: 3,
            })
            const result = page.nodes.map(node => node.body.raw).join('\n')
            toolEvents.push({ kind: 'read', result, invocationId: invocation.id })
            return { invocationId: invocation.id, toolId: tool.id, status: 'completed' as const, content: [{ type: 'text' as const, text: result }] }
          }
          const { nodeId } = await scope.narrative.appendNode({ content: invocation.rawInput! })
          const result = `SAVED:${invocation.rawInput}`
          toolEvents.push({ kind: 'write', result, invocationId: invocation.id, nodeId })
          return { invocationId: invocation.id, toolId: tool.id, status: 'completed' as const, content: [{ type: 'text' as const, text: result }] }
        },
      }))),
      gateway: {
        invokeChat: async input => {
          const reply = replies[requests.length]
          requests.push(structuredClone({ messages: input.request.messages, tools: input.request.tools }))
          if (!reply) throw new Error('Unexpected extra Provider step')
          if (reply instanceof Error) throw reply
          return {
            provider: 'simulation', model: 'test-model', finishReason: 'stop',
            message: reply, text: reply.content ?? '',
          } as AiGatewayResult
        },
      },
    })
    return { engine, runtime, narratives, agents }
  }
  let fixture = open()
  try {
    const { runtime, narratives, agents } = fixture
    const { resource: preset } = await runtime.createPromptResource({ resourceKind: 'preset', name: 'Lifecycle Writer' })
    const entries = flatten(preset.rootNode)
    const entryBodies = new Map([
      ['身份与工作原则', 'ROLE:WRITER'],
      ['文风、推演与输出', 'STYLE:{{writing.style}}'],
      ['资料开始', '<world>'], ['资料结束', '</world>'],
    ])
    await runtime.updatePromptResourceAssets({
      resourceId: preset.id,
      updates: entries.filter(entry => entryBodies.has(entry.label)).map(entry => ({
        assetId: entry.id, body: entryBodies.get(entry.label)!,
      })),
    })
    await runtime.replacePresetToolMounts({
      presetId: preset.id, mounts: tools.map((tool, index) => ({ toolId: tool.id, orderIndex: index, defaultEnabled: true })),
    })
    const settings = []
    for (const name of ['World', 'MemoryAndTail']) {
      settings.push((await runtime.createPromptResource({ resourceKind: 'setting', name })).resource)
    }
    const sources = [
      { body: 'STABLE_A', anchor: '@setting.stable', depth: 20, source: 0 },
      { body: 'STABLE_B', anchor: '@setting.stable', depth: 10, source: 1 },
      { body: '<history>', anchor: '@narrative.before', source: 1 },
      { body: 'MEMORY:EARLIER_EVENTS', anchor: '@memory.narrative', source: 1 },
      { body: '</history>', anchor: '@narrative.after', source: 1 },
      { body: 'MEMO:WORK_FACTS', anchor: '@memory.session', source: 1 },
      { body: 'CONDITIONAL:RUN_ONE', anchor: '@setting.lower', source: 0, keyword: 'INPUT_ONE' },
      { body: 'TAIL:ORDINARY', anchor: '@prompt.tail', source: 1 },
      { body: 'WORKSPACE:PIN', anchor: '@runtime.workspace', source: 1 },
      { body: 'NOTICE:CHECK_FACTS', anchor: '@runtime.notices', source: 1 },
    ]
    for (const [index, source] of sources.entries()) {
      const resource = settings[source.source]!
      await runtime.createPromptResourceAsset({
        resourceId: resource.id, targetAssetId: resource.rootNode.id, position: 'inside',
        asset: {
          id: `source-${index}`, kind: 'entry', label: source.body, body: source.body,
          capabilities: {
            targetAnchorId: source.anchor, localDepth: source.depth ?? 0,
            activation: source.keyword ? { kind: 'keyword', keywords: [source.keyword] } : { kind: 'always' },
          },
        },
      })
    }
    await runtime.replaceSettingMounts({
      source: { kind: 'manual', id: 'global' }, settingResourceIds: settings.map(resource => resource.id),
    })
    const { card } = await runtime.createCard({ name: 'Branching Story', opening: 'RAW:N001' })
    const created = await runtime.createNarrativeTimeline({ cardId: card.id })
    let head = created.branch.headNodeId!
    const mainNodes = [{ id: head, text: 'RAW:N001' }]
    for (let floor = 2; floor <= 105; floor++) {
      const text = `RAW:N${String(floor).padStart(3, '0')}`
      const appended = await narratives.appendNode({
        actor, timelineId: created.timeline.id, branchId: created.branch.id,
        expectedHeadNodeId: head, stateRevisionId: created.branch.stateHeadRevisionId,
        body: { format: 'loom-markdown.v1', raw: text },
      })
      head = appended.node.id
      mainNodes.push({ id: head, text })
    }
    const { branch: fork } = await runtime.forkNarrativeBranch({
      timelineId: created.timeline.id, fromBranchId: created.branch.id, fromNodeId: mainNodes[102]!.id,
    })
    await runtime.switchNarrativeBranch({ timelineId: created.timeline.id, branchId: fork.id })
    head = fork.headNodeId!
    for (const text of ['RAW:ALT104', 'RAW:ALT105']) {
      const appended = await narratives.appendNode({
        actor, timelineId: created.timeline.id, branchId: fork.id,
        expectedHeadNodeId: head, stateRevisionId: fork.stateHeadRevisionId,
        body: { format: 'loom-markdown.v1', raw: text },
      })
      head = appended.node.id
    }
    await runtime.upsertTextTransformRule({
      ruleId: 'lifecycle-projection',
      rule: {
        name: 'Prompt-only projection', owner: { kind: 'preset', presetId: preset.id },
        enabled: true, orderIndex: 0, matcher: { kind: 'regex', pattern: 'RAW:', flags: 'g' },
        effect: { kind: 'replace', replacement: 'PROMPT:' }, targets: ['narrative'], phases: ['prompt'],
      },
    })
    const { providerProfile } = await runtime.createProviderProfile({
      providerExtensionId: 'official.openai-compatible', displayName: 'Simulation',
      config: {}, enabledModelIds: ['test-model'],
    })
    const { agentProfile } = await runtime.createAgentProfile({
      name: 'Writer', presetId: preset.id, model: { providerProfileId: providerProfile.id, modelId: 'test-model' },
    })
    const { session } = await runtime.createAgentSession({ agentProfileId: agentProfile.id, timelineId: created.timeline.id })
    const preview = await runtime.previewAgentTurn({ agentSessionId: session.id, input: 'INPUT_ONE' })
    expect((await agents.getEntryPage({ agentSessionId: session.id })).entries).toEqual([])
    expect(toolEvents).toEqual([])
    const runOne = await runtime.invokeAgentTurn({ agentSessionId: session.id, input: 'INPUT_ONE' })
    const firstTranscript = await agents.getEntryPage({ agentSessionId: session.id, limit: 100 })
    expect(firstTranscript.entries.filter(entry => entry.entry.kind === 'tool-result').map(entry => entry.entry))
      .toEqual([
        expect.objectContaining({ status: 'completed' }),
        expect.objectContaining({ status: 'completed' }),
        expect.objectContaining({ status: 'completed' }),
      ])
    const afterOne = await narratives.getPage({ timelineId: created.timeline.id, branchId: fork.id, limit: 100 })
    await expect(runtime.invokeAgentTurn({ agentSessionId: session.id, input: 'INPUT_TWO' }))
      .rejects.toThrow('SIMULATED_PROVIDER_FAILURE')
    const failedTranscript = await agents.getEntryPage({ agentSessionId: session.id, limit: 100 })
    const afterFailure = await narratives.getPage({ timelineId: created.timeline.id, branchId: fork.id, limit: 100 })
    fixture.engine.close()
    fixture = open()
    const restarted = fixture.runtime
    expect((await fixture.agents.getEntryPage({ agentSessionId: session.id, limit: 100 })).entries)
      .toEqual(failedTranscript.entries)
    const restartPreview = await restarted.previewAgentTurn({ agentSessionId: session.id, input: 'INPUT_THREE' })
    await restarted.invokeAgentTurn({ agentSessionId: session.id, input: 'INPUT_THREE' })
    const completedTranscript = await fixture.agents.getEntryPage({ agentSessionId: session.id, limit: 100 })
    const abort = new AbortController()
    abort.abort('test-cancel')
    await expect(restarted.invokeAgentTurn({ agentSessionId: session.id, input: 'INPUT_CANCELLED' }, { abortSignal: abort.signal }))
      .rejects.toMatchObject({ name: 'AbortError' })
    const abortedTranscript = await fixture.agents.getEntryPage({ agentSessionId: session.id, limit: 100 })
    const { session: isolated } = await restarted.createAgentSession({ agentProfileId: agentProfile.id, timelineId: created.timeline.id })
    const isolatedPreview = await restarted.previewAgentTurn({ agentSessionId: isolated.id, input: 'ISOLATED_INPUT' })
    await restarted.switchNarrativeBranch({ timelineId: created.timeline.id, branchId: created.branch.id })
    const mainPreview = await restarted.previewAgentTurn({ agentSessionId: isolated.id, input: 'MAIN_INPUT' })
    const mainPage = await fixture.narratives.getPage({ timelineId: created.timeline.id, branchId: created.branch.id, limit: 100 })
    return {
      requests, toolEvents, preview, restartPreview, isolatedPreview, mainPreview, mainPage,
      firstTranscript, failedTranscript, completedTranscript, abortedTranscript, afterOne, afterFailure, runOne,
      initialWindow: [...mainNodes.slice(5, 103).map(node => node.text), 'RAW:ALT104', 'RAW:ALT105'],
    }
  } finally {
    fixture.engine.close()
    await rm(directory, { recursive: true, force: true })
  }
}

describe('Default preset: simulated Agent lifecycle', () => {
  let scenario: Awaited<ReturnType<typeof simulateLifecycle>>
  beforeAll(async () => { scenario = await simulateLifecycle() }, 30_000)

  it('assembles the full initial request: multi-source wrapping, branch window, memory, tools, Session and current input', () => {
    const { requests, initialWindow, preview } = scenario
    expect(requests).toHaveLength(7)
    expect(requests[0]!.messages).toEqual(preview.messages)
    const toolInstructions = requests[0]!.messages[1]!.content!
    expect(toolInstructions).toContain('WRITE_STORY_CONTENT')
    expect(toolInstructions).not.toContain('READ_STORY_NATIVE')
    expect(requests[0]!.tools).toEqual([{
      name: 'read_story', description: 'READ_STORY_NATIVE',
      inputSchema: { type: 'object', properties: {} },
    }])
    expect(visible(requests[0]!.messages)).toEqual([
      { role: 'system', content: 'ROLE:WRITER\n\nSTYLE:清晰自然，人物言行符合已有设定。' },
      { role: 'system', content: toolInstructions },
      { role: 'system', content: '<world>\n\nSTABLE_B\n\nSTABLE_A\n\n</world>' },
      { role: 'developer', content: ['<history>', 'MEMORY:EARLIER_EVENTS', ...initialWindow.map(project), '</history>'].join('\n\n') },
      { role: 'system', content: 'MEMO:WORK_FACTS' },
      { role: 'system', content: 'CONDITIONAL:RUN_ONE' },
      { role: 'user', content: 'INPUT_ONE' },
      { role: 'system', content: 'TAIL:ORDINARY' },
      { role: 'system', content: 'WORKSPACE:PIN' },
      { role: 'system', content: 'NOTICE:CHECK_FACTS' },
    ])
    expect(initialWindow).toHaveLength(100)
    expect(initialWindow[0]).toBe('RAW:N006')
  })

  it('keeps the entire in-Run prefix fixed while real tools read, write, and observe the committed narrative', () => {
    const { requests, toolEvents } = scenario
    const baseline = visible(requests[0]!.messages)
    const firstRead = toolEvents[0]!
    const written = toolEvents[1]!
    const secondRead = toolEvents[2]!
    expect(firstRead.result).toBe('RAW:N103\nRAW:ALT104\nRAW:ALT105')
    expect(secondRead.result).toBe('RAW:ALT104\nRAW:ALT105\nRAW:WRITTEN_IN_RUN_ONE')
    const afterRead = [...baseline, readCall('read-before-write'), {
      role: 'tool', tool_call_id: 'read-before-write', content: firstRead.result,
    }]
    expect(visible(requests[1]!.messages)).toEqual(afterRead)
    const afterWrite = [...afterRead, writeCall('RAW:WRITTEN_IN_RUN_ONE'), {
      role: 'user',
      content: `<loom_tool_result invocation_id="${written.invocationId}" name="write_story" status="completed">${written.result}</loom_tool_result>`,
    }]
    expect(visible(requests[2]!.messages)).toEqual(afterWrite)
    expect(visible(requests[3]!.messages)).toEqual([...afterWrite, readCall('read-after-write'), {
      role: 'tool', tool_call_id: 'read-after-write', content: secondRead.result,
    }])
    for (const request of requests.slice(0, 4)) {
      expect(request.tools).toEqual(requests[0]!.tools)
      expect(request.messages.filter(message => message.content === 'INPUT_ONE')).toHaveLength(1)
      expect(request.messages.find(message => message.role === 'developer')!.content).not.toContain('WRITTEN_IN_RUN_ONE')
    }
    expect(scenario.afterOne.nodes.at(-1)?.id).toBe(written.nodeId)
    expect(scenario.afterOne.nodes.at(-1)?.source).toMatchObject({
      agentSessionId: scenario.runOne.agentSession.id, runId: scenario.runOne.runId,
    })
    const writeInvocation = scenario.firstTranscript.entries.find(entry =>
      entry.entry.kind === 'tool-invocation' && entry.entry.toolId === 'test/write')!.entry
    expect(writeInvocation).not.toHaveProperty('arguments')
  })

  it('preserves committed writes and terminal states after a Provider failure, then reopens SQLite and continues', () => {
    const { requests, failedTranscript, completedTranscript, firstTranscript, afterFailure, toolEvents } = scenario
    expect(firstTranscript.entries.filter(entry => entry.entry.kind === 'run-state').map(entry => entry.entry))
      .toEqual([{ kind: 'run-state', state: 'running' }, { kind: 'run-state', state: 'completed' }])
    expect(firstTranscript.entries.filter(entry => entry.entry.kind === 'tool-invocation')).toHaveLength(3)
    expect(firstTranscript.entries.filter(entry => entry.entry.kind === 'tool-result')).toHaveLength(3)
    expect(failedTranscript.entries.at(-1)?.entry).toMatchObject({ kind: 'run-state', state: 'failed' })
    expect(afterFailure.nodes.at(-1)?.id).toBe(toolEvents[3]!.nodeId)
    expect(afterFailure.nodes.at(-1)?.body.raw).toBe('RAW:COMMITTED_BEFORE_FAILURE')
    expect(requests[6]!.messages).toEqual(scenario.restartPreview.messages)
    expect(completedTranscript.entries.at(-1)?.entry).toEqual({ kind: 'run-state', state: 'completed' })
    expect(completedTranscript.entries.filter(entry => entry.entry.kind === 'message' && entry.entry.role === 'user')
      .map(entry => entry.entry.kind === 'message' ? entry.entry.content : '')).toEqual(['INPUT_ONE', 'INPUT_TWO', 'INPUT_THREE'])
    const baseLength = requests[4]!.messages.length
    expect(visible(requests[5]!.messages.slice(0, baseLength))).toEqual(visible(requests[4]!.messages))
    expect(requests[5]!.messages.at(-1)?.content).toContain('SAVED:RAW:COMMITTED_BEFORE_FAILURE')
    expect(scenario.abortedTranscript.entries.at(-1)?.entry).toMatchObject({ kind: 'run-state', state: 'aborted' })
    expect(toolEvents).toHaveLength(4)
  })

  it('places old text messages in Session and each latest input exactly once; isolates a new Session and the active Narrative branch', () => {
    const { requests, isolatedPreview, mainPreview, mainPage } = scenario
    const second = requests[4]!.messages
    const third = requests[6]!.messages
    const currentNarrative = (nodes: typeof scenario.afterOne.nodes) => ({
      role: 'developer',
      content: ['<history>', 'MEMORY:EARLIER_EVENTS', ...nodes.map(node => project(node.body.raw)), '</history>'].join('\n\n'),
    })
    const priorText = [
      { role: 'system', content: 'MEMO:WORK_FACTS' },
      { role: 'user', content: 'INPUT_ONE' },
      { role: 'assistant', content: 'RUN_ONE_DONE' },
    ]
    const tail = visible(requests[0]!.messages.slice(-3))
    // Characterize today's text-only projection; the two target contracts below remain expected failures.
    expect(visible(second)).toEqual([
      ...visible(requests[0]!.messages.slice(0, 3)), currentNarrative(scenario.afterOne.nodes),
      ...priorText, { role: 'user', content: 'INPUT_TWO' }, ...tail,
    ])
    expect(visible(third)).toEqual([
      ...visible(requests[0]!.messages.slice(0, 3)), currentNarrative(scenario.afterFailure.nodes),
      ...priorText, { role: 'user', content: 'INPUT_TWO' }, { role: 'user', content: 'INPUT_THREE' }, ...tail,
    ])
    for (const [messages, input] of [[second, 'INPUT_TWO'], [third, 'INPUT_THREE']] as const) {
      expect(messages.filter(message => message.role === 'user' && message.content === input)).toHaveLength(1)
      expect(messages.some(message => message.content === 'CONDITIONAL:RUN_ONE')).toBe(false)
      expect(messages.slice(-4).map(message => message.content))
        .toEqual([input, 'TAIL:ORDINARY', 'WORKSPACE:PIN', 'NOTICE:CHECK_FACTS'])
      expect(messages.findIndex(message => message.content === 'INPUT_ONE'))
        .toBeLessThan(messages.findIndex(message => message.content === 'RUN_ONE_DONE'))
      expect(messages.findIndex(message => message.content === 'RUN_ONE_DONE'))
        .toBeLessThan(messages.findIndex(message => message.content === input))
    }
    expect(JSON.stringify(isolatedPreview.messages)).not.toMatch(/INPUT_ONE|INPUT_TWO|RUN_ONE_DONE|RECOVERED_AFTER_RESTART/)
    expect(isolatedPreview.messages.find(message => message.role === 'developer')?.content).toContain('PROMPT:COMMITTED_BEFORE_FAILURE')
    expect(mainPage.nodes.at(-1)?.body.raw).toBe('RAW:N105')
    expect(mainPreview.messages.find(message => message.role === 'developer')?.content)
      .toBe(['<history>', 'MEMORY:EARLIER_EVENTS', ...mainPage.nodes.map(node => project(node.body.raw)), '</history>'].join('\n\n'))
    expect(JSON.stringify(mainPreview.messages)).not.toMatch(/ALT104|ALT105|WRITTEN_IN_RUN_ONE|COMMITTED_BEFORE_FAILURE/)
  })

  it.fails('KNOWN GAP: next interaction must retain completed tool actions and results in Session', () => {
    const messages = scenario.requests[4]!.messages
    expect([
      messages.some(message => message.role === 'tool' && message.tool_call_id === 'read-before-write'),
      messages.some(message => message.content?.includes(`invocation_id="${scenario.toolEvents[1]!.invocationId}"`)),
      scenario.requests[6]!.messages.some(message =>
        message.content?.includes(`invocation_id="${scenario.toolEvents[3]!.invocationId}"`)),
    ]).toEqual([true, true, true])
  })

  it.fails('KNOWN GAP: Narrative writes must not change the adopted baseline before an explicit rebuild boundary', () => {
    const narrative = (index: number) => scenario.requests[index]!.messages.find(message => message.role === 'developer')!.content
    expect(narrative(4)).toBe(narrative(0))
  })
})
