import { describe, expect, it } from 'vitest'
import {
  createAgentToolRegistry,
  type ToolDefinition,
} from '../../../packages/application-runtime/src/agent/tool-registry.js'

const structuredTool: ToolDefinition = {
  id: 'official/read_context',
  owner: { namespace: 'official' },
  name: 'read_context',
  description: 'Reads context.',
  input: {
    kind: 'structured',
    schema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
      additionalProperties: false,
    },
  },
}

const freeformTool: ToolDefinition = {
  id: 'official/apply_patch',
  owner: { namespace: 'official' },
  name: 'apply_patch',
  description: 'Applies a patch.',
  input: {
    kind: 'freeform',
    mediaType: 'text/x-diff',
    structuredFallback: {
      schema: {
        type: 'object',
        properties: { input: { type: 'string' } },
        required: ['input'],
        additionalProperties: false,
      },
    },
  },
}

const hybridTool: ToolDefinition = {
  id: 'extension.example/commit_narrative',
  owner: { namespace: 'extension.example' },
  name: 'commit_narrative',
  description: 'Commits narrative text.',
  input: {
    kind: 'hybrid',
    metadataSchema: {
      type: 'object',
      properties: { timelineId: { type: 'string' } },
      required: ['timelineId'],
      additionalProperties: false,
    },
    rawField: 'content',
    mediaType: 'text/plain',
  },
}

