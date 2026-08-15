import { ArrowLeft, Circle, ChevronRight, Download, Folder, Grid2X2, List, Pencil, Plus, Trash2, Upload, Users, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent, type DragEvent, type FormEvent } from 'react'
import type { ContextMenuItem } from '../../shared/ui/context-menu/context-menu.js'
import { useContextMenuTrigger } from '../../shared/ui/context-menu/use-context-menu-trigger.js'
import type { Translator } from '../../shared/i18n/index.js'
import { Toggle } from '../../shared/ui/toggle/toggle.js'
import { Dialog } from '../../shared/ui/dialog/dialog.js'
import { useCharacterGalleryStore, type CharacterGroupFilter } from './character-gallery-store.js'
import type { CharacterMedia, CharacterMediaTarget as MediaTarget } from './character-panel-model.js'
import { useCharacterMedia } from './use-character-media.js'
import { useCharacterProfileNavigation } from './use-character-profile-navigation.js'
import styles from './character-panel.module.scss'

type CharacterCardSummary = {
  id: string
  version: number
  name: string
  userName?: string
  description?: string
  settingLayer?: { entries: unknown[] }
}

type SessionView = { id: string; agentRuntimeProfileId?: string }
type BranchView = { id: string; version: number; title?: string; headEntryId?: string }
type GalleryMode = 'grid' | 'list'

type CharacterPanelProps = {
  active: boolean
  branch?: BranchView
  branches: BranchView[]
  busy: boolean
  cardDraft: { name: string; userName: string; description: string }
  cards: CharacterCardSummary[]
  onChangeCardDraft(draft: { name: string; userName: string; description: string }): void
  onCreateCard(): Promise<void>
  onCreateSessionFromCard(): Promise<void>
  onDeleteCards(cardIds: string[]): Promise<void>
  onSelectCard(cardId: string): void
  onSwitchBranch(branch: BranchView): void
  onUpdateCard(event: FormEvent): Promise<void>
  selectedCard?: CharacterCardSummary
  selectedCardId?: string
  routeCardId?: string
  session?: SessionView
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

const MOCK_CARD_IMAGES = [
  'https://nekos.best/api/v2/neko/3dc0d45e-61b7-43b9-8452-9fada674b909.png',
  'https://nekos.best/api/v2/neko/71c172c2-f32e-461a-8bfb-18905ed12bb6.png',
  'https://nekos.best/api/v2/neko/a92bf34a-2674-48b3-a8ab-fb2a8dc7e6b8.png',
  'https://nekos.best/api/v2/neko/18c903b4-4828-4237-a061-8579fb471837.png',
]
// ponytail: 角色媒体 Schema 尚未落地；临时二次元 CDN 仅验证 Gallery、头像和背景布局，正式媒体资源合同接入时删除。

const GALLERY_PAGE_SIZE = 30
const MAX_MEDIA_BYTES = 10 * 1024 * 1024
const PAGE_TRANSITION_MS = 180
const MOCK_CARD_NAMES = ['白夜澪', '雾岛澄', '星见遥', '镜川栞', '月读纱夜', '雨宫凛', '七濑澪', '神代绫']
const SESSION_MESSAGE_KEYS = ['character.sessionMockMessage1', 'character.sessionMockMessage2', 'character.sessionMockMessage3'] as const

export function createMockCards(count = 100): CharacterCardSummary[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `__gallery-mock-${index + 1}`,
    version: 0,
    name: `${MOCK_CARD_NAMES[index % MOCK_CARD_NAMES.length]!} ${String(index + 1).padStart(2, '0')}`,
    userName: index % 3 === 0 ? 'Loom Studio' : 'Aster Archive',
    description: '用于角色墙密度、搜索与渐进加载的前端视觉数据。',
  }))
}

