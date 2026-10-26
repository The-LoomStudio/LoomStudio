import type { NarrativeSessionStep } from '../features/narrative-runtime/model/narrative-execution-view.js'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@loom-studio/ui'
import type { AgentPreset, AgentSession, AgentTranscriptEntry } from '../entities/index.js'
import { createTranslator } from '../shared/i18n/index.js'
import { AgentChatPanel } from '../widgets/agent-chat-panel/agent-chat-panel.js'


export type PreviewRate = 'slow' | 'steady' | 'burst'
export const previewRates = { slow: { step: 1, delay: 80 }, steady: { step: 2, delay: 32 }, burst: { step: 12, delay: 32 } } as const
const t = createTranslator('zh-CN')
const session: AgentSession = { id: 'preview-helper', kind: 'agent', agentPresetId: 'preview-preset', title: '副 Session · 流式样例', entryCount: 0, createdAt: '', updatedAt: '' }
const presets: AgentPreset[] = [{ id: 'preview-preset', version: 1, resourceKind: 'preset', rootNode: { id: 'preview-root', kind: 'module', label: '本地流式样例' }, createdAt: '', updatedAt: '' }]

function transcript(steps: NarrativeSessionStep[], input: string, runId: string): AgentTranscriptEntry[] {
  const entries: AgentTranscriptEntry[] = []
  const push = (id: string, entry: AgentTranscriptEntry['entry']) => entries.push({ id, runId, agentSessionId: session.id, sequence: entries.length + 1, createdAt: '', entry })
  push(`${runId}-user`, { kind: 'message', role: 'user', content: input })
  for (const step of steps) {
    const id = `${runId}-${step.id}`
    if (step.kind === 'thinking') push(id, { kind: 'reasoning', content: step.content })
    else if (step.kind === 'tool') {
      // Keep the same presentation identity when draft parameters become a saved call.
      if (step.state === 'running') push(id, { kind: 'tool-input', exposedName: step.title, rawInput: step.content })
      else {
        push(id, { kind: 'tool-invocation', invocationId: id, exposedName: step.title, rawInput: step.content })
        push(`${id}-result`, { kind: 'tool-result', invocationId: id, status: 'completed', content: '样例操作已完成；没有调用业务接口。' })
      }
    } else push(id, { kind: 'message', role: step.role ?? 'assistant', content: step.content, ...(step.state === 'running' ? { state: 'partial' } : {}) })
  }
  return entries
}

/** Actual helper Session widget, driven exclusively by in-memory sample events. */
export function StreamingSessionPreview({ frames, rate }: { frames: NarrativeSessionStep[][]; rate: PreviewRate }) {
  const [input, setInput] = useState('重播一轮长思考、工具与正文。')
  const [job, setJob] = useState<{ frame: number; run: number; input: string; paused: boolean }>()
  const steps = job ? frames[Math.min(job.frame, frames.length - 1)] : []
  const running = Boolean(job && job.frame < frames.length)
  const messages = useMemo(() => job ? transcript(steps, job.input, `preview-run-${job.run}`) : [], [steps, job?.run, job?.input])
  useEffect(() => {
    if (!job || !running || job.paused) return
    const timer = window.setTimeout(() => setJob(current => current ? { ...current, frame: Math.min(frames.length, current.frame + previewRates[rate].step) } : current), previewRates[rate].delay)
    return () => window.clearTimeout(timer)
  }, [job, running, frames, rate])
  const replay = () => setJob(current => ({ frame: 0, run: (current?.run ?? 0) + 1, input: input.trim() || '重播流式样例', paused: false }))
  return <>
    <div style={{ padding: '0 16px 8px', fontSize: 11 }}><Button size="small" onClick={replay}>重播副 Session</Button><span>　独立模拟 · 正式展示组件</span></div>
    <AgentChatPanel runRecoveryBusy={false} canRestoreRunInput={false} reconnectAgentRun={async () => {}} restoreRunInput={() => {}} busy={false} active messages={messages} profiles={presets} providerAccounts={[]}
      session={session} selectedProfileId="preview-preset" input={input} t={t}
      activeRun={job ? { runId: `preview-run-${job.run}`, status: running ? job.paused ? 'suspended' : 'running' : 'completed' } : undefined}
      onChangeInput={setInput} onSelectProfile={() => {}} onSubmit={event => { event.preventDefault(); replay(); setInput('') }}
      onPauseRun={() => setJob(current => current ? { ...current, paused: true } : current)}
      onResumeRun={() => setJob(current => current ? { ...current, paused: false } : current)} />
  </>
}
