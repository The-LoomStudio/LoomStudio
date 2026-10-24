import { lazy, Suspense } from 'react'

const NarrativeSessionPreview = lazy(async () => ({ default: (await import('./narrative-session-preview.js')).NarrativeSessionPreview }))
const ObservabilityPreview = lazy(async () => ({ default: (await import('./observability-preview.js')).ObservabilityPreview }))
const SceneCardPreview = lazy(async () => ({ default: (await import('./scene-card-preview.js')).SceneCardPreview }))

// Explicit registration only. No business API, authentication, or persistent layout bootstrap.
export function DevPreview({ pathname }: { pathname: string }) {
  if (pathname === '/dev/preview/scene-card') return <Suspense fallback={null}><SceneCardPreview /></Suspense>
  if (pathname === '/dev/preview/narrative-session') return <Suspense fallback={null}><NarrativeSessionPreview /></Suspense>
  if (pathname === '/dev/preview/observability') return <Suspense fallback={null}><ObservabilityPreview /></Suspense>
  return null
}
