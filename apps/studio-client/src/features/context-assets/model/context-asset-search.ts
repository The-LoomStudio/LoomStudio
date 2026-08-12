import type { ContextAssetNode } from '../../../entities/index.js'

export type ContextAssetSearchRecord = {
  body: string
  id: string
  kind: ContextAssetNode['kind']
  label: string
  meta: string
  node: ContextAssetNode
  path: string
  searchableText: string
}

type ContextAssetSearchResult = ContextAssetSearchRecord & {
  excerpt?: string
  rank: number
}

export function buildContextAssetSearchIndex(nodes: ContextAssetNode[]): ContextAssetSearchRecord[] {
  const records: ContextAssetSearchRecord[] = []

  function visit(node: ContextAssetNode, ancestors: string[]) {
    const pathParts = [...ancestors, node.label]
    const path = pathParts.join(' / ')
    const body = node.body ?? ''
    const meta = node.meta ?? ''
    records.push({
      body,
      id: node.id,
      kind: node.kind,
      label: node.label,
      meta,
      node,
      path,
      searchableText: normalizeSearchText([node.label, path, meta, body].join('\n')),
    })
    node.children?.forEach(child => visit(child, pathParts))
  }

  nodes.forEach(node => visit(node, []))
  return records
}

export function searchContextAssets(index: ContextAssetSearchRecord[], rawQuery: string): ContextAssetSearchResult[] {
  const query = normalizeSearchText(rawQuery)
  if (!query) return []
  const tokens = query.split(/\s+/).filter(Boolean)

  return index
    .filter(record => tokens.every(token => record.searchableText.includes(token)))
    .map(record => ({
      ...record,
      excerpt: readSearchExcerpt(record.body, tokens),
      rank: readSearchRank(record, query),
    }))
    .sort((left, right) => left.rank - right.rank || left.path.localeCompare(right.path))
}

function readSearchRank(record: ContextAssetSearchRecord, query: string): number {
  const label = normalizeSearchText(record.label)
  if (label === query) return 0
  if (label.startsWith(query)) return 1
  if (label.includes(query)) return 2
  if (normalizeSearchText(record.path).includes(query)) return 3
  if (normalizeSearchText(record.meta).includes(query)) return 4
  return 5
}

function readSearchExcerpt(body: string, tokens: string[]): string | undefined {
  if (!body) return undefined
  const normalizedBody = normalizeSearchText(body)
  const matchIndex = tokens.reduce((nearest, token) => {
    const index = normalizedBody.indexOf(token)
    return index < 0 ? nearest : Math.min(nearest, index)
  }, Number.POSITIVE_INFINITY)
  if (!Number.isFinite(matchIndex)) return undefined

  const start = Math.max(0, matchIndex - 32)
  const end = Math.min(body.length, matchIndex + 88)
  return `${start > 0 ? '…' : ''}${body.slice(start, end).replace(/\s+/g, ' ').trim()}${end < body.length ? '…' : ''}`
}

function normalizeSearchText(value: string): string {
  return value.trim().toLocaleLowerCase()
}
