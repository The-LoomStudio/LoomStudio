import { useLocation, useNavigate } from 'react-router-dom'
import type { StudioPanelId } from './studio-layout-store.js'
import { buildStudioChatPath, buildStudioEntryHash, buildStudioPanelPath, readStudioEntryAnchor, readStudioRoute } from './studio-route.js'

type StudioNavigationInput = {
  branchId?: string
  selectedCardId?: string
  sessionId?: string
}

type StudioHistoryState = {
  loomDetailBack?: boolean
  loomPanelDepth?: number
}

export function useStudioNavigation(input: StudioNavigationInput) {
  const location = useLocation()
  const navigate = useNavigate()
  const route = readStudioRoute(location.pathname)
  const state = (location.state ?? {}) as StudioHistoryState
  const panelDepth = state.loomPanelDepth ?? 0
  const searchParams = new URLSearchParams(location.search)
  const searchQuery = searchParams.get('q') ?? ''
  const entryAnchorId = readStudioEntryAnchor(location.hash)

  function openChat(sessionId?: string, branchId?: string, replace = false) {
    navigate(buildStudioChatPath(sessionId, branchId), { replace })
  }

  function openPanel(panel: StudioPanelId) {
    if (route.panel === panel) {
      closePanel()
      return
    }
    const path = buildStudioPanelPath(panel, { cardId: input.selectedCardId })
    navigate(path, {
      replace: route.panel !== null,
      state: { loomDetailBack: false, loomPanelDepth: route.panel === null ? 1 : panelDepth },
    })
  }

  function openCharacter(cardId: string) {
    navigate(buildStudioPanelPath('character', { cardId }), {
      replace: route.panel === 'character' && Boolean(route.cardId),
      state: {
        loomDetailBack: route.cardId ? state.loomDetailBack : true,
        loomPanelDepth: route.cardId || panelDepth === 0 ? panelDepth : panelDepth + 1,
      },
    })
  }

  function openAsset(panel: 'preset' | 'resource', cardId: string, assetId?: string) {
    const enteringDetail = Boolean(assetId) && !route.assetId
    navigate(buildStudioPanelPath(panel, { cardId, assetId }), {
      replace: Boolean(route.assetId) || route.panel !== panel,
      state: {
        loomDetailBack: enteringDetail ? true : state.loomDetailBack,
        loomPanelDepth: enteringDetail && panelDepth > 0 ? panelDepth + 1 : panelDepth,
      },
    })
  }

  function closeDetail() {
    if (route.panel === 'character' && route.cardId) {
      if (state.loomDetailBack) navigate(-1)
      else navigate(buildStudioPanelPath('character'), { replace: true, state: { loomPanelDepth: panelDepth } })
      return
    }
    if ((route.panel === 'preset' || route.panel === 'resource') && route.assetId) {
      if (state.loomDetailBack) navigate(-1)
      else navigate(buildStudioPanelPath(route.panel, { cardId: route.cardId }), {
        replace: true,
        state: { loomPanelDepth: panelDepth },
      })
      return
    }
    closePanel()
  }

  function closePanel() {
    if (panelDepth > 0) navigate(-panelDepth)
    else navigate(buildStudioChatPath(input.sessionId, input.branchId), { replace: true })
  }

  function setSearchQuery(query: string) {
    const next = new URLSearchParams(location.search)
    const hadQuery = searchQuery.length > 0
    if (query) next.set('q', query)
    else next.delete('q')
    const search = next.toString()
    navigate({ pathname: location.pathname, search: search ? `?${search}` : '' }, {
      replace: hadQuery,
      state: {
        ...state,
        loomPanelDepth: !hadQuery && query && panelDepth > 0 ? panelDepth + 1 : panelDepth,
      },
    })
  }

  function canonicalizePanelCard(cardId: string) {
    if (route.panel !== 'preset' && route.panel !== 'resource') return
    if (route.cardId === cardId) return
    navigate(buildStudioPanelPath(route.panel, { cardId, assetId: route.assetId }), {
      replace: true,
      state,
    })
  }

  function setEntryAnchor(entryId: string) {
    navigate({ pathname: location.pathname, search: location.search, hash: buildStudioEntryHash(entryId) }, {
      replace: true,
      state,
    })
  }

  function getEntryLink(entryId: string): string {
    return new URL(`${location.pathname}${location.search}${buildStudioEntryHash(entryId)}`, globalThis.location.origin).href
  }

  return {
    activePanel: route.panel,
    closeDetail,
    closePanel,
    entryAnchorId,
    getEntryLink,
    openAsset,
    openCharacter,
    openChat,
    openPanel,
    route,
    searchQuery,
    setSearchQuery,
    setEntryAnchor,
    canonicalizePanelCard,
  }
}
