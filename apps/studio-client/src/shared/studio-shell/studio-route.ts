import { matchPath } from 'react-router-dom'
import type { StudioPanelId } from './studio-layout-store.js'

type StudioRoute = {
  assetId?: string
  branchId?: string
  cardId?: string
  panel: StudioPanelId | null
  timelineId?: string
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

export function readStudioRoute(pathname: string): StudioRoute {
  for (const [segment, panel] of [['resources', 'resource'], ['presets', 'preset']] as const) {
    const reference = matchPath(`/studio/${segment}/reference/:resourceId/node/:nodeId`, pathname)
    if (reference) return { panel, assetId: reference.params.nodeId }
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
  if (preset) return { panel: 'preset', cardId: preset.params.cardId, assetId: preset.params.assetId }

  for (const panel of ['model', 'agent', 'play', 'sessions', 'state', 'text-transform', 'inspector', 'logs', 'extensions', 'settings'] as const) {
    if (matchPath(`/studio/${PANEL_PATHS[panel]}`, pathname)) return { panel }
  }

  return { panel: null }
}

export function buildStudioResourcePath(panel: 'resource' | 'preset', resourceId: string, nodeId: string): string {
  return `/studio/${panel === 'preset' ? 'presets' : 'resources'}/reference/${encodeURIComponent(resourceId)}/node/${encodeURIComponent(nodeId)}`
}

export function buildStudioChatPath(timelineId?: string, branchId?: string): string {
  if (!timelineId) return '/studio/chat'
  if (!branchId) return `/studio/chat/${encodeURIComponent(timelineId)}`
  return `/studio/chat/${encodeURIComponent(timelineId)}/branch/${encodeURIComponent(branchId)}`
}

export function buildStudioLogPath(input: { packageId?: string; runId?: string; source?: 'all' | 'server' | 'client' | 'history' } = {}): string {
  const params = new URLSearchParams()
  if (input.packageId) params.set('logPackage', input.packageId)
  if (input.runId) params.set('logRun', input.runId)
  params.set('logSource', input.source ?? 'all')
  return `/studio/logs?${params}`
}

export function buildStudioNodeHash(nodeId: string): string {
  return `#node-${encodeURIComponent(nodeId)}`
}

export function readStudioNodeAnchor(hash: string): string | undefined {
  if (!hash.startsWith('#node-')) return undefined
  try {
    return decodeURIComponent(hash.slice('#node-'.length)) || undefined
  } catch {
    return undefined
  }
}

export function buildStudioPanelPath(panel: StudioPanelId, input: { assetId?: string; cardId?: string } = {}): string {
  const base = `/studio/${PANEL_PATHS[panel]}`
  if (panel === 'character') return input.cardId ? `${base}/${encodeURIComponent(input.cardId)}` : base
  if (panel !== 'resource' && panel !== 'preset') return base
  if (!input.cardId) return base
  const cardPath = `${base}/${encodeURIComponent(input.cardId)}`
  return input.assetId ? `${cardPath}/${encodeURIComponent(input.assetId)}` : cardPath
}
