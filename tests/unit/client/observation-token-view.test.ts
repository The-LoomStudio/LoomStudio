import { expect, it } from 'vitest'
import { messageMatches, messagePreview, messageTokenParts, sourceTokenParts, sumTokenParts } from '../../../apps/studio-client/src/features/observability/model/observation-token-view.js'
import { observationFixtures } from '../../../apps/studio-client/src/dev-preview/observability-fixtures.js'

it('counts repeated message occurrences and tool calls separately without treating missing counts as zero', () => {
  const parts = messageTokenParts([
    { id: 'a', role: 'assistant', content: 'same', toolCalls: [{ name: 'read', arguments: '{}' }] },
    { id: 'b', role: 'user', content: 'same' },
  ])
  expect(parts.map(part => part.group)).toEqual(['assistant', 'calls', 'user'])
  expect(sumTokenParts(parts, new Map([['same', 4]]))).toBeUndefined()
  expect(sumTokenParts(parts, new Map([['same', 4], [parts[1].text, 3]]))).toBe(11)
})

it('counts actual injections per anchor and does not also count source or container text', () => {
  const step = observationFixtures[0].steps[0]
  const parts = sourceTokenParts({ ...step, sources: [
    { ...step.sources[0], id: 'folder', rendered: 'must not count', injections: undefined },
    { ...step.sources[0], id: 'entry', rendered: 'must not count again', injections: [
      { id: 'one', targetAnchorId: '@a', rendered: 'first' },
      { id: 'two', targetAnchorId: '@b', rendered: 'second' },
    ] },
  ] })
  expect(parts.map(part => [part.text, part.anchor])).toEqual([['first', '@a'], ['second', '@b']])
})

it('searches beyond the brief preview and shows the matching context including tool arguments', () => {
  const message = { id: 'a', role: 'system', content: 'prefix '.repeat(500) + 'needle', toolCalls: [{ name: 'read', arguments: '{"path":"hidden"}' }] }
  expect(messagePreview(message)).not.toContain('needle')
  expect(messageMatches(message, 'NEEDLE')).toBe(true)
  expect(messagePreview(message, 'needle')).toContain('needle')
  expect(messageMatches(message, 'hidden')).toBe(true)
  expect(messagePreview(message, 'hidden')).toContain('hidden')
})
