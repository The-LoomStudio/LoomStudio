import { createHash } from 'node:crypto'
import type { PromptResourceStore } from '../data/index.js'
import type { DocumentRecord } from '@loom-studio/kernel/document-store'
import {
  isRecord,
  listGlobalSearchScopesInputSchema,
  searchResourcesInputSchema,
  type GlobalSearchHit,
  type GlobalSearchScope,
  type ListGlobalSearchScopesInput,
  type ListGlobalSearchScopesResult,
  type SearchResourcesInput,
  type SearchResourcesResult,
  type SearchScopeOption,
} from '@loom-studio/shared'
import type { ApplicationRuntimeContext } from '../foundation/application-context.js'
import { applicationDocumentTypes } from '../foundation/document-types.js'
import { listDocuments } from '../foundation/document-store.js'
import { collectPages } from '../foundation/pagination.js'
import type { CardSourceContent, ExtensionInstallationContent } from '../types.js'

type SearchContext = Pick<ApplicationRuntimeContext, 'documents' | 'promptResources' | 'agents' | 'narratives'>
type ResourceHeader = Exclude<Awaited<ReturnType<PromptResourceStore['listSearchResources']>>[number], { error: string }>
type PromptHit = Awaited<ReturnType<PromptResourceStore['searchNodes']>>['hits'][number]
type Installation = DocumentRecord<ExtensionInstallationContent>
type SearchCatalog = {
  cards: Map<string, DocumentRecord<CardSourceContent>>
  installations: Map<string, Installation>
  resources: ResourceHeader[]
  diagnostics?: SearchResourcesResult['diagnostics']
}
type Ranked<T> = { value: T; rank: number; key: string }

type SearchCursor = {
  version: 1
  fingerprint: string
  after?: [number, string]
  promptCursor?: string
  promptDone?: boolean
}

