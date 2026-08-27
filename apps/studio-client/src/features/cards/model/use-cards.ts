import { useEffect, useState, type FormEvent } from 'react'
import type { CreateCardInput, StudioApi } from '../../../shared/api/studio-api.js'
import type { Translator } from '../../../shared/i18n/index.js'
import type { Card, CardMedia, CardSummary } from '../../../entities/index.js'

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
  const [cards, setCards] = useState<CardSummary[]>([])
  const [selectedCardId, setSelectedCardId] = useState<string>()
  const selectedCard = cards.find(card => card.id === selectedCardId)
  const [selectedCardDetails, setSelectedCardDetails] = useState<Card>()
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

  useEffect(() => {
    if (!selectedCardId) {
      setSelectedCardDetails(undefined)
      return
    }
    let current = true
    void input.api.cards.get(selectedCardId).then(result => {
      if (current) setSelectedCardDetails(result.card)
    }).catch(() => {
      if (current) setSelectedCardDetails(undefined)
    })
    return () => { current = false }
  }, [input.api, selectedCardId])

  async function refreshCards() {
    const cards: CardSummary[] = []
    let cursor: string | undefined
    do {
      const result = await input.api.cards.list({ cursor, limit: 100 })
      cards.push(...result.cards)
      cursor = result.nextCursor
    } while (cursor)
    setCards(cards)
    setSelectedCardId(current => {
      if (current && cards.some(card => card.id === current)) return current
      return cards.find(card => card.name === input.initialCardName)?.id ?? cards[0]?.id
    })
    return cards
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
      setSelectedCardDetails(result.card)
      setCardDraft({
        name: result.card.name,
        userName: result.card.userName ?? '',
        description: result.card.description ?? '',
      })
    })
  }

  async function selectCard(cardId: string) {
    await input.runAction(async () => {
      const result = await input.api.cards.get(cardId)
      setSelectedCardId(result.card.id)
      setSelectedCardDetails(result.card)
      setCardDraft({
        name: result.card.name,
        userName: result.card.userName ?? '',
        description: result.card.description ?? '',
      })
    })
  }

  async function updateCard(event: FormEvent) {
    event.preventDefault()
    if (!selectedCardId) return

    await input.runAction(async () => {
      const result = await input.api.cards.update({
        cardId: selectedCardId,
        name: cardDraft.name,
        userName: cardDraft.userName,
        description: cardDraft.description,
      })
      input.recordEdit({
        label: input.t('history.card.update'),
        changesetId: result.mutation.changesetId,
        anchor: { documentId: result.card.id },
      })
      setSelectedCardDetails(result.card)
      await refreshCards()
      setSelectedCardId(result.card.id)
    })
  }

  async function replaceCardPromptResources(cardId: string, promptResourceIds: string[]) {
    await input.runAction(async () => {
      const result = await input.api.cards.updatePromptResources({ cardId, promptResourceIds })
      input.recordEdit({
        label: input.t('history.card.update'),
        changesetId: result.mutation.changesetId,
        anchor: { documentId: result.card.id },
      })
      setSelectedCardDetails(result.card)
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

  async function updateCardMedia(cardId: string, target: 'avatar' | 'background', file: File) {
    await input.runAction(async () => {
      const upload = await fetch('/assets', {
        method: 'POST',
        headers: {
          'content-type': file.type || 'application/octet-stream',
          'x-loom-asset-kind': 'image',
        },
        body: file,
      })
      const responseText = await upload.text()
      const result = readAssetUploadResponse(responseText)
      const assetId = result.asset?.id
      if (!upload.ok || typeof assetId !== 'string') {
        throw new Error(typeof result.error?.message === 'string'
          ? result.error.message
          : `Media upload failed (${upload.status})`)
      }
      const current = await input.api.cards.get(cardId)
      const media: CardMedia = {
        ...current.card.media,
        ...(target === 'avatar' ? { avatarAssetId: assetId } : { coverAssetId: assetId }),
      }
      const updated = await input.api.cards.update({ cardId, media })
      input.recordEdit({
        label: input.t('history.card.update'),
        changesetId: updated.mutation.changesetId,
        anchor: { documentId: cardId },
      })
      setSelectedCardDetails(updated.card)
      await refreshCards()
      setSelectedCardId(cardId)
    })
  }

  async function importCards(files: File[]) {
    if (files.length === 0) return
    await input.runAction(async () => {
      let importedCardId: string | undefined
      const failures: string[] = []
      for (const file of files) {
        try {
          const loomCard = file.name.toLowerCase().endsWith('.loomcard')
          const response = await fetch(loomCard ? '/cards/import/loomcard' : '/cards/import/png', {
            method: 'POST',
            headers: { 'content-type': loomCard ? 'application/vnd.loom.card+zip' : 'image/png' },
            body: file,
          })
          const result = readJsonResponse(await response.text()) as { card?: { id?: unknown }; error?: { message?: unknown } }
          if (!response.ok || typeof result.card?.id !== 'string') {
            throw new Error(typeof result.error?.message === 'string' ? result.error.message : `Card import failed (${response.status})`)
          }
          importedCardId = result.card.id
        } catch (error) {
          failures.push(`${file.name}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      await refreshCards()
      if (importedCardId) setSelectedCardId(importedCardId)
      if (failures.length > 0) throw new Error(failures.join('\n'))
    })
  }

  async function exportCard(card: CardSummary, format: 'png' | 'polyglot' | 'loomcard') {
    await input.runAction(async () => {
      const suffix = format === 'png' ? 'export.png' : format === 'polyglot' ? 'export.polyglot.png' : 'export.loomcard'
      const response = await fetch(`/cards/${encodeURIComponent(card.id)}/${suffix}`)
      if (!response.ok) {
        const result = readJsonResponse(await response.text()) as { error?: { message?: unknown } }
        throw new Error(typeof result.error?.message === 'string' ? result.error.message : `Card export failed (${response.status})`)
      }
      const url = URL.createObjectURL(await response.blob())
      const anchor = document.createElement('a')
      anchor.href = url
      const extension = format === 'loomcard' ? '.loomcard' : format === 'polyglot' ? '.polyglot.png' : '.png'
      anchor.download = `${sanitizeFileName(card.name) || 'loom-card'}${extension}`
      anchor.click()
      URL.revokeObjectURL(url)
    })
  }

  return {
    cards,
    selectedCardId,
    setSelectedCardId,
    cardDraft,
    setCardDraft,
    selectedCard,
    selectedCardDetails,
    refreshCards,
    selectCard,
    createCard,
    updateCard,
    replaceCardPromptResources,
    deleteCard,
    deleteCards,
    updateCardMedia,
    importCards,
    exportCard,
  }
}

function readAssetUploadResponse(value: string): { asset?: { id?: unknown }; error?: { message?: unknown } } {
  return readJsonResponse(value) as { asset?: { id?: unknown }; error?: { message?: unknown } }
}

function readJsonResponse(value: string): unknown {
  if (!value) return {}
  try { return JSON.parse(value) } catch { return {} }
}

function sanitizeFileName(value: string): string {
  return value.trim().replace(/[\\/:*?"<>|]/g, '-')
}

export function createBlankCardInput(t: Translator): CreateCardInput {
  return { name: t('character.new') }
}
