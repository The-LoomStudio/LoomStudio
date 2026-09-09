import type { JsonObject, JsonValue } from './index.js'

export type MacroSourceKind = 'card' | 'preset' | 'provider' | 'builtin' | 'state'

export type MacroCandidate = {
  sourceId: string
  sourceKind: MacroSourceKind
  sourceLabel: string
  value?: string
  error?: string
}

export type MacroInspectionEntry = {
  name: string
  candidates: MacroCandidate[]
  selectedSourceId?: string
  value?: string
  status: 'resolved' | 'conflict' | 'error'
}

export type MacroInspection = {
  snapshot: VariableSnapshot
  entries: MacroInspectionEntry[]
  capturedAt: string
}

export type VariableSnapshot = {
  global: JsonObject
  timeline?: JsonObject
  computed: JsonObject
  aliases: Record<string, string>
  macroDiagnostics?: Record<string, 'macro.conflict' | 'macro.error'>
}

export type MacroRenderTrace = {
  reads: VariableReadTrace[]
  diagnostics: VariableDiagnostic[]
}

export type VariableReadTrace = {
  requestedPath: string
  resolvedPath: string
  source: 'global' | 'timeline' | 'computed'
}

export type VariableDiagnostic = {
  severity: 'warning'
  code: 'variable.path_missing' | 'variable.value_not_scalar' | 'macro.conflict' | 'macro.error'
  path: string
}

export type MacroRenderContext = {
  snapshot: VariableSnapshot
  trace: MacroRenderTrace
}

export type VariableRenderContext = MacroRenderContext
export type VariableRenderTrace = MacroRenderTrace

export const macroNamePattern = /^[\p{L}\p{N}_$]+(?:\.[\p{L}\p{N}_$]+)*$/u

export const builtinMacroAliases: Record<string, string> = {
  User: 'global.user.name', user: 'global.user.name', USER: 'global.user.name',
  'user.name': 'global.user.name', 'User.name': 'global.user.name', user_name: 'global.user.name',
  'user.description': 'global.user.description', 'User.description': 'global.user.description', user_description: 'global.user.description', user_desc: 'global.user.description',
  char: 'computed.char.name', Char: 'computed.char.name', CHAR: 'computed.char.name', 'char.name': 'computed.char.name', char_name: 'computed.char.name',
  'char.description': 'computed.char.description', char_description: 'computed.char.description', char_desc: 'computed.char.description',
  bot: 'computed.bot.name', Bot: 'computed.bot.name', BOT: 'computed.bot.name', 'bot.name': 'computed.bot.name',
}

export function canonicalMacroName(name: string): string {
  return name.toLowerCase()
}

export function isReservedMacroName(name: string): boolean {
  const root = canonicalMacroName(name.split('.')[0]!)
  return root === 'global'
    || root === 'timeline'
    || root === 'computed'
    || Object.keys(builtinMacroAliases).some(alias => canonicalMacroName(alias) === canonicalMacroName(name))
}

export function isValidMacroName(name: string): boolean {
  return macroNamePattern.test(name)
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
      aliases: { ...builtinMacroAliases, ...(input?.aliases ?? {}) },
    },
    trace: { reads: [], diagnostics: [] },
  }
}