export function createSearchRuntimeMethods(ctx: SearchContext) {
  return {
    searchResources: async (rawInput: SearchResourcesInput): Promise<SearchResourcesResult> => {
      const input = searchResourcesInputSchema.parse(rawInput)
      const query = normalizeQuery(input.query)
      const limit = input.limit ?? 30
      const catalog = await readCatalog(ctx)
      const resources = await scopedResources(ctx, catalog, input.scope)
      if (!query) return { ...await browseResources(ctx, catalog, resources, input), ...(catalog.diagnostics ? { diagnostics: catalog.diagnostics } : {}) }
      const resourceIds = resources.map(resource => resource.id).sort()
      const fingerprint = hash(['resources', query, input.scope ?? null, input.kind ?? null, resourceIds])
      const cursor = readCursor(input.cursor, fingerprint)

      const metadata = (await searchMetadata(ctx, catalog, input, query))
        .filter(item => isAfter(item, cursor.after))
        .sort(compareRanked)
      const promptEnabled = !input.kind || input.kind === 'lore' || input.kind === 'preset'
      const promptInput = {
        query,
        resourceIds,
        ...(input.kind === 'lore' || input.kind === 'preset' ? { resourceKinds: [input.kind] } : {}),
        limit,
        ...(cursor.promptCursor ? { cursor: cursor.promptCursor } : {}),
      }
      const promptPage = promptEnabled && !cursor.promptDone
        ? await ctx.promptResources.searchNodes(promptInput)
        : { hits: [], nextCursor: undefined }
      const promptItems = promptPage.hits.map(hit => ({
        value: toPromptHit(hit, catalog), rank: hit.rank, key: `${hit.resourceId}\0${hit.nodeId}`,
      }))
      // Both sources rank exact titles first. On a tie, directory titles precede node hits;
      // each source keeps its own stable identity order and continuation position.
      const merged = [
        ...metadata.slice(0, limit).map(item => ({ ...item, source: 'metadata' as const })),
        ...promptItems.map(item => ({ ...item, source: 'prompt' as const })),
      ].sort((left, right) => left.rank - right.rank
        || compareText(left.source, right.source)
        || (left.source === 'metadata' ? compareText(left.key, right.key) : 0)).slice(0, limit)
      const consumedMetadata = merged.filter(item => item.source === 'metadata')
      const consumedPrompt = merged.filter(item => item.source === 'prompt').length
      const lastMetadata = consumedMetadata.at(-1)
      const next: SearchCursor = {
        version: 1, fingerprint,
        ...(lastMetadata ? { after: [lastMetadata.rank, lastMetadata.key] } : cursor.after ? { after: cursor.after } : {}),
        ...(cursor.promptCursor ? { promptCursor: cursor.promptCursor } : {}),
        promptDone: cursor.promptDone || !promptEnabled,
      }
      if (consumedPrompt === promptPage.hits.length && !cursor.promptDone) {
        next.promptCursor = promptPage.nextCursor
        next.promptDone = !promptPage.nextCursor
      } else if (consumedPrompt > 0) {
        // Ask the Store for the consumed boundary instead of copying its cursor format
        // or embedding unconsumed snippets into an ever-growing Runtime cursor.
        const consumed = await ctx.promptResources.searchNodes({ ...promptInput, limit: consumedPrompt })
        next.promptCursor = consumed.nextCursor
        next.promptDone = !consumed.nextCursor
      }
      const hasMore = metadata.length > consumedMetadata.length || !next.promptDone
      return {
        items: merged.map(item => item.value),
        ...(catalog.diagnostics ? { diagnostics: catalog.diagnostics } : {}),
        ...(hasMore ? { nextCursor: encodeCursor(next) } : {}),
      }
    },

    listGlobalSearchScopes: async (rawInput: ListGlobalSearchScopesInput): Promise<ListGlobalSearchScopesResult> => {
      const input = listGlobalSearchScopesInputSchema.parse(rawInput)
      const query = normalizeQuery(input.query)
      const limit = input.limit ?? 30
      const catalog = await readCatalog(ctx)
      const enabledResources = await readEnabledResources(ctx, catalog, input)
      const fingerprint = hash(['scopes', query, input.currentCardId, input.currentPresetId, [...enabledResources].sort()])
      const cursor = readCursor(input.cursor, fingerprint)
      const options: SearchScopeOption[] = [
        ...[...catalog.cards.values()].map(card => ({
          kind: 'card' as const, id: card.id, label: card.content.name,
          description: card.content.description || card.id,
        })),
        ...catalog.resources.filter(resource => resource.resourceKind === 'lore').map(resource => {
          const source = resourceSource(resource, catalog)
          return { kind: 'resource' as const, id: resource.id, label: resource.label,
            ...(source ? { sources: [source] } : { description: resource.id }) }
        }),
        ...[...new Set([...catalog.installations.values()].map(installation => installation.content.packageId))]
          .map(packageId => ({
            kind: 'extension' as const, id: packageId, label: packageId,
            sources: [...catalog.installations.values()]
              .filter(installation => installation.content.packageId === packageId)
              .map(installation => installationSource(installation, catalog)),
          })),
      ]
      const matches = options.flatMap(value => {
        const rank = matchRank(query, value.label, [value.description,
          ...(value.sources ?? []).flatMap(source => [source.packageId, source.cardName]),
        ].filter(Boolean).join(' '))
        const priority = value.kind === 'card' && value.id === input.currentCardId ? 0
          : value.kind === 'resource' && enabledResources.has(value.id) ? 1 : 2
        return rank === undefined ? [] : [{ value, rank: priority * 5 + rank, key: `${value.kind}:${value.id}` }]
      }).filter(item => isAfter(item, cursor.after)).sort(compareRanked)
      const items = matches.slice(0, limit)
      const last = items.at(-1)
      return {
        ...(catalog.diagnostics ? { diagnostics: catalog.diagnostics } : {}),
        items: items.map(item => ({ ...item.value, ...(item.value.description
          ? { description: matchingSnippet(item.value.description, query) } : {}) })),
        ...(matches.length > limit && last ? {
          nextCursor: encodeCursor({ version: 1, fingerprint, after: [last.rank, last.key] }),
        } : {}),
      }
    },
  }
}

