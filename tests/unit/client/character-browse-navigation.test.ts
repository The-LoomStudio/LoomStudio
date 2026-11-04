import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { createStudioPanels } from '../../../apps/studio-client/src/app/studio-panel-registry.js'

function fixture() {
  const state = {
    api: {}, cards: [], allTimelines: [], cardTimelines: [], promptResources: [],
    t: (key: string) => key,
    selectedCardId: 'playing-card',
    selectCardTimeline: vi.fn(),
    setSelectedCardId: vi.fn(),
    resetToDraftTimeline: vi.fn(),
    setOpeningChoice: vi.fn(),
    createTimelineFromCard: vi.fn(async () => ({ timelineId: 'new-timeline', branchId: 'new-branch' })),
    activateTimeline: vi.fn(async () => 'saved-branch'),
    refreshAllTimelines: vi.fn(async () => []),
    narrativeTimeline: { id: 'playing-timeline', createdFrom: { cardId: 'playing-card' } },
    deleteTimeline: vi.fn(async (_id: string) => true),
  }
  const navigation = {
    route: { panel: 'character', cardId: 'browsed-card', timelineId: 'playing-timeline', branchId: 'playing-branch' },
    searchParams: new URLSearchParams(), toolSearchParams: new URLSearchParams(),
    openPanel: vi.fn(),
    setSearchParams: vi.fn(),
    openNarrative: vi.fn(),
    openCardPreview: vi.fn(),
    clearDeletedTimeline: vi.fn(),
    isCurrent: vi.fn(() => true),
    openUri: vi.fn(),
  }
  const openRecentCharacter = vi.fn()
  const panels = createStudioPanels({
    state, navigation, resourcePanels: {}, openRecentCharacter,
    extensionCardContext: {}, clientExtensions: { packages: [], cardPackages: [] },
  } as unknown as Parameters<typeof createStudioPanels>[0])
  function panelElement(id: 'character' | 'sessions' | 'recent') {
    const boundary = panels[id](true) as ReactElement<{ children: ReactElement<{
      render(active: boolean): ReactElement
    }> }>
    return boundary.props.children.props.render(true)
  }
  const props = (panelElement('character') as ReactElement<{
    onSelectCard(id: string): void
    onPreviewCard(id: string): void
    onCreateTimelineFromCard(id: string): Promise<void>
    onOpenTimeline(timeline: { id: string }, cardId: string): void
  }>).props
  const sessionsProps = (panelElement('sessions') as ReactElement<{
    onDeleteTimeline(id: string): Promise<boolean>
    onArchiveImported(id: string): Promise<void>
  }>).props
  const historyProps = (panelElement('recent') as ReactElement<{ recent: ReactElement<{ onOpenRecent(visit: { cardId: string }): void }> }>).props
  const recentProps = historyProps.recent.props
  return { props, sessionsProps, recentProps, state, navigation, openRecentCharacter }
}

