export type IsolatedFrame = {
  frame: HTMLIFrameElement
  markReady(): void
  fail(message: string): void
  dispose(): void
}

export function mountIsolatedFrame(root: HTMLElement, options: {
  title: string
  source: { html: string } | { url: string }
  onLoad(instance: IsolatedFrame): void
  onMessage?(data: unknown): void
  onFailure(message: string): void
}): IsolatedFrame {
  const frame = document.createElement('iframe')
  frame.title = options.title
  frame.sandbox.add('allow-scripts')
  frame.referrerPolicy = 'no-referrer'
  let disposed = false
  let loaded = false
  const timer = setTimeout(() => instance.fail('Iframe connection timed out'), 10_000)
  function receive(event: MessageEvent) {
    if (!disposed && event.source === frame.contentWindow) options.onMessage?.(event.data)
  }
  function load() {
    if (disposed) return
    if (loaded) {
      instance.fail('Iframe navigated away; its host connection was revoked')
      return
    }
    loaded = true
    try {
      options.onLoad(instance)
    } catch (error) {
      instance.fail(error instanceof Error ? error.message : String(error))
    }
  }
  const instance: IsolatedFrame = {
    frame,
    markReady: () => clearTimeout(timer),
    fail(message) {
      if (disposed) return
      instance.dispose()
      options.onFailure(message)
    },
    dispose() {
      if (disposed) return
      disposed = true
      clearTimeout(timer)
      window.removeEventListener('message', receive)
      frame.removeEventListener('load', load)
      frame.remove()
    },
  }
  // Install listeners before insertion so cached/srcdoc documents cannot win
  // the race against React effects or host initialization.
  window.addEventListener('message', receive)
  frame.addEventListener('load', load)
  if ('html' in options.source) frame.srcdoc = options.source.html
  else frame.src = options.source.url
  root.replaceChildren(frame)
  return instance
}