async function readEnabledResources(ctx: SearchContext, catalog: SearchCatalog, input: { currentCardId?: string; currentPresetId?: string }): Promise<Set<string>> {
  const preset = catalog.resources.find(resource => resource.id === input.currentPresetId && resource.resourceKind === 'preset')
  const enabledResources = new Set(preset?.metadata.useCardLore === false ? []
    : catalog.cards.get(input.currentCardId ?? '')?.content.promptResourceIds ?? [])
  for (const mount of await ctx.promptResources.listLoreMounts()) {
    if (mount.source.kind === 'manual'
      ? mount.source.id !== 'global' || preset?.metadata.useGlobalLore === false
      : mount.source.id !== preset?.id) continue
    if (mount.resolvedLoreResourceId !== null) enabledResources.add(mount.resolvedLoreResourceId ?? mount.loreResourceId)
  }
  if (preset) enabledResources.add(preset.id)
  return enabledResources
}

async function browseResources(ctx: SearchContext, catalog: SearchCatalog, resources: ResourceHeader[], input: SearchResourcesInput): Promise<SearchResourcesResult> {
  if (!input.scope && !input.kind) return { items: [] }
  const limit = input.limit ?? 30
  const enabledResources = await readEnabledResources(ctx, catalog, input)
  const fingerprint = hash(['browse', input.scope ?? null, input.kind ?? null,
    input.currentCardId, input.currentPresetId, resources.map(resource => resource.id).sort(), [...enabledResources].sort()])
  const cursor = readCursor(input.cursor, fingerprint)
  if (input.scope?.kind === 'resource') {
    if (input.kind && input.kind !== 'lore') return { items: [] }
    const page = await ctx.promptResources.listSearchNodes({ resourceId: input.scope.id, limit, cursor: cursor.promptCursor })
    return { items: page.hits.map(hit => toPromptHit(hit, catalog)),
      ...(page.nextCursor ? { nextCursor: encodeCursor({ version: 1, fingerprint, promptCursor: page.nextCursor }) } : {}) }
  }
  const items: GlobalSearchHit[] = resources
    .filter(resource => !input.kind || resource.resourceKind === input.kind)
    .map(resource => ({ id: `resource:${resource.id}:${resource.rootNodeId}`,
      kind: resource.resourceKind, title: resource.label, path: [],
      target: { type: 'resource', resourceId: resource.id, nodeId: resource.rootNodeId, resourceKind: resource.resourceKind },
      source: resourceSource(resource, catalog) }))
  if (input.kind === 'card' || input.kind === 'timeline' || input.kind === 'session') {
    items.push(...(await searchMetadata(ctx, catalog, input, '')).map(item => item.value))
  }
  const ranked = items.map(value => ({ value,
    rank: value.target.type === 'resource' && enabledResources.has(value.target.resourceId)
      || value.target.type === 'card' && value.target.cardId === input.currentCardId ? 0 : 1,
    key: `${value.title.toLowerCase()}\0${value.id}`,
  })).filter(item => isAfter(item, cursor.after)).sort(compareRanked)
  const page = ranked.slice(0, limit)
  const last = page.at(-1)
  return { items: page.map(item => item.value),
    ...(ranked.length > limit && last ? { nextCursor: encodeCursor({ version: 1, fingerprint, after: [last.rank, last.key] }) } : {}) }
}

async function readCatalog(ctx: SearchContext): Promise<SearchCatalog> {
  const [cards, installations, resources] = await Promise.all([
    listDocuments<CardSourceContent>(ctx.documents, applicationDocumentTypes.cardSource),
    listDocuments<ExtensionInstallationContent>(ctx.documents, applicationDocumentTypes.extensionInstallation),
    ctx.promptResources.listSearchResources(),
  ])
  const cardMap = new Map(cards.map(card => [card.id, card]))
  const installationMap = new Map(installations
    .filter(installation => installation.content.target.kind === 'global'
      || cardMap.has(installation.content.target.cardId))
    .map(installation => [installation.id, installation]))
  const diagnostics = resources.flatMap(resource => 'error' in resource ? [{ resourceId: resource.id, message: `${resource.label}: ${resource.error}` }] : [])
  return {
    ...(diagnostics.length ? { diagnostics } : {}),
    cards: cardMap,
    installations: installationMap,
    resources: resources.filter((resource): resource is ResourceHeader => !('error' in resource)).filter(resource => {
      const origin = resource.metadata.origin
      if (!isRecord(origin) || origin.kind !== 'extension-package') return true
      return typeof origin.installationId === 'string'
        && installationMap.get(origin.installationId)?.content.packageId === origin.packageId
    }),
  }
}

