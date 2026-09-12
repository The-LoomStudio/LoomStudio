import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Translator } from '../../shared/i18n/index.js'
import type { AgentSession, CardSummary, NarrativeTimeline } from '../../entities/index.js'
import { cardMediaUrl, useCardMediaRevision } from '../../shared/lib/card-media.js'
import styles from './play-panel.module.scss'

type PlayTab = 'recent' | 'character' | 'sessions'

type PlayPanelProps = {
  character: ReactNode
  sessions: ReactNode
  t: Translator
  cards: CardSummary[]
  timelines: NarrativeTimeline[]
  agentSessions: AgentSession[]
  onOpenCard(card: CardSummary): void
  onOpenTimeline(timeline: NarrativeTimeline): void
  onOpenAgentSession(session: AgentSession): void
}

export function PlayPanel(props: PlayPanelProps) {
  const [tab, setTab] = useState<PlayTab>('recent')
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [recentSessionsOpen, setRecentSessionsOpen] = useState(true)
  const [selectedDate, setSelectedDate] = useState<string>()
  const [monthCursor, setMonthCursor] = useState(() => new Date())
  const [headerActions, setHeaderActions] = useState<HTMLElement | null>(null)
  useEffect(() => {
    setHeaderActions(document.getElementById('studio-panel-header-actions'))
  }, [])
  const mediaRevision = useCardMediaRevision()
  const sessions = useMemo(() => [
    ...props.timelines.map(item => {
      const card = item.createdFrom ? props.cards.find(candidate => candidate.id === item.createdFrom?.cardId) : undefined
      return {
        kind: 'narrative' as const,
        id: item.id,
        title: item.title || item.id,
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
    }),
    ...props.agentSessions.map(item => ({ kind: 'agent' as const, id: item.id, title: item.title || item.id, preview: undefined, avatarUrl: undefined, updatedAt: item.updatedAt, open: () => props.onOpenAgentSession(item) })),
  ].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)), [mediaRevision, props.agentSessions, props.cards, props.timelines, props.onOpenAgentSession, props.onOpenTimeline])
  const visibleSessions = selectedDate ? sessions.filter(item => dayKey(item.updatedAt) === selectedDate) : sessions
  const groupedSessions = useMemo(() => groupByDay(visibleSessions), [visibleSessions])
  const calendarDays = useMemo(() => buildMonthDays(monthCursor), [monthCursor])
  const dateMarkers = useMemo(() => new Set(sessions.map(item => dayKey(item.updatedAt))), [sessions])
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
    <section className={styles.panel} aria-label={props.t('rail.play')}>
      <div className={styles.header}>
        <nav className="loom-page-tabs" aria-label={props.t('rail.play')}>
        <button className={`loom-page-tab ${tab === 'recent' ? 'loom-page-tab-active' : ''}`} type="button" onClick={() => setTab('recent')}>{props.t('play.recent')}</button>
        <button className={`loom-page-tab ${tab === 'character' ? 'loom-page-tab-active' : ''}`} type="button" onClick={() => setTab('character')}>{props.t('rail.character')}</button>
        <button className={`loom-page-tab ${tab === 'sessions' ? 'loom-page-tab-active' : ''}`} type="button" onClick={() => setTab('sessions')}>{props.t('play.sessions')}</button>
        </nav>
      </div>
      {tab === 'recent' && headerActions ? createPortal((
        <button
          aria-expanded={calendarOpen}
          aria-label={props.t('play.filterDate')}
          className={`${styles.calendarToggle} ${calendarOpen || selectedDate ? styles.calendarToggleActive : ''}`}
          title={props.t('play.filterDate')}
          type="button"
          onClick={() => setCalendarOpen(value => !value)}
        >
          <CalendarDays size={15} aria-hidden="true" />
        </button>
      ), headerActions) : null}
      {calendarOpen && tab === 'recent' ? (
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
        {tab === 'character' ? props.character : null}
        {tab === 'sessions' ? props.sessions : null}
        {tab === 'recent' ? <div className={styles.recent}>
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
            <div className={styles.sectionTitleRow}>
              <h3>{props.t('play.recentSessions')}</h3>
              <button className={styles.sectionToggle} type="button" aria-expanded={recentSessionsOpen} aria-label={recentSessionsOpen ? '收起最近会话' : '展开最近会话'} onClick={() => setRecentSessionsOpen(value => !value)}>
                {recentSessionsOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
              </button>
            </div>
            {recentSessionsOpen ? groupedSessions.map(group => <div className={styles.sessionGroup} key={group.key}>
              {!selectedDate ? <span className={styles.sessionDate}>{formatDay(group.key)}</span> : null}
              {group.items.slice(0, 8).map(item => (
                <button className={styles.sessionRow} key={item.id} type="button" onClick={item.open}>
                  <span className={styles.sessionAvatar}>
                    {item.avatarUrl ? <img src={item.avatarUrl} alt="" /> : item.kind === 'narrative' ? item.title.slice(0, 1) : 'A'}
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
            </div>) : null}
          </section>
        </div> : null}
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
