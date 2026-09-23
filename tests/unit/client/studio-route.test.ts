import { describe, expect, it } from 'vitest'
import { readStudioNodeAnchor, readStudioRoute } from '../../../apps/studio-client/src/shared/studio-shell/studio-route.js'

describe('studio routes', () => {
  it('reads chat, character and asset identities from paths', () => {
    expect(readStudioRoute('/studio/resources')).toEqual({ panel: 'resource' })
    expect(readStudioRoute('/studio/agents')).toEqual({ panel: 'agent' })
    expect(readStudioRoute('/studio/play')).toEqual({ panel: 'play' })
    expect(readStudioRoute('/studio/history')).toEqual({ panel: 'sessions' })
    expect(readStudioRoute('/studio/extensions')).toEqual({ panel: 'extensions' })
    expect(readStudioRoute('/studio/chat/timeline-1/branch/main')).toEqual({ panel: null, timelineId: 'timeline-1', branchId: 'main' })
    expect(readStudioRoute('/studio/characters/card-1')).toEqual({ panel: 'character', cardId: 'card-1' })
    expect(readStudioRoute('/studio/resources/card-1/asset-1')).toEqual({ panel: 'resource', cardId: 'card-1', assetId: 'asset-1' })
  })

  it('falls back to the chat route model for unknown paths', () => {
    expect(readStudioRoute('/studio/unknown')).toEqual({ panel: null })
  })

  it('reads explicit node anchors and rejects unrelated hashes', () => {
    expect(readStudioNodeAnchor('#node-node%2F%E4%B8%80')).toBe('node/一')
    expect(readStudioNodeAnchor('#section-settings')).toBeUndefined()
    expect(readStudioNodeAnchor('#node-%E0%A4%A')).toBeUndefined()
  })
})
