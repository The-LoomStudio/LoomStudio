import { ArrowLeft, Braces, Check, Circle, ChevronRight, CloudDownload, Combine, Download, FileArchive, Folder, Grid2X2, ImageDown, List, Pencil, Plus, Trash2, Upload, Users, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent, type DragEvent, type FormEvent } from 'react'
import type { MenuAction } from '../../shared/ui/menu-action.js'
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator } from '../../shared/ui/context-menu/context-menu.js'
import type { Translator } from '../../shared/i18n/index.js'
import { Toggle } from '../../shared/ui/toggle/toggle.js'
import { Dialog } from '../../shared/ui/dialog/dialog.js'
import { useCharacterGalleryStore, type CharacterGroupFilter } from './character-gallery-store.js'
import { useCharacterProfileNavigation } from './use-character-profile-navigation.js'
import styles from './character-panel.module.scss'

type CharacterCardSummary = {
  id: string
  version: number
  name: string
  userName?: string
  description?: string
  media?: { avatarAssetId?: string; coverAssetId?: string }
  settingLayer?: { entries: unknown[] }
}

type NarrativeTimelineView = { id: string; title?: string; createdAt: string; updatedAt: string }
type GalleryMode = 'grid' | 'list'
type MediaTarget = 'avatar' | 'background'

type CharacterPanelProps = {
  active: boolean
  busy: boolean
  cardDraft: { name: string; userName: string; description: string }
  cards: CharacterCardSummary[]
  onChangeCardDraft(draft: { name: string; userName: string; description: string }): void
  onCreateCard(): Promise<void>
  onCreateTimelineFromCard(): Promise<void>
  onExportCard(card: CharacterCardSummary, format: 'png' | 'polyglot' | 'loomcard'): Promise<void>
  onImportCards(files: File[]): Promise<void>
  onDeleteCards(cardIds: string[], options?: { includePlayData?: boolean }): Promise<void>
  onPreviewCardDeletion(cardId: string): Promise<{ timelines: Array<{ id: string }> }>
  onSelectCard(cardId: string): void
  onOpenTimeline(timeline: NarrativeTimelineView): void
  onOpenStatePanel(): void
  onUpdateCardMedia(cardId: string, target: MediaTarget, file: File): Promise<void>
  onUpdateCard(event: FormEvent): Promise<void>
  selectedCard?: CharacterCardSummary
  selectedCardId?: string
  routeCardId?: string
  timeline?: NarrativeTimelineView
  timelines: NarrativeTimelineView[]
  t: Translator
}

export function CharacterPanelHeader(props: { t: Translator }) {
  const activeGroupId = useCharacterGalleryStore(state => state.activeGroupId)
  const groups = useCharacterGalleryStore(state => state.groups)
  const groupsOpen = useCharacterGalleryStore(state => state.groupsOpen)
  const setGroupsOpen = useCharacterGalleryStore(state => state.setGroupsOpen)
  const label = activeGroupId === 'ungrouped'
    ? props.t('character.ungrouped')
    : groups.find(group => group.id === activeGroupId)?.name ?? props.t('rail.character')

  return (
    <button aria-expanded={groupsOpen} aria-label={props.t('character.groups')} className={styles.headerTitle} type="button" onClick={() => setGroupsOpen(true)}>
      <Users aria-hidden="true" />
      <span className="loom-page-header-title">{label}</span>
    </button>
  )
}

const GALLERY_PAGE_SIZE = 30
const MAX_MEDIA_BYTES = 10 * 1024 * 1024
const MAX_REMOTE_CARD_BYTES = 128 * 1024 * 1024
const PAGE_TRANSITION_MS = 180

