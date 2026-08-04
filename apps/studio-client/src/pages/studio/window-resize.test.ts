import { describe, expect, it } from 'vitest'
import { resizeWindow } from './window-resize.js'

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
  })
})
