import type { ThemeEntry } from './theme-catalog.js'
import type { ThemeOverrides, ThemeSelection } from './theme-store.js'

const officialStyleKeys: Record<string, string> = {
  'loom-theme-paper/paper': 'official.themes/paper',
  'loom-theme-paper/smooth-motion': 'official.themes/smooth-motion',
  'loom-theme-tide/tide': 'official.themes/tide',
  'loom-theme-tide/mint': 'official.themes/mint',
  'loom-theme-tide/amber': 'official.themes/amber',
}

/** Move preferences only after the replacement is installed and the old contribution is gone. */
export function migrateOfficialThemes(selection: ThemeSelection, overrides: ThemeOverrides, entries: readonly ThemeEntry[]) {
  const available = new Set(entries.filter(entry => entry.available).map(entry => entry.key))
  const present = new Set(entries.map(entry => entry.key))
  const replacements = Object.entries(officialStyleKeys).filter(([old, next]) => !present.has(old) && available.has(next))
  const aliases = new Map(replacements)
  const key = (value: string) => aliases.get(value) ?? value
  const selectedTheme = selection.theme ? key(selection.theme) : null
  const retired = new Set(['official.themes/paper', 'official.themes/tide', 'loom-theme-paper/paper', 'loom-theme-tide/tide'])
  const officialReady = entries.some(entry => entry.packageId === 'official.themes' && entry.available)
  const theme = selectedTheme && retired.has(selectedTheme) && officialReady && !present.has(selectedTheme) ? null : selectedTheme
  const enhancements = [...new Set(selection.enhancements.map(key))]
  const cssOnly = [...new Set(selection.cssOnly.map(key))]
  const selectionChanged = theme !== selection.theme
    || JSON.stringify(enhancements) !== JSON.stringify(selection.enhancements)
    || JSON.stringify(cssOnly) !== JSON.stringify(selection.cssOnly)
  let nextOverrides = overrides
  for (const [old, next] of replacements) {
    if (!overrides[old] || overrides[next]) continue
    nextOverrides = { ...nextOverrides, [next]: { ...overrides[old] } }
  }
  return {
    selection: selectionChanged ? { theme, enhancements, cssOnly } : selection,
    overrides: nextOverrides,
  }
}
