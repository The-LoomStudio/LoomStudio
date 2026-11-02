import { StoryHero } from '../../shared/ui/story-hero/story-hero.js'
import { ArrowUpRight, BookOpen, CalendarDays, Clock3, MessageSquare, Search, X } from 'lucide-react'
import { useState } from 'react'
import { formatDate, formatDateTime, type Translator } from '../../shared/i18n/index.js'
import type { AgentPreset, AgentSession, CardSummary, NarrativeTimeline } from '../../entities/index.js'
import type { RecentCharacter } from '../../features/recent-characters/model/recent-characters.js'
import { cardMediaUrl, useCardMediaRevision } from '../../shared/lib/card-media.js'
import { useStudioLayoutStore } from '../../shared/studio-shell/studio-layout-store.js'
import styles from './play-panel.module.scss'

type RecentPlayPanelProps = {
  activeTimelineId?: string
  activeSessionId?: string
  primarySessionId?: string
  t: Translator
  cards: CardSummary[]
  timelines: NarrativeTimeline[]
  agentSessions: AgentSession[]
  agentPresets: AgentPreset[]
  recent: RecentCharacter[]
  onOpenRecent(visit: RecentCharacter): void
  onOpenTimeline(timeline: NarrativeTimeline): void
  onOpenAgentSession(session: AgentSession): void
}

