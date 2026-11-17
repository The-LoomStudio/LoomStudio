import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { parseObject } from './tree.js'
import {
  PromptResourceStoreError,
  type PromptResourceSearchHeader,
  type PromptResourceSearchHit,
  type PromptResourceSearchPage,
  type SearchPromptResourceNodesInput,
} from './types.js'

const maximumQueryLength = 256
const maximumQueryTerms = 16
const maximumSearchLimit = 100
const maximumSnippetLength = 180

type SearchRow = {
  resource_id: string
  node_id: string
  resource_kind: PromptResourceSearchHit['resourceKind']
  resource_label: string
  label: string
  meta: string | null
  body: string | null
  path: string
  match_rank: number
}

export function initializeSearchFunctions(database: DatabaseSync): void {
  // SQLite lower() only folds ASCII; author text and short queries need the same Unicode casing.
  database.function('prompt_resource_search_lower', { deterministic: true }, value =>
    typeof value === 'string' ? value.toLowerCase() : '')
}

export function listSearchResources(database: DatabaseSync): Array<PromptResourceSearchHeader | { id: string; label: string; error: string }> {
  const rows = database.prepare(`
    SELECT id, resource_kind, label, root_node_id, metadata_json FROM prompt_resources
    WHERE tombstoned = 0 AND resource_kind IN ('lore', 'preset') ORDER BY id
  `).all() as Array<{
    id: string
    resource_kind: PromptResourceSearchHeader['resourceKind']
    label: string
    root_node_id: string
    metadata_json: string
  }>
  return rows.map(row => {
    try {
      return {
        id: row.id,
        resourceKind: row.resource_kind,
        label: row.label,
        rootNodeId: row.root_node_id,
        metadata: parseObject(row.metadata_json, 'metadata'),
      }
    } catch (error) {
      if (!(error instanceof PromptResourceStoreError) || error.code !== 'prompt_resource.json_invalid') throw error
      return { id: row.id, label: row.label, error: error.message }
    }
  })
}

