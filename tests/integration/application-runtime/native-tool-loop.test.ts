import { createAgentStore } from '@loom-studio/agent-store'
import {
  createAgentToolRegistry,
  createApplicationRuntime,
  promptZoneIds,
  type ApplicationRuntimeOptions,
  type PresetToolMountInput,
  type ToolDefinition,
} from '@loom-studio/application-runtime'
import { createSqliteDataEngine } from '@loom-studio/data-engine'
import { createSqliteDocumentStore } from '@loom-studio/document-store'
import { createPromptResourceStore } from '@loom-studio/prompt-resource-store'
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
  it('runs native then content tools in one turn before returning the final answer', async () => {
    const requests: Array<{ messages: unknown[]; tools?: unknown[] }> = []
    const fixture = await createFixture({
      tools: [readContextTool, testContentTool],
      execute: ({ invocation }) => ({
        invocationId: invocation.id,
        toolId: invocation.toolId,
        status: 'completed',
        content: [{ type: 'text', text: `result:${invocation.toolId}` }],
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
    ]))
    expect(requests[2]?.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'user',
        content: expect.stringContaining('<loom_tool_result invocation_id="tool-invocation-'),
      }),
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
  execute: NonNullable<
    Parameters<typeof createAgentToolRegistry>[1]
  >[number]['execute']
  invokeChat: NonNullable<ApplicationRuntimeOptions['gateway']>['invokeChat']
}) {
  const tools = input.tools ?? [input.tool ?? readContextTool]
  let nextId = 0
  const createId = (prefix: string) => `${prefix}-${++nextId}`
  const now = () => '2026-08-23T00:00:00.000Z'
  const engine = createSqliteDataEngine({ filename: ':memory:', createId, now })
  const documents = createSqliteDocumentStore({ engine })
  const agents = createAgentStore({ engine, createId, now })
  const promptResources = createPromptResourceStore({ engine, createId, now })
  const runtime = createApplicationRuntime({
    agents,
    agentTools: createAgentToolRegistry(
      tools,
      tools.map(tool => ({ toolId: tool.id, execute: input.execute })),
    ),
    dataEngine: engine,
    documents,
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
