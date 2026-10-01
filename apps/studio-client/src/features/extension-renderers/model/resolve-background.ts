import type { RegisteredClientBackground } from '@loom-studio/extension-sdk'

export function resolveBackground(
  selection: { id: string } | null,
  backgrounds: readonly RegisteredClientBackground[],
  cardId?: string,
): RegisteredClientBackground | undefined {
  return backgrounds.find(background => background.key === selection?.id
    && (background.target?.kind !== 'card' || background.target.cardId === cardId))
}
