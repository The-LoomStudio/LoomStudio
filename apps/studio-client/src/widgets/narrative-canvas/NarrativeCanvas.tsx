import { GitBranch } from 'lucide-react'
import type { Translator } from '../../shared/i18n/index.js'
import styles from './NarrativeCanvas.module.css'

type BranchView = {
  id: string
  title?: string
  headEntryId?: string
  forkedFromEntryId?: string
}

type SessionView = {
  title?: string
  cardSourceVersionId: string
}

type CardView = {
  name: string
}

type NarrativeEntryView = {
  id: string
  version: number
  role: 'user' | 'assistant'
  content: string
  branchId: string
  parentEntryId?: string
  runId?: string
}

type NarrativeCanvasProps = {
  branch?: BranchView
  branches: BranchView[]
  busy: boolean
  emptyTimelineText: string
  onForkEntry: (entry: NarrativeEntryView) => void
  onSwitchBranchById: (branchId: string) => void
  selectedCard?: CardView
  session?: SessionView
  t: Translator
  timeline: NarrativeEntryView[]
}

export function NarrativeCanvas(props: NarrativeCanvasProps) {
  return (
    <section className={styles.timelinePane} data-airp-component="default-airp-layout">
      <div className={styles.timeline} data-airp-component="base-chat-canvas">
        {props.timeline.length === 0 ? (
          <div className={styles.empty}>{props.emptyTimelineText}</div>
        ) : props.timeline.map((entry, index) => (
          <article
            className={`${styles.message} ${entry.role === 'user' ? styles.user : styles.assistant}`}
            data-airp-component="chat-message"
            data-airp-role={entry.role}
            data-airp-state="settled"
            key={entry.id}
          >
            <header className={styles.messageChrome}>
              <div className={styles.avatar} aria-hidden="true">
                {readAvatarLabel(entry.role, props.t)}
              </div>
              <div className={styles.turnLabel}>
                #{index + 1} · v{entry.version}
              </div>
              <div className={styles.messageMeta}>
                <div className={styles.messageIdentity}>
                  <strong>{formatRoleLabel(entry.role, props.t)}</strong>
                  <span>{formatEntryMeta(entry)}</span>
                </div>
                <button
                  aria-label={props.t('timeline.fork')}
                  className={styles.iconButton}
                  type="button"
                  onClick={() => props.onForkEntry(entry)}
                  disabled={props.busy}
                  title={props.t('timeline.fork')}
                >
                  <GitBranch aria-hidden="true" absoluteStrokeWidth size={17} strokeWidth={1.5} />
                </button>
              </div>
            </header>
            <p data-airp-slot="message-body">{entry.content}</p>
          </article>
        ))}
      </div>
    </section>
  )
}

function formatEntryMeta(entry: NarrativeEntryView): string {
  const parts = [`entry ${shortId(entry.id)}`, `branch ${shortId(entry.branchId)}`]
  if (entry.parentEntryId) parts.push(`parent ${shortId(entry.parentEntryId)}`)
  if (entry.runId) parts.push(`run ${shortId(entry.runId)}`)
  return parts.join(' / ')
}

function formatRoleLabel(role: NarrativeEntryView['role'], t: Translator): string {
  return role === 'user' ? t('timeline.role.user') : t('timeline.role.assistant')
}

function readAvatarLabel(role: NarrativeEntryView['role'], t: Translator): string {
  return formatRoleLabel(role, t).slice(0, 1)
}

function shortId(id: string): string {
  return id.slice(0, 13)
}
