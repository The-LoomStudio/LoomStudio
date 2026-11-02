import { useLayoutEffect, type RefObject } from 'react'

/** Keep edge masks in sync with scrolling, resizing and changing list content. */
export function useScrollEdgeFade(ref: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const update = () => {
      element.dataset.fadeTop = String(element.scrollTop > 1)
      element.dataset.fadeBottom = String(element.scrollHeight - element.clientHeight - element.scrollTop > 1)
    }
    const resize = new ResizeObserver(update)
    const observeChildren = () => {
      resize.disconnect()
      resize.observe(element)
      for (const child of element.children) resize.observe(child)
      update()
    }
    const mutation = new MutationObserver(observeChildren)
    mutation.observe(element, { childList: true, subtree: true, characterData: true })
    element.addEventListener('scroll', update, { passive: true })
    observeChildren()
    return () => {
      element.removeEventListener('scroll', update)
      resize.disconnect()
      mutation.disconnect()
      delete element.dataset.fadeTop
      delete element.dataset.fadeBottom
    }
  }, [ref])
}
