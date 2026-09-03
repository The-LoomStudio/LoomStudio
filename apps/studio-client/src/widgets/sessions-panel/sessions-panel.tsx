import { useMemo, useState } from 'react'
import { ArrowRight, Bot, FolderGit2, GitCommitHorizontal, History, MessageSquareText } from 'lucide-react'
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
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedTimelineId, setSelectedTimelineId] = useState<string | undefined>(
    props.activeTimeline?.id ?? props.timelines[0]?.id,
  )
  const [selectedAgentSessionId, setSelectedAgentSessionId] = useState<string>()

  const agentSessions = useMemo(() => {
    const sessions = [props.narrativeAgentSession, props.agentChatSession].filter((session): session is AgentSession => Boolean(session))
    return [...new Map(sessions.map(session => [session.id, session])).values()]
  }, [props.agentChatSession, props.narrativeAgentSession])

  const filteredTimelines = useMemo(() => {
    if (!searchQuery.trim()) return props.timelines
    const q = searchQuery.toLowerCase()
    return props.timelines.filter(t => (t.title || 'untitled').toLowerCase().includes(q) || t.id.toLowerCase().includes(q))
  }, [props.timelines, searchQuery])

  const selectedTimeline = useMemo(() => {
    return props.timelines.find(t => t.id === selectedTimelineId) ?? props.timelines[0]
  }, [props.timelines, selectedTimelineId])

  const selectedAgentSession = useMemo(() => {
    return agentSessions.find(s => s.id === selectedAgentSessionId) ?? agentSessions[0]
  }, [agentSessions, selectedAgentSessionId])

  return (
    <div className={styles.panel} data-loom-component="sessions-panel">
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
        <div className={styles.workbench}>
          <nav aria-label={props.t('sessions.timeline')} className={styles.masterNav}>
            <input
              className={styles.searchInput}
              placeholder="搜索时间线..."
              value={searchQuery}
              onChange={event => setSearchQuery(event.target.value)}
            />
            <div className={styles.list}>
              {filteredTimelines.length === 0 ? (
                <EmptyState icon="timeline" text={props.t('sessions.timelineEmpty')} />
              ) : (
                filteredTimelines.map(timeline => {
                  const isActive = timeline.id === props.activeTimeline?.id
                  const isSelected = timeline.id === selectedTimeline?.id
                  const branchCount = isActive ? props.branches.length : undefined
                  return (
                    <button
                      key={timeline.id}
                      aria-current={isSelected ? 'page' : undefined}
                      className={`${styles.item} ${isSelected ? styles.itemActive : ''}`}
                      type="button"
                      onClick={() => {
                        setSelectedTimelineId(timeline.id)
                      }}
                      onDoubleClick={() => props.onOpenTimeline(timeline)}
                    >
                      <History aria-hidden="true" />
                      <span className={styles.itemBody}>
                        <strong>{timeline.title || props.t('sessions.untitledTimeline')}</strong>
                        <small>{formatDate(timeline.updatedAt)}</small>
                      </span>
                      {branchCount !== undefined ? <span className={styles.count}>{branchCount}</span> : null}
                    </button>
                  )
                })
              )}
            </div>
          </nav>

          <div className={styles.detailPane}>
            {selectedTimeline ? (
              <>
                <header className={styles.detailHeader}>
                  <div className={styles.headerTitle}>
                    <FolderGit2 aria-hidden="true" size={18} />
                    <div>
                      <h3>{selectedTimeline.title || props.t('sessions.untitledTimeline')}</h3>
                      <span style={{ fontSize: '11.5px', color: 'var(--loom-color-text-subtle)' }}>
                        {selectedTimeline.id}
                      </span>
                    </div>
                  </div>
                  <button
                    className={styles.primaryButton}
                    type="button"
                    onClick={() => props.onOpenTimeline(selectedTimeline)}
                  >
                    <span>进入此时间线</span>
                    <ArrowRight aria-hidden="true" size={14} />
                  </button>
                </header>

                <div className={styles.infoGrid}>
                  <div className={styles.infoCard}>
                    <span>所属 Card</span>
                    <strong>{props.selectedCardName ?? '当前 Card'}</strong>
                  </div>
                  <div className={styles.infoCard}>
                    <span>最后更新</span>
                    <strong>{formatDate(selectedTimeline.updatedAt)}</strong>
                  </div>
                  <div className={styles.infoCard}>
                    <span>关联资源 (Prompt Resources)</span>
                    <strong>{selectedTimeline.promptResourceIds?.length ?? 0} 个</strong>
                  </div>
                  {selectedTimeline.id === props.activeTimeline?.id && props.activeBranch ? (
                    <div className={styles.infoCard}>
                      <span>当前活跃 Branch</span>
                      <strong>{props.activeBranch.title || props.activeBranch.id}</strong>
                    </div>
                  ) : null}
                </div>

                {selectedTimeline.id === props.activeTimeline?.id && props.branches.length > 0 ? (
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
                            {isCurrentBranch ? (
                              <span className={styles.badge}>当前活跃</span>
                            ) : null}
                          </div>
                        )
                      })}
                    </div>
                  </section>
                ) : null}
              </>
            ) : (
              <div className={styles.empty}>
                <FolderGit2 aria-hidden="true" />
                <span>未选中时间线</span>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className={styles.workbench}>
          <nav aria-label={props.t('sessions.agent')} className={styles.masterNav}>
            <div className={styles.list}>
              {agentSessions.length === 0 ? (
                <EmptyState icon="agent" text={props.t('sessions.agentEmpty')} />
              ) : (
                agentSessions.map(session => {
                  const profile = props.agentProfiles.find(candidate => candidate.id === session.agentProfileId)
                  const narrativeBound = session.id === props.narrativeAgentSession?.id
                  const isSelected = session.id === selectedAgentSession?.id
                  return (
                    <button
                      key={session.id}
                      aria-current={isSelected ? 'page' : undefined}
                      className={`${styles.item} ${isSelected ? styles.itemActive : ''}`}
                      type="button"
                      onClick={() => setSelectedAgentSessionId(session.id)}
                    >
                      <MessageSquareText aria-hidden="true" />
                      <span className={styles.itemBody}>
                        <strong>{session.title || profile?.name || props.t('sessions.untitledAgentSession')}</strong>
                        <small>{profile?.name ?? session.agentProfileId}</small>
                      </span>
                      <span className={styles.badge}>{props.t(narrativeBound ? 'sessions.boundTimeline' : 'sessions.standalone')}</span>
                      <span className={styles.count}>{session.entryCount}</span>
                    </button>
                  )
                })
              )}
            </div>
          </nav>

          <div className={styles.detailPane}>
            {selectedAgentSession ? (
              <>
                <header className={styles.detailHeader}>
                  <div className={styles.headerTitle}>
                    <Bot aria-hidden="true" size={18} />
                    <div>
                      <h3>{selectedAgentSession.title || props.t('sessions.untitledAgentSession')}</h3>
                      <span style={{ fontSize: '11.5px', color: 'var(--loom-color-text-subtle)' }}>
                        {selectedAgentSession.id}
                      </span>
                    </div>
                  </div>
                </header>

                <div className={styles.infoGrid}>
                  <div className={styles.infoCard}>
                    <span>Agent Profile</span>
                    <strong>
                      {props.agentProfiles.find(p => p.id === selectedAgentSession.agentProfileId)?.name ?? selectedAgentSession.agentProfileId}
                    </strong>
                  </div>
                  <div className={styles.infoCard}>
                    <span>对话条目数</span>
                    <strong>{selectedAgentSession.entryCount} 条消息</strong>
                  </div>
                  <div className={styles.infoCard}>
                    <span>绑定模式</span>
                    <strong>
                      {selectedAgentSession.id === props.narrativeAgentSession?.id ? 'Narrative 绑定' : '独立 Agent 会话'}
                    </strong>
                  </div>
                </div>
              </>
            ) : (
              <div className={styles.empty}>
                <Bot aria-hidden="true" />
                <span>未选中 Agent 会话</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function EmptyState(props: { icon: SessionView; text: string }) {
  return (
    <div className={styles.empty}>
      {props.icon === 'timeline' ? <FolderGit2 aria-hidden="true" /> : <Bot aria-hidden="true" />}
      <span>{props.text}</span>
    </div>
  )
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}
