import type { JsonObject, JsonValue } from '@loom-studio/shared'
import type { ToolDefinition, ToolRuntimeRegistration } from '../tool-registry.js'

export const officialReadStateTool: ToolDefinition = {
  id: 'official/read_state',
  owner: { namespace: 'official' },
  name: 'read_state',
  description: 'Read state variables from the active narrative timeline (or global scope). Specify property names (e.g. ["entities.characters.alice.components.vitals.hp"]) or omit properties to inspect the full state object. No file paths or IDs required.',
  input: {
    kind: 'structured',
    schema: {
      type: 'object',
      properties: {
        properties: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional property keys or dot-notation names (e.g. ["entities.characters.alice.components.vitals.hp"]). Omit to read all state variables.',
        },
        scope: {
          type: 'string',
          enum: ['timeline', 'global'],
          description: 'Optional scope. Defaults to "timeline" for the active narrative turn.',
        },
        target: {
          type: 'object',
          description: 'Advanced target object. Optional.',
        },
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Deprecated legacy path array. Use properties instead.',
        },
      },
      additionalProperties: true,
    } satisfies JsonObject,
  },
  prompt: { provider: { order: 30 } },
}

export const officialReadStateRegistration: ToolRuntimeRegistration = {
  toolId: officialReadStateTool.id,
  execute: async ({ invocation, scope }) => {
    const defaultTarget = scope?.state?.defaultTarget
    const target = resolveTarget(invocation.arguments, defaultTarget)
    if (!scope?.state?.canAccess(target)) {
      throw stateToolError('state.permission_denied', 'State target is not accessible in this Agent turn')
    }
    const snapshot = await scope.state.read(target)
    const propertyList = invocation.arguments?.properties ?? invocation.arguments?.keys ?? invocation.arguments?.paths
    const properties = Array.isArray(propertyList) ? propertyList.map(String) : undefined

    let resultValue: JsonValue
    let propertyMap: Record<string, JsonValue> | undefined

    if (properties && properties.length > 0) {
      propertyMap = Object.fromEntries(
        properties.map(prop => [prop, readPointer(snapshot.value, propertyToPointer(prop))])
      )
      resultValue = propertyMap
    } else {
      resultValue = snapshot.value
    }

    return {
      invocationId: invocation.id,
      toolId: invocation.toolId,
      status: 'completed',
      content: [{
        type: 'json',
        value: {
          target,
          revisionId: snapshot.revisionId,
          value: resultValue,
          ...(propertyMap ? { properties: propertyMap } : {}),
        },
      }],
    }
  },
}

export function stateToolError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code })
}

export function propertyToPointer(prop: string): string {
  const trimmed = prop.trim()
  if (trimmed === '' || trimmed === '/') return ''
  if (trimmed.startsWith('/')) return trimmed
  return '/' + trimmed.split('.').map(segment => segment.trim().replace(/~/g, '~0').replace(/\//g, '~1')).join('/')
}

export function resolveTarget(
  args: JsonObject | undefined,
  defaultTarget?: { scope: 'global' } | { scope: 'timeline'; timelineId: string; branchId: string },
): { scope: 'global' } | { scope: 'timeline'; timelineId: string; branchId: string } {
  const explicitTarget = args?.target
  const scope = typeof args?.scope === 'string' ? args.scope : undefined

  if (isObject(explicitTarget)) {
    if (explicitTarget.scope === 'global') return { scope: 'global' }
    if (explicitTarget.scope === 'timeline') {
      if (typeof explicitTarget.timelineId === 'string' && typeof explicitTarget.branchId === 'string') {
        return { scope: 'timeline', timelineId: explicitTarget.timelineId, branchId: explicitTarget.branchId }
      }
      if (defaultTarget?.scope === 'timeline') return defaultTarget
    }
  }

  if (scope === 'global') return { scope: 'global' }
  if (scope === 'timeline' && defaultTarget?.scope === 'timeline') return defaultTarget
  if (defaultTarget) return defaultTarget
  return { scope: 'global' }
}

export function readTarget(
  value: JsonValue | undefined,
  defaultTarget?: { scope: 'global' } | { scope: 'timeline'; timelineId: string; branchId: string },
): { scope: 'global' } | { scope: 'timeline'; timelineId: string; branchId: string } {
  if (value === undefined) {
    if (defaultTarget) return defaultTarget
    return { scope: 'global' }
  }
  if (!isObject(value)) throw new Error('State target must be an object')
  if (value.scope === 'global') return { scope: 'global' }
  if (value.scope === 'timeline') {
    if (typeof value.timelineId === 'string' && typeof value.branchId === 'string') {
      return { scope: 'timeline', timelineId: value.timelineId, branchId: value.branchId }
    }
    if (defaultTarget?.scope === 'timeline') return defaultTarget
  }
  throw new Error('State target is invalid')
}

export function readPointer(root: JsonObject, path: string): JsonValue {
  if (path === '') return root
  if (!path.startsWith('/')) throw new Error(`State path must be an RFC 6901 JSON Pointer: ${path}`)
  let current: JsonValue = root
  for (const segment of path.slice(1).split('/').map(item => item.replace(/~1/g, '/').replace(/~0/g, '~'))) {
    if (Array.isArray(current)) current = current[Number(segment)]!
    else if (isObject(current) && Object.hasOwn(current, segment)) current = current[segment]!
    else throw new Error(`State path does not exist: ${path}`)
  }
  return current
}

function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
