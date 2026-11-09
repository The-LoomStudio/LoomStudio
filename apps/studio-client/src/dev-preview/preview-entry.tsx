import { lazy, Suspense } from 'react'

const RegexLabPreview = lazy(async () => {
  isolatePreviewStorage()
  return { default: (await import('./regex-lab-preview.js')).RegexLabPreview }
})

const CatalogPickerPreview = lazy(async () => {
  isolatePreviewStorage()
  return { default: (await import('./catalog-picker-preview.js')).CatalogPickerPreview }
})

// Shared widgets may import persisted preference stores. Isolate them before
// importing preview; never hydrate or write the real browser preferences.
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
  if (pathname === '/dev/preview/picker') return <Suspense fallback={null}><CatalogPickerPreview /></Suspense>
  return null
}
