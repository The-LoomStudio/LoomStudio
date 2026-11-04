import { matchPath } from 'react-router-dom'
import type { StudioPanelId } from './studio-layout-store.js'

export type StudioRoute = {
  assetId?: string
  resourceId?: string
  branchId?: string
  cardId?: string
  previewCardId?: string
  panel: StudioPanelId | null
  timelineId?: string
  nodeId?: string
  search?: string
}

type RouteParams = Readonly<Record<string, string | undefined>>
const STUDIO_ROUTES: { path: string; read(params: RouteParams): StudioRoute }[] = [
  ...([['resources', 'resource'], ['agents', 'agent']] as const).map(([segment, panel]) => ({
    path: `/studio/${segment}/reference/:resourceId/node/:nodeId`,
    read: ({ resourceId, nodeId }: RouteParams) => ({ panel, resourceId, assetId: nodeId }),
  })),
  {
    path: '/studio/chat/:timelineId?/branch/:branchId',
    // Preserve the empty landing for the registered Branch URL without a Timeline.
    read: ({ timelineId, branchId }) => timelineId ? { panel: null, timelineId, branchId } : { panel: null },
  },
  { path: '/studio/chat/:timelineId?', read: ({ timelineId }) => ({ panel: null, timelineId }) },
  { path: '/studio/characters/:cardId?', read: ({ cardId }) => ({ panel: 'character', cardId }) },
  { path: '/studio/resources/:cardId?/:assetId?', read: ({ cardId, assetId }) => ({ panel: 'resource', cardId, assetId }) },
  ...([
    ['models', 'model'], ['agents', 'agent'], ['user', 'user'], ['play', 'play'], ['recent', 'recent'],
    ['memory', 'memory'], ['state', 'state'], ['macro', null], ['text-transforms', 'text-transform'],
    ['debug', 'inspector'], ['logs', 'logs'], ['extensions', 'extensions'], ['settings', 'settings'],
  ] as const).map(([segment, panel]) => ({ path: `/studio/${segment}`, read: () => ({ panel }) })),
  { path: '/', read: () => ({ panel: null }) },
  { path: '/studio', read: () => ({ panel: null }) },
]

export const STUDIO_ENTRY_PATHS = STUDIO_ROUTES.map(route => route.path)

export function readStudioRoute(pathname: string): StudioRoute {
  for (const route of STUDIO_ROUTES) {
    const match = matchPath(route.path, pathname)
    if (match) return route.read(match.params)
  }
  return { panel: null }
}

export function buildStudioLogPath(input: { packageId?: string; runId?: string; source?: 'all' | 'server' | 'client' | 'history' } = {}): string {
  const params = new URLSearchParams()
  if (input.packageId) params.set('logPackage', input.packageId)
  if (input.runId) params.set('logRun', input.runId)
  params.set('logSource', input.source ?? 'all')
  return `/studio/logs?${params}`
}

export function readStudioNodeAnchor(hash: string): string | undefined {
  if (!hash.startsWith('#node-')) return undefined
  try {
    return decodeURIComponent(hash.slice('#node-'.length)) || undefined
  } catch {
    return undefined
  }
}
