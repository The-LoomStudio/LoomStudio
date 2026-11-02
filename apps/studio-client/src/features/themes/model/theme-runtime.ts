import { transitionTheme, type ThemeTransitionOrigin } from './theme-transition.js'
import type { ExtensionRegistrationHandle, StyleParameterValue } from '@loom-studio/extension-sdk'
import { parameterCss, type ThemeEntry } from './theme-catalog.js'
import { loadStyleSheet, type PreparedStyle } from './style-loader.js'
import { styleMotion } from './style-motion.js'
import { styleRegistry, type StyleFactoryRegistration } from './style-registry.js'
import { defaultThemeSelection, type ThemeOverrides, type ThemeSelection } from './theme-store.js'
import { isSharedAppearanceParameter, readSharedAppearanceParameter } from './appearance-parameters.js'

type PreparedEntry = { entry: ThemeEntry; sheet: PreparedStyle; factory?: StyleFactoryRegistration; parameters: Record<string, StyleParameterValue> }
type MountedEntry = { controller: AbortController; dispose(): Promise<void> }
type Snapshot = {
  selection: ThemeSelection
  overrides: ThemeOverrides
  entries: PreparedEntry[]
  parameters: HTMLStyleElement
  instances: MountedEntry[]
  signature: string
}

export function themeSignature(entries: readonly ThemeEntry[], selection: ThemeSelection, overrides: ThemeOverrides): string {
  const keys = [selection.theme, ...selection.enhancements].filter((key): key is string => key !== null)
  return JSON.stringify([selection, overrides, keys.map(key => {
    const entry = entries.find(item => item.key === key)
    return [entry, styleRegistry.get(key)?.revision, entry?.definition.parameters?.map(parameter => readSharedAppearanceParameter(parameter.variable))]
  })])
}

