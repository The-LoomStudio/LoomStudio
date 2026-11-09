import { ResourceDownloadsLauncher } from '../resource-downloads/resource-downloads-launcher.js'
import { CardDeleteConfirmation } from '../../features/cards/ui/card-delete-confirmation.js'
import { CharacterUpdateDialog } from '../../features/cards/ui/character-update-dialog.js'
import { CardPackageUpdateDialog } from '../../features/resource-updates/ui/card-package-update-dialog.js'
import { ArrowDownUp, ArrowLeft, ArrowUpCircle, BookOpen, Check, ChevronLeft, ChevronRight, Circle, Combine, Download, FileArchive, Folder, GitFork, Grid2X2, ImageDown, List, Pencil, Play, Plus, RefreshCw, SquareArrowRightEnter, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent, type DragEvent, type FormEvent } from 'react'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger, Dialog, SearchField, Toggle, type MenuAction } from '@loom-studio/ui'
import { formatDateTime, type Translator } from '../../shared/i18n/index.js'
import { useCharacterGalleryStore, type CharacterGroupFilter } from './character-gallery-store.js'
import { useCharacterProfileNavigation } from './use-character-profile-navigation.js'
import { MasterDetailWorkbench } from '../../shared/ui/master-detail-workbench/master-detail-workbench.js'
import { PanelTabs } from '../../shared/ui/panel-tabs/index.js'
import type { PromptResource } from '../../entities/index.js'
import type { MacroRenderContext } from '../../features/state-variables/model/macro-renderer.js'
import styles from './character-panel.module.scss'
import { DirectoryDiscoveryNotice, type CardDirectoryApi } from './card-resource-overview.js'
import { CardResourceDirectory } from './card-resource-directory.js'
import { cardMediaUrl, useCardMediaRevision } from '../../shared/lib/card-media.js'
import { normalizeSearchText } from '../../shared/lib/text.js'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { OpeningChoice } from '../../features/cards/model/opening-choice.js'
import type { CharacterCardSummary } from '../../features/cards/model/character-card-summary.js'
import { useCharacterProfileEditor } from '../../features/cards/model/use-character-profile-editor.js'
import { useCardDirectoryDiscovery } from '../../features/cards/model/use-card-directory-discovery.js'
import { notify } from '../../shared/notifications/index.js'

type NarrativeTimelineView = { id: string; title?: string; createdAt: string; updatedAt: string }
type GalleryMode = 'grid' | 'list'
type MediaTarget = 'avatar' | 'background'

type CharacterPanelProps = {
  active: boolean
  busy: boolean
  cards: CharacterCardSummary[]
  onCreateCard(): Promise<void>
  onForkCard(cardId: string, expectedVersion: number): Promise<void>
  onCreateTimelineFromCard(cardId: string, choice?: OpeningChoice, cardVersion?: number): Promise<boolean | void>
  onExportCard(card: CharacterCardSummary, format: 'png' | 'polyglot' | 'loomcard' | 'directory'): Promise<void>
  directoryApi?: CardDirectoryApi
  resourceApi: Pick<import('../../shared/api/studio-api.js').StudioApi, 'cards' | 'narratives' | 'textTransforms' | 'loomScripts' | 'states' | 'extensions' | 'extensionRuntime' | 'portableExtensionPayloads' | 'resourceDownloads' | 'promptResources'>
  endpoint: string
  onChangeResourceNode(id: string, partial: Partial<import('../../entities/index.js').ContextAssetNode>): void
  onCommitResourceNode(id: string, partial: Partial<import('../../entities/index.js').ContextAssetNode>): void
  onOpenLore?(resource: PromptResource, nodeId: string): void
  resourceDirectorySelectedId?: string
  resourceDirectoryExpandedIds?: string[]
  onResourceDirectoryStateChange?(selectedId: string | undefined, expandedIds: string[]): void
  resourceDirectoryOpen?: boolean
  onResourceDirectoryOpenChange?(open: boolean): void
  onRefreshCards?(): Promise<unknown>
  onImportCards(files: File[]): Promise<void>
  onDeleteCards(cardIds: string[], options?: { includePlayData?: boolean; includePromptResources?: boolean }): Promise<void>
  onPreviewCardDeletion(cardId: string): Promise<{ timelines: Array<{ id: string }> }>
  onSelectCard(cardId: string): void
  onPreviewCard(cardId: string): void
  onOpenTimeline(timeline: NarrativeTimelineView, cardId: string): void
  resources?: PromptResource[]
  onUpdateCardMedia(cardId: string, target: MediaTarget, file: File): Promise<void>
  onUpdateCardProfile(patch: { cardId: string; expectedVersion: number; name: string; userName: string; description: string; opening?: CharacterCardSummary['opening'] }): Promise<unknown>
  selectedCard?: CharacterCardSummary
  selectedCardId?: string
  routeCardId?: string
  timeline?: NarrativeTimelineView
  macroContext?: MacroRenderContext
  t: Translator
}

const GALLERY_PAGE_SIZE = 30
const MAX_MEDIA_BYTES = 10 * 1024 * 1024
const PAGE_TRANSITION_MS = 180

