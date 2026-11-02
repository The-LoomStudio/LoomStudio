export interface PreparedStyle {
  activate(): void
  deactivate(): void
  dispose(): void
}

function validateRules(rules: CSSRuleList): void {
  for (const rule of Array.from(rules)) {
    if (rule.type === CSSRule.IMPORT_RULE || rule.type === CSSRule.NAMESPACE_RULE) {
      throw new Error('Theme CSS must be bundled: @import and @namespace are not supported.')
    }
    if ('style' in rule) {
      const style = (rule as CSSStyleRule).style
      for (let index = 0; index < style.length; index += 1) {
        if (style.getPropertyPriority(style.item(index)) === 'important') {
          throw new Error('Theme CSS cannot use !important because it reverses the configured layer priority.')
        }
      }
    }
    if ('cssRules' in rule) validateRules((rule as CSSGroupingRule).cssRules)
  }
}

/** Prepare an inert sheet, retaining the browser's original asset URL resolution. */
export async function loadStyleSheet(url: string, signal: AbortSignal, layer: string): Promise<PreparedStyle> {
  signal.throwIfAborted()
  const source = new URL(url, document.baseURI)
  if (source.origin !== location.origin) throw new Error('Theme CSS must use a same-origin package asset URL.')
  if (!/^loom-(?:theme|enhancements\.e\d+)$/.test(layer)) throw new Error('Invalid theme CSS layer.')

  const element = document.createElement('style')
  element.media = 'not all'
  // URL.href escapes control characters; JSON quoting safely preserves quotes and backslashes.
  element.textContent = `@import url(${JSON.stringify(source.href)}) layer(${layer});`
  let disposed = false
  const dispose = () => {
    disposed = true
    element.remove()
  }

  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout)
      element.onload = null
      element.onerror = null
      signal.removeEventListener('abort', abort)
    }
    const fail = (error: unknown) => {
      cleanup()
      dispose()
      reject(error)
    }
    const abort = () => fail(signal.reason)
    element.onerror = () => fail(new Error(`Unable to load theme CSS: ${source.href}`))
    element.onload = () => {
      try {
        const imported = element.sheet?.cssRules[0] as CSSImportRule | undefined
        if (!imported?.styleSheet) throw new Error(`Theme CSS did not provide a readable stylesheet: ${source.href}`)
        validateRules(imported.styleSheet.cssRules)
        cleanup()
        resolve()
      } catch (error) {
        fail(error)
      }
    }
    signal.addEventListener('abort', abort, { once: true })
    const timeout = setTimeout(() => fail(new Error(`Theme CSS loading timed out after 15 seconds: ${source.href}`)), 15_000)
    document.head.append(element)
  })

  return {
    activate() {
      if (disposed) throw new Error('Cannot activate a disposed theme stylesheet.')
      element.media = 'all'
    },
    deactivate() { element.media = 'not all' },
    dispose,
  }
}
