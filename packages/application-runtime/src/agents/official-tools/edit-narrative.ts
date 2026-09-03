import type { JsonObject } from '@loom-studio/shared'
import type { ToolDefinition, ToolRuntimeRegistration } from '../tool-registry.js'

export const officialEditNarrativeTool: ToolDefinition = {
  id: 'official/edit_narrative',
  owner: { namespace: 'official' },
  name: 'edit_narrative',
  description: 'Edit the raw markdown content of an existing narrative node in the current timeline.',
  input: {
    kind: 'structured',
    schema: {
      type: 'object',
      properties: {
        nodeId: {
          type: 'string',
          minLength: 1,
          description: 'The ID of the narrative node to edit.',
        },
        content: {
          type: 'string',
          minLength: 1,
          description: 'The updated markdown text for this narrative node.',
        },
      },
      required: ['nodeId', 'content'],
      additionalProperties: false,
    } satisfies JsonObject,
  },
  prompt: { provider: { order: 60 } },
}

export const officialEditNarrativeRegistration: ToolRuntimeRegistration = {
  toolId: officialEditNarrativeTool.id,
  execute: async ({ invocation, scope }) => {
    if (!scope?.narrative) {
      throw new Error('Narrative access is not available in this Agent turn')
    }
    const nodeId = typeof invocation.arguments?.nodeId === 'string'
      ? invocation.arguments.nodeId.trim()
      : ''
    const content = typeof invocation.arguments?.content === 'string'
      ? invocation.arguments.content.trim()
      : ''
    if (!nodeId) {
      throw new Error('nodeId cannot be empty')
    }
    if (!content) {
      throw new Error('Narrative content cannot be empty')
    }
    const result = await scope.narrative.editNode({ nodeId, content })
    return {
      invocationId: invocation.id,
      toolId: invocation.toolId,
      status: 'completed',
      content: [{
        type: 'json',
        value: {
          nodeId: result.nodeId,
          timelineId: scope.narrative.timelineId,
          branchId: scope.narrative.branchId,
        },
      }],
    }
  },
}
