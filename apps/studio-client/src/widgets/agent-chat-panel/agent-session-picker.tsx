import { useRef, useState } from 'react'
import { Check, MessagesSquare, Pencil, Star, X } from 'lucide-react'
import { Button, Dialog, IconButton, SearchField, TextInput } from '@loom-studio/ui'
import type { AgentPreset, AgentSession, CardSummary, NarrativeTimeline } from '../../entities/index.js'
import { formatDateTime, type Translator } from '../../shared/i18n/index.js'
import { sessionPresetName, sessionSourceLabel } from '../../entities/session-identification.js'
import { normalizeSearchText } from '../../shared/lib/text.js'
import { useSlidingHover } from '../../shared/hooks/use-sliding-hover.js'
import styles from '../../features/sessions/ui/agent-session-picker.module.scss'

type RenameSession = (id: string, title: string) => Promise<AgentSession | undefined>

function SessionTitleInput(props: {
  session: AgentSession
  disabled: boolean
  autoFocus?: boolean
  onRename: RenameSession
  onSaved?(): void
  onCancel?(): void
  onBusyChange(busy: boolean): void
  t: Translator
}) {
  const [draft, setDraft] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const saving = useRef(false)

  async function save() {
    if (draft === undefined || saving.current || props.disabled) return
    const title = draft.trim()
    if (title === (props.session.title ?? '')) {
      setDraft(undefined)
      props.onSaved?.()
      return
    }
    saving.current = true
    setBusy(true)
    props.onBusyChange(true)
    setError('')
    try {
      const updated = await props.onRename(props.session.id, title)
      if (!updated) {
        setError(props.t('agent.titleNotSaved'))
        return
      }
      setDraft(undefined)
      props.onSaved?.()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      saving.current = false
      setBusy(false)
      props.onBusyChange(false)
    }
  }

  return <div className={styles.nameEditor}>
    <TextInput className={styles.nameInput} aria-label={props.t('agent.sessionName')}
      placeholder={props.t('sessions.untitledAgentSession')}
      value={draft ?? props.session.title ?? ''} autoFocus={props.autoFocus}
      disabled={props.disabled || busy} onChange={event => setDraft(event.target.value)}
      onBlur={() => void save()} onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
        if (event.key === 'Enter') { event.preventDefault(); void save() }
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          setDraft(undefined)
          setError('')
          props.onCancel?.()
        }
      }} />
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
  </div>
}

export function AgentSessionPicker(props: {
  session?: AgentSession
  sessions: AgentSession[]
  presets: AgentPreset[]
  cards?: CardSummary[]
  timelines?: NarrativeTimeline[]
  primarySessionId?: string
  disabled: boolean
  sessionReady?: boolean
  onSelect?(id: string): void
  onRename?: RenameSession
  t: Translator
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [editingId, setEditingId] = useState<string>()
  const [renaming, setRenaming] = useState(false)
  const presetName = (session: AgentSession) =>
    sessionPresetName(session, props.presets, props.t)
  const sourceLabel = (session: AgentSession) => sessionSourceLabel(session, props.timelines ?? [], props.cards ?? [], props.t)
  const title = (session: AgentSession) => session.title ?? props.t('sessions.untitledAgentSession')
  const search = normalizeSearchText(query)
  const sessions = props.sessions.filter(session => session.kind !== 'timeline' &&
    normalizeSearchText(`${title(session)} ${presetName(session)} ${sourceLabel(session)}`).includes(search))
  const locked = props.disabled || renaming
  const slidingHover = useSlidingHover<HTMLDivElement>()

  return <>
    <div className={styles.selector}>
      {props.session?.id === props.primarySessionId && props.session
        ? <Star className={styles.primaryIcon} aria-label={props.t('agent.primarySession')} size={15} /> : null}
      {props.session && props.onRename
        ? <SessionTitleInput key={props.session.id} session={props.session} t={props.t}
          disabled={locked || props.sessionReady === false} onRename={props.onRename} onBusyChange={setRenaming} />
        : <TextInput className={styles.nameInput} readOnly aria-label={props.t('agent.session')}
          value={props.session ? title(props.session) : ''}
          placeholder={props.t('agent.sessionPending')} />}
      {props.onSelect && <IconButton aria-label={props.t('agent.selectSession')} title={props.t('agent.selectSession')} disabled={locked}
        className={styles.pickerTrigger}
        onClick={() => { setQuery(''); setEditingId(undefined); setOpen(true) }}>
        <MessagesSquare size={16} aria-hidden="true" />
      </IconButton>}
    </div>
    {open ? <Dialog open title={props.t('agent.sessionsTitle')} className={styles.dialog} dismissible={!locked}
      onClose={() => setOpen(false)}
      showCloseButton={false} headerActions={<IconButton aria-label={props.t('agent.closeSessionPicker')} title={props.t('agent.close')} disabled={locked}
        onClick={() => setOpen(false)}><X size={16} aria-hidden="true" /></IconButton>}
      actions={<Button disabled={locked} onClick={() => setOpen(false)}>{props.t('agent.close')}</Button>}>
      <div className={styles.pickerBody}>
        <SearchField aria-label={props.t('agent.searchSessions')} placeholder={props.t('agent.searchSessionPlaceholder')} value={query}
          onChange={event => setQuery(event.target.value)} clearLabel={props.t('agent.clearSearch')} onClear={() => setQuery('')} />
        <div
          ref={slidingHover.containerRef}
          className={styles.pickerList}
          role="list"
          aria-label={props.t('agent.sessionList')}
          onPointerOver={slidingHover.onPointerOver}
          onPointerLeave={slidingHover.onPointerLeave}
        >
          <div className={styles.hoverIndicator} style={slidingHover.indicatorStyle} aria-hidden="true" />
          {sessions.map(session => {
            const selected = session.id === props.session?.id
            return <div key={session.id} data-hover-item className={styles.sessionRow} role="listitem"
              data-selected={selected}>
              {editingId === session.id && props.onRename
                ? <SessionTitleInput session={session} disabled={locked} autoFocus t={props.t}
                  onRename={props.onRename} onSaved={() => setEditingId(undefined)}
                  onCancel={() => setEditingId(undefined)} onBusyChange={setRenaming} />
                : <button type="button" className={styles.sessionChoice} disabled={locked || !props.onSelect}
                  aria-label={props.t('agent.openSessionNamed', { name: title(session) })} aria-current={selected ? 'true' : undefined}
                  onClick={() => { props.onSelect?.(session.id); setOpen(false) }}>
                  <MessagesSquare size={16} aria-hidden="true" />
                  <span className={styles.choiceText}>
                    <strong title={title(session)}>{title(session)}</strong>
                    <span title={sourceLabel(session)}>{sourceLabel(session)}</span>
                    <span title={presetName(session)}>{presetName(session)} · {formatDateTime(session.updatedAt)}</span>
                  </span>
                  {selected ? <Check size={15} aria-hidden="true" /> : null}
                </button>}
              <div className={styles.rowActions}>
                {props.onRename ? <IconButton size="small" aria-label={props.t('agent.renameSessionNamed', { name: title(session) })}
                  title={props.t('sessions.rename')} disabled={locked || editingId === session.id}
                  onClick={() => setEditingId(session.id)}><Pencil size={14} aria-hidden="true" /></IconButton> : null}

              </div>
            </div>
          })}
          {!sessions.length ? <p className={styles.empty}>{props.t(query ? 'agent.noMatchingSessions' : 'agent.noSessions')}</p> : null}
        </div>
      </div>
    </Dialog> : null}
  </>
}
