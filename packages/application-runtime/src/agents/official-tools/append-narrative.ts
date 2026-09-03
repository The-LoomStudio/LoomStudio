import type { JsonObject } from '@loom-studio/shared'
import type { ToolDefinition, ToolRuntimeRegistration } from '../tool-registry.js'

export const officialAppendNarrativeTool: ToolDefinition = {
  id: 'official/append_narrative',
  owner: { namespace: 'official' },
  name: 'append_narrative',
  description: 'Append a narrative paragraph to the current active Narrative Timeline.',
  input: {
    kind: 'structured',
    schema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          minLength: 1,
          description: 'Markdown text of the story or dialogue to append to the narrative.',
        },
      },
      required: ['content'],
      additionalProperties: false,
    } satisfies JsonObject,
  },
  prompt: { provider: { order: 50 } },
}

export const officialAppendNarrativeRegistration: ToolRuntimeRegistration = {
  toolId: officialAppendNarrativeTool.id,
  execute: async ({ invocation, scope }) => {
    if (!scope?.narrative) {
      throw new Error('Narrative access is not available in this Agent turn')
    }
    const content = typeof invocation.arguments?.content === 'string'
      ? invocation.arguments.content.trim()
      : ''
    if (!content) {
      throw new Error('Narrative content cannot be empty')
    }
    const result = await scope.narrative.appendNode({ content })
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
