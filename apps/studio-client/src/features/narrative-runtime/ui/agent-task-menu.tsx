import type { ActiveAgentRun, RunRecovery } from '../model/use-narrative-runtime.js'
import type { AgentTranscriptEntry } from '../../../entities/index.js'
import { resolveAgentRuntimePhase } from '../model/agent-runtime-phase.js'
import { useEffect, useId, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Dialog, IconButton } from '@loom-studio/ui'
import { AlertCircle, Check, LoaderCircle, ChevronUp, CircleX, ExternalLink, Pause, Play, RefreshCw } from 'lucide-react'
import type { StudioApi } from '../../../shared/api/studio-api.js'
import { subscribeExtensionEvents } from '../../../shared/api/extension-events.js'
import type { Translator } from '../../../shared/i18n/index.js'
import styles from './agent-task-menu.module.scss'

type Task = Awaited<ReturnType<StudioApi['agentSessions']['listRuns']>>['tasks'][number]

export function AgentTaskMenu(props: {
  activeRun?: ActiveAgentRun
  messages?: AgentTranscriptEntry[]
  runRecovery?: RunRecovery
  api: StudioApi
  endpoint: string
  timelineId?: string
  t: Translator
  onOpen(sessionId: string, runId?: string): Promise<void>
  onResumed(sessionId: string, runId: string): void
  onAbandoned(sessionId: string): Promise<void>
}) {
  const { api, endpoint, timelineId, t } = props
  const queryClient = useQueryClient()
  const [eventsConnected, setEventsConnected] = useState(false)
  const [open, setOpen] = useState(false)
  const [allOpen, setAllOpen] = useState(false)
  const contentId = useId()
  const [busy, setBusy] = useState<string>()
  const busyRef = useRef(false)
  const [error, setError] = useState<string>()
  const [abandon, setAbandon] = useState<Task>()
  const tasks = useQuery({
    queryKey: ['agent-tasks', endpoint, 'timeline', timelineId],
    queryFn: ({ signal }) => api.agentSessions.listRuns({ timelineId }, signal),
    enabled: Boolean(timelineId),
    refetchInterval: query => {
      if (eventsConnected) return false
      return open || query.state.data?.tasks.some(task => task.state === 'running') || props.activeRun?.status === 'running' ? 2000 : 10000
    },
    retry: false,
  })
  const allTasks = useQuery({
    queryKey: ['agent-tasks', endpoint, 'all'],
    queryFn: ({ signal }) => api.agentSessions.listRuns(undefined, signal),
    enabled: allOpen,
    refetchInterval: !eventsConnected && allOpen ? 2000 : false,
    retry: false,
  })
  useEffect(() => {
    if (typeof EventSource === 'undefined') return
    const refresh = async (changedTimelineId?: string | null) => {
      const filters = {
        queryKey: ['agent-tasks', endpoint],
        predicate: ({ queryKey }: { queryKey: readonly unknown[] }) =>
          queryKey[2] === 'all' || changedTimelineId === undefined || queryKey[3] === changedTimelineId,
      }
      // A request already in flight may have read the snapshot before this event.
      await queryClient.cancelQueries(filters)
      await queryClient.invalidateQueries(filters, { cancelRefetch: false })
    }
    return subscribeExtensionEvents({
      onConnected: () => {
        setEventsConnected(true)
        void refresh()
      },
      onError: () => setEventsConnected(false),
      events: {
        'agent.run-list.changed': event => {
          const { timelineId: changedTimelineId } = (JSON.parse(event.data) as { payload: { timelineId?: string | null } }).payload
          void refresh(changedTimelineId)
        },
      },
    })
  }, [endpoint, queryClient])
  const currentTasks = tasks.data?.tasks ?? []
  const hasRunningTask = props.activeRun?.status === 'running' && !props.activeRun.approval
    || currentTasks.some(task => task.runId !== props.activeRun?.runId && task.state === 'running')
  const hasFailedTask = Boolean(props.activeRun?.error) || props.runRecovery?.status === 'failed'
    || currentTasks.some(task => task.state === 'failed' || task.state === 'interrupted' || Boolean(task.reason && task.reason !== 'user-pause'))
  const hasPausedTask = props.activeRun?.status === 'suspended' || currentTasks.some(task => task.state === 'suspended' && (!task.reason || task.reason === 'user-pause'))
  const StatusIcon = hasRunningTask ? LoaderCircle : props.activeRun?.approval || hasFailedTask ? AlertCircle
    : hasPausedTask ? Pause : currentTasks.length ? Check : undefined

  const counts = (['running', 'failed', 'suspended', 'interrupted'] as const)
    .map(state => {
      if (state === 'failed') {
        const failedCount = currentTasks.filter(task => task.state === 'failed' || (task.state === 'suspended' && Boolean(task.reason && task.reason !== 'user-pause'))).length
          + (props.runRecovery?.status === 'failed' && !currentTasks.length ? 1 : 0)
        return { state, count: failedCount }
      }
      if (state === 'suspended') {
        const suspendedCount = currentTasks.filter(task => task.state === 'suspended' && (!task.reason || task.reason === 'user-pause')).length
        return { state, count: suspendedCount }
      }
      return { state, count: currentTasks.filter(task => task.state === state).length }
    })
    .filter(item => item.count > 0)
  const summary = tasks.error ? tasks.error.message : tasks.isPending && props.timelineId ? t('agentTasks.loading')
    : counts.length ? counts.map(item => `${t(`agentTasks.${item.state}`)} · ${item.count}`).join(' / ')
      : undefined
  const phase = resolveAgentRuntimePhase(props.activeRun, props.messages, t)
  const matchingRun = currentTasks.find(task => task.runId === props.activeRun?.runId)
  const summaryText = summary
    ? `${summary}${matchingRun && counts.length === 1 && counts[0].count === 1 && phase.kind !== 'idle' ? ` · ${phase.text}` : ''}`
    : undefined



  async function act(task: Task, action: 'pause' | 'resume' | 'abandon' | 'open') {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(task.runId)
    setError(undefined)
    try {
      if (action === 'open') {
        await props.onOpen(task.agentSessionId, task.state === 'running' ? task.runId : undefined)
        setOpen(false)
        setAllOpen(false)
      } else if (action === 'pause') {
        const result = await api.agentSessions.pauseRun(task.runId)
        if (!result.accepted) throw new Error(t('agentTasks.changed'))
      } else if (action === 'resume') {
        const result = await api.agentSessions.resumeRun({ runId: task.runId, agentSessionId: task.agentSessionId })
        if (!result.accepted) throw new Error(t('agentTasks.changed'))
        props.onResumed(task.agentSessionId, result.runId)
      } else {
        const result = await api.agentSessions.abandonRun(task.runId, task.agentSessionId)
        if (!result.accepted) throw new Error(t('agentTasks.changed'))
        setAbandon(undefined)
        await props.onAbandoned(task.agentSessionId)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      busyRef.current = false
      setBusy(undefined)
      if (!eventsConnected) {
        if (timelineId) void tasks.refetch()
        if (allOpen) void allTasks.refetch()
      }
    }
  }

  const renderTasks = (query: typeof tasks) => (
      <div className={styles.content}>
        {error || query.error ? <p role="alert" className={styles.error}>{error ?? query.error?.message}</p> : null}
        {query.isPending ? <p role="status">{t('agentTasks.loading')}</p> : !query.data?.tasks.length && !query.error ? <p>{t('agentTasks.empty')}</p> : null}
        <ul className={styles.list}>{query.data?.tasks.map(task => <li className={styles.row} key={task.runId} aria-busy={busy === task.runId}>
          <div className={styles.identity}>
            <strong>{task.title || task.agentSessionId}</strong>
            <span>{task.runId === props.activeRun?.runId && phase.kind !== 'idle' ? phase.text : (task.state === 'suspended' && task.reason && task.reason !== 'user-pause') ? t('agentTasks.failed') : t(`agentTasks.${task.state}`)} · {new Date(task.updatedAt).toLocaleString()}</span>
            {task.reason ? <p className={styles.error}>{task.reason}</p> : (task.runId === props.activeRun?.runId && props.activeRun?.error) ? <p className={styles.error}>{props.activeRun.error}</p> : null}
          </div>
          <div className={styles.actions}>
            {task.canPause ? <IconButton aria-label={t('agentTasks.pause')} disabled={Boolean(busy)} onClick={() => void act(task, 'pause')}><Pause aria-hidden="true" /></IconButton> : null}
            {(task.canResume || task.state === 'failed' || task.state === 'suspended') ? <IconButton aria-label={t('agentTasks.resume')} disabled={Boolean(busy)} onClick={() => void act(task, 'resume')}><Play aria-hidden="true" /></IconButton> : null}
            {(task.canAbandon || task.state === 'failed' || task.state === 'suspended') ? <IconButton aria-label={t('agentTasks.abandon')} disabled={Boolean(busy)} onClick={() => { setError(undefined); setAbandon(task) }}><CircleX aria-hidden="true" /></IconButton> : null}
            <IconButton aria-label={t('agentTasks.open')} disabled={Boolean(busy)} onClick={() => void act(task, 'open')}><ExternalLink aria-hidden="true" /></IconButton>
          </div>
        </li>)}</ul>
      </div>
  )

  return <>
    <section className={styles.panel} data-open={open} aria-label={t('agentTasks.title')}>
      <div className={styles.bar}>
        <button type="button" className={styles.toggle} aria-expanded={open} aria-controls={contentId} onClick={() => setOpen(value => !value)}>
          {StatusIcon && <StatusIcon aria-hidden="true" className={hasRunningTask ? styles.runningIcon : undefined} />}<span>{t('agentTasks.current')}</span>
          <ChevronUp className={styles.chevron} aria-hidden="true" />
        </button>
        {summaryText ? <span className={styles.summary} title={summaryText}>{summaryText}</span> : null}
      </div>
      <div className={styles.expansion} data-open={open} inert={!open} aria-hidden={!open}>
        <div className={styles.clip}>
          <div id={contentId} className={styles.details}>
            {props.timelineId ? renderTasks(tasks) : <p>{t('agentTasks.empty')}</p>}
            <div className={styles.detailsFooter}><Button onClick={() => setAllOpen(true)}>{t('agentTasks.all')}</Button></div>
          </div>
        </div>
      </div>
    </section>
    <Dialog open={allOpen} title={t('agentTasks.all')} onClose={() => setAllOpen(false)}
      headerActions={<IconButton aria-label={t('agentTasks.refresh')} disabled={allTasks.isFetching} onClick={() => void allTasks.refetch()}><RefreshCw aria-hidden="true" /></IconButton>}>
      {renderTasks(allTasks)}
    </Dialog>
    <Dialog open={Boolean(abandon)} title={t('agentTasks.abandon')} onClose={() => { if (!busy) setAbandon(undefined) }}
      actions={<><Button disabled={Boolean(busy)} onClick={() => setAbandon(undefined)}>{t('agentTasks.close')}</Button><Button disabled={Boolean(busy)} onClick={() => { if (abandon) void act(abandon, 'abandon') }}>{t('agentTasks.abandon')}</Button></>}>
      <p>{t('agentTasks.abandonDescription')}</p>
      {error ? <p role="alert">{error}</p> : null}
    </Dialog>
  </>
}
