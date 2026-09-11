import type { RendererContributionDefinition, RendererInstanceScope, RendererSurface } from '@loom-studio/extension-sdk'
import type {
  LoomScriptContent,
  LoomScriptContributionDefinition,
  LoomScriptInput,
} from './loom-script-contracts.js'

const headerStart = '// ==LoomScript=='
const headerEnd = '// ==/LoomScript=='
const metadataIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const versionPattern = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const surfaces = new Set<RendererSurface>([
  'shell.background',
  'narrative.entry.inline',
  'narrative.timeline.tail',
  'agent.message.inline',
  'agent.session.tail',
  'composer.sheet',
  'shell.workspace-panel',
  'shell.focus-surface',
  'standalone.page',
])
const scopes = new Set<RendererInstanceScope>(['workspace', 'timeline', 'agent-session', 'node', 'message'])
const singleFields = new Set(['format', 'id', 'name', 'version', 'runtime'])
const repeatableFields = new Set(['capability', 'contribution'])

export type ParsedLoomScriptMetadata = Pick<
  LoomScriptContent,
  'formatVersion' | 'metadataId' | 'scriptVersion' | 'name' | 'runtime' | 'contributions' | 'requestedCapabilities'
>

export function parseLoomScriptSource(source: string): ParsedLoomScriptMetadata {
  const lines = source.split(/\r?\n/)
  if (lines[0] !== headerStart) throw new Error('Loom Script Metadata must start on the first line')
  const endIndex = lines.indexOf(headerEnd, 1)
  if (endIndex < 0) throw new Error('Loom Script Metadata closing marker is missing')

  const values = new Map<string, string[]>()
  for (let index = 1; index < endIndex; index += 1) {
    const line = lines[index]!
    const match = /^\/\/ @([a-z]+)\s+(.+)$/.exec(line)
    if (!match) throw new Error(`Invalid Loom Script Metadata line: ${index + 1}`)
    const key = match[1]!
    const rawValue = match[2]!
    if (!singleFields.has(key) && !repeatableFields.has(key)) {
      throw new Error(`Unknown Loom Script Metadata field: @${key}`)
    }
    const list = values.get(key) ?? []
    if (singleFields.has(key) && list.length > 0) throw new Error(`Duplicate Loom Script Metadata field: @${key}`)
    list.push(rawValue.trim())
    values.set(key, list)
  }

  const format = requiredSingle(values, 'format')
  if (format !== '1') throw new Error(`Unsupported Loom Script Metadata format: ${format}`)
  const metadataId = requiredSingle(values, 'id')
  if (!metadataIdPattern.test(metadataId)) throw new Error(`Invalid Loom Script Metadata id: ${metadataId}`)
  const name = requiredSingle(values, 'name')
  const scriptVersion = requiredSingle(values, 'version')
  if (!versionPattern.test(scriptVersion)) throw new Error(`Invalid Loom Script version: ${scriptVersion}`)
  const runtime = requiredSingle(values, 'runtime')
  if (runtime !== 'client-sandbox') throw new Error(`Unsupported Loom Script runtime: ${runtime}`)
  const contributionValues = values.get('contribution') ?? []
  if (contributionValues.length === 0) throw new Error('Loom Script Metadata requires at least one @contribution')
  const contributions = contributionValues.map((value, index) => parseContribution(value, index))
  const contributionIds = new Set<string>()
  for (const contribution of contributions) {
    if (contributionIds.has(contribution.renderer.id)) {
      throw new Error(`Duplicate Loom Script contribution id: ${contribution.renderer.id}`)
    }
    contributionIds.add(contribution.renderer.id)
  }
  const requestedCapabilities = values.get('capability') ?? []
  if (requestedCapabilities.some(capability => capability !== 'state.read')) {
    throw new Error('Unsupported Loom Script capability')
  }
  if (new Set(requestedCapabilities).size !== requestedCapabilities.length) {
    throw new Error('Duplicate Loom Script capability')
  }

  return {
    formatVersion: 1,
    metadataId,
    scriptVersion,
    name,
    runtime: 'client-sandbox',
    contributions,
    requestedCapabilities,
  }
}

export function serializeLoomScriptMetadata(metadata: ParsedLoomScriptMetadata): string {
  return [
    headerStart,
    '// @format       1',
    `// @id           ${metadata.metadataId}`,
    `// @name         ${metadata.name}`,
    `// @version      ${metadata.scriptVersion}`,
    '// @runtime      client-sandbox',
    ...metadata.requestedCapabilities.map(value => `// @capability   ${value}`),
    ...metadata.contributions.map(contribution => `// @contribution ${JSON.stringify(toContributionJson(contribution))}`),
    headerEnd,
  ].join('\n')
}

