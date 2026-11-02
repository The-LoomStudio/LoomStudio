import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import { formatEntityReference, parseResourceLink } from '@loom-studio/shared'
import type { StudioApi } from '../api/studio-api.js'
import { useStudioPanelStore, useStudioLayoutStore, type StudioPanelId } from './studio-layout-store.js'
import { isStudioTool } from './studio-tool.js'
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
    const previous = current.current
    if (previous.targetUri === undefined) {
      const remember = useStudioLayoutStore.getState().rememberPanelPosition
      if (previous.panel) remember(JSON.stringify([input.endpoint, previous.cardId, previous.panel]), { search: previous.search, resourceId: previous.resourceId, assetId: previous.assetId })
      if (previous.tool) remember(JSON.stringify([input.endpoint, previous.cardId, previous.tool]), { search: previous.toolSearch ?? '' })
    }
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
      void publish({ ...workspace, ...target, ...(isStudioTool(target.panel) ? { tool: target.panel, toolSearch: target.search, panel: workspace.panel, search: workspace.search } : { tool: undefined, toolSearch: undefined }), targetUri: undefined, referenceUri: undefined }, true)
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
    const handleObservation = (event: Event) => {
      const id: unknown = (event as CustomEvent).detail?.id
      if (typeof id === 'string' && id) void publish({ ...current.current, panel: 'logs', tool: undefined, toolSearch: undefined, search: new URLSearchParams({ logView: 'model', observationId: id }).toString() })
    }
    window.addEventListener('loom:open-observation', handleObservation)
    window.addEventListener('loom:open-reference', handle)
    return () => { window.removeEventListener('loom:open-reference', handle); window.removeEventListener('loom:open-observation', handleObservation) }
  }, [openReference, publish])

  const openPanel = useCallback((panel: StudioPanelId, target: { cardId?: string; assetId?: string; search?: string } = {}) => {
    if (panel === 'sessions') return publish({ ...current.current, tool: 'recent', toolSearch: 'historyTab=timelines' })
    if (isStudioTool(panel)) return publish({ ...current.current, tool: panel,
      toolSearch: target.search ?? (current.current.tool === panel ? current.current.toolSearch : useStudioLayoutStore.getState().panelPositions[JSON.stringify([input.endpoint, current.current.cardId, panel])]?.search) })
    if (panel === 'preset') panel = 'agent'
    const previous = current.current
    const remembered = useStudioLayoutStore.getState().panelPositions[JSON.stringify([input.endpoint, target.cardId ?? previous.cardId, panel])]
    const restore = target.cardId === undefined && target.assetId === undefined ? remembered : undefined
    return publish({
      ...previous, panel, tool: undefined, toolSearch: undefined, extensionWorkspace: undefined, ...target, targetUri: undefined, referenceUri: undefined,
      resourceId: panel === previous.panel ? previous.resourceId : restore?.resourceId,
      assetId: target.assetId ?? (panel === previous.panel ? previous.assetId : restore?.assetId),
      search: target.search ?? (panel === previous.panel ? previous.search : restore?.search ?? ''),
    })
  }, [publish, input.endpoint])
  const closePanel = useCallback(() => publish({
    ...current.current, panel: null, extensionWorkspace: undefined, resourceId: undefined, assetId: undefined,
    referenceUri: undefined, targetUri: undefined, search: '',
  }), [publish])
  const returnToReading = useCallback(() => publish({
    ...current.current, panel: null, tool: undefined, toolSearch: undefined,
    extensionWorkspace: undefined, resourceId: undefined, assetId: undefined,
    referenceUri: undefined, targetUri: undefined, search: '',
  }), [publish])
  const closeTool = useCallback(() => publish({ ...current.current, tool: undefined, toolSearch: undefined }, true), [publish])
  const togglePanel = useCallback((panel: StudioPanelId) => {
    if (isStudioTool(panel)) return current.current.tool === panel ? closeTool() : openPanel(panel)
    if (current.current.panel === panel) return closePanel()
    return openPanel(panel)
  }, [closePanel, closeTool, openPanel])

  return {
    closePanel, togglePanel, openPanel, returnToReading,
    closeTool,
    openStoryExtensions: () => publish({
      ...current.current, tool: 'extensions', toolSearch: 'extensionView=participation',
    }),
    openExtensionWorkspace: () => publish({
      ...current.current, panel: 'extensions', extensionWorkspace: true, tool: undefined, toolSearch: undefined,
      resourceId: undefined, assetId: undefined, search: '', referenceUri: undefined, targetUri: undefined,
    }),
    closeExtensionWorkspace: () => publish({
      ...current.current, panel: null, extensionWorkspace: undefined, tool: 'extensions', toolSearch: undefined,
    }),
    openSessionSummary: (sessionId: string) => {
      const search = new URLSearchParams({ historyTab: 'sessions', sessionId, sessionView: 'summary' })
      return publish({ ...current.current, tool: 'recent', toolSearch: search.toString(), targetUri: undefined, referenceUri: undefined })
    },
    openMemory: (target: { timelineId?: string; branchId?: string; view?: 'workspace' | 'plot' } = {}) => {
      const search = new URLSearchParams({ memoryView: target.view ?? 'plot' })
      if (target.timelineId) search.set('memoryTimeline', target.timelineId)
      if (target.branchId) search.set('memoryBranch', target.branchId)
      return publish({ ...current.current, panel: 'memory', search: search.toString(), targetUri: undefined, referenceUri: undefined })
    },
    goBack: () => navigate(-1),
    goForward: () => navigate(1),
    locationKey: location.key,
    historyAction,
    isCurrent: () => current.current === workspace,
    route: workspace,
    targetError: workspace.targetUri === targetError?.uri ? targetError?.message : undefined,
    targetPending: workspace.targetUri !== undefined && workspace.targetUri !== targetError?.uri,
    referenceUri: workspace.referenceUri,
    openReference,
    closeReference: () => publish({ ...current.current, referenceUri: undefined }, true),
    openUri: (uri: string, replace = false) => publish({ ...current.current, tool: undefined, toolSearch: undefined, targetUri: uri, referenceUri: undefined }, replace),
    openPath: (path: string) => {
      const url = new URL(path, globalThis.location.origin)
      const routePanel = readStudioRoute(url.pathname).panel
      const panel = routePanel === 'sessions' ? 'recent' : routePanel
      if (routePanel === 'play' && url.searchParams.has('sessionId')) {
        url.searchParams.set('historyTab', 'sessions')
        return publish({ ...current.current, tool: 'recent', toolSearch: url.searchParams.toString() })
      }
      if (isStudioTool(panel)) return publish({ ...current.current, tool: panel,
        toolSearch: url.searchParams.size ? url.searchParams.toString() : undefined })
      const target = url.searchParams.get('target')
      return target
        ? publish({ ...current.current, targetUri: target, referenceUri: undefined })
        : publish({ ...current.current, ...readStudioRoute(url.pathname), tool: undefined, toolSearch: undefined, extensionWorkspace: undefined, search: url.searchParams.toString(), referenceUri: undefined })
    },
    openNarrative: (timelineId?: string, branchId?: string, replace = false) => publish({
      ...current.current, tool: undefined, toolSearch: undefined, timelineId, branchId,
      nodeId: undefined, targetUri: undefined, referenceUri: undefined,
    }, replace),
    openCardPreview: (cardId: string) => publish({
      ...current.current, tool: undefined, toolSearch: undefined, cardId, timelineId: undefined, branchId: undefined,
      nodeId: undefined, targetUri: undefined, referenceUri: undefined,
    }),
    updateNarrativeContext: (timelineId: string, branchId: string, cardId?: string) => publish({
      ...current.current, timelineId, branchId, cardId: cardId ?? current.current.cardId,
    }, true),
    clearDeletedCard: (cardId: string, deletedTimelineIds: readonly string[]) => {
      if (current.current !== workspace) return
      const deletedTimeline = Boolean(current.current.timelineId && deletedTimelineIds.includes(current.current.timelineId))
      return publish({
        ...current.current,
        cardId: current.current.cardId === cardId ? undefined : current.current.cardId,
        ...(deletedTimeline ? { timelineId: undefined, branchId: undefined, nodeId: undefined } : {}),
        panel: null, targetUri: undefined, referenceUri: undefined, resourceId: undefined, assetId: undefined, search: '',
      }, true)
    },
    clearDeletedTimeline: (timelineId: string, cardId?: string) => {
      if (current.current !== workspace || current.current.timelineId !== timelineId || current.current.targetUri !== undefined) return
      return publish({
        ...current.current, panel: null, timelineId: undefined, branchId: undefined, nodeId: undefined,
        resourceId: undefined, assetId: undefined, targetUri: undefined, referenceUri: undefined, search: '',
        cardId: cardId ?? current.current.cardId,
      }, true)
    },
    selectCard: async (cardId: string, activate: () => Promise<{ timelineId: string; branchId: string } | null | undefined>) => {
      const request = ++cardSelection.current
      const before = current.current
      const activated = await activate()
      if (activated === undefined || request !== cardSelection.current || before !== current.current) return
      return publish({
        ...before, cardId, timelineId: activated?.timelineId, branchId: activated?.branchId, nodeId: undefined,
      })
    },
    clearResourceTarget: (resourceId?: string) => {
      const latest = current.current
      if (resourceId !== undefined && latest.resourceId !== resourceId) return
      return publish({
        ...latest, resourceId: undefined, assetId: undefined,
        referenceUri: undefined, targetUri: undefined,
      }, true)
    },
    openResource: (panel: 'resource' | 'preset' | 'agent', resourceId: string, nodeId: string, replace = false) => publish({
      ...current.current, panel: panel === 'preset' ? 'agent' : panel, tool: undefined, toolSearch: undefined, extensionWorkspace: undefined, resourceId, assetId: nodeId, referenceUri: undefined, targetUri: undefined,
    }, replace),
    searchQuery: new URLSearchParams(workspace.search).get('q') ?? '',
    searchParams: new URLSearchParams(workspace.search),
    toolSearchParams: new URLSearchParams(workspace.toolSearch),
    setToolSearchParams: (params: URLSearchParams) => publish({ ...current.current, toolSearch: params.toString() }, true),
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