const MOCK_GALLERY_CARDS = import.meta.env.DEV ? createMockCards() : []

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
  const characterPanelRef = useRef<HTMLDivElement>(null)
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const backgroundInputRef = useRef<HTMLInputElement>(null)
  const gallerySentinelRef = useRef<HTMLDivElement>(null)
  const galleryCards = useMemo(() => [...props.cards, ...MOCK_GALLERY_CARDS], [props.cards])
  const galleryCardIds = useMemo(() => galleryCards.map(card => card.id), [galleryCards])
  const { mediaByCardId, replace: replaceStoredMedia } = useCharacterMedia(galleryCardIds)
  const { closeProfile, openProfile: setOpenProfile, profileCardId, profileLeaving } = useCharacterProfileNavigation(props.routeCardId, pageTransitionDelay)
  const selected = profileCardId
    ? galleryCards.find(card => card.id === profileCardId) ?? (props.selectedCard?.id === profileCardId ? props.selectedCard : undefined)
    : undefined
  const characterView = profileCardId ? 'profile' : 'gallery'
  const isTransientCard = selected ? isMockCard(selected) : false
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
    if (!isMockCard(card)) props.onSelectCard(card.id)
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
    replaceStoredMedia(card.id, target, file)
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
    const cardIds = pendingDeleteIds?.filter(cardId => !isMockCardId(cardId)) ?? []
    if (cardIds.length === 0) {
      setPendingDeleteIds(undefined)
      return
    }
    await props.onDeleteCards(cardIds)
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
      <DeleteConfirmation open={Boolean(pendingDeleteIds)} count={pendingDeleteIds?.filter(cardId => !isMockCardId(cardId)).length ?? 0} busy={props.busy} onCancel={() => setPendingDeleteIds(undefined)} onConfirm={() => void confirmDelete()} t={props.t} />
    </>
  )

  if (characterView === 'profile' && selected) {
    return (
      <aside className={`${styles.characterPanel} ${profileLeaving ? styles.profileLeaving : styles.profileEntering}`} data-loom-component="character-profile">
        <div className={styles.characterScroller}>
          <input ref={backgroundInputRef} accept="image/*" className={styles.mediaInput} type="file" onChange={event => selectMedia(selected, 'background', event)} />
          <input ref={avatarInputRef} accept="image/*" className={styles.mediaInput} type="file" onChange={event => selectMedia(selected, 'avatar', event)} />
          <section className={styles.profileHero} style={{ backgroundImage: props.active && mediaUrl(selected, 'background', mediaByCardId) ? `url(${mediaUrl(selected, 'background', mediaByCardId)})` : 'none' }}>
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
            <img alt="" src={props.active ? mediaUrl(selected, 'avatar', mediaByCardId) : undefined} />
            <span className={styles.mediaLabel}>{props.t('character.changeAvatar')}</span>
          </button>
          </section>

          <header className={styles.profileToolbar}>
          <button aria-label={props.t('character.back')} className={styles.toolbarButton} title={props.t('character.back')} type="button" onClick={closeProfile}><ArrowLeft aria-hidden="true" /></button>
          <span>{props.t('character.title')}</span>
          <div>
            {selectionMode && !selectedCardIds.has(selected.id) ? <button aria-label={props.t('character.select')} className={styles.toolbarButton} title={props.t('character.select')} type="button" onClick={() => enterSelectionMode(selected.id)}><Circle aria-hidden="true" /></button> : null}
            {!isTransientCard ? <button aria-label={props.t('character.edit')} aria-pressed={profileEditing} className={profileEditing ? styles.toolbarButtonActive : styles.toolbarButton} title={props.t('character.edit')} type="button" onClick={() => setProfileEditing(value => !value)}><Pencil aria-hidden="true" /></button> : null}
          </div>
          </header>

          <section className={styles.profileIdentity}>
          <div><h2>{selected.name}</h2><p>{selected.userName || props.t('character.authorUnknown')}</p></div>
          {!isTransientCard ? <button disabled={props.busy} type="button" onClick={() => void props.onCreateSessionFromCard()}>{props.t('character.startSession')}</button> : null}
          </section>
          {mediaNotice ? <p aria-live="polite" className={styles.mediaNotice}>{mediaNotice}</p> : null}

          {profileEditing ? (
          <form className={`${styles.profileEditor} loom-underlined-fields`} onSubmit={event => void props.onUpdateCard(event).then(() => setProfileEditing(false))}>
            <label><span>{props.t('character.name')}</span><input disabled={props.busy} value={props.cardDraft.name} onChange={event => props.onChangeCardDraft({ ...props.cardDraft, name: event.target.value })} /></label>
            <label><span>{props.t('character.author')}</span><input disabled={props.busy} value={props.cardDraft.userName} onChange={event => props.onChangeCardDraft({ ...props.cardDraft, userName: event.target.value })} /></label>
            <label><span>{props.t('character.description')}</span><textarea disabled={props.busy} value={props.cardDraft.description} onChange={event => props.onChangeCardDraft({ ...props.cardDraft, description: event.target.value })} /></label>
            <div className={styles.editorActions}>
              <button disabled={props.busy || !props.cardDraft.name.trim()} type="submit">{props.t('character.save')}</button>
              <button className={styles.deleteButton} disabled={props.busy} type="button" onClick={() => setPendingDeleteIds([selected.id])}>{props.t('character.delete')}</button>
            </div>
          </form>
        ) : (
          <section className={styles.profileContent}>
            <div><h3>{props.t('character.description')}</h3><p>{selected.description || props.t('character.descriptionEmpty')}</p></div>
            <div className={styles.resourceOverview}><h3>{props.t('character.resources')}</h3><span>{props.t('character.resourcesCount', { count: selected.settingLayer?.entries.length ?? 0 })}</span></div>
          </section>
          )}

          <section className={styles.sessions}>
          <header><h3>{props.t('character.sessions')}</h3></header>
          {props.session ? <p className={styles.currentSession}>{props.t('character.currentSession', { id: shortId(props.session.id) })}</p> : null}
          <div className={styles.sessionList}>
            {props.branches.length === 0 ? <p>{props.t('branch.noBranches')}</p> : props.branches.map(branch => <SessionBranchCard key={branch.id} branch={branch} busy={props.busy} current={branch.id === props.branch?.id} onSwitch={() => props.onSwitchBranch(branch)} t={props.t} />)}
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
        <header className={styles.galleryToolbar}>
        {selectionMode ? (
          <div className={styles.selectionToolbar}>
            <span>{props.t('character.selectionCount', { count: selectedCardIds.size })}</span>
            <div>
              <button disabled={selectedCardIds.size === 0} type="button" onClick={() => openGroupPicker()}><Folder aria-hidden="true" />{props.t('character.moveToGroup')}</button>
              <button className={styles.deleteButton} disabled={![...selectedCardIds].some(cardId => !isMockCardId(cardId)) || props.busy} type="button" onClick={() => setPendingDeleteIds([...selectedCardIds].filter(cardId => !isMockCardId(cardId)))}><Trash2 aria-hidden="true" />{props.t('character.delete')}</button>
              <button aria-label={props.t('character.exitSelection')} className={styles.toolbarButton} title={props.t('character.exitSelection')} type="button" onClick={exitSelectionMode}><X aria-hidden="true" /></button>
            </div>
          </div>
        ) : (
          <>
            <div className={styles.galleryModes} role="group" aria-label={props.t('character.gallery')}>
              <button aria-label={props.t('character.grid')} aria-pressed={galleryMode === 'grid'} className={galleryMode === 'grid' ? styles.toolbarButtonActive : styles.toolbarButton} title={props.t('character.grid')} type="button" onClick={() => setGalleryMode('grid')}><Grid2X2 aria-hidden="true" /></button>
              <button aria-label={props.t('character.list')} aria-pressed={galleryMode === 'list'} className={galleryMode === 'list' ? styles.toolbarButtonActive : styles.toolbarButton} title={props.t('character.list')} type="button" onClick={() => setGalleryMode('list')}><List aria-hidden="true" /></button>
            </div>
            <div className={styles.galleryActions}>
              <input aria-label={props.t('character.searchPlaceholder')} className={styles.gallerySearch} placeholder={props.t('character.searchPlaceholder')} type="search" value={query} onChange={event => setQuery(event.target.value)} />
              <button aria-label={props.t('character.import')} className={styles.toolbarButton} disabled title={props.t('character.importPending')} type="button"><Upload aria-hidden="true" /></button>
              <button aria-label={props.t('character.export')} className={styles.toolbarButton} disabled title={props.t('character.exportPending')} type="button"><Download aria-hidden="true" /></button>
              <button disabled={props.busy} type="button" onClick={() => void props.onCreateCard()}><Plus aria-hidden="true" />{props.t('character.create')}</button>
            </div>
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
              mediaUrl={mediaUrl(card, 'avatar', mediaByCardId)}
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
  const menuItems: ContextMenuItem[] = [
    { checked: props.selected, icon: <Circle aria-hidden="true" />, id: 'select', label: props.selected ? props.t('character.deselect') : props.t('character.select'), onSelect: props.selected ? props.onToggleSelection : props.onSelect },
    { icon: <Folder aria-hidden="true" />, id: 'move-group', label: props.t('character.moveToGroup'), onSelect: props.onOpenGroups },
    ...(isMockCard(props.card) ? [] : [{ id: 'separator', type: 'separator' as const }, { icon: <Trash2 aria-hidden="true" />, id: 'delete', label: props.t('character.delete'), onSelect: props.onDelete, tone: 'danger' as const }]),
  ]
  const contextMenu = useContextMenuTrigger(menuItems)
  const className = [props.mode === 'grid' ? styles.gridCard : styles.listCard, props.selected ? styles.cardSelected : ''].filter(Boolean).join(' ')
  return (
    <div className={className}>
      <button
        {...contextMenu.triggerProps}
        aria-pressed={props.selectionMode ? props.selected : undefined}
        className={styles.cardOpen}
        type="button"
        onClick={props.onOpenProfile}
      >
        <img alt="" src={props.loadMedia ? props.mediaUrl : undefined} />
        <span><strong>{props.card.name}</strong><small>{props.card.userName || props.t('character.authorUnknown')}</small></span>
      </button>
      {props.selectionMode ? <Toggle checked={props.selected} className={styles.selectionToggle} label={props.selected ? props.t('character.deselect') : props.t('character.select')} onChange={props.onToggleSelection} /> : null}
    </div>
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

function DeleteConfirmation(props: { busy: boolean; count: number; onCancel(): void; onConfirm(): void; open: boolean; t: Translator }) {
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
    />
  )
}

function filterCardsByGroup(cards: CharacterCardSummary[], assignments: Record<string, string | undefined>, activeGroupId: CharacterGroupFilter): CharacterCardSummary[] {
  if (!activeGroupId) return cards
  if (activeGroupId === 'ungrouped') return cards.filter(card => !assignments[card.id])
  return cards.filter(card => assignments[card.id] === activeGroupId)
}

function isMockCard(card: CharacterCardSummary): boolean {
  return isMockCardId(card.id)
}

function isMockCardId(cardId: string): boolean {
  return import.meta.env.DEV && cardId.startsWith('__gallery-mock-')
}

function pageTransitionDelay(): number {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : PAGE_TRANSITION_MS
}

function cardImage(card: CharacterCardSummary): string {
  let value = 0
  for (const character of card.id) value = (value + character.charCodeAt(0)) % MOCK_CARD_IMAGES.length
  return MOCK_CARD_IMAGES[value]!
}

function mediaUrl(card: CharacterCardSummary, target: MediaTarget, mediaByCardId: Record<string, CharacterMedia>): string | undefined {
  return mediaByCardId[card.id]?.[target] ?? (import.meta.env.DEV ? cardImage(card) : undefined)
}

function SessionBranchCard(props: { branch: BranchView; busy: boolean; current: boolean; onSwitch(): void; t: Translator }) {
  const detail = sessionDetail(props.branch, props.t)
  return (
    <details className={styles.sessionCard} open={props.current}>
      <summary><ChevronRight aria-hidden="true" /><span><strong>{props.branch.title ?? props.t('branch.default')}</strong><small>{detail.lastActive}</small></span></summary>
      <div className={styles.sessionCardBody}>
        <dl><div><dt>{props.t('character.sessionCreated')}</dt><dd>{detail.createdAt}</dd></div><div><dt>{props.t('character.sessionLatestMessage')}</dt><dd>{detail.lastMessage}</dd></div></dl>
        <button disabled={props.busy || props.current} type="button" onClick={props.onSwitch}>{props.current ? props.t('character.currentSession', { id: shortId(props.branch.id) }) : props.t('character.openSession')}</button>
      </div>
    </details>
  )
}

function sessionDetail(branch: BranchView, t: Translator) {
  const seed = Array.from(branch.id).reduce((total, character) => total + character.charCodeAt(0), 0)
  const relativeTimes = [t('character.sessionAgoMinutes', { count: (seed % 45) + 1 }), t('character.sessionAgoHours', { count: (seed % 12) + 1 }), t('character.sessionYesterday')]
  return {
    lastActive: relativeTimes[seed % relativeTimes.length]!,
    createdAt: `2026-08-${String((seed % 28) + 1).padStart(2, '0')}`,
    lastMessage: t(SESSION_MESSAGE_KEYS[seed % SESSION_MESSAGE_KEYS.length]!),
  }
}

function shortId(id: string): string {
  return id.slice(0, 13)
}
