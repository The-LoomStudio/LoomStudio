import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  createTextExtractionArtifact,
  extractHistory,
  HistoryExtractionBudgetExceededError,
  projectHistoryEntries,
  type HistoryTextEntry,
  type TextExtractorEntry,
  type TextTransformRuleEntry,
} from '@loom-studio/application-runtime'

vi.mock('node:crypto', async importOriginal => {
  const original = await importOriginal<typeof import('node:crypto')>()
  return { ...original, createHash: vi.fn(original.createHash) }
})

const source = { kind: 'agent-session', sessionId: 'session-1' } as const

it('hashes each matched step input once, skips unmatched steps and preserves match identities', async () => {
  const original = await vi.importActual<typeof import('node:crypto')>('node:crypto')
  vi.mocked(createHash).mockClear()
  const result = projectHistoryEntries({ source, phase: 'prompt', entries: [entry('sample', 0, 'aaa')], rules: [
    rule({ id: 'replace', orderIndex: 0, matcher: { kind: 'regex', pattern: 'a', flags: 'g' }, effect: { kind: 'replace', replacement: 'b' } }),
    rule({ id: 'mark', orderIndex: 1, matcher: { kind: 'regex', pattern: 'b', flags: 'g' }, effect: { kind: 'mark', markerType: 'sample' } }),
    rule({ id: 'unmatched', orderIndex: 2, matcher: { kind: 'regex', pattern: 'z', flags: 'g' } }),
  ] })
  expect(result.matches).toHaveLength(6)
  expect(createHash).toHaveBeenCalledTimes(8)
  const expected = [['replace', 'aaa', 0], ['mark', 'bbb', 1]].flatMap(([id, text, stepIndex]) => {
    const digest = original.createHash('sha256').update(String(text)).digest('hex')
    return Array.from({ length: 3 }, (_, occurrenceIndex) => `match:${original.createHash('sha256').update(JSON.stringify([
      ['agent-session', 'session-1', ''], 'prompt', 'sample', id, 1, stepIndex, occurrenceIndex, digest,
    ])).digest('hex')}`)
  })
  expect(result.matches.map(match => match.matchId)).toEqual(expected)
})

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

function entry(id: string, sequence: number, text: string): HistoryTextEntry<typeof source> {
  return { id, source, sequence, text, role: 'assistant' }
}

function extractor(overrides: Partial<TextExtractorEntry> = {}): TextExtractorEntry {
  return {
    id: 'probe', version: 1, name: 'Probe', owner: { kind: 'workspace' }, enabled: true, orderIndex: 0,
    targets: ['agent-session'], matcher: { kind: 'regex', pattern: '[\\s\\S]+', flags: '' },
    strategy: 'all-matches', parser: 'key-value-lines', createdAt: '', updatedAt: '', ...overrides,
  }
}

