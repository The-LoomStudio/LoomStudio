import { useCallback, type SetStateAction } from 'react'
import { useStudioLayoutStore } from './studio-layout-store.js'

/**
 * Persistent browsing preferences at any tab depth; each independent group owns a stable key.
 * Use e.g. `scripts.scope`, `scripts.filter`, `scripts.detail`, not one active-tab slot per panel.
 * Branch-specific groups may include a stable parent view name in their key.
 * Unavailable choices fall back without overwriting the saved preference.
 * Route targets override these in the owning panel; resource IDs and drafts belong elsewhere.
 */
export function useWorkbenchView<T extends string>(key: string, fallback: T, choices: readonly T[]) {
  const stored = useStudioLayoutStore(state => state.viewPreferences[key])
  const value = choices.includes(stored as T) ? stored as T : fallback
  const setValue = useCallback((next: SetStateAction<T>) => {
    const state = useStudioLayoutStore.getState()
    const stored = state.viewPreferences[key]
    const current = choices.includes(stored as T) ? stored as T : fallback
    state.setViewPreference(key, typeof next === 'function' ? next(current) : next)
  }, [key, fallback, choices.join('\0')])
  return [value, setValue] as const
}
