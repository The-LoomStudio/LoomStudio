import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import { formatEntityReference, parseResourceLink } from '@loom-studio/shared'
import type { StudioApi } from '../api/studio-api.js'
import { useStudioPanelStore, type StudioPanelId } from './studio-layout-store.js'
import { readStudioRoute } from './studio-route.js'
import { buildStudioTargetLink, resolveStudioTarget } from './studio-target.js'
import {
  persistStudioWorkspace, resolveStudioWorkspace, restoreStudioWorkspace, STUDIO_ENTRY,
  studioHistoryState, type StudioWorkspace,
} from './studio-workspace.js'

export function useStudioNavigation(input: { endpoint: string; api: StudioApi }) {
  const location = useLocation()
  const navigate = useNavigate()
  const historyAction = useNavigationType()
  const workspace = useMemo(() => resolveStudioWorkspace(location, input.endpoint, restoreStudioWorkspace(input.endpoint)),
    [location.key, location.pathname, location.search, location.hash, location.state, input.endpoint])
  const current = useRef(workspace)
  current.current = workspace
  const [targetError, setTargetError] = useState<{ uri: string; message: string }>()
  const cardSelection = useRef(0)

  const publish = useCallback((next: StudioWorkspace, replace = false) => {
    current.current = next
    persistStudioWorkspace(input.endpoint, next)
    return navigate(STUDIO_ENTRY, { replace, state: studioHistoryState(input.endpoint, next) })
  }, [navigate, input.endpoint])

  useEffect(() => {
    if (location.pathname !== STUDIO_ENTRY || location.search || location.hash
      || !location.state?.studioWorkspace || location.state.studioWorkspace.endpoint !== input.endpoint) {
      void publish(workspace, true)
    } else {
      persistStudioWorkspace(input.endpoint, workspace)
    }
    useStudioPanelStore.getState().syncActivePanel(workspace.panel)
  }, [workspace, input.endpoint, location.pathname, location.search, location.hash, location.state, publish])

  useEffect(() => {
    if (workspace.targetUri === undefined) return
    setTargetError(undefined)
    let active = true
    const uri = workspace.targetUri
    void resolveStudioTarget(input.api, uri).then(target => {
      if (!active) return
      void publish({ ...workspace, ...target, targetUri: undefined, referenceUri: undefined }, true)
    }, error => {
      if (active) setTargetError({ uri, message: error instanceof Error ? error.message : String(error) })
    })
    return () => { active = false }
  }, [workspace, input.api, publish])

  const openReference = useCallback((uri: string) => {
    if (parseResourceLink(uri)) return publish({ ...current.current, referenceUri: uri })
  }, [publish])

  useEffect(() => {
    const handle = (event: Event) => {
      const uri: unknown = (event as CustomEvent).detail?.uri
      if (typeof uri === 'string') void openReference(uri)
    }
    window.addEventListener('loom:open-reference', handle)
    return () => window.removeEventListener('loom:open-reference', handle)
  }, [openReference])

  const openPanel = useCallback((panel: StudioPanelId, target: { cardId?: string; assetId?: string } = {}) => {
    const previous = current.current
    return publish({
      ...previous, panel, ...target, targetUri: undefined, referenceUri: undefined,
      resourceId: panel === previous.panel ? previous.resourceId : undefined,
      assetId: target.assetId ?? (panel === previous.panel ? previous.assetId : undefined),
      search: panel === previous.panel ? previous.search : '',
    })
  }, [publish])
  const closePanel = useCallback(() => publish({
    ...current.current, panel: null, resourceId: undefined, assetId: undefined,
    referenceUri: undefined, targetUri: undefined, search: '',
  }), [publish])
  const togglePanel = useCallback((panel: StudioPanelId) =>
    current.current.panel === panel ? closePanel() : openPanel(panel), [closePanel, openPanel])

  return {
    closePanel, togglePanel, openPanel,
    goBack: () => navigate(-1),
    goForward: () => navigate(1),
    locationKey: location.key,
    historyAction,
    route: workspace,
    targetError: workspace.targetUri === targetError?.uri ? targetError?.message : undefined,
    targetPending: workspace.targetUri !== undefined && workspace.targetUri !== targetError?.uri,
    referenceUri: workspace.referenceUri,
    openReference,
    closeReference: () => publish({ ...current.current, referenceUri: undefined }, true),
    openUri: (uri: string) => publish({ ...current.current, targetUri: uri, referenceUri: undefined }),
    openPath: (path: string) => {
      const url = new URL(path, globalThis.location.origin)
      const target = url.searchParams.get('target')
      return target
        ? publish({ ...current.current, targetUri: target, referenceUri: undefined })
        : publish({ ...current.current, ...readStudioRoute(url.pathname), search: url.searchParams.toString(), referenceUri: undefined })
    },
    openNarrative: (timelineId?: string, branchId?: string, replace = false) => publish({
      ...current.current, panel: null, timelineId, branchId, resourceId: undefined,
      assetId: undefined, nodeId: undefined, targetUri: undefined, referenceUri: undefined, search: '',
    }, replace),
    updateNarrativeContext: (timelineId: string, branchId: string, cardId?: string) => publish({
      ...current.current, timelineId, branchId, cardId: cardId ?? current.current.cardId,
    }, true),
    selectCard: async (cardId: string, activate: () => Promise<{ timelineId: string; branchId: string } | null | undefined>) => {
      const request = ++cardSelection.current
      const before = current.current
      const activated = await activate()
      if (activated === undefined || request !== cardSelection.current || before !== current.current) return
      return publish({
        ...before, cardId, timelineId: activated?.timelineId, branchId: activated?.branchId, nodeId: undefined,
      })
    },
    openResource: (panel: 'resource' | 'preset', resourceId: string, nodeId: string) => publish({
      ...current.current, panel, resourceId, assetId: nodeId, referenceUri: undefined, targetUri: undefined,
    }),
    searchQuery: new URLSearchParams(workspace.search).get('q') ?? '',
    searchParams: new URLSearchParams(workspace.search),
    setSearchParams: (params: URLSearchParams) => publish({ ...current.current, search: params.toString() }, true),
    setSearchQuery: (value: string) => {
      const params = new URLSearchParams(current.current.search)
      if (value === (params.get('q') ?? '')) return
      if (value) params.set('q', value)
      else params.delete('q')
      return publish({ ...current.current, search: params.toString() }, true)
    },
    nodeAnchorId: workspace.nodeId,
    setNodeAnchor: (nodeId: string) => publish({ ...current.current, nodeId }, true),
    getNodeLink: (nodeId: string) => {
      if (!workspace.timelineId) throw new Error('No Timeline selected')
      const uri = formatEntityReference({
        kind: 'entity', type: 'timeline', id: workspace.timelineId,
        branchId: workspace.branchId, nodeId,
      })
      return new URL(buildStudioTargetLink(uri), globalThis.location.origin).href
    },
  }
}
