import { describe, expect, it } from 'vitest'
import { isDialogBackdropPoint } from './dialog-model.js'

describe('dialog backdrop hit testing', () => {
  const rect = { top: 100, right: 500, bottom: 400, left: 200 }

  it('distinguishes the backdrop from the dialog surface', () => {
    expect(isDialogBackdropPoint(rect, 199, 250)).toBe(true)
    expect(isDialogBackdropPoint(rect, 350, 401)).toBe(true)
    expect(isDialogBackdropPoint(rect, 350, 250)).toBe(false)
    expect(isDialogBackdropPoint(rect, 200, 100)).toBe(false)
  })
})