export function CharacterPanel(props: CharacterPanelProps) {
  const mediaRevision = useCardMediaRevision()
  const mediaUrl = (card: CharacterCardSummary, target: MediaTarget) => cardMediaUrl(card.id, target, target === 'avatar' ? card.media?.avatarAssetId : card.media?.coverAssetId, mediaRevision) ?? (target === 'avatar' ? '/images/default-card.png' : undefined)
  const organization = useCharacterGalleryStore()
  const [galleryMode, setGalleryMode] = useState<GalleryMode>('grid')
  const [query, setQuery] = useState('')
  const [visibleCount, setVisibleCount] = useState(GALLERY_PAGE_SIZE)
  const [dragTarget, setDragTarget] = useState<MediaTarget>()
  const [mediaNotice, setMediaNotice] = useState('')
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(new Set())
  const [groupDraft, setGroupDraft] = useState('')
  const [editingGroupId, setEditingGroupId] = useState<string>()
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[]>()
  const [includePlayData, setIncludePlayData] = useState(true)
  const [includePromptResources, setIncludePromptResources] = useState(true)
  const [exportCard, setExportCard] = useState<CharacterCardSummary>()
  const [profileTab, setProfileTab] = useState<'profile' | 'attachments'>(() => props.resourceDirectoryOpen ? 'attachments' : 'profile')
  const { discovered, closeDiscovery, refreshing, refreshError, refreshGallery } = useCardDirectoryDiscovery(props.directoryApi, props.onRefreshCards)
  const characterPanelRef = useRef<HTMLDivElement>(null)
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const backgroundInputRef = useRef<HTMLInputElement>(null)
  const cardImportInputRef = useRef<HTMLInputElement>(null)
  const gallerySentinelRef = useRef<HTMLDivElement>(null)
  const galleryCards = props.cards
  const [mobilePane, setMobilePane] = useState<'master' | 'detail'>(props.routeCardId ? 'detail' : 'master')
  const { closeProfile, openProfile: setOpenProfile, profileCardId } = useCharacterProfileNavigation(props.routeCardId, pageTransitionDelay)
  const [activeCardId, setActiveCardId] = useState<string | undefined>(props.routeCardId ?? props.selectedCardId ?? props.selectedCard?.id)

  useEffect(() => {
    if (profileCardId) {
      setActiveCardId(profileCardId)
      setMobilePane('detail')
    }
  }, [profileCardId])

  useEffect(() => {
    if (props.routeCardId) {
      setActiveCardId(props.routeCardId)
      setMobilePane('detail')
    }
  }, [props.routeCardId])

  const queryClient = useQueryClient()
  const targetCardId = activeCardId ?? props.selectedCard?.id ?? galleryCards[0]?.id
  const targetSummary = galleryCards.find(card => card.id === targetCardId)
    ?? (props.selectedCard?.id === targetCardId ? props.selectedCard : undefined)
  const invalidCard = targetSummary?.validationError !== undefined
  const detail = useQuery({
    queryKey: ['character-browser', props.endpoint, targetCardId],
    enabled: props.active && Boolean(targetSummary) && !invalidCard,
    queryFn: async () => {
      const { card } = await props.resourceApi.cards.get(targetCardId!)
      const timelines: NarrativeTimelineView[] = []
      let cursor: string | undefined
      do {
        const page = await props.resourceApi.narratives.list({ createdFromCardId: card.id, cursor, limit: 100 })
        timelines.push(...page.timelines)
        cursor = page.nextCursor
      } while (cursor)
      return { card, timelines }
    },
  })
  const selected: CharacterCardSummary | undefined = targetCardId
    ? invalidCard ? targetSummary : detail.data?.card ?? targetSummary
    : undefined
  const {
    nameDraft, setNameDraft, authorDraft, setAuthorDraft, descDraft, setDescDraft,
    activeOpeningIndex, setActiveOpeningIndex, activeOpening, openingTitleDraft, setOpeningTitleDraft, openingDraft, setOpeningDraft, totalOpenings,
    saveCardField, handleOpeningBlur, handleAddAlternative, handleDeleteAlternative
  } = useCharacterProfileEditor({ selected, onUpdateCardProfile: props.onUpdateCardProfile, refreshDetail: detail.refetch, onRefreshCards: props.onRefreshCards })

  const [timelineSortOrder, setTimelineSortOrder] = useState<'desc' | 'asc'>('desc')
  const [updateCardDialogOpen, setUpdateCardDialogOpen] = useState(false)
  const [activeUpdateTaskId, setActiveUpdateTaskId] = useState<string>()

  const sortedTimelines = useMemo(() => {
    return [...(detail.data?.timelines ?? [])].sort((left, right) => {
      const comparison = right.updatedAt.localeCompare(left.updatedAt)
      return timelineSortOrder === 'desc' ? comparison : -comparison
    })
  }, [detail.data?.timelines, timelineSortOrder])
  const latestTimeline = timelineSortOrder === 'desc' ? sortedTimelines[0] : sortedTimelines.at(-1)

  const groupedCards = useMemo(() => filterCardsByGroup(galleryCards, organization.assignments, organization.activeGroupId), [galleryCards, organization.activeGroupId, organization.assignments])
  const filteredCards = useMemo(() => {
    const normalizedQuery = normalizeSearchText(query)
    if (!normalizedQuery) return groupedCards
    return groupedCards.filter(card => [card.name, card.userName, card.description].some(value => value?.toLocaleLowerCase().includes(normalizedQuery)))
  }, [groupedCards, query])
  const visibleCards = filteredCards.slice(0, visibleCount)

  useEffect(() => {
    setVisibleCount(GALLERY_PAGE_SIZE)
  }, [query, organization.activeGroupId])

  useEffect(() => {
    if (!props.active) closeGroupDialog()
  }, [props.active])

  useEffect(() => {
    setIncludePlayData(true)
    setIncludePromptResources(true)
  }, [pendingDeleteIds])
  const deletionPreview = useQuery({
    queryKey: ['card-delete-preview', props.endpoint, pendingDeleteIds],
    enabled: Boolean(pendingDeleteIds?.length),
    queryFn: async () => {
      const previews = await Promise.all(pendingDeleteIds!.map(cardId => props.onPreviewCardDeletion(cardId)))
      return previews.reduce((total, preview) => total + preview.timelines.length, 0)
    },
    retry: false,
    staleTime: 0,
    refetchOnReconnect: false,
    gcTime: 0,
  })
  useEffect(() => {
    const knownCardIds = new Set(galleryCards.map(card => card.id))
    setSelectedCardIds(current => new Set([...current].filter(cardId => knownCardIds.has(cardId))))
  }, [galleryCards])

  useEffect(() => {
    const sentinel = gallerySentinelRef.current
    const root = characterPanelRef.current
    if (!props.active || !sentinel || !root || visibleCount >= filteredCards.length) return

    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setVisibleCount(current => Math.min(current + GALLERY_PAGE_SIZE, filteredCards.length))
      }
    }, { root, rootMargin: '240px 0px' })
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [filteredCards.length, props.active, visibleCount])

  function openProfile(card: CharacterCardSummary) {
    setActiveCardId(card.id)
    props.onSelectCard(card.id)
    setOpenProfile(card.id)
    setMobilePane('detail')
  }

  function handleBack() {
    closeProfile()
    setMobilePane('master')
  }

  function replaceMedia(card: CharacterCardSummary, target: MediaTarget, file: File) {
    if (!file.type.startsWith('image/')) {
      setMediaNotice(props.t('character.mediaInvalid'))
      return
    }
    if (file.size > MAX_MEDIA_BYTES) {
      setMediaNotice(props.t('character.mediaTooLarge'))
      return
    }
    void props.onUpdateCardMedia(card.id, target, file).then(() =>
      queryClient.invalidateQueries({ queryKey: ['character-browser', props.endpoint, card.id] }),
    ).catch(error => {
      setMediaNotice(error instanceof Error ? error.message : String(error))
    })
    setMediaNotice('')
  }

  function readDroppedFile(card: CharacterCardSummary, target: MediaTarget, event: DragEvent<HTMLElement>) {
    event.preventDefault()
    setDragTarget(undefined)
    const file = event.dataTransfer.files[0]
    if (file) replaceMedia(card, target, file)
  }

  function readPastedFile(card: CharacterCardSummary, target: MediaTarget, event: ClipboardEvent<HTMLElement>) {
    const file = Array.from(event.clipboardData.files).find(candidate => candidate.type.startsWith('image/'))
    if (!file) return
    event.preventDefault()
    replaceMedia(card, target, file)
  }

  function selectMedia(card: CharacterCardSummary, target: MediaTarget, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) replaceMedia(card, target, file)
  }

  function openMediaPicker(target: MediaTarget) {
    if (target === 'avatar') avatarInputRef.current?.click()
    else backgroundInputRef.current?.click()
  }

  function toggleCardSelection(cardId: string) {
    setSelectedCardIds(current => {
      const next = new Set(current)
      if (next.has(cardId)) next.delete(cardId)
      else next.add(cardId)
      return next
    })
  }

  function enterSelectionMode(cardId?: string) {
    setSelectionMode(true)
    if (cardId) setSelectedCardIds(current => new Set(current).add(cardId))
  }

  function exitSelectionMode() {
    setSelectionMode(false)
    setSelectedCardIds(new Set())
  }

  function openGroupPicker(cardIds?: string[]) {
    if (cardIds?.length) {
      setSelectionMode(true)
      setSelectedCardIds(current => new Set([...current, ...cardIds]))
    }
    organization.setGroupsOpen(true)
  }

  function assignCardsToGroup(groupId?: string, cardIds = [...selectedCardIds]) {
    if (cardIds.length === 0) return
    organization.assignCards(cardIds, groupId)
  }

  async function confirmDelete() {
    if (!deletionPreview.isSuccess || deletionPreview.isFetching || props.busy) return
    const cardIds = pendingDeleteIds ?? []
    if (cardIds.length === 0) {
      setPendingDeleteIds(undefined)
      return
    }
    await props.onDeleteCards(cardIds, { includePlayData, includePromptResources })
    organization.removeCards(cardIds)
    setSelectedCardIds(current => new Set([...current].filter(cardId => !cardIds.includes(cardId))))
    setPendingDeleteIds(undefined)
    if (cardIds.includes(targetCardId ?? '')) {
      setActiveCardId(undefined)
      handleBack()
    }
  }

  function saveGroup(event: FormEvent) {
    event.preventDefault()
    if (editingGroupId) organization.renameGroup(editingGroupId, groupDraft)
    else {
      const groupId = organization.createGroup(groupDraft)
      if (groupId) assignCardsToGroup(groupId)
    }
    setGroupDraft('')
    setEditingGroupId(undefined)
  }

  function closeGroupDialog() {
    organization.setGroupsOpen(false)
    setEditingGroupId(undefined)
    setGroupDraft('')
  }

  function selectGroupFilter(groupId: CharacterGroupFilter) {
    setSelectedCardIds(new Set())
    organization.setActiveGroup(groupId)
  }

  const overlays = (
    <>
      {discovered && props.directoryApi ? <DirectoryDiscoveryNotice catalog={discovered} api={props.directoryApi} onRefresh={props.onRefreshCards} t={props.t} onClose={closeDiscovery} /> : null}
      {updateCardDialogOpen && selected ? (
        <CharacterUpdateDialog
          open
          card={selected}
          downloadsApi={props.resourceApi.resourceDownloads}
          t={props.t}
          onClose={() => setUpdateCardDialogOpen(false)}
          onSelectTask={taskId => {
            setUpdateCardDialogOpen(false)
            setActiveUpdateTaskId(taskId)
          }}
        />
      ) : null}
      {activeUpdateTaskId && selected ? (
        <CardPackageUpdateDialog
          api={props.resourceApi.resourceDownloads}
          taskId={activeUpdateTaskId}
          cardId={selected.id}
          t={props.t}
          onClose={() => setActiveUpdateTaskId(undefined)}
          onApplied={async () => {
            setActiveUpdateTaskId(undefined)
            await props.onRefreshCards?.()
            await detail.refetch()
          }}
          onSaveCopy={props.resourceApi.promptResources ? async input => {
            const result = await props.resourceApi.promptResources.duplicate(input)
            return { id: result.resource.id, label: result.resource.rootNode.label }
          } : undefined}
        />
      ) : null}
      {organization.groupsOpen ? (
        <CharacterGroupDialog
          activeGroupId={organization.activeGroupId}
          editingGroupId={editingGroupId}
          groupDraft={groupDraft}
          groups={organization.groups}
          selectedCount={selectedCardIds.size}
          t={props.t}
          onAssign={assignCardsToGroup}
          onClose={closeGroupDialog}
          onDeleteGroup={organization.deleteGroup}
          onEditGroup={group => {
            setEditingGroupId(group.id)
            setGroupDraft(group.name)
          }}
          onGroupDraftChange={setGroupDraft}
          onSave={saveGroup}
          onSelectFilter={selectGroupFilter}
        />
      ) : null}
      <Dialog
        className={styles.exportDialog}
        closeOnBackdrop
        description={props.t('character.exportDialogDescription')}
        open={Boolean(exportCard)}
        title={props.t('character.exportDialogTitle')}
        onClose={() => setExportCard(undefined)}
      >
        <div className={styles.exportOptions}>
          <ExportOption description={props.t('character.saveDirectoryDescription')} icon={<Folder aria-hidden="true" />} label={props.t('character.saveDirectory')} onClick={() => exportCard && exportSelectedCard(exportCard, 'directory')} />
          <ExportOption description={props.t('character.exportPngDescription')} icon={<ImageDown aria-hidden="true" />} label={props.t('character.exportPng')} onClick={() => exportCard && exportSelectedCard(exportCard, 'png')} />
          <ExportOption description={props.t('character.exportPolyglotDescription')} icon={<Combine aria-hidden="true" />} label={props.t('character.exportPolyglot')} onClick={() => exportCard && exportSelectedCard(exportCard, 'polyglot')} />
          <ExportOption description={props.t('character.exportLoomCardDescription')} icon={<FileArchive aria-hidden="true" />} label={props.t('character.exportLoomCard')} onClick={() => exportCard && exportSelectedCard(exportCard, 'loomcard')} />
        </div>
      </Dialog>
      <CardDeleteConfirmation
        busy={props.busy}
        count={pendingDeleteIds?.length ?? 0}
        includePlayData={includePlayData}
        includePromptResources={includePromptResources}
        open={Boolean(pendingDeleteIds)}
        timelineCount={deletionPreview.data ?? 0}
        previewReady={deletionPreview.isSuccess && !deletionPreview.isFetching}
        previewError={deletionPreview.error?.message}
        onRetryPreview={() => { void deletionPreview.refetch() }}
        t={props.t}
        onCancel={() => setPendingDeleteIds(undefined)}
        onConfirm={() => void confirmDelete().catch(() => undefined)}
        onIncludePlayDataChange={setIncludePlayData}
        onIncludePromptResourcesChange={setIncludePromptResources}
      />
    </>
  )

  return (
    <aside className={styles.characterPanel} data-loom-component="character-panel">
      <MasterDetailWorkbench
        className={styles.characterWorkbench}
        defaultMasterWidth={320}
        masterMinWidth={240}
        mobilePane={mobilePane}
        onMobilePaneChange={setMobilePane}
        onBack={handleBack}
        backLabel={props.t('character.back')}
        resizeLabel={props.t('character.resizeList')}
        master={(
          <div ref={characterPanelRef} className={styles.galleryPane}>
            <input
              ref={cardImportInputRef}
              accept="image/png,.png,.loomcard,.zip,application/zip,application/vnd.loom.card+zip"
              className={styles.mediaInput}
              multiple
              type="file"
              onChange={event => {
                const files = Array.from(event.target.files ?? [])
                event.target.value = ''
                if (files.length > 0) void props.onImportCards(files).catch(err => {
                  notify.failure(props.t('character.operationFailed'), err)
                })
              }}
            />
            <header className={styles.galleryToolbar}>
              {selectionMode ? (
                <div className={styles.selectionToolbar}>
                  <span>{props.t('character.selectionCount', { count: selectedCardIds.size })}</span>
                  <div>
                    <button disabled={selectedCardIds.size === 0} type="button" onClick={() => openGroupPicker()}><Folder aria-hidden="true" />{props.t('character.moveToGroup')}</button>
                    <button className={styles.deleteButton} disabled={selectedCardIds.size === 0 || props.busy} type="button" onClick={() => setPendingDeleteIds([...selectedCardIds])}><Trash2 aria-hidden="true" />{props.t('character.delete')}</button>
                    <button aria-label={props.t('character.exitSelection')} className={styles.toolbarButton} title={props.t('character.exitSelection')} type="button" onClick={exitSelectionMode}><X aria-hidden="true" /></button>
                  </div>
                </div>
              ) : (
                <>
                  <div className={styles.galleryToolbarMain}>
                    <div className={styles.galleryActions}>
                      {props.directoryApi ? <button aria-label={props.t('directory.refresh')} className={styles.toolbarButton} disabled={refreshing || props.busy} title={props.t('directory.refresh')} type="button" onClick={() => void refreshGallery()}><RefreshCw aria-hidden="true" /></button> : null}
                      <button aria-label={props.t('character.import')} className={styles.toolbarButton} disabled={props.busy} title={props.t('character.import')} type="button" onClick={() => cardImportInputRef.current?.click()}><SquareArrowRightEnter aria-hidden="true" /></button>
                      <ResourceDownloadsLauncher compact kind="card" api={props.resourceApi.resourceDownloads} cardId={targetCardId} promptResourceApi={props.resourceApi.promptResources} onChanged={props.onRefreshCards} />
                      <button aria-label={props.t('character.create')} className={styles.createButton} disabled={props.busy} title={props.t('character.create')} type="button" onClick={() => void props.onCreateCard().catch(err => {
                        notify.failure(props.t('character.operationFailed'), err)
                      })}><Plus aria-hidden="true" /></button>
                    </div>
                    <div className={styles.viewSwitcher} role="group" aria-label={props.t('character.gallery')}>
                      <button
                        aria-label={props.t('character.grid')}
                        aria-pressed={galleryMode === 'grid'}
                        className={`${styles.viewSwitcherBtn} ${galleryMode === 'grid' ? styles.viewSwitcherBtnActive : ''}`}
                        title={props.t('character.grid')}
                        type="button"
                        onClick={() => setGalleryMode('grid')}
                      >
                        <Grid2X2 aria-hidden="true" />
                      </button>
                      <button
                        aria-label={props.t('character.list')}
                        aria-pressed={galleryMode === 'list'}
                        className={`${styles.viewSwitcherBtn} ${galleryMode === 'list' ? styles.viewSwitcherBtnActive : ''}`}
                        title={props.t('character.list')}
                        type="button"
                        onClick={() => setGalleryMode('list')}
                      >
                        <List aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                  <SearchField
                    containerClassName={styles.gallerySearchContainer}
                    aria-label={props.t('character.searchPlaceholder')}
                    placeholder={props.t('character.searchPlaceholder')}
                    clearLabel={props.t('context.search.clear')}
                    value={query}
                    onChange={event => setQuery(event.target.value)}
                    onClear={() => setQuery('')}
                  />
                </>
              )}
            </header>

            {refreshError ? <p role="alert" className={styles.mediaNotice}>{refreshError}</p> : null}
            {filteredCards.length === 0 ? <p className={styles.empty}>{props.t('character.empty')}</p> : (
              <div className={galleryMode === 'grid' ? styles.grid : styles.list}>
                {visibleCards.map(card => (
                  <CharacterCard
                    active={card.id === selected?.id}
                    card={card}
                    key={card.id}
                    loadMedia={props.active}
                    mediaUrl={mediaUrl(card, 'avatar')}
                    mode={galleryMode}
                    selected={selectedCardIds.has(card.id)}
                    selectionMode={selectionMode}
                    t={props.t}
                    onDelete={() => setPendingDeleteIds([card.id])}
                    onOpenGroups={() => openGroupPicker([card.id])}
                    onOpenProfile={() => openProfile(card)}
                    onSelect={() => enterSelectionMode(card.id)}
                    onToggleSelection={() => toggleCardSelection(card.id)}
                  />
                ))}
                <div ref={gallerySentinelRef} className={styles.gallerySentinel}>{props.t('character.galleryCount', { shown: visibleCards.length, total: filteredCards.length })}</div>
              </div>
            )}
          </div>
        )}
      >
        {selected?.validationError !== undefined ? (
          <div className={styles.profilePane} data-loom-card-invalid>
            <header className={styles.profileToolbar}>
              <button aria-label={props.t('character.back')} className={`${styles.toolbarButton} ${styles.profileBackButton}`} title={props.t('character.back')} type="button" onClick={handleBack}><ArrowLeft aria-hidden="true" /></button>
              <span>{props.t('character.title')}</span>
              <div>
                <button aria-label={props.t('character.delete')} className={`${styles.toolbarButton} ${styles.deleteButton}`} disabled={props.busy} title={props.t('character.delete')} type="button" onClick={() => setPendingDeleteIds([selected.id])}><Trash2 aria-hidden="true" /></button>
              </div>
            </header>
            <section className={styles.profileIdentity}>
              <div><h2>{selected.name}</h2><p>{props.t('character.invalidCard')}</p></div>
              {selected.artifactId ? <dl className={styles.workIdentity}>
                <div><dt>{props.t('character.artifactId')}</dt><dd><code>{selected.artifactId}</code></dd></div>
                {selected.derivedFrom ? <div><dt>{props.t('character.derivedFrom')}</dt><dd><code>{selected.derivedFrom.artifactId}</code></dd></div> : null}
              </dl> : null}
              <div className={styles.startActions}>
                <button className={styles.toolbarButton} aria-label={props.t('character.continueNarrative')} title={props.t('character.continueNarrative')} disabled type="button"><Play aria-hidden="true" /></button>
                <button className={styles.toolbarButton} aria-label={props.t('character.newNarrative')} title={props.t('character.newNarrative')} disabled type="button"><Plus aria-hidden="true" /></button>
                <button className={styles.toolbarButton} aria-label={props.t('character.preview')} title={props.t('character.preview')} disabled type="button"><BookOpen aria-hidden="true" /></button>
              </div>
            </section>
            <p role="alert" className={styles.invalidReason}>{selected.validationError}</p>
          </div>
        ) : selected ? (
          <div className={styles.profilePane}>
            <input ref={backgroundInputRef} accept="image/*" className={styles.mediaInput} type="file" onChange={event => selectMedia(selected, 'background', event)} />
            <input ref={avatarInputRef} accept="image/*" className={styles.mediaInput} type="file" onChange={event => selectMedia(selected, 'avatar', event)} />
            <section className={styles.profileHero} style={{ backgroundImage: props.active && mediaUrl(selected, 'background') ? `url(${mediaUrl(selected, 'background')})` : 'none' }}>
              <div className={styles.profileHeroShade} />
              <button
                aria-label={props.t('character.changeBackground')}
                className={`${styles.heroMediaTarget} ${dragTarget === 'background' ? styles.mediaDropTarget : ''}`}
                title={props.t('character.mediaHint')}
                type="button"
                onClick={() => openMediaPicker('background')}
                onDragEnter={() => setDragTarget('background')}
                onDragLeave={() => setDragTarget(undefined)}
                onDragOver={event => event.preventDefault()}
                onDrop={event => readDroppedFile(selected, 'background', event)}
                onPaste={event => readPastedFile(selected, 'background', event)}
              >
                <span className={styles.mediaLabel}>{props.t('character.changeBackground')}</span>
              </button>
              <button
                aria-label={props.t('character.changeAvatar')}
                className={`${styles.profileAvatar} ${dragTarget === 'avatar' ? styles.mediaDropTarget : ''}`}
                title={props.t('character.mediaHint')}
                type="button"
                onClick={event => {
                  event.stopPropagation()
                  openMediaPicker('avatar')
                }}
                onDragEnter={event => {
                  event.stopPropagation()
                  setDragTarget('avatar')
                }}
                onDragLeave={event => {
                  event.stopPropagation()
                  setDragTarget(undefined)
                }}
                onDragOver={event => {
                  event.preventDefault()
                  event.stopPropagation()
                }}
                onDrop={event => {
                  event.stopPropagation()
                  readDroppedFile(selected, 'avatar', event)
                }}
                onPaste={event => {
                  event.stopPropagation()
                  readPastedFile(selected, 'avatar', event)
                }}
              >
                {mediaUrl(selected, 'avatar') && props.active ? <img alt="" src={mediaUrl(selected, 'avatar')} /> : null}
                <span className={styles.mediaLabel}>{props.t('character.changeAvatar')}</span>
              </button>
            </section>

            <header className={styles.profileToolbar}>
              <button aria-label={props.t('character.back')} className={`${styles.toolbarButton} ${styles.profileBackButton}`} title={props.t('character.back')} type="button" onClick={handleBack}><ArrowLeft aria-hidden="true" /></button>
              <span>{props.t('character.title')}</span>
              <div>
                {selectionMode && !selectedCardIds.has(selected.id) ? <button aria-label={props.t('character.select')} className={styles.toolbarButton} title={props.t('character.select')} type="button" onClick={() => enterSelectionMode(selected.id)}><Circle aria-hidden="true" /></button> : null}
                <button aria-label={props.t('character.updateCard')} className={styles.toolbarButton} disabled={props.busy} title={props.t('character.updateCard')} type="button" onClick={() => setUpdateCardDialogOpen(true)}><ArrowUpCircle aria-hidden="true" /></button>
                <button aria-label={props.t('character.export')} className={styles.toolbarButton} disabled={props.busy} title={props.t('character.export')} type="button" onClick={() => setExportCard(selected)}><Download aria-hidden="true" /></button>
                <button aria-label={props.t('character.forkWork')} className={styles.toolbarButton} disabled={props.busy} title={props.t('character.forkWork')} type="button" onClick={() => void props.onForkCard(selected.id, selected.version).catch(() => undefined)}><GitFork aria-hidden="true" /></button>
                <button aria-label={props.t('character.delete')} className={`${styles.toolbarButton} ${styles.deleteButton}`} disabled={props.busy} title={props.t('character.delete')} type="button" onClick={() => setPendingDeleteIds([selected.id])}><Trash2 aria-hidden="true" /></button>
              </div>
            </header>

            <section className={styles.profileIdentity}>
              <div>
                <input
                  aria-label={props.t('character.name')}
                  className={styles.inlineNameInput}
                  disabled={props.busy}
                  value={nameDraft}
                  placeholder={props.t('character.name')}
                  onChange={event => setNameDraft(event.target.value)}
                  onBlur={() => {
                    if (nameDraft.trim() && nameDraft !== selected.name) {
                      void saveCardField({ name: nameDraft.trim() })
                    }
                  }}
                />
                <input
                  aria-label={props.t('character.author')}
                  className={styles.inlineAuthorInput}
                  disabled={props.busy}
                  value={authorDraft}
                  placeholder={props.t('character.author')}
                  onChange={event => setAuthorDraft(event.target.value)}
                  onBlur={() => {
                    if (authorDraft !== (selected.userName ?? '')) {
                      void saveCardField({ userName: authorDraft })
                    }
                  }}
                />
              </div>
              <div className={styles.startActions}>
                <button className={styles.toolbarButton} aria-label={props.t('character.continueNarrative')} title={props.t('character.continueNarrative')} disabled={props.busy || !latestTimeline} type="button" onClick={() => {
                  if (latestTimeline) props.onOpenTimeline(latestTimeline, selected.id)
                }}><Play aria-hidden="true" /></button>
                <button className={styles.toolbarButton} aria-label={props.t('character.newNarrative')} title={props.t('character.newNarrative')} disabled={props.busy} type="button" onClick={() => {
                  void props.onCreateTimelineFromCard(selected.id, selected.opening ? { kind: 'card', id: selected.opening.id } : { kind: 'empty' }, selected.version)
                }}><Plus aria-hidden="true" /></button>
                <button className={styles.toolbarButton} aria-label={props.t('character.preview')} title={props.t('character.preview')} disabled={props.busy} type="button" onClick={() => props.onPreviewCard(selected.id)}>
                  <BookOpen aria-hidden="true" /></button>
              </div>
            </section>
            {mediaNotice ? <p aria-live="polite" className={styles.mediaNotice}>{mediaNotice}</p> : null}

            <div className={styles.profileTabs}>
              <PanelTabs<'profile' | 'attachments'>
                activeId={profileTab}
                ariaLabel={props.t('character.title')}
                items={[
                  { id: 'profile', label: props.t('character.title') },
                  { id: 'attachments', label: props.t('directory.attachments') },
                ]}
                onChange={tab => {
                  setProfileTab(tab)
                  props.onResourceDirectoryOpenChange?.(tab === 'attachments')
                }}
              />
            </div>
            {profileTab === 'attachments' ? <div role="tabpanel" id="card-attachments-panel" aria-labelledby="card-attachments-tab"><CardResourceDirectory key={selected.id} api={props.resourceApi} endpoint={props.endpoint} directoryApi={props.directoryApi} cardId={selected.id} resources={props.resources ?? []} onChangeNode={props.onChangeResourceNode} onCommitNode={props.onCommitResourceNode} onRefreshCards={props.onRefreshCards} onOpenLore={props.onOpenLore} selectedTreeId={props.resourceDirectorySelectedId} expandedTreeIds={props.resourceDirectoryExpandedIds} onTreeStateChange={props.onResourceDirectoryStateChange} t={props.t} /></div> : <div role="tabpanel" id="card-profile-panel" aria-labelledby="card-profile-tab">
              <section className={styles.profileContent}>
                <div>
                  <h3>{props.t('character.description')}</h3>
                  <textarea
                    aria-label={props.t('character.description')}
                    className={styles.inlineDescriptionInput}
                    disabled={props.busy}
                    value={descDraft}
                    placeholder={props.t('character.descriptionEmpty')}
                    rows={5}
                    onChange={event => setDescDraft(event.target.value)}
                    onBlur={() => {
                      if (descDraft !== (selected.description ?? '')) {
                        void saveCardField({ description: descDraft })
                      }
                    }}
                  />
                </div>
                <div className={styles.characterResourcesSection}>
                  <header className={styles.sectionHeader}>
                    <h3>{props.t('character.resources')}</h3>
                  </header>
                  <button className={styles.resourceCard} type="button" onClick={() => setProfileTab('attachments')}>
                    <span className={styles.resourceCardIcon}><BookOpen aria-hidden="true" /></span>
                    <span className={styles.resourceCardInfo}><span className={styles.resourceCardName}>{props.t('directory.attachments')}</span></span>
                    <ChevronRight aria-hidden="true" className={styles.resourceCardArrow} />
                  </button>
                </div>

                <div className={styles.openingSection}>
                  <header className={styles.openingHeader}>
                    <div className={styles.openingHeaderLeft}>
                      <div className={styles.openingPagination}>
                        <button
                          aria-label="Previous opening"
                          className={styles.pagingBtn}
                          disabled={props.busy || activeOpeningIndex <= 0}
                          type="button"
                          onClick={() => setActiveOpeningIndex(prev => Math.max(0, prev - 1))}
                        >
                          <ChevronLeft size={15} aria-hidden="true" />
                        </button>
                        <span className={styles.pagingIndicator}>{activeOpeningIndex + 1}/{totalOpenings}</span>
                        <button
                          aria-label="Next opening"
                          className={styles.pagingBtn}
                          disabled={props.busy || activeOpeningIndex >= totalOpenings - 1}
                          type="button"
                          onClick={() => setActiveOpeningIndex(prev => Math.min(totalOpenings - 1, prev + 1))}
                        >
                          <ChevronRight size={15} aria-hidden="true" />
                        </button>
                      </div>
                      <h3>
                        {activeOpeningIndex === 0 ? props.t('character.defaultOpening') : `${props.t('character.alternativeOpening')} ${activeOpeningIndex}`}
                      </h3>
                    </div>
                    <div className={styles.openingActions}>
                      <button
                        className={styles.pagingActionBtn}
                        disabled={props.busy}
                        type="button"
                        onClick={() => void handleAddAlternative()}
                      >
                        <Plus size={14} aria-hidden="true" />
                        <span>{props.t('character.addOpening')}</span>
                      </button>
                      {activeOpeningIndex > 0 ? (
                        <button
                          aria-label={props.t('character.deleteOpening')}
                          className={styles.pagingDeleteBtn}
                          disabled={props.busy}
                          title={props.t('character.deleteOpening')}
                          type="button"
                          onClick={() => void handleDeleteAlternative()}
                        >
                          <Trash2 size={14} aria-hidden="true" />
                        </button>
                      ) : null}
                    </div>
                  </header>
                  <label>
                    <span>{props.t('character.openingTitle')}</span>
                    <input
                      className={styles.inlineAuthorInput}
                      disabled={props.busy}
                      value={openingTitleDraft}
                      onChange={event => setOpeningTitleDraft(event.target.value)}
                      onBlur={() => void handleOpeningBlur('title')}
                    />
                  </label>
                  <label>
                    <span>{props.t('character.openingId')}</span>
                    <input
                      className={styles.inlineAuthorInput}
                      readOnly
                      value={activeOpening?.id ?? ''}
                      onFocus={event => event.currentTarget.select()}
                    />
                  </label>
                  <textarea
                    aria-label={props.t('character.opening')}
                    className={styles.inlineOpeningTextarea}
                    disabled={props.busy}
                    value={openingDraft}
                    placeholder={props.t('character.defaultOpening')}
                    rows={8}
                    onChange={event => setOpeningDraft(event.target.value)}
                    onBlur={() => void handleOpeningBlur()}
                  />
                </div>
              </section>

            <section className={styles.sessions}>
              <header className={styles.sessionsHeader}>
                <h3>{props.t('character.sessions')}</h3>
                {sortedTimelines.length > 1 ? (
                  <button
                    className={styles.sortToggleButton}
                    type="button"
                    title={props.t(timelineSortOrder === 'desc' ? 'character.sortLatest' : 'character.sortEarliest')}
                    onClick={() => setTimelineSortOrder(prev => prev === 'desc' ? 'asc' : 'desc')}
                  >
                    <ArrowDownUp aria-hidden="true" />
                    <span>{props.t(timelineSortOrder === 'desc' ? 'character.sortLatest' : 'character.sortEarliest')}</span>
                  </button>
                ) : null}
              </header>
              <div className={styles.sessionList}>
                {detail.error ? <p role="alert">{detail.error.message}</p> : null}
                {sortedTimelines.length === 0 ? (
                  <p>{props.t('branch.noBranches')}</p>
                ) : (
                  sortedTimelines.map(timeline => (
                    <TimelineCard
                      key={timeline.id}
                      timeline={timeline}
                      character={selected}
                      busy={props.busy}
                      current={timeline.id === props.timeline?.id}
                      onOpen={() => props.onOpenTimeline(timeline, selected.id)}
                      t={props.t}
                    />
                  ))
                )}
              </div>
            </section>
            </div>}
          </div>
        ) : (
          <div className={styles.profileEmpty}>
            <p className={styles.empty}>{props.t('character.empty')}</p>
          </div>
        )}
      </MasterDetailWorkbench>
      {overlays}
    </aside>
  )

  function exportSelectedCard(card: CharacterCardSummary, format: 'png' | 'polyglot' | 'loomcard' | 'directory') {
    setExportCard(undefined)
    void props.onExportCard(card, format).catch(() => undefined)
  }


}

