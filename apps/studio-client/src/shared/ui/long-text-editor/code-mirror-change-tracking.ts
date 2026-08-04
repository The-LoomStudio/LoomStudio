import { Chunk, type DiffConfig } from '@codemirror/merge'
import { Text } from '@codemirror/state'

export type ChangedLine = {
  kind: 'added' | 'modified' | 'deleted'
  line: number
}

export const CHANGE_TRACKING_DIFF_CONFIG: DiffConfig = {
  // ponytail: 大文本优先保证输入响应；需要逐字精确 Diff 时改为后台 Worker 计算。
  scanLimit: 5000,
  timeout: 40,
}

export function buildChangedChunks(baseline: Text, current: Text): readonly Chunk[] {
  return Chunk.build(baseline, current, CHANGE_TRACKING_DIFF_CONFIG)
}

export function readChangedLines(current: Text, chunks: readonly Chunk[]): ChangedLine[] {
  const result = new Map<number, ChangedLine['kind']>()

  for (const chunk of chunks) {
    for (const change of chunk.changes) {
      const fromA = chunk.fromA + change.fromA
      const toA = chunk.fromA + change.toA
      const fromB = chunk.fromB + change.fromB
      const toB = chunk.fromB + change.toB

      if (fromB === toB) {
        setChangedLine(result, current.lineAt(Math.min(fromB, current.length)).number, 'deleted')
        continue
      }

      if (fromA === toA) {
        const inserted = current.sliceString(fromB, toB)
        if (!inserted.includes('\n')) {
          setChangedLine(result, current.lineAt(fromB).number, 'modified')
          continue
        }

        const firstLine = current.lineAt(fromB).number + (inserted.startsWith('\n') ? 1 : 0)
        const lastLine = current.lineAt(Math.max(fromB, toB - 1)).number
        for (let line = firstLine; line <= lastLine; line += 1) setChangedLine(result, line, 'added')
        continue
      }

      const firstLine = current.lineAt(Math.min(fromB, current.length)).number
      const lastLine = current.lineAt(Math.max(fromB, Math.min(current.length, toB) - 1)).number
      for (let line = firstLine; line <= lastLine; line += 1) setChangedLine(result, line, 'modified')
    }
  }

  return [...result.entries()].sort(([a], [b]) => a - b).map(([line, kind]) => ({ kind, line }))
}

export function readSelectionBoundaryLines(
  current: Text,
  ranges: readonly { from: number; to: number }[],
): number[] {
  const lines = new Set<number>()
  for (const range of ranges) {
    lines.add(current.lineAt(range.from).number)
    lines.add(current.lineAt(range.from === range.to ? range.to : Math.max(range.from, range.to - 1)).number)
  }
  return [...lines].sort((a, b) => a - b)
}

function setChangedLine(result: Map<number, ChangedLine['kind']>, line: number, kind: ChangedLine['kind']) {
  const priority = { added: 1, modified: 2, deleted: 3 }
  const current = result.get(line)
  if (!current || priority[kind] > priority[current]) result.set(line, kind)
}
