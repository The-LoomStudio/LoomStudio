import { describe, expect, it } from 'vitest'
import { extensionInstallationId } from '@loom-studio/extension-sdk'
import type { PromptResourceDisplayMetadata } from '@loom-studio/shared'
import { presetIconUrl } from '../../../apps/studio-client/src/shared/ui/extension-icon/extension-icon.js'

const packages = [
  { packageId: 'icons', displayName: 'Card B', target: { kind: 'card' as const, cardId: 'b' }, version: '2.0.0', archiveDigest: 'digest-b', iconUrl: '/b.png' },
  { packageId: 'icons', displayName: 'Global', target: { kind: 'global' as const }, version: '1.0.0', fileRevision: 'revision-global', iconUrl: '/global.png' },
  { packageId: 'icons', displayName: 'Card A', target: { kind: 'card' as const, cardId: 'a' }, version: '3.0.0', archiveDigest: 'digest-a', iconUrl: '/a.png' },
]
const icon: NonNullable<PromptResourceDisplayMetadata['icon']> = { kind: 'package', packageId: 'icons', path: 'assets/诺姆 笑.png' }

describe('Preset icon references', () => {
  it('resolves a cross-package global reference to its exact installation', () => {
    expect(presetIconUrl({ metadata: { icon: { ...icon, scope: 'global', target: { kind: 'global' } } }, origin: { kind: 'extension-package', packageId: 'assistant' } }, packages))
      .toBe('/extensions/icons/revision-global/files/assets/%E8%AF%BA%E5%A7%86%20%E7%AC%91.png')
  })
  it('preserves legacy global icons without a stored target', () => {
    expect(presetIconUrl({ metadata: { icon } }, packages)).toBe('/extensions/icons/revision-global/files/assets/%E8%AF%BA%E5%A7%86%20%E7%AC%91.png')
  })
  it('keeps the exact Card target after copying, regardless of catalog order', () => {
    const original = { metadata: { icon: { ...icon, scope: 'card' as const, target: { kind: 'card' as const, cardId: 'a' } } } }
    const copy = structuredClone(original)
    const expected = '/card-extensions/a/icons/3.0.0/digest-a/files/assets/%E8%AF%BA%E5%A7%86%20%E7%AC%91.png'
    expect(presetIconUrl(original, packages)).toBe(expected)
    expect(presetIconUrl(copy, [...packages].reverse())).toBe(expected)
  })
  it('never substitutes a source icon or another installation for an unresolved explicit reference', () => {
    const origin = { kind: 'extension-package', packageId: 'icons' }
    expect(presetIconUrl({ origin, metadata: { icon: { ...icon, scope: 'card' } } }, packages)).toBeUndefined()
    expect(presetIconUrl({ origin, metadata: { icon: { ...icon, target: { kind: 'card', cardId: 'missing' } } } }, packages)).toBeUndefined()
    expect(presetIconUrl({ origin, metadata: { icon: { ...icon, packageId: 'unknown', target: { kind: 'global' } } } }, packages)).toBeUndefined()
    expect(presetIconUrl({ origin, metadata: { icon: { ...icon, target: { kind: 'card', cardId: 'a' } } } }, packages.map(pkg => ({ ...pkg, archiveDigest: undefined })))).toBeUndefined()
  })
  it('uses a source icon only when no icon is declared, respecting the source installation', () => {
    expect(presetIconUrl({ origin: { kind: 'extension-package', packageId: 'icons' } }, packages)).toBe('/global.png')
    expect(presetIconUrl({ origin: { kind: 'extension-package', packageId: 'icons', installationId: extensionInstallationId('icons', { kind: 'card', cardId: 'a' }) } }, packages)).toBe('/a.png')
    expect(presetIconUrl({ origin: { kind: 'extension-package', packageId: 'icons', installationId: extensionInstallationId('icons', { kind: 'card', cardId: 'missing' }) } }, packages)).toBeUndefined()
  })
})
