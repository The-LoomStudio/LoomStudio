import type { JsonObject, JsonValue } from '@loom-studio/shared'

export type VariableSnapshot = {
  global: JsonObject
  timeline?: JsonObject
  computed: JsonObject
  aliases: Record<string, string>
}

export type VariableReadTrace = {
  requestedPath: string
  resolvedPath: string
  source: 'global' | 'timeline' | 'computed'
}

export type VariableDiagnostic = {
  severity: 'warning'
  code: 'variable.path_missing' | 'variable.value_not_scalar'
  path: string
}

export type VariableRenderTrace = {
  reads: VariableReadTrace[]
  diagnostics: VariableDiagnostic[]
}

export type VariableRenderContext = {
  snapshot: VariableSnapshot
  trace: VariableRenderTrace
}

export function createVariableRenderContext(input?: {
  global?: JsonObject
  timeline?: JsonObject
  computed?: JsonObject
  aliases?: Record<string, string>
}): VariableRenderContext {
  return {
    snapshot: {
      global: structuredClone(input?.global ?? { user: { name: 'User' } }),
      ...(input?.timeline ? { timeline: structuredClone(input.timeline) } : {}),
      computed: structuredClone(input?.computed ?? {}),
      aliases: { User: 'global.user.name', ...(input?.aliases ?? {}) },
    },
    trace: { reads: [], diagnostics: [] },
  }
}

export function renderVariableMacros(input: string, context: VariableRenderContext): string {
  return input.replace(/\{\{\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\}\}/g, (token, requestedPath: string) => {
    const resolvedPath = context.snapshot.aliases[requestedPath] ?? requestedPath
    const resolved = resolveVariable(context.snapshot, resolvedPath)
    if (!resolved) {
      context.trace.diagnostics.push({
        severity: 'warning',
        code: 'variable.path_missing',
        path: resolvedPath,
      })
      return token
    }
    if (typeof resolved.value === 'object' && resolved.value !== null) {
      context.trace.diagnostics.push({
        severity: 'warning',
        code: 'variable.value_not_scalar',
        path: resolvedPath,
      })
      return token
    }
    context.trace.reads.push({ requestedPath, resolvedPath, source: resolved.source })
    return resolved.value === null ? 'null' : String(resolved.value)
  })
}

export function cloneVariableRenderTrace(trace: VariableRenderTrace): VariableRenderTrace {
  return structuredClone(trace)
}

function resolveVariable(
  snapshot: VariableSnapshot,
  path: string,
): { value: JsonValue; source: VariableReadTrace['source'] } | undefined {
  const segments = path.split('.')
  const computed = readPath(snapshot.computed, segments)
  if (computed.found) return { value: computed.value, source: 'computed' }
  const [scope, ...relativePath] = segments
  if (scope === 'global') {
    const value = readPath(snapshot.global, relativePath)
    return value.found ? { value: value.value, source: 'global' } : undefined
  }
  if (scope === 'timeline' && snapshot.timeline) {
    const value = readPath(snapshot.timeline, relativePath)
    return value.found ? { value: value.value, source: 'timeline' } : undefined
  }
  return undefined
}

function readPath(root: JsonObject, segments: string[]): { found: true; value: JsonValue } | { found: false } {
  let current: JsonValue = root
  for (const segment of segments) {
    if (!isJsonObject(current) || !(segment in current)) return { found: false }
    current = current[segment]!
  }
  return { found: true, value: current }
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