/** CSS is prepared before the current adoption is touched; only successful transitions are persisted. */
export function createThemeRuntime(onError: (message: string) => void) {
  let current: Snapshot | undefined
  let pending: AbortController | undefined
  let queue: Promise<void> = Promise.resolve()
  let disposed = false
  const motionRules = document.createElement('style')
  motionRules.textContent = `@layer loom-motion {
    html[data-loom-native-motion="disable"] *, html[data-loom-native-motion="disable"] *::before,
    html[data-loom-native-motion="disable"] *::after { animation: none; transition: none; }
    html[data-loom-motion="reduce"] *, html[data-loom-motion="reduce"] *::before,
    html[data-loom-motion="reduce"] *::after { animation: none !important; transition: none !important; }
  }`
  document.head.append(motionRules)

  function updateMotion(snapshot?: Snapshot) {
    const motion = snapshot?.entries.reduce<'retain' | 'disable'>((value, item) => item.entry.definition.nativeMotion ?? value, 'retain') ?? 'retain'
    styleMotion.setOwners(snapshot?.entries.map(item => item.entry.key) ?? [], motion)
  }

  async function mount(prepared: PreparedEntry, transition?: AbortSignal): Promise<MountedEntry> {
    const controller = new AbortController()
    const handles: ExtensionRegistrationHandle[] = []
    const source = prepared.factory
    let cleanup: Promise<void> | undefined
    const instance: MountedEntry = {
      controller,
      dispose() {
        if (cleanup) return cleanup
        controller.abort()
        source?.signal.removeEventListener('abort', revoked)
        cleanup = (async () => {
          const results = await Promise.allSettled(handles.splice(0).reverse().map(handle => Promise.resolve().then(() => handle.dispose())))
          const errors = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
          if (errors.length) throw new AggregateError(errors.map(result => result.reason), `Style cleanup failed: ${prepared.entry.key}`)
        })()
        return cleanup
      },
    }
    const revoked = () => { void instance.dispose().catch(error => onError(String(error))) }
    if (!source) return instance
    source.signal.throwIfAborted()
    source.signal.addEventListener('abort', revoked, { once: true })
    transition?.addEventListener('abort', revoked, { once: true })
    let timer: ReturnType<typeof setTimeout> | undefined
    let aborted: (() => void) | undefined
    try {
      // Factories must return their cleanup handle. A late result after cancellation is still disposed.
      const activation = Promise.resolve().then(() => source.factory({
        signal: controller.signal,
        parameters: Object.freeze({ ...prepared.parameters }),
        animations: {
          register(surface, handler) {
            controller.signal.throwIfAborted()
            const handle = styleMotion.register(prepared.entry.key, surface, handler, controller.signal)
            handles.push(handle)
            return handle
          },
        },
      })).then(async handle => {
        if (!handle) return
        if (controller.signal.aborted) await handle.dispose()
        else handles.push(handle)
      })
      const interrupted = new Promise<never>((_, reject) => {
        aborted = () => reject(new Error(`Style activation cancelled: ${prepared.entry.key}`))
        controller.signal.addEventListener('abort', aborted, { once: true })
        // ponytail: An extension may never resolve activate; keep theme recovery reachable without a new sandbox runtime.
        timer = setTimeout(() => controller.abort(), 10_000)
      })
      await Promise.race([activation, interrupted])
      controller.signal.throwIfAborted()
      return instance
    } catch (error) {
      await instance.dispose()
      throw error
    } finally {
      clearTimeout(timer)
      transition?.removeEventListener('abort', revoked)
      if (aborted) controller.signal.removeEventListener('abort', aborted)
    }
  }

  async function stop(snapshot: Snapshot) {
    const instances = snapshot.instances.splice(0)
    const results = await Promise.allSettled(instances.map(instance => instance.dispose()))
    const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failure) throw failure.reason
  }
  function remove(snapshot: Snapshot) {
    snapshot.parameters.remove()
    for (const item of snapshot.entries) item.sheet.dispose()
  }
  async function activate(snapshot: Snapshot, signal?: AbortSignal) {
    for (const item of snapshot.entries) item.sheet.activate()
    snapshot.parameters.media = 'all'
    updateMotion(snapshot)
    for (const item of snapshot.entries) {
      signal?.throwIfAborted()
      const instance = await mount(item, signal)
      snapshot.instances.push(instance)
    }
    signal?.throwIfAborted()
    // External stylesheets have completed loading; update iframe snapshots after computed values change.
    document.dispatchEvent(new Event('loom:theme-changed'))
  }

  async function prepare(catalog: readonly ThemeEntry[], selection: ThemeSelection, overrides: ThemeOverrides, signal: AbortSignal): Promise<Snapshot> {
    const keys = [selection.theme, ...selection.enhancements].filter((key): key is string => key !== null)
    if (new Set(keys).size !== keys.length) throw new Error('Duplicate style contribution in selection')
    const definitions = keys.map(key => {
      const entry = catalog.find(item => item.key === key)
      if (!entry?.available) throw new Error(`Style contribution is unavailable: ${key}`)
      if ((key === selection.theme) !== (entry.kind === 'theme')) throw new Error(`Invalid style selection: ${key}`)
      const cssOnly = selection.cssOnly.includes(key)
      if (cssOnly && entry.definition.moduleId && !entry.definition.supportsCssOnly) throw new Error(`This theme requires JavaScript: ${entry.definition.label}`)
      const factory = entry.definition.moduleId && !cssOnly ? styleRegistry.get(key) : undefined
      if (entry.definition.moduleId && !cssOnly && (!entry.module?.desired.enabled || !factory || factory.signal.aborted)) {
        throw new Error(`Authorize and enable the JavaScript module before applying: ${entry.definition.label}`)
      }
      const parameters: Record<string, StyleParameterValue> = {}
      for (const parameter of entry.definition.parameters ?? []) {
        const value = isSharedAppearanceParameter(parameter.variable)
          ? readSharedAppearanceParameter(parameter.variable) ?? parameter.default
          : overrides[key]?.[parameter.id] ?? parameter.default
        parameterCss(parameter, value)
        parameters[parameter.id] = value
      }
      return { entry, factory, parameters }
    })
    const entries: PreparedEntry[] = []
    const parameters = document.createElement('style')
    parameters.media = 'not all'
    const snapshot: Snapshot = { selection, overrides, entries, parameters, instances: [], signature: themeSignature(catalog, selection, overrides) }
    try {
      let enhancement = 0
      const declarations: string[] = []
      const user: string[] = []
      for (const item of definitions) {
        const layer = item.entry.kind === 'theme' ? 'loom-theme' : `loom-enhancements.e${enhancement++}`
        const sheet = await loadStyleSheet(item.entry.url, signal, layer)
        entries.push({ ...item, sheet })
        const defaults = (item.entry.definition.parameters ?? []).map(parameter => {
          if (!isSharedAppearanceParameter(parameter.variable) && overrides[item.entry.key]?.[parameter.id] !== undefined) user.push(`${parameter.variable}:${parameterCss(parameter, item.parameters[parameter.id])};`)
          return `${parameter.variable}:${parameterCss(parameter, parameter.default)};`
        }).join('')
        declarations.push(`@layer ${layer} { :root { ${defaults} } }`)
      }
      parameters.textContent = `${declarations.join('\n')}\n@layer loom-user { :root { ${user.join('')} } }`
      document.head.append(parameters)
      signal.throwIfAborted()
      return snapshot
    } catch (error) { remove(snapshot); throw error }
  }

  return {
    signature: () => current?.signature,
    apply(catalog: readonly ThemeEntry[], selection: ThemeSelection, overrides: ThemeOverrides, origin?: ThemeTransitionOrigin): Promise<boolean> {
      pending?.abort()
      const controller = new AbortController()
      pending = controller
      let success = false
      const next = queue.then(async () => {
        if (disposed || controller.signal.aborted) return
        const candidate = await prepare(catalog, structuredClone(selection), structuredClone(overrides), controller.signal)
        const previous = current
        await transitionTheme(async () => {
          try {
            controller.signal.throwIfAborted()
            if (previous) {
              await stop(previous)
              for (const item of previous.entries) item.sheet.deactivate()
              previous.parameters.media = 'not all'
            }
            await activate(candidate, controller.signal)
            current = candidate
            if (previous) remove(previous)
            success = true
          } catch (error) {
            await stop(candidate).catch(cleanupError => onError(String(cleanupError)))
            remove(candidate)
            if (previous && !disposed && current === previous) {
              try { await activate(previous); current = previous }
              catch (recoveryError) {
                await stop(previous).catch(cleanupError => onError(String(cleanupError)))
                remove(previous); current = undefined; updateMotion()
                throw new AggregateError([error, recoveryError], 'New theme failed and the previous JavaScript module is no longer available; native appearance restored', { cause: recoveryError })
              }
            } else { current = undefined; updateMotion() }
            throw error
          }
        }, origin)
      })
      queue = next.catch(() => {})
      return next.then(() => success)
    },
    reset() {
      pending?.abort()
      const previous = current
      current = undefined
      if (previous) {
        remove(previous)
        void stop(previous).catch(error => onError(String(error)))
      }
      updateMotion()
      document.dispatchEvent(new Event('loom:theme-changed'))
      return defaultThemeSelection
    },
    dispose() {
      disposed = true
      this.reset()
      motionRules.remove()
    },
  }
}