describe('Agent Tool Foundation', () => {
  it('lists tools and resolves requested ids in order while diagnosing missing ids', () => {
    const registry = createAgentToolRegistry([
      structuredTool,
      freeformTool,
      hybridTool,
    ])

    expect(registry.list().map((tool) => tool.id)).toEqual([
      structuredTool.id,
      freeformTool.id,
      hybridTool.id,
    ])
    expect(
      registry.resolve([hybridTool.id, 'official/missing', structuredTool.id]),
    ).toEqual({
      tools: [hybridTool, structuredTool],
      diagnostics: [
        {
          severity: 'error',
          code: 'tool.missing',
          message: 'Agent tool is not registered: official/missing',
          toolId: 'official/missing',
        },
      ],
    })
  })

  it('validates structured and raw input boundaries with a small schema check', () => {
    const registry = createAgentToolRegistry([
      structuredTool,
      freeformTool,
      hybridTool,
    ])

    expect(
      registry.validateInvocation({
        id: 'invocation-1',
        toolId: structuredTool.id,
        arguments: { query: 'weather' },
      }).valid,
    ).toBe(true)
    expect(
      registry.validateInvocation({
        id: 'invocation-2',
        toolId: structuredTool.id,
        rawInput: 'weather',
      }),
    ).toMatchObject({
      valid: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          code: 'tool.invocation.raw_input_not_allowed',
        }),
        expect.objectContaining({ code: 'tool.invocation.arguments_required' }),
      ]),
    })
    expect(
      registry.validateInvocation({
        id: 'invocation-3',
        toolId: structuredTool.id,
        arguments: {},
      }).diagnostics,
    ).toEqual([
      expect.objectContaining({ code: 'tool.invocation.schema_required' }),
    ])
    expect(
      registry.validateInvocation({
        id: 'invocation-4',
        toolId: freeformTool.id,
        rawInput: '*** Begin Patch',
      }).valid,
    ).toBe(true)
    expect(
      registry.validateInvocation({
        id: 'invocation-5',
        toolId: freeformTool.id,
        arguments: { input: 'patch' },
      }),
    ).toMatchObject({
      valid: false,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          code: 'tool.invocation.arguments_not_allowed',
        }),
        expect.objectContaining({ code: 'tool.invocation.raw_input_required' }),
      ]),
    })
    expect(
      registry.validateInvocation({
        id: 'invocation-5b',
        toolId: hybridTool.id,
        arguments: { timelineId: 'timeline-1' },
        rawInput: 'A new scene.',
      }).valid,
    ).toBe(true)
    expect(
      registry.validateInvocation({
        id: 'invocation-5c',
        toolId: hybridTool.id,
        rawInput: 'A new scene.',
      }).diagnostics,
    ).toEqual([
      expect.objectContaining({ code: 'tool.invocation.arguments_required' }),
    ])
    expect(
      registry.validateInvocation({
        id: 'invocation-6',
        toolId: 'official/missing',
        arguments: {},
      }).diagnostics,
    ).toEqual([expect.objectContaining({ code: 'tool.missing' })])
  })

  it('selects native, provider-custom, content, and declared structured fallback transports', () => {
    const registry = createAgentToolRegistry([
      structuredTool,
      freeformTool,
      hybridTool,
    ])

    expect(
      registry
        .analyze([structuredTool.id, freeformTool.id, hybridTool.id], {
          nativeFunction: true,
          providerCustom: true,
          content: true,
        })
        .exposures.map((exposure) => exposure.transport),
    ).toEqual(['native-function', 'provider-custom', 'provider-custom'])
    expect(
      registry
        .analyze([structuredTool.id, freeformTool.id, hybridTool.id], {
          nativeFunction: false,
          providerCustom: false,
          content: true,
        })
        .exposures.map((exposure) => ({
          exposed: exposure.exposed,
          transport: exposure.transport,
        })),
    ).toEqual([
      { exposed: false, transport: undefined },
      { exposed: true, transport: 'content' },
      { exposed: true, transport: 'content' },
    ])
    expect(
      registry.analyze([freeformTool.id], {
        nativeFunction: true,
        providerCustom: false,
        content: false,
      }),
    ).toMatchObject({
      exposures: [{ exposed: true, transport: 'native-function' }],
      diagnostics: [
        expect.objectContaining({
          code: 'tool.transport.structured_fallback',
          severity: 'warning',
        }),
      ],
    })
    expect(
      registry.analyze([hybridTool.id, 'official/missing'], {
        nativeFunction: false,
        providerCustom: false,
        content: false,
      }),
    ).toMatchObject({
      exposures: [
        { exposed: false, transport: undefined },
        { exposed: false, transport: undefined },
      ],
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'tool.transport.unavailable' }),
        expect.objectContaining({ code: 'tool.missing' }),
      ]),
    })
  })

  it('rejects duplicate ids while allowing editable model-visible names', () => {
    expect(() =>
      createAgentToolRegistry([structuredTool, structuredTool]),
    ).toThrow('Duplicate agent tool id')

    const renamed = {
      ...structuredTool,
      name: 'read_workspace_context',
    }
    expect(createAgentToolRegistry([renamed]).list()).toEqual([renamed])
  })

  it('supports runtime approval and execution without changing definition views', async () => {
    const registry = createAgentToolRegistry(
      [structuredTool],
      [
        {
          toolId: structuredTool.id,
          approve: ({ invocation }) =>
            invocation.id === 'denied'
              ? { decision: 'deny', reason: 'read access denied' }
              : { decision: 'allow' },
          execute: ({ invocation, tool, signal }) => ({
            invocationId: invocation.id,
            toolId: tool.id,
            status: signal.aborted ? 'aborted' : 'completed',
            content: [{ type: 'json', value: { query: invocation.arguments } }],
          }),
        },
      ],
    )
    const allowedInvocation = {
      id: 'allowed',
      toolId: structuredTool.id,
      arguments: { query: 'weather' },
    }
    const deniedInvocation = {
      id: 'denied',
      toolId: structuredTool.id,
      arguments: { query: 'secrets' },
    }

    expect(registry.list()).toEqual([structuredTool])
    expect(registry.resolve([structuredTool.id]).tools).toEqual([
      structuredTool,
    ])
    expect(
      registry.analyze([structuredTool.id], {
        nativeFunction: true,
        providerCustom: false,
        content: false,
      }).exposures[0],
    ).toMatchObject({ toolId: structuredTool.id, exposed: true })
    expect(await registry.approve(allowedInvocation)).toEqual({
      decision: 'allow',
    })
    expect(await registry.approve(deniedInvocation)).toEqual({
      decision: 'deny',
      reason: 'read access denied',
    })
    expect(registry.getRegistration(structuredTool.id)?.toolId).toBe(
      structuredTool.id,
    )
    expect(registry.getExecutor(structuredTool.id)).toBeTypeOf('function')
    await expect(
      registry.execute(allowedInvocation, new AbortController().signal),
    ).resolves.toEqual({
      invocationId: 'allowed',
      toolId: structuredTool.id,
      status: 'completed',
      content: [{ type: 'json', value: { query: { query: 'weather' } } }],
    })
  })

  it('registers and disposes Extension runtime handlers independently from definitions', async () => {
    const registry = createAgentToolRegistry([])
    const handle = registry.registerRuntime({
      toolId: structuredTool.id,
      execute: ({ invocation }) => ({
        invocationId: invocation.id,
        toolId: invocation.toolId,
        status: 'completed',
        content: [{ type: 'json', value: { echoed: invocation.arguments } }],
      }),
    })
    registry.replaceDefinitions([structuredTool])
    const invocation = { id: 'dynamic', toolId: structuredTool.id, arguments: { query: 'hello' } }
    await expect(registry.execute(invocation, new AbortController().signal)).resolves.toMatchObject({
      status: 'completed',
      content: [{ type: 'json', value: { echoed: { query: 'hello' } } }],
    })
    handle.dispose()
    await expect(registry.execute(invocation, new AbortController().signal)).rejects.toThrow('No runtime handler registered')
  })

  it('passes AbortSignal and converts handler throws into ToolResult failures', async () => {
    const abortController = new AbortController()
    const registry = createAgentToolRegistry(
      [structuredTool],
      [
        {
          toolId: structuredTool.id,
          execute: ({ invocation, signal }) => {
            abortController.abort()
            return {
              invocationId: invocation.id,
              toolId: invocation.toolId,
              status: signal.aborted ? 'aborted' : 'completed',
              content: [],
            }
          },
        },
      ],
    )

    await expect(
      registry.execute(
        {
          id: 'aborted',
          toolId: structuredTool.id,
          arguments: { query: 'cancelled' },
        },
        abortController.signal,
      ),
    ).resolves.toMatchObject({ status: 'aborted' })

    const throwingRegistry = createAgentToolRegistry(
      [structuredTool],
      [
        {
          toolId: structuredTool.id,
          execute: () => {
            throw new Error('deterministic read failed')
          },
        },
      ],
    )
    await expect(
      throwingRegistry.execute(
        {
          id: 'failed',
          toolId: structuredTool.id,
          arguments: { query: 'failure' },
        },
        new AbortController().signal,
      ),
    ).resolves.toEqual({
      invocationId: 'failed',
      toolId: structuredTool.id,
      status: 'failed',
      content: [],
      error: {
        code: 'tool.execution_failed',
        message: 'deterministic read failed',
      },
    })
  })

  it('rejects missing or duplicate runtime handlers and mismatched results', async () => {
    const invocation = {
      id: 'invocation-7',
      toolId: structuredTool.id,
      arguments: { query: 'weather' },
    }
    const noHandlerRegistry = createAgentToolRegistry([structuredTool])
    await expect(
      noHandlerRegistry.execute(invocation, new AbortController().signal),
    ).rejects.toThrow('No runtime handler registered')

    expect(() =>
      createAgentToolRegistry(
        [structuredTool],
        [
          {
            toolId: structuredTool.id,
            execute: () => ({
              invocationId: 'unused',
              toolId: structuredTool.id,
              status: 'completed',
              content: [],
            }),
          },
          {
            toolId: structuredTool.id,
            execute: () => ({
              invocationId: 'unused',
              toolId: structuredTool.id,
              status: 'completed',
              content: [],
            }),
          },
        ],
      ),
    ).toThrow('Duplicate agent tool runtime registration')

    const mismatchedRegistry = createAgentToolRegistry(
      [structuredTool],
      [
        {
          toolId: structuredTool.id,
          execute: () => ({
            invocationId: 'wrong-invocation',
            toolId: structuredTool.id,
            status: 'completed',
            content: [],
          }),
        },
      ],
    )
    await expect(
      mismatchedRegistry.execute(invocation, new AbortController().signal),
    ).rejects.toThrow('mismatched invocationId')
  })
})
