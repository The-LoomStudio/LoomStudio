import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button, Dialog, TextInput } from '@loom-studio/ui'
import type { useStudioState } from './use-studio-state.js'
import type { useStudioNavigation } from '../shared/studio-shell/use-studio-navigation.js'
import { TimelineQuickActions } from '../widgets/timeline-quick-actions/timeline-quick-actions.js'
import { CardDeleteConfirmation } from '../features/cards/ui/card-delete-confirmation.js'
import { useCharacterGalleryStore } from '../widgets/character-panel/character-gallery-store.js'
import { formatDateTime } from '../shared/i18n/index.js'
import { cardMediaUrl, useCardMediaRevision } from '../shared/lib/card-media.js'

type Props = {
  state: ReturnType<typeof useStudioState>
  navigation: ReturnType<typeof useStudioNavigation>
  cardId: string
  busy: boolean
  onDeleteCards: ReturnType<typeof useStudioState>['deleteCards']
}

export function StudioTimelineActions({ state, navigation, cardId, busy, onDeleteCards }: Props) {
  const { t } = state
  const card = state.cards.find(item => item.id === cardId)
  const revision = useCardMediaRevision()
  const [dialog, setDialog] = useState<'rename' | 'delete-story' | 'delete-character'>()
  const [draft, setDraft] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (dialog === 'rename') renameInputRef.current?.focus()
  }, [dialog])
  const [pending, setPending] = useState(false)
  const inFlight = useRef(false)
  const [error, setError] = useState<string>()
  const [includePlayData, setIncludePlayData] = useState(true)
  const [includePromptResources, setIncludePromptResources] = useState(true)
  const timeline = state.narrativeTimeline
  const head = state.narrativeNodes.find(node => node.id === state.branch?.headNodeId)
  const disabled = busy || pending
  const preview = useQuery({
    queryKey: ['card-delete-preview-detail', state.endpoint, cardId],
    enabled: dialog === 'delete-character',
    queryFn: () => state.previewCardDeletion(cardId),
    retry: false, staleTime: 0, gcTime: 0, refetchOnReconnect: false,
  })

  async function run(action: () => Promise<boolean | void>) {
    if (disabled || inFlight.current) return
    inFlight.current = true
    setPending(true)
    setError(undefined)
    try {
      const success = await action()
      if (success === false) setError(t('timelineQuick.failed'))
      else setDialog(undefined)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      inFlight.current = false
      setPending(false)
    }
  }

  function openDialog(kind: typeof dialog) {
    setError(undefined)
    setDialog(kind)
    if (kind === 'rename') setDraft(timeline?.title ?? '')
    if (kind === 'delete-character') { setIncludePlayData(true); setIncludePromptResources(true) }
  }

  if (!card) return null
  return <>
    <TimelineQuickActions character={{ name: card.name, avatarUrl: card.media?.avatarAssetId ? cardMediaUrl(card.id, 'avatar', card.media.avatarAssetId, revision) : undefined }}
      busy={disabled} canFork={Boolean(head)}
      selectedTimelineId={timeline?.id}
      timelines={state.allTimelines.filter(item => item.createdFrom?.cardId === cardId)
        .map(item => ({ id: item.id, title: item.title ?? t('sessions.untitledTimeline'),
          description: formatDateTime(item.createdAt), preview: item.latestPreview || item.openingPreview }))}
      onSelectTimeline={id => { if (id !== timeline?.id) void navigation.openNarrative(id) }}
      timeline={timeline ? {
        title: timeline.title ?? t('sessions.untitledTimeline'), branchId: state.branch?.id,
        branches: state.branches.map(branch => ({ id: branch.id, title: branch.title ?? t('branch.default') })),
      } : undefined}
      labels={{ expand: t('timelineQuick.expand'), collapse: t('timelineQuick.collapse'), openCharacter: `${card.name} · ${t('rail.character')}`,
        selectStory: t('timelineQuick.selectStory'), opening: t('timelineQuick.opening'), story: t('timelineQuick.story'), branch: t('sessions.branches'), rename: t('sessions.rename'),
        newStory: t('timelineQuick.new'), fork: t('timelineQuick.fork'), deleteStory: t('timelineQuick.deleteStory'), deleteCharacter: t('character.delete') }}
      onOpenWorkspace={() => { if (timeline) void navigation.openMemory({ timelineId: timeline.id, branchId: state.branch?.id, view: 'workspace' }) }}
      onOpenCharacter={() => navigation.openPanel('character', { cardId })}
      onNewStory={() => void run(async () => {
        const activated = await state.createTimelineFromCard(cardId)
        if (!activated) return false
        if (navigation.isCurrent()) navigation.openNarrative(activated.timelineId, activated.branchId)
      })}
      onFork={() => void run(async () => {
        if (!head) return false
        const activated = await state.forkFromNode(head)
        if (!activated) return false
        if (navigation.isCurrent()) navigation.openNarrative(activated.timelineId, activated.branchId)
      })}
      onSelectBranch={id => void run(async () => {
        if (id === state.branch?.id) return
        const branch = state.branches.find(item => item.id === id)
        if (!branch || !timeline || !await state.switchBranch(branch)) return false
        if (navigation.isCurrent()) navigation.openNarrative(timeline.id, branch.id)
      })}
      onRenameStory={() => openDialog('rename')}
      onDeleteStory={() => openDialog('delete-story')}
      onDeleteCharacter={() => openDialog('delete-character')} />
    {error && !dialog ? <p role="alert">{error}</p> : null}
    <Dialog open={dialog === 'rename' || dialog === 'delete-story'} dismissible={!pending} closeOnBackdrop onClose={() => setDialog(undefined)}
      title={dialog === 'rename' ? t('sessions.rename') : t('sessions.confirmDeleteTitle')}
      description={dialog === 'delete-story' ? t('sessions.confirmDeleteTimeline', { title: timeline?.title ?? t('sessions.untitledTimeline') }) : undefined}
      actions={<><Button disabled={pending} onClick={() => setDialog(undefined)}>{t('character.cancel')}</Button>
        <Button disabled={disabled || (dialog === 'rename' && !draft.trim())} variant={dialog === 'delete-story' ? 'danger' : 'default'} onClick={() => void run(async () => {
          if (!timeline) return false
          if (dialog === 'rename') return Boolean(await state.renameTimeline(timeline.id, draft))
          const deleted = await state.deleteTimeline(timeline.id)
          if (deleted && navigation.isCurrent()) navigation.clearDeletedTimeline(timeline.id, cardId)
          return deleted
        })}>{dialog === 'rename' ? t('timelineQuick.save') : t('character.confirmDelete')}</Button></>}
    >
      {dialog === 'rename' ? <TextInput ref={renameInputRef} aria-label={t('sessions.rename')} value={draft} onChange={event => setDraft(event.target.value)} disabled={pending} /> : null}
      {error ? <p role="alert">{error}</p> : null}
    </Dialog>
    <CardDeleteConfirmation open={dialog === 'delete-character'} name={card.name} count={1} busy={disabled}
      t={t} includePlayData={includePlayData} includePromptResources={includePromptResources}
      onIncludePlayDataChange={setIncludePlayData} onIncludePromptResourcesChange={setIncludePromptResources}
      timelineCount={preview.data?.timelines.length ?? 0} previewReady={preview.isSuccess && !preview.isFetching}
      previewError={preview.error?.message} operationError={error}
      onRetryPreview={() => { void preview.refetch() }} onCancel={() => setDialog(undefined)}
      onConfirm={() => void run(async () => {
        if (!preview.isSuccess || preview.isFetching) return false
        await onDeleteCards([cardId], { includePlayData, includePromptResources })
        useCharacterGalleryStore.getState().removeCards([cardId])
      })} />
  </>
}
