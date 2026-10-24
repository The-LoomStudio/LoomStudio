import type { JsonObject } from '@loom-studio/shared'
import type { ToolDefinition, ToolRuntimeRegistration } from '../tool-registry.js'

export const officialEditNarrativeTool: ToolDefinition = {
  id: 'official/edit_narrative',
  owner: { namespace: 'official' },
  name: 'edit_narrative',
  description: 'Edit the raw markdown content of a node in the current narrative branch without changing other branches. Address the node by its fixed floor; the floor stays unchanged after editing.',
  input: {
    kind: 'structured',
    schema: {
      type: 'object',
      properties: {
        floor: {
          type: 'integer',
          minimum: 1,
          description: 'The fixed floor in the current narrative branch.',
        },
        content: {
          type: 'string',
          minLength: 1,
          description: 'The updated markdown text for this narrative node.',
        },
      },
      required: ['floor', 'content'],
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
    const floor = invocation.arguments?.floor
    const content = typeof invocation.arguments?.content === 'string'
      ? invocation.arguments.content.trim()
      : ''
    if (typeof floor !== 'number' || !Number.isSafeInteger(floor) || floor < 1) {
      throw new Error('floor must be a positive integer')
    }
    if (!content) {
      throw new Error('Narrative content cannot be empty')
    }
    const result = await scope.narrative.editNode({ floor, content })
    return {
      invocationId: invocation.id,
      toolId: invocation.toolId,
      status: 'completed',
      content: [{
        type: 'json',
        value: {
          floor: result.floor,
          path: `/narrative/${result.floor}.md`,
        },
      }],
    }
  },
}
