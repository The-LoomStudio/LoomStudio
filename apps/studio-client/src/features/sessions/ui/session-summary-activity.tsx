import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSessionSummaryStatus } from '../model/use-session-summary-status.js'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { subscribeDataCommits } from '../../../shared/api/data-commit-events.js'
import type { StudioApi } from '../../../shared/api/studio-api.js'
import { Button } from '@loom-studio/ui'
import { AgentToolActionItem } from './agent-tool-blocks.js'

export type SummaryCoverage = Awaited<ReturnType<StudioApi['agentSessions']['memory']>>['coverage']
export type SummaryRow = { id: string; sourceThroughSequence: number; adopted: boolean; content: ReactNode }
export type SummaryControl = { sessionId: string; state: 'running' | 'suspended' | 'idle'; stop(): void; resume(): void }

type SummaryTask = Awaited<ReturnType<StudioApi['agentSessions']['summaryTasks']>>[number]
const EMPTY_TASKS: SummaryTask[] = []
const apiScopeIds = new WeakMap<StudioApi, number>()
let nextApiScopeId = 1

function getApiScopeId(api: StudioApi): number {
  let id = apiScopeIds.get(api)
  if (id === undefined) {
    id = nextApiScopeId++
    apiScopeIds.set(api, id)
  }
  return id
}

function readError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

