import { useSyncExternalStore } from 'react'

// Stable across page loads; the media endpoint revalidates directory-backed files.
let revision = 0
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

export function cardMediaUrl(
  cardId: string,
  target: 'avatar' | 'background',
  assetId: string | undefined,
  mediaRevision: number,
  updatedAt?: string,
): string | undefined {
  if (!assetId) return undefined
  const base = `/cards/${encodeURIComponent(cardId)}/media/${target}?asset=${encodeURIComponent(assetId)}&revision=${mediaRevision}`
  return updatedAt ? `${base}&v=${encodeURIComponent(updatedAt)}` : base
}
