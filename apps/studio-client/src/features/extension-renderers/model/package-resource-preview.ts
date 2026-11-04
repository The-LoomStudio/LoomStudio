import { parseLoomScriptSource } from '@loom-studio/shared/loom-scripts'
import { summarizePackageResource, type PackageResourceSummary } from '@loom-studio/shared'
import type { ManagedExtensionPackage } from '../../../entities/extension.js'
import { createSessionFetch } from '../../../shared/api/session-fetch.js'

export type PackageResourceKind = 'preset' | 'lore' | 'prompt' | 'script' | 'tool' | 'rule' | 'extractor' | 'theme' | 'style' | 'background'
export type PackageResourceEntry = {
  id: string
  kind: PackageResourceKind
  label?: string
  description?: string
  source: string
  declaration: unknown
  parameters?: Array<{ label: string; default: string | number | boolean }>
}

export function packageResourceEntries(pkg: ManagedExtensionPackage): PackageResourceEntry[] {
  const resources = pkg.resources
  return [
    ...(resources?.promptResources ?? []).map(item => ({ id: item.id, kind: item.resourceKind === 'preset' || item.resourceKind === 'lore' ? item.resourceKind : 'prompt' as const, source: item.source, declaration: item })),
    ...(['script', 'tool', 'rule', 'extractor'] as const).flatMap(kind => {
      const entries = kind === 'script' ? resources?.loomScripts : kind === 'tool' ? resources?.agentTools
        : kind === 'rule' ? resources?.transformRules : resources?.textExtractors
      return (entries ?? []).map(item => ({ id: item.id, kind, source: item.source, declaration: item }))
    }),
    ...(['theme', 'style'] as const).flatMap(kind => (kind === 'theme' ? resources?.themes ?? [] : resources?.styles ?? [])
      .map(item => ({ id: item.id, kind, label: item.label, description: item.description, parameters: item.parameters, source: item.css, declaration: item }))),
    ...(resources?.backgrounds ?? []).map(item => ({ id: item.id, kind: 'background' as const, label: item.name, description: item.description, source: item.image, declaration: item })),
  ]
}

export function packageResourceUrl(pkg: ManagedExtensionPackage, path: string): string {
  const normalized = path.replace(/^\.\//, '')
  if (!normalized || normalized.startsWith('/') || normalized.split('/').some(part => !part || part === '..' || part === '.') || /[\\?#:]/.test(normalized) || normalized.includes('\0')) {
    throw new Error('Invalid package resource path')
  }
  const target = pkg.target
  if (target?.kind === 'card' && !pkg.archiveDigest) throw new Error('Card package archive digest is missing')
  const prefix = target?.kind === 'card' ? `/card-extensions/${encodeURIComponent(target.cardId)}` : '/extensions'
  const version = target?.kind === 'card' ? pkg.version : pkg.fileRevision ?? pkg.version
  return `${prefix}/${encodeURIComponent(pkg.packageId)}/${encodeURIComponent(version)}${target?.kind === 'card' ? `/${encodeURIComponent(pkg.archiveDigest!)}` : ''}/files/${normalized.split('/').map(encodeURIComponent).join('/')}`
}

const sessionFetch = createSessionFetch()
export async function readPackageResource(url: string, signal: AbortSignal): Promise<string> {
  const response = await sessionFetch(url, { signal })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.text()
}

export async function readPackageResourceSummary(url: string, kind: Exclude<PackageResourceKind, 'background'>, signal: AbortSignal): Promise<PackageResourceSummary> {
  const response = await sessionFetch(`${url}?preview=summary&kind=${encodeURIComponent(kind)}`, { signal })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json() as Promise<PackageResourceSummary>
}

type PreviewSection = { label: string; body?: string; source?: string }
export type ResourceFact = { kind: 'runtime' | 'capabilities' | 'parameters' | 'targets' | 'phases' | 'pattern' | 'effect' | 'strategy'; value: string }
export type PackageResourcePreview = PackageResourceSummary & { sections: PreviewSection[]; facts?: ResourceFact[]; source: string }

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid resource content')
  return value as Record<string, unknown>
}

export function previewPackageResource(entry: PackageResourceEntry, source: string): PackageResourcePreview {
  if (entry.kind === 'background') throw new Error('Background resources do not have a text preview')
  const summary = summarizePackageResource(entry.kind, source)
  if (entry.kind === 'script') {
    const metadata = parseLoomScriptSource(source)
    return { ...summary, facts: [{ kind: 'runtime', value: metadata.runtime }, ...(metadata.requestedCapabilities.length ? [{ kind: 'capabilities' as const, value: metadata.requestedCapabilities.join(' · ') }] : [])], sections: [], source }
  }
  if (entry.kind === 'theme' || entry.kind === 'style') return { ...summary, sections: [], source }
  const value = record(JSON.parse(source))
  if (entry.kind !== 'preset' && entry.kind !== 'lore' && entry.kind !== 'prompt') {
    const facts: ResourceFact[] = []
    for (const kind of ['targets', 'phases', 'strategy'] as const) {
      const field = value[kind]
      if (typeof field === 'string' || Array.isArray(field)) facts.push({ kind, value: Array.isArray(field) ? field.join(' · ') : field })
    }
    if (value.matcher) { const matcher = record(value.matcher); if (typeof matcher.pattern === 'string') facts.push({ kind: 'pattern', value: `/${matcher.pattern}/${matcher.flags ?? ''}` }) }
    if (value.effect) { const effect = record(value.effect); if (typeof effect.kind === 'string') facts.push({ kind: 'effect', value: effect.kind }) }
    const schema = value.inputSchema ?? value.parameters
    if (schema && typeof schema === 'object' && !Array.isArray(schema)) {
      const properties = (schema as Record<string, unknown>).properties
      if (properties && typeof properties === 'object') facts.push({ kind: 'parameters', value: Object.keys(properties).join(' · ') || '—' })
    }
    return { ...summary, facts, sections: [], source: JSON.stringify(value, null, 2) }
  }
  const files = value.schema === 'loom.promptResource.files.v1'
  const root = record(value.rootNode)
  const sections: PreviewSection[] = []
  function visit(raw: unknown, ancestors: string[], depth: number) {
    if (depth > 128) throw new Error('Prompt resource tree exceeds 128 levels')
    const node = record(raw)
    const meta = files ? record(node.metadata) : node
    const path = [...ancestors, typeof meta.label === 'string' ? meta.label : String(meta.id ?? '')]
    if (node.body !== undefined && typeof node.body !== 'string') throw new Error('Invalid prompt resource body')
    if (typeof node.body === 'string') sections.push({ label: path.join(' / '), ...(files
      ? { source: `${entry.source.slice(0, entry.source.lastIndexOf('/') + 1)}${node.body}` }
      : { body: node.body }) })
    if (node.children !== undefined) {
      if (!Array.isArray(node.children)) throw new Error('Invalid prompt resource children')
      node.children.forEach(child => visit(child, path, depth + 1))
    }
  }
  visit(root, [], 0)
  return { ...summary, sections, source }
}
