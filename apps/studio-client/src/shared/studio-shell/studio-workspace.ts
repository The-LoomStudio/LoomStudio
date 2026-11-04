import { isRecord } from '@loom-studio/shared'
import { safeLocalStorage } from '../browser/safe-local-storage.js'
import { isStudioTool, type StudioToolId } from './studio-tool.js'
import { STUDIO_PANEL_IDS } from './studio-layout-store.js'
import { readStudioNodeAnchor, readStudioRoute, type StudioRoute } from './studio-route.js'

export type StudioWorkspace = StudioRoute & {
  search: string
  tool?: StudioToolId
  toolSearch?: string
  extensionWorkspace?: true
  referenceUri?: string
  targetUri?: string
}

export const STUDIO_ENTRY = '/studio'
const storageKey = (endpoint: string) => `loom-studio-workspace:${endpoint}`

export function readStudioWorkspace(value: unknown): StudioWorkspace | undefined {
  if (!isRecord(value) || (value.panel !== null && !STUDIO_PANEL_IDS.includes(value.panel as never))) return
  const result: StudioWorkspace = { panel: value.panel as StudioRoute['panel'], search: '' }
  for (const key of ['timelineId', 'branchId', 'cardId', 'previewCardId', 'resourceId', 'assetId', 'nodeId', 'referenceUri', 'targetUri'] as const) {
    if (value[key] === undefined) continue
    if (typeof value[key] !== 'string' || (!value[key] && key !== 'targetUri') || value[key].length > 8192) return
    result[key] = value[key]
  }
  if (value.search !== undefined && typeof value.search !== 'string') return
  result.search = typeof value.search === 'string' ? value.search : ''
  if (value.extensionWorkspace !== undefined && value.extensionWorkspace !== true) return
  if (value.extensionWorkspace === true && result.panel === 'extensions') result.extensionWorkspace = true
  if (value.tool !== undefined) {
    if (!isStudioTool(value.tool as StudioRoute['panel'])) return
    result.tool = value.tool as StudioToolId
  }
  if (value.toolSearch !== undefined) {
    if (typeof value.toolSearch !== 'string') return
    result.toolSearch = value.toolSearch
  }
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
  delete position.tool
  delete position.toolSearch
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
    const route = readStudioRoute(location.pathname)
    const tool = isStudioTool(route.panel) ? route.panel : undefined
    if (route.panel === 'text-transform') {
      return { ...restored, panel: restored?.panel === 'text-transform' ? null : restored?.panel ?? null, search: restored?.search ?? '', tool: 'extensions', toolSearch: textTransformSearch(params) }
    }
    return {
      ...(tool ? { ...restored, tool, panel: restored?.panel ?? null,
        ...(params.size ? { toolSearch: params.toString() } : {}) } : route),
      search: tool ? restored?.search ?? '' : params.toString(),
      ...(targetUri !== null ? { targetUri } : {}),
      ...(referenceUri ? { referenceUri } : {}),
      ...(readStudioNodeAnchor(location.hash) ? { nodeId: readStudioNodeAnchor(location.hash) } : {}),
    }
  }
  if (isRecord(location.state) && isRecord(location.state.studioWorkspace)
    && location.state.studioWorkspace.endpoint === endpoint) {
    const stored = readStudioWorkspace(location.state.studioWorkspace.position)
    if (stored) return normalizeStudioWorkspace(stored)
  }
  return restored ? normalizeStudioWorkspace(restored) : { panel: null, search: '' }
}

export function studioHistoryState(endpoint: string, position: StudioWorkspace) {
  return { studioWorkspace: { endpoint, position } }
}

export function textTransformSearch(params = new URLSearchParams()): string {
  const search = new URLSearchParams({ extensionView: 'scripts', scriptFilter: 'rules' })
  const id = params.get('ruleId') ?? params.get('extractorId')
  if (id) search.set('scriptId', id)
  else search.set('ruleInspector', '1')
  return search.toString()
}

function normalizeStudioWorkspace(workspace: StudioWorkspace): StudioWorkspace {
  if (workspace.panel !== 'text-transform') return workspace
  return { ...workspace, panel: null, search: '', tool: 'extensions', toolSearch: textTransformSearch(new URLSearchParams(workspace.search)) }
}