export function renderVariableMacros(input: string, context: VariableRenderContext): string {
  return input.replace(/\{\{\s*([\p{L}\p{N}_$]+(?:\.[\p{L}\p{N}_$]+)*)\s*\}\}/gu, (token, requestedPath: string) => {
    const directAlias = Object.hasOwn(context.snapshot.aliases, requestedPath)
      ? context.snapshot.aliases[requestedPath]
      : undefined
    const normalizedKey = requestedPath.toLowerCase()
    const caseInsensitiveKey = Object.keys(context.snapshot.aliases).find(key => key.toLowerCase() === normalizedKey)
    const resolvedPath = directAlias ?? (caseInsensitiveKey ? context.snapshot.aliases[caseInsensitiveKey] : requestedPath)
    const requestedDiagnosticName = canonicalMacroName(requestedPath)
    const resolvedDiagnosticName = canonicalMacroName(resolvedPath)
    const diagnosticCode = (context.snapshot.macroDiagnostics && Object.hasOwn(context.snapshot.macroDiagnostics, requestedDiagnosticName)
      ? context.snapshot.macroDiagnostics[requestedDiagnosticName]
      : undefined)
      ?? (context.snapshot.macroDiagnostics && Object.hasOwn(context.snapshot.macroDiagnostics, resolvedDiagnosticName)
        ? context.snapshot.macroDiagnostics[resolvedDiagnosticName]
        : undefined)
    if (diagnosticCode) {
      context.trace.diagnostics.push({ severity: 'warning', code: diagnosticCode, path: resolvedPath })
      return token
    }
    const resolved = resolveVariable(context.snapshot, resolvedPath)
    if (!resolved) {
      context.trace.diagnostics.push({ severity: 'warning', code: 'variable.path_missing', path: resolvedPath })
      return token
    }
    if (typeof resolved.value === 'object' && resolved.value !== null) {
      context.trace.diagnostics.push({ severity: 'warning', code: 'variable.value_not_scalar', path: resolvedPath })
      return token
    }
    context.trace.reads.push({ requestedPath, resolvedPath, source: resolved.source })
    return resolved.value === null ? 'null' : String(resolved.value)
  })
}

export function cloneVariableRenderTrace(trace: VariableRenderTrace): VariableRenderTrace {
  return structuredClone(trace)
}

export function cloneVariableSnapshot(snapshot: VariableSnapshot): VariableSnapshot {
  return structuredClone(snapshot)
}

export function cloneMacroInspection(inspection: MacroInspection): MacroInspection {
  return structuredClone(inspection)
}

export type MacroProviderContext = {
  global: JsonObject
  timeline?: JsonObject
  cardId?: string
  presetId?: string
}

export type MacroProviderDefinition = {
  id: string
  name: string
  sourceLabel: string
  resolve(context: MacroProviderContext): string | Promise<string>
}

export type MacroSelectionMap = Record<string, string>

export function isJsonScalar(value: JsonValue): value is null | boolean | number | string {
  return value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string'
}

function resolveVariable(snapshot: VariableSnapshot, path: string): { value: JsonValue; source: VariableReadTrace['source'] } | undefined {
  const segments = path.split('.')
  const computed = readPath(snapshot.computed, segments)
  if (computed.found) return { value: computed.value, source: 'computed' }
  const [scope, ...relative] = segments
  if (scope === 'computed') {
    const value = readPath(snapshot.computed, relative)
    return value.found ? { value: value.value, source: 'computed' } : undefined
  }
  if (scope === 'global') {
    const value = readPath(snapshot.global, relative)
    return value.found ? { value: value.value, source: 'global' } : undefined
  }
  if (scope === 'timeline' && snapshot.timeline) {
    const value = readPath(snapshot.timeline, relative)
    return value.found ? { value: value.value, source: 'timeline' } : undefined
  }
  if (snapshot.timeline) {
    const value = readPath(snapshot.timeline, segments)
    if (value.found) return { value: value.value, source: 'timeline' }
  }
  const value = readPath(snapshot.global, segments)
  return value.found ? { value: value.value, source: 'global' } : undefined
}

function readPath(root: JsonObject, segments: string[]): { found: true; value: JsonValue } | { found: false } {
  if (segments.length > 1) {
    const flatKey = segments.join('.')
    if (Object.hasOwn(root, flatKey)) return { found: true, value: root[flatKey]! }
    const matchedFlatKey = Object.keys(root).find(key => key.toLowerCase() === flatKey.toLowerCase())
    if (matchedFlatKey) return { found: true, value: root[matchedFlatKey]! }
  }
  let current: JsonValue = root
  for (const segment of segments) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return { found: false }
    const object = current as JsonObject
    const key = Object.hasOwn(object, segment) ? segment : Object.keys(object).find(item => item.toLowerCase() === segment.toLowerCase())
    if (!key) return { found: false }
    current = object[key]!
  }
  return { found: true, value: current }
}
