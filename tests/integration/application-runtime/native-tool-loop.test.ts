import { createAgentStore } from '@loom-studio/agent-store'
import {
  createAgentToolRegistry,
  createOfficialAgentToolRegistry,
  createApplicationRuntime,
  officialReadStateTool,
  officialUpdateStateTool,
  promptZoneIds,
  type ApplicationRuntimeOptions,
  type PresetToolMountInput,
  type ToolDefinition,
} from '@loom-studio/application-runtime'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { createPromptResourceStore } from '@loom-studio/prompt-resource-store'
import { createNarrativeStore } from '@loom-studio/narrative-store'
import { describe, expect, it } from 'vitest'

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
  it('reads, updates, and reads Timeline State again across Provider steps', async () => {
    const requests: unknown[][] = []
    let target!: { scope: 'timeline'; timelineId: string; branchId: string }
    let initialRevisionId = ''
    const fixture = await createFixture({
      agentTools: createOfficialAgentToolRegistry(),
      tools: [officialReadStateTool, officialUpdateStateTool],
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

    await fixture.runtime.invokeAgentTurn({ agentSessionId: fixture.sessionId, input: 'Spend three gold.', narrativeTarget: { ...target, commit: false } })

    expect(requests).toHaveLength(4)
    expect((requests[3] as Array<{ role?: string; content?: string }>).findLast(message => message.role === 'tool')?.content)
      .toContain('"/characters/alice/gold":7')
    await expect(fixture.runtime.getStateSnapshot({ target })).resolves.toMatchObject({
      snapshot: { value: { characters: { alice: { gold: 7 } } } },
    })
    fixture.close()
  })

  it('keeps a committed State Tool mutation when a later Provider step fails', async () => {
    let target!: { scope: 'timeline'; timelineId: string; branchId: string }
    let initialRevisionId = ''
    let calls = 0
    const fixture = await createFixture({
      agentTools: createOfficialAgentToolRegistry(),
      tools: [officialUpdateStateTool],
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
      agentSessionId: fixture.sessionId, input: 'Spend three gold.', narrativeTarget: { ...target, commit: false },
    })).rejects.toThrow('provider disconnected')
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
            zoneId: 'setting.stable',
            slotKey: 'setting:weather',
            sourceKind: 'settingLayer',
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
    expect(requests[1]?.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'tool', tool_call_id: 'provider-native-call' }),
      { role: 'system', content: '[Fresh Context: Weather]\nFresh weather context.' },
    ]))
    expect(requests[2]?.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'user',
        content: expect.stringContaining('<loom_tool_result invocation_id="tool-invocation-'),
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

  it('writes an aborted synthetic ToolResult before terminating the Run', async () => {
    const controller = new AbortController()
    let markStarted!: () => void
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    const fixture = await createFixture({
      execute: async ({ invocation, signal }) => {
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
          ],
        },
      }),
    })

    const turn = fixture.runtime.invokeAgentTurn(
      { agentSessionId: fixture.sessionId, input: 'Wait.' },
      { abortSignal: controller.signal },
    )
    await started
    controller.abort('user-stop')
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
          state: 'aborted',
          reason: 'user-stop',
        }),
      ]),
    )
    fixture.close()
  })

  it('parses a Content Tool despite Provider stop and replays its result as runtime user content', async () => {
    const requests: Array<{ messages: unknown[]; tools?: unknown[] }> = []
    const fixture = await createFixture({
      tool: testContentTool,
      mounts: [{
        toolId: testContentTool.id,
        orderIndex: 0,
        defaultEnabled: true,
        content: { zone: promptZoneIds.tools, slot: 'preset-content-tools', rankKey: '05', orderHint: 7 },
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

    expect(requests[0]?.tools).toBeUndefined()
    expect(
      turn.projection.zones.find(zone => zone.zoneId === promptZoneIds.tools),
    ).toMatchObject({
      slots: [
        {
          slotKey: 'preset-content-tools',
          fragments: [
            expect.objectContaining({
              id: 'runtime.agent-tools.contribution.0',
            }),
          ],
        },
      ],
    })
    expect(requests[0]?.messages[0]).toEqual(
      expect.objectContaining({
        role: 'system',
        content: expect.stringContaining('<loom_tool name="tool_name">'),
      }),
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
            '<loom_tool_result invocation_id="tool-invocation-',
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

  it('projects persisted Agent Session history through ordered prompt rules', async () => {
    const fixture = await createFixture({
      execute: ({ invocation }) => ({ invocationId: invocation.id, toolId: invocation.toolId, status: 'completed', content: [] }),
      invokeChat: async () => ({
        provider: 'test', model: 'test-model', text: 'secret answer', finishReason: 'stop',
        message: { role: 'assistant', content: 'secret answer' },
      }),
    })
    await fixture.runtime.invokeAgentTurn({ agentSessionId: fixture.sessionId, input: 'secret request' })
    await fixture.runtime.upsertTextTransformRule({
      ruleId: 'workspace.redact',
      rule: {
        name: 'Redact', owner: { kind: 'workspace' }, enabled: true, orderIndex: 0,
        matcher: { kind: 'regex', pattern: 'secret', flags: 'g' },
        effect: { kind: 'replace', replacement: 'projected' },
        targets: ['agent-session'], phases: ['prompt'],
      },
    })

    const projected = await fixture.runtime.projectHistory({
      source: { kind: 'agent-session', sessionId: fixture.sessionId },
      phase: 'prompt',
    })
    const canonical = await fixture.runtime.getAgentTranscriptPage({ agentSessionId: fixture.sessionId })
    const preview = await fixture.runtime.previewAgentTurn({ agentSessionId: fixture.sessionId, input: 'next' })

    expect(projected.snapshot.entries.filter(entry => entry.role).map(entry => entry.text)).toEqual(['projected request', 'projected answer'])
    expect(canonical.entries.filter(entry => entry.entry.kind === 'message').map(entry => entry.entry.kind === 'message' ? entry.entry.content : '')).toEqual(['secret request', 'secret answer'])
    expect(projected.snapshot.matches).toHaveLength(2)
    expect(preview.messages.some(message => typeof message.content === 'string' && message.content.includes('projected answer'))).toBe(true)
    expect(preview.messages.some(message => typeof message.content === 'string' && message.content.includes('secret answer'))).toBe(false)
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
}) {
  const tools = input.tools ?? [input.tool ?? readContextTool]
  let nextId = 0
  const createId = (prefix: string) => `${prefix}-${++nextId}`
  const now = () => '2026-08-23T00:00:00.000Z'
  const engine = createSqliteDataEngine({ filename: ':memory:', createId, now })
  const documents = createSqliteDocumentStore({ engine })
  const agents = createAgentStore({ engine, createId, now })
  const promptResources = createPromptResourceStore({ engine, createId, now })
  const narratives = createNarrativeStore({ engine, createId, now })
  const runtime = createApplicationRuntime({
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
  await runtime.replacePresetToolMounts({
    presetId: preset.resource.id,
    mounts: input.mounts ?? tools.map((tool, orderIndex) => ({
      toolId: tool.id,
      orderIndex,
      defaultEnabled: true,
      ...(tool.prompt?.provider ? { provider: tool.prompt.provider } : {}),
      ...(tool.input.kind === 'structured' || !tool.prompt?.content ? {} : { content: tool.prompt.content }),
    })),
  })
  const profile = await runtime.createAgentProfile({
    name: 'Tool Agent',
    presetId: preset.resource.id,
    model: {
      providerProfileId: provider.providerProfile.id,
      modelId: 'test-model',
    },
  })
  const sessionId = (
    await runtime.createAgentSession({
      agentProfileId: profile.agentProfile.id,
    })
  ).session.id
  return {
    runtime,
    sessionId,
    close: () => engine.close(),
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
    schemaVersion: 2 as const,
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
