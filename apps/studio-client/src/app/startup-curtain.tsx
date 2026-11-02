import { useEffect } from 'react'

async function waitForStartupEffects(curtain: HTMLElement): Promise<void> {
  const animations = curtain.getAnimations({ subtree: true })
    .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
  if (!animations.length) return
  let timer: ReturnType<typeof setTimeout> | undefined
  // Theme effects must never hold the application behind the curtain indefinitely.
  await Promise.race([
    Promise.allSettled(animations.map(animation => animation.finished)),
    new Promise<void>(resolve => { timer = setTimeout(resolve, 1200) }),
  ])
  clearTimeout(timer)
}

let dismissal: Promise<void> | undefined

export function dismissStartupCurtain(): Promise<void> {
  if (dismissal) return dismissal
  const curtain = document.getElementById('loom-startup')
  if (!curtain) return Promise.resolve()
  curtain.setAttribute('data-dismissing', '')
  dismissal = (async () => {
    // Flush freshly adopted theme styles before collecting their crossfade effects.
    void getComputedStyle(curtain).backgroundColor
    await waitForStartupEffects(curtain)
    curtain.setAttribute('data-leaving', '')
    void getComputedStyle(curtain).opacity
    await waitForStartupEffects(curtain)
    curtain.remove()
  })()
  return dismissal
}

/** Dismiss only after React has committed the usable page underneath. */
export function StartupReady({ onDismissed }: { onDismissed?(): void } = {}) {
  useEffect(() => {
    let active = true
    void dismissStartupCurtain().then(() => { if (active) onDismissed?.() })
    return () => { active = false }
  }, [onDismissed])
  return null
}
