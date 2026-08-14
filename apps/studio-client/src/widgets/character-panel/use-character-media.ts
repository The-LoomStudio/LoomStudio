import { useEffect, useRef, useState } from 'react'
import { removeOrphanCharacterMedia, replaceCharacterMedia, type CharacterMedia, type CharacterMediaTarget } from './character-panel-model.js'

export function useCharacterMedia(cardIds: string[]) {
  const [mediaByCardId, setMediaByCardId] = useState<Record<string, CharacterMedia>>({})
  const objectUrlsRef = useRef(new Set<string>())

  function revoke(url: string) {
    URL.revokeObjectURL(url)
    objectUrlsRef.current.delete(url)
  }

  function replace(cardId: string, target: CharacterMediaTarget, file: File): string {
    const nextUrl = URL.createObjectURL(file)
    objectUrlsRef.current.add(nextUrl)
    setMediaByCardId(current => replaceCharacterMedia({ cardId, mediaByCardId: current, nextUrl, revoke, target }))
    return nextUrl
  }

  useEffect(() => {
    const knownCardIds = new Set(cardIds)
    setMediaByCardId(current => removeOrphanCharacterMedia({ knownCardIds, mediaByCardId: current, revoke }))
  }, [cardIds])

  useEffect(() => () => {
    for (const url of objectUrlsRef.current) URL.revokeObjectURL(url)
    objectUrlsRef.current.clear()
  }, [])

  return { mediaByCardId, replace }
}
