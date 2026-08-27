import { useMemo, useState } from 'react'
import { Bot, GitBranch, MessageSquareText, Waypoints } from 'lucide-react'
import type { AgentProfile, AgentSession, NarrativeBranch, NarrativeTimeline } from '../../entities/index.js'
import type { Translator } from '../../shared/i18n/index.js'
import styles from './sessions-panel.module.scss'

type SessionView = 'timeline' | 'agent'

type SessionsPanelProps = {
  activeBranch?: NarrativeBranch
  activeTimeline?: NarrativeTimeline
  agentChatSession?: AgentSession
  agentProfiles: AgentProfile[]
  branches: NarrativeBranch[]
  narrativeAgentSession?: AgentSession
  selectedCardName?: string
  t: Translator
  timelines: NarrativeTimeline[]
  onOpenTimeline(timeline: NarrativeTimeline): void
}

export function SessionsPanel(props: SessionsPanelProps) {
  const [view, setView] = useState<SessionView>('timeline')
  const agentSessions = useMemo(() => {
    const sessions = [props.narrativeAgentSession, props.agentChatSession].filter((session): session is AgentSession => Boolean(session))
    return [...new Map(sessions.map(session => [session.id, session])).values()]
  }, [props.agentChatSession, props.narrativeAgentSession])

  return (
    <div className={styles.panel}>
      <nav className="loom-page-tabs" aria-label={props.t('sessions.views')}>
        <button
          aria-current={view === 'timeline' ? 'page' : undefined}
          className={`loom-page-tab ${view === 'timeline' ? 'loom-page-tab-active' : ''}`}
          type="button"
          onClick={() => setView('timeline')}
        >
          {props.t('sessions.timeline')}
        </button>
        <button
          aria-current={view === 'agent' ? 'page' : undefined}
          className={`loom-page-tab ${view === 'agent' ? 'loom-page-tab-active' : ''}`}
          type="button"
          onClick={() => setView('agent')}
        >
          {props.t('sessions.agent')}
        </button>
      </nav>

      {view === 'timeline' ? (
        <section className={styles.content}>
          <header className={styles.sectionHeader}>
            <Waypoints aria-hidden="true" />
            <div>
              <strong>{props.selectedCardName ?? props.t('sessions.timeline')}</strong>
              <span>{props.t('sessions.timelineDescription')}</span>
            </div>
          </header>
          <div className={styles.list}>
            {props.timelines.length === 0 ? <EmptyState icon="timeline" text={props.t('sessions.timelineEmpty')} /> : props.timelines.map(timeline => {
              const active = timeline.id === props.activeTimeline?.id
              const branchCount = active ? props.branches.length : undefined
              return (
                <button
                  key={timeline.id}
                  aria-current={active ? 'true' : undefined}
                  className={`${styles.item} ${active ? styles.itemActive : ''}`}
                  type="button"
                  onClick={() => props.onOpenTimeline(timeline)}
                >
                  <GitBranch aria-hidden="true" />
                  <span className={styles.itemBody}>
                    <strong>{timeline.title || props.t('sessions.untitledTimeline')}</strong>
                    <small>{formatDate(timeline.updatedAt)}</small>
                  </span>
                  {branchCount !== undefined ? <span className={styles.count}>{branchCount}</span> : null}
                </button>
              )
            })}
          </div>
          {props.activeTimeline && props.activeBranch ? (
            <div className={styles.activeContext}>
              <span>{props.t('sessions.activeBranch')}</span>
              <code>{props.activeBranch.title || props.activeBranch.id}</code>
            </div>
          ) : null}
        </section>
      ) : (
        <section className={styles.content}>
          <header className={styles.sectionHeader}>
            <Bot aria-hidden="true" />
            <div>
              <strong>{props.t('sessions.agent')}</strong>
              <span>{props.t('sessions.agentDescription')}</span>
            </div>
          </header>
          <div className={styles.list}>
            {agentSessions.length === 0 ? <EmptyState icon="agent" text={props.t('sessions.agentEmpty')} /> : agentSessions.map(session => {
              const profile = props.agentProfiles.find(candidate => candidate.id === session.agentProfileId)
              const narrativeBound = session.id === props.narrativeAgentSession?.id
              return (
                <article className={styles.item} key={session.id}>
                  <MessageSquareText aria-hidden="true" />
                  <span className={styles.itemBody}>
                    <strong>{session.title || profile?.name || props.t('sessions.untitledAgentSession')}</strong>
                    <small>{profile?.name ?? session.agentProfileId}</small>
                  </span>
                  <span className={styles.badge}>{props.t(narrativeBound ? 'sessions.boundTimeline' : 'sessions.standalone')}</span>
                  <span className={styles.count}>{session.entryCount}</span>
                </article>
              )
            })}
          </div>
          <p className={styles.limitNote}>{props.t('sessions.agentCurrentOnly')}</p>
        </section>
      )}
    </div>
  )
}

function EmptyState(props: { icon: SessionView; text: string }) {
  return (
    <div className={styles.empty}>
      {props.icon === 'timeline' ? <Waypoints aria-hidden="true" /> : <Bot aria-hidden="true" />}
      <span>{props.text}</span>
    </div>
  )
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}
