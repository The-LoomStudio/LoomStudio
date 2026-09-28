import type {
  JsonObject,
  MacroCandidate,
  MacroInspection,
  MacroInspectionEntry,
  MacroProviderContext,
  MacroProviderDefinition,
  MacroSelectionMap,
  MacroSelection,
  MacroOptions,
  MacroSourceKind,
  VariableSnapshot,
} from '@loom-studio/shared'
import { canonicalMacroName, isReservedMacroName, isValidMacroName, macroSelectionMatches } from '@loom-studio/shared'
import type { ExtensionInstallationTarget } from '@loom-studio/extension-sdk'

export type MacroStaticSource = {
  sourceId: string
  sourceKind: Exclude<MacroSourceKind, 'provider' | 'state' | 'builtin'>
  sourceLabel: string
  macros: Record<string, string>
  macroOptions?: MacroOptions
}

export type MacroProviderRegistry = {
  register(provider: MacroProviderDefinition, target?: ExtensionInstallationTarget): { dispose(): void }
  inspect(input: {
    snapshot: VariableSnapshot
    context: MacroProviderContext
    staticSources?: MacroStaticSource[]
    macroSelections?: MacroSelectionMap
    capturedAt: string
  }): Promise<MacroInspection>
}

type RegisteredProvider = MacroProviderDefinition & { order: number; target: ExtensionInstallationTarget }

