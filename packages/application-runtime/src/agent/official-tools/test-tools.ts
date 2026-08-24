import type { JsonObject } from '@loom-studio/shared'
import {
  createAgentToolRegistry,
  type AgentToolRegistry,
  type ToolDefinition,
  type ToolRuntimeRegistration,
} from '../tool-registry.js'

const testModeSchema: JsonObject = {
  type: 'string',
  enum: ['success', 'error'],
}

export const officialTestStructuredTool: ToolDefinition = {
  id: 'official/test_structured',
  owner: { namespace: 'official' },
  name: 'test_structured',
  description:
    'Exercise structured tool calling for {{User}}. Returns deterministic test output or a requested test error.',
  input: {
    kind: 'structured',
    schema: {
      type: 'object',
      properties: {
        mode: testModeSchema,
        value: { type: 'string' },
      },
      required: ['mode', 'value'],
      additionalProperties: false,
    },
  },
  prompt: {
    parameterDescriptions: {
      mode: 'Choose whether the test succeeds or fails for {{User}}.',
      value: 'The value returned to {{User}}.',
    },
    provider: { order: 10 },
  },
}

export const officialTestContentTool: ToolDefinition = {
  id: 'official/test_content',
  owner: { namespace: 'official' },
  name: 'test_content',
  description:
    'Exercise raw content tool calling without JSON string escaping. Returns deterministic test output or a requested test error.',
  input: {
    kind: 'hybrid',
    metadataSchema: {
      type: 'object',
      properties: {
        mode: testModeSchema,
        label: { type: 'string' },
      },
      required: ['mode'],
      additionalProperties: false,
    },
    rawField: 'content',
    mediaType: 'text/plain',
  },
  prompt: {
    guidance: 'Use this only to verify raw content transport for {{User}}.',
    provider: { order: 20 },
    content: { zone: 'tools', slot: 'official-tools', rankKey: '10', orderHint: 20 },
  },
}

export const officialTestAgentToolDefinitions = [
  officialTestStructuredTool,
  officialTestContentTool,
] as const

const officialTestAgentToolRegistrations: ToolRuntimeRegistration[] = [
  {
    toolId: officialTestStructuredTool.id,
    execute: ({ invocation }) => {
      if (invocation.arguments?.mode === 'error')
        throw new Error('Structured test tool failed as requested')
      return {
        invocationId: invocation.id,
        toolId: invocation.toolId,
        status: 'completed',
        content: [
          {
            type: 'json',
            value: {
              kind: 'structured-test',
              value: invocation.arguments?.value ?? '',
            },
          },
        ],
      }
    },
  },
  {
    toolId: officialTestContentTool.id,
    execute: ({ invocation }) => {
      if (invocation.arguments?.mode === 'error')
        throw new Error('Content test tool failed as requested')
      return {
        invocationId: invocation.id,
        toolId: invocation.toolId,
        status: 'completed',
        content: [
          {
            type: 'json',
            value: {
              kind: 'content-test',
              label: invocation.arguments?.label ?? '',
              contentLength: invocation.rawInput?.length ?? 0,
              echo: invocation.rawInput ?? '',
            },
          },
        ],
      }
    },
  },
]

export function createOfficialTestAgentToolRegistry(): AgentToolRegistry {
  return createAgentToolRegistry(
    officialTestAgentToolDefinitions,
    officialTestAgentToolRegistrations,
  )
}
