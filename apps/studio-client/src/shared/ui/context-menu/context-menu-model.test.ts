import { describe, expect, it } from 'vitest'
import { movedBeyondLongPressThreshold, placeContextMenu } from './context-menu-model.js'

describe('placeContextMenu', () => {
  it('keeps a menu inside the viewport', () => {
    expect(placeContextMenu(
      { x: 790, y: 590 },
      { width: 180, height: 220 },
      { width: 800, height: 600 },
    )).toEqual({ x: 612, y: 372 })
  })

  it('keeps the requested position when there is enough space', () => {
    expect(placeContextMenu(
      { x: 120, y: 80 },
      { width: 180, height: 220 },
      { width: 800, height: 600 },
    )).toEqual({ x: 120, y: 80 })
  })
})

describe('movedBeyondLongPressThreshold', () => {
  it('cancels a long press only after meaningful pointer movement', () => {
    expect(movedBeyondLongPressThreshold({ x: 10, y: 10 }, { x: 15, y: 15 })).toBe(false)
    expect(movedBeyondLongPressThreshold({ x: 10, y: 10 }, { x: 20, y: 10 })).toBe(true)
  })
})