function requiredSingle(values: Map<string, string[]>, key: string): string {
  const value = values.get(key)?.[0]
  if (!value) throw new Error(`Missing Loom Script Metadata field: @${key}`)
  return value
}

function parseContribution(value: string, index: number): LoomScriptContributionDefinition {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error(`Invalid Loom Script contribution JSON: ${index}`)
  }
  if (!isRecord(parsed)) throw new Error(`Loom Script contribution must be an object: ${index}`)
  const allowed = new Set(['kind', 'id', 'name', 'surface', 'scope', 'inputs', 'suggestedOrder', 'fallback'])
  const unknown = Object.keys(parsed).find(key => !allowed.has(key))
  if (unknown) throw new Error(`Unknown Loom Script contribution field: ${unknown}`)
  if (parsed.kind !== 'renderer') throw new Error(`Unsupported Loom Script contribution kind: ${String(parsed.kind)}`)
  if (typeof parsed.id !== 'string' || !metadataIdPattern.test(parsed.id)) throw new Error(`Invalid Loom Script contribution id: ${index}`)
  if (typeof parsed.surface !== 'string' || !surfaces.has(parsed.surface as RendererSurface)) throw new Error(`Invalid Loom Script contribution surface: ${index}`)
  if (typeof parsed.scope !== 'string' || !scopes.has(parsed.scope as RendererInstanceScope)) throw new Error(`Invalid Loom Script contribution scope: ${index}`)
  if (!Array.isArray(parsed.inputs) || parsed.inputs.length === 0) throw new Error(`Invalid Loom Script contribution inputs: ${index}`)
  const inputs = parsed.inputs.map((input, inputIndex) => parseInput(input, index, inputIndex))
  if (parsed.name !== undefined && (typeof parsed.name !== 'string' || !parsed.name.trim())) throw new Error(`Invalid Loom Script contribution name: ${index}`)
  if (parsed.suggestedOrder !== undefined && (!Number.isSafeInteger(parsed.suggestedOrder))) throw new Error(`Invalid Loom Script contribution suggestedOrder: ${index}`)
  if (parsed.fallback !== undefined && parsed.fallback !== 'json' && parsed.fallback !== 'text' && parsed.fallback !== 'hidden') {
    throw new Error(`Invalid Loom Script contribution fallback: ${index}`)
  }
  const renderer: Omit<RendererContributionDefinition, 'adapter' | 'artifactType'> = {
    id: parsed.id,
    name: typeof parsed.name === 'string' ? parsed.name : parsed.id,
    surface: parsed.surface as RendererSurface,
    instanceScope: parsed.scope as RendererInstanceScope,
    ...(typeof parsed.suggestedOrder === 'number' ? { suggestedOrder: parsed.suggestedOrder } : {}),
    ...(parsed.fallback ? { fallback: parsed.fallback } : {}),
  }
  return { kind: 'renderer', renderer, inputs }
}

function parseInput(value: unknown, contributionIndex: number, inputIndex: number): LoomScriptInput {
  if (typeof value !== 'string') throw new Error(`Invalid Loom Script contribution input: ${contributionIndex}.${inputIndex}`)
  const separator = value.indexOf(':')
  const kind = value.slice(0, separator)
  const id = value.slice(separator + 1)
  if (separator < 1 || !metadataIdPattern.test(id)) throw new Error(`Invalid Loom Script contribution input: ${value}`)
  if (kind === 'match') return { kind: 'match', ruleId: id }
  if (kind === 'artifact') return { kind: 'artifact', artifactType: id }
  throw new Error(`Unsupported Loom Script contribution input: ${value}`)
}

function toContributionJson(contribution: LoomScriptContributionDefinition): Record<string, unknown> {
  return {
    kind: 'renderer',
    id: contribution.renderer.id,
    ...(contribution.renderer.name !== contribution.renderer.id ? { name: contribution.renderer.name } : {}),
    surface: contribution.renderer.surface,
    scope: contribution.renderer.instanceScope,
    inputs: contribution.inputs.map(input => input.kind === 'match' ? `match:${input.ruleId}` : `artifact:${input.artifactType}`),
    ...(contribution.renderer.suggestedOrder !== undefined ? { suggestedOrder: contribution.renderer.suggestedOrder } : {}),
    ...(contribution.renderer.fallback !== undefined ? { fallback: contribution.renderer.fallback } : {}),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
