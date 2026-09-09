import type { JsonObject, JsonValue } from '@loom-studio/shared'
import type { ToolDefinition, ToolRuntimeRegistration } from '../tool-registry.js'
import { propertyToPointer, resolveTarget, stateToolError } from './read-state.js'

export const officialUpdateStateTool: ToolDefinition = {
  id: 'official/update_state',
  owner: { namespace: 'official' },
  name: 'update_state',
  description: 'Update state variables in the active narrative timeline (or global scope). You can pass dictionaries like { set: { "entities.characters.alice.components.vitals.hp": 90 } }, or structured operations. No file paths or revision IDs required.',
  input: {
    kind: 'structured',
    schema: {
      type: 'object',
      properties: {
        set: {
          type: 'object',
          description: 'Key-value map of properties to set using dot-notation (e.g. {"entities.characters.alice.components.vitals.hp": 90}).',
        },
        increment: {
          type: 'object',
          description: 'Key-number map of numeric properties to increment or decrement (e.g. {"gold": -3, "affinity": 1}).',
        },
        remove: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of property keys to delete (e.g. ["temporaryBuff"]).',
        },
        operations: {
          type: 'array',
          items: { type: 'object' },
          description: 'Optional structured operations array with op ("set"|"increment"|"remove") and key (e.g. "entities.characters.alice.components.vitals.hp").',
        },
        scope: {
          type: 'string',
          enum: ['timeline', 'global'],
          description: 'Optional scope. Defaults to active narrative turn.',
        },
        target: {
          type: 'object',
          description: 'Advanced target object. Optional.',
        },
        expectedRevisionId: {
          type: 'string',
          description: 'Optional revision ID for concurrency checks. Omit to apply to the latest state automatically.',
        },
      },
      additionalProperties: true,
    } satisfies JsonObject,
  },
  prompt: { provider: { order: 40 } },
}

export const officialUpdateStateRegistration: ToolRuntimeRegistration = {
  toolId: officialUpdateStateTool.id,
  execute: async ({ invocation, scope }) => {
    const defaultTarget = scope?.state?.defaultTarget
    const target = resolveTarget(invocation.arguments, defaultTarget)
    if (!scope?.state?.canAccess(target)) {
      throw stateToolError('state.permission_denied', 'State target is not accessible in this Agent turn')
    }

    const normalizedOperations = extractOperations(invocation.arguments)
    if (normalizedOperations.length === 0) {
      throw new Error('At least one state modification operation (set, increment, remove, or operations) must be specified')
    }

    let expectedRevisionId = typeof invocation.arguments?.expectedRevisionId === 'string' && invocation.arguments.expectedRevisionId.trim().length > 0
      ? invocation.arguments.expectedRevisionId.trim()
      : undefined

    if (!expectedRevisionId) {
      const snapshot = await scope.state.read(target)
      expectedRevisionId = snapshot.revisionId
    }

    const result = await scope.state.update({
      target,
      expectedRevisionId,
      operations: normalizedOperations,
      idempotencyKey: invocation.id,
    })

    const modifiedKeys = normalizedOperations.map(op => {
      const p = String(op.path ?? '')
      return p.startsWith('/') ? p.slice(1).replace(/\//g, '.') : p
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
          modifiedProperties: modifiedKeys,
          modifiedPaths: normalizedOperations.map(operation => String(operation.path ?? '')),
        },
      }],
    }
  },
}

function extractOperations(args: JsonObject | undefined): JsonObject[] {
  if (!args) return []
  const ops: JsonObject[] = []

  // 1. set 字典: { "player.hp": 90, "name": "Alice" }
  if (isObject(args.set)) {
    for (const [key, value] of Object.entries(args.set)) {
      ops.push({ op: 'set', path: propertyToPointer(key), value: value as JsonValue })
    }
  }

  // 2. increment 字典: { "gold": -3, "player.hp": 10 }
  if (isObject(args.increment)) {
    for (const [key, byVal] of Object.entries(args.increment)) {
      const by = Number(byVal)
      if (!Number.isFinite(by)) throw new Error(`Increment value for '${key}' must be a finite number: ${String(byVal)}`)
      ops.push({ op: 'increment', path: propertyToPointer(key), by })
    }
  }

  // 3. remove 数组: ["temporaryBuff", "player.flag"]
  if (Array.isArray(args.remove)) {
    for (const item of args.remove) {
      if (typeof item === 'string' && item.trim().length > 0) {
        ops.push({ op: 'remove', path: propertyToPointer(item) })
      }
    }
  }

  // 4. operations 结构化数组: [{ op: 'set', key: 'player.hp', value: 90 }]
  if (Array.isArray(args.operations)) {
    for (const item of args.operations) {
      if (!isObject(item)) continue
      const op = String(item.op ?? '')
      const keyOrPath = typeof item.key === 'string'
        ? item.key
        : typeof item.path === 'string'
          ? item.path
          : ''
      if (!keyOrPath) throw new Error('Each operation in operations must provide a key or path')

      const path = propertyToPointer(keyOrPath)
      if (op === 'set') {
        ops.push({ op: 'set', path, value: item.value as JsonValue })
      } else if (op === 'increment') {
        const by = Number(item.by)
        if (!Number.isFinite(by)) throw new Error(`Increment operation on '${keyOrPath}' must have a finite 'by' number`)
        ops.push({ op: 'increment', path, by })
      } else if (op === 'remove') {
        ops.push({ op: 'remove', path })
      } else {
        // 透传其他自定义 op
        ops.push({ ...item, path })
      }
    }
  }

  return ops
}

function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
