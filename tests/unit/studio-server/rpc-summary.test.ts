import { describe, expect, it } from 'vitest'
import { formatEntityMention, sanitizeRpcParams, summarizeRpc } from '../../../apps/studio-server/src/rpc-summary.js'

describe('rpc-summary & entity mentions', () => {
  it('formats entity mentions with and without label', () => {
    expect(formatEntityMention('card', 'card-123')).toBe('<@card:card-123>')
    expect(formatEntityMention('card', 'card-123', '爱丽丝')).toBe('<@card:card-123|爱丽丝>')
    expect(formatEntityMention('card', 'card-123', 'card-123')).toBe('<@card:card-123>')
  })

  it('sanitizes sensitive credential keys from params', () => {
    const raw = {
      apiKey: 'sk-1234567890abcdef',
      secretValue: 'super-secret',
      cardId: 'card-123',
      name: '爱丽丝',
      config: {
        token: 'xyz',
        nested: { password: 'pass', normal: 'hello' },
      },
    }
    const sanitized = sanitizeRpcParams(raw) as Record<string, unknown>
    expect(sanitized.apiKey).toBe('***')
    expect(sanitized.secretValue).toBe('***')
    expect(sanitized.cardId).toBe('card-123')
    expect(sanitized.name).toBe('爱丽丝')
    expect((sanitized.config as Record<string, unknown>).token).toBe('***')
    expect(((sanitized.config as Record<string, unknown>).nested as Record<string, unknown>).password).toBe('***')
    expect(((sanitized.config as Record<string, unknown>).nested as Record<string, unknown>).normal).toBe('hello')
  })

  it('summarizes listAgentProfiles', () => {
    const summary = summarizeRpc('application.listAgentProfiles', {}, {
      profiles: [
        { id: 'agent-1', name: '爱丽丝' },
        { id: 'agent-2', name: '艾伦' },
      ],
    })
    expect(summary.textSuffix).toBe('2 profiles: [<@agent:agent-1|爱丽丝>, <@agent:agent-2|艾伦>]')
    expect(summary.summaryData?.itemCount).toBe(2)
  })

  it('summarizes createCard and getCard', () => {
    const summary = summarizeRpc('application.createCard', { name: '爱丽丝' }, {
      card: { id: 'card-99', name: '爱丽丝' },
    })
    expect(summary.textSuffix).toBe('<@card:card-99|爱丽丝>')
    expect(summary.summaryData?.cardId).toBe('card-99')
  })

  it('summarizes prompt resources', () => {
    const summary = summarizeRpc('application.listPromptResources', { cardId: 'card-99' }, {
      resources: [
        { id: 'res-1', name: '设定集', resourceKind: 'folder' },
      ],
    })
    expect(summary.textSuffix).toBe('1 resources: [<@resource:res-1|设定集>]')
    expect(summary.summaryData?.itemCount).toBe(1)
  })

  it('summarizes narrative timelines', () => {
    const summary = summarizeRpc('application.createNarrativeTimeline', { cardId: 'card-99' }, {
      timeline: { id: 'tml-42', cardId: 'card-99' },
    })
    expect(summary.textSuffix).toBe('<@timeline:tml-42> for <@card:card-99>')
  })
})
