import { z } from 'zod'

export const rendererSurfaces = ['shell.background', 'narrative.entry.inline', 'narrative.timeline.tail', 'memory.panel', 'agent.message.inline', 'agent.session.tail', 'composer.sheet', 'shell.workspace-panel', 'shell.focus-surface', 'standalone.page'] as const
export const rendererInstanceScopes = ['workspace', 'timeline', 'agent-session', 'node', 'message'] as const
export const loomScriptRuntimeSchema = z.enum(['declarative', 'client-sandbox', 'client', 'client-worker', 'server'])
export type LoomScriptRuntime = z.infer<typeof loomScriptRuntimeSchema>
export const loomScriptSettingsSchema = z.record(z.string(), z.union([z.string(), z.number().finite(), z.boolean()]))
export type LoomScriptSettings = z.infer<typeof loomScriptSettingsSchema>
const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/)
const settingSchema = z.strictObject({
  key: identifier, label: z.string().trim().min(1), description: z.string().optional(),
  type: z.enum(['string', 'number', 'boolean', 'select']), default: z.union([z.string(), z.number().finite(), z.boolean()]),
  min: z.number().finite().optional(), max: z.number().finite().optional(),
  options: z.array(z.strictObject({ label: z.string().min(1), value: z.string() })).min(1).optional(),
})
export type LoomScriptSettingDefinition = z.infer<typeof settingSchema>

export function resolveLoomScriptSettings(definitions: readonly LoomScriptSettingDefinition[] = [], overrides: LoomScriptSettings = {}): LoomScriptSettings {
  const result: LoomScriptSettings = {}
  const keys = new Set(definitions.map(item => item.key))
  for (const key of Object.keys(overrides)) if (!keys.has(key)) throw new Error(`Unknown script setting: ${key}`)
  for (const definition of definitions) {
    const value = Object.hasOwn(overrides, definition.key) ? overrides[definition.key]! : definition.default
    const type = definition.type === 'select' ? 'string' : definition.type
    if (typeof value !== type) throw new Error(`Setting ${definition.key} must be ${type}`)
    if (typeof value === 'number' && (!Number.isFinite(value) || (definition.min !== undefined && value < definition.min) || (definition.max !== undefined && value > definition.max))) throw new Error(`Setting ${definition.key} is outside its allowed range`)
    if (definition.type === 'select' && !definition.options?.some(option => option.value === value)) throw new Error(`Setting ${definition.key} must be one of its options`)
    Object.defineProperty(result, definition.key, { value, enumerable: true, writable: true, configurable: true })
  }
  return result
}