export function RecentPlayPanel(props: RecentPlayPanelProps) {
  const { t } = props
  const [query, setQuery] = useState('')
  const [characterId, setCharacterId] = useState<string>()
  const date = useStudioLayoutStore(state => state.playSelectedDate) ?? ''
  const setDate = useStudioLayoutStore(state => state.setPlaySelectedDate)
  const mediaRevision = useCardMediaRevision()
  const avatar = (card?: CardSummary) => card?.media?.avatarAssetId ? cardMediaUrl(card.id, 'avatar', card.media.avatarAssetId, mediaRevision) : undefined
  const recent = props.recent.flatMap(visit => {
    const card = props.cards.find(item => item.id === visit.cardId)
    return card ? [{ visit, card, timeline: props.timelines.find(item => item.id === visit.timelineId && item.createdFrom?.cardId === card.id) }] : []
  })
  const resume = recent.find(item => item.timeline)
  const records = [
    ...props.timelines.map(timeline => {
      const card = props.cards.find(item => item.id === timeline.createdFrom?.cardId)
      return {
        key: `story:${timeline.id}`, kind: 'story', title: timeline.title || card?.name || t('sessions.untitledTimeline'), card,
        preview: cleanPreview(timeline.latestPreview || timeline.openingPreview || card?.openingPreview || ''),
        meta: card?.name || t('sessions.characterUnavailable'), updatedAt: timeline.updatedAt,
        active: timeline.id === props.activeTimelineId, open: () => props.onOpenTimeline(timeline),
      }
    }),
    ...props.agentSessions.map(session => {
      const timeline = props.timelines.find(item => item.id === session.timelineId)
      const card = props.cards.find(item => item.id === timeline?.createdFrom?.cardId)
      const preset = props.agentPresets.find(item => item.id === session.agentPresetId)
      return {
        key: `session:${session.id}`, kind: 'session', title: session.title || t('sessions.untitledAgentSession'), card,
        preview: timeline ? t('play.sessionTimeline', { title: timeline.title || t('sessions.untitledTimeline') }) : '',
        meta: [card?.name, preset?.rootNode.label, t('play.sessionEntries', { count: session.entryCount }), session.id === props.primarySessionId ? t('agent.primarySession') : undefined].filter(Boolean).join(' · '),
        updatedAt: session.updatedAt, active: session.id === props.activeSessionId, open: () => props.onOpenAgentSession(session),
      }
    }),
  ].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  const visible = records.filter(item => (!characterId || item.card?.id === characterId) && (!date || dayKey(item.updatedAt) === date)
    && [item.title, item.meta, item.preview].join(' ').toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  const days = [...new Set(visible.map(item => dayKey(item.updatedAt)))]
  const filtered = !!(query || characterId || date)
  const clearFilters = () => { setQuery(''); setCharacterId(undefined); setDate(undefined) }
  const renderAvatar = (card?: CardSummary) => <span className={styles.avatar}>{avatar(card) ? <img src={avatar(card)} alt="" /> : card?.name.slice(0, 1) || <MessageSquare size={18} />}</span>

  return <section className={styles.panel} aria-label={t('history.tabRecent')}><div className={styles.body}>
    <aside className={styles.characters}><h2>{t('play.recentCharacters')}</h2><div className={styles.characterList}>
      {recent.slice(0, 10).map(({ card, timeline }) => <button key={card.id} className={styles.character} aria-pressed={characterId === card.id} title={card.name} onClick={() => setCharacterId(characterId === card.id ? undefined : card.id)}>
        {renderAvatar(card)}<span><strong>{card.name}</strong><small>{timeline?.title || t('recentCharacters.choose')}</small></span>
      </button>)}
      {!recent.length && <p className={styles.muted}>{t('recentCharacters.empty')}</p>}
    </div><p className={styles.asideHint}>{t('play.filterCharacter')}</p></aside>
    <section className={styles.main}>
      {resume?.timeline && !filtered && <div className={styles.resume}><StoryHero
        character={resume.card} label={t('play.resumeStory')} title={resume.timeline.title || t('sessions.untitledTimeline')}
        description={cleanPreview(resume.timeline.latestPreview || resume.timeline.openingPreview || resume.card.openingPreview || '')}
        metadata={t('play.updated', { date: formatDateTime(resume.timeline.updatedAt) })}
        actions={<button className={styles.link} onClick={() => props.onOpenRecent(resume.visit)}>{t('play.continueStory')} <ArrowUpRight size={16} /></button>}
      /></div>}
      <div className={styles.listHeading}><h2>{t('play.recentActivity')}</h2><span>{t('play.recordCount', { count: visible.length })}</span></div>
      <div className={styles.filters}><label className={styles.search}><Search size={17} /><input aria-label={t('sessions.searchPlaceholder')} placeholder={t('sessions.searchPlaceholder')} value={query} onChange={event => setQuery(event.target.value)} /></label>
        <label className={styles.date}><CalendarDays size={17} /><input type="date" aria-label={t('play.filterDate')} value={date} onChange={event => setDate(event.target.value || undefined)} /></label>
      </div>
      {filtered && <div className={styles.filterSummary}><span>{props.cards.find(card => card.id === characterId)?.name}</span><button onClick={clearFilters}>{t('play.clearFilters')} <X size={13} /></button></div>}
      {days.map(day => <section className={styles.day} key={day}><h3>{formatDate(`${day}T00:00:00`, undefined, { month: 'long', day: 'numeric', weekday: 'short' })}</h3>{visible.filter(item => dayKey(item.updatedAt) === day).map(item => <button key={item.key} className={styles.record} aria-current={item.active ? 'true' : undefined} onClick={item.open}>
        {renderAvatar(item.card)}<span className={styles.recordBody}><span className={styles.recordTitle}><strong>{item.title}</strong><time dateTime={item.updatedAt}>{formatDateTime(item.updatedAt, undefined, { hour: '2-digit', minute: '2-digit' })}</time></span>
          <span className={styles.meta}>{item.kind === 'story' ? <BookOpen size={13} /> : <MessageSquare size={13} />}{t(item.kind === 'story' ? 'history.tabTimelines' : 'history.tabSessions')} · {item.meta}</span>
          {item.preview && <span className={styles.excerpt}>{item.preview}</span>}</span>
      </button>)}</section>)}
      {!visible.length && <div className={styles.empty}><Clock3 size={30} /><h3>{t(filtered ? 'play.noMatches' : 'play.emptyHistory')}</h3><p>{t(filtered ? 'play.tryFilters' : 'play.emptyHistoryHint')}</p>{filtered && <button className={styles.link} onClick={clearFilters}>{t('play.clearFilters')}</button>}</div>}
    </section>
  </div></section>
}
function dayKey(value: string) {
  const date = new Date(value)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
function cleanPreview(value: string) {
  // Preview is text only; embedded UI/script payloads are not story excerpts.
  const text = value.replace(/<(script|style|quick_replies|quick_reply)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '').replace(/<[^>]*>/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/```[^\n]*\n?/g, '').replace(/[`*_#>]/g, '').replace(/\s+/g, ' ').trim()
  return text.length > 220 ? `${text.slice(0, 220)}…` : text
}
