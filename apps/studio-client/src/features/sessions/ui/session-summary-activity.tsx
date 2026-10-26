import { useSessionSummaryStatus } from '../model/use-session-summary-status.js'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { StudioApi } from '../../../shared/api/studio-api.js'
import { Button } from '@loom-studio/ui'
import { AgentToolActionItem } from './agent-tool-blocks.js'

export type SummaryCoverage = Awaited<ReturnType<StudioApi['agentSessions']['memory']>>['coverage']
export type SummaryRow = { id: string; sourceThroughSequence: number; adopted: boolean; content: ReactNode }
export type SummaryControl = { sessionId: string; state: 'running' | 'suspended' | 'idle'; stop(): void; resume(): void }

export function SessionSummaryActivity({ api, sessionId, title, onUpdate, onOpen, onControl, onRows, onCoverage, historyVersion }: {
  api: StudioApi; sessionId: string; title: string; onUpdate(id: string): Promise<void>; onOpen(): void; onControl(control: SummaryControl): void; onRows(value: { sessionId: string; rows: SummaryRow[] }): void
  historyVersion?: string
  onCoverage(value: { sessionId: string; coverage?: SummaryCoverage }): void
}) {
  const { status, error } = useSessionSummaryStatus(api, sessionId)
  const [action, setAction] = useState<'running' | 'stopping'>()
  const [actionError, setActionError] = useState<string>()
  const controlRef = useRef(onControl)
  controlRef.current = onControl
  const running = action !== undefined || status.state === 'preparing' || status.state === 'ready'
  async function perform(resume: boolean) {
    setAction(resume ? 'running' : 'stopping')
    setActionError(undefined)
    try {
      if (resume) await api.agentSessions.summarize({ agentSessionId: sessionId })
      else await api.agentSessions.cancelSummary(sessionId)
    } catch (cause) { setActionError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setAction(undefined) }
  }
  useEffect(() => {
    controlRef.current({ sessionId, state: running ? 'running' : status.state === 'failed' ? 'suspended' : 'idle',
      stop: () => { void perform(false) }, resume: () => { void perform(true) } })
  }, [sessionId, running, status.state])
  const updateRef = useRef(onUpdate)
  updateRef.current = onUpdate
  const [tasks, setTasks] = useState<Awaited<ReturnType<StudioApi['agentSessions']['summaryTasks']>>>([])
  const [refreshError, setRefreshError] = useState<string>()
  useEffect(() => {
    let active = true
    setRefreshError(undefined)
    void api.agentSessions.summaryTasks(sessionId).then(next => { if (active) setTasks(next) }).catch(cause => {
      if (active) setRefreshError(cause instanceof Error ? cause.message : String(cause))
    })
    if (status.state !== 'idle') void updateRef.current(sessionId).catch(cause => {
      if (active) setRefreshError(cause instanceof Error ? cause.message : String(cause))
    })
    return () => { active = false }
  }, [api, sessionId, status.taskId, status.state])
  const coverageRef = useRef(onCoverage)
  coverageRef.current = onCoverage
  useEffect(() => {
    let active = true
    if (!historyVersion || status.state === 'preparing') return
    void api.agentSessions.memory({ agentSessionId: sessionId }).then(memory => {
      if (active) coverageRef.current({ sessionId, coverage: memory.summary ? memory.coverage : undefined })
    }).catch(cause => { if (active) setRefreshError(cause instanceof Error ? cause.message : String(cause)) })
    return () => { active = false }
  }, [api, sessionId, status.taskId, status.state, historyVersion])
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
