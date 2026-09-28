import type { JsonObject } from '@loom-studio/shared'
import type { ToolDefinition, ToolRuntimeRegistration } from '../tool-registry.js'
import { isExtensionResourceAvailable } from '../../runtime/extension-resource-access.js'

export const officialSearchPromptResourcesTool: ToolDefinition = {
  id: 'official/search_prompt_resources',
  owner: { namespace: 'official' },
  name: 'search_prompt_resources',
  description: 'List accessible Workspace Prompt Resources by kind without injecting their content.',
  input: {
    kind: 'structured',
    schema: {
      type: 'object',
      properties: { resourceKind: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } },
      additionalProperties: false,
    } satisfies JsonObject,
  },
}

export const officialSearchPromptResourcesRegistration: ToolRuntimeRegistration = {
  toolId: officialSearchPromptResourcesTool.id,
  execute: async ({ invocation, scope }) => {
    if (!scope?.workspaceResourceAccess || !scope.promptResources) throw new Error('Workspace Prompt Resource access is unavailable')
    const resourceKind = typeof invocation.arguments?.resourceKind === 'string' ? invocation.arguments.resourceKind : undefined
    const limit = typeof invocation.arguments?.limit === 'number' ? invocation.arguments.limit : 20
    const resources = []
    let cursor: string | undefined
    do {
      const page = await scope.promptResources.listResources({ resourceKind, limit: limit - resources.length, cursor })
      resources.push(...page.resources.filter(resource => isExtensionResourceAvailable(resource.metadata.origin, scope.availableExtensionInstallations)))
      cursor = page.nextCursor
    } while (cursor && resources.length < limit)
    return {
      invocationId: invocation.id, toolId: invocation.toolId, status: 'completed',
      content: [{ type: 'json', value: {
        resources: resources.map(resource => ({ id: resource.id, resourceKind: resource.resourceKind, label: resource.label, version: resource.version })),
        ...(cursor ? { nextCursor: cursor } : {}),
      } }],
    }
  },
}
