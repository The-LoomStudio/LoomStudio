import { Bot, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import type { Translator } from '../../shared/i18n/index.js'
import type { AgentPreset, AgentSession, CardSummary, NarrativeTimeline } from '../../entities/index.js'
import { cardMediaUrl, useCardMediaRevision } from '../../shared/lib/card-media.js'
import styles from './play-panel.module.scss'
import { PanelHeaderActions } from '../../shared/studio-shell/studio-window-header-context.js'
import { useStudioLayoutStore } from '../../shared/studio-shell/studio-layout-store.js'
import { PanelTabs } from '../../shared/ui/panel-tabs/index.js'

type PlayTab = 'character' | 'sessions'

type PlayPanelProps = {
  character: ReactNode
  sessions: ReactNode
  t: Translator
}

type RecentPlayPanelProps = {
  t: Translator
  cards: CardSummary[]
  timelines: NarrativeTimeline[]
  agentSessions: AgentSession[]
  agentPresets: AgentPreset[]
  onOpenCard(card: CardSummary): void
  onOpenTimeline(timeline: NarrativeTimeline): void
  onOpenAgentSession(session: AgentSession): void
}

export function PlayPanel(props: PlayPanelProps) {
  const tab = useStudioLayoutStore(state => state.playTab)
  const setTab = useStudioLayoutStore(state => state.setPlayTab)
  return (
    <section className={styles.panel} aria-label={props.t('rail.play')}>
      <div className={styles.header}>
        <PanelTabs<PlayTab>
          activeId={tab}
          ariaLabel={props.t('rail.play')}
          items={[
            { id: 'character', label: props.t('rail.character') },
            { id: 'sessions', label: props.t('rail.sessions') },
          ]}
          onChange={setTab}
        />
      </div>
      <div className={styles.content}>
        {tab === 'character' ? props.character : props.sessions}
      </div>
    </section>
  )
}

export function RecentPlayPanel(props: RecentPlayPanelProps) {
  const calendarOpen = useStudioLayoutStore(state => state.playCalendarOpen)
  const setCalendarOpen = useStudioLayoutStore(state => state.setPlayCalendarOpen)
  const selectedDate = useStudioLayoutStore(state => state.playSelectedDate)
  const setSelectedDate = useStudioLayoutStore(state => state.setPlaySelectedDate)
  const recentSessionsOpen = useStudioLayoutStore(state => state.playRecentSessionsOpen)
  const setRecentSessionsOpen = useStudioLayoutStore(state => state.setPlayRecentSessionsOpen)
  const [monthCursor, setMonthCursor] = useState(() => new Date(selectedDate || Date.now()))
  const mediaRevision = useCardMediaRevision()
  const timelines = useMemo(() => props.timelines.map(item => {
      const card = item.createdFrom ? props.cards.find(candidate => candidate.id === item.createdFrom?.cardId) : undefined
      return {
        id: item.id,
        title: item.title || card?.name || props.t('sessions.untitledTimeline'),
        preview: item.latestPreview
          ? truncatePreview(item.latestPreview)
          : item.openingPreview
            ? truncatePreview(item.openingPreview)
            : card?.openingPreview
              ? truncatePreview(card.openingPreview)
              : undefined,
        avatarUrl: card?.media?.avatarAssetId
          ? cardMediaUrl(card.id, 'avatar', card.media.avatarAssetId, mediaRevision)
          : undefined,
        updatedAt: item.updatedAt,
        open: () => props.onOpenTimeline(item),
      }
    }).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
  [mediaRevision, props.cards, props.timelines, props.onOpenTimeline, props.t])
  const sessions = useMemo(() => props.agentSessions.map(item => {
    const preset = props.agentPresets.find(candidate => candidate.id === item.agentPresetId)
    const timeline = props.timelines.find(candidate => candidate.id === item.timelineId)
    return {
      id: item.id,
      title: item.title || props.t('sessions.untitledAgentSession'),
      summary: [
        preset?.rootNode.label,
        props.t('play.sessionEntries', { count: item.entryCount }),
        timeline ? props.t('play.sessionTimeline', { title: timeline.title || props.t('sessions.untitledTimeline') }) : undefined,
      ].filter(Boolean).join(' · '),
      updatedAt: item.updatedAt,
      open: () => props.onOpenAgentSession(item),
    }
  }).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
  [props.agentSessions, props.agentPresets, props.timelines, props.onOpenAgentSession, props.t])
  const visibleSessions = selectedDate ? sessions.filter(item => dayKey(item.updatedAt) === selectedDate) : sessions
  const visibleTimelines = selectedDate ? timelines.filter(item => dayKey(item.updatedAt) === selectedDate) : timelines
  const groupedSessions = useMemo(() => groupByDay(visibleSessions), [visibleSessions])
  const groupedTimelines = useMemo(() => groupByDay(visibleTimelines), [visibleTimelines])
  const calendarDays = useMemo(() => buildMonthDays(monthCursor), [monthCursor])
  const dateMarkers = useMemo(() => new Set([...sessions, ...timelines].map(item => dayKey(item.updatedAt))), [sessions, timelines])
  const recentCards = useMemo(() => {
    const lastPlayed = new Map<string, string>()
    for (const timeline of props.timelines) {
      if (!timeline.createdFrom) continue
      const current = lastPlayed.get(timeline.createdFrom.cardId)
      if (!current || timeline.updatedAt > current) lastPlayed.set(timeline.createdFrom.cardId, timeline.updatedAt)
    }
    return [...props.cards].sort((left, right) =>
      (lastPlayed.get(right.id) ?? right.updatedAt).localeCompare(lastPlayed.get(left.id) ?? left.updatedAt))
  }, [props.cards, props.timelines])

  return (
    <section className={styles.panel} aria-label={props.t('rail.recent')}>
      <div className={styles.header}>
        <h2 className={styles.recentHeading}>{props.t('rail.recent')}</h2>
      </div>
      <PanelHeaderActions panel="recent">
        <button
          aria-expanded={calendarOpen}
          aria-label={props.t('play.filterDate')}
          className={`${styles.calendarToggle} ${calendarOpen || selectedDate ? styles.calendarToggleActive : ''}`}
          title={props.t('play.filterDate')}
          type="button"
          onClick={() => setCalendarOpen(!calendarOpen)}
        >
          <CalendarDays size={15} aria-hidden="true" />
        </button>
      </PanelHeaderActions>
      {calendarOpen ? (
        <div className={styles.calendarPopover} role="dialog" aria-label={props.t('play.filterDate')}>
          <div className={styles.calendarHeader}>
            <button type="button" aria-label={props.t('play.previousMonth')} onClick={() => setMonthCursor(date => new Date(date.getFullYear(), date.getMonth() - 1, 1))}><ChevronLeft size={15} /></button>
            <strong>{monthCursor.getFullYear()} / {String(monthCursor.getMonth() + 1).padStart(2, '0')}</strong>
            <button type="button" aria-label={props.t('play.nextMonth')} onClick={() => setMonthCursor(date => new Date(date.getFullYear(), date.getMonth() + 1, 1))}><ChevronRight size={15} /></button>
            {selectedDate ? <button type="button" aria-label={props.t('play.clearDate')} onClick={() => setSelectedDate(undefined)}><X size={15} /></button> : null}
          </div>
          <div className={styles.calendarGrid}>
            {calendarDays.map((day, index) => day ? (
              <button className={day.key === selectedDate ? styles.calendarDayActive : ''} key={day.key} type="button" onClick={() => setSelectedDate(day.key)}>
                <span>{day.date}</span>
                {dateMarkers.has(day.key) ? <i aria-hidden="true" /> : null}
              </button>
            ) : <span key={`empty-${index}`} aria-hidden="true" />)}
          </div>
        </div>
      ) : null}
      <div className={styles.content}>
        <div className={styles.recent}>
          <section className={styles.characterStrip}>
            <h3>{props.t('play.recentCharacters')}</h3>
            <div className={styles.characterScroller}>
              {recentCards.slice(0, 10).map(card => {
                const avatarUrl = card.media?.avatarAssetId
                  ? cardMediaUrl(card.id, 'avatar', card.media.avatarAssetId, mediaRevision)
                  : undefined
                return (
                  <button className={styles.characterCard} key={card.id} type="button" onClick={() => props.onOpenCard(card)}>
                    <span className={styles.avatar}>
                      {avatarUrl ? <img src={avatarUrl} alt="" /> : <span>{card.name.slice(0, 1)}</span>}
                    </span>
                    <strong>{card.name}</strong>
                  </button>
                )
              })}
            </div>
          </section>
          <section className={styles.sessionList}>
            <h3>{props.t('play.recentTimelines')}</h3>
            {groupedTimelines.map(group => <div className={styles.sessionGroup} key={group.key}>
              {!selectedDate ? <span className={styles.sessionDate}>{formatDay(group.key)}</span> : null}
              {group.items.slice(0, 8).map(item => (
                <button className={styles.sessionRow} key={item.id} type="button" onClick={item.open}>
                  <span className={styles.sessionAvatar}>
                    {item.avatarUrl ? <img src={item.avatarUrl} alt="" /> : item.title.slice(0, 1)}
                  </span>
                  <span className={styles.sessionContent}>
                    <span className={styles.sessionInfo}>
                      <span className={styles.sessionType}>{formatRecentDate(item.updatedAt)}</span>
                      <strong>{item.title}</strong>
                    </span>
                    {item.preview ? <span className={styles.sessionPreview}>{item.preview}</span> : null}
                  </span>
                </button>
              ))}
            </div>)}
          </section>
          <section className={styles.sessionList}>
            <div className={styles.sectionTitleRow}>
              <h3>{props.t('play.recentSessions')}</h3>
              <button className={styles.sectionToggle} type="button" aria-expanded={recentSessionsOpen} aria-label={recentSessionsOpen ? '收起最近会话' : '展开最近会话'} onClick={() => setRecentSessionsOpen(!recentSessionsOpen)}>
                {recentSessionsOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
              </button>
            </div>
            {recentSessionsOpen ? groupedSessions.map(group => <div className={styles.sessionGroup} key={group.key}>
              {!selectedDate ? <span className={styles.sessionDate}>{formatDay(group.key)}</span> : null}
              {group.items.slice(0, 8).map(item => (
                <button className={styles.sessionRow} key={item.id} type="button" onClick={item.open}>
                  <Bot className={styles.sessionBot} aria-hidden="true" />
                  <span className={styles.sessionContent}>
                    <span className={styles.sessionInfo}>
                      <span className={styles.sessionType}>{formatRecentDate(item.updatedAt)}</span>
                      <strong>{item.title}</strong>
                    </span>
                    <span className={styles.sessionPreview}>{item.summary}</span>
                  </span>
                </button>
              ))}
            </div>) : null}
          </section>
        </div>
      </div>
    </section>
  )
}

function formatRecentDate(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function truncatePreview(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > 120 ? `${normalized.slice(0, 120)}…` : normalized
}

function dayKey(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return value.slice(0, 10)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function formatDay(value: string): string {
  const date = new Date(`${value}T00:00:00`)
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric', weekday: 'short' }).format(date) : value
}

function groupByDay<T extends { updatedAt: string }>(items: T[]): Array<{ key: string; items: T[] }> {
  const groups = new Map<string, T[]>()
  for (const item of items) groups.set(dayKey(item.updatedAt), [...(groups.get(dayKey(item.updatedAt)) ?? []), item])
  return [...groups.entries()].map(([key, grouped]) => ({ key, items: grouped }))
}

function buildMonthDays(cursor: Date): Array<{ key: string; date: number } | null> {
  const year = cursor.getFullYear()
  const month = cursor.getMonth()
  const firstDay = new Date(year, month, 1).getDay()
  const count = new Date(year, month + 1, 0).getDate()
  return [...Array(firstDay).fill(null), ...Array.from({ length: count }, (_, index) => {
    const date = index + 1
    return { key: `${year}-${String(month + 1).padStart(2, '0')}-${String(date).padStart(2, '0')}`, date }
  })]
}