export function createMacroProviderRegistry(): MacroProviderRegistry {
  const providers = new Map<string, RegisteredProvider>()
  let order = 0

  return {
    register(provider, target = { kind: 'global' }) {
      validateProvider(provider)
      if (providers.has(provider.id)) throw new Error(`Macro provider id is already registered: ${provider.id}`)
      const registered = { ...provider, order: order++, target: structuredClone(target) }
      providers.set(provider.id, registered)
      return {
        dispose() {
          if (providers.get(provider.id) === registered) providers.delete(provider.id)
        },
      }
    },

    async inspect(input) {
      const candidates = new Map<string, { name: string; candidates: MacroCandidate[] }>()
      const add = (name: string, candidate: MacroCandidate) => {
        const canonicalName = canonicalMacroName(name)
        const existing = candidates.get(canonicalName) ?? { name, candidates: [] }
        if (!existing.candidates.some(item => item.sourceId === candidate.sourceId && item.optionId === candidate.optionId)) existing.candidates.push(candidate)
        candidates.set(canonicalName, existing)
      }

      collectSnapshotCandidates(input.snapshot, add)
      for (const source of input.staticSources ?? []) {
        for (const [name, value] of Object.entries(source.macros)) {
          assertWritableMacroName(name, 'static macro')
          add(name, {
            sourceId: source.sourceId,
            sourceKind: source.sourceKind,
            sourceLabel: source.sourceLabel,
            value,
          })
        }
        for (const [name, options] of Object.entries(source.macroOptions ?? {})) {
          assertWritableMacroName(name, 'static macro')
          for (const option of options) add(name, {
            sourceId: source.sourceId,
            sourceKind: source.sourceKind,
            sourceLabel: source.sourceLabel,
            optionId: option.id,
            optionLabel: option.label,
            value: option.value,
          })
        }
      }

      const providerContext = freezeContext(input.context)
      let cardProviderContext: MacroProviderContext | undefined
      for (const provider of [...providers.values()].sort((left, right) => left.order - right.order)) {
        if (provider.target.kind === 'card' && provider.target.cardId !== providerContext.cardId) continue
        assertWritableMacroName(provider.name, 'macro provider')
        try {
          const context = provider.target.kind === 'global'
            ? providerContext
            : (cardProviderContext ??= freezeContext({ ...providerContext, global: {} }))
          const value = await provider.resolve(context)
          if (typeof value !== 'string') throw new Error('Macro provider must return a string')
          add(provider.name, {
            sourceId: provider.id,
            sourceKind: 'provider',
            sourceLabel: provider.sourceLabel,
            value,
          })
        } catch (error) {
          add(provider.name, {
            sourceId: provider.id,
            sourceKind: 'provider',
            sourceLabel: provider.sourceLabel,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }

      const entries: MacroInspectionEntry[] = []
      for (const name of Object.keys(input.macroSelections ?? {})) {
        const key = canonicalMacroName(name)
        if (!candidates.has(key)) candidates.set(key, { name, candidates: [] })
      }
      const computed = structuredClone(input.snapshot.computed)
      const macroDiagnostics: Record<string, 'macro.conflict' | 'macro.error'> = {}
      for (const [name, code] of Object.entries(input.snapshot.macroDiagnostics ?? {})) {
        defineOwn(macroDiagnostics, name, code)
      }
      for (const canonicalName of [...candidates.keys()].sort((left, right) => left.localeCompare(right))) {
        const group = candidates.get(canonicalName)!
        const name = group.name
        const allCandidates = group.candidates
        const selection = readSelection(input.macroSelections, canonicalName)
        const presetDefault = allCandidates.find(candidate => candidate.sourceKind === 'preset' && candidate.optionId === undefined)
        const defaultCandidate = presetDefault ?? (allCandidates.length === 1 ? allCandidates[0] : undefined)
        const selected = selection === undefined ? defaultCandidate : allCandidates.find(candidate => macroSelectionMatches(selection, candidate))
        const status = selection !== undefined && !selected ? 'error' : selected?.error ? 'error' : selected ? 'resolved' : 'conflict'
        if (status === 'conflict') defineOwn(macroDiagnostics, canonicalName, 'macro.conflict')
        else if (status === 'error') defineOwn(macroDiagnostics, canonicalName, 'macro.error')
        else delete macroDiagnostics[canonicalName]
        const entry: MacroInspectionEntry = {
          name,
          candidates: structuredClone(allCandidates),
          ...(selected ? { selectedSourceId: selected.sourceId } : {}),
          ...(selected?.optionId ? { selectedOptionId: selected.optionId } : {}),
          ...(defaultCandidate ? { defaultSelection: { sourceId: defaultCandidate.sourceId, ...(defaultCandidate.optionId ? { optionId: defaultCandidate.optionId } : {}) } } : {}),
          ...(selected?.value !== undefined ? { value: selected.value } : {}),
          status,
        }
        entries.push(entry)
        if (status === 'resolved' && selected?.value !== undefined && selected.sourceKind !== 'state' && selected.sourceKind !== 'builtin') {
          setComputedName(computed, name, selected.value)
        }
      }

      return {
        snapshot: { ...structuredClone(input.snapshot), computed, macroDiagnostics },
        entries,
        capturedAt: input.capturedAt,
      }
    },
  }
}

function validateProvider(provider: MacroProviderDefinition): void {
  if (!provider.id.trim()) throw new Error('Macro provider id is required')
  if (!provider.sourceLabel.trim()) throw new Error('Macro provider sourceLabel is required')
  if (!isValidMacroName(provider.name)) throw new Error(`Invalid macro provider name: ${provider.name}`)
  assertWritableMacroName(provider.name, 'macro provider')
  if (typeof provider.resolve !== 'function') throw new Error(`Macro provider resolver is required: ${provider.id}`)
}

export function assertWritableMacroName(name: string, subject: string): void {
  if (!isValidMacroName(name)) throw new Error(`Invalid ${subject} name: ${name}`)
  const root = name.split('.')[0]!.toLowerCase()
  if (root === 'global' || root === 'timeline' || root === 'computed') {
    throw new Error(`Reserved ${subject} name: ${name}`)
  }
  if (isReservedMacroName(name)) throw new Error(`Reserved ${subject} name: ${name}`)
}

function freezeContext(context: MacroProviderContext): MacroProviderContext {
  const copy = structuredClone(context)
  deepFreeze(copy)
  return copy
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object') return value
  Object.freeze(value)
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  return value
}

function collectSnapshotCandidates(
  snapshot: VariableSnapshot,
  add: (name: string, candidate: MacroCandidate) => void,
): void {
  collectObject(snapshot.global, 'global', 'state', 'Global State', add)
  if (snapshot.timeline) collectObject(snapshot.timeline, 'timeline', 'state', 'Timeline State', add)
  collectObject(snapshot.computed, 'computed', 'builtin', 'Computed', add)
  for (const [alias, target] of Object.entries(snapshot.aliases)) {
    const value = readPath(snapshot, target)
    if (typeof value === 'string') {
      add(alias, { sourceId: 'builtin.aliases', sourceKind: 'builtin', sourceLabel: 'Built-in alias', value })
    }
  }
}

function collectObject(
  object: JsonObject,
  prefix: string,
  sourceKind: 'state' | 'builtin',
  sourceLabel: string,
  add: (name: string, candidate: MacroCandidate) => void,
): void {
  for (const [key, value] of Object.entries(object)) {
    const name = prefix ? `${prefix}.${key}` : key
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      add(name, { sourceId: `${sourceKind}.${prefix || 'computed'}`, sourceKind, sourceLabel, value: value === null ? 'null' : String(value) })
      continue
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      collectObject(value as JsonObject, name, sourceKind, sourceLabel, add)
    }
  }
}

function readPath(snapshot: VariableSnapshot, path: string): unknown {
  const segments = path.split('.')
  const [scope, ...relative] = segments
  const root = scope === 'global' ? snapshot.global : scope === 'timeline' ? snapshot.timeline : scope === 'computed' ? snapshot.computed : undefined
  if (!root) return undefined
  let current: unknown = root
  for (const segment of relative) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined
    if (!Object.hasOwn(current, segment)) return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

function setComputedName(root: JsonObject, name: string, value: string): void {
  defineOwn(root, name, value)
}

function defineOwn<T extends object, K extends string, V>(root: T, name: K, value: V): void {
  Object.defineProperty(root, name, {
    configurable: true,
    enumerable: true,
    writable: true,
    value,
  })
}

function readSelection(selections: MacroSelectionMap | undefined, canonicalName: string): MacroSelection | undefined {
  if (!selections) return undefined
  const exact = Object.entries(selections).find(([name]) => canonicalMacroName(name) === canonicalName)
  return exact?.[1]
}