async function scopedResources(ctx: SearchContext, catalog: SearchCatalog, scope?: GlobalSearchScope): Promise<ResourceHeader[]> {
  if (!scope) return catalog.resources
  if (scope.kind === 'resource') {
    const resource = catalog.resources.find(resource => resource.id === scope.id && resource.resourceKind === 'lore')
    if (!resource) throw scopeUnavailable()
    return [resource]
  }
  if (scope.kind === 'extension') {
    if (![...catalog.installations.values()].some(installation => installation.content.packageId === scope.id)) throw scopeUnavailable()
    return catalog.resources.filter(resource => resourceSource(resource, catalog)?.packageId === scope.id)
  }
  const card = catalog.cards.get(scope.id)
  if (!card) throw scopeUnavailable()
  const externalIds = new Set(card.content.externalPromptResourceIds ?? [])
  const boundIds = new Set(card.content.promptResourceIds ?? [])
  const available = catalog.resources.filter(resource => {
    const source = resourceSource(resource, catalog)
    return !source?.cardId || source.cardId === card.id
  })
  const direct = available.filter(resource => boundIds.has(resource.id)
    || resourceSource(resource, catalog)?.cardId === card.id)
  const resourceIds = new Set(direct.map(resource => resource.id))
  const ownedPresets = direct.filter(resource => resource.resourceKind === 'preset' && !externalIds.has(resource.id)
    && (resourceSource(resource, catalog)?.cardId === card.id
      || (!resourceSource(resource, catalog) && Boolean(resource.metadata.sourceArtifactRef))))
  const mounts = await Promise.all(ownedPresets.map(resource => ctx.promptResources.listLoreMounts({ source: { kind: 'preset', id: resource.id } })))
  for (const mount of mounts.flat()) {
    if (mount.resolvedLoreResourceId !== null) resourceIds.add(mount.resolvedLoreResourceId ?? mount.loreResourceId)
  }
  return available.filter(resource => resourceIds.has(resource.id))
}

async function searchMetadata(ctx: SearchContext, catalog: SearchCatalog, input: SearchResourcesInput, query: string): Promise<Array<Ranked<GlobalSearchHit>>> {
  const hits: Array<Ranked<GlobalSearchHit>> = []
  function add(value: GlobalSearchHit, description?: string) {
    const rank = matchRank(query, value.title, description)
    if (rank !== undefined) hits.push({ value, rank, key: value.id })
  }
  if ((!input.kind || input.kind === 'card') && (!input.scope || input.scope.kind === 'card')) {
    for (const card of catalog.cards.values()) {
      if (input.scope && card.id !== input.scope.id) continue
      add({
        id: `card:${card.id}`, kind: 'card', title: card.content.name, path: [],
        ...(card.content.description ? { snippet: matchingSnippet(card.content.description, query) } : {}),
        target: { type: 'card', cardId: card.id },
      }, card.content.description)
    }
  }
  if (input.scope) return hits
  if (ctx.narratives && (!input.kind || input.kind === 'timeline')) {
    for (const timeline of await ctx.narratives.listSearchTimelines()) {
      if (!timeline.title) continue
      const card = timeline.createdFrom ? catalog.cards.get(timeline.createdFrom.cardId) : undefined
      add({ id: `timeline:${timeline.id}`, kind: 'timeline', title: timeline.title,
        path: card ? [card.content.name] : [], target: { type: 'timeline', timelineId: timeline.id } })
    }
  }
  if (ctx.agents && (!input.kind || input.kind === 'session')) {
    const sessions = await collectPages(async cursor => {
      const page = await ctx.agents!.listSessions({ cursor, limit: 100 })
      return { items: page.sessions, nextCursor: page.nextCursor }
    })
    for (const session of sessions) {
      if (!session.title) continue
      add({ id: `session:${session.id}`, kind: 'session', title: session.title, path: [],
        target: { type: 'session', sessionId: session.id } })
    }
  }
  return hits
}

