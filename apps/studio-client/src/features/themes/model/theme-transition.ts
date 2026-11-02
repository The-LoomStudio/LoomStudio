import { resolveEffectiveMotion, useMotionPreferenceStore } from '../../../shared/hooks/use-motion-preference.js'
import './theme-transition.css'

export type ThemeTransitionOrigin = { x: number; y: number }
let active: ViewTransition | undefined

/** Run only after theme assets are ready; animation must not own loading or rollback. */
export async function transitionTheme(update: () => Promise<void>, origin?: ThemeTransitionOrigin): Promise<void> {
  const reduced = resolveEffectiveMotion(useMotionPreferenceStore.getState().preference,
    globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false) === 'reduce'
  active?.skipTransition()
  if (!origin || reduced || !document.startViewTransition) {
    await update()
    return
  }
  const root = document.documentElement
  root.dataset.loomThemeTransition = 'circle'
  root.style.setProperty('--loom-theme-origin-x', `${origin.x}px`)
  root.style.setProperty('--loom-theme-origin-y', `${origin.y}px`)
  root.style.setProperty('--loom-theme-radius', `${Math.hypot(Math.max(origin.x, innerWidth - origin.x), Math.max(origin.y, innerHeight - origin.y))}px`)
  const transition = document.startViewTransition(update)
  active = transition
  const cleanup = () => {
    if (active !== transition) return
    active = undefined
    delete root.dataset.loomThemeTransition
    for (const key of ['x', 'y']) root.style.removeProperty(`--loom-theme-origin-${key}`)
    root.style.removeProperty('--loom-theme-radius')
  }
  // A hidden document or superseding transition can skip the animation while the update still succeeds.
  void transition.ready.catch(() => {})
  void transition.finished.then(cleanup, cleanup)
  await transition.updateCallbackDone
}
