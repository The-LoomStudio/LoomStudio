import { isRecord } from '@loom-studio/shared'
import { safeLocalStorage } from '../browser/safe-local-storage.js'
import { STUDIO_PANEL_IDS } from './studio-layout-store.js'
import { readStudioNodeAnchor, readStudioRoute, type StudioRoute } from './studio-route.js'

export type StudioWorkspace = StudioRoute & {
  search: string
  referenceUri?: string
  targetUri?: string
}

export const STUDIO_ENTRY = '/studio'
const storageKey = (endpoint: string) => `loom-studio-workspace:${endpoint}`

export function readStudioWorkspace(value: unknown): StudioWorkspace | undefined {
  if (!isRecord(value) || (value.panel !== null && !STUDIO_PANEL_IDS.includes(value.panel as never))) return
  const result: StudioWorkspace = { panel: value.panel === 'preset' ? 'agent' : value.panel as StudioRoute['panel'], search: '' }
  for (const key of ['timelineId', 'branchId', 'cardId', 'resourceId', 'assetId', 'nodeId', 'referenceUri', 'targetUri'] as const) {
    if (value[key] === undefined) continue
    if (typeof value[key] !== 'string' || (!value[key] && key !== 'targetUri') || value[key].length > 8192) return
    result[key] = value[key]
  }
  if (value.search !== undefined && typeof value.search !== 'string') return
  result.search = typeof value.search === 'string' ? value.search : ''
  if (result.branchId && !result.timelineId) return
  return result
}

export function restoreStudioWorkspace(endpoint: string): StudioWorkspace | undefined {
  try {
    return readStudioWorkspace(JSON.parse(safeLocalStorage.getItem(storageKey(endpoint)) ?? 'null'))
  } catch { return undefined }
}

export function persistStudioWorkspace(endpoint: string, workspace: StudioWorkspace): void {
  // Pending external targets must not replace the last usable workspace.
  if (workspace.targetUri !== undefined) return
  const position = { ...workspace }
  delete position.referenceUri
  safeLocalStorage.setItem(storageKey(endpoint), JSON.stringify(position))
}

export function resolveStudioWorkspace(
  location: { pathname: string; search: string; hash: string; state: unknown },
  endpoint: string,
  restored?: StudioWorkspace,
): StudioWorkspace {
  const params = new URLSearchParams(location.search)
  const targetUri = params.get('target')
  const referenceUri = params.get('resourceRef')
  const isEntry = ['/', '/studio', '/studio/'].includes(location.pathname)
  if (!isEntry || targetUri || referenceUri || location.search || location.hash) {
    params.delete('target')
    params.delete('resourceRef')
    return {
      ...readStudioRoute(location.pathname), search: params.toString(),
      ...(targetUri !== null ? { targetUri } : {}),
      ...(referenceUri ? { referenceUri } : {}),
      ...(readStudioNodeAnchor(location.hash) ? { nodeId: readStudioNodeAnchor(location.hash) } : {}),
    }
  }
  if (isRecord(location.state) && isRecord(location.state.studioWorkspace)
    && location.state.studioWorkspace.endpoint === endpoint) {
    const stored = readStudioWorkspace(location.state.studioWorkspace.position)
    if (stored) return stored
  }
  return restored ?? { panel: null, search: '' }
}

export function studioHistoryState(endpoint: string, position: StudioWorkspace) {
  return { studioWorkspace: { endpoint, position } }
}
