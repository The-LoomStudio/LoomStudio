import { describe, expect, it } from 'vitest'
import {
  claimExclusiveRenderer,
  orderRendererContributions,
  rendererContributionKey,
  rendererInstanceKey,
  type RegisteredRendererContribution,
} from '../../../apps/studio-client/src/features/extension-renderers/model/renderer-registry.js'

function contribution(packageId: string, contributionId: string, suggestedOrder = 0): RegisteredRendererContribution {
  return {
    packageId,
    moduleId: 'client',
    contributionId,
    definition: {
      id: contributionId,
      name: contributionId,
      surface: 'narrative.timeline.tail',
      instanceScope: 'timeline',
      suggestedOrder,
    },
  }
}

describe('Renderer Registry conflict model', () => {
  it('orders collection contributions independently from registration timing', () => {
    const result = orderRendererContributions({
      contributions: [contribution('example.b', 'tail', 10), contribution('example.a', 'tail', -10)],
      surface: 'narrative.timeline.tail',
    })
    expect(result.contributions.map(rendererContributionKey)).toEqual([
      'example.a/client/tail',
      'example.b/client/tail',
    ])
  })

  it('lets user order override author suggestions and reports duplicates', () => {
    const first = contribution('example.a', 'tail', -10)
    const second = contribution('example.b', 'tail', 10)
    const result = orderRendererContributions({
      contributions: [first, second, first],
      surface: 'narrative.timeline.tail',
      userOrder: ['example.b/client/tail', 'example.a/client/tail'],
    })
    expect(result.contributions.map(rendererContributionKey)).toEqual([
      'example.b/client/tail',
      'example.a/client/tail',
    ])
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'renderer.duplicate' })])
  })

  it('rejects implicit exclusive replacement and supports explicit replacement', () => {
    expect(claimExclusiveRenderer({
      surface: 'shell.focus-surface',
      currentContributionKey: 'example.a/client/focus',
      requestedContributionKey: 'example.b/client/focus',
    })).toEqual(expect.objectContaining({ accepted: false }))
    expect(claimExclusiveRenderer({
      surface: 'shell.focus-surface',
      currentContributionKey: 'example.a/client/focus',
      requestedContributionKey: 'example.b/client/focus',
      replace: true,
    })).toEqual({
      accepted: true,
      contributionKey: 'example.b/client/focus',
      replacedContributionKey: 'example.a/client/focus',
    })
  })

  it('builds stable contribution and scope instance identities', () => {
    expect(rendererInstanceKey({
      packageId: 'example.a',
      moduleId: 'client',
      contributionId: 'tail',
      scopeKey: 'timeline-1',
    })).toBe('example.a/client/tail@timeline-1')
  })
})
