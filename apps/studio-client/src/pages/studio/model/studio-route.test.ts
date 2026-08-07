import { describe, expect, it } from 'vitest'
import { buildStudioChatPath, buildStudioEntryHash, buildStudioPanelPath, readStudioEntryAnchor, readStudioRoute } from './studio-route.js'

describe('studio routes', () => {
  it('reads chat, character and asset identities from paths', () => {
    expect(readStudioRoute('/studio/resources')).toEqual({ panel: 'resource' })
    expect(readStudioRoute('/studio/chat/session-1/branch/main')).toEqual({ panel: null, sessionId: 'session-1', branchId: 'main' })
    expect(readStudioRoute('/studio/characters/card-1')).toEqual({ panel: 'character', cardId: 'card-1' })
    expect(readStudioRoute('/studio/resources/card-1/asset-1')).toEqual({ panel: 'resource', cardId: 'card-1', assetId: 'asset-1' })
  })

  it('falls back to the chat route model for unknown paths', () => {
    expect(readStudioRoute('/studio/unknown')).toEqual({ panel: null })
  })

  it('builds encoded canonical paths', () => {
    expect(buildStudioChatPath('session one', 'main/branch')).toBe('/studio/chat/session%20one/branch/main%2Fbranch')
    expect(buildStudioPanelPath('preset', { cardId: 'card one', assetId: 'asset/two' })).toBe('/studio/presets/card%20one/asset%2Ftwo')
  })

  it('round-trips explicit entry anchors and rejects unrelated hashes', () => {
    expect(buildStudioEntryHash('entry/一')).toBe('#entry-entry%2F%E4%B8%80')
    expect(readStudioEntryAnchor('#entry-entry%2F%E4%B8%80')).toBe('entry/一')
    expect(readStudioEntryAnchor('#section-settings')).toBeUndefined()
    expect(readStudioEntryAnchor('#entry-%E0%A4%A')).toBeUndefined()
  })
})
