import type { JsonObject } from '@loom-studio/shared'
import type { ToolDefinition, ToolRuntimeRegistration } from '../tool-registry.js'

export const officialReadPromptResourceTool: ToolDefinition = {
  id: 'official/read_prompt_resource',
  owner: { namespace: 'official' },
  name: 'read_prompt_resource',
  description: 'Read one Workspace Prompt Resource by its exact stable ID.',
  input: {
    kind: 'structured',
    schema: {
      type: 'object',
      properties: { resourceId: { type: 'string', minLength: 1 } },
      required: ['resourceId'],
      additionalProperties: false,
    } satisfies JsonObject,
  },
}

export const officialReadPromptResourceRegistration: ToolRuntimeRegistration = {
  toolId: officialReadPromptResourceTool.id,
  execute: async ({ invocation, scope }) => {
    if (!scope?.workspaceResourceAccess || !scope.promptResources) throw new Error('Workspace Prompt Resource access is unavailable')
    const resourceId = String(invocation.arguments?.resourceId ?? '')
    const resource = await scope.promptResources.getResource(resourceId)
    if (!resource) throw new Error(`Prompt Resource not found: ${resourceId}`)
    return {
      invocationId: invocation.id, toolId: invocation.toolId, status: 'completed',
      content: [{ type: 'json', value: {
        id: resource.id, resourceKind: resource.resourceKind, label: resource.label,
        version: resource.version, rootNode: resource.rootNode,
      } }],
    }
  },
}
