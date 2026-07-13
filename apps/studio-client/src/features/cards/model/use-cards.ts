import type { ClientJsonValue } from '@loom-studio/client-bridge'
import { useEffect, useState, type FormEvent } from 'react'
import type { StudioApi } from '../../../shared/api/studio-api.js'
import type { Translator } from '../../../shared/i18n/index.js'
import type { Card, JsonObject } from '../../../entities/index.js'

type UseCardsInput = {
  api: StudioApi
  initialCardJson: string
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
  const [cardJson, setCardJson] = useState(input.initialCardJson)
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
      return result.cards.find(card => card.name === readCardName(input.initialCardJson))?.id ?? result.cards[0]?.id
    })
    return result.cards
  }

  async function createCard(event: FormEvent) {
    event.preventDefault()
    await input.runAction(async () => {
      const result = await input.api.cards.create(readCardCreateInput(cardJson, input.t))
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

    await input.runAction(async () => {
      const deleted = await input.api.cards.delete(selectedCardId)
      input.recordEdit({
        label: input.t('history.card.delete'),
        changesetId: deleted.mutation.changesetId,
        anchor: { documentId: selectedCardId },
      })
      const listed = await input.api.cards.list()
      setCards(listed.cards)
      setSelectedCardId(listed.cards[0]?.id)
    })
  }

  return {
    cards,
    selectedCardId,
    setSelectedCardId,
    cardJson,
    setCardJson,
    cardDraft,
    setCardDraft,
    selectedCard,
    refreshCards,
    createCard,
    updateCard,
    deleteCard,
  }
}

export function readCardCreateInput(cardJson: string, t: Translator): JsonObject {
  const parsed = JSON.parse(cardJson) as Partial<Card>

  return jsonObject({
    name: readRequiredString(parsed, 'name', t),
    userName: readOptionalString(parsed, 'userName'),
    description: readOptionalString(parsed, 'description'),
    preset: isObject(parsed.preset) ? parsed.preset : undefined,
    opening: isOpeningInput(parsed.opening) ? parsed.opening : undefined,
    setting: isObject(parsed.setting) ? parsed.setting : undefined,
    settingLayer: isObject(parsed.settingLayer) ? parsed.settingLayer : undefined,
  })
}

export function readCardName(cardJson: string): string | undefined {
  const parsed = JSON.parse(cardJson) as { name?: unknown }
  return typeof parsed.name === 'string' ? parsed.name : undefined
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isOpeningInput(value: unknown): value is ClientJsonValue {
  return typeof value === 'string' || isObject(value)
}

function readRequiredString(value: Partial<Card>, key: keyof Card, t: Translator): string {
  const result = value[key]
  if (typeof result !== 'string' || result.trim().length === 0) {
    throw new Error(t('error.cardJsonRequired', { key: String(key) }))
  }
  return result
}

function readOptionalString(value: Partial<Card>, key: keyof Card): string | undefined {
  const result = value[key]
  return typeof result === 'string' ? result : undefined
}

function jsonObject(value: Record<string, ClientJsonValue | undefined>): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as JsonObject
}
