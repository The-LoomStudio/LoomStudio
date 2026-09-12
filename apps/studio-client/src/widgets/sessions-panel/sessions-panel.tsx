import { useEffect, useMemo, useState } from 'react'
import {
  ArrowDownUp,
  ArrowRight,
  Bot,
  Check,
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
  Play,
  Trash2,
  Upload,
  User,
  X,
} from 'lucide-react'
import type {
  AgentProfile,
  AgentSession,
  AgentTranscriptEntry,
  CardSummary,
  NarrativeBranch,
  NarrativeNode,
  NarrativeTimeline,
} from '../../entities/index.js'
import type { StudioApi } from '../../shared/api/studio-api.js'
import { cardMediaUrl, useCardMediaRevision } from '../../shared/lib/card-media.js'
import type { Translator } from '../../shared/i18n/index.js'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '../../shared/ui/context-menu/context-menu.js'
import { MasterDetailWorkbench } from '../../shared/ui/master-detail-workbench/master-detail-workbench.js'
import { Toggle } from '../../shared/ui/toggle/toggle.js'
import {
  areAllExpandablesExpanded,
  areAllSelected,
  areAllSessionsSelected,
  areAllTimelinesSelected,
  filterStandaloneSessions,
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
import styles from './sessions-panel.module.scss'

type SessionFilter = 'all' | 'timelines' | 'standalone'
type SelectedHistoryItem =
  | { kind: 'timeline'; id: string }
  | { kind: 'session'; id: string }

type SessionsPanelProps = {
  activeBranch?: NarrativeBranch
  activeTimeline?: NarrativeTimeline
  agentChatSession?: AgentSession
  agentProfiles: AgentProfile[]
  api?: StudioApi
  branches: NarrativeBranch[]
  cards?: CardSummary[]
  narrativeAgentSession?: AgentSession
  selectedCardName?: string
  t: Translator
  timelines: NarrativeTimeline[]
  onOpenTimeline(timeline: NarrativeTimeline): void
  onOpenAgentSessionInSidebar?(session: AgentSession): void
  onDeleteTimeline?(timelineId: string): Promise<unknown> | void
  onRenameTimeline?(timelineId: string, title: string): Promise<unknown> | void
  onDeleteAgentSession?(sessionId: string): Promise<unknown> | void
  onRenameAgentSession?(sessionId: string, title: string): Promise<unknown> | void
  onArchiveImported?(timelineId: string, result: { unknownParticipantNamespaces: string[]; participantFailures: Array<{ namespace: string; message: string }> }): Promise<void> | void
}

export function SessionsPanel(props: SessionsPanelProps) {
  const mediaRevision = useCardMediaRevision()
  const [filter, setFilter] = useState<SessionFilter>('all')
  const [mobilePane, setMobilePane] = useState<'master' | 'detail'>('master')
  const [searchQuery, setSearchQuery] = useState('')
  const [remoteSessions, setRemoteSessions] = useState<AgentSession[]>([])
  const [expandedTimelines, setExpandedTimelines] = useState<Set<string>>(new Set())
  const [isSelectionMode, setIsSelectionMode] = useState(false)
  const [selectedTimelineIds, setSelectedTimelineIds] = useState<Set<string>>(new Set())
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(new Set())

  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc')

  const sortedTimelines = useMemo(() => sortTimelines(props.timelines, sortOrder), [props.timelines, sortOrder])

  const initialSelectedId = props.activeTimeline?.id ?? sortedTimelines[0]?.id
  const [selectedItem, setSelectedItem] = useState<SelectedHistoryItem | undefined>(
    initialSelectedId ? { kind: 'timeline', id: initialSelectedId } : undefined,
  )

  const [timelineNodesMap, setTimelineNodesMap] = useState<Record<string, NarrativeNode[]>>({})
  const [sessionTranscriptMap, setSessionTranscriptMap] = useState<Record<string, AgentTranscriptEntry[]>>({})

  // 加载远程持久化的全部 Agent 会话
  useEffect(() => {
    if (!props.api?.agentSessions?.list) return
    let active = true
    void props.api.agentSessions.list({ limit: 100 }).then(result => {
      if (active && result?.sessions) {
        setRemoteSessions(result.sessions)
      }
    })
    return () => {
      active = false
    }
  }, [props.api, props.narrativeAgentSession?.id, props.agentChatSession?.id])

  // 合并全部 AgentSessions
  const allSessions = useMemo(() => {
    const memory = [props.narrativeAgentSession, props.agentChatSession].filter(
      (s): s is AgentSession => Boolean(s),
    )
    const map = new Map<string, AgentSession>()
    for (const s of [...remoteSessions, ...memory]) {
      map.set(s.id, s)
    }
    return [...map.values()]
  }, [props.agentChatSession, props.narrativeAgentSession, remoteSessions])

  // 区分绑定会话与独立会话并应用排序
  const { sessionsByTimelineId, standaloneSessions } = useMemo(() => {
    const partitioned = partitionSessions(allSessions)
    return {
      sessionsByTimelineId: partitioned.sessionsByTimelineId,
      standaloneSessions: sortSessions(partitioned.standaloneSessions, sortOrder),
    }
  }, [allSessions, sortOrder])

  // 构建角色快速检索映射表
  const cardMap = useMemo(() => {
    return new Map((props.cards ?? []).map(card => [card.id, card]))
  }, [props.cards])

  // 搜索过滤
  const filteredTimelines = useMemo(() => {
    if (filter === 'standalone') return []
    return filterTimelines(sortedTimelines, cardMap, searchQuery)
  }, [filter, searchQuery, sortedTimelines, cardMap])

  const filteredStandaloneSessions = useMemo(() => {
    if (filter === 'timelines') return []
    return filterStandaloneSessions(standaloneSessions, props.agentProfiles, searchQuery)
  }, [filter, searchQuery, standaloneSessions, props.agentProfiles])

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
    filteredStandaloneSessions.forEach(s => ids.push(s.id))
    filteredTimelines.forEach(t => {
      if (expandedTimelines.has(t.id)) {
        const bound = sessionsByTimelineId.get(t.id) ?? []
        bound.forEach(s => ids.push(s.id))
      }
    })
    return ids
  }, [filteredStandaloneSessions, filteredTimelines, expandedTimelines, sessionsByTimelineId])

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

  const handleBatchDelete = async () => {
    if (totalSelectedCount === 0) return

    const timelineCount = selectedTimelineIds.size
    const sessionCount = selectedSessionIds.size

    let confirmMessage = ''
    if (timelineCount > 0 && sessionCount > 0) {
      confirmMessage = props.t('sessions.confirmBatchDelete', {
        timelines: timelineCount,
        sessions: sessionCount,
      })
    } else if (timelineCount > 0) {
      confirmMessage = props.t('sessions.confirmBatchDeleteTimelines', {
        count: timelineCount,
      })
    } else {
      confirmMessage = props.t('sessions.confirmBatchDeleteSessions', {
        count: sessionCount,
      })
    }

    if (!window.confirm(confirmMessage)) return

    const timelinePromises = Array.from(selectedTimelineIds).map(id => props.onDeleteTimeline?.(id))
    const sessionPromises = Array.from(selectedSessionIds).map(id => props.onDeleteAgentSession?.(id))

    await Promise.allSettled([...timelinePromises, ...sessionPromises])

    if (sessionCount > 0) {
      setRemoteSessions(prev => prev.filter(s => !selectedSessionIds.has(s.id)))
    }

    if (
      selectedItem &&
      ((selectedItem.kind === 'timeline' && selectedTimelineIds.has(selectedItem.id)) ||
        (selectedItem.kind === 'session' && selectedSessionIds.has(selectedItem.id)))
    ) {
      setSelectedItem(undefined)
    }

    handleExitSelectionMode()
  }

  // 当前选中的 Timeline 或 Session 实体
  const selectedTimeline = useMemo(() => {
    if (selectedItem?.kind !== 'timeline') return undefined
    return props.timelines.find(t => t.id === selectedItem.id) ?? sortedTimelines[0]
  }, [props.timelines, selectedItem, sortedTimelines])

  const selectedSession = useMemo(() => {
    if (selectedItem?.kind !== 'session') return undefined
    return allSessions.find(s => s.id === selectedItem.id)
  }, [allSessions, selectedItem])

  // 按需拉取选中时间线的演变节点日志
  useEffect(() => {
    if (!selectedTimeline || !props.api?.narratives?.getPage) return
    const timelineId = selectedTimeline.id
    if (timelineNodesMap[timelineId]) return

    let active = true
    void props.api.narratives
      .getPage({ timelineId, limit: 20 })
      .then(page => {
        if (active && page?.nodes) {
          setTimelineNodesMap(prev => ({ ...prev, [timelineId]: page.nodes }))
        }
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [selectedTimeline, props.api, timelineNodesMap])

  // 按需拉取选中会话的转录缩略预览
  useEffect(() => {
    if (!selectedSession || !props.api?.agentSessions?.getTranscript) return
    const sessionId = selectedSession.id
    if (sessionTranscriptMap[sessionId]) return

    let active = true
    void props.api.agentSessions
      .getTranscript({ agentSessionId: sessionId, limit: 12 })
      .then(page => {
        if (active && page?.entries) {
          setSessionTranscriptMap(prev => ({ ...prev, [sessionId]: page.entries }))
        }
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [selectedSession, props.api, sessionTranscriptMap])

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
      await props.onRenameTimeline?.(timeline.id, next.trim())
    }
  }

  const handleDeleteTimeline = async (timeline: NarrativeTimeline) => {
    const title = timeline.title || props.t('sessions.untitledTimeline')
    if (window.confirm(props.t('sessions.confirmDeleteTimeline', { title }))) {
      await props.onDeleteTimeline?.(timeline.id)
      if (selectedItem?.id === timeline.id) {
        setSelectedItem(undefined)
      }
    }
  }

  const handleRenameSession = async (session: AgentSession) => {
    const currentTitle = session.title || props.t('sessions.untitledAgentSession')
    const next = window.prompt(props.t('sessions.renamePrompt'), currentTitle)
    if (next !== null && next.trim() && next.trim() !== session.title) {
      await props.onRenameAgentSession?.(session.id, next.trim())
      setRemoteSessions(prev => prev.map(s => s.id === session.id ? { ...s, title: next.trim() } : s))
    }
  }

  const handleDeleteSession = async (session: AgentSession) => {
    const title = session.title || props.t('sessions.untitledAgentSession')
    if (window.confirm(props.t('sessions.confirmDeleteSession', { title }))) {
      await props.onDeleteAgentSession?.(session.id)
      setRemoteSessions(prev => prev.filter(s => s.id !== session.id))
      if (selectedItem?.id === session.id) {
        setSelectedItem(undefined)
      }
    }
  }

  const handleOpenSessionInSidebar = (session: AgentSession) => {
    props.onOpenAgentSessionInSidebar?.(session)
    window.dispatchEvent(
      new CustomEvent('loom:open-agent-chat', { detail: { sessionId: session.id } }),
    )
  }

  return (
    <div className={styles.panel} data-loom-component="sessions-panel">
      <div className={styles.filterNav}>
        <nav className="loom-page-tabs" aria-label={props.t('sessions.views')}>
          <button
            aria-current={filter === 'all' ? 'page' : undefined}
            className={`loom-page-tab ${filter === 'all' ? 'loom-page-tab-active' : ''}`}
            type="button"
            onClick={() => {
              setFilter('all')
              setMobilePane('master')
            }}
          >
            {props.t('sessions.filterAll')}
          </button>
          <button
            aria-current={filter === 'timelines' ? 'page' : undefined}
            className={`loom-page-tab ${filter === 'timelines' ? 'loom-page-tab-active' : ''}`}
            type="button"
            onClick={() => {
              setFilter('timelines')
              setMobilePane('master')
            }}
          >
            {props.t('sessions.filterTimelines')}
          </button>
          <button
            aria-current={filter === 'standalone' ? 'page' : undefined}
            className={`loom-page-tab ${filter === 'standalone' ? 'loom-page-tab-active' : ''}`}
            type="button"
            onClick={() => {
              setFilter('standalone')
              setMobilePane('master')
            }}
          >
            {props.t('sessions.filterStandalone')}
          </button>
        </nav>

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

      <MasterDetailWorkbench
        masterWidth="minmax(260px, 340px)"
        mobilePane={mobilePane}
        onMobilePaneChange={setMobilePane}
        master={(
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
                    placeholder="搜索时间线、角色或会话..."
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
              {filteredTimelines.length === 0 && filteredStandaloneSessions.length === 0 ? (
                <EmptyState text={props.t('sessions.timelineEmpty')} />
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
                              data-selected={isTimelineChecked ? 'true' : 'false'}
                              onClick={isSelectionMode ? (e) => handleToggleTimelineSelect(timeline.id, e) : undefined}
                            >
                              {isSelectionMode ? (
                                <div className={styles.selectionToggleWrapper}>
                                  <Toggle
                                    checked={isTimelineChecked}
                                    label={`选择时间线 ${timeline.title || card?.name || ''}`}
                                    onChange={() => {}}
                                  />
                                </div>
                              ) : (
                                hasChildren ? (
                                  <button
                                    aria-expanded={isExpanded}
                                    aria-label="展开关联会话"
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
                                  <strong>{timeline.title || card?.name || props.t('sessions.untitledTimeline')}</strong>
                                  <small>
                                    {card?.name ? `${card.name} · ` : ''}
                                    {formatDate(timeline.updatedAt)}
                                  </small>
                                </span>
                              </button>

                              {hasChildren ? (
                                <span className={styles.badge} title={props.t('sessions.boundSessions', { count: boundSessions.length })}>
                                  <MessageSquareText aria-hidden="true" size={11} />
                                  <span>{boundSessions.length}</span>
                                </span>
                              ) : null}

                              {isSelectionMode && hasChildren ? (
                                <button
                                  aria-expanded={isExpanded}
                                  aria-label="展开关联会话"
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
                              const profile = props.agentProfiles.find(p => p.id === session.agentProfileId)
                              return (
                                <ContextMenu key={session.id}>
                                  <ContextMenuTrigger asChild>
                                    <div
                                      className={styles.childItemRow}
                                      data-active={isSessionSelected ? 'true' : 'false'}
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
                                            label={`选择会话 ${session.title || profile?.name || ''}`}
                                            onChange={() => {}}
                                          />
                                        </div>
                                      ) : null}
                                      <MessageSquareText aria-hidden="true" />
                                      <span className={styles.childItemBody}>
                                        <strong>{session.title || profile?.name || props.t('sessions.untitledAgentSession')}</strong>
                                        <small>{formatDate(session.updatedAt)}</small>
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

              {/* 独立会话分组及分组全选 */}
              {filteredStandaloneSessions.length > 0 ? (
                <>
                  <div className={styles.sectionHeaderRow}>
                    <span className={styles.sectionTitle}>
                      {props.t('sessions.standaloneSection')} ({filteredStandaloneSessions.length})
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

                  {filteredStandaloneSessions.map(session => {
                    const isSessionSelected = selectedItem?.kind === 'session' && selectedItem.id === session.id
                    const isSessionChecked = selectedSessionIds.has(session.id)
                    const profile = props.agentProfiles.find(p => p.id === session.agentProfileId)
                    return (
                      <ContextMenu key={session.id}>
                        <ContextMenuTrigger asChild>
                          <div
                            className={styles.itemRow}
                            data-active={isSessionSelected ? 'true' : 'false'}
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
                                  label={`选择会话 ${session.title || profile?.name || ''}`}
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
                                <Bot aria-hidden="true" />
                              </div>
                              <span className={styles.itemBody}>
                                <strong>{session.title || profile?.name || props.t('sessions.untitledAgentSession')}</strong>
                                <small>{profile?.name ?? session.agentProfileId} · {formatDate(session.updatedAt)}</small>
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
        )}
      >
        <div className={styles.detailPane}>
          {selectedItem?.kind === 'timeline' && selectedTimeline ? (
            <TimelineDetail
              activeBranch={props.activeBranch}
              activeTimeline={props.activeTimeline}
              boundSessions={sessionsByTimelineId.get(selectedTimeline.id) ?? []}
              branches={props.branches}
              card={selectedTimeline.createdFrom?.cardId ? cardMap.get(selectedTimeline.createdFrom.cardId) : undefined}
              nodes={timelineNodesMap[selectedTimeline.id] ?? []}
              api={props.api}
              profiles={props.agentProfiles}
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
              entries={sessionTranscriptMap[selectedSession.id] ?? []}
              profiles={props.agentProfiles}
              session={selectedSession}
              t={props.t}
              onDelete={() => void handleDeleteSession(selectedSession)}
              onOpenSidebar={() => handleOpenSessionInSidebar(selectedSession)}
              onRename={() => void handleRenameSession(selectedSession)}
            />
          ) : (
            <div className={styles.empty}>
              <FolderGit2 aria-hidden="true" />
              <span>请选择左侧时间线或会话查看详情</span>
            </div>
          )}
        </div>
      </MasterDetailWorkbench>
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
  profiles: AgentProfile[]
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
  const avatarUrl = props.card?.media?.avatarAssetId
    ? cardMediaUrl(props.card.id, 'avatar', props.card.media.avatarAssetId, mediaRevision)
    : undefined

  const isActive = props.timeline.id === props.activeTimeline?.id

  async function exportArchive() {
    if (!props.api) return
    setArchiveBusy(true); setArchiveError(undefined); setArchiveNotice(undefined)
    try {
      const result = await props.api.narratives.exportArchive(props.timeline.id)
      const url = URL.createObjectURL(new Blob([JSON.stringify(result.archive, null, 2)], { type: 'application/json' }))
      const anchor = document.createElement('a')
      anchor.href = url; anchor.download = `${props.timeline.title || props.timeline.id}.loom-timeline.json`; anchor.click()
      URL.revokeObjectURL(url)
    } catch (error) { setArchiveError(error instanceof Error ? error.message : String(error)) }
    finally { setArchiveBusy(false) }
  }

  async function importArchive(file: File) {
    if (!props.api) return
    setArchiveBusy(true); setArchiveError(undefined); setArchiveNotice(undefined)
    try {
      const result = await props.api.narratives.importArchive(await file.text())
      await props.onArchiveImported?.(result.timelineId, result)
      const warnings = [
        result.unknownParticipantNamespaces.length > 0 ? `未处理的存档扩展数据：${result.unknownParticipantNamespaces.join(', ')}` : '',
        result.participantFailures.length > 0 ? `存档扩展数据导入失败：${result.participantFailures.map(item => item.namespace).join(', ')}` : '',
      ].filter(Boolean)
      if (warnings.length > 0) setArchiveNotice(warnings.join('；'))
    } catch (error) { setArchiveError(error instanceof Error ? error.message : String(error)) }
    finally { setArchiveBusy(false) }
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
            <span>{props.card?.name ? `角色：${props.card.name} · ` : ''}{props.timeline.id}</span>
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
            <button aria-label="导出 Timeline" className={styles.detailIconButton} disabled={archiveBusy} title="导出 Timeline" type="button" onClick={() => void exportArchive()}><Download aria-hidden="true" size={14} /></button>
            <label aria-label="导入 Timeline" className={styles.detailIconButton} title="导入 Timeline">
              <Upload aria-hidden="true" size={14} />
              <input hidden type="file" accept="application/json,.json" disabled={archiveBusy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void importArchive(file) }} />
            </label>
          </> : null}
          <button className={styles.primaryButton} type="button" onClick={props.onOpen}>
            <Play aria-hidden="true" size={14} />
            <span>{props.t('sessions.enterTimeline')}</span>
          </button>
        </div>
      </header>
      {archiveError ? <p className={styles.emptyNotice} role="alert">{archiveError}</p> : null}
      {archiveNotice ? <p className={styles.emptyNotice} role="status">{archiveNotice}</p> : null}

      <div className={styles.infoGrid}>
        <div className={styles.infoCard}>
          <span>所属角色</span>
          <strong>{props.card?.name ?? '自由叙事'}</strong>
        </div>
        <div className={styles.infoCard}>
          <span>最后游玩时间</span>
          <strong>{formatDate(props.timeline.updatedAt)}</strong>
        </div>
        <div className={styles.infoCard}>
          <span>关联资源</span>
          <strong>{props.timeline.promptResourceIds?.length ?? 0} 个</strong>
        </div>
        {isActive && props.activeBranch ? (
          <div className={styles.infoCard}>
            <span>当前活跃分支</span>
            <strong>{props.activeBranch.title || props.activeBranch.id}</strong>
          </div>
        ) : null}
      </div>

      {isActive && props.branches.length > 0 ? (
        <section className={styles.branchesSection}>
          <h4>分支列表 (Branches)</h4>
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
                  {isCurrentBranch ? <span className={styles.badge}>当前活跃</span> : null}
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
            <MessageSquareText aria-hidden="true" size={14} />
            <span>{props.t('sessions.boundAgentSessions')} ({props.boundSessions.length})</span>
          </h4>
        </div>
        {props.boundSessions.length === 0 ? (
          <p className={styles.emptyNotice}>{props.t('sessions.noBoundSessions')}</p>
        ) : (
          <div className={styles.boundSessionsList}>
            {props.boundSessions.map(session => {
              const profile = props.profiles.find(p => p.id === session.agentProfileId)
              return (
                <div key={session.id} className={styles.boundSessionCard}>
                  <div className={styles.boundSessionInfo}>
                    <div className={styles.boundSessionTitleRow}>
                      <strong>{session.title || profile?.name || props.t('sessions.untitledAgentSession')}</strong>
                      {profile?.name ? <span className={styles.profileBadge}>{profile.name}</span> : null}
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
        {props.nodes.length === 0 ? (
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
                      <span className={styles.logSourceBadge}>Agent 协同</span>
                    ) : null}
                    {node.source?.changesetId ? (
                      <span className={styles.logRevisionBadge}>{node.source.changesetId.slice(0, 8)}</span>
                    ) : null}
                  </div>
                </div>
                <p className={styles.logNodeText}>{node.body?.raw || '（空正文节点）'}</p>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  )
}

function SessionDetail(props: {
  entries: AgentTranscriptEntry[]
  profiles: AgentProfile[]
  session: AgentSession
  t: Translator
  onDelete?(): void
  onOpenSidebar(): void
  onRename?(): void
}) {
  const profile = props.profiles.find(p => p.id === props.session.agentProfileId)

  return (
    <>
      <header className={styles.detailHeader}>
        <div className={styles.detailTitleBlock}>
          <div className={styles.detailAvatarPlaceholder}>
            <Bot aria-hidden="true" />
          </div>
          <div className={styles.detailTitleMeta}>
            <h3>{props.session.title || profile?.name || 'Agent Session'}</h3>
            <span>{profile?.name ?? props.session.agentProfileId} · {props.session.id}</span>
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
          <button className={styles.primaryButton} type="button" onClick={props.onOpenSidebar}>
            <span>{props.t('sessions.openInSidebar')}</span>
            <ArrowRight aria-hidden="true" size={13} />
          </button>
        </div>
      </header>

      <div className={styles.infoGrid}>
        <div className={styles.infoCard}>
          <span>Agent Profile</span>
          <strong>{profile?.name ?? props.session.agentProfileId}</strong>
        </div>
        <div className={styles.infoCard}>
          <span>消息条数</span>
          <strong>{props.session.entryCount} 条</strong>
        </div>
        <div className={styles.infoCard}>
          <span>归属状态</span>
          <strong>{props.session.timelineId ? '时间线关联' : '全局独立'}</strong>
        </div>
        <div className={styles.infoCard}>
          <span>最后活跃</span>
          <strong>{formatDate(props.session.updatedAt)}</strong>
        </div>
      </div>

      {/* 转录缩略预览 */}
      <section className={styles.timelineLogsSection}>
        <h4 className={styles.sectionTitle}>{props.t('sessions.transcriptPreview')}</h4>
        {props.entries.length === 0 ? (
          <div className={styles.empty}>
            <span>{props.t('sessions.noTranscript')}</span>
          </div>
        ) : (
          <div className={styles.transcriptList}>
            {props.entries.map(entry => (
              <div key={entry.id} className={styles.transcriptEntry}>
                <div className={styles.transcriptEntryHeader}>
                  <span className={styles.badge}>{entry.entry.kind}</span>
                  <small>{formatDate(entry.createdAt)}</small>
                </div>
                <p className={styles.transcriptEntryContent}>
                  {entry.entry.kind === 'message'
                    ? `${entry.entry.role}: ${entry.entry.content}`
                    : entry.entry.kind === 'reasoning'
                      ? `[思考] ${entry.entry.content}`
                      : entry.entry.kind === 'tool-invocation'
                        ? `[工具调用] ${entry.entry.exposedName}`
                        : JSON.stringify(entry.entry)}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>
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
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}
