import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { createStudioPanels } from '../../../apps/studio-client/src/app/studio-panel-registry.js'

function fixture() {
  const state = {
    api: {}, cards: [], allTimelines: [], cardTimelines: [],
    selectedCardId: 'playing-card',
    selectCardTimeline: vi.fn(),
    setSelectedCardId: vi.fn(),
    createTimelineFromCard: vi.fn(async () => ({ timelineId: 'new-timeline', branchId: 'new-branch' })),
    activateTimeline: vi.fn(async () => 'saved-branch'),
    narrativeTimeline: { id: 'playing-timeline', createdFrom: { cardId: 'playing-card' } },
    deleteTimeline: vi.fn(async (_id: string) => true),
  }
  const navigation = {
    route: { panel: 'character', cardId: 'browsed-card', timelineId: 'playing-timeline', branchId: 'playing-branch' },
    searchParams: new URLSearchParams(),
    openPanel: vi.fn(),
    openNarrative: vi.fn(),
    clearDeletedTimeline: vi.fn(),
  }
  const panels = createStudioPanels({
    state, navigation, resourcePanels: {},
  } as unknown as Parameters<typeof createStudioPanels>[0])
  const props = (panels.character(true) as ReactElement<{
    onSelectCard(id: string): void
    onCreateTimelineFromCard(id: string): Promise<void>
    onOpenTimeline(timeline: { id: string }, cardId: string): void
  }>).props
  const sessionsProps = (panels.sessions(true) as ReactElement<{
    onDeleteTimeline(id: string): Promise<boolean>
  }>).props
  return { props, sessionsProps, state, navigation }
}

describe('Character browsing versus playing', () => {
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

  it('starts a session for the explicitly browsed card, not the current playing card', async () => {
    const { props, state, navigation } = fixture()
    await props.onCreateTimelineFromCard('external-card')
    expect(state.createTimelineFromCard).toHaveBeenCalledWith('external-card')
    expect(state.setSelectedCardId).toHaveBeenCalledWith('external-card')
    expect(navigation.openNarrative).toHaveBeenCalledWith('new-timeline', 'new-branch')
  })

  it('changes play context only when opening a saved session succeeds', async () => {
    const { props, state, navigation } = fixture()
    props.onOpenTimeline({ id: 'external-session' }, 'external-card')
    expect(state.setSelectedCardId).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(navigation.openNarrative).toHaveBeenCalledWith('external-session', 'saved-branch'))
    expect(state.activateTimeline).toHaveBeenCalledWith('external-session')
    expect(state.setSelectedCardId).toHaveBeenCalledWith('external-card')
  })
})
