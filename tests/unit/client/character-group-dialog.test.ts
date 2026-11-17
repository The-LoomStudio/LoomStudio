import { describe, expect, it, vi } from 'vitest'
import { characterPanelProps, renderCharacterPanel } from '../../support/client/character-panel.js'

const gallery = vi.hoisted(() => ({
  groupsOpen: true,
  activeGroupId: undefined,
  assignments: {},
  groups: [{ id: 'group-1', name: 'Test group', order: 0 }],
}))

vi.mock('../../../apps/studio-client/src/widgets/character-panel/character-gallery-store.js', () => ({
  useCharacterGalleryStore: () => gallery,
}))

const props = characterPanelProps()

describe('Character Group Dialog', () => {
  it('renders the real shared native dialog with an associated title and group controls', () => {
    gallery.groupsOpen = true
    const html = renderCharacterPanel(props)
    const dialog = html.match(/<dialog\b[^>]*>(?:(?!<\/dialog>)[\s\S])*?character-group-dialog[\s\S]*?<\/dialog>/)?.[0]
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
    const html = renderCharacterPanel(props)
    expect(html).not.toContain('character-group-dialog')
  })
})
