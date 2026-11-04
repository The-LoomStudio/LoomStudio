export function syncMobileViewport(targetRoot: HTMLElement = document.documentElement): () => void {
  if (typeof window === 'undefined') return () => {}

  const root = targetRoot
  const update = () => {
    const vv = window.visualViewport
    const currentHeight = Math.round(vv ? vv.height : window.innerHeight)
    const inset = Math.max(0, Math.round(window.innerHeight - currentHeight))
    const isKeyboardOpen = inset > 60
    const focused = document.activeElement
    const composerFocused = focused instanceof Element && Boolean(focused.closest('[data-loom-object="agent-composer-layer"], [data-loom-component="chat-composer"]'))
    root.toggleAttribute('data-composer-keyboard', isKeyboardOpen && composerFocused)

    root.style.setProperty('--loom-viewport-height', `${currentHeight}px`)
    root.style.setProperty('--loom-keyboard-inset', `${inset}px`)
    if (isKeyboardOpen) {
      root.dataset.keyboardOpen = 'true'
    } else {
      delete root.dataset.keyboardOpen
    }
  }

  const handleScroll = () => {
    // Prevent iOS Safari elastic bounce dislocation when virtual keyboard appears
    if (root.hasAttribute('data-composer-keyboard') && window.scrollY !== 0) {
      window.scrollTo(0, 0)
    }
  }

  update()

  const vv = window.visualViewport
  if (vv) {
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', handleScroll)
  }
  document.addEventListener('focusin', update)
  document.addEventListener('focusout', update)
  window.addEventListener('resize', update)
  window.addEventListener('orientationchange', update)

  return () => {
    if (vv) {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', handleScroll)
    }
    document.removeEventListener('focusin', update)
    document.removeEventListener('focusout', update)
    root.removeAttribute('data-composer-keyboard')
    window.removeEventListener('resize', update)
    window.removeEventListener('orientationchange', update)
    root.style.removeProperty('--loom-viewport-height')
    root.style.removeProperty('--loom-keyboard-inset')
    delete root.dataset.keyboardOpen
  }
}
