import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react'
import { notify } from '../../../shared/notifications/index.js'
import type { StudioApi } from '../../../shared/api/studio-api.js'
import { subscribeDataCommits } from '../../../shared/api/data-commit-events.js'
import type { Translator } from '../../../shared/i18n/index.js'
import type { Card, CardMedia, CardSummary } from '../../../entities/index.js'
import { downloadBlob } from '../../../shared/browser/download.js'
import { sanitizeFileName } from '../../../shared/lib/text.js'

type UseCardsInput = {
  api: StudioApi
  initialCardName: string
  onCardsImported?: () => Promise<void> | void
  onCardsDeleted?: () => Promise<void> | void
  recordEdit(entry: {
    label: string
    changesetId: string
    anchor?: { documentId: string; subjectId?: string }
  }): void
  runAction: (action: () => Promise<void>) => Promise<void>
  t: Translator
}

type GetCardResult = Awaited<ReturnType<StudioApi['cards']['get']>>
type CardDetail = GetCardResult['card']

const EMPTY_CARDS: CardSummary[] = []
const apiScopeIds = new WeakMap<StudioApi, number>()
let nextApiScopeId = 1

function getApiScopeId(api: StudioApi): number {
  let id = apiScopeIds.get(api)
  if (id === undefined) {
    id = nextApiScopeId++
    apiScopeIds.set(api, id)
  }
  return id
}

