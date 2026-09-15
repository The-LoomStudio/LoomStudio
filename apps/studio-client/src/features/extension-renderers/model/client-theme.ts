import { publicThemeTokenNames, type ClientThemeSnapshot } from '@loom-studio/extension-sdk'

export function readClientThemeSnapshot(): ClientThemeSnapshot {
  const tokens = Object.fromEntries(publicThemeTokenNames.map(name => [name, ''])) as ClientThemeSnapshot['tokens']
  if (typeof document === 'undefined') return { version: 1, colorScheme: 'dark', tokens }
  const styles = getComputedStyle(document.documentElement)
  for (const name of publicThemeTokenNames) tokens[name] = styles.getPropertyValue(name).trim()
  const colorScheme = styles.colorScheme === 'light'
    || (styles.colorScheme !== 'dark' && globalThis.matchMedia?.('(prefers-color-scheme: light)').matches)
    ? 'light'
    : 'dark'
  return { version: 1, colorScheme, tokens }
}

export function subscribeClientTheme(listener: (snapshot: ClientThemeSnapshot) => void): () => void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return () => undefined
  let frame = 0
  let signature = JSON.stringify(readClientThemeSnapshot())
  const emit = () => {
    frame = 0
    const snapshot = readClientThemeSnapshot()
    const nextSignature = JSON.stringify(snapshot)
    if (nextSignature === signature) return
    signature = nextSignature
    listener(snapshot)
  }
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(emit)
  }
  const observer = new MutationObserver(schedule)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] })
  observer.observe(document.head, { attributes: true, characterData: true, childList: true, subtree: true })
  const colorScheme = globalThis.matchMedia?.('(prefers-color-scheme: light)')
  colorScheme?.addEventListener('change', schedule)
  return () => {
    observer.disconnect()
    colorScheme?.removeEventListener('change', schedule)
    if (frame) cancelAnimationFrame(frame)
  }
}