const matcherSchema = z.strictObject({ kind: z.literal('regex'), pattern: z.string(), flags: z.string() })
export const scriptTextTransformRuleSchema = z.strictObject({
  name: z.string().trim().min(1), enabled: z.boolean(), orderIndex: z.number().int(), matcher: matcherSchema,
  effect: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('replace'), replacement: z.string() }),
    z.strictObject({ kind: z.literal('mark'), markerType: z.string().optional() }),
    z.strictObject({ kind: z.literal('promote-reasoning'), contentGroup: z.union([z.number().int().nonnegative(), z.string()]).optional(), visibility: z.enum(['collapsed', 'hidden', 'visible']), replay: z.enum(['omit', 'assistant-content']), dialect: z.string().optional() }),
  ]),
  targets: z.array(z.enum(['narrative', 'agent-session'])).min(1), phases: z.array(z.enum(['classify', 'prompt', 'display'])).min(1),
  range: z.strictObject({ minDepth: z.number().int().nonnegative().optional(), maxDepth: z.number().int().nonnegative().optional() }).optional(),
})
export const scriptTextExtractorSchema = z.strictObject({
  name: z.string().trim().min(1), enabled: z.boolean(), orderIndex: z.number().int(),
  targets: z.array(z.enum(['narrative', 'agent-session'])).min(1),
  matcher: matcherSchema.extend({ contentGroup: z.union([z.number().int().nonnegative(), z.string()]).optional() }),
  strategy: z.enum(['latest-valid', 'all-matches']), parser: z.enum(['text', 'key-value-lines']), artifactType: z.string().min(1).optional(), outputSchema: z.record(z.string(), z.json()).optional(),
})
export type ScriptTextTransformRule = z.infer<typeof scriptTextTransformRuleSchema>
export type ScriptTextExtractor = z.infer<typeof scriptTextExtractorSchema>
export type LoomScriptSettingReference = { $config: string; as?: 'literal' | 'raw' }
export type Configurable<T> = T extends string | number | boolean ? T | LoomScriptSettingReference : T extends Array<infer V> ? Configurable<V>[] : { [K in keyof T]: Configurable<T[K]> }
export type LoomScriptInput = { kind: 'match'; ruleId: string } | { kind: 'artifact'; artifactType: string }
export type LoomScriptRendererContributionDefinition = {
  kind: 'renderer'
  renderer: { id: string; name: string; surface: typeof rendererSurfaces[number]; instanceScope: typeof rendererInstanceScopes[number]; suggestedOrder?: number; fallback?: 'json' | 'text' | 'hidden' }
  inputs: LoomScriptInput[]
}
export type LoomScriptTextTransformContribution = { kind: 'text-transform'; id: string; rule: Configurable<ScriptTextTransformRule>; requiresCode?: boolean }
export type LoomScriptTextExtractorContribution = { kind: 'text-extractor'; id: string; extractor: Configurable<ScriptTextExtractor>; requiresCode?: boolean }
export type LoomScriptContributionDefinition = LoomScriptRendererContributionDefinition | LoomScriptTextTransformContribution | LoomScriptTextExtractorContribution
export type ParsedLoomScriptMetadata = {
  formatVersion: 1; metadataId: string; scriptVersion: string; name: string; runtime: LoomScriptRuntime
  requires?: string[]; contributions: LoomScriptContributionDefinition[]; requestedCapabilities: string[]
  settings?: LoomScriptSettingDefinition[]; tags?: string[]
}
export function loomScriptContributionId(contribution: LoomScriptContributionDefinition): string { return contribution.kind === 'renderer' ? contribution.renderer.id : contribution.id }

function resolveValues(value: unknown, settings: LoomScriptSettings, path: string[] = []): unknown {
  if (Array.isArray(value)) return value.map((item, index) => resolveValues(item, settings, [...path, String(index)]))
  if (!value || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  if (Object.hasOwn(record, '$config')) {
    const ref = z.strictObject({ $config: z.string(), as: z.enum(['literal', 'raw']).optional() }).parse(record)
    if (!Object.hasOwn(settings, ref.$config)) throw new Error(`Unknown script setting reference: ${ref.$config}`)
    const configured = settings[ref.$config]!
    if (typeof configured !== 'string' || ref.as === 'raw') return configured
    if (path.at(-1) === 'pattern') return configured.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (path.at(-1) === 'replacement') return configured.split('$').join('$$')
    return configured
  }
  return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, resolveValues(item, settings, [...path, key])]))
}
export function resolveTextTransformContributionRule(contribution: LoomScriptTextTransformContribution, settings: LoomScriptSettings = {}): ScriptTextTransformRule {
  const rule = scriptTextTransformRuleSchema.parse(resolveValues(contribution.rule, settings))
  validateMatcher(rule.matcher)
  if (rule.range?.maxDepth !== undefined && rule.range.maxDepth < (rule.range.minDepth ?? 0)) throw new Error('maxDepth must be at least minDepth')
  return rule
}
export function resolveTextExtractorContribution(contribution: LoomScriptTextExtractorContribution, settings: LoomScriptSettings = {}): ScriptTextExtractor {
  const extractor = scriptTextExtractorSchema.parse(resolveValues(contribution.extractor, settings))
  validateMatcher(extractor.matcher)
  return extractor
}
function validateMatcher(matcher: { pattern: string; flags: string }): void {
  if (/[^dgimsuvy]/.test(matcher.flags) || new Set(matcher.flags).size !== matcher.flags.length) throw new Error('Invalid regex flags')
  new RegExp(matcher.pattern, matcher.flags)
}