export function CharacterPanel(props: CharacterPanelProps) {
  const organization = useCharacterGalleryStore()
  const [profileEditing, setProfileEditing] = useState(false)
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
  const [deleteTimelineCount, setDeleteTimelineCount] = useState(0)
  const [includePlayData, setIncludePlayData] = useState(false)
  const [exportCard, setExportCard] = useState<CharacterCardSummary>()
  const [remoteImportOpen, setRemoteImportOpen] = useState(false)
  const [remoteImportUrl, setRemoteImportUrl] = useState('')
  const [remoteImportError, setRemoteImportError] = useState('')
  const [remoteImportBusy, setRemoteImportBusy] = useState(false)
  const characterPanelRef = useRef<HTMLDivElement>(null)
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const backgroundInputRef = useRef<HTMLInputElement>(null)
  const cardImportInputRef = useRef<HTMLInputElement>(null)
  const gallerySentinelRef = useRef<HTMLDivElement>(null)
  const galleryCards = props.cards
  const { closeProfile, openProfile: setOpenProfile, profileCardId, profileLeaving } = useCharacterProfileNavigation(props.routeCardId, pageTransitionDelay)
  const selected = profileCardId
    ? (props.selectedCard?.id === profileCardId ? props.selectedCard : undefined) ?? galleryCards.find(card => card.id === profileCardId)
    : undefined
  const characterView = profileCardId ? 'profile' : 'gallery'
  const groupedCards = useMemo(() => filterCardsByGroup(galleryCards, organization.assignments, organization.activeGroupId), [galleryCards, organization.activeGroupId, organization.assignments])
  const filteredCards = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
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
    let active = true
    setIncludePlayData(false)
    if (!pendingDeleteIds?.length) {
      setDeleteTimelineCount(0)
      return () => { active = false }
    }
    void Promise.all(pendingDeleteIds.map(cardId => props.onPreviewCardDeletion(cardId)))
      .then(previews => {
        if (active) setDeleteTimelineCount(previews.reduce((total, preview) => total + preview.timelines.length, 0))
      })
      .catch(() => {
        if (active) setDeleteTimelineCount(0)
      })
    return () => { active = false }
  }, [pendingDeleteIds, props.onPreviewCardDeletion])
  useEffect(() => {
    const knownCardIds = new Set(galleryCards.map(card => card.id))
    setSelectedCardIds(current => new Set([...current].filter(cardId => knownCardIds.has(cardId))))
  }, [galleryCards])

  useEffect(() => {
    const sentinel = gallerySentinelRef.current
    const root = characterPanelRef.current
    if (!props.active || characterView !== 'gallery' || !sentinel || !root || visibleCount >= filteredCards.length) return

    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        setVisibleCount(current => Math.min(current + GALLERY_PAGE_SIZE, filteredCards.length))
      }
    }, { root, rootMargin: '240px 0px' })
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [characterView, filteredCards.length, props.active, visibleCount])

  function openProfile(card: CharacterCardSummary) {
    props.onSelectCard(card.id)
    setProfileEditing(false)
    setOpenProfile(card.id)
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
    void props.onUpdateCardMedia(card.id, target, file).catch(error => {
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
    const cardIds = pendingDeleteIds ?? []
    if (cardIds.length === 0) {
      setPendingDeleteIds(undefined)
      return
    }
    await props.onDeleteCards(cardIds, { includePlayData })
    organization.removeCards(cardIds)
    setSelectedCardIds(current => new Set([...current].filter(cardId => !cardIds.includes(cardId))))
    setPendingDeleteIds(undefined)
    if (characterView === 'profile') closeProfile()
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
          <ExportOption description={props.t('character.exportPngDescription')} icon={<ImageDown aria-hidden="true" />} label={props.t('character.exportPng')} onClick={() => exportCard && exportSelectedCard(exportCard, 'png')} />
          <ExportOption description={props.t('character.exportPolyglotDescription')} icon={<Combine aria-hidden="true" />} label={props.t('character.exportPolyglot')} onClick={() => exportCard && exportSelectedCard(exportCard, 'polyglot')} />
          <ExportOption description={props.t('character.exportLoomCardDescription')} icon={<FileArchive aria-hidden="true" />} label={props.t('character.exportLoomCard')} onClick={() => exportCard && exportSelectedCard(exportCard, 'loomcard')} />
        </div>
      </Dialog>
      <Dialog
        actions={(
          <>
            <button disabled={remoteImportBusy} type="button" onClick={closeRemoteImport}>{props.t('character.cancel')}</button>
            <button disabled={remoteImportBusy || !remoteImportUrl.trim()} form="remote-card-import-form" type="submit">{props.t('character.importRemoteAction')}</button>
          </>
        )}
        className={styles.exportDialog}
        closeOnBackdrop
        description={props.t('character.importRemoteDescription')}
        dismissible={!remoteImportBusy}
        open={remoteImportOpen}
        title={props.t('character.importRemote')}
        onClose={closeRemoteImport}
      >
        <form className={styles.remoteImportForm} id="remote-card-import-form" onSubmit={event => void importRemoteCard(event)}>
          <label><span>{props.t('character.importRemoteUrl')}</span><input autoFocus disabled={remoteImportBusy} inputMode="url" placeholder="https://cdn.example.com/card.png" type="url" value={remoteImportUrl} onChange={event => { setRemoteImportUrl(event.target.value); setRemoteImportError('') }} /></label>
          <p>{props.t('character.importRemoteWarning')}</p>
          {remoteImportError ? <p aria-live="polite" className={styles.remoteImportError}>{remoteImportError}</p> : null}
        </form>
      </Dialog>
      <DeleteConfirmation
        busy={props.busy}
        count={pendingDeleteIds?.length ?? 0}
        includePlayData={includePlayData}
        open={Boolean(pendingDeleteIds)}
        timelineCount={deleteTimelineCount}
        t={props.t}
        onCancel={() => setPendingDeleteIds(undefined)}
        onConfirm={() => void confirmDelete()}
        onIncludePlayDataChange={setIncludePlayData}
      />
    </>
  )

  if (characterView === 'profile' && selected) {
    return (
      <aside className={`${styles.characterPanel} ${profileLeaving ? styles.profileLeaving : styles.profileEntering}`} data-loom-component="character-profile">
        <div className={styles.characterScroller}>
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
          <button aria-label={props.t('character.back')} className={styles.toolbarButton} title={props.t('character.back')} type="button" onClick={closeProfile}><ArrowLeft aria-hidden="true" /></button>
          <span>{props.t('character.title')}</span>
          <div>
            {selectionMode && !selectedCardIds.has(selected.id) ? <button aria-label={props.t('character.select')} className={styles.toolbarButton} title={props.t('character.select')} type="button" onClick={() => enterSelectionMode(selected.id)}><Circle aria-hidden="true" /></button> : null}
            <button aria-label={props.t('character.edit')} aria-pressed={profileEditing} className={profileEditing ? styles.toolbarButtonActive : styles.toolbarButton} title={props.t('character.edit')} type="button" onClick={() => setProfileEditing(value => !value)}><Pencil aria-hidden="true" /></button>
            <button aria-label={props.t('character.export')} className={styles.toolbarButton} disabled={props.busy} title={props.t('character.export')} type="button" onClick={() => setExportCard(selected)}><Download aria-hidden="true" /></button>
            <button aria-label={props.t('character.delete')} className={`${styles.toolbarButton} ${styles.deleteButton}`} disabled={props.busy} title={props.t('character.delete')} type="button" onClick={() => setPendingDeleteIds([selected.id])}><Trash2 aria-hidden="true" /></button>
          </div>
          </header>

          <section className={styles.profileIdentity}>
          <div><h2>{selected.name}</h2><p>{selected.userName || props.t('character.authorUnknown')}</p></div>
          <button disabled={props.busy} type="button" onClick={() => void props.onCreateTimelineFromCard()}>{props.t('character.startSession')}</button>
          </section>
          {mediaNotice ? <p aria-live="polite" className={styles.mediaNotice}>{mediaNotice}</p> : null}

          {profileEditing ? (
          <form className={`${styles.profileEditor} loom-underlined-fields`} onSubmit={event => void props.onUpdateCard(event).then(() => setProfileEditing(false))}>
            <label><span>{props.t('character.name')}</span><input disabled={props.busy} value={props.cardDraft.name} onChange={event => props.onChangeCardDraft({ ...props.cardDraft, name: event.target.value })} /></label>
            <label><span>{props.t('character.author')}</span><input disabled={props.busy} value={props.cardDraft.userName} onChange={event => props.onChangeCardDraft({ ...props.cardDraft, userName: event.target.value })} /></label>
            <label><span>{props.t('character.description')}</span><textarea disabled={props.busy} value={props.cardDraft.description} onChange={event => props.onChangeCardDraft({ ...props.cardDraft, description: event.target.value })} /></label>
            <div className={styles.editorActions}>
              <button disabled={props.busy || !props.cardDraft.name.trim()} type="submit">{props.t('character.save')}</button>
            </div>
          </form>
        ) : (
          <section className={styles.profileContent}>
            <div><h3>{props.t('character.description')}</h3><p>{selected.description || props.t('character.descriptionEmpty')}</p></div>
            <div className={styles.resourceOverview}><h3>{props.t('character.resources')}</h3><span>{props.t('character.resourcesCount', { count: selected.settingLayer?.entries.length ?? 0 })}</span></div>
            <button type="button" onClick={props.onOpenStatePanel}><Braces aria-hidden="true" />{props.t('character.stateVariables')}</button>
          </section>
          )}

          <section className={styles.sessions}>
          <header><h3>{props.t('character.sessions')}</h3></header>
          {props.timeline ? <p className={styles.currentSession}>{props.t('character.currentSession', { id: shortId(props.timeline.id) })}</p> : null}
          <div className={styles.sessionList}>
            {props.timelines.length === 0 ? <p>{props.t('branch.noBranches')}</p> : props.timelines.map(timeline => <TimelineCard key={timeline.id} timeline={timeline} busy={props.busy} current={timeline.id === props.timeline?.id} onOpen={() => props.onOpenTimeline(timeline)} t={props.t} />)}
          </div>
          </section>
        </div>
        {overlays}
      </aside>
    )
  }

  return (
    <aside className={`${styles.characterPanel} ${styles.galleryEntering}`} data-loom-component="character-gallery">
      <div ref={characterPanelRef} className={styles.characterScroller}>
        <input
          ref={cardImportInputRef}
          accept="image/png,.png,.loomcard,application/vnd.loom.card+zip"
          className={styles.mediaInput}
          multiple
          type="file"
          onChange={event => {
            const files = Array.from(event.target.files ?? [])
            event.target.value = ''
            if (files.length > 0) void props.onImportCards(files)
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
              <div className={styles.galleryModes} role="group" aria-label={props.t('character.gallery')}>
                <button aria-label={props.t('character.grid')} aria-pressed={galleryMode === 'grid'} className={galleryMode === 'grid' ? styles.toolbarButtonActive : styles.toolbarButton} title={props.t('character.grid')} type="button" onClick={() => setGalleryMode('grid')}><Grid2X2 aria-hidden="true" /></button>
                <button aria-label={props.t('character.list')} aria-pressed={galleryMode === 'list'} className={galleryMode === 'list' ? styles.toolbarButtonActive : styles.toolbarButton} title={props.t('character.list')} type="button" onClick={() => setGalleryMode('list')}><List aria-hidden="true" /></button>
              </div>
              <div className={styles.galleryActions}>
                <button aria-label={props.t('character.import')} className={styles.toolbarButton} disabled={props.busy} title={props.t('character.import')} type="button" onClick={() => cardImportInputRef.current?.click()}><Upload aria-hidden="true" /></button>
                <button aria-label={props.t('character.importRemote')} className={styles.toolbarButton} disabled={props.busy} title={props.t('character.importRemote')} type="button" onClick={() => setRemoteImportOpen(true)}><CloudDownload aria-hidden="true" /></button>
                <button disabled={props.busy} type="button" onClick={() => void props.onCreateCard()}><Plus aria-hidden="true" />{props.t('character.create')}</button>
              </div>
            </div>
            <input aria-label={props.t('character.searchPlaceholder')} className={styles.gallerySearch} placeholder={props.t('character.searchPlaceholder')} type="search" value={query} onChange={event => setQuery(event.target.value)} />
          </>
        )}
        </header>

        {filteredCards.length === 0 ? <p className={styles.empty}>{props.t('character.empty')}</p> : (
          <div className={galleryMode === 'grid' ? styles.grid : styles.list}>
          {visibleCards.map(card => (
            <CharacterCard
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

      {overlays}
    </aside>
  )

  function exportSelectedCard(card: CharacterCardSummary, format: 'png' | 'polyglot' | 'loomcard') {
    setExportCard(undefined)
    void props.onExportCard(card, format)
  }

  function closeRemoteImport() {
    if (remoteImportBusy) return
    setRemoteImportOpen(false)
    setRemoteImportUrl('')
    setRemoteImportError('')
  }

  async function importRemoteCard(event: FormEvent) {
    event.preventDefault()
    setRemoteImportError('')
    setRemoteImportBusy(true)
    try {
      const url = new URL(remoteImportUrl.trim())
      if (url.protocol !== 'https:') throw new Error(props.t('character.importRemoteHttpsOnly'))
      const response = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer' })
      if (!response.ok) throw new Error(props.t('character.importRemoteDownloadFailed', { status: response.status }))
      const declaredSize = Number(response.headers.get('content-length'))
      if (Number.isFinite(declaredSize) && declaredSize > MAX_REMOTE_CARD_BYTES) throw new Error(props.t('character.importRemoteTooLarge'))
      const blob = await response.blob()
      if (blob.size > MAX_REMOTE_CARD_BYTES) throw new Error(props.t('character.importRemoteTooLarge'))
      const fileName = remoteCardFileName(url, blob.type)
      await props.onImportCards([new File([blob], fileName, { type: blob.type })])
      setRemoteImportOpen(false)
      setRemoteImportUrl('')
    } catch (error) {
      setRemoteImportError(error instanceof Error ? error.message : String(error))
    } finally {
      setRemoteImportBusy(false)
    }
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
  const className = [props.mode === 'grid' ? styles.gridCard : styles.listCard, props.selected ? styles.cardSelected : ''].filter(Boolean).join(' ')
  return (
    <ContextMenu>
      <div className={className}>
        <ContextMenuTrigger asChild>
          <button
            aria-pressed={props.selectionMode ? props.selected : undefined}
            className={styles.cardOpen}
            type="button"
            onClick={props.onOpenProfile}
          >
            <div className={styles.cardCover}>
              {props.loadMedia && props.mediaUrl ? <img alt="" src={props.mediaUrl} /> : null}
            </div>
            <span><strong>{props.card.name}</strong><small>{props.card.userName || props.t('character.authorUnknown')}</small></span>
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
  const returnFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    return () => {
      const returnFocus = returnFocusRef.current
      if (returnFocus?.isConnected) queueMicrotask(() => returnFocus.focus())
    }
  }, [])

  function selectGroup(groupId: CharacterGroupFilter) {
    props.onSelectFilter(groupId)
    props.onClose()
  }

  function handleDialogKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      props.onClose()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)'))
    if (focusable.length === 0) return
    const currentIndex = focusable.indexOf(document.activeElement as HTMLElement)
    const nextIndex = event.shiftKey
      ? currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1
      : currentIndex < 0 || currentIndex === focusable.length - 1 ? 0 : currentIndex + 1
    event.preventDefault()
    focusable[nextIndex]?.focus()
  }

  return (
    <div className={styles.dialogBackdrop} role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) props.onClose() }}>
      <section
        aria-label={props.t('character.groups')}
        className={styles.groupDialog}
        data-loom-object="character-group-dialog"
        role="dialog"
        onKeyDown={handleDialogKeyDown}
        onMouseDown={event => event.stopPropagation()}
      >
        <header>
          <span>{props.t('character.groups')}</span>
          <button aria-label={props.t('character.closeGroups')} autoFocus className={styles.toolbarButton} title={props.t('character.closeGroups')} type="button" onClick={props.onClose}><X aria-hidden="true" /></button>
        </header>
        <div className={styles.groupList}>
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
      </section>
    </div>
  )
}

function DeleteConfirmation(props: { busy: boolean; count: number; includePlayData: boolean; onCancel(): void; onConfirm(): void; onIncludePlayDataChange(value: boolean): void; open: boolean; timelineCount: number; t: Translator }) {
  return (
    <Dialog
      actions={(
        <>
          <button disabled={props.busy} type="button" onClick={props.onCancel}>{props.t('character.cancel')}</button>
          <button className={styles.deleteButton} disabled={props.busy || props.count === 0} type="button" onClick={props.onConfirm}>{props.t('character.confirmDelete')}</button>
        </>
      )}
      closeOnBackdrop
      description={props.t('character.deleteConfirmBody', { count: props.count })}
      dismissible={!props.busy}
      open={props.open}
      role="alertdialog"
      title={props.t('character.deleteConfirmTitle')}
      onClose={props.onCancel}
    >
      {props.timelineCount > 0 ? (
        <label className={styles.deletePlayDataOption}>
          <input checked={props.includePlayData} disabled={props.busy} type="checkbox" onChange={event => props.onIncludePlayDataChange(event.target.checked)} />
          <span>{props.t('character.deletePlayData', { count: props.timelineCount })}</span>
        </label>
      ) : null}
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

function mediaUrl(card: CharacterCardSummary, target: MediaTarget): string | undefined {
  const assetId = target === 'avatar' ? card.media?.avatarAssetId : card.media?.coverAssetId
  return assetId ? `/assets/${encodeURIComponent(assetId)}` : undefined
}

function TimelineCard(props: { timeline: NarrativeTimelineView; busy: boolean; current: boolean; onOpen(): void; t: Translator }) {
  return (
    <details className={styles.sessionCard} open={props.current}>
      <summary><ChevronRight aria-hidden="true" /><span><strong>{props.timeline.title ?? props.t('branch.default')}</strong><small>{formatTimelineDate(props.timeline.updatedAt)}</small></span></summary>
      <div className={styles.sessionCardBody}>
        <dl><div><dt>{props.t('character.sessionCreated')}</dt><dd>{formatTimelineDate(props.timeline.createdAt)}</dd></div><div><dt>{props.t('character.sessionLatestMessage')}</dt><dd>{formatTimelineDate(props.timeline.updatedAt)}</dd></div></dl>
        <button disabled={props.busy || props.current} type="button" onClick={props.onOpen}>{props.current ? props.t('character.currentSession', { id: shortId(props.timeline.id) }) : props.t('character.openSession')}</button>
      </div>
    </details>
  )
}

function formatTimelineDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString()
}

function shortId(id: string): string {
  return id.slice(0, 13)
}

function remoteCardFileName(url: URL, contentType: string): string {
  const candidate = url.pathname.split('/').pop() || ''
  if (candidate.toLowerCase().endsWith('.loomcard') || candidate.toLowerCase().endsWith('.png')) return candidate
  return contentType === 'application/vnd.loom.card+zip' ? 'remote-card.loomcard' : 'remote-card.png'
}
