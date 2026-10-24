import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ManagedExtensionPackage } from '../../../entities/extension.js'
import type { StudioApi } from '../../../shared/api/studio-api.js'
import type { ThemeController } from './theme-controller.js'
import { parameterCss, readThemeCatalog } from './theme-catalog.js'
import { setSharedAppearanceParameter, isSharedAppearanceParameter } from './appearance-parameters.js'
import { useAppearanceStore } from '../../../shared/studio-shell/appearance-store.js'
import { useStudioLayoutStore } from '../../../shared/studio-shell/studio-layout-store.js'
import { createThemeRuntime, themeSignature } from './theme-runtime.js'
import { styleRegistry } from './style-registry.js'
import { migrateOfficialThemes } from './official-theme-migration.js'
import { defaultThemeSelection, useThemeStore, type ThemeOverrides, type ThemeSelection } from './theme-store.js'

export function useThemeRuntime(input: {
  packages: readonly ManagedExtensionPackage[]
  ready: boolean
  authorize: (packageId: string, moduleId: string, grants?: Parameters<StudioApi['extensions']['enable']>[2]) => Promise<unknown>
}): ThemeController & { startupReady: boolean } {
  const entries = useMemo(() => readThemeCatalog(input.packages), [input.packages])
  const registryRevision = useSyncExternalStore(styleRegistry.subscribe, styleRegistry.revision, styleRegistry.revision)
  const preferences = useThemeStore()
  const sharedAppearance = useAppearanceStore(state => JSON.stringify([state.explicitOverrides, state.canvasWidth, state.material.blur, state.material.opacity]))
  const sharedScale = useStudioLayoutStore(state => `${state.uiScaleOverridden}/${state.uiScale}`)
  const runtime = useRef<ReturnType<typeof createThemeRuntime> | undefined>(undefined)
  const [startupReady, setStartupReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const request = useRef(0)
  const latest = useRef({ entries, preferences })
  latest.current = { entries, preferences }

  const apply = useCallback(async (selection: ThemeSelection, overrides: ThemeOverrides = useThemeStore.getState().overrides) => {
    if (!runtime.current) return
    const sequence = ++request.current
    setBusy(true); setError(undefined)
    try {
      const success = await runtime.current.apply(latest.current.entries, selection, overrides)
      if (sequence === request.current && success) useThemeStore.getState().commit(selection, overrides)
    } catch (reason) {
      if (sequence === request.current) setError(reason instanceof Error ? reason.message : String(reason))
    } finally { if (sequence === request.current) { setBusy(false); setStartupReady(true) } }
  }, [])

  const reset = useCallback(() => {
    request.current++
    runtime.current?.reset()
    const store = useThemeStore.getState()
    store.commit(defaultThemeSelection, store.overrides)
    store.setCustomCss('')
    setError(undefined); setBusy(false); setStartupReady(true)
  }, [])

  useEffect(() => {
    const instance = createThemeRuntime(setError)
    runtime.current = instance
    const recover = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.altKey && event.shiftKey && event.code === 'KeyT') {
        event.preventDefault(); reset()
      }
    }
    window.addEventListener('keydown', recover, true)
    // Recovery is available even if a stylesheet obscures all ordinary controls.
    if (new URLSearchParams(location.search).get('appearance') === 'native') reset()
    return () => {
      request.current++
      window.removeEventListener('keydown', recover, true)
      instance.dispose()
      if (runtime.current === instance) runtime.current = undefined
    }
  }, [reset])

  useEffect(() => {
    if (!input.ready || !runtime.current) return
    const saved = useThemeStore.getState()
    const { selection, overrides } = migrateOfficialThemes(saved.selection, saved.overrides, entries)
    if (selection !== saved.selection || overrides !== saved.overrides) saved.commit(selection, overrides)
    const available = (key: string) => {
      const entry = entries.find(item => item.key === key)
      return entry?.available && (!entry.definition.moduleId || selection.cssOnly.includes(key) || entry.module?.desired.enabled)
    }
    const next = {
      ...selection,
      theme: selection.theme && available(selection.theme) ? selection.theme : null,
      enhancements: selection.enhancements.filter(available),
    }
    if (next.theme !== selection.theme || next.enhancements.length !== selection.enhancements.length) {
      void apply(next, overrides).then(() => setError('Unavailable or disabled style contributions were removed; native appearance remains available.'))
      return
    }
    if (runtime.current.signature() === themeSignature(entries, selection, overrides)) return
    void apply(selection, overrides)
  }, [entries, input.ready, registryRevision, sharedAppearance, sharedScale, apply])

  useEffect(() => {
    const style = document.createElement('style')
    style.dataset.loomUserStyles = ''
    style.textContent = `@layer loom-user { ${preferences.customCss} }`
    document.head.append(style)
    document.dispatchEvent(new Event('loom:theme-changed'))
    return () => { style.remove() }
  }, [preferences.customCss, preferences.selection, preferences.overrides])

  return {
    entries, selection: preferences.selection, busy, error, startupReady,
    apply,
    async authorize(entry) {
      if (!entry.module) return
      setBusy(true); setError(undefined)
      try {
        // Explicit user action authorizes code execution only; existing capability grants are not expanded.
        await input.authorize(entry.packageId, entry.module.moduleId, entry.module.desired.grants)
      } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
      finally { setBusy(false) }
    },
    async setParameter(entry, id, value) {
      const parameter = entry.definition.parameters?.find(item => item.id === id)
      if (!parameter) throw new Error(`Unknown appearance parameter: ${id}`)
      if (value !== undefined) parameterCss(parameter, value)
      if (isSharedAppearanceParameter(parameter.variable)) {
        setSharedAppearanceParameter(parameter.variable, value)
        return
      }
      const store = useThemeStore.getState()
      const overrides = structuredClone(store.overrides)
      overrides[entry.key] ??= {}
      if (value === undefined) delete overrides[entry.key][id]
      else overrides[entry.key][id] = value
      await apply(store.selection, overrides)
    },
    reset,
  }
}
