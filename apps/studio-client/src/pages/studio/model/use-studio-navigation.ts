import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useStudioPanelStore } from './studio-layout-store.js'
import { buildStudioChatPath, buildStudioEntryHash, readStudioEntryAnchor, readStudioRoute } from './studio-route.js'

export function useStudioNavigation() {
  const location = useLocation()
  const navigate = useNavigate()
  const route = readStudioRoute(location.pathname)
  const searchParams = new URLSearchParams(location.search)
  const searchQuery = searchParams.get('q') ?? ''
  const entryAnchorId = readStudioEntryAnchor(location.hash)

  useEffect(() => {
    useStudioPanelStore.getState().setActivePanel(route.panel)
  }, [location.pathname, route.panel])

  function openChat(sessionId?: string, branchId?: string, replace = false) {
    navigate(buildStudioChatPath(sessionId, branchId), { replace })
  }

  function setEntryAnchor(entryId: string) {
    navigate({ pathname: location.pathname, search: location.search, hash: buildStudioEntryHash(entryId) }, {
      replace: true,
      state: location.state,
    })
  }

  function getEntryLink(entryId: string): string {
    return new URL(`${location.pathname}${location.search}${buildStudioEntryHash(entryId)}`, globalThis.location.origin).href
  }

  return {
    entryAnchorId,
    getEntryLink,
    openChat,
    route,
    searchQuery,
    setEntryAnchor,
  }
}