describe('Character browsing versus playing', () => {
  it('delegates recent visits to the App navigation owner', () => {
    const { recentProps, openRecentCharacter, state } = fixture()
    const visit = { cardId: 'recent-card' }
    recentProps.onOpenRecent(visit)
    expect(openRecentCharacter).toHaveBeenCalledExactlyOnceWith(visit)
    expect(state.activateTimeline).not.toHaveBeenCalled()
  })

  it('resets the story and default opening before showing the requested card preview', () => {
    const { props, state, navigation } = fixture()
    props.onPreviewCard('preview-card')
    expect(state.resetToDraftTimeline).toHaveBeenCalledOnce()
    expect(state.setSelectedCardId).toHaveBeenCalledWith('preview-card')
    expect(state.setOpeningChoice).not.toHaveBeenCalled()
    expect(navigation.openCardPreview).toHaveBeenCalledWith('preview-card')
    expect(state.createTimelineFromCard).not.toHaveBeenCalled()
    expect(state.activateTimeline).not.toHaveBeenCalled()
  })

  it('does not overwrite newer navigation when creation or deletion finishes', async () => {
    const { props, sessionsProps, state, navigation } = fixture()
    const creation = props.onCreateTimelineFromCard('external-card')
    const deletion = sessionsProps.onDeleteTimeline('playing-timeline')
    navigation.isCurrent.mockReturnValue(false)
    await creation
    await deletion
    expect(navigation.openNarrative).not.toHaveBeenCalled()
    expect(navigation.clearDeletedTimeline).not.toHaveBeenCalled()
    expect(state.setSelectedCardId).not.toHaveBeenCalled()
  })
  it('routes a committed archive through target resolution and does not steal later navigation', async () => {
    const { sessionsProps, navigation, state } = fixture()
    await sessionsProps.onArchiveImported('imported')
    expect(navigation.openUri).toHaveBeenCalledWith(expect.stringContaining('id=imported'))
    expect(state.activateTimeline).not.toHaveBeenCalled()
    navigation.openUri.mockClear()
    navigation.isCurrent.mockReturnValue(false)
    await sessionsProps.onArchiveImported('late')
    expect(navigation.openUri).not.toHaveBeenCalled()
    expect(state.refreshAllTimelines).toHaveBeenCalledTimes(2)
  })
  it('clears deleted Timeline navigation only after a successful deletion', async () => {
    const { sessionsProps, state, navigation } = fixture()
    state.deleteTimeline.mockResolvedValueOnce(false)
    await expect(sessionsProps.onDeleteTimeline('playing-timeline')).resolves.toBe(false)
    expect(navigation.clearDeletedTimeline).not.toHaveBeenCalled()
    await expect(sessionsProps.onDeleteTimeline('playing-timeline')).resolves.toBe(true)
    expect(navigation.clearDeletedTimeline).toHaveBeenCalledExactlyOnceWith('playing-timeline', 'playing-card')
  })

  it('opens the browsed card without activating or selecting it for play', () => {
    const { props, state, navigation } = fixture()
    props.onSelectCard('external-card')
    expect(navigation.openPanel).toHaveBeenCalledWith('character', { cardId: 'external-card' })
    expect(state.selectCardTimeline).not.toHaveBeenCalled()
    expect(state.setSelectedCardId).not.toHaveBeenCalled()
    expect(state.activateTimeline).not.toHaveBeenCalled()
    expect(navigation.openNarrative).not.toHaveBeenCalled()
  })

  it('keeps gallery selection inside the Play panel without changing play context', () => {
    const { props, state, navigation } = fixture()
    navigation.route.panel = 'play'
    props.onSelectCard('external-card')
    expect(navigation.openPanel).not.toHaveBeenCalled()
    expect(navigation.setSearchParams.mock.calls[0]?.[0].get('characterCard')).toBe('external-card')
    expect(state.setSelectedCardId).not.toHaveBeenCalled()
    expect(state.activateTimeline).not.toHaveBeenCalled()
  })

  it('starts a session for the explicitly browsed card, not the current playing card', async () => {
    const { props, state, navigation } = fixture()
    await props.onCreateTimelineFromCard('external-card')
    expect(state.createTimelineFromCard).toHaveBeenCalledWith('external-card', undefined, undefined)
    expect(state.setSelectedCardId).toHaveBeenCalledWith('external-card')
    expect(navigation.openNarrative).toHaveBeenCalledWith('new-timeline', 'new-branch')
  })

  it('publishes the selected saved story without activating from the panel', () => {
    const { props, state, navigation } = fixture()
    props.onOpenTimeline({ id: 'external-session' }, 'external-card')
    expect(navigation.openNarrative).toHaveBeenCalledExactlyOnceWith('external-session')
    expect(state.activateTimeline).not.toHaveBeenCalled()
    expect(state.setSelectedCardId).not.toHaveBeenCalled()
  })
})
