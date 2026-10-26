// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { CharacterPanel } from '../../../apps/studio-client/src/widgets/character-panel/character-panel.js'
import { characterPanelProps } from '../../support/client/character-panel.js'
import { useCards } from '../../../apps/studio-client/src/features/cards/model/use-cards.js'
import type { StudioApi } from '../../../apps/studio-client/src/shared/api/studio-api.js'

// @ts-expect-error React act environment flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true

function mount(timelines: Array<{ id: string; createdAt: string; updatedAt: string }> = [], validationError?: string, staleDetail = false) {
  const card = { id: 'card', name: 'Card', version: 7, opening: { id: 'root-opening', content: 'Opening text' }, validationError }
  const props = characterPanelProps({
    cards: validationError ? [{ ...card, id: 'valid-card', name: 'Valid card', validationError: undefined }, card] : [card], routeCardId: card.id,
    onCreateTimelineFromCard: vi.fn(async () => {}),
    onOpenTimeline: vi.fn(), onPreviewCard: vi.fn(), onSelectCard: vi.fn(),
  })
  const get = vi.spyOn(props.resourceApi.cards, 'get')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  if (!validationError || staleDetail) client.setQueryData(['character-browser', props.endpoint, card.id], { card: { ...card, validationError: undefined }, timelines })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  act(() => root.render(createElement(QueryClientProvider, { client }, createElement(CharacterPanel, props))))
  const button = (label: string) => {
    const result = Array.from(container.querySelectorAll('button')).find(item => item.textContent === label || item.title === label)
    if (!result) throw new Error(`Missing button: ${label}`)
    return result
  }
  return {
    props, button, container, get,
    close() {
      act(() => root.unmount())
      container.remove()
      client.clear()
    },
  }
}

describe('Character opening entry commands', () => {
  it.each([false, true])('keeps an invalid card selectable and deletable without strict reads or play commands (stale cache=%s)', async staleDetail => {
    const reason = 'Opening must contain a single string content'
    const view = mount([], reason, staleDetail)
    try {
      await act(async () => {})
      expect(view.container.textContent).toContain('Valid card')
      expect(view.container.querySelector('[data-loom-card-invalid]')).not.toBeNull()
      expect(view.container.querySelector('[role="alert"]')?.textContent).toBe(reason)
      const invalidCardButton = view.container.querySelector<HTMLButtonElement>(`button[title="${reason}"]`)!
      expect(invalidCardButton.disabled).toBe(false)
      act(() => invalidCardButton.click())
      expect(view.props.onSelectCard).toHaveBeenCalledWith('card')
      expect(view.get).not.toHaveBeenCalled()
      for (const label of ['character.continueNarrative', 'character.newNarrative', 'character.preview']) {
        expect(view.button(label).disabled).toBe(true)
        act(() => view.button(label).click())
      }
      expect(view.props.onCreateTimelineFromCard).not.toHaveBeenCalled()
      expect(view.props.onOpenTimeline).not.toHaveBeenCalled()
      expect(view.props.onPreviewCard).not.toHaveBeenCalled()
      expect(view.button('character.delete').disabled).toBe(false)
      expect(view.container.querySelector('textarea[aria-label="character.opening"]')).toBeNull()
    } finally { view.close() }
  })

  it('blocks global strict Card reads for invalid selection and clears previously loaded valid details', async () => {
    const good = { id: 'good', artifactId: 'work', version: 1, name: 'Good card', preset: {},
      opening: { id: 'opening', content: 'Welcome' }, lore: { entries: [] }, createdAt: 'now', updatedAt: 'now' }
    const bad = { ...good, id: 'bad', name: 'Bad card', validationError: 'Invalid opening' }
    const get = vi.fn(async () => ({ card: good }))
    const api = { cards: { list: async () => ({ cards: [bad, good] }), get } } as unknown as StudioApi
    let state!: ReturnType<typeof useCards>
    function Probe() {
      state = useCards({ api, initialCardName: '', recordEdit: () => {}, t: key => key, runAction: async action => { await action() } })
      return null
    }
    const container = document.createElement('div')
    const root = createRoot(container)
    try {
      act(() => root.render(createElement(Probe)))
      await act(async () => { await state.refreshCards() })
      expect(state.selectedCardId).toBe('bad')
      expect(get).not.toHaveBeenCalled()
      await act(async () => { state.setSelectedCardId('bad') })
      expect(get).not.toHaveBeenCalled()
      await act(async () => { state.setSelectedCardId('good') })
      expect(state.selectedCardDetails?.id).toBe('good')
      get.mockClear()
      await act(async () => { state.setSelectedCardId('bad') })
      expect(get).not.toHaveBeenCalled()
      expect(state.selectedCardDetails).toBeUndefined()
    } finally { act(() => root.unmount()) }
  })

  it('disables continue without a saved story, creates immediately and previews independently', async () => {
    const view = mount()
    try {
      expect(view.container.querySelector<HTMLTextAreaElement>('textarea[aria-label="character.opening"]')?.value).toBe('Opening text')
      expect(view.button('character.continueNarrative').disabled).toBe(true)
      await act(async () => view.button('character.newNarrative').click())
      expect(view.props.onCreateTimelineFromCard).toHaveBeenCalledExactlyOnceWith('card', { kind: 'card', id: 'root-opening' }, 7)
      act(() => view.button('character.preview').click())
      expect(view.props.onPreviewCard).toHaveBeenCalledExactlyOnceWith('card')
      expect(view.props.onOpenTimeline).not.toHaveBeenCalled()
    } finally { view.close() }
  })

  it('continues the latest updated story even when the saved-story list is sorted oldest first', () => {
    const latest = { id: 'latest', createdAt: '2026-01-01', updatedAt: '2026-10-14' }
    const older = { id: 'older', createdAt: '2026-10-01', updatedAt: '2026-10-02' }
    const view = mount([older, latest])
    try {
      act(() => view.button('character.sortLatest').click())
      act(() => view.button('character.continueNarrative').click())
      expect(view.props.onOpenTimeline).toHaveBeenCalledExactlyOnceWith(latest, 'card')
      expect(view.props.onCreateTimelineFromCard).not.toHaveBeenCalled()
    } finally { view.close() }
  })
})
