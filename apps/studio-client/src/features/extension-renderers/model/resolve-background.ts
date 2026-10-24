import type { RegisteredClientBackground } from '@loom-studio/extension-sdk'

export function resolveBackground<T extends Pick<RegisteredClientBackground, 'key' | 'image' | 'target'>>(
  selection: { id: string } | null,
  backgrounds: readonly T[],
  cardId?: string,
): T | undefined {
  return backgrounds.find(background => background.key === selection?.id
    && (background.target?.kind !== 'card' || background.target.cardId === cardId))
}

/** The official background package no longer needs its former client module. */
export function migrateOfficialBackground(
  selection: { id: string; image: string } | null,
  backgrounds: readonly RegisteredClientBackground[],
): { id: string; image: string } | null {
  if (!selection?.id.startsWith('official.backgrounds/client/')
    || backgrounds.some(background => background.key === selection.id)) return selection
  const key = selection.id.replace('official.backgrounds/client/', 'official.backgrounds/')
  const replacement = backgrounds.find(background => background.key === key)
  return replacement ? { id: replacement.key, image: replacement.image } : selection
}