describe('history text projection', () => {
  it.each(['u', 'v'])('terminates Unicode %s empty extraction matches without splitting surrogate pairs', flags => {
    const snapshot = projectHistoryEntries({ source, phase: 'display', entries: [entry('message', 1, '😀')], rules: [] })
    const result = extractHistory({ snapshot, extractor: extractor({ matcher: { kind: 'regex', pattern: '(?:)', flags }, parser: 'text' }) })
    expect(result.values).toEqual(['', ''])
    expect(result.sourceEntryIds).toEqual(['message', 'message'])
    expect(result.diagnostics).toEqual([])
  })

  it('fails cumulative overlapping capture growth before returning a partial extraction', () => {
    const snapshot = projectHistoryEntries({ source, phase: 'display', entries: [entry('message', 1, 'a'.repeat(100))], rules: [] })
    expect(() => extractHistory({ snapshot,
      extractor: extractor({ matcher: { kind: 'regex', pattern: '(?=(.+))', flags: '', contentGroup: 1 }, parser: 'text' }),
      budget: { maxCapturedCharacters: 5_000 },
    })).toThrowError(expect.objectContaining({ code: 'text.extractor.budget_exceeded', budget: 'maxCapturedCharacters', actual: 5_005 }))
    expect(extractHistory({ snapshot,
      extractor: extractor({ matcher: { kind: 'regex', pattern: '(?=(.+))', flags: '', contentGroup: 1 }, parser: 'text' }),
      budget: { maxCapturedCharacters: 5_050 },
    }).values).toHaveLength(100)
  })

  it('counts invalid matches and diagnostics across entries and never converts budget errors to parse failures', () => {
    const snapshot = projectHistoryEntries({ source, phase: 'display', entries: [entry('old', 1, 'x x'), entry('new', 2, 'x x')], rules: [] })
    const input = { snapshot, extractor: extractor({ matcher: { kind: 'regex', pattern: 'x', flags: '' } }) }
    expect(() => extractHistory({ ...input, budget: { maxScannedMatches: 3 } }))
      .toThrowError(expect.objectContaining({ code: 'text.extractor.budget_exceeded', budget: 'maxScannedMatches', actual: 4 }))
    expect(() => extractHistory({ ...input, budget: { maxDiagnostics: 3 } }))
      .toThrowError(expect.objectContaining({ code: 'text.extractor.budget_exceeded', budget: 'maxDiagnostics', actual: 4 }))
    expect(extractHistory({ ...input, budget: { maxScannedMatches: 4, maxDiagnostics: 4 } }).diagnostics).toHaveLength(4)
  })

  it('accumulates captures and candidates across entries, including latest-valid candidates', () => {
    const snapshot = projectHistoryEntries({ source, phase: 'display', entries: [entry('old', 1, 'a a'), entry('new', 2, 'a a')], rules: [] })
    const input = { snapshot, extractor: extractor({ matcher: { kind: 'regex', pattern: 'a', flags: '' }, parser: 'text', strategy: 'latest-valid' }) }
    expect(() => extractHistory({ ...input, budget: { maxCapturedCharacters: 3 } }))
      .toThrowError(expect.objectContaining({ budget: 'maxCapturedCharacters', actual: 4 }))
    expect(() => extractHistory({ ...input, budget: { maxCandidates: 3 } }))
      .toThrowError(expect.objectContaining({ budget: 'maxCandidates', actual: 4 }))
    expect(extractHistory(input)).toMatchObject({ values: ['a'], sourceEntryIds: ['new'], stale: false })
  })

  it('bounds complete returned structure including source IDs, object keys and diagnostics', () => {
    const snapshot = projectHistoryEntries({ source, phase: 'display', entries: [entry('message', 1, 'x: y')], rules: [] })
    const input = { snapshot, extractor: extractor() }
    // Base result: 58 units; value object/key/string: 4; source ID string: 8.
    expect(extractHistory({ ...input, budget: { maxResultUnits: 70 } }).values).toEqual([{ x: 'y' }])
    expect(() => extractHistory({ ...input, budget: { maxResultUnits: 69 } }))
      .toThrowError(expect.objectContaining({ budget: 'maxResultUnits', actual: 70 }))
    const invalid = { ...input, extractor: extractor({ outputSchema: { type: 'object', required: ['missing'] } }) }
    expect(() => extractHistory({ ...invalid, budget: { maxResultUnits: 70 } })).toThrow(HistoryExtractionBudgetExceededError)
  })

  it('preserves latest-valid first-match order and stale status while retaining only the selected candidate', () => {
    const snapshot = projectHistoryEntries({ source, phase: 'display', entries: [entry('old', 1, 'x: old'), entry('new', 2, 'invalid\nx: first\nx: second')], rules: [] })
    const result = extractHistory({ snapshot, extractor: extractor({ matcher: { kind: 'regex', pattern: '[^\\n]+', flags: '' }, strategy: 'latest-valid' }) })
    expect(result).toMatchObject({ values: [{ x: 'first' }], sourceEntryIds: ['new'], stale: false })
    expect(result.diagnostics).toHaveLength(1)
  })

  it('preserves own special keys in key-value extraction, including repeated keys', () => {
    const snapshot = projectHistoryEntries({ source, phase: 'display', entries: [entry('message', 1,
      'x: 1\n__proto__: first\nconstructor: own\ntoString: text\n__proto__: last')], rules: [] })
    const result = extractHistory({ snapshot, extractor: extractor() })
    expect(result.values).toEqual([JSON.parse('{"x":"1","__proto__":"last","constructor":"own","toString":"text"}')])
    expect(Object.prototype.hasOwnProperty.call(result.values[0], '__proto__')).toBe(true)
    expect(Object.getPrototypeOf(result.values[0]!)).toBe(Object.prototype)
    expect(result.diagnostics).toEqual([])
  })

  it.each(['constructor', 'toString', '__proto__'])('requires an own %s output property', key => {
    const extract = (text: string) => extractHistory({
      snapshot: projectHistoryEntries({ source, phase: 'display', entries: [entry('message', 1, text)], rules: [] }),
      extractor: extractor({ outputSchema: { type: 'object', required: [key] } }),
    })
    const missing = extract('x: 1')
    expect(missing.values).toEqual([])
    expect(missing.diagnostics).toMatchObject([{ code: 'text.extractor.parse_failed', message: `Extractor output is missing required property: ${key}` }])
    const present = extract(`${key}: own`)
    expect(present.values).toHaveLength(1)
    expect(Object.prototype.hasOwnProperty.call(present.values[0], key)).toBe(true)
    expect(present.diagnostics).toEqual([])
  })

  it.each(['u', 'v'])('advances zero-width %s matches across complete Unicode code points', flags => {
    for (const phase of ['display', 'prompt'] as const) {
      for (const text of ['Hello', '😀 Hello']) {
        const result = projectHistoryEntries({ source, phase, entries: [entry('message', 1, text)],
          rules: [rule({ id: 'prefix', phases: [phase], matcher: { kind: 'regex', pattern: '^', flags },
            effect: { kind: 'replace', replacement: 'Prefix: ' } })] })
        expect(result.entries[0]!.text).toBe(`Prefix: ${text}`)
        expect(result.diagnostics).toEqual([])
      }
      const all = projectHistoryEntries({ source, phase, entries: [entry('message', 1, '😀')],
        rules: [rule({ id: 'empty', phases: [phase], matcher: { kind: 'regex', pattern: '(?:)', flags: `${flags}g` },
          effect: { kind: 'replace', replacement: '|' } })] })
      expect(all.entries[0]!.text).toBe('|😀|')
    }
  })

  it('isolates a display entry failure but keeps prompt processing strict', () => {
    const input = { source, entries: [entry('bad', 1, 'secret secret'), entry('good', 2, 'secret')],
      rules: [rule({ id: 'limited', phases: ['display', 'prompt'] })], budget: { maxMatchesPerRulePerEntry: 1 } }
    const result = projectHistoryEntries({ ...input, phase: 'display' })
    expect(result.entries.map(item => item.text)).toEqual(['secret secret', 'visible'])
    expect(result.diagnostics).toEqual([expect.objectContaining({ entryId: 'bad', code: 'text.entry.projection_failed' })])
    expect(result.matches.every(match => match.entryId === 'good')).toBe(true)
    expect(() => projectHistoryEntries({ ...input, phase: 'prompt' })).toThrow('match budget')
  })

  it('projects only requested entries while retaining full-history depth', () => {
    const result = projectHistoryEntries({ source, phase: 'prompt', entryIds: ['old'],
      entries: [entry('old', 1, 'secret'), entry('unrequested', 2, 'secret secret')],
      rules: [rule({ id: 'older-only', range: { minDepth: 1, maxDepth: 1 } })], budget: { maxEntries: 1, maxMatchesPerRulePerEntry: 1 } })
    expect(result.entries.map(item => [item.id, item.depth, item.text])).toEqual([['old', 1, 'visible']])
  })
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

  it('marks stable UTF-16 ranges without changing text and records one-entry trace', () => {
    const input = {
      source,
      phase: 'display' as const,
      entries: [entry('answer', 1, '前缀 Alice 后缀')],
      rules: [rule({
        id: 'alice-mark',
        phases: ['display'],
        matcher: { kind: 'regex', pattern: 'Alice', flags: 'g' },
        effect: { kind: 'mark', markerType: 'character' },
      })],
      traceEntryId: 'answer',
    }
    const first = projectHistoryEntries(input)
    const second = projectHistoryEntries(input)

    expect(first.entries[0]?.text).toBe('前缀 Alice 后缀')
    expect(first.matches[0]).toMatchObject({
      matchId: second.matches[0]?.matchId,
      inputRange: { start: 3, end: 8 },
      displayRange: { start: 3, end: 8 },
      stepIndex: 0,
      occurrenceIndex: 0,
    })
    expect(first.trace).toMatchObject({
      entryId: 'answer',
      canonicalText: '前缀 Alice 后缀',
      finalText: '前缀 Alice 后缀',
      steps: [{ matched: true, effect: 'mark' }],
    })
  })

  it('shifts marked display ranges after earlier replacements', () => {
    const snapshot = projectHistoryEntries({
      source,
      phase: 'display',
      entries: [entry('answer', 1, 'prefix TARGET suffix')],
      rules: [
        rule({ id: 'mark', phases: ['display'], matcher: { kind: 'regex', pattern: 'TARGET', flags: 'g' }, effect: { kind: 'mark' } }),
        rule({ id: 'expand-prefix', phases: ['display'], orderIndex: 1, matcher: { kind: 'regex', pattern: 'prefix', flags: 'g' }, effect: { kind: 'replace', replacement: 'long-prefix' } }),
      ],
    })

    expect(snapshot.entries[0]?.text).toBe('long-prefix TARGET suffix')
    expect(snapshot.matches.find(match => match.ruleId === 'mark')?.displayRange).toEqual({ start: 12, end: 18 })
  })

  it('invalidates marked display ranges after overlapping replacements', () => {
    const snapshot = projectHistoryEntries({
      source,
      phase: 'display',
      entries: [entry('answer', 1, 'prefix TARGET suffix')],
      rules: [
        rule({ id: 'mark', phases: ['display'], matcher: { kind: 'regex', pattern: 'TARGET', flags: 'g' }, effect: { kind: 'mark' } }),
        rule({ id: 'replace-target', phases: ['display'], orderIndex: 1, matcher: { kind: 'regex', pattern: 'TARGET', flags: 'g' }, effect: { kind: 'replace', replacement: 'changed' } }),
      ],
    })

    expect(snapshot.matches.find(match => match.ruleId === 'mark')?.displayRange).toBeUndefined()
  })

  it('preserves native replacement token semantics while tracking edits', () => {
    const text = 'xABy'
    const replacement = "[$$][$&][$1][$<word>][$`][$']"
    const pattern = '(?<word>A)(B)'
    const snapshot = projectHistoryEntries({
      source,
      phase: 'display',
      entries: [entry('answer', 1, text)],
      rules: [rule({
        id: 'replacement-tokens',
        phases: ['display'],
        matcher: { kind: 'regex', pattern, flags: 'g' },
        effect: { kind: 'replace', replacement },
      })],
    })

    expect(snapshot.entries[0]?.text).toBe(text.replace(new RegExp(pattern, 'g'), replacement))
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

    const artifact = createTextExtractionArtifact({
      source,
      phase: 'display',
      extractor: { ...extractor, artifactType: 'loom/world-state' },
      extraction: result,
    })
    expect(artifact).toMatchObject({
      artifactType: 'loom/world-state',
      extractorId: 'world-state',
      values: [{ value: { 时间: '第1天', 地点: '酒馆' }, sourceEntryId: 'old' }],
      stale: true,
    })
  })
})
