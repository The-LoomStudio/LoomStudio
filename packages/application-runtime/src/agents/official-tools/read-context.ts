import type { JsonObject } from '@loom-studio/shared'
import type { ToolDefinition, ToolRuntimeRegistration } from '../tool-registry.js'

export const officialReadContextTool: ToolDefinition = {
  id: 'official/read_context',
  owner: { namespace: 'official' },
  name: 'read_context',
  description: 'Read one accessible context resource by the virtual path or item ID returned by search_context.',
  input: {
    kind: 'structured',
    schema: {
      type: 'object',
      properties: { 
        path: { type: 'string', minLength: 1 },
        id: { type: 'string', minLength: 1 },
      },
      additionalProperties: false,
    } satisfies JsonObject,
  },
  prompt: {
    parameterDescriptions: {
      path: 'The virtual path of the context item.',
      id: 'The exact item ID (fallback if path is unknown).',
    },
    provider: { order: 20 },
  },
}

export const officialReadContextRegistration: ToolRuntimeRegistration = {
  toolId: officialReadContextTool.id,
  execute: ({ invocation, scope }) => {
    const id = invocation.arguments?.id ? String(invocation.arguments.id) : undefined
    const path = invocation.arguments?.path ? String(invocation.arguments.path) : undefined
    const item = scope?.context.find(candidate => (path && candidate.virtualPath === path) || (id && candidate.id === id))
    if (!item) throw new Error(`Active context item not found: ${path ?? id}`)
    return {
      invocationId: invocation.id,
      toolId: invocation.toolId,
      status: 'completed',
      content: [{
        type: 'json',
        value: {
          id: item.id,
          name: item.name,
          virtualPath: item.virtualPath,
          mediaType: item.mediaType,
          promptState: item.promptState,
          mounted: 'fresh',
        },
      }],
      contextMounts: [{ ...item }],
    }
  },
}