const headerStart = '// ==LoomScript=='
const headerEnd = '// ==/LoomScript=='
const singles = new Set(['format', 'id', 'name', 'version', 'runtime'])
const repeated = new Set(['capability', 'contribution', 'require', 'setting', 'tag'])
const capabilities = new Set(['state.read', 'state.write', 'state.contribute', 'state.processContent', 'ui.notify', 'macros.provide', 'prompt.process', 'narrative.context.provide', 'narrative.read', 'agent.tasks', 'vfs.provide', 'assets.read', 'assets.publish', 'ai.invoke', 'runtime.client', 'runtime.client-worker', 'runtime.server', 'events.subscribe:state', 'events.subscribe:narrative', 'events.subscribe:agent', 'events.subscribe:diagnostics', 'events.subscribe:platform-data', 'events.subscribe:documents'])
export function parseLoomScriptSource(source: string): ParsedLoomScriptMetadata {
  const lines = source.split(/\r?\n/)
  if (lines[0] !== headerStart) throw new Error('Loom Script Metadata must start on the first line')
  const end = lines.indexOf(headerEnd, 1)
  if (end < 0) throw new Error('Loom Script Metadata closing marker is missing')
  const fields = new Map<string, string[]>()
  const texts = new Map<string, string>()
  for (let index = 1; index < end; index++) {
    const line = lines[index]!
    if (!line.trim() || /^\/\/(?!\s*@)/.test(line)) continue
    const match = /^\/\/\s*@([a-z]+)\s+(.+)$/.exec(line)
    if (!match) throw new Error(`Invalid Loom Script Metadata line: ${index + 1}`)
    const key = match[1]!
    let value = match[2]!.trim()
    if (key === 'text') {
      const block = /^([A-Za-z0-9._-]+)\s+<<([A-Za-z0-9_]+)$/.exec(value)
      if (!block || texts.has(block[1]!)) throw new Error(`Invalid or duplicate @text at line ${index + 1}`)
      const content: string[] = []
      while (++index < end && lines[index] !== `// ${block[2]}`) {
        if (!lines[index]!.startsWith('//')) throw new Error(`Text block must stay inside a comment at line ${index + 1}`)
        content.push(lines[index]!.replace(/^\/\/ ?/, ''))
      }
      if (index >= end) throw new Error(`Unclosed @text block: ${block[1]}`)
      texts.set(block[1]!, content.join('\n'))
      continue
    }
    if (!singles.has(key) && !repeated.has(key)) throw new Error(`Unknown Loom Script Metadata field: @${key}`)
    const values = fields.get(key) ?? []
    if (singles.has(key) && values.length) throw new Error(`Duplicate Loom Script Metadata field: @${key}`)
    if (key === 'setting' || key === 'contribution') {
      // Multiline JSON remains a comment, and is parsed without evaluating code.
      while (true) {
        try { JSON.parse(value); break } catch {
          if (index + 1 >= end || !/^\/\/(?!\s*@)/.test(lines[index + 1]!)) throw new Error(`Invalid @${key} JSON near line ${index + 1}`)
          value += '\n' + lines[++index]!.replace(/^\/\/ ?/, '')
        }
      }
    }
    values.push(value); fields.set(key, values)
  }
  const required = (key: string) => { const value = fields.get(key)?.[0]; if (!value) throw new Error(`Missing Loom Script Metadata field: @${key}`); return value }
  if (required('format') !== '1') throw new Error('Unsupported Loom Script Metadata format')
  const metadataId = identifier.parse(required('id'))
  const name = required('name')
  const scriptVersion = z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/).parse(required('version'))
  const runtime = loomScriptRuntimeSchema.parse(fields.get('runtime')?.[0] ?? 'declarative')
  const settings = (fields.get('setting') ?? []).map(value => settingSchema.parse(JSON.parse(value)))
  if (new Set(settings.map(item => item.key)).size !== settings.length) throw new Error('Duplicate script setting key')
  for (const item of settings) {
    if (item.type !== 'number' && (item.min !== undefined || item.max !== undefined)) throw new Error(`Only numeric settings accept min/max: ${item.key}`)
    if (item.type === 'number' && item.min !== undefined && item.max !== undefined && item.min > item.max) throw new Error(`Invalid setting range: ${item.key}`)
    if (item.type === 'select' ? !item.options || new Set(item.options.map(option => option.value)).size !== item.options.length : item.options !== undefined) throw new Error(`Invalid setting options: ${item.key}`)
  }
  const defaults = resolveLoomScriptSettings(settings)
  const contributions = (fields.get('contribution') ?? []).map(value => parseContribution(expandTexts(JSON.parse(value), texts), defaults))
  const ids = contributions.map(loomScriptContributionId)
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate Loom Script contribution id')
  if ((runtime === 'server' || runtime === 'client-worker' || runtime === 'declarative') && contributions.some(item => item.kind === 'renderer')) throw new Error(`${runtime} scripts cannot declare client Renderers`)
  if (runtime === 'client-sandbox' && !contributions.some(item => item.kind === 'renderer')) throw new Error('Sandbox Renderer requires at least one @contribution')
  if (runtime === 'client-sandbox' && contributions.some(item => item.kind === 'renderer' && !item.inputs.length)) throw new Error('Sandbox Renderer requires inputs')
  if (runtime === 'declarative' && contributions.some(item => item.kind !== 'renderer' && item.requiresCode)) throw new Error('Declarative scripts cannot require code')
  // Reject accidental code in a declaration-only file instead of silently ignoring it.
  if (runtime === 'declarative' && lines.slice(end + 1).some(line => line.trim() && !/^\s*\/\//.test(line))) throw new Error('Declare @runtime to execute JavaScript')
  const requestedCapabilities = [...fields.get('capability') ?? []]
  if (requestedCapabilities.some(value => runtime === 'declarative' || (runtime === 'client-sandbox' ? value !== 'state.read' && value !== 'ui.notify' : !capabilities.has(value) && !/^events\.subscribe:extension:[A-Za-z0-9._-]+$/.test(value)))) throw new Error('Unsupported Loom Script capability')
  if (new Set(requestedCapabilities).size !== requestedCapabilities.length) throw new Error('Duplicate Loom Script capability')
  if (runtime !== 'client-sandbox' && runtime !== 'declarative' && !requestedCapabilities.includes(`runtime.${runtime}`)) requestedCapabilities.push(`runtime.${runtime}`)
  const requires = fields.get('require') ?? []
  if (runtime === 'declarative' && requires.length) throw new Error('Declarative scripts cannot load code dependencies')
  for (const dependency of requires) { const url = new URL(dependency); if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Script dependencies must use an HTTP(S) URL') }
  const tags = [...new Set((fields.get('tag') ?? []).map(value => value.normalize('NFKC').trim().toLowerCase()))]
  if (tags.some(tag => !tag || tag.length > 64)) throw new Error('Script tags must contain 1–64 characters')
  return { formatVersion: 1, metadataId, scriptVersion, name, runtime, contributions, requestedCapabilities,
    ...(requires.length ? { requires } : {}), ...(settings.length ? { settings } : {}), ...(tags.length ? { tags } : {}) }
}
function expandTexts(value: unknown, texts: Map<string, string>): unknown {
  if (Array.isArray(value)) return value.map(item => expandTexts(item, texts))
  if (!value || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  if (Object.hasOwn(record, '$text')) {
    if (Object.keys(record).length !== 1 || typeof record.$text !== 'string' || !texts.has(record.$text)) throw new Error('Invalid @text reference')
    return texts.get(record.$text)!
  }
  return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, expandTexts(item, texts)]))
}
function parseContribution(value: unknown, defaults: LoomScriptSettings): LoomScriptContributionDefinition {
  if (!value || typeof value !== 'object') throw new Error('Contribution must be an object')
  const kind = (value as { kind?: unknown }).kind
  if (kind === 'text-transform' || kind === 'text-extractor') {
    const parsed = z.strictObject({ kind: z.enum(['text-transform', 'text-extractor']), id: identifier,
      rule: z.record(z.string(), z.json()).optional(), extractor: z.record(z.string(), z.json()).optional(), requiresCode: z.boolean().optional(),
    }).parse(value)
    if (kind === 'text-transform') {
      if (!parsed.rule || parsed.extractor) throw new Error('Text transform requires only a rule definition')
      const result = parsed as LoomScriptTextTransformContribution
      resolveTextTransformContributionRule(result, defaults); return result
    }
    if (!parsed.extractor || parsed.rule) throw new Error('Text extractor requires only an extractor definition')
    const result = parsed as LoomScriptTextExtractorContribution
    resolveTextExtractorContribution(result, defaults); return result
  }
  const parsed = z.strictObject({ kind: z.literal('renderer'), id: identifier, name: z.string().trim().min(1).optional(), surface: z.enum(rendererSurfaces), scope: z.enum(rendererInstanceScopes), inputs: z.array(z.string()), suggestedOrder: z.number().int().optional(), fallback: z.enum(['json', 'text', 'hidden']).optional() }).parse(value)
  const inputs = parsed.inputs.map((input): LoomScriptInput => {
    const separator = input.indexOf(':'); const kind = input.slice(0, separator); const id = identifier.parse(input.slice(separator + 1))
    if (kind === 'match') return { kind, ruleId: id }
    if (kind === 'artifact') return { kind, artifactType: id }
    throw new Error(`Unsupported Loom Script contribution input: ${input}`)
  })
  return { kind: 'renderer', renderer: { id: parsed.id, name: parsed.name ?? parsed.id, surface: parsed.surface, instanceScope: parsed.scope, ...(parsed.suggestedOrder !== undefined ? { suggestedOrder: parsed.suggestedOrder } : {}), ...(parsed.fallback ? { fallback: parsed.fallback } : {}) }, inputs }
}
export function serializeLoomScriptMetadata(metadata: ParsedLoomScriptMetadata): string {
  const jsonLines = (key: string, value: unknown) => JSON.stringify(value, null, 2).split('\n').map((line, index) => `// ${index === 0 ? `@${key} ` : ''}${line}`)
  return [headerStart, '// @format 1', `// @id ${metadata.metadataId}`, `// @name ${metadata.name}`, `// @version ${metadata.scriptVersion}`, `// @runtime ${metadata.runtime}`,
    ...(metadata.tags ?? []).map(tag => `// @tag ${tag}`), ...(metadata.settings ?? []).flatMap(item => jsonLines('setting', item)),
    ...(metadata.requires ?? []).map(value => `// @require ${value}`), ...metadata.requestedCapabilities.map(value => `// @capability ${value}`),
    ...metadata.contributions.flatMap(item => jsonLines('contribution', item.kind === 'renderer' ? { kind: 'renderer', id: item.renderer.id, name: item.renderer.name, surface: item.renderer.surface, scope: item.renderer.instanceScope, inputs: item.inputs.map(input => input.kind === 'match' ? `match:${input.ruleId}` : `artifact:${input.artifactType}`), ...(item.renderer.suggestedOrder !== undefined ? { suggestedOrder: item.renderer.suggestedOrder } : {}), ...(item.renderer.fallback ? { fallback: item.renderer.fallback } : {}) } : item)), headerEnd].join('\n')
}
