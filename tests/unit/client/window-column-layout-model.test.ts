import { describe, expect, it } from 'vitest'
import { clampColumnSize, commitColumnSize, readColumnMaximum, resolveColumnSizes } from '../../../apps/studio-client/src/shared/ui/window-column-layout/window-column-layout-model.js'

describe('Window Column Layout sizing', () => {
  it('keeps drag preview continuous and applies optional collapse snapping on commit', () => {
    const constraints = { collapsedSize: 42, minSize: 96, maxSize: 320, snapThreshold: 96 }
    expect(clampColumnSize(70, constraints)).toBe(70)
    expect(commitColumnSize(70, constraints)).toBe(42)
    expect(commitColumnSize(120, constraints)).toBe(120)
  })

  it('reserves the remaining Columns and Splitters', () => {
    expect(readColumnMaximum(0, [160, 220, 0], [96, 180, 320], 2, 900)).toBe(342)
    expect(readColumnMaximum(1, [160, 220, 0], [96, 180, 320], 2, 900)).toBe(402)
  })

  it('rejects malformed sizes without escaping constraints', () => {
    expect(clampColumnSize(Number.NaN, { minSize: 180, maxSize: 420 })).toBe(180)
  })

  it('compresses high-priority Columns without overwriting their requested size', () => {
    const columns = [
      { collapsedSize: 42, minSize: 96, size: 160, snapThreshold: 96, shrinkPriority: 100 },
      { fill: true, minSize: 320, size: 320 },
    ]
    expect(resolveColumnSizes(columns, 520)).toEqual([160, 320])
    expect(resolveColumnSizes(columns, 400)).toEqual([42, 320])
    expect(columns[0]?.size).toBe(160)
  })
})
