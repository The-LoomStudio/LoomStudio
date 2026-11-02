// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { transitionTheme } from '../../../apps/studio-client/src/features/themes/model/theme-transition.js'
import { useMotionPreferenceStore } from '../../../apps/studio-client/src/shared/hooks/use-motion-preference.js'
const original = document.startViewTransition

afterEach(() => {
  document.startViewTransition = original
  useMotionPreferenceStore.setState({ preference: 'system' })
})

it('applies once without animation when motion is reduced', async () => {
  useMotionPreferenceStore.setState({ preference: 'reduce' })
  const start = vi.fn()
  document.startViewTransition = start
  const update = vi.fn(async () => {})
  await transitionTheme(update, { x: 20, y: 30 })
  expect(start).not.toHaveBeenCalled()
  expect(update).toHaveBeenCalledOnce()
})

it('keeps theme commit separate from animation completion and cleans up the circle origin', async () => {
  useMotionPreferenceStore.setState({ preference: 'full' })
  const finish = Promise.withResolvers<void>()
  const commit = Promise.withResolvers<void>()
  document.startViewTransition = vi.fn((update: () => Promise<void>) => {
    const done = Promise.resolve().then(update)
    return { ready: done, updateCallbackDone: done, finished: finish.promise, skipTransition() {} } as ViewTransition
  }) as typeof document.startViewTransition
  const update = vi.fn(() => commit.promise)
  let applied = false
  const pending = transitionTheme(update, { x: 40, y: 50 }).then(() => { applied = true })
  await Promise.resolve()
  expect(applied).toBe(false)
  expect(document.documentElement.style.getPropertyValue('--loom-theme-origin-x')).toBe('40px')
  commit.resolve()
  await pending
  expect(update).toHaveBeenCalledOnce()
  expect(document.documentElement.dataset.loomThemeTransition).toBe('circle')
  finish.resolve()
  await finish.promise
  await Promise.resolve()
  expect(document.documentElement.dataset.loomThemeTransition).toBeUndefined()
  expect(document.documentElement.style.getPropertyValue('--loom-theme-radius')).toBe('')
})

it('uses the normal update path on browsers without View Transitions', async () => {
  document.startViewTransition = undefined as unknown as typeof document.startViewTransition
  const update = vi.fn(async () => {})
  await transitionTheme(update, { x: 0, y: 0 })
  expect(update).toHaveBeenCalledOnce()
})
