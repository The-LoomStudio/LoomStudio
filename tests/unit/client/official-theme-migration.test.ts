import { describe, expect, it } from 'vitest'
import { readThemeCatalog } from '../../../apps/studio-client/src/features/themes/model/theme-catalog.js'
import { migrateOfficialThemes } from '../../../apps/studio-client/src/features/themes/model/official-theme-migration.js'
import type { ManagedExtensionPackage } from '../../../apps/studio-client/src/entities/extension.js'
import type { ThemeOverrides } from '../../../apps/studio-client/src/features/themes/model/theme-store.js'

const pkg: ManagedExtensionPackage = {
  packageId: 'official.themes', version: '1.1.0', displayName: '官方主题', tags: [], available: true, sourceKinds: [], modules: [],
  resources: {
    themes: [{ id: 'paper', label: '纸页', css: './paper.css' }, { id: 'tide', label: '潮汐', css: './tide.css' }],
    styles: [{ id: 'smooth-motion', label: '动效', css: './motion.css' }, { id: 'mint', label: '薄荷', css: './mint.css' }],
  },
}
const selection = { theme: 'loom-theme-paper/paper', enhancements: ['loom-theme-paper/smooth-motion', 'loom-theme-tide/mint'], cssOnly: ['loom-theme-paper/smooth-motion'] }
const overrides: ThemeOverrides = { 'loom-theme-paper/paper': { texture: 0.7 }, 'loom-theme-tide/tide': { radius: 20 } }

describe('official theme consolidation', () => {
  it('lists every theme in one package and preserves selection, CSS-only mode and inactive parameters on replacement', () => {
    const entries = readThemeCatalog([pkg])
    expect(entries.filter(entry => entry.kind === 'theme').map(entry => entry.key)).toEqual(['official.themes/paper', 'official.themes/tide'])
    const migrated = migrateOfficialThemes(selection, overrides, entries)
    expect(migrated.selection).toEqual({ theme: 'official.themes/paper', enhancements: ['official.themes/smooth-motion', 'official.themes/mint'], cssOnly: ['official.themes/smooth-motion'] })
    expect(migrated.overrides['official.themes/paper']).toEqual({ texture: 0.7 })
    expect(migrated.overrides['official.themes/tide']).toEqual({ radius: 20 })
    expect(overrides['official.themes/paper']).toBeUndefined()
    expect(migrateOfficialThemes(migrated.selection, migrated.overrides, entries)).toEqual(migrated)
  })
  it('waits for installation, retains installed legacy contributions and keeps existing new-package overrides', () => {
    expect(migrateOfficialThemes(selection, overrides, []).selection).toBe(selection)
    const legacy = { ...pkg, packageId: 'loom-theme-paper' }
    expect(migrateOfficialThemes(selection, overrides, readThemeCatalog([pkg, legacy])).selection.theme).toBe(selection.theme)
    const custom = { ...overrides, 'official.themes/paper': { texture: 0.2 } }
    expect(migrateOfficialThemes(selection, custom, readThemeCatalog([pkg])).overrides['official.themes/paper']).toEqual({ texture: 0.2 })
    expect(migrateOfficialThemes(selection, overrides, readThemeCatalog([{ ...pkg, available: false }])).selection).toBe(selection)
  })
})
