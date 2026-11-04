import { describe, expect, it } from 'vitest'
import { runHistoryTextIsolated, type HistoryTextJob } from '../../../packages/application-runtime/src/transforms/history-text-isolation.js'
import type { TextExtractorEntry, TextTransformRuleEntry } from '../../../packages/application-runtime/src/transforms/history-text.js'

const source = { kind: 'agent-session' as const, sessionId: 'isolated' }
function job(pattern: string, text = 'aab'): HistoryTextJob<typeof source> {
  const rule: TextTransformRuleEntry = {
    id: 'regex', version: 1, name: 'Regex', owner: { kind: 'workspace' }, enabled: true, orderIndex: 0,
    matcher: { kind: 'regex', pattern, flags: 'g' }, effect: { kind: 'replace', replacement: 'X' },
    targets: ['agent-session'], phases: ['display'], createdAt: '', updatedAt: '',
  }
  return { projection: { source, phase: 'display', rules: [rule], entries: [{ id: 'entry', source, sequence: 0, text }] } }
}
function extractor(pattern: string): TextExtractorEntry {
  return { id: 'extract', version: 1, name: 'Extract', owner: { kind: 'workspace' }, enabled: true, orderIndex: 0,
    targets: ['agent-session'], matcher: { kind: 'regex', pattern, flags: '' }, parser: 'text', strategy: 'all-matches', createdAt: '', updatedAt: '' }
}

describe('isolated history text execution', () => {
  it('executes native advanced JavaScript expressions and extracts the projected result in one real worker', async () => {
    const input = job('(?<=a)(?<same>a)\\k<same>', 'aaab')
    input.extractors = [extractor('X')]
    const result = await runHistoryTextIsolated(input)
    expect(result.snapshot.entries[0]!.text).toBe('aXb')
    expect(result.extractions[0]!.values).toEqual(['X'])
  })

  it('preserves extraction budget failures across the worker instead of returning partial values', async () => {
    const input = job('z', 'a'.repeat(5_001))
    input.extractors = [extractor('a')]
    await expect(runHistoryTextIsolated(input)).rejects.toMatchObject({ code: 'text.extractor.budget_exceeded', budget: 'maxCandidates', limit: 5_000, actual: 5_001 })
  })

  it('bounds the combined extraction reply across multiple individually valid extractors', async () => {
    const input = job('z', 'a'.repeat(800_000))
    input.extractors = Array.from({ length: 3 }, (_, index) => ({ ...extractor('a+'), id: `extract-${index}` }))
    await expect(runHistoryTextIsolated(input)).rejects.toMatchObject({ code: 'text.extractor.budget_exceeded', budget: 'maxResultUnits', limit: 2_000_000 })
  })

  it('terminates catastrophic regex, bounds active/queued work and total waiting, then accepts valid work', async () => {
    const input = job('(a+)+$', `${'a'.repeat(100_000)}!`)
    const extractionInput = job('z', `${'a'.repeat(100_000)}!`)
    extractionInput.projection.rules = []
    extractionInput.extractors = [extractor('(a+)+$')]
    let ticks = 0
    const ticker = setInterval(() => ticks++, 20)
    const started = Date.now()
    let results: PromiseSettledResult<unknown>[]
    try {
      results = await Promise.allSettled(Array.from({ length: 19 }, (_, index) => runHistoryTextIsolated(index % 2 ? extractionInput : input)))
    } finally { clearInterval(ticker) }
    expect(ticks).toBeGreaterThan(20)
    expect(Date.now() - started).toBeLessThan(9_000)
    const codes = results.map(result => result.status === 'rejected' ? result.reason.code : 'success')
    expect(codes.filter(code => code === 'text.execution_busy')).toHaveLength(1)
    expect(codes.filter(code => code === 'text.execution_timeout')).toHaveLength(18)
    expect((await runHistoryTextIsolated(job('a'))).snapshot.entries[0]!.text).toBe('XXb')
  }, 15_000)
})
