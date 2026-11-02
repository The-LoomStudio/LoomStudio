import { MessageAttachments } from '../../features/attachments/message-attachments.js'
import { useEffect, useMemo, useRef, useState } from 'react'
import { notify } from '../../shared/notifications/index.js'
import {
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  Dialog,
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  Toggle,
} from '@loom-studio/ui'
import {
  MoreHorizontal,
  ArrowDownUp,
  ArrowRight,
  Bot,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  ChevronsDown,
  ChevronsUp,
  Eye,
  Download,
  FolderGit2,
  GitCommitHorizontal,
  History,
  MessageSquareText,
  Pencil,
  Plus,
  Play,
  RefreshCw,
  Star,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import type {
  AgentPreset,
  AgentSession,
  AgentTranscriptEntry,
  CardSummary,
  NarrativeBranch,
  NarrativeNode,
  NarrativeTimeline,
} from '../../entities/index.js'
import { sessionPresetName, sessionSourceLabel, timelineCharacterName } from '../../entities/session-identification.js'
import type { StudioApi } from '../../shared/api/studio-api.js'
import { cardMediaUrl, useCardMediaRevision } from '../../shared/lib/card-media.js'
import { downloadBlob } from '../../shared/browser/download.js'
import { formatDateTime, type Translator } from '../../shared/i18n/index.js'
import { MasterDetailWorkbench } from '../../shared/ui/master-detail-workbench/master-detail-workbench.js'
import { PanelTabs } from '../../shared/ui/panel-tabs/index.js'
import { AgentToolGroupBlock } from '../../features/sessions/ui/agent-tool-blocks.js'
import { buildRenderItems } from '../../features/sessions/model/transcript-render-items.js'
import { AgentSessionCreateDialog } from '../../features/sessions/ui/agent-session-create-dialog.js'
import {
  areAllExpandablesExpanded,
  areAllSelected,
  areAllSessionsSelected,
  areAllTimelinesSelected,
  filterAgentSessions,
  filterTimelines,
  getExpandableTimelineIds,
  partitionSessions,
  sortSessions,
  sortTimelines,
  toggleExpandAll,
  toggleItemSelection,
  toggleSelectAll,
  toggleSelectAllSessions,
  toggleSelectAllTimelines,
} from './sessions-panel-model.js'
import { SessionMemory } from './session-memory.js'
import { useHistoryPreviews } from '../../features/sessions/model/use-history-previews.js'
import { deleteHistoryItems } from '../../features/sessions/model/delete-history-items.js'
import styles from './sessions-panel.module.scss'

type SessionFilter = 'all' | 'timelines' | 'sessions'
type SelectedHistoryItem =
  | { kind: 'timeline'; id: string }
  | { kind: 'session'; id: string }

type SessionsPanelProps = {
  view?: 'timelines' | 'sessions'
  activeBranch?: NarrativeBranch
  activeTimeline?: NarrativeTimeline
  agentChatSession?: AgentSession
  agentPresets: AgentPreset[]
  api?: StudioApi
  allAgentSessions: AgentSession[]
  branches: NarrativeBranch[]
  cards?: CardSummary[]
  narrativeAgentSession?: AgentSession
  selectedCardId?: string
  requestedSessionId?: string
  requestedSessionView?: 'summary' | 'transcript'
  onSessionUpdated?(sessionId: string): Promise<void>
  selectedCardName?: string
  t: Translator
  timelines: NarrativeTimeline[]
  onOpenTimeline(timeline: NarrativeTimeline): void
  onOpenAgentSessionInSidebar?(session: AgentSession): void
  onCreateAgentSession?(presetId: string): Promise<AgentSession | undefined>
  onDeleteTimeline?(timelineId: string): Promise<boolean> | void
  onRenameTimeline?(timelineId: string, title: string): Promise<unknown> | void
  onDeleteAgentSession?(sessionId: string): Promise<boolean> | void
  onRenameAgentSession?(sessionId: string, title: string): Promise<unknown> | void
  onArchiveImported?(timelineId: string, result: { unknownParticipantNamespaces: string[]; participantFailures: Array<{ namespace: string; message: string }> }): Promise<void> | void
}

export function SessionsPanel(props: SessionsPanelProps) {
  const mediaRevision = useCardMediaRevision()
  const [showAll, setShowAll] = useState(false)
  const cardId = props.activeTimeline?.createdFrom?.cardId ?? props.selectedCardId
  const scopedTimelines = useMemo(() => showAll ? props.timelines : props.timelines.filter(item => !!cardId && item.createdFrom?.cardId === cardId), [props.timelines, showAll, cardId])
  const scopedSessions = useMemo(() => showAll ? props.allAgentSessions : props.allAgentSessions.filter(item => scopedTimelines.some(timeline => timeline.id === item.timelineId)), [props.allAgentSessions, scopedTimelines, showAll])
  const [localFilter, setFilter] = useState<SessionFilter>('all')
  const filter = props.view ?? localFilter
  const [mobilePane, setMobilePane] = useState<'master' | 'detail'>('master')
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedTimelines, setExpandedTimelines] = useState<Set<string>>(new Set())
  const [isSelectionMode, setIsSelectionMode] = useState(false)
  const [selectedTimelineIds, setSelectedTimelineIds] = useState<Set<string>>(new Set())
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(new Set())
  const [pendingDelete, setPendingDelete] = useState<{
    timelineIds: string[]
    sessionIds: string[]
    message: string
    batch: boolean
  }>()
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)

  useEffect(() => { setPendingDelete(undefined) }, [props.api])

  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc')

  const sortedTimelines = useMemo(() => sortTimelines(scopedTimelines, sortOrder), [scopedTimelines, sortOrder])

  const initialSelectedId = props.activeTimeline?.id ?? sortedTimelines[0]?.id
  const [selectedItem, setSelectedItem] = useState<SelectedHistoryItem | undefined>(
    props.requestedSessionId ? { kind: 'session', id: props.requestedSessionId } : initialSelectedId ? { kind: 'timeline', id: initialSelectedId } : undefined,
  )

  useEffect(() => {
    if (!props.view) return
    setMobilePane('master')
    setSelectedItem(undefined)
    setSelectedTimelineIds(new Set())
    setSelectedSessionIds(new Set())
    setIsSelectionMode(false)
  }, [props.view])

  // 区分绑定会话与独立会话并应用排序
  const { sessionsByTimelineId, standaloneSessions } = useMemo(() => {
    const partitioned = partitionSessions(scopedSessions)
    return {
      sessionsByTimelineId: partitioned.sessionsByTimelineId,
      standaloneSessions: sortSessions(partitioned.standaloneSessions, sortOrder),
    }
  }, [scopedSessions, sortOrder])

  const lastRequested = useRef<string | undefined>(undefined)
  useEffect(() => {
    const requestKey = props.requestedSessionId ? `${props.requestedSessionId}:${props.requestedSessionView}` : undefined
    if (!requestKey) { lastRequested.current = undefined; return }
    if (requestKey === lastRequested.current) return
    const requested = props.allAgentSessions.find(item => item.id === props.requestedSessionId)
    if (!requested) return
    lastRequested.current = requestKey
    setSelectedItem({ kind: 'session', id: requested.id })
    setMobilePane('detail')
    const owner = props.timelines.find(item => item.id === requested.timelineId)
    if (!cardId || owner?.createdFrom?.cardId !== cardId) setShowAll(true)
  }, [props.requestedSessionId, props.requestedSessionView, cardId, props.allAgentSessions, props.timelines])

  // 构建角色快速检索映射表
  const cardMap = useMemo(() => {
    return new Map((props.cards ?? []).map(card => [card.id, card]))
  }, [props.cards])

  // 搜索过滤
  const filteredTimelines = useMemo(() => {
    if (filter === 'sessions') return []
    return filterTimelines(sortedTimelines, cardMap, searchQuery)
  }, [filter, searchQuery, sortedTimelines, cardMap])

  const filteredSessions = useMemo(() => {
    if (filter === 'timelines') return []
    const sessions = filter === 'sessions' ? sortSessions(scopedSessions, sortOrder) : standaloneSessions
    return filterAgentSessions(sessions, props.agentPresets, searchQuery)
  }, [filter, searchQuery, standaloneSessions, scopedSessions, props.agentPresets, sortOrder])

  const expandableTimelineIds = useMemo(() => {
    return getExpandableTimelineIds(filteredTimelines.map(t => t.id), sessionsByTimelineId)
  }, [filteredTimelines, sessionsByTimelineId])

  const isAllExpanded = useMemo(() => {
    return areAllExpandablesExpanded(expandableTimelineIds, expandedTimelines)
  }, [expandableTimelineIds, expandedTimelines])

  const handleToggleExpandAll = () => {
    setExpandedTimelines(prev => toggleExpandAll(expandableTimelineIds, prev))
  }

  // 可见项 IDs 汇总与批量状态
  const visibleTimelineIds = useMemo(() => filteredTimelines.map(t => t.id), [filteredTimelines])

  const visibleSessionIds = useMemo(() => {
    const ids: string[] = []
    filteredSessions.forEach(s => ids.push(s.id))
    filteredTimelines.forEach(t => {
      if (expandedTimelines.has(t.id)) {
        const bound = sessionsByTimelineId.get(t.id) ?? []
        bound.forEach(s => ids.push(s.id))
      }
    })
    return ids
  }, [filteredSessions, filteredTimelines, expandedTimelines, sessionsByTimelineId])

  const totalSelectedCount = selectedTimelineIds.size + selectedSessionIds.size

  const isAllSelected = useMemo(() => {
    return areAllSelected(visibleTimelineIds, visibleSessionIds, selectedTimelineIds, selectedSessionIds)
  }, [visibleTimelineIds, visibleSessionIds, selectedTimelineIds, selectedSessionIds])

  const isAllTimelinesSelected = useMemo(() => {
    return areAllTimelinesSelected(visibleTimelineIds, selectedTimelineIds)
  }, [visibleTimelineIds, selectedTimelineIds])

  const isAllSessionsSelected = useMemo(() => {
    return areAllSessionsSelected(visibleSessionIds, selectedSessionIds)
  }, [visibleSessionIds, selectedSessionIds])

  const handleToggleSelectAll = () => {
    const { nextTimelines, nextSessions } = toggleSelectAll(
      visibleTimelineIds,
      visibleSessionIds,
      selectedTimelineIds,
      selectedSessionIds,
    )
    setSelectedTimelineIds(nextTimelines)
    setSelectedSessionIds(nextSessions)
  }

  const handleToggleSelectAllTimelines = () => {
    setSelectedTimelineIds(prev => toggleSelectAllTimelines(visibleTimelineIds, prev))
  }

  const handleToggleSelectAllSessions = () => {
    setSelectedSessionIds(prev => toggleSelectAllSessions(visibleSessionIds, prev))
  }

  const handleToggleTimelineSelect = (timelineId: string, event?: React.MouseEvent) => {
    event?.stopPropagation()
    setSelectedTimelineIds(prev => toggleItemSelection(prev, timelineId))
  }

  const handleToggleSessionSelect = (sessionId: string, event?: React.MouseEvent) => {
    event?.stopPropagation()
    setSelectedSessionIds(prev => toggleItemSelection(prev, sessionId))
  }

  const handleExitSelectionMode = () => {
    setIsSelectionMode(false)
    setSelectedTimelineIds(new Set())
    setSelectedSessionIds(new Set())
  }

  const handleBatchDelete = () => {
    if (totalSelectedCount === 0) return

    const timelineCount = selectedTimelineIds.size
    const sessionCount = Array.from(selectedSessionIds).filter(id => {
      const session = props.allAgentSessions.find(item => item.id === id)
      return !session?.timelineId || !selectedTimelineIds.has(session.timelineId)
    }).length

    const confirmMessage = timelineCount > 0 && sessionCount > 0
      ? props.t('sessions.confirmBatchDelete', {
        timelines: timelineCount,
        sessions: sessionCount,
      })
      : timelineCount > 0
        ? props.t('sessions.confirmBatchDeleteTimelines', {
        count: timelineCount,
      })
        : props.t('sessions.confirmBatchDeleteSessions', {
        count: sessionCount,
      })

    setPendingDelete({
      timelineIds: Array.from(selectedTimelineIds),
      sessionIds: Array.from(selectedSessionIds),
      message: confirmMessage,
      batch: true,
    })
  }

  const confirmDelete = async () => {
    if (!pendingDelete || deleteBusy) return
    setDeleteBusy(true)
    try {
      const { deletedTimelineIds, deletedSessionIds, complete } = await deleteHistoryItems({
        timelineIds: pendingDelete.timelineIds,
        sessionIds: pendingDelete.sessionIds,
        sessions: props.allAgentSessions,
        onDeleteTimeline: props.onDeleteTimeline,
        onDeleteAgentSession: props.onDeleteAgentSession,
      })

      setSelectedTimelineIds(prev => {
        const next = new Set(prev)
        deletedTimelineIds.forEach(id => next.delete(id))
        return next
      })
      setSelectedSessionIds(prev => {
        const next = new Set(prev)
        deletedSessionIds.forEach(id => next.delete(id))
        return next
      })

      if (
        selectedItem &&
        ((selectedItem.kind === 'timeline' && deletedTimelineIds.has(selectedItem.id)) ||
          (selectedItem.kind === 'session' && deletedSessionIds.has(selectedItem.id)))
      ) {
        setSelectedItem(undefined)
      }

      // Remove only confirmed deletions so a partial batch failure leaves failed items visible for retry.
      if (pendingDelete.batch && complete) {
        setIsSelectionMode(false)
      }
      if (deletedTimelineIds.size + deletedSessionIds.size > 0) {
        notify.success(props.t('notify.success.deleted'))
      } else if (!complete) {
        notify.warning(props.t('notify.error.general'))
      }
    } catch (error) {
      notify.error(props.t('notify.error.general'), { details: error instanceof Error ? error.message : String(error) })
    } finally {
      setDeleteBusy(false)
      setPendingDelete(undefined)
    }
  }

  // 当前选中的 Timeline 或 Session 实体
  const selectedTimeline = useMemo(() => {
    if (selectedItem?.kind !== 'timeline') return undefined
    return scopedTimelines.find(t => t.id === selectedItem.id)
  }, [scopedTimelines, selectedItem])

  const selectedSession = useMemo(() => {
    if (selectedItem?.kind !== 'session') return undefined
    return scopedSessions.find(s => s.id === selectedItem.id)
  }, [scopedSessions, selectedItem])

  const { timelinePreview, sessionPreview, retryPreview } = useHistoryPreviews({
    api: props.api, branches: props.branches, selectedTimeline, selectedSession,
  })

  // 当选中时间线时，若该时间线存在关联会话，自动展开子树
  useEffect(() => {
    if (selectedItem?.kind === 'timeline' && sessionsByTimelineId.has(selectedItem.id)) {
      setExpandedTimelines(prev => {
        if (prev.has(selectedItem.id)) return prev
        const next = new Set(prev)
        next.add(selectedItem.id)
        return next
      })
    }
  }, [selectedItem, sessionsByTimelineId])

  function toggleExpandTimeline(timelineId: string, event: React.MouseEvent) {
    event.stopPropagation()
    setExpandedTimelines(prev => {
      const next = new Set(prev)
      if (next.has(timelineId)) next.delete(timelineId)
      else next.add(timelineId)
      return next
    })
  }

  const handleRenameTimeline = async (timeline: NarrativeTimeline) => {
    const currentTitle = timeline.title || props.t('sessions.untitledTimeline')
    const next = window.prompt(props.t('sessions.renamePrompt'), currentTitle)
    if (next !== null && next.trim() && next.trim() !== timeline.title) {
      try {
        await props.onRenameTimeline?.(timeline.id, next.trim())
        notify.success(props.t('notify.success.updated'))
      } catch (error) {
        notify.error(props.t('notify.error.general'), { details: error instanceof Error ? error.message : String(error) })
      }
    }
  }

  const handleDeleteTimeline = (timeline: NarrativeTimeline) => {
    const title = timeline.title || props.t('sessions.untitledTimeline')
    setPendingDelete({
      timelineIds: [timeline.id], sessionIds: [],
      message: props.t('sessions.confirmDeleteTimeline', { title }), batch: false,
    })
  }

  const handleRenameSession = async (session: AgentSession) => {
    const currentTitle = session.title || props.t('sessions.untitledAgentSession')
    const next = window.prompt(props.t('sessions.renamePrompt'), currentTitle)
    if (next !== null && next.trim() && next.trim() !== session.title) {
      try {
        await props.onRenameAgentSession?.(session.id, next.trim())
        notify.success(props.t('notify.success.updated'))
      } catch (error) {
        notify.error(props.t('notify.error.general'), { details: error instanceof Error ? error.message : String(error) })
      }
    }
  }

  const handleDeleteSession = (session: AgentSession) => {
    const title = session.title || props.t('sessions.untitledAgentSession')
    setPendingDelete({
      timelineIds: [], sessionIds: [session.id],
      message: props.t('sessions.confirmDeleteSession', { title }), batch: false,
    })
  }

  const handleOpenSessionInSidebar = (session: AgentSession) => {
    props.onOpenAgentSessionInSidebar?.(session)
    window.dispatchEvent(
      new CustomEvent('loom:open-agent-chat', { detail: { sessionId: session.id } }),
    )
  }


  return (
    <div className={styles.panel} data-loom-component="sessions-panel">
      <MasterDetailWorkbench
        navigationScope={props.view ? 'local' : 'workspace'}
        mobilePane={mobilePane}
        onMobilePaneChange={setMobilePane}
        master={(
          <div className={styles.masterContainer}>
            <div className={styles.filterNav}>
              {!props.view ? <PanelTabs<SessionFilter>
                activeId={filter}
                ariaLabel={props.t('sessions.views')}
                items={[
                  { id: 'all', label: props.t('sessions.filterAll') },
                  { id: 'timelines', label: props.t('sessions.filterTimelines') },
                  { id: 'sessions', label: props.t('sessions.filterSessions') },
                ]}
                onChange={nextFilter => {
                  setFilter(nextFilter)
                  setMobilePane('master')
                }}
              /> : null}

              <button
                aria-label={isSelectionMode ? props.t('sessions.exitBatchManage') : props.t('sessions.batchManage')}
                className={styles.batchToggleBtn}
                data-active={isSelectionMode ? 'true' : 'false'}
                type="button"
                onClick={() => {
                  if (isSelectionMode) {
                    handleExitSelectionMode()
                  } else {
                    setIsSelectionMode(true)
                  }
                }}
              >
                <CheckSquare aria-hidden="true" size={13} />
                <span>{isSelectionMode ? props.t('sessions.exitBatchManage') : props.t('sessions.batchManage')}</span>
              </button>
            </div>
            <div className={styles.scopeRow}><span>{showAll ? '全部角色与独立会话' : props.selectedCardName || '当前角色'}</span>
              <Button size="small" variant="ghost" onClick={() => { setShowAll(value => !value); setSelectedTimelineIds(new Set()); setSelectedSessionIds(new Set()) }}>{showAll ? '仅当前角色' : '显示全部'}</Button></div>
            <nav aria-label={props.t('sessions.views')} className={styles.masterNav}>
            {isSelectionMode ? (
              <div className={styles.batchToolbar}>
                <div
                  className={styles.batchSelectAllRow}
                  role="button"
                  tabIndex={0}
                  onClick={handleToggleSelectAll}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      handleToggleSelectAll()
                    }
                  }}
                >
                  <span className={styles.toggleClickShield}>
                    <Toggle
                      checked={isAllSelected}
                      label={props.t('sessions.selectAll')}
                      onChange={() => {}}
                    />
                  </span>
                  <span>{props.t('sessions.selectAll')}</span>
                  <span className={styles.selectedCountLabel}>
                    ({props.t('sessions.selectedCount', { count: totalSelectedCount })})
                  </span>
                </div>
                <button
                  className={styles.batchDeleteBtn}
                  disabled={totalSelectedCount === 0}
                  type="button"
                  onClick={() => void handleBatchDelete()}
                >
                  <Trash2 aria-hidden="true" size={12} />
                  <span>{props.t('sessions.batchDelete', { count: totalSelectedCount })}</span>
                </button>
              </div>
            ) : (
              <div className={styles.toolbarRow}>
                <div className={styles.searchContainer}>
                  <input
                    className={styles.searchInput}
                    placeholder={props.t('sessions.searchPlaceholder')}
                    value={searchQuery}
                    onChange={event => setSearchQuery(event.target.value)}
                  />
                  {searchQuery ? (
                    <button
                      aria-label={props.t('sessions.clearSearch')}
                      className={styles.clearSearchBtn}
                      title={props.t('sessions.clearSearch')}
                      type="button"
                      onClick={() => setSearchQuery('')}
                    >
                      <X aria-hidden="true" size={11} />
                    </button>
                  ) : null}
                </div>

                <div className={styles.toolbarActions}>
                  {props.onCreateAgentSession ? <button
                    aria-label={props.t('agent.createSession')} title={props.t('agent.createSession')}
                    className={styles.toolbarIconBtn} type="button"
                    onClick={() => setCreateOpen(true)}
                  ><Plus aria-hidden="true" size={14} /></button> : null}
                  <button
                    aria-label={props.t(sortOrder === 'desc' ? 'sessions.sortLatest' : 'sessions.sortEarliest')}
                    className={styles.toolbarIconBtn}
                    data-active={sortOrder === 'asc' ? 'true' : 'false'}
                    title={props.t(sortOrder === 'desc' ? 'sessions.sortLatest' : 'sessions.sortEarliest')}
                    type="button"
                    onClick={() => setSortOrder(prev => (prev === 'desc' ? 'asc' : 'desc'))}
                  >
                    <ArrowDownUp aria-hidden="true" size={13} />
                  </button>

                  <button
                    aria-label={props.t(isAllExpanded ? 'sessions.collapseAll' : 'sessions.expandAll')}
                    className={styles.toolbarIconBtn}
                    disabled={expandableTimelineIds.length === 0}
                    title={props.t(isAllExpanded ? 'sessions.collapseAll' : 'sessions.expandAll')}
                    type="button"
                    onClick={handleToggleExpandAll}
                  >
                    {isAllExpanded ? (
                      <ChevronsUp aria-hidden="true" size={14} />
                    ) : (
                      <ChevronsDown aria-hidden="true" size={14} />
                    )}
                  </button>
                </div>
              </div>
            )}

            <div className={styles.list}>
              {filteredTimelines.length === 0 && filteredSessions.length === 0 ? (
                <EmptyState text={props.t(filter === 'sessions' ? 'sessions.agentEmpty' : 'sessions.timelineEmpty')} />
              ) : null}

              {/* 时间线列表及分组全选 */}
              {filteredTimelines.length > 0 ? (
                <>
                  <div className={styles.sectionHeaderRow}>
                    <span className={styles.sectionTitle}>
                      {props.t('sessions.timelinesSection')} ({filteredTimelines.length})
                    </span>
                    {isSelectionMode ? (
                      <div
                        className={styles.sectionSelectAllRow}
                        role="button"
                        tabIndex={0}
                        onClick={handleToggleSelectAllTimelines}
                        onKeyDown={e => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            handleToggleSelectAllTimelines()
                          }
                        }}
                      >
                        <span className={styles.toggleClickShield}>
                          <Toggle
                            checked={isAllTimelinesSelected}
                            label={props.t('sessions.selectAllTimelines')}
                            onChange={() => {}}
                          />
                        </span>
                        <span>{props.t('sessions.selectAllTimelines')}</span>
                      </div>
                    ) : null}
                  </div>

                  {filteredTimelines.map(timeline => {
                    const isSelected = selectedItem?.kind === 'timeline' && selectedItem.id === timeline.id
                    const isTimelineChecked = selectedTimelineIds.has(timeline.id)
                    const boundSessions = sessionsByTimelineId.get(timeline.id) ?? []
                    const hasChildren = boundSessions.length > 0
                    const isExpanded = expandedTimelines.has(timeline.id)
                    const card = timeline.createdFrom?.cardId ? cardMap.get(timeline.createdFrom.cardId) : undefined
                    const avatarUrl = card?.media?.avatarAssetId
                      ? cardMediaUrl(card.id, 'avatar', card.media.avatarAssetId, mediaRevision)
                      : undefined

                    return (
                      <div key={timeline.id} className={styles.timelineGroup}>
                        <ContextMenu>
                          <ContextMenuTrigger asChild>
                            <div
                              className={styles.itemRow}
                              data-active={isSelected ? 'true' : 'false'}
                              aria-current={timeline.id === props.activeTimeline?.id ? 'true' : undefined}
                              data-selected={isTimelineChecked ? 'true' : 'false'}
                              onClick={isSelectionMode ? (e) => handleToggleTimelineSelect(timeline.id, e) : undefined}
                            >
                              {isSelectionMode ? (
                                <div className={styles.selectionToggleWrapper}>
                                  <Toggle
                                    checked={isTimelineChecked}
                                    label={props.t('sessions.selectTimelineNamed', { name: timeline.title || card?.name || '' })}
                                    onChange={() => {}}
                                  />
                                </div>
                              ) : (
                                hasChildren ? (
                                  <button
                                    aria-expanded={isExpanded}
                                    aria-label={props.t('sessions.expandRelated')}
                                    className={styles.expandButton}
                                    type="button"
                                    onClick={e => toggleExpandTimeline(timeline.id, e)}
                                  >
                                    {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                  </button>
                                ) : (
                                  <div className={styles.expandPlaceholder} />
                                )
                              )}

                              <button
                                className={styles.itemButton}
                                type="button"
                                onClick={e => {
                                  if (isSelectionMode) {
                                    handleToggleTimelineSelect(timeline.id, e)
                                    return
                                  }
                                  setSelectedItem({ kind: 'timeline', id: timeline.id })
                                  if (hasChildren) {
                                    setExpandedTimelines(prev => new Set(prev).add(timeline.id))
                                  }
                                  setMobilePane('detail')
                                }}
                                onDoubleClick={() => {
                                  if (!isSelectionMode) props.onOpenTimeline(timeline)
                                }}
                              >
                                {avatarUrl ? (
                                  <img className={styles.characterAvatar} src={avatarUrl} alt={card?.name ?? ''} />
                                ) : (
                                  <div className={styles.avatarPlaceholder}>
                                    <History aria-hidden="true" />
                                  </div>
                                )}
                                <span className={styles.itemBody}>
                                  <strong title={timeline.title || props.t('sessions.untitledTimeline')}>{timeline.title || props.t('sessions.untitledTimeline')}</strong>
                                  <small title={timelineCharacterName(timeline, props.cards ?? [], props.t)}>
                                    {timelineCharacterName(timeline, props.cards ?? [], props.t)} · {formatDateTime(timeline.updatedAt)}
                                  </small>
                                  {timeline.latestPreview || timeline.openingPreview ? <small title={timeline.latestPreview || timeline.openingPreview}>{timeline.latestPreview || timeline.openingPreview}</small> : null}
                                </span>
                              </button>

                              {hasChildren ? (
                                <span className={styles.badge} title={props.t('sessions.boundSessions', { count: boundSessions.length })}>
                                  <Bot aria-hidden="true" size={11} />
                                  <span>{boundSessions.length}</span>
                                </span>
                              ) : null}

                              {isSelectionMode && hasChildren ? (
                                <button
                                  aria-expanded={isExpanded}
                                  aria-label={props.t('sessions.expandRelated')}
                                  className={styles.expandButton}
                                  type="button"
                                  onClick={e => toggleExpandTimeline(timeline.id, e)}
                                >
                                  {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                </button>
                              ) : null}

                              {!isSelectionMode ? (
                                <button
                                  aria-label={props.t('sessions.enterTimeline')}
                                  className={styles.itemActionButton}
                                  title={props.t('sessions.enterTimeline')}
                                  type="button"
                                  onClick={e => {
                                    e.stopPropagation()
                                    props.onOpenTimeline(timeline)
                                  }}
                                >
                                  <ArrowRight aria-hidden="true" size={14} />
                                </button>
                              ) : null}
                            </div>
                          </ContextMenuTrigger>
                          <ContextMenuContent>
                            <ContextMenuItem
                              icon={<ArrowRight size={13} />}
                              onSelect={() => props.onOpenTimeline(timeline)}
                            >
                              {props.t('sessions.enterTimeline')}
                            </ContextMenuItem>
                            <ContextMenuItem
                              icon={<Eye size={13} />}
                              onSelect={() => {
                                setSelectedItem({ kind: 'timeline', id: timeline.id })
                                setMobilePane('detail')
                              }}
                            >
                              {props.t('sessions.viewDetail')}
                            </ContextMenuItem>
                            <ContextMenuItem
                              icon={<Pencil size={13} />}
                              onSelect={() => void handleRenameTimeline(timeline)}
                            >
                              {props.t('sessions.rename')}
                            </ContextMenuItem>
                            <ContextMenuSeparator />
                            <ContextMenuItem
                              icon={<CheckSquare size={13} />}
                              onSelect={() => {
                                if (!isSelectionMode) setIsSelectionMode(true)
                                setSelectedTimelineIds(prev => toggleItemSelection(prev, timeline.id))
                              }}
                            >
                              {isTimelineChecked ? props.t('character.deselect') : props.t('sessions.selectThis')}
                            </ContextMenuItem>
                            <ContextMenuSeparator />
                            <ContextMenuItem
                              icon={<Trash2 size={13} />}
                              tone="danger"
                              onSelect={() => void handleDeleteTimeline(timeline)}
                            >
                              {props.t('sessions.delete')}
                            </ContextMenuItem>
                          </ContextMenuContent>
                        </ContextMenu>

                        {/* 挂载在时间线下的 Agent 会话子树 */}
                        {hasChildren && isExpanded ? (
                          <div className={styles.childItemsList}>
                            {boundSessions.map(session => {
                              const isSessionSelected = selectedItem?.kind === 'session' && selectedItem.id === session.id
                              const isSessionChecked = selectedSessionIds.has(session.id)
                              const profile = props.agentPresets.find(p => p.id === session.agentPresetId)
                              return (
                                <ContextMenu key={session.id}>
                                  <ContextMenuTrigger asChild>
                                    <div
                                      className={styles.childItemRow}
                                      data-active={isSessionSelected ? 'true' : 'false'}
                                      aria-current={session.id === props.agentChatSession?.id ? 'true' : undefined}
                                      data-selected={isSessionChecked ? 'true' : 'false'}
                                      onClick={e => {
                                        if (isSelectionMode) {
                                          handleToggleSessionSelect(session.id, e)
                                          return
                                        }
                                        setSelectedItem({ kind: 'session', id: session.id })
                                        setMobilePane('detail')
                                      }}
                                      onDoubleClick={() => {
                                        if (!isSelectionMode) handleOpenSessionInSidebar(session)
                                      }}
                                    >
                                      {isSelectionMode ? (
                                        <div className={styles.selectionToggleWrapper}>
                                          <Toggle
                                            checked={isSessionChecked}
                                            label={props.t('sessions.selectSessionNamed', { name: session.title || profile?.rootNode.label || '' })}
                                            onChange={() => {}}
                                          />
                                        </div>
                                      ) : null}
                                      {session.id === props.narrativeAgentSession?.id
                                        ? <Star className={styles.primaryIcon} fill="currentColor" aria-label={props.t('agent.primarySession')} />
                                        : <Bot aria-hidden="true" />}
                                      <span className={styles.childItemBody}>
                                        <strong title={session.title || profile?.rootNode.label || props.t('sessions.untitledAgentSession')}>{session.title || profile?.rootNode.label || props.t('sessions.untitledAgentSession')}
                                        </strong>
                                        <small title={sessionPresetName(session, props.agentPresets, props.t)}>{sessionPresetName(session, props.agentPresets, props.t)} · {formatDateTime(session.updatedAt)}</small>
                                      </span>
                                      <span className={styles.count}>{session.entryCount}</span>
                                      {!isSelectionMode ? (
                                        <button
                                          aria-label={props.t('sessions.openInSidebar')}
                                          className={styles.itemActionButton}
                                          title={props.t('sessions.openInSidebar')}
                                          type="button"
                                          onClick={e => {
                                            e.stopPropagation()
                                            handleOpenSessionInSidebar(session)
                                          }}
                                        >
                                          <ArrowRight aria-hidden="true" size={13} />
                                        </button>
                                      ) : null}
                                    </div>
                                  </ContextMenuTrigger>
                                  <ContextMenuContent>
                                    <ContextMenuItem
                                      icon={<ArrowRight size={13} />}
                                      onSelect={() => handleOpenSessionInSidebar(session)}
                                    >
                                      {props.t('sessions.openInSidebar')}
                                    </ContextMenuItem>
                                    <ContextMenuItem
                                      icon={<Eye size={13} />}
                                      onSelect={() => {
                                        setSelectedItem({ kind: 'session', id: session.id })
                                        setMobilePane('detail')
                                      }}
                                    >
                                      {props.t('sessions.viewDetail')}
                                    </ContextMenuItem>
                                    <ContextMenuItem
                                      icon={<Pencil size={13} />}
                                      onSelect={() => void handleRenameSession(session)}
                                    >
                                      {props.t('sessions.rename')}
                                    </ContextMenuItem>
                                    <ContextMenuSeparator />
                                    <ContextMenuItem
                                      icon={<CheckSquare size={13} />}
                                      onSelect={() => {
                                        if (!isSelectionMode) setIsSelectionMode(true)
                                        setSelectedSessionIds(prev => toggleItemSelection(prev, session.id))
                                      }}
                                    >
                                      {isSessionChecked ? props.t('character.deselect') : props.t('sessions.selectThis')}
                                    </ContextMenuItem>
                                    <ContextMenuSeparator />
                                    <ContextMenuItem
                                      icon={<Trash2 size={13} />}
                                      tone="danger"
                                      onSelect={() => void handleDeleteSession(session)}
                                    >
                                      {props.t('sessions.delete')}
                                    </ContextMenuItem>
                                  </ContextMenuContent>
                                </ContextMenu>
                              )
                            })}
                          </div>
                        ) : null}
                      </div>
                    )
                  })}
                </>
              ) : null}

              {/* 全部视图列出独立会话；会话视图列出所有 Agent 会话。 */}
              {filteredSessions.length > 0 ? (
                <>
                  <div className={styles.sectionHeaderRow}>
                    <span className={styles.sectionTitle}>
                      {props.t(filter === 'sessions' ? 'sessions.sessionsSection' : 'sessions.standaloneSection')} ({filteredSessions.length})
                    </span>
                    {isSelectionMode ? (
                      <div
                        className={styles.sectionSelectAllRow}
                        role="button"
                        tabIndex={0}
                        onClick={handleToggleSelectAllSessions}
                        onKeyDown={e => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            handleToggleSelectAllSessions()
                          }
                        }}
                      >
                        <span className={styles.toggleClickShield}>
                          <Toggle
                            checked={isAllSessionsSelected}
                            label={props.t('sessions.selectAllSessions')}
                            onChange={() => {}}
                          />
                        </span>
                        <span>{props.t('sessions.selectAllSessions')}</span>
                      </div>
                    ) : null}
                  </div>

                  {filteredSessions.map(session => {
                    const isSessionSelected = selectedItem?.kind === 'session' && selectedItem.id === session.id
                    const isSessionChecked = selectedSessionIds.has(session.id)
                    const profile = props.agentPresets.find(p => p.id === session.agentPresetId)
                    return (
                      <ContextMenu key={session.id}>
                        <ContextMenuTrigger asChild>
                          <div
                            className={styles.itemRow}
                            data-active={isSessionSelected ? 'true' : 'false'}
                            aria-current={session.id === props.agentChatSession?.id ? 'true' : undefined}
                            data-selected={isSessionChecked ? 'true' : 'false'}
                            onClick={isSelectionMode ? (e) => handleToggleSessionSelect(session.id, e) : undefined}
                            onDoubleClick={() => {
                              if (!isSelectionMode) handleOpenSessionInSidebar(session)
                            }}
                          >
                            {isSelectionMode ? (
                              <div className={styles.selectionToggleWrapper}>
                                <Toggle
                                  checked={isSessionChecked}
                                  label={props.t('sessions.selectSessionNamed', { name: session.title || profile?.rootNode.label || '' })}
                                  onChange={() => {}}
                                />
                              </div>
                            ) : (
                              <div className={styles.expandPlaceholder} />
                            )}
                            <button
                              className={styles.itemButton}
                              type="button"
                              onClick={e => {
                                if (isSelectionMode) {
                                  handleToggleSessionSelect(session.id, e)
                                  return
                                }
                                setSelectedItem({ kind: 'session', id: session.id })
                                setMobilePane('detail')
                              }}
                            >
                              <div className={styles.avatarPlaceholder}>
                                {session.id === props.narrativeAgentSession?.id
                                  ? <Star className={styles.primaryIcon} fill="currentColor" aria-label={props.t('agent.primarySession')} />
                                  : <Bot aria-hidden="true" />}
                              </div>
                              <span className={styles.itemBody}>
                                <strong title={session.title || profile?.rootNode.label || props.t('sessions.untitledAgentSession')}>{session.title || profile?.rootNode.label || props.t('sessions.untitledAgentSession')}
                                </strong>
                                <small title={sessionSourceLabel(session, props.timelines, props.cards ?? [], props.t)}>{sessionSourceLabel(session, props.timelines, props.cards ?? [], props.t)}</small>
                                <small title={sessionPresetName(session, props.agentPresets, props.t)}>{sessionPresetName(session, props.agentPresets, props.t)} · {formatDateTime(session.updatedAt)}</small>
                              </span>
                            </button>
                            <span className={styles.count}>{session.entryCount}</span>
                            {!isSelectionMode ? (
                              <button
                                aria-label={props.t('sessions.openInSidebar')}
                                className={styles.itemActionButton}
                                title={props.t('sessions.openInSidebar')}
                                type="button"
                                onClick={e => {
                                  e.stopPropagation()
                                  handleOpenSessionInSidebar(session)
                                }}
                              >
                                <ArrowRight aria-hidden="true" size={13} />
                              </button>
                            ) : null}
                          </div>
                        </ContextMenuTrigger>
                        <ContextMenuContent>
                          <ContextMenuItem
                            icon={<ArrowRight size={13} />}
                            onSelect={() => handleOpenSessionInSidebar(session)}
                          >
                            {props.t('sessions.openInSidebar')}
                          </ContextMenuItem>
                          <ContextMenuItem
                            icon={<Eye size={13} />}
                            onSelect={() => {
                              setSelectedItem({ kind: 'session', id: session.id })
                              setMobilePane('detail')
                            }}
                          >
                            {props.t('sessions.viewDetail')}
                          </ContextMenuItem>
                          <ContextMenuItem
                            icon={<Pencil size={13} />}
                            onSelect={() => void handleRenameSession(session)}
                          >
                            {props.t('sessions.rename')}
                          </ContextMenuItem>
                          <ContextMenuSeparator />
                          <ContextMenuItem
                            icon={<CheckSquare size={13} />}
                            onSelect={() => {
                              if (!isSelectionMode) setIsSelectionMode(true)
                              setSelectedSessionIds(prev => toggleItemSelection(prev, session.id))
                            }}
                          >
                            {isSessionChecked ? props.t('character.deselect') : props.t('sessions.selectThis')}
                          </ContextMenuItem>
                          <ContextMenuSeparator />
                          <ContextMenuItem
                            icon={<Trash2 size={13} />}
                            tone="danger"
                            onSelect={() => void handleDeleteSession(session)}
                          >
                            {props.t('sessions.delete')}
                          </ContextMenuItem>
                        </ContextMenuContent>
                      </ContextMenu>
                    )
                  })}
                </>
              ) : null}
            </div>
          </nav>
          </div>
        )}
      >
        <div className={styles.detailPane}>
          {selectedItem?.kind === 'timeline' && selectedTimeline ? (
            <TimelineDetail
              key={selectedTimeline.id}
              activeBranch={props.activeBranch}
              activeTimeline={props.activeTimeline}
              boundSessions={sessionsByTimelineId.get(selectedTimeline.id) ?? []}
              branches={props.branches}
              card={selectedTimeline.createdFrom?.cardId ? cardMap.get(selectedTimeline.createdFrom.cardId) : undefined}
              nodes={timelinePreview?.status === 'ready' ? timelinePreview.data : []}
              previewLoading={Boolean(props.api) && (!timelinePreview || timelinePreview.status === 'loading')}
              previewError={timelinePreview?.status === 'error' ? timelinePreview.error : undefined}
              onRetryPreview={retryPreview}
              api={props.api}
              profiles={props.agentPresets}
              t={props.t}
              timeline={selectedTimeline}
              onDelete={() => void handleDeleteTimeline(selectedTimeline)}
              onOpen={() => props.onOpenTimeline(selectedTimeline)}
              onOpenSessionInSidebar={handleOpenSessionInSidebar}
              onRename={() => void handleRenameTimeline(selectedTimeline)}
              onArchiveImported={props.onArchiveImported}
            />
          ) : selectedItem?.kind === 'session' && selectedSession ? (
            <SessionDetail
              key={`${selectedSession.id}:${selectedSession.id === props.requestedSessionId ? props.requestedSessionView : 'transcript'}`}
              api={props.api} initialView={selectedSession.id === props.requestedSessionId ? props.requestedSessionView : undefined}
              onSessionUpdated={props.onSessionUpdated}
              entries={sessionPreview?.status === 'ready' ? sessionPreview.data : []}
              previewLoading={Boolean(props.api) && (!sessionPreview || sessionPreview.status === 'loading')}
              previewError={sessionPreview?.status === 'error' ? sessionPreview.error : undefined}
              onRetryPreview={retryPreview}
              profiles={props.agentPresets}
              session={selectedSession}
              isPrimary={props.narrativeAgentSession?.id === selectedSession.id}
              t={props.t}
              onDelete={() => void handleDeleteSession(selectedSession)}
              onOpenSidebar={() => handleOpenSessionInSidebar(selectedSession)}
              onRename={() => void handleRenameSession(selectedSession)}

            />
          ) : (
            <div className={styles.empty}>
              <FolderGit2 aria-hidden="true" />
              <span>{props.t('sessions.selectForDetails')}</span>
            </div>
          )}
        </div>
      </MasterDetailWorkbench>
      {createOpen && props.onCreateAgentSession ? <AgentSessionCreateDialog
        t={props.t}
        presets={props.agentPresets}
        onCreate={props.onCreateAgentSession}
        onClose={() => setCreateOpen(false)}
        onCreated={session => {
          setSelectedItem({ kind: 'session', id: session.id })
          handleOpenSessionInSidebar(session)
        }}
      /> : null}
      <Dialog
        open={Boolean(pendingDelete)}
        role="alertdialog"
        title={props.t('sessions.confirmDeleteTitle')}
        description={pendingDelete?.message}
        closeOnBackdrop
        dismissible={!deleteBusy}
        onClose={() => { if (!deleteBusy) setPendingDelete(undefined) }}
        actions={(
          <>
            <Button disabled={deleteBusy} onClick={() => setPendingDelete(undefined)}>
              {props.t('character.cancel')}
            </Button>
            <Button disabled={deleteBusy} data-tone="danger" variant="danger" onClick={() => void confirmDelete()}>
              <Trash2 aria-hidden="true" /> {props.t('sessions.delete')}
            </Button>
          </>
        )}
      />
    </div>
  )
}

