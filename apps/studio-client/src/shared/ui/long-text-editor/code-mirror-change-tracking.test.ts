import { Text } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { buildChangedChunks, readChangedLines, readSelectionBoundaryLines } from './code-mirror-change-tracking.js'

function lines(value: string) {
  const current = Text.of(value.split('\n'))
  return readChangedLines(current, buildChangedChunks(Text.of('alpha\nbeta'.split('\n')), current))
}

describe('CodeMirror change tracking', () => {
  it('marks inserted and modified lines against the opening baseline', () => {
    expect(lines('alpha changed\nbeta\ngamma')).toEqual([
      { kind: 'modified', line: 1 },
      { kind: 'added', line: 3 },
    ])
  })

  it('marks the nearest surviving line when content is deleted', () => {
    expect(lines('alpha')).toEqual([{ kind: 'deleted', line: 1 }])
  })

  it('marks only the first and last line of a multiline selection', () => {
    const current = Text.of(['alpha', 'beta', 'gamma', 'delta'])
    expect(readSelectionBoundaryLines(current, [{ from: 2, to: 15 }])).toEqual([1, 3])
  })
})
