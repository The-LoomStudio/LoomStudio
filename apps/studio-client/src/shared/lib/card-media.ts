import { useSyncExternalStore } from 'react'

let revision = Date.now()
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
const getSnapshot = () => revision
const getServerSnapshot = () => 0

export function invalidateCardMedia() {
  revision += 1
  listeners.forEach(listener => listener())
}

export function useCardMediaRevision() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

export function cardMediaUrl(cardId: string, target: 'avatar' | 'background', assetId: string | undefined, mediaRevision: number): string | undefined {
  return assetId ? `/cards/${encodeURIComponent(cardId)}/media/${target}?asset=${encodeURIComponent(assetId)}&revision=${mediaRevision}` : undefined
}
