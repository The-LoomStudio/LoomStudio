import { measureElement, observeElementOffset } from '@tanstack/react-virtual'

export const observeFileTreeOffset: typeof observeElementOffset = (instance, callback) => {
  const stop = observeElementOffset(instance, callback)
  const element = instance.scrollElement
  if (!element) return stop

  // Kept-alive panels can clamp scrollTop while hidden without emitting scroll.
  // Reconcile the real offset when their viewport becomes measurable again.
  const observer = new ResizeObserver(() => {
    if (element.clientHeight > 0) callback(element.scrollTop, false)
  })
  observer.observe(element)
  return () => {
    stop?.()
    observer.disconnect()
  }
}

export const measureFileTreeElement: typeof measureElement = (element, entry, instance) => {
  // Ref attachment runs during commit. Let the observer supply the actual size
  // so attaching rows does not force layout. Hidden rows retain their size.
  if (entry || typeof ResizeObserver === 'undefined') {
    const size = measureElement(element, entry, instance)
    if (size > 0) return size
  }
  const index = instance.indexFromElement(element)
  return instance.itemSizeCache.get(instance.options.getItemKey(index)) ?? instance.options.estimateSize(index)
}
