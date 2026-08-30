import type { JsonObject, JsonValue } from '@loom-studio/shared'
import type { ToolDefinition, ToolRuntimeRegistration } from '../tool-registry.js'

export const officialReadStateTool: ToolDefinition = {
  id: 'official/read_state',
  owner: { namespace: 'official' },
  name: 'read_state',
  description: 'Read the current Global or bound Narrative Timeline state. Timeline access is limited to the current Agent turn.',
  input: {
    kind: 'structured',
    schema: {
      type: 'object',
      properties: {
        target: { type: 'object' },
        paths: { type: 'array', items: { type: 'string' } },
      },
      required: ['target'],
      additionalProperties: false,
    } satisfies JsonObject,
  },
  prompt: { provider: { order: 30 } },
}

export const officialReadStateRegistration: ToolRuntimeRegistration = {
  toolId: officialReadStateTool.id,
  execute: async ({ invocation, scope }) => {
    const target = readTarget(invocation.arguments?.target)
    if (!scope?.state?.canAccess(target)) throw stateToolError('state.permission_denied', 'State target is not accessible in this Agent turn')
    const snapshot = await scope.state.read(target)
    const paths = invocation.arguments?.paths
    const value = Array.isArray(paths)
      ? Object.fromEntries(paths.map(path => [String(path), readPointer(snapshot.value, String(path))]))
      : snapshot.value
    return {
      invocationId: invocation.id,
      toolId: invocation.toolId,
      status: 'completed',
      content: [{ type: 'json', value: { target, revisionId: snapshot.revisionId, value } }],
    }
  },
}

export function stateToolError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code })
}

export function readTarget(value: JsonValue | undefined): { scope: 'global' } | { scope: 'timeline'; timelineId: string; branchId: string } {
  if (!isObject(value)) throw new Error('State target must be an object')
  if (value.scope === 'global') return { scope: 'global' }
  if (value.scope === 'timeline' && typeof value.timelineId === 'string' && typeof value.branchId === 'string') {
    return { scope: 'timeline', timelineId: value.timelineId, branchId: value.branchId }
  }
  throw new Error('State target is invalid')
}

function readPointer(root: JsonObject, path: string): JsonValue {
  if (path === '') return root
  if (!path.startsWith('/')) throw new Error(`State path must be an RFC 6901 JSON Pointer: ${path}`)
  let current: JsonValue = root
  for (const segment of path.slice(1).split('/').map(item => item.replace(/~1/g, '/').replace(/~0/g, '~'))) {
    if (Array.isArray(current)) current = current[Number(segment)]!
    else if (isObject(current) && segment in current) current = current[segment]!
    else throw new Error(`State path does not exist: ${path}`)
  }
  return current
}

function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
