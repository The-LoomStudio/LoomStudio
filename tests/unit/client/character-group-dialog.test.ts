import { createElement, type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { CharacterPanel } from '../../../apps/studio-client/src/widgets/character-panel/character-panel.js'

const gallery = vi.hoisted(() => ({
  groupsOpen: true,
  activeGroupId: undefined,
  assignments: {},
  groups: [{ id: 'group-1', name: 'Test group', order: 0 }],
}))

vi.mock('../../../apps/studio-client/src/widgets/character-panel/character-gallery-store.js', () => ({
  useCharacterGalleryStore: () => gallery,
}))

const props: ComponentProps<typeof CharacterPanel> = {
  active: true,
  busy: false,
  cardDraft: { name: '', userName: '', description: '' },
  cards: [],
  timelines: [],
  t: key => key,
  onChangeCardDraft: () => undefined,
  onCreateCard: async () => undefined,
  onCreateTimelineFromCard: async () => undefined,
  onExportCard: async () => undefined,
  onImportCards: async () => undefined,
  onDeleteCards: async () => undefined,
  onPreviewCardDeletion: async () => ({ timelines: [] }),
  onSelectCard: () => undefined,
  onOpenTimeline: () => undefined,
  onOpenStatePanel: () => undefined,
  onUpdateCardMedia: async () => undefined,
  onUpdateCard: async () => undefined,
}

describe('Character Group Dialog', () => {
  it('renders the real shared native dialog with an associated title and group controls', () => {
    gallery.groupsOpen = true
    const html = renderToStaticMarkup(createElement(CharacterPanel, props))
    const dialog = html.match(/<dialog\b[^>]*>[\s\S]*?character-group-dialog[\s\S]*?<\/dialog>/)?.[0]
    expect(dialog).toBeDefined()
    expect(dialog).toContain('data-loom-ui-dialog=""')
    expect(dialog).toContain('role="dialog"')
    const titleId = dialog!.match(/aria-labelledby="([^"]+)"/)?.[1]
    expect(titleId).toBeDefined()
    expect(dialog).toContain(`<h2 id="${titleId}">character.groups</h2>`)
    expect(dialog).toContain('aria-label="character.closeGroups"')
    expect(dialog).toContain('autofocus=""')
    expect(dialog).toContain('character.allGroups')
    expect(dialog).toContain('character.ungrouped')
    expect(dialog).toContain('Test group')
    expect(dialog).toContain('aria-label="character.renameGroup"')
    expect(dialog).toContain('aria-label="character.deleteGroup"')
    expect(dialog).toContain('aria-label="character.newGroup"')
    expect(dialog).toContain('maxLength="40"')
    expect(dialog).toContain('disabled="" type="submit"')
  })

  it('unmounts the group dialog when its existing open state is false', () => {
    gallery.groupsOpen = false
    const html = renderToStaticMarkup(createElement(CharacterPanel, props))
    expect(html).not.toContain('character-group-dialog')
  })
})
