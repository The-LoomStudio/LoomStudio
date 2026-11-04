import { parseLoomScriptSource } from './loom-script-metadata.js'

export const packageResourceSummaryKinds = ['preset', 'lore', 'prompt', 'script', 'tool', 'rule', 'extractor', 'theme', 'style'] as const
export type PackageResourceSummaryKind = typeof packageResourceSummaryKinds[number]
export type PackageResourceSummary = { title?: string; description?: string; swatches?: string[] }

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid resource content')
  return value as Record<string, unknown>
}

/** List-card metadata only. Parsing script metadata never executes its source. */
export function summarizePackageResource(kind: PackageResourceSummaryKind, source: string): PackageResourceSummary {
  if (kind === 'script') return { title: parseLoomScriptSource(source).name }
  if (kind === 'theme' || kind === 'style') return {
    swatches: [...new Set([...source.matchAll(/--loom-color-(?:background|surface|text|accent):\s*(#[a-fA-F0-9]{3,8})\s*;/g)].map(match => match[1]!))],
  }
  const value = record(JSON.parse(source))
  if (kind === 'preset' || kind === 'lore' || kind === 'prompt') {
    const root = record(value.rootNode)
    const metadata = value.schema === 'loom.promptResource.files.v1' ? record(root.metadata) : root
    return {
      title: typeof metadata.label === 'string' ? metadata.label : undefined,
      description: typeof metadata.meta === 'string' ? metadata.meta : undefined,
    }
  }
  return {
    title: typeof value.name === 'string' ? value.name : undefined,
    description: typeof value.description === 'string' ? value.description : undefined,
  }
}
