import { describe, expect, it } from 'vitest'
import { readWindowResizeBounds, resizeWindow } from './window-resize.js'

describe('readWindowResizeBounds', () => {
  it('uses the stage edge and respects a finite CSS height limit', () => {
    const stage = { bottom: 900, right: 1400 }
    const dock = { left: 300, top: 120 }

    expect(readWindowResizeBounds(stage, dock, 640)).toEqual({ width: 1082, height: 640 })
    expect(readWindowResizeBounds(stage, dock, Number.NaN)).toEqual({ width: 1082, height: 762 })
    expect(readWindowResizeBounds(stage, dock, Number.NaN, 24)).toEqual({ width: 1076, height: 756 })
  })
})

describe('resizeWindow', () => {
  it('resizes only the selected axes', () => {
    expect(resizeWindow({ width: 760, height: 640 }, { x: 80, y: 100 }, { width: 1200, height: 900 }, 'horizontal'))
      .toEqual({ width: 840, height: 640 })
    expect(resizeWindow({ width: 760, height: 640 }, { x: 80, y: 100 }, { width: 1200, height: 900 }, 'vertical'))
      .toEqual({ width: 760, height: 740 })
  })

  it('keeps the window inside usable bounds', () => {
    expect(resizeWindow({ width: 760, height: 640 }, { x: 1000, y: 1000 }, { width: 1000, height: 800 }, 'both'))
      .toEqual({ width: 1000, height: 800 })
    expect(resizeWindow({ width: 760, height: 640 }, { x: -1000, y: -1000 }, { width: 1000, height: 800 }, 'both'))
      .toEqual({ width: 520, height: 360 })
    expect(resizeWindow(
      { width: 760, height: 640 },
      { x: -1000, y: -1000 },
      { width: 1000, height: 800 },
      'both',
      { edgeGap: 24, minimumHeight: 420, minimumWidth: 600 },
    )).toEqual({ width: 600, height: 420 })
  })
})