function toPromptHit(hit: PromptHit, catalog: SearchCatalog): GlobalSearchHit {
  const resource = catalog.resources.find(resource => resource.id === hit.resourceId)!
  const source = resourceSource(resource, catalog)
  return {
    id: `resource:${hit.resourceId}:${hit.nodeId}`, kind: hit.resourceKind,
    title: hit.label, path: hit.path, ...(hit.snippet ? { snippet: hit.snippet } : {}),
    target: { type: 'resource', resourceId: hit.resourceId, nodeId: hit.nodeId, resourceKind: hit.resourceKind },
    ...(source ? { source } : {}),
  }
}

function resourceSource(resource: ResourceHeader, catalog: SearchCatalog): GlobalSearchHit['source'] {
  const origin = resource.metadata.origin
  if (!isRecord(origin) || origin.kind !== 'extension-package' || typeof origin.installationId !== 'string') return undefined
  const installation = catalog.installations.get(origin.installationId)
  if (!installation) return undefined
  return installationSource(installation, catalog)
}

function installationSource(installation: Installation, catalog: SearchCatalog): NonNullable<GlobalSearchHit['source']> {
  const target = installation.content.target
  return {
    packageId: installation.content.packageId, installationId: installation.id,
    ...(target.kind === 'card' ? { cardId: target.cardId, cardName: catalog.cards.get(target.cardId)!.content.name } : {}),
  }
}

function normalizeQuery(query: string): string {
  const terms = [...new Set(query.trim().toLowerCase().split(/\s+/u).filter(Boolean))]
  if (terms.length > 16) throw new Error('Search query must contain at most 16 terms')
  return terms.join(' ')
}

function matchRank(query: string, title: string, description = ''): number | undefined {
  if (!query || title.toLowerCase() === query) return 0
  const terms = query.split(' ')
  if (terms.every(term => title.toLowerCase().includes(term))) return 1
  if (terms.every(term => `${title}\n${description}`.toLowerCase().includes(term))) return 3
  return undefined
}

function matchingSnippet(text: string, query: string): string {
  const index = Math.max(0, text.toLowerCase().indexOf(query.split(' ')[0]!))
  const start = Math.max(0, index - 45)
  return `${start ? '…' : ''}${text.slice(start, start + 180)}${text.length > start + 180 ? '…' : ''}`
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function compareRanked<T>(left: Ranked<T>, right: Ranked<T>): number {
  return left.rank - right.rank || compareText(left.key, right.key)
}

function isAfter<T>(item: Ranked<T>, after?: [number, string]): boolean {
  return !after || item.rank > after[0] || (item.rank === after[0] && compareText(item.key, after[1]) > 0)
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function readCursor(value: string | undefined, fingerprint: string): SearchCursor {
  if (!value) return { version: 1, fingerprint }
  let parsed: unknown
  try { parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) } catch {
    throw new Error('Invalid global search cursor')
  }
  if (!isRecord(parsed) || parsed.version !== 1 || parsed.fingerprint !== fingerprint
    || (parsed.promptCursor !== undefined && typeof parsed.promptCursor !== 'string')
    || (parsed.promptDone !== undefined && typeof parsed.promptDone !== 'boolean')
    || (parsed.after !== undefined && (!Array.isArray(parsed.after) || parsed.after.length !== 2
      || !Number.isInteger(parsed.after[0]) || parsed.after[0] < 0 || parsed.after[0] > 14
      || typeof parsed.after[1] !== 'string'))) {
    throw new Error('Global search cursor no longer matches this query; restart the search')
  }
  return parsed as SearchCursor
}

function encodeCursor(cursor: SearchCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url')
}

function scopeUnavailable(): Error {
  return Object.assign(new Error('Search scope is no longer available'), { code: 'search.scope_unavailable' })
}