export function useCards(input: UseCardsInput) {
  const queryClient = useQueryClient()
  const apiScope = getApiScopeId(input.api)
  const cardsListKey = ['cards', apiScope, 'list'] as const

  const selectionSourceRef = useRef({ api: input.api, request: 0, disposed: false })
  if (selectionSourceRef.current.api !== input.api) {
    selectionSourceRef.current = { api: input.api, request: 0, disposed: false }
  }
  const selectionSource = selectionSourceRef.current
  useEffect(() => {
    selectionSource.disposed = false
    return () => {
      selectionSource.disposed = true
      selectionSource.request += 1
    }
  }, [selectionSource])

  const forking = useRef(false)
  const [selectedCardIdBySource, setSelectedCardIdBySource] = useState<{ source: typeof selectionSource; cardId?: string }>()
  const explicitSelectedCardId = selectedCardIdBySource?.source === selectionSource ? selectedCardIdBySource.cardId : undefined

  const setSelectedCardId = useCallback((value: SetStateAction<string | undefined>) => {
    if (selectionSourceRef.current !== selectionSource || selectionSource.disposed) return
    setSelectedCardIdBySource(current => {
      const prev = current?.source === selectionSource ? current.cardId : undefined
      const next = typeof value === 'function' ? value(prev) : value
      return next === prev && current?.source === selectionSource ? current : { source: selectionSource, cardId: next }
    })
  }, [selectionSource])

  const setSelectedCardIdFromNavigation = useCallback((cardId: string | undefined) => {
    if (selectionSourceRef.current !== selectionSource || selectionSource.disposed) return
    selectionSource.request += 1
    setSelectedCardId(cardId)
  }, [selectionSource, setSelectedCardId])

  const cardsQuery = useQuery({
    queryKey: cardsListKey,
    queryFn: async () => {
      const collected: CardSummary[] = []
      let cursor: string | undefined
      do {
        const result = await input.api.cards.list({ cursor, limit: 100 })
        collected.push(...result.cards)
        cursor = result.nextCursor
      } while (cursor)
      return collected
    },
  })

  const cards = cardsQuery.data ?? EMPTY_CARDS
  const selectedCardId = explicitSelectedCardId && cards.some(card => card.id === explicitSelectedCardId)
    ? explicitSelectedCardId
    : cardsQuery.isSuccess
      ? cards.find(card => card.name === input.initialCardName)?.id ?? cards[0]?.id
      : explicitSelectedCardId
  const selectedCard = cards.find(card => card.id === selectedCardId)

  const cardDetailKey = ['cards', apiScope, 'detail', selectedCardId] as const
  const cardDetailQuery = useQuery({
    queryKey: cardDetailKey,
    enabled: Boolean(selectedCardId) && selectedCard?.validationError === undefined,
    queryFn: () => {
      if (!selectedCardId) throw new Error('No card selected')
      return input.api.cards.get(selectedCardId)
    },
  })

  const selectedCardDetails: Card | undefined = selectedCardId && selectedCard?.validationError === undefined
    ? cardDetailQuery.data?.card as Card | undefined
    : undefined

  useEffect(() => {
    return subscribeDataCommits(
      operations => {
        const hasCardChange = operations.some(op =>
          op.entityType === 'card'
          || op.entityType === 'cardSource'
          || op.scope?.entityType === 'card'
          || op.scope?.entityType === 'cardSource',
        )
        if (!hasCardChange) return
        void queryClient.invalidateQueries({ queryKey: ['cards', apiScope] })
      },
      () => {
        void queryClient.invalidateQueries({ queryKey: ['cards', apiScope] })
      },
    )
  }, [apiScope, queryClient])

  const readCardDetails = useCallback(async (cardId: string, fresh = false): Promise<GetCardResult> => {
    if (!fresh) {
      const cached = queryClient.getQueryData<GetCardResult>(['cards', apiScope, 'detail', cardId])
      if (cached) return cached
    }
    return queryClient.fetchQuery({
      queryKey: ['cards', apiScope, 'detail', cardId],
      queryFn: () => input.api.cards.get(cardId),
      staleTime: fresh ? 0 : undefined,
    })
  }, [apiScope, input.api, queryClient])

  async function refreshCards(): Promise<CardSummary[]> {
    const result = await cardsQuery.refetch()
    if (result.error) throw result.error
    const nextCards = result.data ?? EMPTY_CARDS
    setSelectedCardId(current => {
      if (current && nextCards.some(card => card.id === current)) return current
      return nextCards.find(card => card.name === input.initialCardName)?.id ?? nextCards[0]?.id
    })
    return nextCards
  }

  async function createCard() {
    await input.runAction(async () => {
      assertCurrentSource()
      const selection = ++selectionSource.request
      const result = await input.api.cards.create({ name: input.t('character.new') })
      recordCardEdit({
        label: input.t('history.card.create'),
        changesetId: result.mutation.changesetId,
        anchor: { documentId: result.card.id },
      })
      const { id, artifactId, derivedFrom, version, name, userName, description, media, createdAt, updatedAt } = result.card
      setCards(current => [
        { id, artifactId, derivedFrom, version, name, userName, description, media, createdAt, updatedAt },
        ...(current ?? []).filter(card => card.id !== id),
      ])
      if (selection === selectionSource.request) publishSelectedCard(result.card)
      await queryClient.invalidateQueries({ queryKey: cardsListKey })
    })
  }

  async function forkCard(cardId: string, expectedVersion: number) {
    if (forking.current) return
    forking.current = true
    try {
      await input.runAction(async () => {
        assertCurrentSource()
        const selection = ++selectionSource.request
        const result = await input.api.cards.fork({ cardId, expectedVersion })
        assertCurrentSource()
        const { id, artifactId, derivedFrom, version, name, userName, description, media, createdAt, updatedAt } = result.card
        setCards(current => [
          { id, artifactId, derivedFrom, version, name, userName, description, media, createdAt, updatedAt },
          ...(current ?? []).filter(card => card.id !== id),
        ])
        if (selection === selectionSource.request) publishSelectedCard(result.card)
        await queryClient.invalidateQueries({ queryKey: cardsListKey })
        assertCurrentSource()
        await input.onCardsImported?.()
      })
    } finally { forking.current = false }
  }

  async function updateCardProfile(patch: { cardId: string; expectedVersion: number; name: string; userName: string; description: string; opening?: Card['opening'] }) {
    await input.runAction(async () => {
      const result = await input.api.cards.update(patch)
      recordCardEdit({
        label: input.t('history.card.update'),
        changesetId: result.mutation.changesetId,
        anchor: { documentId: result.card.id },
      })
      applyUpdatedCard(result.card)
    })
  }

  async function replaceCardPromptResources(cardId: string, promptResourceIds: string[], expectedVersion: number) {
    await input.runAction(async () => {
      const result = await input.api.cards.updatePromptResources({ cardId, promptResourceIds, expectedVersion })
      recordCardEdit({
        label: input.t('history.card.update'),
        changesetId: result.mutation.changesetId,
        anchor: { documentId: result.card.id },
      })
      applyUpdatedCard(result.card)
      await queryClient.invalidateQueries({ queryKey: cardsListKey })
    })
  }

  async function attachExtensionPackage(cardId: string, packageId: string, version: string) {
    await input.runAction(async () => {
      const { card } = await input.api.cards.get(cardId)
      const archive = await input.api.extensions.exportPackage({ packageId, version })
      const result = await input.api.cards.attachExtensionPackage({ cardId, expectedVersion: card.version, archive })
      recordCardEdit({
        label: input.t('history.card.update'), changesetId: result.mutation.changesetId,
        anchor: { documentId: result.card.id },
      })
      applyUpdatedCard(result.card)
      await queryClient.invalidateQueries({ queryKey: cardsListKey })
    })
  }

  async function detachExtensionPackage(cardId: string, expectedVersion: number, packageId: string) {
    await input.runAction(async () => {
      const result = await input.api.cards.detachExtensionPackage({ cardId, expectedVersion, packageId })
      recordCardEdit({
        label: input.t('history.card.update'), changesetId: result.mutation.changesetId,
        anchor: { documentId: result.card.id },
      })
      applyUpdatedCard(result.card)
      await queryClient.invalidateQueries({ queryKey: cardsListKey })
    })
  }

  async function updateCardStateConfig(config: {
    cardId: string
    expectedVersion: number
    stateTemplates?: Card['stateTemplates']
    stateDefinitionIds: string[]
    stateEntityTypes: NonNullable<Card['stateEntityTypes']>
    timelineStateEntities: NonNullable<Card['timelineStateEntities']>
    timelineComponentMounts: NonNullable<Card['timelineComponentMounts']>
    stateContributionIds: NonNullable<Card['stateContributionIds']>
    timelineStateBindings: NonNullable<Card['timelineStateBindings']>
  }) {
    const result = await input.api.cards.update(config)
    recordCardEdit({
      label: input.t('history.card.update'),
      changesetId: result.mutation.changesetId,
      anchor: { documentId: config.cardId },
    })
    applyUpdatedCard(result.card)
    return result.card
  }

  async function updateCardExtensionAdoptions(config: {
    cardId: string
    expectedVersion: number
    extensionAdoptions: NonNullable<Card['extensionAdoptions']>
  }) {
    const result = await input.api.cards.update(config)
    recordCardEdit({
      label: input.t('history.card.update'),
      changesetId: result.mutation.changesetId,
      anchor: { documentId: config.cardId },
    })
    applyUpdatedCard(result.card)
    return result.card
  }

  async function deleteCard() {
    if (!selectedCardId) return

    await deleteCards([selectedCardId])
  }

  async function updateCardMacros(config: {
    cardId: string
    expectedVersion: number
    macros: Record<string, string>
    macroOptions?: import('@loom-studio/shared').MacroOptions
  }) {
    const result = await input.api.cards.update(config)
    recordCardEdit({
      label: input.t('history.card.update'),
      changesetId: result.mutation.changesetId,
      anchor: { documentId: config.cardId },
    })
    applyUpdatedCard(result.card)
    return { version: result.card.version, macros: result.card.macros ?? {}, macroOptions: result.card.macroOptions }
  }

  async function deleteCards(
    cardIds: string[],
    options?: { includePlayData?: boolean; includePromptResources?: boolean },
    onCommitted?: (deletedCardIds: readonly string[]) => void,
  ) {
    const ids = [...new Set(cardIds)].filter(cardId => cards.some(card => card.id === cardId))
    if (ids.length === 0) return
    const deletedNames = ids.map(id => cards.find(card => card.id === id)?.name).filter((name): name is string => Boolean(name))

    await input.runAction(async () => {
      const deleted = await input.api.cards.deleteMany(ids, options)
      recordCardEdit({
        label: input.t('history.card.delete'),
        changesetId: deleted.mutation.changesetId,
        anchor: { documentId: ids[0]! },
      })
      const deletedIds = new Set(deleted.cardIds)
      setCards(current => current?.filter(card => !deletedIds.has(card.id)))
      for (const deletedId of deletedIds) {
        queryClient.removeQueries({ exact: true, queryKey: ['cards', apiScope, 'detail', deletedId] })
      }
      setSelectedCardId(current => current && deletedIds.has(current) ? undefined : current)
      onCommitted?.(deleted.cardIds)
      await queryClient.invalidateQueries({ queryKey: cardsListKey })
      if (selectionSourceRef.current !== selectionSource || selectionSource.disposed) return
      if (options?.includePromptResources) {
        await input.onCardsDeleted?.()
      }
      if (deletedNames.length === 1) {
        notify.success(input.t('character.cardDeletedNotice', { name: deletedNames[0] }))
      } else if (deletedNames.length > 1) {
        notify.success(input.t('character.cardsDeletedNotice', { count: deletedNames.length }))
      }
    })
  }

  async function previewCardDeletion(cardId: string) {
    return await input.api.cards.previewDeletion(cardId)
  }

  async function updateCardMedia(cardId: string, target: 'avatar' | 'background', file: File) {
    await input.runAction(async () => {
      assertCurrentSource()
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
      assertCurrentSource()
      const current = await input.api.cards.get(cardId)
      assertCurrentSource()
      const media: CardMedia = {
        ...current.card.media,
        ...(target === 'avatar' ? { avatarAssetId: assetId } : { coverAssetId: assetId }),
      }
      const updated = await input.api.cards.update({ cardId, expectedVersion: current.card.version, media })
      assertCurrentSource()
      recordCardEdit({
        label: input.t('history.card.update'),
        changesetId: updated.mutation.changesetId,
        anchor: { documentId: cardId },
      })
      applyUpdatedCard(updated.card)
      await queryClient.invalidateQueries({ queryKey: cardsListKey })
      assertCurrentSource()
    })
  }

  async function importCards(files: File[]) {
    if (files.length === 0) return
    await input.runAction(async () => {
      assertCurrentSource()
      const selection = ++selectionSource.request
      const importedNames: string[] = []
      const failures: string[] = []
      for (const file of files) {
        assertCurrentSource()
        try {
          const loomCard = /\.(?:loomcard|zip)$/i.test(file.name)
          const response = await fetch(loomCard ? '/cards/import/loomcard' : '/cards/import/png', {
            method: 'POST',
            headers: { 'content-type': loomCard ? 'application/vnd.loom.card+zip' : 'image/png' },
            body: file,
          })
          const result = readJsonResponse(await response.text()) as { card?: Card; error?: { message?: unknown } }
          if (!response.ok || typeof result.card?.id !== 'string') {
            throw new Error(typeof result.error?.message === 'string' ? result.error.message : `Card import failed (${response.status})`)
          }
          assertCurrentSource()
          const { id, artifactId, derivedFrom, version, name, userName, description, media, createdAt, updatedAt } = result.card
          setCards(current => [
            { id, artifactId, derivedFrom, version, name, userName, description, media, createdAt, updatedAt },
            ...(current ?? []).filter(card => card.id !== id),
          ])
          if (selection === selectionSource.request) publishSelectedCard(result.card)
          const cardName = typeof result.card.name === 'string' ? result.card.name : file.name.replace(/\.[^/.]+$/, '')
          importedNames.push(cardName)
        } catch (error) {
          failures.push(`${file.name}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      assertCurrentSource()
      if (importedNames.length === 1) {
        notify.success(input.t('character.cardImportedNotice', { name: importedNames[0] }))
      } else if (importedNames.length > 1) {
        notify.success(input.t('character.cardsImportedNotice', { count: importedNames.length }))
      }
      try {
        await queryClient.invalidateQueries({ queryKey: cardsListKey })
        assertCurrentSource()
        await input.onCardsImported?.()
        assertCurrentSource()
      } catch (error) {
        failures.push(input.t('character.importRefreshFailed', {
          message: error instanceof Error ? error.message : String(error),
        }))
      }
      if (failures.length > 0) throw new Error(failures.join('\n'))
    })
  }

  async function exportCard(card: CardSummary, format: 'png' | 'polyglot' | 'loomcard' | 'directory') {
    await input.runAction(async () => {
      if (format === 'directory') {
        const preview = await input.api.cards.previewDirectory(card.id)
        if (preview.conflicts.length) {
          throw new Error(input.t('character.directoryConflict', { count: preview.conflicts.length }))
        }
        const saved = await input.api.cards.saveDirectory(card.id, preview.token)
        const title = input.t('character.directorySaved', { count: saved.changedFiles })
        if (saved.cleanupWarning) notify.warning(title, { description: saved.directory, details: saved.cleanupWarning })
        else notify.success(title, { description: saved.directory })
        return
      }
      const suffix = format === 'png' ? 'export.png' : format === 'polyglot' ? 'export.polyglot.png' : 'export.loomcard'
      const response = await fetch(`/cards/${encodeURIComponent(card.id)}/${suffix}`)
      if (!response.ok) {
        const result = readJsonResponse(await response.text()) as { error?: { message?: unknown } }
        throw new Error(typeof result.error?.message === 'string' ? result.error.message : `Card export failed (${response.status})`)
      }
      const extension = format === 'loomcard' ? '.loomcard.zip' : format === 'polyglot' ? '.polyglot.png' : '.png'
      downloadBlob(await response.blob(), `${sanitizeFileName(card.name) || 'loom-card'}${extension}`)
      notify.success(input.t('notify.success.exported'))
    })
  }

  function applyUpdatedCard(card: Card | CardDetail): void {
    const nextCard = card as CardDetail
    void queryClient.cancelQueries({ exact: true, queryKey: ['cards', apiScope, 'detail', nextCard.id] })
    queryClient.setQueryData<GetCardResult>(['cards', apiScope, 'detail', nextCard.id], current =>
      current && current.card.version > nextCard.version ? current : { ...current, card: nextCard },
    )
    if (selectionSourceRef.current !== selectionSource || selectionSource.disposed) return
    const currentList = queryClient.getQueryData<CardSummary[]>(cardsListKey)
    const wasFetching = queryClient.isFetching({ exact: true, queryKey: cardsListKey }) > 0
    setCards(current => current?.map(summary => summary.id === nextCard.id && summary.version <= nextCard.version
      ? { ...summary, ...readCardDraft(nextCard), media: nextCard.media, version: nextCard.version, updatedAt: nextCard.updatedAt }
      : summary))
    if (currentList === undefined || wasFetching) {
      void queryClient.invalidateQueries({ exact: true, queryKey: cardsListKey })
    }
  }

  function publishSelectedCard(card: Card | CardDetail): void {
    const nextCard = card as CardDetail
    setSelectedCardId(nextCard.id)
    void queryClient.cancelQueries({ exact: true, queryKey: ['cards', apiScope, 'detail', nextCard.id] })
    queryClient.setQueryData<GetCardResult>(['cards', apiScope, 'detail', nextCard.id], { card: nextCard })
  }

  function recordCardEdit(entry: Parameters<UseCardsInput['recordEdit']>[0]): void {
    if (selectionSourceRef.current === selectionSource && !selectionSource.disposed) input.recordEdit(entry)
  }

  function assertCurrentSource(): void {
    if (selectionSourceRef.current !== selectionSource || selectionSource.disposed) {
      throw new DOMException('Card operation source changed; completed writes were not reverted.', 'AbortError')
    }
  }

  function setCards(update: CardSummary[] | ((current: CardSummary[] | undefined) => CardSummary[] | undefined)): void {
    if (selectionSourceRef.current !== selectionSource || selectionSource.disposed) return
    void queryClient.cancelQueries({ exact: true, queryKey: cardsListKey })
    queryClient.setQueryData<CardSummary[] | undefined>(cardsListKey, current =>
      typeof update === 'function' ? update(current) : update,
    )
  }

  return {
    directoryApi: input.api.directories,
    cards,
    loading: cardsQuery.isPending,
    error: cardsQuery.error ?? cardDetailQuery.error ?? null,
    selectedCardId,
    setSelectedCardId: setSelectedCardIdFromNavigation,
    selectedCard,
    selectedCardDetails,
    readCardDetails,
    refreshCards,
    createCard,
    updateCardProfile,
    replaceCardPromptResources,
    attachExtensionPackage,
    detachExtensionPackage,
    updateCardStateConfig,
    updateCardExtensionAdoptions,
    updateCardMacros,
    deleteCard,
    deleteCards,
    previewCardDeletion,
    updateCardMedia,
    importCards,
    exportCard,
    forkCard,
  }
}

function readCardDraft(card?: Pick<Card, 'name' | 'userName' | 'description'>) {
  return { name: card?.name ?? '', userName: card?.userName ?? '', description: card?.description ?? '' }
}

function readAssetUploadResponse(value: string): { asset?: { id?: unknown }; error?: { message?: unknown } } {
  return readJsonResponse(value) as { asset?: { id?: unknown }; error?: { message?: unknown } }
}

function readJsonResponse(value: string): unknown {
  if (!value) return {}
  try { return JSON.parse(value) } catch { return {} }
}
