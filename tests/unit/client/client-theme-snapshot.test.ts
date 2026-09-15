import { applyClientThemeSnapshot, publicThemeTokenNames, type ClientThemeSnapshot } from '@loom-studio/extension-sdk'
import { describe, expect, it, vi } from 'vitest'

describe('Client Theme Snapshot', () => {
  it('applies only the public token contract to an isolated root', () => {
    const setProperty = vi.fn()
    const root = { style: { colorScheme: '', setProperty } } as unknown as HTMLElement
    const tokens = Object.fromEntries(publicThemeTokenNames.map(name => [name, `value:${name}`])) as ClientThemeSnapshot['tokens']
    applyClientThemeSnapshot({ version: 1, colorScheme: 'dark', tokens }, root)
    expect(root.style.colorScheme).toBe('dark')
    expect(setProperty).toHaveBeenCalledTimes(publicThemeTokenNames.length)
    expect(setProperty).toHaveBeenCalledWith('--loom-color-text', 'value:--loom-color-text')
  })
})
