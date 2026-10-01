import { describe, expect, it } from 'vitest'
import { collectTokenEntries, aggregateTokenCounts } from '../../../apps/studio-client/src/features/context-assets/model/resource-token-counts.js'
import type { ContextAssetNode } from '../../../apps/studio-client/src/entities/context-asset.js'
import { estimateRequestTokens } from '@loom-studio/ai-gateway'
import { countText } from '@loom-studio/tokenizer'

describe('resource token counting', () => {
  const root: ContextAssetNode = {
    id: 'r', label: 'root', kind: 'folder', body: 'not injected', children: [
      { id: 'a', label: 'a', kind: 'entry', body: 'one' },
      { id: 'b', label: 'b', kind: 'folder', enabled: false, children: [{ id: 'c', label: 'c', kind: 'entry', body: 'two' }] },
      { id: 'script', label: 'script', kind: 'script', body: 'not injected' },
    ],
  }
  it('counts only Entry bodies, including disabled raw text', () => {
    expect(collectTokenEntries([root])).toEqual([{ id: 'a', body: 'one' }, { id: 'c', body: 'two' }])
    const result = aggregateTokenCounts([root], new Map([['a', 1], ['c', 2]]), 0.6)
    expect(result.total).toBe(2)
    expect(result.enabled).toBe(1)
    expect(result.nodes.get('b')).toEqual({ total: 2, enabled: 0, resident: 0, nonresident: 0 })
  })
  it('inherits enabled status and rounds aggregate only once', () => {
    expect(aggregateTokenCounts([{ ...root, enabled: false }], new Map([['a', 1], ['c', 2]])).enabled).toBe(0)
    expect(aggregateTokenCounts([root], new Map([['a', 1], ['c', 1]]), 0.1).total).toBe(1)
  })
  it('splits enabled bodies into only resident and nonresident, inheriting parent gates', () => {
    const roots: ContextAssetNode[] = [
      { id: 'always', kind: 'entry', label: '', body: 'a' },
      { id: 'conditional', kind: 'folder', label: '', capabilities: { activation: { kind: 'keyword', keywords: ['x'] } }, children: [
        { id: 'child', kind: 'entry', label: '', body: 'b', capabilities: { activation: { kind: 'always' } } },
      ] },
      { id: 'manual', kind: 'entry', label: '', body: 'c', capabilities: { activation: { kind: 'manual' } } },
      { id: 'off', kind: 'entry', label: '', body: 'd', enabled: false },
    ]
    const result = aggregateTokenCounts(roots, new Map([['always', 10], ['child', 20], ['manual', 30], ['off', 40]]))
    expect(result).toMatchObject({ total: 100, enabled: 60, resident: 10, nonresident: 50 })
  })
})

describe('canonical request content estimation', () => {
  it('includes actual call arguments and native schema, without extra content tool duplication', () => {
    const result = estimateRequestTokens({
      messages: [
        { role: 'system', content: 'CONTENT_TOOL_GUIDANCE' },
        { role: 'assistant', tool_calls: [{ id: '1', type: 'function', function: { name: 'read', arguments: '{"x":1}' } }] },
        { role: 'tool', tool_call_id: '1', content: 'result' },
      ],
      tools: [{ name: 'read', description: 'Read text', inputSchema: { type: 'object' } }],
    }, { multiplier: 0.6 })
    const expected = ['CONTENT_TOOL_GUIDANCE', 'read', '{"x":1}', 'result', 'read', 'Read text', '{"type":"object"}']
      .reduce((sum, text) => sum + countText(text).baseTokens, 0)
    expect(result.baseTokens).toBe(expected)
    expect(result.estimatedTokens).toBe(Math.ceil(expected * 0.6))
    expect(result.uncounted).toContain('provider-role-framing')
  })
})