function ExportOption(props: { description: string; icon: React.ReactNode; label: string; onClick(): void }) {
  return (
    <button className={styles.exportOption} type="button" onClick={props.onClick}>
      <span className={styles.exportOptionIcon}>{props.icon}</span>
      <span><strong>{props.label}</strong><small>{props.description}</small></span>
    </button>
  )
}

function CharacterCard(props: {
  active?: boolean
  card: CharacterCardSummary
  loadMedia: boolean
  mediaUrl?: string
  mode: GalleryMode
  selected: boolean
  selectionMode: boolean
  t: Translator
  onDelete(): void
  onOpenGroups(): void
  onOpenProfile(): void
  onSelect(): void
  onToggleSelection(): void
}) {
  const menuItems: MenuAction[] = [
    { checked: props.selected, icon: <Circle aria-hidden="true" />, id: 'select', label: props.selected ? props.t('character.deselect') : props.t('character.select'), onSelect: props.selected ? props.onToggleSelection : props.onSelect },
    { icon: <Folder aria-hidden="true" />, id: 'move-group', label: props.t('character.moveToGroup'), onSelect: props.onOpenGroups },
    { id: 'separator', type: 'separator' as const },
    { icon: <Trash2 aria-hidden="true" />, id: 'delete', label: props.t('character.delete'), onSelect: props.onDelete, tone: 'danger' as const },
  ]
  const className = [
    props.mode === 'grid' ? styles.gridCard : styles.listCard,
    props.selected ? styles.cardSelected : '',
    props.active ? styles.cardActive : '',
    props.card.validationError !== undefined ? styles.cardInvalid : '',
  ].filter(Boolean).join(' ')
  return (
    <ContextMenu>
      <div className={className} data-loom-card-invalid={props.card.validationError !== undefined ? '' : undefined}>
        <ContextMenuTrigger asChild>
          <button
            aria-current={props.active ? 'page' : undefined}
            aria-pressed={props.selectionMode ? props.selected : undefined}
            className={styles.cardOpen}
            title={props.card.validationError}
            type="button"
            onClick={props.onOpenProfile}
          >
            <div className={styles.cardCover}>
              {props.loadMedia && props.mediaUrl ? <img alt="" src={props.mediaUrl} /> : null}
            </div>
            <span><strong>{props.card.name}</strong><small>{props.card.validationError !== undefined ? props.t('character.invalidCard') : props.card.userName || props.t('character.authorUnknown')}</small></span>
          </button>
        </ContextMenuTrigger>
        {props.selectionMode ? <Toggle checked={props.selected} className={styles.selectionToggle} label={props.selected ? props.t('character.deselect') : props.t('character.select')} onChange={props.onToggleSelection} /> : null}
      </div>
      <ContextMenuContent>
        {menuItems.map(action => {
          if (action.type === 'separator') return <ContextMenuSeparator key={action.id} />
          return (
            <ContextMenuItem key={action.id} icon={action.checked ? <Check /> : action.icon} tone={action.tone} disabled={action.disabled} onSelect={() => action.onSelect()}>
              {action.label}
            </ContextMenuItem>
          )
        })}
      </ContextMenuContent>
    </ContextMenu>
  )
}

