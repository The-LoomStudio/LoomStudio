export function boundFrameHeight(value: unknown, maxHeight = 6000): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(32, Math.min(maxHeight, Math.ceil(value)))
    : undefined
}

// Self-contained for embedding in both document and module bootstraps.
export function observeFrameSize(report: (height: number) => void, maxHeight = 6000): () => void {
  let body: HTMLElement | null = null
  let lastHeight = -1
  let scheduled = 0
  let disposed = false
  const resize = new ResizeObserver(schedule)
  const mutations = new MutationObserver(schedule)
  function schedule() {
    if (!disposed && !scheduled) scheduled = requestAnimationFrame(measure)
  }
  function measure() {
    scheduled = 0
    if (!document.body || disposed) return
    if (body !== document.body) {
      resize.disconnect()
      body = document.body
      resize.observe(body)
    }
    const box = body.getBoundingClientRect()
    const margin = parseFloat(getComputedStyle(body).marginBottom) || 0
    const height = Math.max(32, Math.min(maxHeight, Math.ceil(Math.max(body.scrollHeight, box.height) + Math.max(0, box.top) + margin)))
    if (height !== lastHeight) { lastHeight = height; report(height) }
  }
  mutations.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true })
  document.addEventListener('DOMContentLoaded', measure)
  window.addEventListener('resize', schedule)
  measure()
  return () => {
    disposed = true
    cancelAnimationFrame(scheduled)
    resize.disconnect()
    mutations.disconnect()
    document.removeEventListener('DOMContentLoaded', measure)
    window.removeEventListener('resize', schedule)
  }
}
