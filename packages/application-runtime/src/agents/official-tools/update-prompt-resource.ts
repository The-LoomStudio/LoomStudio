import type { JsonObject } from '@loom-studio/shared'
import type { PromptResourceMutation } from '@loom-studio/prompt-resource-store'
import type { ToolDefinition, ToolRuntimeRegistration } from '../tool-registry.js'

export const officialUpdatePromptResourceTool: ToolDefinition = {
  id: 'official/update_prompt_resource',
  owner: { namespace: 'official' },
  name: 'update_prompt_resource',
  description: 'Apply explicit version-checked mutations to one Workspace Prompt Resource.',
  input: {
    kind: 'structured',
    schema: {
      type: 'object',
      properties: {
        resourceId: { type: 'string', minLength: 1 },
        expectedVersion: { type: 'integer', minimum: 1 },
        mutations: { type: 'array', minItems: 1 },
      },
      required: ['resourceId', 'expectedVersion', 'mutations'],
      additionalProperties: false,
    } satisfies JsonObject,
  },
}

export const officialUpdatePromptResourceRegistration: ToolRuntimeRegistration = {
  toolId: officialUpdatePromptResourceTool.id,
  execute: async ({ invocation, scope }) => {
    if (!scope?.workspaceResourceAccess || !scope.mutatePromptResource) throw new Error('Workspace Prompt Resource mutation is unavailable')
    const resourceId = String(invocation.arguments?.resourceId ?? '')
    const expectedVersion = Number(invocation.arguments?.expectedVersion)
    const mutations = invocation.arguments?.mutations
    if (!Number.isInteger(expectedVersion) || !Array.isArray(mutations) || mutations.length === 0) {
      throw new Error('Prompt Resource update requires resourceId, expectedVersion, and mutations')
    }
    const result = await scope.mutatePromptResource({
      resourceId,
      expectedVersion,
      mutations: mutations as unknown as PromptResourceMutation[],
    })
    return {
      invocationId: invocation.id, toolId: invocation.toolId, status: 'completed',
      content: [{ type: 'json', value: result }],
    }
  },
}
