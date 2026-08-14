export type CharacterMediaTarget = 'avatar' | 'background'
export type CharacterMedia = Partial<Record<CharacterMediaTarget, string>>

export function removeOrphanCharacterMedia(input: {
  knownCardIds: Set<string>
  mediaByCardId: Record<string, CharacterMedia>
  revoke: (url: string) => void
}): Record<string, CharacterMedia> {
  let changed = false
  const next: Record<string, CharacterMedia> = {}
  for (const [cardId, media] of Object.entries(input.mediaByCardId)) {
    if (input.knownCardIds.has(cardId)) {
      next[cardId] = media
      continue
    }
    changed = true
    for (const url of Object.values(media)) {
      if (url?.startsWith('blob:')) input.revoke(url)
    }
  }
  return changed ? next : input.mediaByCardId
}

export function replaceCharacterMedia(input: {
  cardId: string
  mediaByCardId: Record<string, CharacterMedia>
  nextUrl: string
  revoke: (url: string) => void
  target: CharacterMediaTarget
}): Record<string, CharacterMedia> {
  const previousUrl = input.mediaByCardId[input.cardId]?.[input.target]
  if (previousUrl?.startsWith('blob:')) input.revoke(previousUrl)
  return {
    ...input.mediaByCardId,
    [input.cardId]: { ...input.mediaByCardId[input.cardId], [input.target]: input.nextUrl },
  }
}
