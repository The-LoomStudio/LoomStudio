import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import { formatEntityReference, parseResourceLink } from '@loom-studio/shared'
import type { StudioApi } from '../api/studio-api.js'
import { useStudioLayoutStore, type StudioPanelId } from './studio-layout-store.js'
import { isStudioTool } from './studio-tool.js'
import { readStudioRoute } from './studio-route.js'
import { buildStudioTargetLink, resolveStudioTarget } from './studio-target.js'
import {
  persistStudioWorkspace, resolveStudioWorkspace, restoreStudioWorkspace, STUDIO_ENTRY,
  studioHistoryState, textTransformSearch, type StudioWorkspace,
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
  const targetRequest = useRef(0)
  const [targetRevision, setTargetRevision] = useState(0)
  const settledReading = useRef<{ endpoint: string; timelineId?: string; branchId?: string; previewCardId?: string }>({ endpoint: input.endpoint })
  if (settledReading.current.endpoint !== input.endpoint) settledReading.current = { endpoint: input.endpoint }
  const requestKey = (position: StudioWorkspace) => JSON.stringify([input.endpoint, position.panel, position.timelineId, position.branchId, position.previewCardId, position.resourceId, position.assetId, position.targetUri])
  const beginTargetNavigation = () => {
    const request = ++targetRequest.current
    const key = requestKey(current.current)
    return () => request === targetRequest.current && key === requestKey(current.current)
  }

  const publish = useCallback((next: StudioWorkspace, replace = false, preserveRequest = false) => {
    if (!preserveRequest) targetRequest.current++
    const previous = current.current
    if (previous.targetUri === undefined) {
      const remember = useStudioLayoutStore.getState().rememberPanelPosition
      if (previous.panel) remember(JSON.stringify([input.endpoint, previous.cardId, 'panel', previous.panel]), { search: previous.search, resourceId: previous.resourceId, assetId: previous.assetId })
      if (previous.tool) remember(JSON.stringify([input.endpoint, previous.cardId, 'tool', previous.tool]), { search: previous.toolSearch ?? '' })
    }
    current.current = next
    persistStudioWorkspace(input.endpoint, next)
    return navigate(STUDIO_ENTRY, { replace, state: studioHistoryState(input.endpoint, next) })
  }, [navigate, input.endpoint])

  useEffect(() => {
    if (location.pathname !== STUDIO_ENTRY || location.search || location.hash
      || !location.state?.studioWorkspace || location.state.studioWorkspace.endpoint !== input.endpoint) {
      void publish(workspace, true, true)
    } else {
      persistStudioWorkspace(input.endpoint, workspace)
    }
  }, [workspace, input.endpoint, location.pathname, location.search, location.hash, location.state, publish])

  useEffect(() => {
    if (workspace.targetUri === undefined) return
    setTargetError(undefined)
    let active = true
    const uri = workspace.targetUri
    const request = targetRequest.current
    const initialTool = current.current.tool
    const initialToolSearch = current.current.toolSearch
    void resolveStudioTarget(input.api, uri).then(target => {
      if (!active || request !== targetRequest.current || current.current.targetUri !== uri) return
      const latest = current.current
      const toolChanged = latest.tool !== initialTool || latest.toolSearch !== initialToolSearch
      const tool = isStudioTool(target.panel) && !toolChanged ? target.panel : latest.tool
      void publish({ ...latest, ...target,
        ...(isStudioTool(target.panel) ? { panel: latest.panel, search: latest.search } : {}),
        tool, toolSearch: isStudioTool(target.panel) && !toolChanged ? target.search : latest.toolSearch,
        targetUri: undefined, referenceUri: undefined }, true, true)
    }, error => {
      if (active && request === targetRequest.current) setTargetError({ uri, message: error instanceof Error ? error.message : String(error) })
    })
    return () => { active = false }
  }, [workspace.targetUri, input.api, publish, targetRevision])

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
    if (panel === 'sessions') return publish({ ...current.current, tool: 'recent', toolSearch: 'historyTab=timelines' }, false, true)
    if (panel === 'text-transform') return publish({ ...current.current, tool: 'extensions', toolSearch: textTransformSearch(new URLSearchParams(target.search)) }, false, true)
    if (isStudioTool(panel)) return publish({ ...current.current, tool: panel,
      toolSearch: target.search ?? (current.current.tool === panel ? current.current.toolSearch : useStudioLayoutStore.getState().panelPositions[JSON.stringify([input.endpoint, current.current.cardId, 'tool', panel])]?.search) }, false, true)
    if (panel === 'preset') panel = 'agent'
    const previous = current.current
    const remembered = useStudioLayoutStore.getState().panelPositions[JSON.stringify([input.endpoint, target.cardId ?? previous.cardId, 'panel', panel])]
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
    timelineId: settledReading.current.timelineId, branchId: settledReading.current.branchId, previewCardId: settledReading.current.previewCardId,
    extensionWorkspace: undefined, resourceId: undefined, assetId: undefined,
    referenceUri: undefined, targetUri: undefined, search: '',
  }), [publish])
  const closeTool = useCallback(() => publish({ ...current.current, tool: undefined, toolSearch: undefined }, true, true), [publish])
  const togglePanel = useCallback((panel: StudioPanelId) => {
    if (isStudioTool(panel)) return current.current.tool === panel ? closeTool() : openPanel(panel)
    if (current.current.panel === panel) return closePanel()
    return openPanel(panel)
  }, [closePanel, closeTool, openPanel])

  const openUri = (uri: string, replace = false) => {
    setTargetRevision(value => value + 1)
    return publish({ ...current.current, tool: undefined, toolSearch: undefined, targetUri: uri, referenceUri: undefined }, replace)
  }

  return {
    closePanel, togglePanel, openPanel, returnToReading, beginTargetNavigation,
    closeTool,
    openStoryExtensions: () => publish({
      ...current.current, tool: 'extensions', toolSearch: 'extensionView=participation',
    }, false, true),
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
    goBack: () => { targetRequest.current++; return navigate(-1) },
    goForward: () => { targetRequest.current++; return navigate(1) },
    locationKey: location.key,
    historyAction,
    isCurrent: () => current.current === workspace,
    route: workspace,
    targetError: workspace.targetUri === targetError?.uri ? targetError?.message : undefined,
    targetPending: workspace.targetUri !== undefined && workspace.targetUri !== targetError?.uri,
    referenceUri: workspace.referenceUri,
    openReference,
    closeReference: () => publish({ ...current.current, referenceUri: undefined }, true),
    openUri,
    openPath: (path: string) => {
      const url = new URL(path, globalThis.location.origin)
      const panel = readStudioRoute(url.pathname).panel
      if (panel === 'text-transform') return openPanel(panel, { search: url.searchParams.toString() })
      if (isStudioTool(panel)) return publish({ ...current.current, tool: panel,
        toolSearch: url.searchParams.size ? url.searchParams.toString() : undefined }, false, true)
      const target = url.searchParams.get('target')
      return target
        ? openUri(target)
        : publish({ ...current.current, ...readStudioRoute(url.pathname), tool: undefined, toolSearch: undefined, extensionWorkspace: undefined, search: url.searchParams.toString(), referenceUri: undefined })
    },
    openNarrative: (timelineId?: string, branchId?: string, replace = false) => publish({
      ...current.current, tool: undefined, toolSearch: undefined, timelineId, branchId,
      nodeId: undefined, targetUri: undefined, referenceUri: undefined,
    }, replace),
    openCardPreview: (cardId: string) => publish({
      ...current.current, tool: undefined, toolSearch: undefined, previewCardId: cardId, timelineId: undefined, branchId: undefined,
      nodeId: undefined, targetUri: undefined, referenceUri: undefined,
    }),
    isNarrativeCurrent: () => current.current.timelineId === workspace.timelineId && current.current.branchId === workspace.branchId && current.current.previewCardId === workspace.previewCardId && current.current.targetUri === workspace.targetUri,
    updateNarrativeContext: (timelineId: string, branchId: string) => {
      settledReading.current = { endpoint: input.endpoint, timelineId, branchId, previewCardId: current.current.previewCardId }
      if (current.current.timelineId === timelineId && current.current.branchId === branchId) return
      return publish({ ...current.current, timelineId, branchId }, true, true)
    },
    acceptPreview: (previewCardId?: string) => {
      settledReading.current = { endpoint: input.endpoint, previewCardId }
    },
    clearDeletedCards: (cardIds: readonly string[], deletedTimelineIds: readonly string[]) => {
      const latest = current.current
      const deletedTimeline = Boolean(latest.timelineId && deletedTimelineIds.includes(latest.timelineId))
      const deletedCard = Boolean(latest.cardId && cardIds.includes(latest.cardId))
      const deletedPreview = Boolean(latest.previewCardId && cardIds.includes(latest.previewCardId))
      if (settledReading.current.timelineId && deletedTimelineIds.includes(settledReading.current.timelineId)) settledReading.current = { endpoint: input.endpoint }
      if (settledReading.current.previewCardId && cardIds.includes(settledReading.current.previewCardId)) settledReading.current.previewCardId = undefined
      if (!deletedTimeline && !deletedCard && !deletedPreview) return
      return publish({ ...latest,
        ...(deletedCard ? { cardId: undefined } : {}),
        ...(deletedPreview ? { previewCardId: undefined } : {}),
        ...(deletedTimeline ? { timelineId: undefined, branchId: undefined, nodeId: undefined } : {}),
      }, true)
    },
    clearDeletedTimeline: (timelineId: string, cardId?: string) => {
      if (current.current !== workspace || current.current.timelineId !== timelineId || current.current.targetUri !== undefined) return
      return publish({
        ...current.current, panel: null, timelineId: undefined, branchId: undefined, nodeId: undefined,
        resourceId: undefined, assetId: undefined, targetUri: undefined, referenceUri: undefined, search: '',
        previewCardId: cardId ?? current.current.previewCardId,
      }, true)
    },
    clearResourceTarget: (resourceId?: string) => {
      const latest = current.current
      if (resourceId !== undefined && latest.resourceId !== resourceId) return
      return publish({
        ...latest, resourceId: undefined, assetId: undefined,
        referenceUri: undefined, targetUri: undefined,
      }, true)
    },
    openResource: (panel: 'resource' | 'preset' | 'agent', resourceId: string, nodeId: string, replace = false, preserveTool = false) => publish({
      ...current.current, panel: panel === 'preset' ? 'agent' : panel, tool: preserveTool ? current.current.tool : undefined, toolSearch: preserveTool ? current.current.toolSearch : undefined, extensionWorkspace: undefined, resourceId, assetId: nodeId, referenceUri: undefined, targetUri: undefined,
    }, replace),
    searchQuery: new URLSearchParams(workspace.search).get('q') ?? '',
    searchParams: new URLSearchParams(workspace.search),
    toolSearchParams: new URLSearchParams(workspace.toolSearch),
    setToolSearchParams: (params: URLSearchParams) => publish({ ...current.current, toolSearch: params.toString() }, true, true),
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