function TimelineDetail(props: {
  activeBranch?: NarrativeBranch
  activeTimeline?: NarrativeTimeline
  api?: StudioApi
  boundSessions: AgentSession[]
  branches: NarrativeBranch[]
  card?: CardSummary
  nodes: NarrativeNode[]
  previewLoading: boolean
  previewError?: string
  onRetryPreview(): void
  profiles: AgentPreset[]
  t: Translator
  timeline: NarrativeTimeline
  onDelete?(): void
  onOpen(): void
  onOpenSessionInSidebar(session: AgentSession): void
  onRename?(): void
  onArchiveImported?(timelineId: string, result: { unknownParticipantNamespaces: string[]; participantFailures: Array<{ namespace: string; message: string }> }): Promise<void> | void
}) {
  const mediaRevision = useCardMediaRevision()
  const [archiveBusy, setArchiveBusy] = useState(false)
  const [archiveError, setArchiveError] = useState<string>()
  const [archiveNotice, setArchiveNotice] = useState<string>()
  const [importedArchive, setImportedArchive] = useState<{
    timelineId: string
    unknownParticipantNamespaces: string[]
    participantFailures: Array<{ namespace: string; message: string }>
  }>()
  const archiveInputRef = useRef<HTMLInputElement>(null)
  const chatInputRef = useRef<HTMLInputElement>(null)
  const avatarUrl = props.card?.media?.avatarAssetId
    ? cardMediaUrl(props.card.id, 'avatar', props.card.media.avatarAssetId, mediaRevision)
    : undefined

  const isActive = props.timeline.id === props.activeTimeline?.id

  async function exportArchive() {
    if (!props.api) return
    setArchiveBusy(true); setArchiveError(undefined); setArchiveNotice(undefined)
    setImportedArchive(undefined)
    try {
      const result = await props.api.narratives.exportArchive(props.timeline.id)
      downloadBlob(
        new Blob([JSON.stringify(result.archive, null, 2)], { type: 'application/json' }),
        `${props.timeline.title || props.timeline.id}.loom-timeline.json`,
      )
      notify.success(props.t('notify.success.exported'))
    } catch (error) {
      notify.error(props.t('notify.error.general'), { details: error instanceof Error ? error.message : String(error) })
      setArchiveError(error instanceof Error ? error.message : String(error))
    }
    finally { setArchiveBusy(false) }
  }

  async function importArchive(file: File) {
    if (!props.api) return
    setArchiveBusy(true); setArchiveError(undefined); setArchiveNotice(undefined)
    setImportedArchive(undefined)
    try {
      const result = await props.api.narratives.importArchive(await file.text())
      const warnings = [
        result.unknownParticipantNamespaces.length > 0 ? props.t('sessions.archiveUnknownData', { names: result.unknownParticipantNamespaces.join(', ') }) : '',
        result.participantFailures.length > 0 ? props.t('sessions.archiveParticipantFailed', {
          names: result.participantFailures.map(item => `${item.namespace}: ${item.message}`).join('; '),
        }) : '',
      ].filter(Boolean)
      setImportedArchive(result)
      const notice = [props.t('sessions.archiveImported', { id: result.timelineId }), ...warnings].join('\n')
      setArchiveNotice(notice)
      const options = { details: notice }
      if (warnings.length) notify.warning('故事已导入，部分附加数据需要检查', options)
      else notify.success('故事已导入', { details: notice })
      await finishImport(result)
    } catch (error) {
      notify.error(props.t('notify.error.general'), { details: error instanceof Error ? error.message : String(error) })
      setArchiveError(error instanceof Error ? error.message : String(error))
    }
    finally { setArchiveBusy(false) }
  }

  async function importSillyTavernChat(file: File) {
    if (!props.api || !props.card) return
    setArchiveBusy(true); setArchiveError(undefined); setArchiveNotice(undefined)
    setImportedArchive(undefined)
    try {
      const converted = parseConvertedChat(await props.api.extensionRuntime.call('sillytavern.importer.convertChat', { jsonl: await file.text() }))
      const result = await props.api.narratives.importHistory({
        cardId: props.card.id,
        title: converted.title,
        messages: converted.messages,
      })
      const imported = { timelineId: result.timeline.id, unknownParticipantNamespaces: [], participantFailures: [] }
      setImportedArchive(imported)
      const notice = props.t('sessions.chatImported', { count: converted.messages.length, id: result.timeline.id })
      setArchiveNotice(notice)
      notify.success(`已导入 ${converted.messages.length} 条聊天消息`, { details: notice })
      await finishImport(imported)
    } catch (error) {
      notify.error(props.t('notify.error.general'), { details: error instanceof Error ? error.message : String(error) })
      setArchiveError(error instanceof Error ? error.message : String(error))
    }
    finally { setArchiveBusy(false) }
  }

  async function finishImport(result: NonNullable<typeof importedArchive>) {
    setArchiveBusy(true)
    setArchiveError(undefined)
    try {
      await props.onArchiveImported?.(result.timelineId, result)
    } catch (error) {
      setArchiveError(props.t('sessions.importRefreshFailed', {
        message: error instanceof Error ? error.message : String(error),
      }))
    } finally {
      setArchiveBusy(false)
    }
  }

  return (
    <>
      <header className={styles.detailHeader}>
        <div className={styles.detailTitleBlock}>
          {avatarUrl ? (
            <img className={styles.detailAvatar} src={avatarUrl} alt={props.card?.name ?? ''} />
          ) : (
            <div className={styles.detailAvatarPlaceholder}>
              <History aria-hidden="true" />
            </div>
          )}
          <div className={styles.detailTitleMeta}>
            <h3>{props.timeline.title || props.card?.name || props.t('sessions.untitledTimeline')}</h3>
            <span>{props.card?.name ? `${props.t('sessions.characterNamed', { name: props.card.name })} · ` : ''}{props.timeline.id}</span>
          </div>
        </div>

        <div className={styles.detailActions}>
          {props.onRename ? (
            <button
              aria-label={props.t('sessions.rename')}
              className={styles.detailIconButton}
              title={props.t('sessions.rename')}
              type="button"
              onClick={props.onRename}
            >
              <Pencil aria-hidden="true" size={14} />
            </button>
          ) : null}
          {props.onDelete ? (
            <button
              aria-label={props.t('sessions.delete')}
              className={styles.detailDeleteButton}
              title={props.t('sessions.delete')}
              type="button"
              onClick={props.onDelete}
            >
              <Trash2 aria-hidden="true" size={14} />
            </button>
          ) : null}
          {props.api ? <>
            <button aria-label={props.t('sessions.exportTimeline')} className={styles.detailIconButton} disabled={archiveBusy} title={props.t('sessions.exportTimeline')} type="button" onClick={() => void exportArchive()}><Download aria-hidden="true" size={14} /></button>
            <button aria-label={props.t('sessions.importTimeline')} className={styles.detailIconButton} title={props.t('sessions.importTimeline')}
              disabled={archiveBusy} type="button" onClick={() => archiveInputRef.current?.click()}><Upload aria-hidden="true" size={14} /></button>
            <input ref={archiveInputRef} hidden type="file" accept="application/json,.json" disabled={archiveBusy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void importArchive(file) }} />
            {props.card ? (
              <><button aria-label={props.t('sessions.importChat')} className={styles.detailIconButton} title={props.t('sessions.importChat')}
                disabled={archiveBusy} type="button" onClick={() => chatInputRef.current?.click()}><MessageSquareText aria-hidden="true" size={14} /></button>
                <input ref={chatInputRef} hidden type="file" accept=".jsonl,application/x-ndjson" disabled={archiveBusy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void importSillyTavernChat(file) }} /></>
            ) : null}
          </> : null}
          <button className={styles.primaryButton} type="button" onClick={props.onOpen}>
            <Play aria-hidden="true" size={14} />
            <span>{props.t('sessions.enterTimeline')}</span>
          </button>
        </div>
      </header>
      {archiveError ? <p className={styles.emptyNotice} role="alert">{archiveError}</p> : null}
      {archiveNotice ? <p className={styles.emptyNotice} role="status">{archiveNotice}</p> : null}
      {archiveError && importedArchive ? <Button disabled={archiveBusy} onClick={() => void finishImport(importedArchive)}>
        <RefreshCw aria-hidden="true" size={14} />{props.t('sessions.retryImported')}
      </Button> : null}

      <div className={styles.infoGrid}>
        <div className={styles.infoCard}>
          <span>{props.t('sessions.character')}</span>
          <strong>{props.card?.name ?? props.t('sessions.freeNarrative')}</strong>
        </div>
        <div className={styles.infoCard}>
          <span>{props.t('sessions.lastPlayed')}</span>
          <strong>{formatDate(props.timeline.updatedAt)}</strong>
        </div>
        <div className={styles.infoCard}>
          <span>{props.t('sessions.relatedResources')}</span>
          <strong>{props.timeline.promptResourceIds?.length ?? 0}</strong>
        </div>
        {isActive && props.activeBranch ? (
          <div className={styles.infoCard}>
            <span>{props.t('sessions.activeBranch')}</span>
            <strong>{props.activeBranch.title || props.activeBranch.id}</strong>
          </div>
        ) : null}
      </div>

      {isActive && props.branches.length > 0 ? (
        <section className={styles.branchesSection}>
          <h4>{props.t('sessions.branches')}</h4>
          <div className={styles.branchList}>
            {props.branches.map(branch => {
              const isCurrentBranch = branch.id === props.activeBranch?.id
              return (
                <div key={branch.id} className={styles.branchItem}>
                  <div className={styles.branchMeta}>
                    <GitCommitHorizontal aria-hidden="true" size={14} />
                    <strong>{branch.title || 'Untitled Branch'}</strong>
                    <code>{branch.id.slice(0, 8)}</code>
                  </div>
                  {isCurrentBranch ? <span className={styles.badge}>{props.t('sessions.currentlyActive')}</span> : null}
                </div>
              )
            })}
          </div>
        </section>
      ) : null}

      {/* 关联 Agent 会话列表 */}
      <section className={styles.boundSessionsSection}>
        <div className={styles.sectionHeaderRow}>
          <h4 className={styles.sectionTitle}>
            <Bot aria-hidden="true" size={14} />
            <span>{props.t('sessions.boundAgentSessions')} ({props.boundSessions.length})</span>
          </h4>
        </div>
        {props.boundSessions.length === 0 ? (
          <p className={styles.emptyNotice}>{props.t('sessions.noBoundSessions')}</p>
        ) : (
          <div className={styles.boundSessionsList}>
            {props.boundSessions.map(session => {
              const profile = props.profiles.find(p => p.id === session.agentPresetId)
              return (
                <div key={session.id} className={styles.boundSessionCard}>
                  <div className={styles.boundSessionInfo}>
                    <div className={styles.boundSessionTitleRow}>
                      <strong title={session.title || profile?.rootNode.label || props.t('sessions.untitledAgentSession')}>{session.title || profile?.rootNode.label || props.t('sessions.untitledAgentSession')}</strong>
                      {profile?.rootNode.label ? <span className={styles.profileBadge}>{profile.rootNode.label}</span> : null}
                    </div>
                    <div className={styles.boundSessionMeta}>
                      <span>{props.t('sessions.messageCount', { count: session.entryCount })}</span>
                      <span>·</span>
                      <span>{props.t('sessions.lastActive', { date: formatDate(session.updatedAt) })}</span>
                    </div>
                  </div>
                  <button
                    className={styles.secondaryActionButton}
                    type="button"
                    onClick={() => props.onOpenSessionInSidebar(session)}
                  >
                    <ArrowRight aria-hidden="true" size={13} />
                    <span>{props.t('sessions.openInSidebar')}</span>
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* 状态日志与推进轨迹 */}
      <section className={styles.timelineLogsSection}>
        <h4 className={styles.sectionTitle}>{props.t('sessions.timelineLogs')}</h4>
        {props.previewLoading ? <p role="status">{props.t('sessions.previewLoading')}</p>
          : props.previewError ? <div role="alert"><p>{props.previewError}</p>
            <Button onClick={props.onRetryPreview}><RefreshCw aria-hidden="true" />{props.t('sessions.retryPreview')}</Button></div>
          : props.nodes.length === 0 ? (
          <div className={styles.empty}>
            <span>{props.t('sessions.noLogs')}</span>
          </div>
        ) : (
          <div className={styles.logList}>
            {props.nodes.map((node, index) => (
              <div key={node.id} className={styles.logItem}>
                <div className={styles.logItemHeader}>
                  <span>#{index + 1} · {formatDate(node.createdAt)}</span>
                  <div className={styles.logMetaBadges}>
                    {node.source?.agentSessionId ? (
                      <span className={styles.logSourceBadge}>{props.t('sessions.agentCollaboration')}</span>
                    ) : null}
                    {node.source?.changesetId ? (
                      <span className={styles.logRevisionBadge}>{node.source.changesetId.slice(0, 8)}</span>
                    ) : null}
                  </div>
                </div>
                <p className={styles.logNodeText}>{node.body?.raw || props.t('sessions.emptyNode')}</p>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  )
}

function SessionDetail(props: {
  api?: StudioApi
  initialView?: 'summary' | 'transcript'
  onSessionUpdated?(sessionId: string): Promise<void>
  entries: AgentTranscriptEntry[]
  previewLoading: boolean
  previewError?: string
  onRetryPreview(): void
  profiles: AgentPreset[]
  session: AgentSession
  isPrimary?: boolean
  t: Translator
  onDelete?(): void
  onOpenSidebar(): void
  onRename?(): void
}) {
  const [view, setView] = useState<'summary' | 'transcript'>(props.initialView ?? 'transcript')
  const [sessionDetailsOpen, setSessionDetailsOpen] = useState(false)
  const tabs = <PanelTabs activeId={view} ariaLabel="会话详情" items={[{ id: 'transcript', label: '对话记录' }, { id: 'summary', label: '摘要' }]} onChange={setView} />

  const [summaryProgress, setSummaryProgress] = useState<{ through?: number; error?: string }>()
  useEffect(() => {
    if (view !== 'transcript' || !props.api) return
    let active = true
    setSummaryProgress(undefined)
    void props.api.agentSessions.memory({ agentSessionId: props.session.id }).then(memory => {
      if (active) setSummaryProgress({ through: memory.summary ? memory.coverage.messages.retired : undefined })
    }, error => {
      if (active) setSummaryProgress({ error: error instanceof Error ? error.message : String(error) })
    })
    return () => { active = false }
  }, [props.api, props.session.id, props.session.updatedAt, view])

  const profile = props.profiles.find(p => p.id === props.session.agentPresetId)
  const renderItems = buildRenderItems(props.entries)

  return (
    <>
      <header className={styles.sessionHeader}>
        <Bot size={22} aria-hidden="true" />
        <h3>{props.session.title || profile?.rootNode.label || 'Agent Session'}</h3>
        {props.isPrimary && <span className={styles.sessionRole}>{props.t('agent.primarySession')}</span>}
        <div className={styles.sessionActions}>
          <button className={styles.primaryButton} type="button" onClick={props.onOpenSidebar}>
            <span>{props.t('sessions.openInSidebar')}</span><ArrowRight aria-hidden="true" size={13} />
          </button>
          <DropdownMenu><DropdownMenuTrigger asChild><Button size="small" variant="ghost" aria-label="更多会话操作"><MoreHorizontal size={18} /></Button></DropdownMenuTrigger>
            <DropdownMenuContent>
              {props.onRename && <DropdownMenuItem icon={<Pencil size={14} />} onSelect={props.onRename}>{props.t('sessions.rename')}</DropdownMenuItem>}
              <DropdownMenuItem onSelect={() => setSessionDetailsOpen(true)}>会话详情</DropdownMenuItem>
              {props.onDelete && <DropdownMenuItem tone="danger" icon={<Trash2 size={14} />} onSelect={props.onDelete}>{props.t('sessions.delete')}</DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      <Dialog open={sessionDetailsOpen} title="会话详情" onClose={() => setSessionDetailsOpen(false)}>
        <p>{profile?.rootNode.label ?? props.session.agentPresetId}</p><p style={{ overflowWrap: 'anywhere' }}>{props.session.id}</p>
      </Dialog>
      {view === 'summary' ? props.api ? <div className={styles.summaryPane}><SessionMemory api={props.api} sessionId={props.session.id} onSaved={props.onSessionUpdated} navigation={tabs} /></div> : <>{tabs}<p>会话服务不可用。</p></> : <>
      {tabs}
      <div className={styles.infoGrid}>
        <div className={styles.infoCard}>
          <span>Agent Preset</span>
          <strong>{profile?.rootNode.label ?? props.session.agentPresetId}</strong>
        </div>
        <div className={styles.infoCard}>
          <span>{props.t('sessions.messageCountLabel')}</span>
          <strong>{props.session.entryCount}</strong>
        </div>
        <div className={styles.infoCard}>
          <span>上次总结 · Session 消息</span>
          <strong title={summaryProgress?.error}>{!props.api ? '会话服务不可用' : !summaryProgress ? '正在加载…'
            : summaryProgress.error ? '摘要状态加载失败'
            : summaryProgress.through === undefined ? '尚未总结' : `已总结至消息 #${summaryProgress.through}`}</strong>
        </div>
        <div className={styles.infoCard}>
          <span>{props.t('sessions.affiliation')}</span>
          <strong>{props.t(props.session.timelineId ? 'sessions.timelineBound' : 'sessions.standalone')}</strong>
        </div>
        <div className={styles.infoCard}>
          <span>{props.t('sessions.lastActiveLabel')}</span>
          <strong>{formatDate(props.session.updatedAt)}</strong>
        </div>
      </div>

      {/* 转录缩略预览 */}
      <section className={styles.timelineLogsSection}>
        <h4 className={styles.sectionTitle}>{props.t('sessions.transcriptPreview')}</h4>
        {props.previewLoading ? <p role="status">{props.t('sessions.previewLoading')}</p>
          : props.previewError ? <div role="alert"><p>{props.previewError}</p>
            <Button onClick={props.onRetryPreview}><RefreshCw aria-hidden="true" />{props.t('sessions.retryPreview')}</Button></div>
          : renderItems.length === 0 ? (
          <div className={styles.empty}>
            <span>{props.t('sessions.noTranscript')}</span>
          </div>
        ) : (
          <div className={styles.transcriptList}>
            {renderItems.map(item => item.kind === 'tool-group' ? (
              <AgentToolGroupBlock key={item.id} label={item.label} tools={item.tools} t={props.t} />
            ) : item.kind === 'summary' ? (
              <details className={styles.transcriptReasoning} key={item.id}><summary>{item.label}</summary><p className={styles.transcriptEntryContent}>{item.content}</p></details>
            ) : item.kind === 'reasoning' ? (
              <details className={styles.transcriptReasoning} key={item.id}>
                <summary>{props.t('agent.reasoning')}</summary>
                <p className={styles.transcriptEntryContent}>{item.content}</p>
              </details>
            ) : (
              <div key={item.id} className={styles.transcriptEntry}>
                <div className={styles.transcriptEntryHeader}>
                  <span>{props.t(item.role === 'assistant' ? 'sessions.messageAssistant' : 'sessions.messageUser')}</span>
                  <small>{formatDate(item.message.createdAt)}</small>
                </div>
                {item.interjectionStatus ? <small>{item.interjectionStatus === 'discarded' ? '未接入（已放弃）' : item.interjectionStatus === 'pending' ? '待接入' : '已接入'}</small> : null}
                <p className={styles.transcriptEntryContent}>{item.content}</p>
                <MessageAttachments t={props.t} attachments={item.message.entry.kind === 'message' || item.message.entry.kind === 'user-interjection' ? item.message.entry.attachments : undefined} />
              </div>
            ))}
          </div>
        )}
      </section>
      </>}
    </>
  )
}

function EmptyState(props: { text: string }) {
  return (
    <div className={styles.empty}>
      <FolderGit2 aria-hidden="true" />
      <span>{props.text}</span>
    </div>
  )
}

function formatDate(value: string): string {
  return formatDateTime(value)
}

function parseConvertedChat(value: unknown): { title: string; messages: Array<{ content: string; createdAt?: string }> } {
  if (!value || typeof value !== 'object' || !('title' in value) || typeof value.title !== 'string' || !('messages' in value) || !Array.isArray(value.messages)) throw new Error('Chat converter returned an invalid conversation')
  return { title: value.title, messages: value.messages.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object' || !('content' in entry) || typeof entry.content !== 'string') throw new Error('Chat converter returned an invalid message')
    if ('createdAt' in entry && entry.createdAt !== undefined && typeof entry.createdAt !== 'string') throw new Error('Chat converter returned an invalid message timestamp')
    return { content: entry.content, ...('createdAt' in entry && typeof entry.createdAt === 'string' ? { createdAt: entry.createdAt } : {}) }
  }) }
}
