import { useEffect, useRef, useState } from 'react'
import type { Card } from '../../../entities/index.js'
import type { StudioApi } from '../../../shared/api/studio-api.js'

export function useExtensionCardContext(api: StudioApi, cardId?: string, editorCard?: Card, revision?: number | string,
  readCard: (cardId: string, fresh?: boolean) => ReturnType<StudioApi['cards']['get']> = api.cards.get) {
  const [loaded, setLoaded] = useState<{ api: StudioApi; card: Card }>()
  const [error, setError] = useState<{ api: StudioApi; cardId: string; message: string }>()
  const previousRead = useRef<{ api: StudioApi; cardId: string; revision?: number | string }>(undefined)
  useEffect(() => {
    if (!cardId) return
    const previous = previousRead.current
    const fresh = previous?.api === api && previous.cardId === cardId && previous.revision !== revision
    previousRead.current = { api, cardId, revision }
    let current = true
    void readCard(cardId, fresh).then(({ card }) => {
      if (current) { setLoaded({ api, card }); setError(undefined) }
    }, cause => {
      if (current) setError({ api, cardId, message: cause instanceof Error ? cause.message : String(cause) })
    })
    return () => { current = false }
  }, [api, cardId, revision, readCard])
  const current = loaded?.api === api && loaded.card.id === cardId ? loaded.card : undefined
  return {
    card: editorCard && editorCard.id === cardId && (!current || editorCard.version >= current.version) ? editorCard : current,
    error: error?.api === api && error.cardId === cardId ? error.message : undefined,
  }
}
