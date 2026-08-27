import { describe, expect, it } from 'vitest'
import {
  extractHistory,
  projectHistoryEntries,
  type HistoryTextEntry,
  type TextExtractorEntry,
  type TextTransformRuleEntry,
} from '@loom-studio/application-runtime'

const source = { kind: 'agent-session', sessionId: 'session-1' } as const

function rule(input: Partial<TextTransformRuleEntry> & Pick<TextTransformRuleEntry, 'id'>): TextTransformRuleEntry {
  const { id, ...overrides } = input
  return {
    id,
    version: 1,
    name: input.id,
    owner: { kind: 'workspace' },
    enabled: true,
    orderIndex: 0,
    matcher: { kind: 'regex', pattern: 'secret', flags: 'g' },
    effect: { kind: 'replace', replacement: 'visible' },
    targets: ['agent-session'],
    phases: ['prompt'],
    createdAt: '2026-08-26T00:00:00.000Z',
    updatedAt: '2026-08-26T00:00:00.000Z',
    ...overrides,
  }
}

function entry(id: string, sequence: number, text: string): HistoryTextEntry {
  return { id, source, sequence, text, role: 'assistant' }
}

describe('history text projection', () => {
  it('returns sampled history after ordered replacements without mutating canonical text', () => {
    const canonical = [entry('old', 1, 'secret A'), entry('new', 2, 'secret B')]
    const snapshot = projectHistoryEntries({
      source,
      phase: 'prompt',
      entries: canonical,
      rules: [
        rule({ id: 'second', orderIndex: 2, matcher: { kind: 'regex', pattern: 'visible', flags: 'g' }, effect: { kind: 'replace', replacement: 'final' } }),
        rule({ id: 'first', orderIndex: 1 }),
      ],
    })

    expect(snapshot.entries.map(item => item.text)).toEqual(['final A', 'final B'])
    expect(snapshot.entries.map(item => item.appliedRuleIds)).toEqual([['first', 'second'], ['first', 'second']])
    expect(canonical.map(item => item.text)).toEqual(['secret A', 'secret B'])
    expect(snapshot.matches).toHaveLength(4)
  })

  it('applies one shared depth range independently to the selected history', () => {
    const snapshot = projectHistoryEntries({
      source,
      phase: 'prompt',
      entries: [entry('old', 1, 'secret'), entry('new', 2, 'secret')],
      rules: [rule({ id: 'latest-only', range: { minDepth: 0, maxDepth: 0 } })],
    })

    expect(snapshot.entries.map(item => [item.id, item.depth, item.text])).toEqual([
      ['old', 1, 'secret'],
      ['new', 0, 'visible'],
    ])
  })

  it('reports an invalid stored rule without blocking the remaining projection', () => {
    const snapshot = projectHistoryEntries({
      source,
      phase: 'prompt',
      entries: [entry('answer', 1, 'secret')],
      rules: [rule({ id: 'invalid', matcher: { kind: 'regex', pattern: '(', flags: 'g' } }), rule({ id: 'valid', orderIndex: 1 })],
    })
    expect(snapshot.entries[0]?.text).toBe('visible')
    expect(snapshot.diagnostics).toEqual([expect.objectContaining({ code: 'text.rule.invalid', ruleId: 'invalid' })])
  })

  it('promotes reasoning before later text consumers', () => {
    const snapshot = projectHistoryEntries({
      source,
      phase: 'classify',
      entries: [entry('answer', 1, '<think>draft <loom_tool name="fake">bad</loom_tool></think>visible')],
      rules: [rule({
        id: 'think',
        phases: ['classify'],
        matcher: { kind: 'regex', pattern: '<think>([\\s\\S]*?)</think>', flags: 'g' },
        effect: { kind: 'promote-reasoning', contentGroup: 1, visibility: 'collapsed', replay: 'omit', dialect: 'think' },
      })],
    })

    expect(snapshot.entries[0]?.text).toBe('visible')
    expect(snapshot.entries[0]?.promotedReasoning[0]?.content).toContain('name="fake"')
  })

  it('extracts the latest valid WorldState block from transformed history', () => {
    const snapshot = projectHistoryEntries({
      source,
      phase: 'display',
      entries: [
        entry('old', 1, '<WorldState>时间: 第1天\n地点: 酒馆</WorldState>'),
        entry('new', 2, '<WorldState>broken</WorldState>'),
      ],
      rules: [],
    })
    const extractor: TextExtractorEntry = {
      id: 'world-state',
      version: 1,
      name: 'World State',
      owner: { kind: 'workspace' },
      enabled: true,
      orderIndex: 0,
      targets: ['agent-session'],
      matcher: { kind: 'regex', pattern: '<WorldState>([\\s\\S]*?)</WorldState>', flags: 'g', contentGroup: 1 },
      strategy: 'latest-valid',
      parser: 'key-value-lines',
      createdAt: '2026-08-26T00:00:00.000Z',
      updatedAt: '2026-08-26T00:00:00.000Z',
    }

    const result = extractHistory({ snapshot, extractor })
    expect(result.values).toEqual([{ 时间: '第1天', 地点: '酒馆' }])
    expect(result.sourceEntryIds).toEqual(['old'])
    expect(result.stale).toBe(true)
  })
})