export function searchNodes(database: DatabaseSync, input: SearchPromptResourceNodesInput): PromptResourceSearchPage {
  const limit = input.limit ?? 50
  if (!Number.isInteger(limit) || limit < 1 || limit > maximumSearchLimit) {
    throw new PromptResourceStoreError('prompt_resource.limit_invalid', `Search limit must be between 1 and ${maximumSearchLimit}`)
  }
  if (typeof input.query !== 'string' || Array.from(input.query).length > maximumQueryLength) {
    throw new PromptResourceStoreError('prompt_resource.search_invalid', `Search query must contain at most ${maximumQueryLength} characters`)
  }
  const terms = [...new Set(input.query.trim().toLowerCase().split(/\s+/u).filter(Boolean))]
  if (terms.length > maximumQueryTerms) {
    throw new PromptResourceStoreError('prompt_resource.search_invalid', `Search query must contain at most ${maximumQueryTerms} terms`)
  }
  const resourceIds = input.resourceIds === undefined ? undefined : [...new Set(input.resourceIds)].sort()
  const resourceKinds = [...new Set(input.resourceKinds ?? ['lore', 'preset'])].sort()
  if (resourceKinds.some(kind => kind !== 'lore' && kind !== 'preset')) {
    throw new PromptResourceStoreError('prompt_resource.search_invalid', 'Only Lore and Preset definitions are searchable')
  }
  const fingerprint = createHash('sha256').update(JSON.stringify(['node-fields', terms, resourceIds ?? null, resourceKinds])).digest('hex')
  const parameters: Record<string, string | number> = {
    query: terms.join(' '),
    resourceKinds: JSON.stringify(resourceKinds),
    limit: limit + 1,
  }
  const scopeClauses = ['r.tombstoned = 0', 'r.resource_kind IN (SELECT value FROM json_each($resourceKinds))']
  if (resourceIds !== undefined) {
    parameters.resourceIds = JSON.stringify(resourceIds)
    scopeClauses.push('r.id IN (SELECT value FROM json_each($resourceIds))')
  }
  let cursorClause = ''
  if (input.cursor !== undefined) {
    const cursor = readCursor(input.cursor, fingerprint)
    parameters.cursorRank = cursor[1]
    parameters.cursorResource = cursor[2]
    parameters.cursorNode = cursor[3]
    cursorClause = 'WHERE (match_rank, resource_id, node_id) > ($cursorRank, $cursorResource, $cursorNode)'
  }
  if (terms.length === 0 || resourceIds?.length === 0 || resourceKinds.length === 0) return { hits: [] }

  terms.forEach((term, index) => { parameters[`term${index}`] = `%${escapeLike(term)}%` })
  const contains = (field: string, index: number) => `prompt_resource_search_lower(${field}) LIKE $term${index} ESCAPE '\\'`
  const matchesAll = (fields: string[]) => terms.map((_, index) =>
    `(${fields.map(field => contains(field, index)).join(' OR ')})`).join(' AND ')
  const longTerms = terms.filter(term => Array.from(term).length >= 3)
  let candidateCtes: string
  if (longTerms.length > 0) {
    parameters.match = `{label meta body} : (${longTerms.map(term => `"${term.replaceAll('"', '""')}"`).join(' AND ')})`
    candidateCtes = `
      candidates AS (
        SELECT n.id FROM prompt_resource_node_search
        JOIN prompt_resource_nodes n ON n.rowid = prompt_resource_node_search.rowid
        JOIN scoped_resources r ON r.id = n.resource_id
        WHERE prompt_resource_node_search MATCH $match
      )`
  } else {
    // ponytail: FTS5 trigram cannot index 1–2 character terms. Keep literal substring scans
    // within the allowed definition resources; revisit only with evidence of short-query cost.
    candidateCtes = `candidates AS (
      SELECT n.id FROM prompt_resource_nodes n JOIN scoped_resources r ON r.id = n.resource_id
    )`
  }
  const rows = database.prepare(`
    WITH RECURSIVE scoped_resources AS (
      SELECT r.id, r.resource_kind, r.label FROM prompt_resources r WHERE ${scopeClauses.join(' AND ')}
    ),
    ${candidateCtes},
    ancestry(seed_id, id, parent_id, resource_id, path) AS (
      SELECT n.id, n.id, n.parent_id, n.resource_id, json_array(n.label)
      FROM candidates c JOIN prompt_resource_nodes n ON n.id = c.id
      UNION ALL
      SELECT a.seed_id, p.id, p.parent_id, p.resource_id,
        '[' || json_quote(p.label) || ',' || substr(a.path, 2)
      FROM ancestry a JOIN prompt_resource_nodes p ON p.id = a.parent_id AND p.resource_id = a.resource_id
    ),
    ranked AS (
      SELECT n.resource_id, n.id AS node_id, r.resource_kind, r.label AS resource_label,
        n.label, n.meta, n.body, a.path,
        CASE
          WHEN prompt_resource_search_lower(n.label) = $query THEN 0
          WHEN ${matchesAll(['n.label'])} THEN 1
          WHEN ${matchesAll(['n.label', 'n.meta'])} THEN 3
          ELSE 4
        END AS match_rank
      FROM ancestry a JOIN prompt_resource_nodes n ON n.id = a.seed_id
      JOIN scoped_resources r ON r.id = n.resource_id
      WHERE a.parent_id IS NULL AND ${matchesAll(['n.label', 'n.meta', 'n.body'])}
    )
    SELECT * FROM ranked ${cursorClause}
    ORDER BY match_rank, resource_id, node_id LIMIT $limit
  `).all(parameters) as SearchRow[]
  const selected = rows.slice(0, limit)
  const last = selected.at(-1)
  return {
    hits: selected.map(row => {
      const path = JSON.parse(row.path) as string[]
      const matchField = row.match_rank < 2 ? 'label' : row.match_rank === 3 ? 'meta' : 'body'
      const text = matchField === 'body' ? row.body ?? ''
        : matchField === 'meta' ? row.meta ?? '' : row.label
      return {
        resourceId: row.resource_id,
        nodeId: row.node_id,
        resourceKind: row.resource_kind,
        resourceLabel: row.resource_label,
        label: row.label,
        path,
        snippet: makeSnippet(text, terms),
        matchField,
        rank: row.match_rank,
      }
    }),
    nextCursor: rows.length > limit && last
      ? JSON.stringify([fingerprint, last.match_rank, last.resource_id, last.node_id]) : undefined,
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, character => `\\${character}`)
}

