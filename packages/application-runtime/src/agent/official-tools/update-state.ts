import type { JsonObject } from '@loom-studio/shared'
import type { ToolDefinition, ToolRuntimeRegistration } from '../tool-registry.js'
import { readTarget, stateToolError } from './read-state.js'

export const officialUpdateStateTool: ToolDefinition = {
  id: 'official/update_state',
  owner: { namespace: 'official' },
  name: 'update_state',
  description: 'Apply validated set, remove, or increment operations to the current Global or bound Narrative Timeline state.',
  input: {
    kind: 'structured',
    schema: {
      type: 'object',
      properties: {
        target: { type: 'object' },
        expectedRevisionId: { type: 'string', minLength: 1 },
        operations: { type: 'array', items: { type: 'object' } },
      },
      required: ['target', 'expectedRevisionId', 'operations'],
      additionalProperties: false,
    } satisfies JsonObject,
  },
  prompt: { provider: { order: 40 } },
}

export const officialUpdateStateRegistration: ToolRuntimeRegistration = {
  toolId: officialUpdateStateTool.id,
  execute: async ({ invocation, scope }) => {
    const target = readTarget(invocation.arguments?.target)
    if (!scope?.state?.canAccess(target)) throw stateToolError('state.permission_denied', 'State target is not accessible in this Agent turn')
    const expectedRevisionId = String(invocation.arguments?.expectedRevisionId ?? '')
    const operations = invocation.arguments?.operations
    if (!Array.isArray(operations) || !operations.every(operation => typeof operation === 'object' && operation !== null && !Array.isArray(operation))) {
      throw new Error('State operations must be an object array')
    }
    const normalizedOperations = operations as JsonObject[]
    const result = await scope.state.update({
      target,
      expectedRevisionId,
      operations: normalizedOperations,
      idempotencyKey: invocation.id,
    })
    return {
      invocationId: invocation.id,
      toolId: invocation.toolId,
      status: 'completed',
      content: [{
        type: 'json',
        value: {
          target,
          revisionId: result.revisionId,
          modifiedPaths: normalizedOperations.map(operation => String(operation.path ?? '')),
        },
      }],
    }
  },
}
