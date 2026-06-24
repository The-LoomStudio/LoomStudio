import { formatRendererEventLabel } from '../../../apps/studio-client/src/features/renderer-poc/model/use-renderer-session.js'
import { formatRenderingLabMessageEvent } from '../../../apps/studio-client/src/features/rendering-lab/model/use-rendering-lab-messages.js'
import { describe, expect, it } from 'vitest'

describe('client renderer event helpers', () => {
  it('formats renderer SSE event labels', () => {
    const label = formatRendererEventLabel({ type: 'message.new' }, new Date('2026-06-22T08:00:00.000Z'))

    expect(label).toContain('message.new')
  })

  it('accepts only rendering lab postMessage payloads', () => {
    const time = new Date('2026-06-22T08:00:00.000Z')

    expect(formatRenderingLabMessageEvent({ source: 'other' }, time)).toBeUndefined()
    expect(formatRenderingLabMessageEvent({
      source: 'loom-rendering-lab',
      type: 'agent-iframe',
      value: 'approve',
    }, time)).toContain('agent-iframe: approve')
  })
})