function readCursor(value: string, fingerprint: string): [string, number, string, string] {
  let cursor: unknown
  try { cursor = JSON.parse(value) } catch {
    throw new PromptResourceStoreError('prompt_resource.cursor_invalid', 'Invalid search cursor')
  }
  if (!Array.isArray(cursor) || cursor.length !== 4 || cursor[0] !== fingerprint
    || !Number.isInteger(cursor[1]) || cursor[1] < 0 || cursor[1] > 4
    || typeof cursor[2] !== 'string' || typeof cursor[3] !== 'string') {
    throw new PromptResourceStoreError('prompt_resource.cursor_invalid', 'Search cursor is invalid or belongs to different filters')
  }
  return cursor as [string, number, string, string]
}

function makeSnippet(text: string, terms: string[]): string {
  const normalized = text.replace(/\s+/gu, ' ').trim()
  const lower = normalized.toLowerCase()
  const offsets = terms.map(term => lower.indexOf(term)).filter(offset => offset >= 0)
  const first = offsets.length > 0 ? Math.min(...offsets) : 0
  const characters = Array.from(normalized)
  const matchIndex = Array.from(normalized.slice(0, first)).length
  const start = Math.max(0, matchIndex - 40)
  const length = maximumSnippetLength - (start > 0 ? 1 : 0)
  const end = Math.min(characters.length, start + length)
  const suffix = end < characters.length ? '…' : ''
  return `${start > 0 ? '…' : ''}${characters.slice(start, end - suffix.length).join('')}${suffix}`
}

// Browse a single definition in directory order without selecting its body text.
export function listSearchNodes(database: DatabaseSync, input: { resourceId: string; limit?: number; cursor?: string }): PromptResourceSearchPage {
  const limit = input.limit ?? 30
  if (!Number.isInteger(limit) || limit < 1 || limit > maximumSearchLimit) {
    throw new PromptResourceStoreError('prompt_resource.limit_invalid', `Search limit must be between 1 and ${maximumSearchLimit}`)
  }
  const fingerprint = createHash('sha256').update(JSON.stringify(['directory', input.resourceId])).digest('hex')
  const after = input.cursor ? readCursor(input.cursor, fingerprint)[3] : ''
  const rows = database.prepare(`
    WITH RECURSIVE ordered AS (
      SELECT id, parent_id, kind, label,
        row_number() OVER (PARTITION BY parent_id ORDER BY order_index, id) AS position
      FROM prompt_resource_nodes WHERE resource_id = $resourceId
    ), directory AS (
      SELECT n.id, n.kind, n.label, json_array(n.label) AS path, '' AS sort_path
      FROM ordered n WHERE n.parent_id IS NULL
      UNION ALL
      SELECT n.id, n.kind, n.label, json_insert(d.path, '$[#]', n.label),
        d.sort_path || '/' || printf('%020d', n.position)
      FROM ordered n JOIN directory d ON n.parent_id = d.id
    )
    SELECT d.*, r.label AS resource_label, r.resource_kind
    FROM directory d JOIN prompt_resources r ON r.id = $resourceId
    WHERE r.tombstoned = 0 AND r.resource_kind IN ('lore', 'preset')
      AND d.kind NOT IN ('module', 'folder', 'slot') AND d.sort_path > $after
    ORDER BY d.sort_path LIMIT $limit
  `).all({ resourceId: input.resourceId, after, limit: limit + 1 }) as Array<{
    id: string; label: string; path: string; sort_path: string; resource_label: string; resource_kind: PromptResourceSearchHit['resourceKind']
  }>
  const selected = rows.slice(0, limit)
  const last = selected.at(-1)
  return {
    hits: selected.map(row => ({ resourceId: input.resourceId, nodeId: row.id, resourceKind: row.resource_kind,
      resourceLabel: row.resource_label, label: row.label, path: JSON.parse(row.path) as string[],
      snippet: '', matchField: 'label', rank: 0 })),
    ...(rows.length > limit && last ? { nextCursor: JSON.stringify([fingerprint, 0, input.resourceId, last.sort_path]) } : {}),
  }
}
