import { lazy, Suspense } from 'react'

const RegexLabPreview = lazy(async () => {
  isolatePreviewStorage()
  return { default: (await import('./regex-lab-preview.js')).RegexLabPreview }
})

const DashboardPreview = lazy(async () => ({ default: (await import('./dashboard-preview.js')).DashboardPreview }))

const NarrativeSessionPreview = lazy(async () => {
  isolatePreviewStorage()
  return { default: (await import('./narrative-session-preview.js')).NarrativeSessionPreview }
})
const ObservabilityPreview = lazy(async () => ({ default: (await import('./observability-preview.js')).ObservabilityPreview }))
const SceneCardPreview = lazy(async () => ({ default: (await import('./scene-card-preview.js')).SceneCardPreview }))
const ScriptManagementPreview = lazy(async () => {
  isolatePreviewStorage()
  return { default: (await import('./script-management-preview.js')).ScriptManagementPreview }
})

const PresetLibraryPreview = lazy(async () => {
  isolatePreviewStorage()
  return { default: (await import('./preset-library-preview.js')).PresetLibraryPreview }
})

// Shared widgets may import persisted preference stores. Isolate them before
// importing either preview; never hydrate or write the real browser preferences.
function isolatePreviewStorage() {
  for (const name of ['localStorage', 'sessionStorage'] as const) {
    const values = new Map<string, string>()
    const storage: Storage = {
      get length() { return values.size }, clear: () => values.clear(),
      getItem: key => values.get(key) ?? null, key: index => [...values.keys()][index] ?? null,
      removeItem: key => { values.delete(key) }, setItem: (key, value) => { values.set(key, value) },
    }
    Object.defineProperty(window, name, { configurable: true, value: storage })
  }
}

// Explicit registration only. No business API, authentication, or persistent layout bootstrap.
export function DevPreview({ pathname }: { pathname: string }) {
  if (pathname === '/dev/preview/regex') return <Suspense fallback={null}><RegexLabPreview /></Suspense>
  if (pathname === '/dev/preview/dashboard') return <Suspense fallback={null}><DashboardPreview /></Suspense>
  if (pathname === '/dev/preview/presets') return <Suspense fallback={null}><PresetLibraryPreview /></Suspense>
  if (pathname === '/dev/preview/scripts') return <Suspense fallback={null}><ScriptManagementPreview /></Suspense>
  if (pathname === '/dev/preview/scene-card') return <Suspense fallback={null}><SceneCardPreview /></Suspense>
  if (pathname === '/dev/preview/narrative-session') return <Suspense fallback={null}><NarrativeSessionPreview /></Suspense>
  if (pathname === '/dev/preview/observability') return <Suspense fallback={null}><ObservabilityPreview /></Suspense>
  return null
}
