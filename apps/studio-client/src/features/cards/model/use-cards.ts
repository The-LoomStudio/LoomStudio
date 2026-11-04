import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react'
import { notify } from '../../../shared/notifications/index.js'
import type { StudioApi } from '../../../shared/api/studio-api.js'
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

type CardEditor = {
  selectedCardId?: string
  selectedCardDetails?: Card
}

const emptyCardEditor: CardEditor = {}

export function useCards(input: UseCardsInput) {
  const selectionSourceRef = useRef({ api: input.api, request: 0, collectionWrite: 0, disposed: false,
    detailReads: new Map<string, ReturnType<StudioApi['cards']['get']>>() })
  if (selectionSourceRef.current.api !== input.api) {
    selectionSourceRef.current = { api: input.api, request: 0, collectionWrite: 0, disposed: false,
      detailReads: new Map() }
  }
  const selectionSource = selectionSourceRef.current
  useEffect(() => {
    selectionSource.disposed = false
    return () => {
      selectionSource.disposed = true
      selectionSource.request += 1
      selectionSource.detailReads.clear()
    }
  }, [selectionSource])
  const refreshRequest = useRef(0)
  const forking = useRef(false)
  useEffect(() => () => { refreshRequest.current += 1 }, [input.api])
  const [cardCollection, setCardCollection] = useState<{ source: typeof selectionSource; cards: CardSummary[] }>()
  const cards = cardCollection?.source === selectionSource ? cardCollection.cards : []
  const [editorState, setEditorState] = useState<{ source: typeof selectionSource; editor: CardEditor }>()
  const { selectedCardId, selectedCardDetails } = editorState?.source === selectionSource
    ? editorState.editor : emptyCardEditor
  const updateEditor = useCallback((update: (editor: CardEditor) => CardEditor) => {
    if (selectionSourceRef.current !== selectionSource || selectionSource.disposed) return
    setEditorState(current => {
      const editor = current?.source === selectionSource ? current.editor : emptyCardEditor
      const next = update(editor)
      return next === editor && current?.source === selectionSource ? current : { source: selectionSource, editor: next }
    })
  }, [selectionSource])
  const setSelectedCardId = useCallback((value: SetStateAction<string | undefined>) => {
    updateEditor(editor => ({ ...editor, selectedCardId: typeof value === 'function' ? value(editor.selectedCardId) : value }))
  }, [updateEditor])
  const setSelectedCardDetails = useCallback((value: SetStateAction<Card | undefined>) => {
    updateEditor(editor => ({ ...editor, selectedCardDetails: typeof value === 'function' ? value(editor.selectedCardDetails) : value }))
  }, [updateEditor])
  const setSelectedCardIdFromNavigation = useCallback((cardId: string | undefined) => {
    if (selectionSourceRef.current !== selectionSource || selectionSource.disposed) return
    selectionSource.request += 1
    setSelectedCardId(cardId)
  }, [selectionSource, setSelectedCardId])
  const selectedCard = cards.find(card => card.id === selectedCardId)
  const readCardDetails = useCallback((cardId: string, fresh = false) => {
    const pending = selectionSource.detailReads.get(cardId)
    if (pending && !fresh) return pending
    const request = selectionSource.api.cards.get(cardId)
    selectionSource.detailReads.set(cardId, request)
    const clear = () => {
      if (selectionSource.detailReads.get(cardId) === request) selectionSource.detailReads.delete(cardId)
    }
    void request.then(clear, clear)
    return request
  }, [selectionSource])
  useEffect(() => {
    if (!selectedCardId || selectedCard?.validationError !== undefined) {
      setSelectedCardDetails(undefined)
      return
    }
    if (cardCollection?.source !== selectionSource) return
    let current = true
    void input.runAction(async () => {
      let result
      try {
        result = await readCardDetails(selectedCardId)
        if (current && selectedCard && result.card.version < selectedCard.version) {
          result = await readCardDetails(selectedCardId, true)
        }
      } catch (error) {
        if (current && selectionSourceRef.current === selectionSource && !selectionSource.disposed) throw error
        return
      }
      if (!current) return
      updateEditor(editor => {
        if (editor.selectedCardId !== selectedCardId) return editor
        const previous = editor.selectedCardDetails
        if (previous?.id === result.card.id && previous.version >= result.card.version) return editor
        return { ...editor, selectedCardDetails: result.card }
      })
    }).catch(() => undefined)
    return () => { current = false }
  }, [input.api, selectedCardId, selectedCard?.version, selectedCard?.validationError, cardCollection?.source])

  async function refreshCards(): Promise<CardSummary[]> {
    if (selectionSourceRef.current !== selectionSource || selectionSource.disposed) return []
    const request = ++refreshRequest.current
    const revision = selectionSource.collectionWrite
    const cards: CardSummary[] = []
    let cursor: string | undefined
    do {
      const result = await input.api.cards.list({ cursor, limit: 100 })
      cards.push(...result.cards)
      cursor = result.nextCursor
    } while (cursor)
    if (selectionSourceRef.current !== selectionSource || selectionSource.disposed || request !== refreshRequest.current) return cards
    if (revision !== selectionSource.collectionWrite) return refreshCards()
    setCardCollection({ source: selectionSource, cards })
    setSelectedCardId(current => {
      if (current && cards.some(card => card.id === current)) return current
      return cards.find(card => card.name === input.initialCardName)?.id ?? cards[0]?.id
    })
    return cards
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
        ...current.filter(card => card.id !== id),
      ])
      if (selection === selectionSource.request) publishSelectedCard(result.card)
      await refreshCards()
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
          ...current.filter(card => card.id !== id),
        ])
        if (selection === selectionSource.request) publishSelectedCard(result.card)
        await refreshCards()
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
      await refreshCards()
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
      await refreshCards()
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
      await refreshCards()
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
      setCards(current => current.filter(card => !deletedIds.has(card.id)))
      setSelectedCardId(current => current && deletedIds.has(current) ? undefined : current)
      setSelectedCardDetails(current => current && deletedIds.has(current.id) ? undefined : current)
      onCommitted?.(deleted.cardIds)
      await refreshCards()
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
      await refreshCards()
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
            ...current.filter(card => card.id !== id),
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
        await refreshCards()
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

  function applyUpdatedCard(card: Card): void {
    selectionSource.detailReads.delete(card.id)
    setSelectedCardDetails(current => current?.id === card.id && current.version <= card.version ? card : current)
    setCards(current => current.map(summary => summary.id === card.id && summary.version <= card.version
      ? { ...summary, ...readCardDraft(card), media: card.media, version: card.version, updatedAt: card.updatedAt }
      : summary))
  }

  function publishSelectedCard(card: Card): void {
    updateEditor(() => ({ selectedCardId: card.id, selectedCardDetails: card }))
  }

  function recordCardEdit(entry: Parameters<UseCardsInput['recordEdit']>[0]): void {
    if (selectionSourceRef.current === selectionSource && !selectionSource.disposed) input.recordEdit(entry)
  }

  function assertCurrentSource(): void {
    if (selectionSourceRef.current !== selectionSource || selectionSource.disposed) {
      throw new DOMException('Card operation source changed; completed writes were not reverted.', 'AbortError')
    }
  }

  function setCards(update: CardSummary[] | ((current: CardSummary[]) => CardSummary[])): void {
    if (selectionSourceRef.current !== selectionSource || selectionSource.disposed) return
    selectionSource.collectionWrite += 1
    setCardCollection(current => ({
      source: selectionSource,
      cards: typeof update === 'function'
        ? update(current?.source === selectionSource ? current.cards : [])
        : update,
    }))
  }

  return {
    directoryApi: input.api.directories,
    cards,
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