export function SessionSummaryActivity({ api, sessionId, title, onUpdate, onOpen, onControl, onRows, onCoverage, historyVersion }: {
  api: StudioApi; sessionId: string; title: string; onUpdate(id: string): Promise<void>; onOpen(): void; onControl(control: SummaryControl): void; onRows(value: { sessionId: string; rows: SummaryRow[] }): void
  historyVersion?: string
  onCoverage(value: { sessionId: string; coverage?: SummaryCoverage }): void
}) {
  const queryClient = useQueryClient()
  const apiScope = getApiScopeId(api)
  const { status, error } = useSessionSummaryStatus(api, sessionId)
  const [action, setAction] = useState<'running' | 'stopping'>()
  const [actionError, setActionError] = useState<string>()
  const controlRef = useRef(onControl)
  controlRef.current = onControl
  const running = action !== undefined || status.state === 'preparing' || status.state === 'ready'
  const tasksQueryKey = useMemo(() => ['agent-sessions', apiScope, 'summary-tasks', sessionId] as const, [apiScope, sessionId])
  const memoryQueryKey = useMemo(
    () => ['agent-sessions', apiScope, 'memory', sessionId, historyVersion, status.taskId, status.state] as const,
    [apiScope, sessionId, historyVersion, status.taskId, status.state],
  )

  async function perform(resume: boolean) {
    setAction(resume ? 'running' : 'stopping')
    setActionError(undefined)
    try {
      if (resume) await api.agentSessions.summarize({ agentSessionId: sessionId })
      else await api.agentSessions.cancelSummary(sessionId)
      await queryClient.invalidateQueries({ queryKey: ['agent-sessions', apiScope, 'summary-status', sessionId] })
      await queryClient.invalidateQueries({ exact: true, queryKey: tasksQueryKey })
    } catch (cause) { setActionError(readError(cause)) }
    finally { setAction(undefined) }
  }
  useEffect(() => {
    controlRef.current({ sessionId, state: running ? 'running' : status.state === 'failed' ? 'suspended' : 'idle',
      stop: () => { void perform(false) }, resume: () => { void perform(true) } })
  }, [sessionId, running, status.state])
  const updateRef = useRef(onUpdate)
  updateRef.current = onUpdate
  const [updateError, setUpdateError] = useState<string>()
  const tasksQuery = useQuery({
    queryKey: tasksQueryKey,
    queryFn: () => api.agentSessions.summaryTasks(sessionId),
  })
  const tasks = tasksQuery.data ?? EMPTY_TASKS

  useEffect(() => {
    void queryClient.invalidateQueries({ exact: true, queryKey: tasksQueryKey })
    if (status.state === 'idle') {
      setUpdateError(undefined)
      return
    }
    let active = true
    setUpdateError(undefined)
    void updateRef.current(sessionId).catch(cause => {
      if (active) setUpdateError(readError(cause))
    })
    return () => { active = false }
  }, [queryClient, tasksQueryKey, sessionId, status.taskId, status.state])

  useEffect(() => {
    return subscribeDataCommits(
      operations => {
        const hasSummaryChange = operations.some(op =>
          op.entityType === 'agent.summary-task'
          || (op.entityType === 'agent.session' && op.entityId === sessionId),
        )
        if (!hasSummaryChange) return
        void queryClient.invalidateQueries({ exact: true, queryKey: tasksQueryKey })
        void queryClient.invalidateQueries({ queryKey: ['agent-sessions', apiScope, 'memory', sessionId] })
      },
      () => {
        void queryClient.invalidateQueries({ exact: true, queryKey: tasksQueryKey })
        void queryClient.invalidateQueries({ queryKey: ['agent-sessions', apiScope, 'memory', sessionId] })
      },
    )
  }, [apiScope, queryClient, sessionId, tasksQueryKey])

  const memoryQuery = useQuery({
    queryKey: memoryQueryKey,
    enabled: Boolean(historyVersion) && status.state !== 'preparing',
    queryFn: () => api.agentSessions.memory({ agentSessionId: sessionId }),
  })
  const coverageRef = useRef(onCoverage)
  coverageRef.current = onCoverage
  useEffect(() => {
    if (!memoryQuery.data) return
    coverageRef.current({ sessionId, coverage: memoryQuery.data.summary ? memoryQuery.data.coverage : undefined })
  }, [memoryQuery.data, sessionId])

  const refreshError = updateError
    ?? (tasksQuery.error ? readError(tasksQuery.error) : undefined)
    ?? (memoryQuery.error ? readError(memoryQuery.error) : undefined)
  const rowsRef = useRef(onRows)
  rowsRef.current = onRows
  const openRef = useRef(onOpen)
  openRef.current = onOpen
  useEffect(() => {
    const groups = new Map<number, typeof tasks>()
    for (const task of [...tasks].reverse()) {
      const attempts = groups.get(task.sourceThroughSequence) ?? []
      attempts.push(task)
      groups.set(task.sourceThroughSequence, attempts)
    }
    const rows = [...groups.values()].map(attempts => {
      const task = attempts[attempts.length - 1]!

      const current = task.taskId === status.taskId
      const inProgress = current && running
      const label = inProgress ? action === 'stopping' ? '正在终止总结' : status.state === 'ready' ? '摘要已准备 · 等待采用' : '正在总结 · 等待交接'
        : task.state === 'adopted' ? '交接摘要已采用' : task.state === 'failed' ? (/cancelled/i.test(task.content) ? '总结已中断' : '总结失败') : '总结未完成'
      return { id: `summary-position-${task.sourceThroughSequence}`, sourceThroughSequence: task.sourceThroughSequence, adopted: attempts.some(attempt => attempt.state === 'adopted'), content: <aside aria-label={`${title} · 会话交接`}>
        <AgentToolActionItem id={`summary-position-${task.sourceThroughSequence}`} iconType="file" label={attempts.length > 1 ? `${label} · ${attempts.length} 次尝试` : label}
          status={inProgress ? 'running' : task.state === 'adopted' ? 'success' : 'error'}
          inputs={attempts.map((attempt, index) => ({
            label: `${attempts.length > 1 ? `第 ${index + 1} 次 · ` : ''}${new Date(attempt.createdAt).toLocaleString()} · ${attempt.state === 'adopted' ? '已采用' : attempt.state === 'failed' ? '失败或中断' : '进行中'}`,
            content: `${attempt.content}\n来源截至会话记录 ${attempt.sourceThroughSequence}${attempt.toolArguments ? `\nsubmit_session_summary\n${attempt.toolArguments}` : ''}`,
          }))}
          errorContent={current ? actionError || error || refreshError || status.error : undefined} />
        {inProgress && <Button size="small" variant="ghost" disabled={action === 'stopping'} onClick={() => { void perform(false) }}>终止总结</Button>}
        {current && !running && status.state === 'failed' && <Button size="small" variant="ghost" onClick={() => { void perform(true) }}>继续总结</Button>}
        <Button size="small" variant="ghost" onClick={() => openRef.current()}>查看会话记忆</Button>
      </aside> }
    })
    rowsRef.current({ sessionId, rows })
  }, [tasks, sessionId, title, status, running, action, actionError, error, refreshError])
  return !tasks.length && (error || refreshError || actionError) ? <p role="alert">{error || refreshError || actionError}</p> : null
}