function CharacterGroupDialog(props: {
  activeGroupId: CharacterGroupFilter
  editingGroupId?: string
  groupDraft: string
  groups: { id: string; name: string }[]
  selectedCount: number
  t: Translator
  onAssign(groupId?: string): void
  onClose(): void
  onDeleteGroup(groupId: string): void
  onEditGroup(group: { id: string; name: string }): void
  onGroupDraftChange(value: string): void
  onSave(event: FormEvent): void
  onSelectFilter(groupId: CharacterGroupFilter): void
}) {
  function selectGroup(groupId: CharacterGroupFilter) {
    props.onSelectFilter(groupId)
    props.onClose()
  }

  return (
    <Dialog
      className={styles.groupDialog}
      closeOnBackdrop
      showCloseButton={false} headerActions={<button aria-label={props.t('character.closeGroups')} autoFocus className={styles.toolbarButton} title={props.t('character.closeGroups')} type="button" onClick={props.onClose}><X aria-hidden="true" /></button>}
      open
      title={props.t('character.groups')}
      onClose={props.onClose}
    >
        <div className={styles.groupList} data-loom-object="character-group-dialog">
          <button className={props.activeGroupId === undefined ? styles.groupRowActive : styles.groupRow} type="button" onClick={() => selectGroup(undefined)}>
            <span>{props.t('character.allGroups')}</span>
          </button>
          <button className={props.activeGroupId === 'ungrouped' ? styles.groupRowActive : styles.groupRow} type="button" onClick={() => selectGroup('ungrouped')}>
            <span>{props.t('character.ungrouped')}</span>
          </button>
          {props.groups.map(group => (
            <div className={styles.groupRowWrap} key={group.id}>
              <button className={props.activeGroupId === group.id ? styles.groupRowActive : styles.groupRow} type="button" onClick={() => selectGroup(group.id)}>
                <span>{group.name}</span>
              </button>
              <button aria-label={props.t('character.renameGroup')} className={styles.toolbarButton} title={props.t('character.renameGroup')} type="button" onClick={() => props.onEditGroup(group)}><Pencil aria-hidden="true" /></button>
              <button aria-label={props.t('character.deleteGroup')} className={`${styles.toolbarButton} ${styles.deleteButton}`} title={props.t('character.deleteGroup')} type="button" onClick={() => props.onDeleteGroup(group.id)}><Trash2 aria-hidden="true" /></button>
            </div>
          ))}
        </div>
        {props.selectedCount > 0 ? <div className={styles.groupAssign}><span>{props.t('character.selectionCount', { count: props.selectedCount })}</span><button type="button" onClick={() => props.onAssign()}>{props.t('character.ungrouped')}</button>{props.groups.map(group => <button key={group.id} type="button" onClick={() => props.onAssign(group.id)}>{group.name}</button>)}</div> : null}
        <form className={`${styles.groupForm} loom-underlined-fields`} onSubmit={props.onSave}>
          <input aria-label={props.editingGroupId ? props.t('character.renameGroup') : props.t('character.newGroup')} maxLength={40} placeholder={props.t('character.groupNamePlaceholder')} value={props.groupDraft} onChange={event => props.onGroupDraftChange(event.target.value)} />
          <button disabled={!props.groupDraft.trim()} type="submit">{props.editingGroupId ? props.t('character.save') : props.t('character.newGroup')}</button>
        </form>
    </Dialog>
  )
}


