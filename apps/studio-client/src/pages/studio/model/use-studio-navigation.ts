import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useStudioPanelStore } from './studio-layout-store.js'
import { buildStudioChatPath, buildStudioNodeHash, readStudioNodeAnchor, readStudioRoute } from './studio-route.js'

export function useStudioNavigation() {
  const location = useLocation()
  const navigate = useNavigate()
  const route = readStudioRoute(location.pathname)
  const searchParams = new URLSearchParams(location.search)
  const searchQuery = searchParams.get('q') ?? ''
  const nodeAnchorId = readStudioNodeAnchor(location.hash)

  useEffect(() => {
    useStudioPanelStore.getState().setActivePanel(route.panel)
  }, [location.pathname, route.panel])

  function openNarrative(timelineId?: string, branchId?: string, replace = false) {
    navigate(buildStudioChatPath(timelineId, branchId), { replace })
  }

  function setNodeAnchor(nodeId: string) {
    navigate({ pathname: location.pathname, search: location.search, hash: buildStudioNodeHash(nodeId) }, {
      replace: true,
      state: location.state,
    })
  }

  function getNodeLink(nodeId: string): string {
    return new URL(`${location.pathname}${location.search}${buildStudioNodeHash(nodeId)}`, globalThis.location.origin).href
  }

  return {
    getNodeLink,
    nodeAnchorId,
    openNarrative,
    route,
    searchQuery,
    setNodeAnchor,
  }
}
