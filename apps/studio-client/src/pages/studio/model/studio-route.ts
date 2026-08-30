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

  for (const panel of ['model', 'agent', 'sessions', 'state', 'text-transform', 'inspector', 'logs', 'extensions', 'settings'] as const) {
    if (matchPath(`/studio/${PANEL_PATHS[panel]}`, pathname)) return { panel }
  }

  return { panel: null }
}

export function buildStudioChatPath(timelineId?: string, branchId?: string): string {
  if (!timelineId) return '/studio/chat'
  if (!branchId) return `/studio/chat/${encodeURIComponent(timelineId)}`
  return `/studio/chat/${encodeURIComponent(timelineId)}/branch/${encodeURIComponent(branchId)}`
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
