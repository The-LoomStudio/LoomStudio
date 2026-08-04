import { describe, expect, it } from 'vitest'
import { clampExplorerWidth } from './asset-workbench-layout.js'

describe('clampExplorerWidth', () => {
  it('keeps the explorer above its minimum width', () => {
    expect(clampExplorerWidth(120)).toBe(180)
    expect(clampExplorerWidth(300)).toBe(300)
    expect(clampExplorerWidth(420)).toBe(420)
  })

  it('allows the explorer to occupy the full workspace', () => {
    expect(clampExplorerWidth(900, 560)).toBe(551)
  })
})