function filterCardsByGroup(cards: CharacterCardSummary[], assignments: Record<string, string | undefined>, activeGroupId: CharacterGroupFilter): CharacterCardSummary[] {
  if (!activeGroupId) return cards
  if (activeGroupId === 'ungrouped') return cards.filter(card => !assignments[card.id])
  return cards.filter(card => assignments[card.id] === activeGroupId)
}

function pageTransitionDelay(): number {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : PAGE_TRANSITION_MS
}

function TimelineCard(props: { character: CharacterCardSummary; timeline: NarrativeTimelineView; busy: boolean; current: boolean; onOpen(): void; t: Translator }) {
  const enterLabel = props.current ? props.t('character.enterCurrentSession') : props.t('character.enterSession')

  return (
    <button
      className={`${styles.sessionCard} ${props.current ? styles.sessionCardCurrent : ''}`}
      disabled={props.busy}
      type="button"
      title={enterLabel}
      aria-label={enterLabel}
      onClick={props.onOpen}
    >
      <span className={styles.sessionCardIcon}>
        <Play aria-hidden="true" />
      </span>

      <span className={styles.sessionCardContent}>
        <span className={styles.sessionCardHeader}>
          {props.current ? <span className={styles.currentBadge}>{props.t('character.activeBadge')}</span> : null}
          <strong className={styles.sessionCardTitle}>
            {props.timeline.title ?? props.t('branch.default')}
          </strong>
        </span>
        <span className={styles.sessionCardMeta}>
          <span>{formatTimelineDate(props.timeline.updatedAt)}</span>
          <span className={styles.sessionCardDivider}>·</span>
          <span>{props.t('character.sessionCreated')}: {formatTimelineDate(props.timeline.createdAt)}</span>
        </span>
      </span>

      <span
        className={styles.sessionCardId}
        title={`${props.t('character.sessionId')}: ${props.timeline.id}`}
      >
        #{shortId(props.timeline.id)}
      </span>
    </button>
  )
}

function formatTimelineDate(value: string): string {
  return formatDateTime(value)
}

function shortId(id: string): string {
  return id.slice(0, 13)
}
