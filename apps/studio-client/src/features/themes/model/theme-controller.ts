import type { ThemeTransitionOrigin } from './theme-transition.js'
import type { StyleParameterValue } from '@loom-studio/extension-sdk'
import type { ThemeEntry } from './theme-catalog.js'
import type { ThemeSelection } from './theme-store.js'

export type ThemeController = {
  entries: readonly ThemeEntry[]
  selection: ThemeSelection
  busy: boolean
  error?: string
  apply(selection: ThemeSelection, origin?: ThemeTransitionOrigin): Promise<void>
  authorize(entry: ThemeEntry): Promise<void>
  setParameter(entry: ThemeEntry, id: string, value: StyleParameterValue | undefined): Promise<void>
  reset(): void
}
