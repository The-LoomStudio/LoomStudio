import { matchPath } from 'react-router-dom'
import type { StudioPanelId } from './studio-layout-store.js'

type StudioRoute = {
  assetId?: string
  branchId?: string
  cardId?: string
  panel: StudioPanelId | null
  sessionId?: string
}

const PANEL_PATHS: Record<StudioPanelId, string> = {
  model: 'models',
  character: 'characters',
  preset: 'presets',
  resource: 'resources',
  inspector: 'debug',
  logs: 'logs',
  settings: 'settings',
}

export function readStudioRoute(pathname: string): StudioRoute {
  const chatBranch = matchPath('/studio/chat/:sessionId/branch/:branchId', pathname)
  if (chatBranch) return { panel: null, sessionId: chatBranch.params.sessionId, branchId: chatBranch.params.branchId }

  const chat = matchPath('/studio/chat/:sessionId?', pathname)
  if (chat) return { panel: null, sessionId: chat.params.sessionId }

  const character = matchPath('/studio/characters/:cardId?', pathname)
  if (character) return { panel: 'character', cardId: character.params.cardId }

  const resource = matchPath('/studio/resources/:cardId?/:assetId?', pathname)
  if (resource) return { panel: 'resource', cardId: resource.params.cardId, assetId: resource.params.assetId }

  const preset = matchPath('/studio/presets/:cardId?/:assetId?', pathname)
  if (preset) return { panel: 'preset', cardId: preset.params.cardId, assetId: preset.params.assetId }

  for (const panel of ['model', 'inspector', 'logs', 'settings'] as const) {
    if (matchPath(`/studio/${PANEL_PATHS[panel]}`, pathname)) return { panel }
  }

  return { panel: null }
}

export function buildStudioChatPath(sessionId?: string, branchId?: string): string {
  if (!sessionId) return '/studio/chat'
  if (!branchId) return `/studio/chat/${encodeURIComponent(sessionId)}`
  return `/studio/chat/${encodeURIComponent(sessionId)}/branch/${encodeURIComponent(branchId)}`
}

export function buildStudioEntryHash(entryId: string): string {
  return `#entry-${encodeURIComponent(entryId)}`
}

export function readStudioEntryAnchor(hash: string): string | undefined {
  if (!hash.startsWith('#entry-')) return undefined
  try {
    return decodeURIComponent(hash.slice('#entry-'.length)) || undefined
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
