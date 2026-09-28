import { matchPath } from 'react-router-dom'
import type { StudioPanelId } from './studio-layout-store.js'

export type StudioRoute = {
  assetId?: string
  resourceId?: string
  branchId?: string
  cardId?: string
  panel: StudioPanelId | null
  timelineId?: string
  nodeId?: string
  search?: string
}

const PANEL_PATHS: Record<StudioPanelId, string> = {
  model: 'models',
  agent: 'agents',
  play: 'play',
  sessions: 'history',
  character: 'characters',
  preset: 'presets',
  resource: 'resources',
  state: 'state',
  'text-transform': 'text-transforms',
  inspector: 'debug',
  logs: 'logs',
  extensions: 'extensions',
  settings: 'settings',
}

export const STUDIO_ENTRY_PATHS = [
  '/', '/studio', '/studio/chat/:timelineId?/branch/:branchId', '/studio/chat/:timelineId?',
  '/studio/characters/:cardId?', '/studio/resources/reference/:resourceId/node/:nodeId',
  '/studio/presets/reference/:resourceId/node/:nodeId',
  '/studio/agents/reference/:resourceId/node/:nodeId',
  '/studio/resources/:cardId?/:assetId?', '/studio/presets/:cardId?/:assetId?',
  ...Object.values(PANEL_PATHS).map(segment => `/studio/${segment}`),
]

export function readStudioRoute(pathname: string): StudioRoute {
  for (const [segment, panel] of [['resources', 'resource'], ['presets', 'agent'], ['agents', 'agent']] as const) {
    const reference = matchPath(`/studio/${segment}/reference/:resourceId/node/:nodeId`, pathname)
    if (reference) return { panel, resourceId: reference.params.resourceId, assetId: reference.params.nodeId }
  }
  const chatBranch = matchPath('/studio/chat/:timelineId/branch/:branchId', pathname)
  if (chatBranch) return { panel: null, timelineId: chatBranch.params.timelineId, branchId: chatBranch.params.branchId }

  const chat = matchPath('/studio/chat/:timelineId?', pathname)
  if (chat) return { panel: null, timelineId: chat.params.timelineId }

  const character = matchPath('/studio/characters/:cardId?', pathname)
  if (character) return { panel: 'character', cardId: character.params.cardId }

  const resource = matchPath('/studio/resources/:cardId?/:assetId?', pathname)
  if (resource) return { panel: 'resource', cardId: resource.params.cardId, assetId: resource.params.assetId }

  const preset = matchPath('/studio/presets/:cardId?/:assetId?', pathname)
  if (preset) return { panel: 'agent', cardId: preset.params.cardId, assetId: preset.params.assetId }

  for (const panel of ['model', 'agent', 'play', 'sessions', 'state', 'text-transform', 'inspector', 'logs', 'extensions', 'settings'] as const) {
    if (matchPath(`/studio/${PANEL_PATHS[panel]}`, pathname)) return { panel }
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
