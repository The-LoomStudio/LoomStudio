import type { JsonObject } from '@loom-studio/shared'
import type { ToolDefinition, ToolRuntimeRegistration } from '../tool-registry.js'

export const officialReadContextTool: ToolDefinition = {
  id: 'official/read_context',
  owner: { namespace: 'official' },
  name: 'read_context',
  description: 'Read one accessible context resource by the item ID returned by search_context, including resources that were not injected because Activation did not trigger.',
  input: {
    kind: 'structured',
    schema: {
      type: 'object',
      properties: { id: { type: 'string', minLength: 1 } },
      required: ['id'],
      additionalProperties: false,
    } satisfies JsonObject,
  },
  prompt: {
    parameterDescriptions: {
      id: 'The exact accessible context item ID returned by search_context.',
    },
    provider: { order: 20 },
  },
}

export const officialReadContextRegistration: ToolRuntimeRegistration = {
  toolId: officialReadContextTool.id,
  execute: ({ invocation, scope }) => {
    const id = String(invocation.arguments?.id ?? '')
    const item = scope?.context.find(candidate => candidate.id === id)
    if (!item) throw new Error(`Active context item not found: ${id}`)
    return {
      invocationId: invocation.id,
      toolId: invocation.toolId,
      status: 'completed',
      content: [{ type: 'json', value: { ...item } }],
    }
  },
}
