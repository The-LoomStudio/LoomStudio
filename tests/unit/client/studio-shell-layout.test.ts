import { describe, expect, it } from 'vitest'
import { resolveRailPresentation } from '../../../apps/studio-client/src/pages/studio/studio-shell-layout.js'

describe('studio shell rail presentation', () => {
  it('derives compact display from the active panel and restores the preferred width on close', () => {
    expect(resolveRailPresentation(null, 224)).toEqual({ compact: false, preferredWidth: 224, visibleWidth: 224 })
    expect(resolveRailPresentation('resource', 224)).toEqual({ compact: true, preferredWidth: 224, visibleWidth: 42 })
    expect(resolveRailPresentation('preset', 224)).toEqual({ compact: true, preferredWidth: 224, visibleWidth: 42 })
    expect(resolveRailPresentation(null, 42)).toEqual({ compact: false, preferredWidth: 160, visibleWidth: 160 })
    expect(resolveRailPresentation('resource', 42)).toEqual({ compact: true, preferredWidth: 160, visibleWidth: 42 })
  })
})
