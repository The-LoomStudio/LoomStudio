import type { ClientJsonValue } from '@loom-studio/client-bridge'
import { useEffect, useState, type FormEvent } from 'react'
import type { StudioApi } from '../../../shared/api/studio-api.js'
import type { Translator } from '../../../shared/i18n/index.js'
import type { Card, JsonObject } from '../../../entities/index.js'

type UseCardsInput = {
  api: StudioApi
  initialCardName: string
  recordEdit(entry: {
    label: string
    changesetId: string
    anchor?: { documentId: string; subjectId?: string }
  }): void
  runAction: (action: () => Promise<void>) => Promise<void>
  t: Translator
}

export function useCards(input: UseCardsInput) {
  const [cards, setCards] = useState<Card[]>([])
  const [selectedCardId, setSelectedCardId] = useState<string>()
  const selectedCard = cards.find(card => card.id === selectedCardId)
  const [cardDraft, setCardDraft] = useState({
    name: '',
    userName: '',
    description: '',
  })

  useEffect(() => {
    setCardDraft({
      name: selectedCard?.name ?? '',
      userName: selectedCard?.userName ?? '',
      description: selectedCard?.description ?? '',
    })
  }, [selectedCard?.id, selectedCard?.name, selectedCard?.userName, selectedCard?.description])

  async function refreshCards() {
    const result = await input.api.cards.list()
    setCards(result.cards)
    setSelectedCardId(current => {
      if (current && result.cards.some(card => card.id === current)) return current
      return result.cards.find(card => card.name === input.initialCardName)?.id ?? result.cards[0]?.id
    })
    return result.cards
  }

  async function createCard() {
    await input.runAction(async () => {
      const result = await input.api.cards.create(createBlankCardInput(input.t))
      input.recordEdit({
        label: input.t('history.card.create'),
        changesetId: result.mutation.changesetId,
        anchor: { documentId: result.card.id },
      })
      await refreshCards()
      setSelectedCardId(result.card.id)
    })
  }

  async function updateCard(event: FormEvent) {
    event.preventDefault()
    if (!selectedCardId) return

    await input.runAction(async () => {
      const result = await input.api.cards.update(jsonObject({
        cardId: selectedCardId,
        name: cardDraft.name,
        userName: cardDraft.userName,
        description: cardDraft.description,
      }))
      input.recordEdit({
        label: input.t('history.card.update'),
        changesetId: result.mutation.changesetId,
        anchor: { documentId: result.card.id },
      })
      await refreshCards()
      setSelectedCardId(result.card.id)
    })
  }

  async function deleteCard() {
    if (!selectedCardId) return

    await deleteCards([selectedCardId])
  }

  async function deleteCards(cardIds: string[]) {
    const ids = [...new Set(cardIds)].filter(cardId => cards.some(card => card.id === cardId))
    if (ids.length === 0) return

    await input.runAction(async () => {
      let hasDeletedCard = false
      try {
        // ponytail: RPC only exposes single-card deletion. Keep FIFO calls until a batch-delete mutation exists.
        for (const cardId of ids) {
          const deleted = await input.api.cards.delete(cardId)
          hasDeletedCard = true
          input.recordEdit({
            label: input.t('history.card.delete'),
            changesetId: deleted.mutation.changesetId,
            anchor: { documentId: cardId },
          })
        }
      } finally {
        if (hasDeletedCard) await refreshCards()
      }
    })
  }

  return {
    cards,
    selectedCardId,
    setSelectedCardId,
    cardDraft,
    setCardDraft,
    selectedCard,
    refreshCards,
    createCard,
    updateCard,
    deleteCard,
    deleteCards,
  }
}

function jsonObject(value: Record<string, ClientJsonValue | undefined>): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as JsonObject
}

export function createBlankCardInput(t: Translator): JsonObject {
  return jsonObject({ name: t('cards.new') })
}
