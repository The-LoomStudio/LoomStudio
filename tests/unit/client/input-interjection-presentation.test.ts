import { describe, expect, it } from 'vitest'
import { buildRenderItems } from '../../../apps/studio-client/src/features/sessions/model/transcript-render-items.js'
import type { AgentTranscriptEntry } from '../../../apps/studio-client/src/entities/index.js'

const row = (id: string, sequence: number, entry: AgentTranscriptEntry['entry']): AgentTranscriptEntry => ({ id, sequence, entry, agentSessionId: 'session', createdAt: '2026-11-02T00:00:00Z' })
describe('interjection presentation', () => {
  const attachment = { assetId: 'image', name: 'image.png', mediaType: 'image/png', sizeBytes: 10, kind: 'image' as const }
  const pending = row('pending', 1, { kind: 'user-interjection', requestId: 'request', mode: 'discussion', content: '', attachments: [attachment] })
  it('keeps attachment-only persisted input visible before application', () => {
    expect(buildRenderItems([pending])).toMatchObject([{ kind: 'message', role: 'user', interjectionStatus: 'pending', message: { entry: { attachments: [attachment] } } }])
  })
  it('keeps discarded input visible without claiming it was applied', () => {
    const discarded = row('discarded', 2, { kind: 'interjection-discarded', requestId: 'request' })
    expect(buildRenderItems([pending, discarded])).toMatchObject([{ kind: 'message', interjectionStatus: 'discarded' }])
  })
  it('replaces pending presentation with its canonical user message', () => {
    const applied = row('applied', 2, { kind: 'interjection-applied', requestId: 'request' })
    const canonical = row('message', 3, { kind: 'message', role: 'user', content: '', interjectionRequestId: 'request', attachments: [attachment] })
    expect(buildRenderItems([pending, applied, canonical])).toMatchObject([{ kind: 'message', id: 'message', interjectionStatus: 'applied' }])
    expect(buildRenderItems([pending, applied, canonical])).toHaveLength(1)
  })
})
